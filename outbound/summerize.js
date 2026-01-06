import "dotenv/config";
import { Op } from "sequelize";
import sequelize from "../config/db.js"; // 👈 use your shared DB instance
import User from "../models/user.js";
import Agent from "../models/agent.js";
import Call from "../models/Call.js";
import Ticket from "../models/ticket.js";
import Rating from "../models/rating.js";
import sendEmail from "../utils/Email.js";

const now = () => new Date();
const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

/** ---------------- AGENT LOAD BALANCING ---------------- */
async function getLeastLoadedAgentSafe() {
  try {
    const hasRole = !!Agent?.rawAttributes?.role;
    const agents = await Agent.findAll({
      where: hasRole ? { role: "agent" } : {},
      attributes: ["id"],
      raw: true,
    });

    if (!agents.length) return { agentId: null };

    const { fn, col } = Ticket.sequelize;
    const ticketCounts = await Ticket.findAll({
      where: { status: { [Op.in]: ["open", "in_progress"] } },
      attributes: ["agentId", [fn("COUNT", col("id")), "count"]],
      group: ["agentId"],
      raw: true,
    });

    const loadMap = {};
    for (const row of ticketCounts) {
      if (!row.agentId) continue;
      loadMap[row.agentId] = parseInt(row.count, 10) || 0;
    }

    let best = null;
    let bestLoad = Infinity;
    for (const { id } of agents) {
      const load = loadMap[id] ?? 0;
      if (load < bestLoad) {
        best = id;
        bestLoad = load;
      }
    }
    return { agentId: best };
  } catch (e) {
    console.warn("[getLeastLoadedAgentSafe] skipped:", e?.message || e);
    return { agentId: null };
  }
}

/** ---------------- TEXT HELPERS ---------------- */
const textOfPairs = (pairs) =>
  (Array.isArray(pairs) ? pairs : [])
    .map((p) => `${p.q ?? ""} ${p.a ?? ""}`)
    .join(" ")
    .toLowerCase();

/**
 * Try to pull a 1–5 rating from the Q/A text (fallback if LLM misses it).
 * Looks for patterns like "4", "4/5", "4 out of 5", "4 stars".
 */
function extractRatingFromPairs(qaPairs) {
  if (!Array.isArray(qaPairs)) {
    return { rating: null, comment: null };
  }

  const RATING_REGEX = /\b([1-5])\b\s*(?:stars?|star|out of 5|\/5)?/i;

  // search from last pair backwards (most recent answer first)
  for (let i = qaPairs.length - 1; i >= 0; i--) {
    const p = qaPairs[i] || {};
    const candidates = [
      p.q != null ? String(p.q) : "",
      p.a != null ? String(p.a) : "",
    ];
    for (const txt of candidates) {
      const m = txt.match(RATING_REGEX);
      if (m) {
        const rating = parseInt(m[1], 10);
        if (!Number.isNaN(rating) && rating >= 1 && rating <= 5) {
          return {
            rating,
            comment: txt.trim() || null,
          };
        }
      }
    }
  }

  return { rating: null, comment: null };
}

