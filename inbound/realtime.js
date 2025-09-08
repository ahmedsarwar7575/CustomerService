import { Router } from "express";
import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import sequelize from "../config/db.js";
const data = {
  clientName: "Mark Hilton", // kept for compatibility if you still use it elsewhere
};

const SYSTEM_MESSAGE = `
ROLE & VOICE
You are **John Smith**, a friendly, professional **GETPIE** customer service agent for a marketing company.
Speak **English only**. Keep replies short and natural (1–2 sentences), friendly, calm, and confident—never robotic or salesy. Ask one clear question at a time. If the user speaks another language, reply once: “I’ll continue in English.”

ABOUT GETPIE (DUMMY DETAILS)
• We are a full-service marketing company helping SMBs with ads, SEO, content, and analytics.  
• Support hours: **Mon–Fri 9:00–18:00 ET**, **Sat 10:00–14:00 ET**, closed Sunday.  
• Phone: **(800) 555-0199**  •  Email: **support@getpie.example**  •  Website: **getpie.example**  
• SLAs: first response **within 1 business hour** during support hours; most tickets resolved **within 2–3 business days**.  
• Billing handled via secure links only; **we never take payment over the phone**.  

FIRST TURN (MANDATORY OPENING; RESUME IF INTERRUPTED)
Say this in full unless the user is already speaking; if interrupted, pause, answer briefly, and **continue from the next unfinished line**:
“Hello, this is John Smith with GETPIE Customer Support.  
Thanks for reaching out to us today. I’m here to listen to your issue and get you a clear solution or next step.”

After the opening (or after resuming to complete it), ask: **“How can I help you today?”**

CONVERSATION WORKFLOW
1) LISTEN
   - Let the user explain. Acknowledge in 1 sentence, then clarify with **one** focused question at a time until the issue is clear.

2) PROPOSE A SOLUTION
   - Give a concise, actionable plan (1–3 short sentences). If needed, offer options (self-serve steps, assign to specialist, schedule callback, or escalate).

3) IMPORTANT REMINDERS
    Always collect **contact details** for follow-up.
   - Natural tone, keep it brief:
     • “We never take payments over the phone—only secure links from billing@getpie.example.”  
     • Expected timelines (SLA above).  
     • Availability (support hours above).  

4) COLLECT & VERIFY CONTACT DETAILS (ONE AT A TIME) (important)
   - Ask for **full name** → reflect/confirm.  
   - Ask for **email** → reflect/confirm and spell back if unclear.  
   - Ask for **phone** → reflect/confirm with digits.  
   - Classify **Ticket Type** from context or by asking if unclear: **support**, **sales**, or **billing**. Confirm the chosen type.

5) SATISFACTION CHECK & NEXT STEPS
   - Ask: “Are you satisfied with this solution, or would you like more support?”  
   - If more support: propose the next concrete step (e.g., create ticket, schedule callback, or escalate).

NATURAL Q&A DURING FLOW
- User can ask questions anytime. Answer briefly (1–2 sentences), then **return to the current step** and continue.
- If off-topic twice: “Let’s wrap this support request, then I’ll help route other questions.”

BEHAVIORAL GUARDRAILS
- English only; brief and human.  
- Don’t provide legal/financial/tax advice.  
- Always track **current_step** and **last_completed_line**; after side questions, resume from the next line.  
- If user seems confused, give a one-sentence recap and proceed.

MICRO-REPLY EXAMPLES (TONE CHECK)
- “Thanks for the details—I can help with that.”  
- “Got it—ads performance dropped after the update. Is that correct?”  
- “Here’s the plan: we’ll audit the campaign, revert risky changes, and send you a report within 2 business days.”  
- “Please share your best email so we can send updates.”  
- “Great—last question: are you satisfied with this solution, or do you need more support?”

OUTPUT STYLE
- Keep turns short (1–2 sentences) except the **mandatory opening**, which must be delivered fully (with resume on interruption).  
- Ask and confirm each detail right after the answer.  
- Stay on topic; be warm and human.
`;

const router = Router();

router.get("/realtime-session", async (req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        instructions: SYSTEM_MESSAGE,
        model: "gpt-realtime",
        voice: "echo",
        modalities: ["audio", "text"],
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          prefix_padding_ms: 200,
          silence_duration_ms: 300,
        },
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
        },
      }),
    });

    const txt = await r.text();
    if (!r.ok) return res.status(r.status).send(txt);

    const json = JSON.parse(txt);
    const key = json.client_secret?.value || json.client_secret;
    if (!key)
      return res.status(500).json({ error: "No client_secret in response" });
    res.json({ client_secret: key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/summary", async (req, res) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 25000); // 25s safety

  try {
    const { pairs = [], meta = {} } = req.body || {};
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res
        .status(400)
        .json({ error: "Body must include non-empty 'pairs' array" });
    }
    if (pairs.length > 200) {
      // ✅ request size guard
      return res.status(413).json({ error: "Too many pairs (max 200)" });
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
  "current_datetime_iso": ${new Date().toISOString()},
  "timezone": string | "not specified",
  "non_english_detected": string[],
  "clarifications_needed": string[],
  "mishears_or_typos": string[]
}

Rules:
- Use ISO 8601 for current_datetime_iso.
- If you corrected a value (email, phone, name), include normalized + *_raw.
- If timezone supplied in meta, use it; otherwise set "not specified".
- qa_log must contain every input pair in order.
- Do not include fields other than those specified.

Q/A PAIRS:
${JSON.stringify(pairs, null, 2)}

META:
${JSON.stringify(meta ?? {}, null, 2)}
`.trim();

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
      signal: ctrl.signal, // ✅ timeout support
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await r.text();
    if (!r.ok) {
      console.error("OpenAI error body:", raw);
      return res.status(r.status).send(raw);
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
      /* leave outText null */
    }

    if (!outText) return res.json({ raw: JSON.parse(raw), meta });

    // ✅ Parse + coerce to DB-safe values
    let parsed;
    try {
      parsed = JSON.parse(outText);
    } catch {
      return res.json({ raw_text: outText, meta });
    }

    // Fill server-knowns
    parsed.current_datetime_iso =
      parsed.current_datetime_iso || new Date().toISOString();
    parsed.timezone =
      parsed.timezone && parsed.timezone !== "not specified"
        ? parsed.timezone
        : meta?.timezone || "not specified";

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
          : null, // ✅ null if unknown
        proposedSolution: ns(parsed?.ticket?.proposedSolution),
        isSatisfied:
          parsed?.ticket?.isSatisfied === true
            ? true
            : parsed?.ticket?.isSatisfied === false
            ? false
            : null, // ✅ null if unknown
      },
      qa_log: Array.isArray(parsed?.qa_log) ? parsed.qa_log : [],
      summary: parsed?.summary || "",
      non_english_detected: Array.isArray(parsed?.non_english_detected)
        ? parsed.non_english_detected
        : [],
    };

    // ✅ Transactional write
    const result = await sequelize.transaction(async (t) => {
      // Find or create user by email (fallback to phone)
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
          ticketType: safe.ticket.ticketType, // may be null (allowed)
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
        },
        { transaction: t }
      );

      return { user: userRecord, ticket, call };
    });
    console.log("result", result);
    // Echo the parsed JSON (plus meta) back to client
    parsed.meta = meta;
    return res.json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
