// summarizeUpsellLite.js
import dotenv from "dotenv";
dotenv.config();

/**
 * Produces a compact summary from qaPairs.
 * - No DB writes
 * - Console.logs key outcomes
 * - 20s timeout, robust JSON extraction
 */
export async function summarizeUpsellLite(qaPairs) {
  try {
    if (!Array.isArray(qaPairs) || qaPairs.length === 0) {
      return { error: "no_pairs" };
    }

    // Keep only a tiny QA sample (first + last exchange)
    const qaFirst = qaPairs.find(p => (p?.q || p?.a));
    const qaLast = [...qaPairs].reverse().find(p => (p?.q || p?.a));
    const qa_sample = [qaFirst, qaLast].filter(Boolean).slice(0, 2);

    const nowIso = new Date().toISOString();

    const system = [
      "You are an accurate, terse extractor for a payments company's upsell calls.",
      "English only. Output ONLY JSON (json_object). No extra text.",
      "If a field is unknown/unclear, use the string 'not specified'.",
      "Do not invent facts.",
      "Keep 'summary' ≤ 80 words.",
      "If multiple goals are present, set recommended_option='multiple'."
    ].join(" ");

    const user = `
Return ONLY this JSON with minimal fields:

{
  "goals": {
    "increase_sales": boolean | "not specified",
    "online_presence": boolean | "not specified",
    "cash_flow_or_capital": boolean | "not specified"
  },
  "recommended_option": "website" | "loan" | "advertising" | "multiple" | "not specified",
  "rationale": string | "not specified",
  "next_step": "demo" | "email_summary" | "follow_up_call" | "not specified",
  "consent_to_contact": {
    "ok_to_email": boolean | "not specified",
    "ok_to_call": boolean | "not specified",
    "demo_scheduled": boolean | "not specified"
  },
  "summary": string,
  "off_topic_attempts": string[],
  "safety_flags": string[],
  "non_english_detected": string[],
  "current_datetime_iso": "${nowIso}",
  "timezone": "Asia/Karachi"
}

SOURCE_QA_PAIRS (for reference only):
${JSON.stringify(qaPairs, null, 2)}
`.trim();

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 20000);

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_output_tokens: 700,
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

    const rawText = await r.text();
    if (!r.ok) {
      console.error("[SUMMARY:LITE] openai.responses error", rawText);
      return { error: "openai", detail: { status: r.status, body: rawText } };
    }

    // Extract the model's output_text safely
    let outText = null;
    try {
      const data = JSON.parse(rawText);
      outText =
        data.output_text ??
        data.output?.find?.((o) => o.type === "output_text")?.content?.[0]?.text ??
        data.output?.[0]?.content?.[0]?.text ??
        null;
    } catch {
      outText = null;
    }

    if (!outText) {
      console.error("[SUMMARY:LITE] no output_text", rawText);
      return { error: "no_output_text" };
    }

    let parsed;
    try {
      parsed = JSON.parse(outText);
    } catch {
      console.error("[SUMMARY:LITE] JSON parse error", outText);
      return { error: "parse_error", detail: outText };
    }

    // Normalize & keep it minimal
    const boolOrNull = (v) => (v === true ? true : v === false ? false : null);
    const ns = (v) => (v === "not specified" ? null : v);

    const extracted = {
      goals: {
        increase_sales: boolOrNull(parsed?.goals?.increase_sales),
        online_presence: boolOrNull(parsed?.goals?.online_presence),
        cash_flow_or_capital: boolOrNull(parsed?.goals?.cash_flow_or_capital),
      },
      recommended_option: ["website", "loan", "advertising", "multiple"].includes(
        parsed?.recommended_option
      ) ? parsed.recommended_option : null,
      rationale: ns(parsed?.rationale),
      next_step: ["demo", "email_summary", "follow_up_call"].includes(parsed?.next_step)
        ? parsed.next_step
        : null,
      consent_to_contact: {
        ok_to_email: boolOrNull(parsed?.consent_to_contact?.ok_to_email),
        ok_to_call: boolOrNull(parsed?.consent_to_contact?.ok_to_call),
        demo_scheduled: boolOrNull(parsed?.consent_to_contact?.demo_scheduled),
      },
      summary: parsed?.summary || "",
      flags: {
        off_topic_attempts: Array.isArray(parsed?.off_topic_attempts) ? parsed.off_topic_attempts : [],
        safety_flags: Array.isArray(parsed?.safety_flags) ? parsed.safety_flags : [],
        non_english_detected: Array.isArray(parsed?.non_english_detected) ? parsed.non_english_detected : [],
      },
      meta: {
        current_datetime_iso: parsed?.current_datetime_iso || nowIso,
        timezone: parsed?.timezone || "Asia/Karachi",
      },
      // keep a tiny sample only
      qa_sample,
    };

    // Slim console logs only the stuff you need
    console.log("[SUMMARY:LITE] Recommended:", extracted.recommended_option);
    console.log("[SUMMARY:LITE] Next Step:", extracted.next_step);
    console.log("[SUMMARY:LITE] Consent:", extracted.consent_to_contact);
    console.log("[SUMMARY:LITE] Goals:", extracted.goals);
    console.log("[SUMMARY:LITE] Flags:", extracted.flags);
    console.log("[SUMMARY:LITE] Summary:", extracted.summary);
    console.log("[SUMMARY:LITE] QA Sample:", extracted.qa_sample);

    return { extracted };
  } catch (e) {
    console.error("[SUMMARY:LITE] exception", e);
    return { error: "summarizer_exception", detail: String(e) };
  }
}
