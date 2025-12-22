import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import sequelize from "../config/db.js";
import { Op } from "sequelize";
import sendEmail from "../utils/Email.js";

const ADMIN_EMAIL = "ahmedsarwar7575@gmail.com";

const EMAIL_STORE_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}$/i;

const EXCLUDED_EMAILS = new Set(["support@getpiepay.com"]);
const isExcludedEmail = (email) => {
  if (!email) return true;
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_STORE_RE.test(e)) return true;
  if (EXCLUDED_EMAILS.has(e)) return true;
  if (e.endsWith("@getpiepay.com")) return true;
  if (e.includes("getpiepay.com") && !e.includes("@")) return true;
  return false;
};

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

const safeSendEmail = async ({ to, subject, text, html }) => {
  try {
    return await sendEmail(to, subject, text);
  } catch (e1) {
    try {
      return await sendEmail(to, subject, html || text || "");
    } catch (e2) {
      return null;
    }
  }
};

const normalizePhone = (p) => {
  if (!p) return null;
  const s = String(p).trim();
  const keepPlus = s.startsWith("+");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
};

const normalizeName = (n) => {
  if (!n || typeof n !== "string") return null;
  const trimmed = n.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

const shouldForceUnsatisfiedIfTicketFlow = (pairs) => {
  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ")
    .toLowerCase();

  return /\b(escalat\w*|open(?:ed|ing)?\s+(?:a\s+)?(?:\w+\s+){0,4}ticket|creat(?:e|ed|ing)\s+(?:a\s+)?(?:\w+\s+){0,4}ticket|log(?:ged|ging)?\s+(?:a\s+)?(?:\w+\s+){0,3}ticket|case\s+number|follow\s*up|technician\s+(?:will|to)\s+(?:call|contact)|we(?:'ll| will)\s+(?:call|contact)\s+you|priority\s+ticket)\b/i.test(
    text
  );
};

const normalizeLanguages = (arr, pairs) => {
  const out = [];
  const add = (v) => {
    if (!v) return;
    if (!out.includes(v)) out.push(v);
  };

  if (Array.isArray(arr)) {
    for (const raw of arr) {
      const s = String(raw || "").trim();
      if (!s) continue;

      if (ARABIC_SCRIPT_RE.test(s)) {
        add("Urdu");
        continue;
      }

      const low = s.toLowerCase();
      if (low.includes("urdu")) add("Urdu");
      else if (low.includes("english")) add("English");
      else if (low.includes("punjabi")) add("Punjabi");
      else if (low.includes("pashto")) add("Pashto");
      else if (low.includes("arabic")) add("Arabic");
      else {
        if (s.length <= 20 && !/[،,]/.test(s)) add(normalizeName(s));
      }
    }
  }

  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ");
  if (ARABIC_SCRIPT_RE.test(text)) add("Urdu");

  return out;
};

const extractWithOpenAI = async (pairs, { timeoutMs = 60000 } = {}) => {
  const system = `
You are an extractor for GETPIE call logs.

Return ONLY JSON matching the provided schema (no markdown, no extra text).
If unknown/unclear, output the string "not specified". Do not guess.

CRITICAL CONFIRMATION RULE (HARD):
- The transcript can be messy. ONLY accept the user's name/email if the assistant/agent READS IT BACK and the user CONFIRMS with an explicit yes/correct/yeah/right.
- If the user spells something but the agent never reads it back and the user never confirms, then it is NOT confirmed.
- If multiple confirmed values exist, take the LAST confirmed one.

EMAIL RULES (HARD):
- NEVER output support@getpiepay.com or any email at getpiepay.com as the user's email.
- Ignore any company/support emails. Only output the user's personal/business email.
- Output email as a clean email string (example: mirzatayyab033@gmail.com) without extra words.

NAME RULES (HARD):
- ONLY output a name if it is read back by the agent and the user confirms yes/correct.
`.trim();

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "customer",
      "ticket",
      "summary",
      "has_meaningful_conversation",
      "contact_info_only",
      "non_english_detected",
      "clarifications_needed",
      "mishears_or_typos",
    ],
    properties: {
      customer: {
        type: "object",
        additionalProperties: false,
        required: ["name", "email"],
        properties: {
          name: { type: "string" },
          email: { type: "string" },
        },
      },
      ticket: {
        type: "object",
        additionalProperties: false,
        required: [
          "ticketType",
          "status",
          "priority",
          "proposedSolution",
          "isSatisfied",
        ],
        properties: {
          ticketType: {
            type: "string",
            enum: ["support", "sales", "billing", "not specified"],
          },
          status: { type: "string", enum: ["open", "resolved"] },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
          },
          proposedSolution: { type: "string" },
          isSatisfied: {
            anyOf: [
              { type: "boolean" },
              { type: "string", enum: ["not specified"] },
            ],
          },
        },
      },
      summary: { type: "string" },
      has_meaningful_conversation: { type: "boolean" },
      contact_info_only: { type: "boolean" },
      non_english_detected: { type: "array", items: { type: "string" } },
      clarifications_needed: { type: "array", items: { type: "string" } },
      mishears_or_typos: { type: "array", items: { type: "string" } },
    },
  };

  const userMsg = `
Extract fields from these Q/A pairs.

Q/A PAIRS:
${JSON.stringify(pairs, null, 2)}
  `.trim();

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  let raw;
  try {
    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_output_tokens: 500,
      text: {
        format: {
          type: "json_schema",
          name: "getpie_extract_v2_confirmed_only",
          strict: true,
          schema,
        },
      },
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: userMsg }] },
      ],
    };

    r = await fetch("https://api.openai.com/v1/responses", {
      signal: ctrl.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    raw = await r.text();
  } finally {
    clearTimeout(timeoutId);
  }

  if (!r.ok) return { error: "openai", status: r.status, body: raw };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "openai_bad_json", body: raw };
  }

  if (data?.status && data.status !== "completed") {
    return {
      error: "openai_incomplete",
      status: data.status,
      incomplete_details: data.incomplete_details,
      body: raw,
    };
  }

  let outText = null;
  if (typeof data.output_text === "string") outText = data.output_text;
  else if (Array.isArray(data.output)) {
    const msgItem = data.output.find((item) => item.type === "message");
    const contentText = msgItem?.content?.find?.(
      (c) => c.type === "output_text"
    )?.text;
    if (typeof contentText === "string") outText = contentText;
  }

  if (!outText) return { error: "openai_no_text", body: raw };

  try {
    return JSON.parse(outText);
  } catch {
    return { error: "parse", text: outText, body: raw };
  }
};

