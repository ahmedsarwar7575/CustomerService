// summarizer.js
import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import Agent from "../models/agent.js"; // NEW: agent model for assignment
import sequelize from "../config/db.js"; // ensure Op is exported from your db.js (or import from "sequelize")
import { Op } from "sequelize";
/**
 * Utility: safe email + phone validators / normalizers
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const normalizePhone = (p) => {
  if (!p) return null;
  const trimmed = String(p).trim();
  const keepPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D+/g, "");
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
};

// Normalize names lightly (title case; collapse whitespace)
const normalizeName = (n) => {
  if (!n || typeof n !== "string") return null;
  return n
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// ISO-ish real language whitelist (expand as needed)
const REAL_LANGS = new Set([
  "English",
  "Urdu",
  "Punjabi",
  "Hindi",
  "Arabic",
  "Bengali",
  "Chinese",
  "Mandarin",
  "Cantonese",
  "French",
  "German",
  "Spanish",
  "Portuguese",
  "Russian",
  "Turkish",
  "Italian",
  "Korean",
  "Japanese",
  "Malay",
  "Indonesian",
  "Tamil",
  "Telugu",
  "Gujarati",
  "Pashto",
  "Persian",
  "Farsi",
  "Dutch",
  "Greek",
  "Polish",
  "Romanian",
  "Czech",
  "Ukrainian",
  "Thai",
  "Vietnamese",
  "Filipino",
  "Tagalog",
  "Sindhi",
  "Saraiki",
  "Kashmiri",
  "Nepali",
  "Sinhala",
  "Marathi",
]);

export const summarizer = async (pairs, callSid, phone) => {
  try {
    // Basic guardrails
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return { error: "no_pairs" };
    }
    if (!callSid) {
      return { error: "missing_callSid" };
    }

    const system = [
      "You are an accurate, terse extractor for GETPIE customer support logs.",
      "English only. Output ONLY JSON, no extra words.",
      "If a value is unknown/unclear, set it to the string 'not specified'.",
      "Correct obvious misspellings; also include '*_raw' with the original when you normalize.",
      "Do not invent facts. Prefer 'not specified' over guessing.",
      "Validate email as something@something.tld (basic).",
      "Derive is_satisfied from the conversation (true/false) if explicit; else 'not specified'.",
      "Keep the summary <= 80 words.",
      // New fields for control flow:
      "Also output flags: has_meaningful_conversation (boolean), contact_info_only (boolean).",
      "contact_info_only = true if caller only gave contact details and no issue/request.",
      "Languages array must contain real world language names if any are detected; avoid random words.",
    ].join(" ");

    const userMsg = `
From these Q/A pairs, return ONLY this JSON:

{
  "customer": {
    "name": string | "not specified",
    "name_raw": string | "not specified",
    "email": string | "not specified"
  },
  "ticket": {
    "ticketType": "support" | "sales" | "billing" | "not specified",
    "status": "open" | "resolved",
    "priority": "low" | "medium" | "high" | "critical",
    "proposedSolution": string | "not specified",
    "isSatisfied": true | false | "not specified"
  },
  "qa_log": Array<{ "q": string, "a": string }>,
  "summary": string,
  "has_meaningful_conversation": boolean,
  "contact_info_only": boolean,
  "current_datetime_iso": "${new Date().toISOString()}",
  "timezone": "Asia/Karachi",
  "non_english_detected": string[],
  "clarifications_needed": string[],
  "mishears_or_typos": string[]
}

Q/A PAIRS:
${JSON.stringify(pairs, null, 2)}
`.trim();

    // Timeout safety
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 20_000);

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_output_tokens: 900,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: userMsg }] },
      ],
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      signal: ctrl.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(timeoutId);

    const raw = await r.text();
    if (!r.ok) {
      console.error("openai.responses error", raw);
      return { error: "openai", status: r.status, body: raw };
    }

    let outText = null;
    try {
      const data = JSON.parse(raw);
      outText =
        data.output_text ??
        data.output?.find?.((o) => o.type === "output_text")?.content?.[0]
          ?.text ??
        data.output?.[0]?.content?.[0]?.text ??
        null;
    } catch {
      outText = null;
    }
    if (!outText) {
      return { error: "openai_no_text", body: raw };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(outText);
    } catch {
      console.error("responses JSON parse error", outText);
      return { error: "parse", text: outText };
    }

    // Normalize parsed fields
    const ns = (v) => (v === "not specified" ? null : v);

    // Validate and normalize email
    const email = ns(parsed?.customer?.email);
    const safeEmail =
      email && EMAIL_RE.test(email) ? email.toLowerCase() : null;

    // Use phone ONLY from function param
    const safePhone = normalizePhone(phone);

    // Name (normalized, fallback to name_raw if needed)
    const rawName =
      ns(parsed?.customer?.name) || ns(parsed?.customer?.name_raw);
    const safeName = normalizeName(rawName);

    // Satisfaction
    const parsedIsSat = parsed?.ticket?.isSatisfied;
    const isSatisfied =
      parsedIsSat === true ? true : parsedIsSat === false ? false : null;

    // Ticket fields (we only use them if we decide to create a ticket)
    const ticketPriority = ["low", "medium", "high", "critical"].includes(
      parsed?.ticket?.priority
    )
      ? parsed.ticket.priority
      : "medium";
    const ticketType = ["support", "sales", "billing"].includes(
      parsed?.ticket?.ticketType
    )
      ? parsed.ticket.ticketType
      : null;
    const proposedSolution = ns(parsed?.ticket?.proposedSolution);

    // Conversation control flags
    const hasConversation = !!parsed?.has_meaningful_conversation;
    const contactInfoOnly = !!parsed?.contact_info_only;

    const qaLog = Array.isArray(parsed?.qa_log) ? parsed.qa_log : [];
    const summary = parsed?.summary || "";

    // Languages: keep only real ones
    const languages = parsed?.non_english_detected;

    // EARLY EXIT: greeting-only / no meaningful conversation → NO DB WRITES
    if (!hasConversation && !contactInfoOnly) {
      return { skipped: "no_conversation", extracted: { summary, qaLog } };
    }

    // Decide if we should create a ticket
    // Rules:
    // - If caller is satisfied => NO ticket
    // - If only contact info (name/email) and no issue => NO ticket
    // - Else create a ticket
    const shouldCreateTicket = isSatisfied === false && !contactInfoOnly;

    // Transactional write with all invariants
    const result = await sequelize.transaction(
      { isolationLevel: sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      async (t) => {
        // 1) Find or create user — prefer phone, then email
        let userRecord = null;

        if (safePhone) {
          userRecord = await User.findOne({
            where: { phone: safePhone },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
        }
        if (!userRecord && safeEmail) {
          userRecord = await User.findOne({
            where: { email: safeEmail },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
        }

        if (!userRecord) {
          // Create new user if we have at least phone OR email OR name
          userRecord = await User.create(
            {
              name: safeName || null,
              email: safeEmail,
              phone: safePhone,
              status: "active", // enforce active
            },
            { transaction: t }
          );
        } else {
          // Update existing user with better data, enforce active status
          const patch = {};
          if (safeName && userRecord.name !== safeName) patch.name = safeName;
          if (safeEmail && !userRecord.email) patch.email = safeEmail;
          if (safePhone && !userRecord.phone) patch.phone = safePhone;
          if (userRecord.status !== "active") patch.status = "active";
          if (Object.keys(patch).length) {
            await userRecord.update(patch, { transaction: t });
          }
        }

        // 2) Optionally create ticket
        let ticketRecord = null;
        let assignedAgentId = null;

        if (shouldCreateTicket) {
          // Find least-loaded active agent (by # of OPEN tickets)
          const activeAgents = await Agent.findAll({
            where: { status: "active" },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (activeAgents.length) {
            // counts per agentId
            const openCounts = await Ticket.findAll({
              attributes: [
                "agentId",
                [sequelize.fn("COUNT", sequelize.col("id")), "cnt"],
              ],
              where: { status: "open", agentId: { [Op.ne]: null } },
              group: ["agentId"],
              transaction: t,
              lock: t.LOCK.UPDATE,
            });

            const countMap = new Map(
              openCounts.map((r) => [String(r.agentId), Number(r.get("cnt"))])
            );
            // pick min
            let best = null;
            let bestCnt = Infinity;
            for (const a of activeAgents) {
              const cnt = countMap.get(String(a.id)) ?? 0;
              if (cnt < bestCnt) {
                best = a;
                bestCnt = cnt;
              }
            }
            assignedAgentId = best?.id ?? null;
          }

          ticketRecord = await Ticket.create(
            {
              status: "open",
              isSatisfied: false,
              priority: ticketPriority,
              proposedSolution: proposedSolution,
              ticketType: ticketType,
              summary: summary,
              userId: userRecord.id,
              agentId: assignedAgentId ?? null,
            },
            { transaction: t }
          );
        }

        // 3) Create/Update call (always inbound)
        // We try to update existing call row by callSid; if none updated, we create one.
        const callPatch = {
          userId: userRecord.id,
          ticketId: ticketRecord?.id ?? null,
          QuestionsAnswers: qaLog,
          isResolvedByAi: isSatisfied === true ? true : false,
          languages: languages,
          summary: summary,
          type: "inbound",
          phone: safePhone ?? null, // if your Call model has this column; if not, remove this line
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
          callRecord = await Call.findOne({
            where: { callSid },
            transaction: t,
          });
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
            contactInfoOnly,
          },
        };
      }
    );

    // If only contact info and no issue (no ticket), surface that fact
    if (!shouldCreateTicket && (contactInfoOnly || isSatisfied === true)) {
      result.note = contactInfoOnly
        ? "contact_info_only_user_created"
        : "satisfied_no_ticket";
    }

    return result;
  } catch (e) {
    // Classify common exceptions
    const msg = String(e?.message || e);
    if (/aborted|The user aborted a request/i.test(msg)) {
      return { error: "openai_timeout", message: msg };
    }
    if (/unique constraint|duplicate key/i.test(msg)) {
      return { error: "db_conflict", message: msg };
    }
    console.error("summarizer error", e);
    return { error: "summarizer_exception", message: msg };
  }
};
