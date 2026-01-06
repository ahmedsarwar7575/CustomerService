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

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

const sendEmailFlexible = async ({ to, subject, html }) => {
  try {
    return await sendEmail({ to, subject, html });
    console.log("Email sent successfully");
  } catch (err) {
    console.error("Error sending email:", err);
  }

  return null;
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

const isBadEmail = (email) => {
  if (!email) return true;
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_STORE_RE.test(e)) return true;
  if (EXCLUDED_EMAILS.has(e)) return true;
  if (e.endsWith("@getpiepay.com")) return true;
  return false;
};

const normalizeConfirmedEmail = (email) => {
  if (!email) return null;
  let s = String(email).trim().toLowerCase();
  s = s.replace(/[<>()\[\]{},;:"'`]/g, " ");
  s = s.replace(/\s+/g, "");
  const at = s.indexOf("@");
  if (at <= 0) return null;

  let local = s.slice(0, at);
  let domain = s.slice(at + 1);

  const localParts = local.split("-").filter(Boolean);
  const localSingle = localParts.filter((p) => /^[a-z0-9]$/.test(p)).length;
  if (localParts.length >= 6 && localSingle / localParts.length >= 0.8) {
    local = localParts.join("");
  }

  const labels = domain.split(".");
  domain = labels
    .map((label) => {
      const parts = label.split("-").filter(Boolean);
      const single = parts.filter((p) => /^[a-z0-9]$/.test(p)).length;
      if (parts.length >= 4 && single / parts.length >= 0.8)
        return parts.join("");
      return label;
    })
    .join(".");

  const out = `${local}@${domain}`.replace(/[>.!?)]+$/g, "");
  return EMAIL_STORE_RE.test(out) ? out : null;
};

const shouldForceUnsatisfiedIfTicketFlow = (pairs) => {
  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ")
    .toLowerCase();

  return /\b(escalat\w*|open(?:ed|ing)?\s+(?:a\s+)?(?:\w+\s+){0,4}ticket|creat(?:e|ed|ing)\s+(?:a\s+)?(?:\w+\s+){0,4}ticket|log(?:ged|ging)?\s+(?:a\s+)?(?:\w+\s+){0,3}ticket|priority\s+ticket|case\s+number|follow\s*up|technician\s+(?:will|to)\s+(?:call|contact)|we(?:'ll| will)\s+(?:call|contact)\s+you)\b/i.test(
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
      else if (s.length <= 20 && !/[،,]/.test(s)) add(normalizeName(s));
    }
  }

  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ");
  if (ARABIC_SCRIPT_RE.test(text)) add("Urdu");

  return out;
};

const renderHtml = ({ title, rows = [], footer = "" }) => {
  const tableRows = rows
    .map(
      ([k, v]) => `
<tr>
  <td class="k" style="padding:10px 12px;border-bottom:1px solid #eef2f7;color:#64748b;font-weight:600;width:170px;
    background:#f8fafc;background-image:linear-gradient(#f8fafc,#f8fafc);">
    ${k}
  </td>
  <td class="v" style="padding:10px 12px;border-bottom:1px solid #eef2f7;color:#0f172a;
    background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
    ${v ?? ""}
  </td>
</tr>`
    )
    .join("");

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />

  <!-- declare support for both -->
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />

  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }

    /* Dark mode (Apple Mail / iOS Mail / some clients) */
    @media (prefers-color-scheme: dark) {
      .page { background:#0b1220 !important; background-image:linear-gradient(#0b1220,#0b1220) !important; }
      .card { background:#0f172a !important; background-image:linear-gradient(#0f172a,#0f172a) !important; }
      .table { border-color:#1f2937 !important; background:#0f172a !important; background-image:linear-gradient(#0f172a,#0f172a) !important; }
      .k {
        background:#111827 !important; background-image:linear-gradient(#111827,#111827) !important;
        color:#cbd5e1 !important; border-bottom-color:#1f2937 !important;
      }
      .v {
        background:#0f172a !important; background-image:linear-gradient(#0f172a,#0f172a) !important;
        color:#e5e7eb !important; border-bottom-color:#1f2937 !important;
      }
      .footer { color:#94a3b8 !important; }
      a { color:#93c5fd !important; }
    }

    /* Outlook web (best effort) */
    [data-ogsc] .page { background:#0b1220 !important; }
    [data-ogsc] .card { background:#0f172a !important; }
    [data-ogsc] .table { border-color:#1f2937 !important; background:#0f172a !important; }
    [data-ogsc] .k { background:#111827 !important; color:#cbd5e1 !important; border-bottom-color:#1f2937 !important; }
    [data-ogsc] .v { background:#0f172a !important; color:#e5e7eb !important; border-bottom-color:#1f2937 !important; }
    [data-ogsc] .footer { color:#94a3b8 !important; }
  </style>
</head>

<body style="margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div class="page" style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
    background:#f6f7fb;background-image:linear-gradient(#f6f7fb,#f6f7fb); padding:24px;">

    <div class="card" style="max-width:640px;margin:0 auto;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);
      border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,0.08);overflow:hidden;">

      <div style="padding:18px 20px;background:linear-gradient(135deg,#111827,#334155);color:#fff;">
        <div style="font-size:16px;letter-spacing:0.2px;opacity:0.9;">GETPIE</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${title}</div>
      </div>

      <div style="padding:18px 20px;">
        <table class="table" role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #eef2f7;
          border-radius:12px;overflow:hidden;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
          ${tableRows}
        </table>

        <div class="footer" style="margin-top:14px;color:#64748b;font-size:12px;line-height:1.5;">
          ${footer}
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`.trim();
};

const extractWithOpenAI = async (pairs, { timeoutMs = 60000 } = {}) => {
  const system = `
You are an extractor for GETPIE call logs.

Return ONLY JSON matching the schema (no markdown, no extra text).
If unknown/unclear, output the string "not specified". Do not guess.

CONFIRMATION RULE (HARD):
Only accept the user's name/email if the agent READS IT BACK and the user CONFIRMS with an explicit yes/correct/yeah/right.
If multiple confirmed values exist, take the LAST confirmed one.

EMAIL RULES (HARD):
Never output support@getpiepay.com or any *@getpiepay.com as the user's email.
Output a CLEAN normalized email like "ahmedsarwar7575@gmail.com" (no spaces, no extra words, no surrounding text).
If the agent readback contains hyphens between letters (a-h-m-e-d...), remove those hyphens in the output.

NAME RULES (HARD):
Only output a name if it is read back by the agent and the user confirms.
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
      max_output_tokens: 520,
      text: {
        format: {
          type: "json_schema",
          name: "getpie_extract_confirmed_ai_only",
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

    const cleanedEmail = normalizeConfirmedEmail(rawEmail);
    const safeEmail =
      cleanedEmail && !isBadEmail(cleanedEmail) ? cleanedEmail : null;

    const safeName = normalizeName(rawName);
    const safePhone = normalizePhone(phone);

    const forceUnsatisfied = shouldForceUnsatisfiedIfTicketFlow(pairs);

    const parsedIsSat = parsed?.ticket?.isSatisfied;
    let isSatisfied = null;
    if (parsedIsSat === true) isSatisfied = true;
    else if (parsedIsSat === false) isSatisfied = false;
    if (forceUnsatisfied) isSatisfied = false;

    const priority = String(
      ns(parsed?.ticket?.priority) || "medium"
    ).toLowerCase();
    const ticketPriority = ["low", "medium", "high", "critical"].includes(
      priority
    )
      ? priority
      : "medium";

    const type = String(ns(parsed?.ticket?.ticketType) || "").toLowerCase();
    const ticketType = ["support", "sales", "billing"].includes(type)
      ? type
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
        } catch {}

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
      const finalUserEmail = result?.user?.email || safeEmail || null;
      const finalUserName = result?.user?.name || safeName || "Customer";

      const events = [];
      if (flags.userCreated) events.push("New user created");
      if (flags.callCreated) events.push("New call created");
      if (flags.ticketCreated) events.push("New ticket created");

      if (events.length) {
        const html = renderHtml({
          title: `System Update`,
          rows: [
            ["Events", events.join(" + ")],
            ["CallSid", callSid],
            ["User", `${result.user?.id || "N/A"} — ${finalUserName || "N/A"}`],
            ["Email", finalUserEmail || "N/A"],
            ["Phone", safePhone || "N/A"],
            ["Ticket", result.ticket?.id || "N/A"],
            ["Type", result.ticket?.ticketType || ticketType || "N/A"],
            ["Priority", result.ticket?.priority || ticketPriority],
            ["Summary", summary || "N/A"],
          ],
          footer: "This is an automated notification from GETPIE.",
        });

        await sendEmail(ADMIN_EMAIL, `GETPIE: ${events.join(" + ")}`, html);
      }

      if (
        flags.ticketCreated &&
        finalUserEmail &&
        !isBadEmail(finalUserEmail)
      ) {
        const html = renderHtml({
          title: `Your support ticket is created`,
          rows: [
            ["Ticket ID", result.ticket?.id || "N/A"],
            ["Priority", result.ticket?.priority || ticketPriority],
            ["Category", result.ticket?.ticketType || ticketType || "support"],
            ["Summary", summary || "N/A"],
          ],
          footer:
            "If you reply to this email, our team will follow up as soon as possible.",
        });

        await sendEmail(
          finalUserEmail,
          "Your GETPIE support ticket has been created",
          html
        );
      }
    } catch {}

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
