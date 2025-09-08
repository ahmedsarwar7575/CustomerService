import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import sequelize from "../config/db.js";

export const summarizer = async (pairs, callSid) => {
  try {
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return { error: "no_pairs" };
    }

    const system = [
      "You are an accurate, terse extractor for GETPIE customer support logs.",
      "English only. Output ONLY JSON, no extra words.",
      "If a value is unknown/unclear, set it to the string 'not specified'.",
      "Correct obvious misspellings; also include '*_raw' with the original when you normalize.",
      "Do not invent facts. Prefer 'not specified' over guessing.",
      "Validate email as something@something.tld (basic). Normalize phone to digits only (keep leading + if present).",
      "Classify ticket_type as one of: 'support' | 'sales' | 'billing'. If unclear, ask in clarifications_needed and set 'not specified'.",
      "Derive is_satisfied from the conversation (true/false) if explicit; else 'not specified'.",
      "Keep the summary <= 80 words.",
    ].join(" ");

    const user = `
  From these Q/A pairs, return ONLY this JSON:
  
  {
    "customer": {
      "name": string | "not specified",
      "email": string | "not specified",
      "phone": string | "not specified"
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
      temperature: 0.4,
      max_output_tokens: 1200,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
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

    let parsed = null;
    try {
      parsed = JSON.parse(outText || "{}");
    } catch {
      console.error("responses JSON parse error", outText);
      return { error: "parse", text: outText };
    }

    const ns = (v) => (v === "not specified" ? null : v);

    const safe = {
      customer: {
        name: ns(parsed?.customer?.name),
        email: ns(parsed?.customer?.email),
        phone: ns(parsed?.customer?.phone),
      },
      ticket: {
        status: parsed?.ticket?.status === "resolved" ? "resolved" : "open",
        priority: ["low", "medium", "high", "critical"].includes(
          parsed?.ticket?.priority
        )
          ? parsed.ticket.priority
          : "medium",
        ticketType: ["support", "sales", "billing"].includes(
          parsed?.ticket?.ticketType
        )
          ? parsed.ticket.ticketType
          : null,
        proposedSolution: ns(parsed?.ticket?.proposedSolution),
        isSatisfied:
          parsed?.ticket?.isSatisfied === true
            ? true
            : parsed?.ticket?.isSatisfied === false
            ? false
            : null,
      },
      qa_log: Array.isArray(parsed?.qa_log) ? parsed.qa_log : [],
      summary: parsed?.summary || "",
      non_english_detected: Array.isArray(parsed?.non_english_detected)
        ? parsed.non_english_detected
        : [],
    };

    const result = await sequelize.transaction(async (t) => {
      let userRecord = null;
      if (safe.customer.email) {
        userRecord = await User.findOne({
          where: { email: safe.customer.email },
          transaction: t,
        });
      }
      if (!userRecord && safe.customer.phone) {
        userRecord = await User.findOne({
          where: { phone: safe.customer.phone },
          transaction: t,
        });
      }
      if (!userRecord) {
        userRecord = await User.create(
          {
            name: safe.customer.name,
            email: safe.customer.email,
            phone: safe.customer.phone,
          },
          { transaction: t }
        );
      }
      const ticket = await Ticket.create(
        {
          status: safe.ticket.status,
          isSatisfied: safe.ticket.isSatisfied,
          priority: safe.ticket.priority,
          proposedSolution: safe.ticket.proposedSolution,
          ticketType: safe.ticket.ticketType,
          summary: safe.summary,
          userId: userRecord.id,
        },
        { transaction: t }
      );
      const call = await Call.create(
        {
          userId: userRecord.id,
          ticketId: ticket.id,
          QuestionsAnswers: safe.qa_log,
          isResolvedByAi: safe.ticket.isSatisfied,
          languages: safe.non_english_detected,
          summary: safe.summary,
          callSid: callSid
        },
        { transaction: t }
      );
      return { user: userRecord, ticket, call, extracted: safe };
    });

    console.log("db.write ok", {
      userId: result.user.id,
      ticketId: result.ticket.id,
      callId: result.call.id,
    });
    return result;
  } catch (e) {
    console.error("summarizer error", e);
    return { error: "summarizer_exception", message: String(e) };
  }
};
