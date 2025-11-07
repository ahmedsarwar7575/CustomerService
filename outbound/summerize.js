// outbound/processCallOutcome.v2.js
import "dotenv/config";
import { Op } from "sequelize";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import Call from "../models/Call.js";
import Ticket from "../models/ticket.js";

/**
 * CAMPAIGNS:
 *  - "satisfaction"
 *  - "upsell"
 *
 * OUTCOME CASES (strings we return in result.outcome.case):
 *  Satisfaction:
 *    - "satisfied"
 *    - "not_satisfied"
 *    - "no_response"   (prefer not to say / call cut / silence) → treat as not satisfied
 *  Upsell:
 *    - "interested"
 *    - "not_interested"
 *    - "no_response"   (prefer not to say / call cut / silence)
 */

// ---------- helpers ----------
const now = () => new Date();
const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

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

const textOfPairs = (pairs) =>
  (Array.isArray(pairs) ? pairs : [])
    .map((p) => `${p.q ?? ""} ${p.a ?? ""}`)
    .join(" ")
    .toLowerCase();

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
  // default conservative → not satisfied if any issue keyword, else no_response
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
  // default conservative
  return "no_response";
}

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

/**
 * Safely write follow-up timestamps only if such columns exist.
 * Preferred columns:
 *  - satisfaction: Call.nextSatisfactionAt
 *  - upsell:       Call.nextUpsellAt
 * Fallback:
 *  - Call.followUpAt (generic)
 */
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

// ---------- MAIN ----------
/**
 * @param {Object} params
 * @param {Array<{q:string,a:string}>} params.qaPairs
 * @param {number|string} params.userId
 * @param {string} params.callSid
 * @param {import('sequelize').Sequelize} params.sequelize
 * @param {"satisfaction"|"upsell"} params.campaignType
 */
export async function processCallOutcome({
  qaPairs,
  userId,
  callSid,
  sequelize,
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

    // classify outcome per campaign (NO LLM)
    let outcomeCase;
    if (campaignType === "satisfaction") {
      outcomeCase = detectSatisfactionCase(qaPairs);
    } else {
      outcomeCase = detectUpsellCase(qaPairs);
    }

    // decide actions
    let makeSupportTicket = false;
    let makeSalesTicket = false;

    if (campaignType === "satisfaction") {
      // case map:
      // 1 satisfied           → no ticket; schedule +7d
      // 2 not satisfied       → SUPPORT ticket
      // 3 no response         → treat as not satisfied → SUPPORT ticket
      if (outcomeCase === "not_satisfied" || outcomeCase === "no_response") {
        makeSupportTicket = true;
      }
    } else {
      // upsell
      // 4 interested          → SALES ticket; schedule +21d
      // 5 not interested      → no ticket
      // 6 no response         → no ticket
      if (outcomeCase === "interested") {
        makeSalesTicket = true;
      }
    }

    const followupAt = computeFollowup(campaignType, outcomeCase);

    // one transaction: optional ticket + call upsert + user flags
    const result = await sequelize.transaction(async (t) => {
      // update user flag per campaign
      const userPatch = {};
      if (campaignType === "satisfaction") userPatch.isSatisfactionCall = true;
      if (campaignType === "upsell") userPatch.isUpSellCall = true;
      if (Object.keys(userPatch).length) {
        await user.update(userPatch, { transaction: t });
      }

      // create ticket if needed
      let ticket = null;
      if (makeSupportTicket || makeSalesTicket) {
        const { agentId } = await getLeastLoadedAgentSafe();
        ticket = await Ticket.create(
          {
            status: "open",
            ticketType: makeSupportTicket ? "support" : "sales",
            priority: "medium",
            proposedSolution: null,
            isSatisfied: makeSupportTicket ? false : null,
            summary:
              campaignType === "satisfaction"
                ? outcomeCase === "no_response"
                  ? "CSAT: no response / call cut; treating as not satisfied."
                  : "CSAT: customer not satisfied."
                : "Upsell: customer interested in offer.",
            userId,
            agentId: agentId || null,
          },
          { transaction: t }
        );
      }

      // prepare call patch
      const basePatch = {
        type: "outbound",
        userId,
        ticketId: ticket ? ticket.id : null,
        QuestionsAnswers: qaPairs.slice(0, 200),
        languages: null, // not detecting here, could plug in later
        isResolvedByAi: null,
        summary:
          campaignType === "satisfaction"
            ? outcomeCase === "satisfied"
              ? "CSAT: satisfied."
              : outcomeCase === "not_satisfied"
              ? "CSAT: not satisfied."
              : "CSAT: no response / call cut."
            : outcomeCase === "interested"
            ? "Upsell: interested."
            : outcomeCase === "not_interested"
            ? "Upsell: not interested."
            : "Upsell: no response / call cut.",
        callSid,
        outboundDetails: null,
        callCategory: campaignType, // keep simple: 'satisfaction' | 'upsell'
        customerSatisfied:
          campaignType === "satisfaction" ? outcomeCase === "satisfied" : null,
        customerInterestedInUpsell:
          campaignType === "upsell" ? outcomeCase === "interested" : null,
      };

      const followupPatch = buildFollowupPatch(campaignType, followupAt);
      const callPatch = { ...basePatch, ...followupPatch };

      // upsert Call by callSid
      const [affected] = await Call.update(callPatch, {
        where: { callSid },
        transaction: t,
      });

      let callRow;
      if (affected === 0) {
        callRow = await Call.create(callPatch, { transaction: t });
      } else {
        callRow = await Call.findOne({ where: { callSid }, transaction: t });
      }

      return {
        user: await user.reload({ transaction: t }).then((u) => u.toJSON()),
        ticket: ticket ? ticket.toJSON() : null,
        call: callRow ? callRow.toJSON() : null,
        outcome: {
          campaignType,
          case: outcomeCase,
          followupAt: followupAt ? followupAt.toISOString() : null,
        },
      };
    });

    return result;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/unique constraint|duplicate key/i.test(msg))
      return { error: "db_conflict", detail: msg };
    return { error: "process_exception", detail: msg };
  }
}

export default processCallOutcome;
