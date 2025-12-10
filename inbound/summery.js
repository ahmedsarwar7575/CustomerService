import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import sequelize from "../config/db.js";
import { Op } from "sequelize";
import sendEmail from "../utils/Email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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

function mockExtract(pairs) {
  const text = pairs.map((p) => `${p.q ?? ""} ${p.a ?? ""}`).join(" ");
  const lower = text.toLowerCase();

  // ★ Prefer the LAST email in the conversation, since that is most likely the final agreed one
  const emailMatches =
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const email = emailMatches.length
    ? emailMatches[emailMatches.length - 1]
    : null;

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
      const system = [
        "You are an accurate, terse extractor for GETPIE customer support logs.",
        "English only. Output ONLY JSON, no extra words.",
        "If a value is unknown/unclear, set it to the string 'not specified'.",
        "Correct obvious misspellings; also include '*_raw' with the original when you normalize.",
        "Normalize and fix customer name and language names when possible.",
        "Do not invent facts. Prefer 'not specified' over guessing.",
        "Validate email as something@something.tld (basic).",
        // ★ EMAIL RULES:
        "If the conversation mentions multiple email addresses, always choose the ONE FINAL email address that both the agent and customer agree is correct at the end of the call.",
        "If the agent reads an email from the system (like an old email) and the customer says it is correct, that is the final email.",
        "If the customer corrects the email or gives a new email and they confirm it, use the NEW email and ignore the old one.",
        "If there is no clear final agreed email, set customer.email to 'not specified'.",
        "Derive is_satisfied from the conversation (true/false) if explicit; else 'not specified'.",
        "Keep the summary <= 80 words.",
        "Also output flags: has_meaningful_conversation (boolean), contact_info_only (boolean).",
        "Languages list must be real-world names (e.g., English, Urdu, Punjabi).",
      ].join(" ");

      const userMsg = `
From these Q/A pairs, return ONLY this JSON:
BRO if our agent said that i will escalate ticket then isSatisfied will be always false means if context is user and agent aggreed on creating ticket then isSatisfied will be false.
BRO about email: conversation can include an old email already on file and a new email if the user changes it. Always set "customer.email" to the FINAL email address that both the agent and the user confirm as correct at the end of the call. If the user keeps the existing email, use that one. If the user changes the email and confirms the new one, use the NEW email and ignore the old one. If there is any doubt which email is correct, set "customer.email" to "not specified".

{
  "customer": { "name": string | "not specified", "name_raw": string | "not specified", "email": string | "not specified" },
  "ticket": { "ticketType"(Always return tikcet type): "support" | "sales" | "billing"  | "not specified", "status": "open" | "resolved", "priority": "low" | "medium" | "high" | "critical", "proposedSolution": string | "not specified", "isSatisfied": true | false | "not specified" },
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
      const timeoutId = setTimeout(() => ctrl.abort(), 60000);

      let r;
      let raw;
      try {
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
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }

      clearTimeout(timeoutId);

      if (!r.ok) return { error: "openai", status: r.status, body: raw };

      let outText = null;
      try {
        const data = JSON.parse(raw);
        if (typeof data.output_text === "string") {
          outText = data.output_text;
        } else if (Array.isArray(data.output)) {
          const msgItem = data.output.find((item) => item.type === "message");
          const contentText = msgItem?.content?.find?.(
            (c) => c.type === "output_text"
          )?.text;
          if (typeof contentText === "string") outText = contentText;
        }
      } catch (err) {}

      if (!outText) return { error: "openai_no_text", body: raw };

      try {
        parsed = JSON.parse(outText);
      } catch {
        return { error: "parse", text: outText };
      }
    }

    const ns = (v) => {
      if (v == null) return null;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      if (!trimmed) return null;
      return trimmed.toLowerCase() === "not specified" ? null : trimmed;
    };

    const rawEmail = ns(parsed?.customer?.email);
    const safeEmail =
      typeof rawEmail === "string" && EMAIL_RE.test(rawEmail)
        ? rawEmail.toLowerCase()
        : null;

    const safePhone = normalizePhone(phone);

    const rawName =
      ns(parsed?.customer?.name) || ns(parsed?.customer?.name_raw);
    const safeName = normalizeName(rawName);

    const parsedIsSat = parsed?.ticket?.isSatisfied;
    let isSatisfied = null;
    if (parsedIsSat === true) isSatisfied = true;
    else if (parsedIsSat === false) isSatisfied = false;

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
    const qaLog = Array.isArray(parsed?.qa_log) ? parsed.qa_log : [];
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
          // ★ If user and agent agreed on a final email, update it even if one already exists
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
        // ★ Same here: update email if a new final confirmed email was extracted
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
