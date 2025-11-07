// inbound/summery.js
import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import Agent from "../models/agent.js"; // YOUR schema (isActive, ticketType)
import sequelize from "../config/db.js";
import { Op } from "sequelize";

// ----------------- helpers -----------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const normalizePhone = (p) => {
  if (!p) return null;
  const s = String(p).trim();
  const keepPlus = s.startsWith("+");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
};

// small correction map for common name typos (expand as needed)
const NAME_FIXES = new Map([
  ["smath", "smith"],
  ["mchael", "michael"],
  ["jhon", "john"],
  ["alx", "alex"],
]);

const normalizeName = (n) => {
  if (!n || typeof n !== "string") return null;
  const trimmed = n.trim().replace(/\s+/g, " ");
  // try simple typo corrections per-token
  const fixed = trimmed
    .split(" ")
    .map((tok) => {
      const low = tok.toLowerCase();
      return NAME_FIXES.get(low) || tok;
    })
    .join(" ");
  // Title-case
  return fixed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

// whitelist of real languages
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
  "Farsi",
  "Persian",
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

const cleanLanguages = (arr) => {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const raw of arr) {
    if (!raw) continue;
    const cand = normalizeName(String(raw));
    if (REAL_LANGS.has(cand)) out.push(cand);
    else if (/^panjabi$/i.test(raw)) out.push("Punjabi");
    else if (/^mandarin chinese$/i.test(raw)) out.push("Mandarin");
    else if (/^farsi$/i.test(raw)) out.push("Farsi");
  }
  return Array.from(new Set(out)); // dedupe
};

// ----------------- lightweight mock extractor (no OpenAI) -----------------
function mockExtract(pairs) {
  const text = pairs.map((p) => `${p.q ?? ""} ${p.a ?? ""}`).join(" ");
  const lower = text.toLowerCase();

  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [
    null,
  ])[0];
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

  // languages
  const languages = [];
  if (/\b(assalam|wa[ -]?alaikum|ji haan|theek hai)\b/i.test(lower))
    languages.push("Urdu");

  // ticket type
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

  // proposed solution (take last agent suggestion)
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

  // short summary (first customer line)
  const customerLine = (
    pairs.find((p) => /customer/i.test(p.q || ""))?.a || ""
  ).slice(0, 160);
  const summary = customerLine || "not specified";

  return {
    customer: {
      name: name ? normalizeName(name) : "not specified",
      name_raw: name || "not specified",
      email: email || "not specified",
    },
    ticket: {
      ticketType: ticketType || "not specified",
      status: satisfied ? "resolved" : "open",
      priority: /critical|p1|high/.test(lower) ? "high" : "medium",
      proposedSolution,
      isSatisfied: satisfied ? true : unsatisfied ? false : "not specified",
    },
    qa_log: Array.isArray(pairs) ? pairs : [],
    summary,
    has_meaningful_conversation: !greetingsOnly,
    contact_info_only: contactInfoOnly,
    non_english_detected: languages,
    clarifications_needed: [],
    mishears_or_typos: [],
  };
}

