import dotenv from "dotenv";
import { Op } from "sequelize";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import Call from "../models/Call.js";
import Ticket from "../models/ticket.js";

dotenv.config();

async function getLeastLoadedAgent() {
  const agents = await Agent.findAll({
    where: { role: "agent" },
    attributes: ["id"],
    raw: true,
  });

  if (!agents.length) return { agentId: null };

  const { fn, col } = Ticket.sequelize;
  const ticketCounts = await Ticket.findAll({
    where: {
      status: { [Op.in]: ["open", "in_progress"] },
    },
    attributes: ["agentId", [fn("COUNT", col("id")), "count"]],
    group: ["agentId"],
    raw: true,
  });

  const loadMap = {};
  for (const row of ticketCounts) {
    if (!row.agentId) continue;
    loadMap[row.agentId] = parseInt(row.count, 10);
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
}

// this calls OpenAI once and decides everything
async function analyzeCallWithGPT(qaPairs, userId, callSid) {
  const nowIso = new Date().toISOString();

  const system = [
    "You are an accurate call analyzer for a payments/fintech company.",
    "Return ONLY valid JSON.",
    "Do not add explanations.",
    "If you are unsure for any field, use 'not specified' or [] as appropriate.",
    "Booleans must be true or false, never strings.",
    "Detect languages used by caller and agent: return ISO-like short codes if possible like 'en','ur','ar' etc.",
    "Classify callCategory: 'satisfaction' if goal is CSAT / are you happy; 'upsell' if goal is pitch/sell product; 'both' if both happened; otherwise 'other'.",
    "CustomerSatisfied means: caller said they are happy / okay / satisfied with service.",
    "CustomerInterestedInUpsell means: caller showed real interest in buying, demo, follow-up, more info, or agreed to be contacted.",
  ].join(" ");

  const userPrompt = `
Return ONLY this JSON:

{
  "callCategory": "satisfaction" | "upsell" | "both" | "other",
  "languages": string[],
  "satisfaction": {
    "isSatisfied": true | false | "not specified",
    "needsFollowup": true | false | "not specified"
  },
  "upsell": {
    "interestedInOffer": true | false | "not specified",
    "next_step": "demo" | "follow_up_call" | "email_summary" | "not specified",
    "recommended_option": "website" | "loan" | "advertising" | "multiple" | "not specified"
  },
  "issue_or_goal": string | "not specified",
  "summary": string,
  "meta": {
    "userId": ${userId},
    "callSid": "${callSid}",
    "current_datetime_iso": "${nowIso}",
    "timezone": "Asia/Karachi"
  }
}

SOURCE_QA_PAIRS:
${JSON.stringify(qaPairs, null, 2)}
`.trim();

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 20000);

  const payload = {
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_output_tokens: 700,
    text: { format: { type: "json_object" } },
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: userPrompt }] },
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
    console.error("[analyzeCallWithGPT] openai.responses error", rawText);
    return { error: "openai", detail: { status: r.status, body: rawText } };
  }

  let outText = null;
  try {
    const data = JSON.parse(rawText);
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
    console.error("[analyzeCallWithGPT] no output_text", rawText);
    return { error: "no_output_text" };
  }

  let parsed;
  try {
    parsed = JSON.parse(outText);
  } catch {
    console.error("[analyzeCallWithGPT] JSON parse fail", outText);
    return { error: "parse_error", detail: outText };
  }

  const normBool = (v) => (v === true ? true : v === false ? false : null);
  const normString = (v) => (v === "not specified" ? null : v);

  const callCategory = parsed?.callCategory || "other";

  const langsRaw = Array.isArray(parsed?.languages) ? parsed.languages : [];
  const languages = langsRaw.filter(
    (x) => typeof x === "string" && x.trim() !== ""
  );

  const isSatisfied = normBool(parsed?.satisfaction?.isSatisfied);
  const needsFollow = normBool(parsed?.satisfaction?.needsFollowup);

  const interestedInOffer = normBool(parsed?.upsell?.interestedInOffer);
  const nextStep = parsed?.upsell?.next_step || null;
  const recOption = parsed?.upsell?.recommended_option || null;

  const issueOrGoal = normString(parsed?.issue_or_goal);
  const summary = parsed?.summary || "";

  return {
    callCategory,
    languages,
    satisfaction: {
      isSatisfied,
      needsFollow,
    },
    upsell: {
      interestedInOffer,
      nextStep,
      recOption,
    },
    issueOrGoal,
    summary,
    meta: parsed?.meta || {},
  };
}

// THIS IS THE ONLY FUNCTION YOU CALL
export async function processCallOutcome({ qaPairs, userId, callSid }) {
  if (!Array.isArray(qaPairs) || !qaPairs.length) {
    throw new Error("qaPairs empty");
  }

  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  const analysis = await analyzeCallWithGPT(qaPairs, userId, callSid);
  if (analysis.error) {
    throw new Error("LLM analysis failed " + JSON.stringify(analysis));
  }

  const { callCategory, languages, satisfaction, upsell, summary } = analysis;

  let ticket = null;

  // rule: if it's a satisfaction/both call and user unhappy -> support ticket
  const shouldMakeSupportTicket =
    (callCategory === "satisfaction" || callCategory === "both") &&
    satisfaction.isSatisfied === false;

  // rule: else if it's an upsell/both call and user is interested -> sales ticket
  const shouldMakeSalesTicket =
    !shouldMakeSupportTicket &&
    (callCategory === "upsell" || callCategory === "both") &&
    upsell.interestedInOffer === true;

  if (shouldMakeSupportTicket || shouldMakeSalesTicket) {
    const { agentId } = await getLeastLoadedAgent();

    ticket = await Ticket.create({
      status: "open",
      ticketType: shouldMakeSupportTicket ? "support" : "sales",
      priority: "medium",
      proposedSolution: shouldMakeSupportTicket
        ? null
        : upsell.recOption && upsell.recOption !== "not specified"
        ? upsell.recOption
        : null,
      isSatisfied: shouldMakeSupportTicket ? false : null,
      summary:
        summary ||
        (shouldMakeSupportTicket
          ? "Customer not satisfied"
          : "Customer interested in offer"),
      userId: userId,
      agentId: agentId || null,
    });
  }

  // update user flags based on category
  if (callCategory === "satisfaction") {
    await user.update({ isSatisfactionCall: true });
  } else if (callCategory === "upsell") {
    await user.update({ isUpSellCall: true });
  } else if (callCategory === "both") {
    await user.update({ isBothCall: true });
  }

  // final Call row
  const callRecord = await Call.create({
    type: "outbound",
    userId: userId,
    ticketId: ticket ? ticket.id : null,
    QuestionsAnswers: qaPairs || null,
    languages: languages || null,
    isResolvedByAi: null,
    summary: summary || "",
    recordingUrl: null,
    callSid: callSid || null,
    outboundDetails: null,
    callCategory: callCategory || null,
    customerSatisfied: satisfaction.isSatisfied,
    customerInterestedInUpsell: upsell.interestedInOffer,
  });

  return {
    call: callRecord.toJSON(),
    ticket: ticket ? ticket.toJSON() : null,
    user: await user.reload().then((u) => u.toJSON()),
    analysis,
  };
}

export default processCallOutcome;