/** ---------------- OUTCOME DETECTORS (RULE-BASED FALLBACK) ---------------- */
function detectSatisfactionCase(qaPairs) {
  const t = textOfPairs(qaPairs);

  const yesSatisfied =
    /\b(i'?m|i am|am)\s+(ok|okay|fine|good|satisfied|happy)\b/.test(t) ||
    /\bthis (solves|fixed|works)\b/.test(t) ||
    /\bresolved\b/.test(t);

  const explicitNo =
    /\bnot\s+(ok|okay|happy|satisfied)\b/.test(t) ||
    /\bnot\s+resolved\b/.test(t) ||
    /\bstill (failing|broken)\b/.test(t) ||
    /\b(unhappy|unsatisfied|dissatisfied)\b/.test(t);

  const noResponseOrCut =
    /\b(call\s*(got)?\s*cut|hang\s*up|hung\s*up|prefer not to say|no comment|no response|silent|silence)\b/.test(
      t
    );

  if (yesSatisfied) return "satisfied";
  if (explicitNo) return "not_satisfied";
  if (noResponseOrCut) return "no_response";

  const issue =
    /\b(refund|charge|error|bug|fail|declined|problem|issue|login|shipment|lost|delay)\b/.test(
      t
    );
  return issue ? "not_satisfied" : "no_response";
}

function detectUpsellCase(qaPairs) {
  const t = textOfPairs(qaPairs);

  const interested =
    /\b(yes|yeah|yep|sure|ok|okay|interested|sounds good|let'?s do|book|schedule|set up)\b.*\b(demo|call|meeting|follow\s*up|trial|plan|offer)\b/.test(
      t
    ) ||
    /\b(send|share)\b.*\b(details|info|information|proposal|quote|pricing)\b/.test(
      t
    );

  const notInterested =
    /\b(not\s+interested|no\s+thanks|no thank you|maybe later|not now)\b/.test(
      t
    ) || /\b(stop\s+calling|remove me|do not contact)\b/.test(t);

  const noResponseOrCut =
    /\b(call\s*(got)?\s*cut|hang\s*up|hung\s*up|prefer not to say|no comment|no response|silent|silence)\b/.test(
      t
    );

  if (interested) return "interested";
  if (notInterested) return "not_interested";
  if (noResponseOrCut) return "no_response";
  return "no_response";
}

/** ---------------- FOLLOW-UP LOGIC ---------------- */
function computeFollowup(campaignType, outcomeCase) {
  const nowDate = now();
  if (campaignType === "satisfaction" && outcomeCase === "satisfied") {
    return addDays(nowDate, 7);
  }
  if (campaignType === "upsell" && outcomeCase === "interested") {
    return addDays(nowDate, 21);
  }
  return null;
}

function buildFollowupPatch(campaignType, followupAt) {
  if (!followupAt) return {};
  const hasNextSat = !!Call?.rawAttributes?.nextSatisfactionAt;
  const hasNextUps = !!Call?.rawAttributes?.nextUpsellAt;
  const hasGeneric = !!Call?.rawAttributes?.followUpAt;

  if (campaignType === "satisfaction") {
    if (hasNextSat) return { nextSatisfactionAt: followupAt };
    if (hasGeneric) return { followUpAt: followupAt };
  } else if (campaignType === "upsell") {
    if (hasNextUps) return { nextUpsellAt: followupAt };
    if (hasGeneric) return { followUpAt: followupAt };
  }
  return {};
}

/** ---------------- MISC HELPERS ---------------- */
const cleanLanguages = (arr) => {
  if (!Array.isArray(arr)) return [];
  return Array.from(
    new Set(
      arr.map((v) => (v == null ? "" : String(v).trim())).filter((v) => v)
    )
  );
};

/** ---------------- MOCK OUTCOME (NO LLM) ---------------- */
function mockOutcomeExtract(qaPairs, campaignType) {
  const outcome_case =
    campaignType === "satisfaction"
      ? detectSatisfactionCase(qaPairs)
      : detectUpsellCase(qaPairs);

  const customerLine = (
    qaPairs.find((p) => /customer/i.test(p.q || ""))?.a || ""
  ).slice(0, 160);

  const summary =
    customerLine ||
    (campaignType === "satisfaction"
      ? outcome_case === "satisfied"
        ? "Customer appears satisfied with the resolution."
        : outcome_case === "not_satisfied"
        ? "Customer appears not satisfied with the resolution."
        : "No clear response from customer; call may have been cut or unclear."
      : outcome_case === "interested"
      ? "Customer appears interested in the upsell offer."
      : outcome_case === "not_interested"
      ? "Customer is not interested in the upsell offer."
      : "No clear response to upsell offer; call may have been cut or unclear.");

  // rating fallback in mock mode (only for satisfaction)
  let rating_score = "not_specified";
  let rating_comment = "not_specified";
  if (campaignType === "satisfaction") {
    const { rating, comment } = extractRatingFromPairs(qaPairs);
    if (rating != null) {
      rating_score = rating;
      rating_comment = comment || "not_specified";
    }
  }

  return {
    outcome_case,
    summary,
    non_english_detected: [],
    clarifications_needed: [],
    mishears_or_typos: [],
    rating_score,
    rating_comment,
  };
}

/** ---------------- LLM OUTCOME EXTRACTOR ---------------- */
async function extractOutcomeWithLLM(qaPairs, campaignType) {
  const system = [
    "You are an accurate, terse extractor for GETPIE outbound customer calls.",
    "English only. Output ONLY JSON, no extra words.",
    "If a value is unknown/unclear, set it to the string 'not_specified'.",
    "Correct obvious misspellings when you summarize.",
    "Do not invent facts. Prefer 'not_specified' over guessing.",
    "Keep the summary <= 80 words.",
    "Classify the outcome using fixed string values exactly as requested.",
    "For satisfaction campaigns: outcome_case must be one of 'satisfied', 'not_satisfied', or 'no_response'.",
    "For upsell campaigns: outcome_case must be one of 'interested', 'not_interested', or 'no_response'.",
    "If this is a satisfaction campaign and the customer provides a rating for the agent, extract rating_score as an integer 1-5 and rating_comment as a short sentence.",
    "If there is no clear rating, set rating_score to 'not_specified' and rating_comment to 'not_specified'.",
    "For upsell campaigns, always set rating_score to 'not_specified' and rating_comment to 'not_specified'.",
    "Languages list must be real-world names (e.g., English, Urdu, Punjabi).",
  ].join(" ");

  const userMsg = `
You are analyzing an OUTBOUND "${campaignType}" campaign call.

From these Q/A pairs, return ONLY this JSON:

{
  "qa_log": Array<{ "q": string, "a": string }>,
  "summary": string,
  "campaignType": "satisfaction" | "upsell",
  "outcome_case": "satisfied" | "not_satisfied" | "no_response" | "interested" | "not_interested",
  "rating_score": 1 | 2 | 3 | 4 | 5 | "not_specified",
  "rating_comment": string | "not_specified",
  "non_english_detected": string[],
  "clarifications_needed": string[],
  "mishears_or_typos": string[]
}

Rules:
- If campaignType is "satisfaction", ONLY use: "satisfied", "not_satisfied", "no_response" for outcome_case.
- If campaignType is "upsell", ONLY use: "interested", "not_interested", "no_response" for outcome_case.
- rating_score must be an integer in [1,5] when provided.
- Only infer a rating if the customer clearly states it (for example "5 out of 5", "4 stars", "I give 3").
- The summary should briefly describe what happened in the call.

Q/A PAIRS:
${JSON.stringify(qaPairs, null, 2)}
`.trim();

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 20000);

  let r;
  let raw;
  try {
    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_output_tokens: 600,
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
  } finally {
    clearTimeout(timeoutId);
  }

  if (!r.ok) {
    return { error: "openai", status: r.status, body: raw };
  }

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
  } catch (e) {}

  if (!outText) return { error: "openai_no_text", body: raw };

  try {
    const parsed = JSON.parse(outText);
    return parsed;
  } catch (e) {
    return { error: "parse", text: outText };
  }
}

