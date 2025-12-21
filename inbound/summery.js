import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import sequelize from "../config/db.js";
import { Op } from "sequelize";
import sendEmail from "../utils/Email.js";

const ADMIN_EMAIL = "ahmedsarwar7575@gmail.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const EMAIL_FIND_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const YES_RE =
  /\b(yes|yeah|yep|yup|correct|that's right|that is right|right|sure|ok(?:ay)?|affirmative|exactly)\b/i;

// Urdu/Arabic script ranges (good enough to catch Urdu text)
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

const NUM_WORD = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

// ✅ Prevent your own support emails from being stored as customer email
const COMPANY_EMAIL_DOMAIN_RE = /@getpiepay\.com\s*$/i;
const COMPANY_EMAILS = new Set(["support@getpiepay.com", "info@getpiepay.com"]);

// ✅ Catch garbage local-parts like "letmeconfirmahmed..."
const BAD_LOCAL_SUBSTRINGS = [
  "letmeconfirm",
  "confirmthefullemail",
  "confirmfull",
  "letmerepeat",
  "makesureihave",
  "isthatcorrect",
  "isthiscorrect",
  "didigetitright",
  "correct",
];

const safeJsonParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const toStr = (v) => (v == null ? "" : String(v));

const isCompanyEmail = (email) => {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  return COMPANY_EMAILS.has(e) || COMPANY_EMAIL_DOMAIN_RE.test(e);
};

const isGarbageEmail = (email) => {
  if (!email) return true;
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return true;
  if (isCompanyEmail(e)) return true;

  const [local, domain] = e.split("@");
  if (!local || !domain) return true;

  // Local-part max length is 64 by spec (good sanity check)
  if (local.length > 64) return true;

  // Remove separators and detect “let me confirm” type glue
  const compactLocal = local.replace(/[^a-z0-9]/g, "");
  for (const bad of BAD_LOCAL_SUBSTRINGS) {
    if (compactLocal.includes(bad)) return true;
  }

  // Domain sanity
  if (domain.length > 255) return true;
  if (!domain.includes(".")) return true;

  return false;
};

// ✅ Clip agent “Let me confirm ... is that correct?” so we don’t glue extra words into email
const clipAfterConfirmationPhrase = (s) => {
  if (!s) return "";
  const lower = String(s).toLowerCase();
  const cut = lower.search(
    /\b(is that correct|is this correct|did i get that right|correct\?)\b/i
  );
  return cut > 0 ? String(s).slice(0, cut) : String(s);
};

const safeSendEmail = async ({ to, subject, text, html }) => {
  try {
    return await sendEmail(to, subject, text);
  } catch (e1) {
    try {
      return await sendEmail(to, subject, html || text || "");
    } catch (e2) {
      console.warn("sendEmail failed:", e2?.message || e2);
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

const looksLikeAgentReadback = (s) =>
  /\b(let me repeat|repeat that|make sure i have it|let me confirm|confirm the full email|is that correct|correct\?)\b/i.test(
    String(s || "")
  );

/**
 * If user INTENDS "_" or "-", they usually say "underscore" / "dash" / "hyphen".
 * If transcript shows m-i-r-z-a... that’s spelling letters => remove hyphens.
 * We only collapse hyphens when it looks like spelled-out letters (long sequence).
 */
const deSpellToken = (tok) => {
  if (!tok) return "";
  const t = String(tok).toLowerCase();

  // e.g. one-one-one -> 111
  if (t.includes("-")) {
    const parts = t.split("-").filter(Boolean);

    // numeric word chain
    if (parts.length >= 2 && parts.every((p) => NUM_WORD[p] != null)) {
      return parts.map((p) => NUM_WORD[p]).join("");
    }

    // spelling letters/digits like m-i-r-z-a OR 1-1-1
    const singleCount = parts.filter((p) => /^[a-z0-9]$/.test(p)).length;
    if (parts.length >= 6 && singleCount / parts.length >= 0.8) {
      return parts.join("");
    }

    return t; // keep as-is otherwise (could be real hyphen)
  }

  if (NUM_WORD[t] != null) return NUM_WORD[t];
  return t;
};

const normalizeHyphenSpelledEmail = (email) => {
  if (!email) return null;
  let e = String(email).trim().toLowerCase();

  // strip trailing punctuation
  e = e.replace(/[>,.)]+$/g, "");

  if (!e.includes("@")) return EMAIL_RE.test(e) ? e : null;

  const [local0, domain0] = e.split("@");
  if (!local0 || !domain0) return null;

  let local = local0;
  let domain = domain0;

  // Collapse spelled-out local part like m-i-r-z-a...
  const localParts = local.split("-").filter(Boolean);
  const singleCount = localParts.filter((p) => /^[a-z0-9]$/.test(p)).length;

  if (localParts.length >= 6 && singleCount / localParts.length >= 0.8) {
    local = localParts.join("");
  }

  // Collapse digits only when clearly 1-1-1
  if (/\d-\d-\d/.test(local)) {
    local = local.replace(/(\d)-(?=\d)/g, "$1");
  }

  // Domain sometimes gets hyphen-spelled too (rare)
  domain = domain
    .split(".")
    .map((label) => {
      const parts = label.split("-").filter(Boolean);
      if (parts.length >= 4 && parts.every((p) => /^[a-z]$/.test(p)))
        return parts.join("");
      return label;
    })
    .join(".");

  const out = `${local}@${domain}`;
  return EMAIL_RE.test(out) ? out : null;
};

/**
 * Build an email from spoken/spelled text:
 *  "m-i-r-z-a one-one-one at gmail dot com"
 *   -> "mirza111@gmail.com"
 *
 * IMPORTANT:
 * - If they say "underscore" => keep "_"
 * - If they say "dash/hyphen" => keep "-"
 */
const spokenToEmail = (text) => {
  if (!text) return null;

  // ✅ clip readback suffix like "is that correct?"
  const clipped = clipAfterConfirmationPhrase(text);
  const originalLower = String(clipped).toLowerCase();

  // ✅ 1) First: try extracting direct email BEFORE modifying dots
  const direct = originalLower.match(EMAIL_FIND_RE) || [];
  for (let i = direct.length - 1; i >= 0; i--) {
    const norm = normalizeHyphenSpelledEmail(direct[i]);
    if (norm && !isGarbageEmail(norm)) return norm;
  }

  // ✅ 2) Otherwise build from spoken tokens
  let s0 = originalLower;

  // normalize common voice phrases
  s0 = s0.replace(/\bat\s+the\s+rate\b/g, " at ");
  // do NOT replace "." inside an actual email (handled above); here we replace for "dot" speech parsing
  s0 = s0.replace(/\./g, " dot ");

  const s = s0
    .replace(/[(),;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !/\b(at|dot|underscore|dash|hyphen|plus|gmail|yahoo|outlook|hotmail)\b/i.test(
      s
    )
  ) {
    return null;
  }

  const tokens = s.split(" ");
  let out = "";
  let sawAt = false;
  let sawDotAfterAt = false;

  for (const rawTok of tokens) {
    const tok = rawTok.replace(/[^a-z0-9-]/g, ""); // keep hyphen for deSpellToken
    if (!tok) continue;

    if (tok === "at") {
      out += "@";
      sawAt = true;
      continue;
    } else if (tok === "dot" || tok === "period" || tok === "point") {
      out += ".";
      if (sawAt) sawDotAfterAt = true;
      continue;
    } else if (tok === "underscore") {
      out += "_";
      continue;
    } else if (tok === "dash" || tok === "hyphen") {
      out += "-";
      continue;
    } else if (tok === "plus") {
      out += "+";
      continue;
    } else {
      out += deSpellToken(tok);
    }

    // ✅ stop early once we have a valid email after seeing "@...dot..."
    if (sawAt && sawDotAfterAt) {
      const candidate = normalizeHyphenSpelledEmail(
        out.replace(/[^a-z0-9._%+\-@]/g, "")
      );
      if (candidate && !isGarbageEmail(candidate)) return candidate;
    }
  }

  out = out.replace(/[^a-z0-9._%+\-@]/g, "");
  const norm = normalizeHyphenSpelledEmail(out);
  if (norm && !isGarbageEmail(norm)) return norm;
  return null;
};

/**
 * CONFIRMED email only:
 * - Accept only when AGENT reads back an email and the NEXT user utterance confirms yes/correct.
 * - Never accept company emails or garbage local-parts.
 * - Return the LAST confirmed email (supports email change during call).
 */
const extractConfirmedEmail = (pairs) => {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  let lastConfirmed = null;

  for (let i = 0; i < pairs.length; i++) {
    const agentUtterRaw = toStr(pairs[i]?.a || "");
    if (!agentUtterRaw) continue;

    if (!looksLikeAgentReadback(agentUtterRaw)) continue;

    const agentEmail = spokenToEmail(agentUtterRaw);
    if (!agentEmail || isGarbageEmail(agentEmail)) continue;

    // Confirmation is typically the NEXT user turn
    const nextQ = toStr(pairs[i + 1]?.q || "");
    const next2Q = toStr(pairs[i + 2]?.q || "");
    const confirmedYes =
      YES_RE.test(nextQ.toLowerCase()) || YES_RE.test(next2Q.toLowerCase());

    if (confirmedYes) {
      lastConfirmed = agentEmail.toLowerCase();
    }
  }

  return lastConfirmed;
};

const shouldForceUnsatisfiedIfTicketFlow = (pairs) => {
  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ")
    .toLowerCase();

  return /\b(escalat|open(?:ed)?\s+(a\s+)?ticket|create(?:d)?\s+(a\s+)?ticket|log(?:ged)?\s+(a\s+)?ticket|technician\s+(will|to)\s+(call|contact)|we('?ll| will)\s+(call|contact)\s+you|follow\s*up\s+(with\s+you)?|case\s+number)\b/i.test(
    text
  );
};

const normalizeLanguages = (arr, pairs) => {
  const out = [];
  const add = (v) => {
    if (!v) return;
    if (!out.includes(v)) out.push(v);
  };

  // From model
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

  // From transcript text (backup)
  const text = (pairs || [])
    .map((p) => `${p?.q ?? ""} ${p?.a ?? ""}`)
    .join(" ");
  if (ARABIC_SCRIPT_RE.test(text)) add("Urdu");

  return out;
};

function mockExtract(pairs) {
  const text = pairs.map((p) => `${p.q ?? ""} ${p.a ?? ""}`).join(" ");
  const lower = text.toLowerCase();

  const confirmedEmail = extractConfirmedEmail(pairs);

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
    /\binvoice|payment|charge|refund|login|reset|error|ticket|order|shipment|crash|declined|fail|lost|track|device|printer|receipt|deposit|bank\b/i.test(
      lower
    );

  const greetingsOnly =
    !contactInfoOnly &&
    !satisfied &&
    !unsatisfied &&
    !hasIssueKeyword &&
    /\b(hello|hi|testing the line|bye)\b/i.test(lower);

  let ticketType = null;
  if (/\b(invoice|billing|charge|refund|card|declined|payment)\b/i.test(lower))
    ticketType = "billing";
  else if (/\b(pricing|buy|purchase|quote|plan)\b/i.test(lower))
    ticketType = "sales";
  else if (
    /\b(login|reset|error|bug|crash|shipping|order|shipment|track|lost|device|printer|receipt|deposit|bank)\b/i.test(
      lower
    )
  )
    ticketType = "support";

  const proposedSolution = "not specified";

  const customerLine = (
    pairs.find((p) => /customer/i.test(p.q || ""))?.a || ""
  ).slice(0, 160);
  const summary = customerLine || "not specified";

  const forceUnsatisfied = shouldForceUnsatisfiedIfTicketFlow(pairs);

  return {
    customer: {
      name: name ? normalizeName(name) : "not specified",
      name_raw: name || "not specified",
      email: confirmedEmail || "not specified",
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
    non_english_detected: normalizeLanguages([], pairs),
    clarifications_needed: [],
    mishears_or_typos: [],
  };
}

const extractWithOpenAI = async (pairs, { timeoutMs = 60000 } = {}) => {
  const system = [
    "You are an accurate, terse extractor for GETPIE customer support call logs.",
    "English only. Output ONLY JSON matching the provided JSON Schema.",
    "If unknown/unclear, set the value to the string 'not specified'. Do not invent facts.",
    "Transcription can be wrong. Prefer facts explicitly CONFIRMED in the call.",
    "EMAIL RULES (important):",
    "- The transcript may mis-spell an email and may add hyphens between letters when user spells it (e.g., m-i-r-z-a...). Those hyphens are NOT part of the email; remove them.",
    "- If the user explicitly says 'underscore' or 'dash/hyphen', keep those characters in the email.",
    "- Only treat an email as confirmed if agent reads it back and the caller confirms yes/correct right after.",
    "- If there is ANY doubt which email is correct, set customer.email = 'not specified'.",
    "SATISFACTION RULES (important):",
    "- If agent/customer agree to create/escalate/open a ticket or schedule technician follow-up, set ticket.isSatisfied = false.",
    "- Only set ticket.isSatisfied = true if customer explicitly says solved/resolved/works and NO escalation/ticket flow exists.",
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
Return JSON ONLY (no extra text).

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

  if (!r?.ok) {
    return {
      error: "openai",
      status: r?.status,
      body: raw,
    };
  }

  const data = safeJsonParse(raw);
  if (!data) return { error: "openai_bad_json", body: raw };

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

  const parsed = safeJsonParse(outText);
  if (!parsed) return { error: "parse", text: outText, body: raw };
  return parsed;
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
      parsed = await extractWithOpenAI(pairs, { timeoutMs: 60000 });

      if (parsed?.error) {
        const retry = await extractWithOpenAI(pairs, { timeoutMs: 60000 });
        if (!retry?.error) parsed = retry;
      }

      if (parsed?.error) return parsed;
    }

    const ns = (v) => {
      if (v == null) return null;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      if (!trimmed) return null;
      return trimmed.toLowerCase() === "not specified" ? null : trimmed;
    };

    // ✅ IMPORTANT: only trust confirmed email from the transcript readback flow
    // (do NOT fall back to model’s guessed email)
    const confirmedEmail = extractConfirmedEmail(pairs);
    const rawEmail = ns(confirmedEmail);

    const safeEmail =
      typeof rawEmail === "string" && EMAIL_RE.test(rawEmail) && !isGarbageEmail(rawEmail)
        ? rawEmail.toLowerCase()
        : null;

    const safePhone = normalizePhone(phone);

    const rawName =
      ns(parsed?.customer?.name) || ns(parsed?.customer?.name_raw);
    const safeName = normalizeName(rawName);

    // Business rule: ticket/escalation => unsatisfied
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

      if (safePhone) {
        userRecord = await User.findOne({
          where: { phone: safePhone },
          transaction: t,
        });
      }

      if (!userRecord && safeEmail) {
        userRecord = await User.findOne({
          where: { email: safeEmail },
          transaction: t,
        });
      }

      if (!userRecord) {
        userRecord = await User.create(
          {
            name: safeName || null,
            email: safeEmail || null,
            phone: safePhone || null,
            status: "active",
          },
          { transaction: t }
        );
        userCreated = true;
      } else {
        const patch = {};
        if (safeName && userRecord.name !== safeName) patch.name = safeName;

        // ✅ only update email if we have a confirmed safeEmail
        if (safeEmail && userRecord.email !== safeEmail) patch.email = safeEmail;

        if (safePhone && !userRecord.phone) patch.phone = safePhone;
        if (userRecord.status !== "active") patch.status = "active";

        if (Object.keys(patch).length) {
          await userRecord.update(patch, { transaction: t });
        }
      }

      let ticketRecord = null;
      let ticketCreated = false;
      let assignedAgentId = null;

      if (shouldCreateTicket) {
        // assign agent if possible (safe)
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

      if (!affected) {
        await Call.create(
          {
            callSid,
            ...callPatch,
          },
          { transaction: t }
        );
      }

      return {
        user: userRecord,
        ticket: ticketRecord,
        agentId: assignedAgentId,
        _flags: { userCreated, ticketCreated },
        extracted: {
          name: safeName,
          email: safeEmail,
          phone: safePhone,
          summary,
          languages,
          isSatisfied,
        },
      };
    });

    // ✅ Notify admin on create events (safe)
    try {
      const flags = result?._flags || {};
      const events = [];
      if (flags.userCreated) events.push("New user created");
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
    } catch (e) {
      console.warn("Admin notifications failed:", e?.message || e);
    }

    return result;
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("summarizer error", e);
    return { error: "summarizer_exception", message: msg };
  }
};