export const summarizer = async (pairs, callSid, phone) => {
  try {
    if (!Array.isArray(pairs) || pairs.length === 0)
      return { error: "no_pairs" };
    if (!callSid) return { error: "missing_callSid" };

    let parsed = await extractWithOpenAI(pairs, { timeoutMs: 60000 });
    if (parsed?.error) {
      const retry = await extractWithOpenAI(pairs, { timeoutMs: 60000 });
      if (!retry?.error) parsed = retry;
      else return parsed;
    }

    const ns = (v) => {
      if (v == null) return null;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      if (!trimmed) return null;
      return trimmed.toLowerCase() === "not specified" ? null : trimmed;
    };

    const rawEmail = ns(parsed?.customer?.email);
    const rawName = ns(parsed?.customer?.name);

    const safeEmail =
      rawEmail && !isExcludedEmail(rawEmail) ? rawEmail.toLowerCase() : null;

    const safeName = normalizeName(rawName);

    const safePhone = normalizePhone(phone);

    const forceUnsatisfied = shouldForceUnsatisfiedIfTicketFlow(pairs);

    const parsedIsSat = parsed?.ticket?.isSatisfied;
    let isSatisfied = null;
    if (parsedIsSat === true) isSatisfied = true;
    else if (parsedIsSat === false) isSatisfied = false;
    if (forceUnsatisfied) isSatisfied = false;

    const priorityRaw = ns(parsed?.ticket?.priority);
    const priorityNorm =
      typeof priorityRaw === "string" ? priorityRaw.toLowerCase() : null;
    const ticketPriority = ["low", "medium", "high", "critical"].includes(
      priorityNorm
    )
      ? priorityNorm
      : "medium";

    const typeRaw = ns(parsed?.ticket?.ticketType);
    const typeNorm = typeof typeRaw === "string" ? typeRaw.toLowerCase() : null;
    const ticketType = ["support", "sales", "billing"].includes(typeNorm)
      ? typeNorm
      : null;

    const proposedSolutionRaw = ns(parsed?.ticket?.proposedSolution);
    const proposedSolution =
      typeof proposedSolutionRaw === "string" && proposedSolutionRaw.length
        ? proposedSolutionRaw
        : null;

    const hasConversation = !!parsed?.has_meaningful_conversation;
    const contactInfoOnly = !!parsed?.contact_info_only;

    const qaLog = Array.isArray(pairs) ? pairs : [];
    const summary = typeof parsed?.summary === "string" ? parsed.summary : "";
    const languages = normalizeLanguages(parsed?.non_english_detected, pairs);

    if (!hasConversation && !contactInfoOnly) {
      return { skipped: "no_conversation", extracted: { summary, qaLog } };
    }

    const shouldCreateTicket = isSatisfied === false;

    const result = await sequelize.transaction(async (t) => {
      let userRecord = null;
      let userCreated = false;

      if (safePhone)
        userRecord = await User.findOne({
          where: { phone: safePhone },
          transaction: t,
        });
      if (!userRecord && safeEmail)
        userRecord = await User.findOne({
          where: { email: safeEmail },
          transaction: t,
        });

      if (!userRecord) {
        userRecord = await User.create(
          {
            name: safeName || null,
            email: safeEmail,
            phone: safePhone,
            status: "active",
          },
          { transaction: t }
        );
        userCreated = true;
      } else {
        const patch = {};
        if (safeName && userRecord.name !== safeName) patch.name = safeName;
        if (safeEmail && userRecord.email !== safeEmail)
          patch.email = safeEmail;
        if (safePhone && !userRecord.phone) patch.phone = safePhone;
        if (userRecord.status !== "active") patch.status = "active";
        if (Object.keys(patch).length)
          await userRecord.update(patch, { transaction: t });
      }

      let ticketRecord = null;
      let ticketCreated = false;
      let assignedAgentId = null;

      if (shouldCreateTicket) {
        try {
          const hasIsActive = !!Agent?.rawAttributes?.isActive;
          const hasTicketType = !!Agent?.rawAttributes?.ticketType;

          const whereAgents = {};
          if (hasIsActive) whereAgents.isActive = true;
          if (hasTicketType && ticketType) {
            whereAgents[Op.or] = [{ ticketType }, { ticketType: null }];
          }

          const agents = await Agent.findAll({
            where: whereAgents,
            transaction: t,
          });

          if (agents.length) {
            const openCounts = await Ticket.findAll({
              attributes: [
                "agentId",
                [sequelize.fn("COUNT", sequelize.col("id")), "cnt"],
              ],
              where: { status: "open", agentId: { [Op.ne]: null } },
              group: ["agentId"],
              transaction: t,
            });

            const map = new Map(
              openCounts.map((r) => [
                String(r.get("agentId")),
                Number(r.get("cnt")),
              ])
            );

            let best = null;
            let bestCnt = Infinity;
            for (const a of agents) {
              const cnt = map.get(String(a.id)) ?? 0;
              if (cnt < bestCnt) {
                best = a;
                bestCnt = cnt;
              }
            }
            assignedAgentId = best?.id ?? null;
          }
        } catch (e) {}

        ticketRecord = await Ticket.create(
          {
            status: "open",
            isSatisfied: false,
            priority: ticketPriority,
            proposedSolution,
            ticketType,
            summary,
            userId: userRecord.id,
            agentId: assignedAgentId ?? null,
          },
          { transaction: t }
        );
        ticketCreated = true;
      }

      const callPatch = {
        userId: userRecord.id,
        ticketId: ticketRecord?.id ?? null,
        QuestionsAnswers: qaLog,
        isResolvedByAi: isSatisfied === true ? true : false,
        languages,
        summary,
        type: "inbound",
      };

      const [affected] = await Call.update(callPatch, {
        where: { callSid },
        transaction: t,
      });

      let callRecord = null;
      let callCreated = false;

      if (affected === 0) {
        callRecord = await Call.create(
          { callSid, ...callPatch },
          { transaction: t }
        );
        callCreated = true;
      } else {
        callRecord = await Call.findOne({ where: { callSid }, transaction: t });
      }

      return {
        user: userRecord,
        ticket: ticketRecord,
        call: callRecord,
        agentId: assignedAgentId,
        _flags: { userCreated, ticketCreated, callCreated },
        extracted: {
          name: safeName,
          email: safeEmail,
          phone: safePhone,
          qa_log: qaLog,
          summary,
          languages,
          isSatisfied,
          hasConversation,
          contactInfoOnly,
        },
      };
    });

    try {
      const flags = result?._flags || {};
      const events = [];
      if (flags.userCreated) events.push("New user created");
      if (flags.callCreated) events.push("New call created");
      if (flags.ticketCreated) events.push("New ticket created");

      if (events.length) {
        await safeSendEmail({
          to: ADMIN_EMAIL,
          subject: `GETPIE: ${events.join(" + ")}`,
          text:
            `Events:\n- ${events.join("\n- ")}\n\n` +
            `CallSid: ${callSid}\n` +
            `User: ${result.user?.id || "N/A"} | ${safeName || "N/A"}\n` +
            `Email: ${safeEmail || "N/A"}\n` +
            `Phone: ${safePhone || "N/A"}\n` +
            `Ticket: ${result.ticket?.id || "N/A"}\n` +
            `Type: ${result.ticket?.ticketType || ticketType || "N/A"}\n` +
            `Priority: ${result.ticket?.priority || ticketPriority}\n` +
            `Summary: ${summary || "N/A"}`,
        });
      }

      if (flags.ticketCreated && safeEmail) {
        await safeSendEmail({
          to: safeEmail,
          subject: "Your GETPIE support ticket has been created",
          text:
            `Hi ${safeName || "there"},\n\n` +
            `We created a support ticket for you.\n` +
            `Ticket ID: ${result.ticket?.id || "N/A"}\n` +
            `Priority: ${result.ticket?.priority || ticketPriority}\n` +
            `Summary: ${summary || "N/A"}\n\n` +
            `We’ll contact you soon.\n\n` +
            `— GETPIE Support`,
        });
      }
    } catch (e) {}

    if (isSatisfied === true) result.note = "satisfied_no_ticket";
    return result;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/aborted|The user aborted a request/i.test(msg))
      return { error: "openai_timeout", message: msg };
    if (/unique constraint|duplicate key/i.test(msg))
      return { error: "db_conflict", message: msg };
    return { error: "summarizer_exception", message: msg };
  }
};