// ----------------- main -----------------
export const summarizer = async (pairs, callSid, phone) => {
  try {
    if (!Array.isArray(pairs) || pairs.length === 0)
      return { error: "no_pairs" };
    if (!callSid) return { error: "missing_callSid" };

    // choose mock or OpenAI
    const useMock = String(process.env.SUMMARIZER_MOCK || "").trim() === "1";
    let parsed;

    if (useMock) {
      parsed = mockExtract(pairs);
    } else {
      // ----------------- OpenAI path -----------------
      const system = [
        "You are an accurate, terse extractor for GETPIE customer support logs.",
        "English only. Output ONLY JSON, no extra words.",
        "If a value is unknown/unclear, set it to the string 'not specified'.",
        "Correct obvious misspellings; also include '*_raw' with the original when you normalize.",
        "Do not invent facts. Prefer 'not specified' over guessing.",
        "Validate email as something@something.tld (basic).",
        "Derive is_satisfied from the conversation (true/false) if explicit; else 'not specified'.",
        "Keep the summary <= 80 words.",
        "Also output flags: has_meaningful_conversation (boolean), contact_info_only (boolean).",
        "Languages list must be real-world names (e.g., English, Urdu, Punjabi).",
      ].join(" ");

      const userMsg = `
From these Q/A pairs, return ONLY this JSON:

{
  "customer": { "name": string | "not specified", "name_raw": string | "not specified", "email": string | "not specified" },
  "ticket": { "ticketType": "support" | "sales" | "billing" | "not specified", "status": "open" | "resolved", "priority": "low" | "medium" | "high" | "critical", "proposedSolution": string | "not specified", "isSatisfied": true | false | "not specified" },
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

      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 20000);

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
      if (!r.ok) return { error: "openai", status: r.status, body: raw };

      let outText = null;
      try {
        const data = JSON.parse(raw);
        outText =
          data.output_text ??
          data.output?.find?.((o) => o.type === "output_text")?.content?.[0]
            ?.text ??
          data.output?.[0]?.content?.[0]?.text ??
          null;
      } catch {}
      if (!outText) return { error: "openai_no_text", body: raw };

      try {
        parsed = JSON.parse(outText);
      } catch {
        return { error: "parse", text: outText };
      }
    }

    // normalize/safe fields
    const ns = (v) => (v === "not specified" ? null : v);
    const safeEmail =
      ns(parsed?.customer?.email) && EMAIL_RE.test(parsed.customer.email)
        ? parsed.customer.email.toLowerCase()
        : null;
    const safePhone = normalizePhone(phone); // only from param
    const rawName =
      ns(parsed?.customer?.name) || ns(parsed?.customer?.name_raw);
    const safeName = normalizeName(rawName);

    const parsedIsSat = parsed?.ticket?.isSatisfied;
    const isSatisfied =
      parsedIsSat === true ? true : parsedIsSat === false ? false : null;

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

    const hasConversation = !!parsed?.has_meaningful_conversation;
    const contactInfoOnly = !!parsed?.contact_info_only;
    const qaLog = Array.isArray(parsed?.qa_log) ? parsed.qa_log : [];
    const summary = parsed?.summary || "";
    const languages = cleanLanguages(parsed?.non_english_detected);

    // Rule: greeting-only → NO DB writes
    if (!hasConversation && !contactInfoOnly) {
      return { skipped: "no_conversation", extracted: { summary, qaLog } };
    }

    // Rule: only name+email → ONLY make/ensure user; skip call/ticket entirely
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
          if (safeEmail && !userRecord.email) patch.email = safeEmail;
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

    // Should we create a ticket?
    const shouldCreateTicket = isSatisfied === false;

    // Transaction for user/ticket/call (call type always inbound)
    const result = await sequelize.transaction(async (t) => {
      // 1) user
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
        if (safeEmail && !userRecord.email) patch.email = safeEmail;
        if (safePhone && !userRecord.phone) patch.phone = safePhone;
        if (userRecord.status !== "active") patch.status = "active";
        if (Object.keys(patch).length)
          await userRecord.update(patch, { transaction: t });
      }

      // 2) ticket (optional) + assignment using your schema (isActive, ticketType)
      let ticketRecord = null;
      let assignedAgentId = null;

      if (shouldCreateTicket) {
        try {
          const hasIsActive = !!Agent?.rawAttributes?.isActive;
          const hasTicketType = !!Agent?.rawAttributes?.ticketType;

          const whereAgents = {};
          if (hasIsActive) whereAgents.isActive = true;
          if (hasTicketType && ticketType) {
            // prefer matching specialization, allow generalists (null)
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
              openCounts.map((r) => [String(r.agentId), Number(r.get("cnt"))])
            );
            let best = null,
              bestCnt = Infinity;
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

      // 3) Call (always inbound). If row exists (by callSid) update; else create.
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
      if (affected === 0)
        callRecord = await Call.create(
          { callSid, ...callPatch },
          { transaction: t }
        );
      else
        callRecord = await Call.findOne({ where: { callSid }, transaction: t });

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