/** ---------------- MAIN ENTRY ---------------- */
export async function processCallOutcome({
  qaPairs,
  userId,
  callSid,
  campaignType,
}) {
  if (!Array.isArray(qaPairs) || !qaPairs.length)
    return { error: "qa_pairs_empty" };
  if (!callSid || typeof callSid !== "string")
    return { error: "missing_callSid" };
  if (campaignType !== "satisfaction" && campaignType !== "upsell")
    return { error: "invalid_campaign", detail: campaignType };

  try {
    const user = await User.findByPk(userId);
    if (!user) return { error: "user_not_found", detail: { userId } };

    const useMock = String(process.env.SUMMARIZER_MOCK || "").trim() === "1";
    let parsed;
    if (useMock) {
      parsed = mockOutcomeExtract(qaPairs, campaignType);
    } else {
      const llmResult = await extractOutcomeWithLLM(qaPairs, campaignType);
      if (llmResult && !llmResult.error) {
        parsed = llmResult;
      } else {
        parsed = mockOutcomeExtract(qaPairs, campaignType);
      }
    }

    const allowedSatisfaction = ["satisfied", "not_satisfied", "no_response"];
    const allowedUpsell = ["interested", "not_interested", "no_response"];

    const rawOutcome = parsed?.outcome_case;
    const normOutcome =
      typeof rawOutcome === "string"
        ? rawOutcome.trim().toLowerCase().replace(/\s+/g, "_")
        : "";

    let outcomeCase = null;
    if (campaignType === "satisfaction") {
      outcomeCase = allowedSatisfaction.includes(normOutcome)
        ? normOutcome
        : detectSatisfactionCase(qaPairs);
    } else {
      outcomeCase = allowedUpsell.includes(normOutcome)
        ? normOutcome
        : detectUpsellCase(qaPairs);
    }

    const summary =
      typeof parsed?.summary === "string" && parsed.summary.trim().length
        ? parsed.summary.trim()
        : campaignType === "satisfaction"
        ? outcomeCase === "satisfied"
          ? "CSAT: satisfied."
          : outcomeCase === "not_satisfied"
          ? "CSAT: not satisfied."
          : "CSAT: no response / call cut."
        : outcomeCase === "interested"
        ? "Upsell: interested."
        : outcomeCase === "not_interested"
        ? "Upsell: not interested."
        : "Upsell: no response / call cut.";

    const languages = cleanLanguages(parsed?.non_english_detected);

    /** ---- Rating parsing (primary LLM, fallback regex) ---- */
    const rawScore = parsed?.rating_score;
    let ratingScore = null;
    if (campaignType === "satisfaction") {
      if (typeof rawScore === "number") {
        const s = Math.round(rawScore);
        if (s >= 1 && s <= 5) ratingScore = s;
      } else if (typeof rawScore === "string") {
        const trimmed = rawScore.trim().toLowerCase();
        if (trimmed !== "not_specified" && trimmed !== "not specified") {
          const n = parseInt(trimmed, 10);
          if (!Number.isNaN(n) && n >= 1 && n <= 5) ratingScore = n;
        }
      }

      // fallback: regex on raw conversation if LLM didn't give rating
      if (ratingScore == null) {
        const { rating, comment } = extractRatingFromPairs(qaPairs);
        if (rating != null) {
          ratingScore = rating;
          if (!parsed.rating_comment && comment) {
            parsed.rating_comment = comment;
          }
        }
      }
    }

    const rawComment = parsed?.rating_comment;
    const ratingComment =
      typeof rawComment === "string" &&
      rawComment.trim().length &&
      rawComment.trim().toLowerCase() !== "not_specified" &&
      rawComment.trim().toLowerCase() !== "not specified"
        ? rawComment.trim()
        : null;

    const followupAt = computeFollowup(campaignType, outcomeCase);

    // Normalized booleans for satisfaction / upsell
    const customerSatisfied =
      campaignType === "satisfaction"
        ? outcomeCase === "satisfied"
          ? true
          : outcomeCase === "not_satisfied"
          ? false
          : null
        : null;

    const customerInterestedInUpsell =
      campaignType === "upsell"
        ? outcomeCase === "interested"
          ? true
          : outcomeCase === "not_interested"
          ? false
          : null
        : null;

    let makeSupportTicket = false;
    let makeSalesTicket = false;

    if (campaignType === "satisfaction") {
      if (outcomeCase === "not_satisfied" || outcomeCase === "no_response") {
        makeSupportTicket = true;
      }
    } else {
      if (outcomeCase === "interested") {
        makeSalesTicket = true;
      }
    }

    const result = await sequelize.transaction(async (t) => {
      // update user flags for campaign
      const userPatch = {};
      if (campaignType === "satisfaction") userPatch.isSatisfactionCall = true;
      if (campaignType === "upsell") userPatch.isUpSellCall = true;
      if (Object.keys(userPatch).length) {
        await user.update(userPatch, { transaction: t });
      }

      // create Rating row if we have a rating (satisfaction only)
      let ratingRecord = null;
      if (campaignType === "satisfaction" && ratingScore != null) {
        const latestTicket = await Ticket.findOne({
          where: { userId },
          order: [["createdAt", "DESC"]],
          transaction: t,
        });
        if (latestTicket && latestTicket.id && latestTicket.agentId != null) {
          ratingRecord = await Rating.create(
            {
              score: ratingScore,
              comments: ratingComment,
              userId,
              ticketId: latestTicket.id,
              agentId: latestTicket.agentId,
            },
            { transaction: t }
          );
          // sendEmail(...)
        }
      }

      // create ticket for follow-up if needed
      let ticket = null;
      if (makeSupportTicket || makeSalesTicket) {
        const { agentId } = await getLeastLoadedAgentSafe();
        const ticketSummary =
          campaignType === "satisfaction"
            ? `CSAT: ${summary}`
            : `Upsell: ${summary}`;

        ticket = await Ticket.create(
          {
            status: "open",
            ticketType: makeSupportTicket ? "support" : "sales",
            priority: "medium",
            proposedSolution: null,
            isSatisfied: makeSupportTicket ? false : null,
            summary: ticketSummary,
            userId,
            agentId: agentId || null,
          },
          { transaction: t }
        );
        // sendEmail(...)
      }
      // User
      sendEmail(
        user.email,
        "Your support ticket is created",
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
     <p style="margin:0 0 8px;">Hi${user.name ? ` ${user.name}` : ""},</p>
     <p style="margin:0 0 8px;">Your ticket has been created. Our team will contact you shortly.</p>
     <p style="margin:0;color:#666;font-size:12px;">GETPIE Support</p>
   </div>`
      );

      // Admin
      sendEmail(
        "ahmedsarwar7575@gmail.com",
        "New ticket created",
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
     <p style="margin:0 0 8px;"><b>New ticket created</b></p>
     <p style="margin:0;">A new support ticket has been created for ${
       user.name ? ` ${user.name}` : ""
     }. Here is the summary of the ticket: ${
          ticket ? ticket.summary : ""
        }</p></p>
   </div>`
      );

      const basePatch = {
        type: "outbound",
        userId,
        ticketId: ticket ? ticket.id : null,
        QuestionsAnswers: qaPairs.slice(0, 200),
        languages,
        isResolvedByAi: null,
        summary,
        callSid,
        outboundDetails: null,
        callCategory: campaignType,
        customerSatisfied,
        customerInterestedInUpsell,
      };

      const followupPatch = buildFollowupPatch(campaignType, followupAt);
      const callPatch = { ...basePatch, ...followupPatch };

      const [affected] = await Call.update(callPatch, {
        where: { callSid },
        transaction: t,
      });

      let callRow;
      if (affected === 0) {
        callRow = await Call.create(callPatch, { transaction: t });
        // sendEmail(...)
      } else {
        callRow = await Call.findOne({ where: { callSid }, transaction: t });
      }

      const reloadedUser = await user.reload({ transaction: t });

      return {
        user: reloadedUser.toJSON(),
        ticket: ticket ? ticket.toJSON() : null,
        call: callRow ? callRow.toJSON() : null,
        rating: ratingRecord ? ratingRecord.toJSON() : null,
        outcome: {
          campaignType,
          case: outcomeCase,
          followupAt: followupAt ? followupAt.toISOString() : null,
          customerSatisfied,
          customerInterestedInUpsell,
          ratingScore: ratingScore ?? null,
          ratingComment,
        },
      };
    });

    return result;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/aborted|The user aborted a request/i.test(msg))
      return { error: "openai_timeout", detail: msg };
    if (/unique constraint|duplicate key/i.test(msg))
      return { error: "db_conflict", detail: msg };
    return { error: "process_exception", detail: msg };
  }
}

export default processCallOutcome;
