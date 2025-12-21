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
  /\b(yes|yeah|yep|yup|correct|that's right|that is right|right|sure|ok(?:ay)?|affirmative|exactly|of course)\b/i;

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

const isCompanyEmail = (email) => {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  return COMPANY_EMAILS.has(e) || COMPANY_EMAIL_DOMAIN_RE.test(e);
};

// ✅ detect admin email leakage into local-part (like "ahmedsarwar" showing up)
const ADMIN_LEAK_TOKENS = (() => {
  const local = String(ADMIN_EMAIL || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  // extract letter runs >= 4 (e.g. "ahmedsarwar")
  const runs = local.match(/[a-z]{4,}/g) || [];
  return Array.from(new Set(runs));
})();

const containsAdminLeak = (email) => {
  const e = String(email || "").toLowerCase();
  const local = (e.split("@")[0] || "").replace(/[^a-z]/g, "");
  if (!local) return false;
  return ADMIN_LEAK_TOKENS.some((tok) => tok && local.includes(tok));
};

// ✅ Catch garbage local-parts like "letmeconfirm..."
const BAD_LOCAL_SUBSTRINGS = [
  "letmeconfirm",
  "confirmthefullemail",
  "confirmfull",
  "letmerepeat",
  "makesureihave",
  "isthatcorrect",
  "isthiscorrect",
  "didigetitright",
];

const safeJsonParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
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
  /\b(let me repeat|repeat that|make sure i have it|let me confirm|confirm the full email|let me confirm:|is that correct|correct\?)\b/i.test(
    String(s || "")
  );

// ✅ clip trailing "is that correct" so it doesn't glue into email
const clipAfterConfirmationPhrase = (s) => {
  if (!s) return "";
  const lower = String(s).toLowerCase();
  const cut = lower.search(
    /\b(is that correct|is this correct|did i get that right|correct\?)\b/i
  );
  return cut > 0 ? String(s).slice(0, cut) : String(s);
};

// stopwords that should NEVER be treated as part of local-part/domain
const STOPWORDS = new Set([
  "let",
  "me",
  "confirm",
  "please",
  "spell",
  "spelled",
  "letter",
  "by",
  "the",
  "a",
  "an",
  "email",
  "address",
  "for",
  "you",
  "so",
  "our",
  "team",
  "can",
  "reach",
  "contact",
  "is",
  "that",
  "correct",
  "this",
  "did",
  "i",
  "get",
  "right",
  "make",
  "sure",
  "have",
  "it",
  "thanks",
  "thank",
  "okay",
  "ok",
  "yeah",
  "yes",
]);

const DOMAIN_SKIP = new Set(["the", "rate"]);

// spell helpers
const deSpellToken = (tok) => {
  if (!tok) return "";
  const t = String(tok).toLowerCase();

  if (t.includes("-")) {
    const parts = t.split("-").filter(Boolean);

    if (parts.length >= 2 && parts.every((p) => NUM_WORD[p] != null)) {
      return parts.map((p) => NUM_WORD[p]).join("");
    }

    const singleCount = parts.filter((p) => /^[a-z0-9]$/.test(p)).length;
    if (parts.length >= 6 && singleCount / parts.length >= 0.8) {
      return parts.join("");
    }

    return t;
  }

  if (NUM_WORD[t] != null) return NUM_WORD[t];
  return t;
};

const normalizeHyphenSpelledEmail = (email) => {
  if (!email) return null;
  let e = String(email).trim().toLowerCase();
  e = e.replace(/[>,.)]+$/g, "");

  if (!e.includes("@")) return EMAIL_RE.test(e) ? e : null;

  const [local0, domain0] = e.split("@");
  if (!local0 || !domain0) return null;

  let local = local0;
  let domain = domain0;

  const localParts = local.split("-").filter(Boolean);
  const singleCount = localParts.filter((p) => /^[a-z0-9]$/.test(p)).length;

  if (localParts.length >= 6 && singleCount / localParts.length >= 0.8) {
    local = localParts.join("");
  }

  if (/\d-\d-\d/.test(local)) {
    local = local.replace(/(\d)-(?=\d)/g, "$1");
  }

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

const isGarbageEmail = (email) => {
  if (!email) return true;
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return true;
  if (isCompanyEmail(e)) return true;

  const [local] = e.split("@");
  if (!local) return true;
  if (local.length > 64) return true;

  const compactLocal = local.replace(/[^a-z0-9]/g, "");
  for (const bad of BAD_LOCAL_SUBSTRINGS) {
    if (compactLocal.includes(bad)) return true;
  }

  return false;
};

/**
 * Build email from spoken/spelled text.
 * IMPORTANT CHANGE:
 * - We DO NOT concatenate filler words like "let me confirm" into the local-part.
 * - We build around the FIRST "at".
 */
const spokenToEmail = (text) => {
  if (!text) return null;

  const clipped = clipAfterConfirmationPhrase(text);
  let s0 = String(clipped).toLowerCase();

  // normalize "at the rate" -> "at"
  s0 = s0.replace(/\bat\s+the\s+rate\b/g, " at ");

  // 1) If transcript already contains a real email with "@", take it
  const direct = s0.match(EMAIL_FIND_RE) || [];
  for (let i = direct.length - 1; i >= 0; i--) {
    const norm = normalizeHyphenSpelledEmail(direct[i]);
    if (norm && !isGarbageEmail(norm)) return norm;
  }

  // convert literal dots into "dot" tokens for domain parsing
  // (safe because direct emails were handled above)
  s0 = s0.replace(/\./g, " dot ");
  s0 = s0
    .replace(/[(),;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // must contain "at" to build an email
  const rawTokens = s0.split(" ").filter(Boolean);

  // clean tokens to [a-z0-9-] only (keeps hyphen spelling)
  const tokens = rawTokens
    .map((t) => t.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);

  const atIndex = tokens.findIndex((t) => t === "at");
  if (atIndex <= 0) return null;

  // find local start by scanning backward until stopword boundary
  let start = atIndex - 1;
  while (start > 0) {
    const prev = tokens[start - 1];
    if (!prev) break;
    if (prev === "at") break;
    if (STOPWORDS.has(prev)) break;
    start--;
  }

  const localTokens = tokens
    .slice(start, atIndex)
    .filter((t) => !STOPWORDS.has(t));
  if (!localTokens.length) return null;

  let localOut = "";
  for (const tok of localTokens) {
    if (tok === "underscore") localOut += "_";
    else if (tok === "dash" || tok === "hyphen") localOut += "-";
    else if (tok === "plus") localOut += "+";
    else if (tok === "dot") localOut += ".";
    else localOut += deSpellToken(tok);
  }

  // domain build after at
  let domainOut = "";
  for (let i = atIndex + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (STOPWORDS.has(tok)) continue;
    if (DOMAIN_SKIP.has(tok)) continue;

    if (tok === "dot" || tok === "period" || tok === "point") domainOut += ".";
    else domainOut += deSpellToken(tok);

    const candidate = normalizeHyphenSpelledEmail(
      `${localOut}@${domainOut}`.replace(/[^a-z0-9._%+\-@]/g, "")
    );
    if (candidate && !isGarbageEmail(candidate)) return candidate;
  }

  const final = normalizeHyphenSpelledEmail(
    `${localOut}@${domainOut}`.replace(/[^a-z0-9._%+\-@]/g, "")
  );
  if (final && !isGarbageEmail(final)) return final;
  return null;
};

/**
 * CONFIRMED email:
 * - agent read-back email + next user confirms yes/correct
 * - If agent email looks leaked (contains admin local token) but user email doesn’t,
 *   prefer user email for safety.
 */
const extractConfirmedEmail = (pairs) => {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  let lastConfirmed = null;

  for (let i = 0; i < pairs.length; i++) {
    const userUtter = String(pairs[i]?.q || "");
    const agentUtterRaw = String(pairs[i]?.a || "");
    if (!agentUtterRaw) continue;

    if (!looksLikeAgentReadback(agentUtterRaw)) continue;

    const agentEmail = spokenToEmail(agentUtterRaw);
    if (!agentEmail || isGarbageEmail(agentEmail)) continue;

    const nextQ1 = String(pairs[i + 1]?.q || "");
    const nextQ2 = String(pairs[i + 2]?.q || "");
    const confirmedYes =
      YES_RE.test(nextQ1.toLowerCase()) || YES_RE.test(nextQ2.toLowerCase());

    if (!confirmedYes) continue;

    // also parse user-provided email from the user utterance that triggered this readback
    const userEmail = spokenToEmail(userUtter);

    if (userEmail && !isGarbageEmail(userEmail) && userEmail !== agentEmail) {
      const agentLeaked = containsAdminLeak(agentEmail);
      const userLeaked = containsAdminLeak(userEmail);

      // if agent looks leaked but user doesn't, trust user
      if (agentLeaked && !userLeaked) {
        lastConfirmed = userEmail.toLowerCase();
        continue;
      }

      // otherwise still trust the readback that got "yes"
      lastConfirmed = agentEmail.toLowerCase();
      continue;
    }

    lastConfirmed = agentEmail.toLowerCase();
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
    /\b(invoice|payment|charge|refund|login|reset|error|ticket|order|shipment|crash|declined|fail|lost|track|bank|deposit|device|printer|receipt)\b/i.test(
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
  else ticketType = "support";

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
      proposedSolution: "not specified",
      isSatisfied: forceUnsatisfied
        ? false
        : satisfied
        ? true
        : unsatisfied
        ? false
        : "not specified",
    },
    summary: "not specified",
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
    "EMAIL RULES:",
    "- Only treat an email as confirmed if agent reads it back and the caller confirms yes/correct right after.",
    "- If there is ANY doubt which email is correct, set customer.email = 'not specified'.",
    "SATISFACTION RULES:",
    "- If agent/customer agree to create/escalate/open a ticket or schedule follow-up, set ticket.isSatisfied = false.",
    "- Only set ticket.isSatisfied = true if customer explicitly says solved/resolved/works and NO escalation exists.",
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

  if (!r?.ok) return { error: "openai", status: r?.status, body: raw };

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

  const outText =
    typeof data.output_text === "string"
      ? data.output_text
      : data?.output
          ?.find?.((x) => x.type === "message")
          ?.content?.find?.((c) => c.type === "output_text")?.text;

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

    // ✅ IMPORTANT: only trust confirmed email from transcript readback flow
    const confirmedEmail = extractConfirmedEmail(pairs);
    const rawEmail = ns(confirmedEmail);

    const safeEmail =
      typeof rawEmail === "string" &&
      EMAIL_RE.test(rawEmail) &&
      !isGarbageEmail(rawEmail)
        ? rawEmail.toLowerCase()
        : null;

    const safePhone = normalizePhone(phone);

    const rawName =
      ns(parsed?.customer?.name) || ns(parsed?.customer?.name_raw);
    const safeName = normalizeName(rawName);

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

        // ✅ update email only if confirmed
        if (safeEmail && userRecord.email !== safeEmail)
          patch.email = safeEmail;

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
