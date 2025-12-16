import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import sequelize from "../config/db.js";
import { Op } from "sequelize";
import sendEmail from "../utils/Email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const EMAIL_FIND_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const YES_RE =
  /\b(yes|yeah|yep|yup|correct|that's right|that is right|right|sure|ok(?:ay)?|affirmative|exactly)\b/i;

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

const cleanLanguages = (arr) => {
  if (!Array.isArray(arr)) return [];
  return Array.from(
    new Set(
      arr.map((v) => (v == null ? "" : String(v).trim())).filter((v) => v)
    )
  );
};

/**
 * Sometimes transcription is wrong. Only trust an email if it is CONFIRMED.
 * Rules:
 * 1) If agent reads back an email and the user confirms (yes/correct), trust that email.
 * 2) Else, if user says an email and agent repeats the SAME email (or clearly acknowledges it), trust it.
 * 3) Else, return null (=> "not specified").
 */
const extractConfirmedEmail = (pairs) => {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  const getEmails = (s) =>
    (String(s || "").match(EMAIL_FIND_RE) || []).slice(0);

  let lastConfirmed = null;

  // 1) Agent read-back -> user confirms
  for (let i = 0; i < pairs.length; i++) {
    const a = String(pairs[i]?.a || "");
    const aEmails = getEmails(a);
    if (!aEmails.length) continue;

    // "we have your email as X", "is your email X", etc.
    const looksLikeReadBack = /\b(email|e-mail)\b/i.test(a);

    if (!looksLikeReadBack) continue;

    const nextQ1 = String(pairs[i + 1]?.q || "");
    const nextQ2 = String(pairs[i + 2]?.q || "");

    const userConfirmed =
      YES_RE.test(nextQ1.toLowerCase()) || YES_RE.test(nextQ2.toLowerCase());

    if (userConfirmed) {
      lastConfirmed = aEmails[aEmails.length - 1];
    }
  }

  if (lastConfirmed && EMAIL_RE.test(lastConfirmed)) return lastConfirmed;

  // 2) User provides email -> agent repeats/acknowledges same email
  for (let i = 0; i < pairs.length; i++) {
    const q = String(pairs[i]?.q || "");
    const qEmails = getEmails(q);
    if (!qEmails.length) continue;

    const userEmail = qEmails[qEmails.length - 1];
    if (!EMAIL_RE.test(userEmail)) continue;

    const a = String(pairs[i]?.a || "");
    const aEmails = getEmails(a);
    const agentRepeatedSame = aEmails.some(
      (e) => e.toLowerCase() === userEmail.toLowerCase()
    );

    const agentAcknowledged =
      /\b(got it|ok(?:ay)?|confirmed|thanks|thank you|perfect|great)\b/i.test(
        a
      );

    if (agentRepeatedSame || agentAcknowledged) {
      // Still require at least some sign of agreement (agent repeated OR acknowledged)
      return userEmail;
    }
  }

  return null;
};

const shouldForceUnsatisfiedIfTicketFlow = (pairs) => {
  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ")
    .toLowerCase();

  // conservative: only when it really sounds like escalation/ticket creation/follow-up
  return /\b(escalat|open(?:ed)?\s+(a\s+)?ticket|create(?:d)?\s+(a\s+)?ticket|log(?:ged)?\s+(a\s+)?ticket|technician\s+(will|to)\s+(call|contact)|we('?ll| will)\s+(call|contact)\s+you|follow\s*up\s+(with\s+you)?|case\s+number)\b/i.test(
    text
  );
};

function mockExtract(pairs) {
  const text = pairs.map((p) => `${p.q ?? ""} ${p.a ?? ""}`).join(" ");
  const lower = text.toLowerCase();

  // Prefer confirmed email if possible (transcription can be wrong)
  const confirmedEmail = extractConfirmedEmail(pairs);

  // Fallback: last email mentioned anywhere (least reliable; used only if confirmed not found)
  const emailMatches = text.match(EMAIL_FIND_RE) || [];
  const email =
    confirmedEmail ||
    (emailMatches.length ? emailMatches[emailMatches.length - 1] : null);

  const nameMatch = text.match(
    /\b(?:my name is|it's|i am)\s+([A-Za-z][A-Za-z\s'-]{1,40})/i
  );
  const name = nameMatch
    ? nameMatch[1]
    : (text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/) || [null])[0];

  const satisfied =
    /(i'?m\s+satisfied|this solves it|works now|resolved)/i.test(lower);
  const unsatisfied =
    /(not satisfied|not happy|still failing|doesn'?t work|not resolved)/i.test(
      lower
    );

  const contactInfoOnly =
    /\b(register (my )?details|no issue( right)? now|only (my )?(name|email)|just (my )?details)\b/i.test(
      lower
    );

  const hasIssueKeyword =
    /\binvoice|payment|charge|refund|login|reset|error|ticket|order|shipment|crash|declined|fail|lost|track/i.test(
      lower
    );
  const greetingsOnly =
    !contactInfoOnly &&
    !satisfied &&
    !unsatisfied &&
    !hasIssueKeyword &&
    /\b(hello|hi|salam|assalam|testing the line|bye)\b/i.test(lower);

  const languages = [];
  if (/\b(assalam|wa[ -]?alaikum|ji haan|theek hai)\b/i.test(lower))
    languages.push("Urdu");

  let ticketType = null;
  if (/\b(invoice|billing|charge|refund|card|declined|payment)\b/i.test(lower))
    ticketType = "billing";
  else if (/\b(pricing|buy|purchase|quote|plan)\b/i.test(lower))
    ticketType = "sales";
  else if (
    /\b(login|reset|error|bug|crash|shipping|order|shipment|track|lost)\b/i.test(
      lower
    )
  )
    ticketType = "support";

  const agentHints = pairs
    .filter((p) => /agent/i.test(p.q || ""))
    .map((p) => p.a || "");
  const proposedSolution =
    agentHints
      .reverse()
      .find((s) =>
        /\b(try|sent|do|please|clear|different browser|we will|we'll|opened a case)\b/i.test(
          s
        )
      ) || "not specified";

  const customerLine = (
    pairs.find((p) => /customer/i.test(p.q || ""))?.a || ""
  ).slice(0, 160);
  const summary = customerLine || "not specified";

  // Business rule: if ticket/escalation flow, treat as not satisfied
  const forceUnsatisfied = shouldForceUnsatisfiedIfTicketFlow(pairs);

  return {
    customer: {
      name: name ? normalizeName(name) : "not specified",
      name_raw: name || "not specified",
      email: email || "not specified",
    },
    ticket: {
      ticketType: ticketType || "not specified",
      status: satisfied && !forceUnsatisfied ? "resolved" : "open",
      priority: /critical|p1|high/.test(lower) ? "high" : "medium",
      proposedSolution,
      isSatisfied: forceUnsatisfied
        ? false
        : satisfied
        ? true
        : unsatisfied
        ? false
        : "not specified",
    },
    summary,
    has_meaningful_conversation: !greetingsOnly,
    contact_info_only: contactInfoOnly,
    non_english_detected: languages,
    clarifications_needed: [],
    mishears_or_typos: [],
  };
}

const extractWithOpenAI = async (pairs, { timeoutMs = 60000 } = {}) => {
  const system = [
    "You are an accurate, terse extractor for GETPIE customer support call logs.",
    "English only. Output ONLY JSON matching the provided JSON Schema.",
    "If unknown/unclear, set the value to the string 'not specified'. Do not invent facts.",
    "Transcription can be wrong. Prefer facts that are explicitly CONFIRMED in the call.",
    "Email rule (important):",
    "- The transcript may mis-spell an email when the user first says it.",
    "- If the agent reads an email back and the user confirms (yes/correct), that confirmed email is the truth.",
    "- If the user changes email, only use the new email if it is confirmed at the end.",
    "- If there is ANY doubt which email is correct, set customer.email = 'not specified'.",
    "Satisfaction rule (important):",
    "- If agent/customer agree to create/escalate/open a ticket or schedule technician follow-up, set ticket.isSatisfied = false.",
    "- Only set ticket.isSatisfied = true if the customer explicitly says solved/resolved/works and no escalation/ticket flow is happening.",
    "Keep summary <= 80 words.",
  ].join(" ");

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
        required: ["name", "name_raw", "email"],
        properties: {
          name: { type: "string" },
          name_raw: { type: "string" },
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

Return JSON ONLY (no markdown, no extra text).

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
      temperature: 0.2,
      max_output_tokens: 450,
      // Structured Outputs (strict schema)
      text: {
        format: {
          type: "json_schema",
          name: "getpie_ticket_extract",
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

  // IMPORTANT: handle incomplete generations (prevents parsing cut-off JSON)
  if (data?.status && data.status !== "completed") {
    return {
      error: "openai_incomplete",
      status: data.status,
      incomplete_details: data.incomplete_details,
      body: raw,
    };
  }

  let outText = null;
  if (typeof data.output_text === "string") {
    outText = data.output_text;
  } else if (Array.isArray(data.output)) {
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

    const useMock = String(process.env.SUMMARIZER_MOCK || "").trim() === "1";
    let parsed;

    if (useMock) {
      parsed = mockExtract(pairs);
    } else {
      // Try once, then one retry with a bit more output room (still small output)
      parsed = await extractWithOpenAI(pairs, { timeoutMs: 60000 });

      if (parsed?.error) {
        const retry = await extractWithOpenAI(pairs, { timeoutMs: 60000 });
        if (!retry?.error) parsed = retry;
      }

      if (parsed?.error) {
        // Keep behavior: return the error object (DB logic unchanged)
        return parsed;
      }
    }

    const ns = (v) => {
      if (v == null) return null;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      if (!trimmed) return null;
      return trimmed.toLowerCase() === "not specified" ? null : trimmed;
    };

    // ✅ transcription-safe email: prefer confirmed email from pairs over model output
    const confirmedEmail = extractConfirmedEmail(pairs);
    const rawEmail = ns(confirmedEmail || parsed?.customer?.email);
    const safeEmail =
      typeof rawEmail === "string" && EMAIL_RE.test(rawEmail)
        ? rawEmail.toLowerCase()
        : null;

    const safePhone = normalizePhone(phone);

    const rawName =
      ns(parsed?.customer?.name) || ns(parsed?.customer?.name_raw);
    const safeName = normalizeName(rawName);

    // Business rule safety: if ticket/escalation flow happened, force unsatisfied
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

    // ✅ Do NOT ask the model to echo logs; store original pairs
    const qaLog = Array.isArray(pairs) ? pairs : [];

    const summary = typeof parsed?.summary === "string" ? parsed.summary : "";
    const languages = cleanLanguages(parsed?.non_english_detected);

    if (!hasConversation && !contactInfoOnly) {
      return { skipped: "no_conversation", extracted: { summary, qaLog } };
    }

    // CONTACT INFO ONLY FLOW
    if (contactInfoOnly) {
      const userResult = await sequelize.transaction(async (t) => {
        let userRecord = null;
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
        } else {
          const patch = {};
          if (safeName && userRecord.name !== safeName) patch.name = safeName;
          // update email if final confirmed email was extracted
          if (safeEmail && userRecord.email !== safeEmail)
            patch.email = safeEmail;
          if (safePhone && !userRecord.phone) patch.phone = safePhone;
          if (userRecord.status !== "active") patch.status = "active";
          if (Object.keys(patch).length)
            await userRecord.update(patch, { transaction: t });
        }

        return { user: userRecord };
      });

      return {
        ...userResult,
        note: "contact_info_only_user_created",
        extracted: {
          name: safeName,
          email: safeEmail,
          phone: safePhone,
          summary,
          languages,
          qa_log: qaLog,
        },
      };
    }

    const shouldCreateTicket = isSatisfied === false;

    const result = await sequelize.transaction(async (t) => {
      let userRecord = null;
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
        } catch (e) {
          console.warn("Agent assignment skipped:", e?.message);
        }

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
      if (affected === 0) {
        callRecord = await Call.create(
          { callSid, ...callPatch },
          { transaction: t }
        );
      } else {
        callRecord = await Call.findOne({ where: { callSid }, transaction: t });
      }

      return {
        user: userRecord,
        ticket: ticketRecord,
        call: callRecord,
        agentId: assignedAgentId,
        extracted: {
          name: safeName,
          email: safeEmail,
          phone: safePhone,
          qa_log: qaLog,
          summary,
          languages,
          isSatisfied,
          hasConversation,
          contactInfoOnly: false,
        },
      };
    });

    if (isSatisfied === true) result.note = "satisfied_no_ticket";
    return result;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/aborted|The user aborted a request/i.test(msg))
      return { error: "openai_timeout", message: msg };
    if (/unique constraint|duplicate key/i.test(msg))
      return { error: "db_conflict", message: msg };
    console.error("summarizer error", e);
    return { error: "summarizer_exception", message: msg };
  }
};
