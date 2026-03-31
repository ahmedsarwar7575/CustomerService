import twilio from "twilio";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sequelize from "../config/db.js";
import Call from "../models/Call.js";
import Ticket from "../models/ticket.js";
import User from "../models/user.js";
import Agent from "../models/agent.js";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

const BUCKET = process.env.AWS_S3_BUCKET || "customersupport";
const FALLBACK_NUMBER = process.env.INBOUND_FALLBACK_NUMBER || "+18557201568";

function getTwilioClient() {
  const accountSid = str(process.env.TWILIO_ACCOUNT_SID);
  const authToken = str(process.env.TWILIO_AUTH_TOKEN);
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing.");
  }
  return twilio(accountSid, authToken);
}

function str(value) {
  return String(value || "").trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function log(label, payload) {
  try {
    console.log(
      `[MANUAL_CALLS_SERVICE] ${label}`,
      JSON.stringify(payload, null, 2)
    );
  } catch {
    console.log(`[MANUAL_CALLS_SERVICE] ${label}`, payload);
  }
}

function mask(value) {
  const text = str(value);
  if (!text) return null;
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function getBaseUrl(req) {
  const envUrl = str(process.env.PUBLIC_BASE_URL);
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  const forwardedProto = str(req.headers["x-forwarded-proto"])
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.get("host");
  return `${protocol}://${host}`;
}

export function absoluteUrl(req, path) {
  return `${getBaseUrl(req)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function normalizePhone(value) {
  const raw = str(value);
  if (!raw) return null;
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

function normalizeEndpoint(value) {
  const raw = str(value);
  if (!raw) return null;
  if (raw.startsWith("client:")) return raw;
  if (isSafeClientIdentity(raw)) return raw;
  return normalizePhone(raw) || raw;
}

export function isE164(value) {
  return /^\+[1-9]\d{6,14}$/.test(str(value).replace(/\s+/g, ""));
}

export function isSafeClientIdentity(value) {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(str(value));
}

function getVoiceAccountSid() {
  return str(
    process.env.TWILIO_ACCOUNT_SID_SDK || process.env.TWILIO_ACCOUNT_SID
  );
}

function getVoiceApiKeySid() {
  return str(process.env.TWILIO_API_KEY_SID_SDK);
}

function getVoiceApiKeySecret() {
  return str(process.env.TWILIO_API_KEY_SECRET_SDK);
}

function getVoiceAppSid() {
  return str(
    process.env.TWILIO_TWIML_APP_SID_SDK || process.env.TWILIO_TWIML_APP_SID
  );
}

function getCallerId() {
  return str(process.env.TWILIO_CALLER_ID_SDK || process.env.TWILIO_CALLER_ID);
}

function getModelFieldNames(Model) {
  return Object.keys(Model?.rawAttributes || {});
}

function pickAllowedFields(Model, payload) {
  const allowed = new Set(getModelFieldNames(Model));
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => allowed.has(key) && value !== undefined
    )
  );
}

function getEnumValues(Model, field) {
  return arr(Model?.rawAttributes?.[field]?.values);
}

function resolveCallType(direction) {
  const values = getEnumValues(Call, "type");
  const preferred =
    direction === "inbound" ? "manual_inbound" : "manual_outbound";
  if (values.includes(preferred)) return preferred;
  if (values.includes(direction)) return direction;
  return undefined;
}

function sanitizeTicketType(value) {
  const valid = new Set(["support", "sales", "billing"]);
  const normalized = str(value).toLowerCase();
  return valid.has(normalized) ? normalized : null;
}

function sanitizePriority(value) {
  const valid = new Set(["low", "medium", "high", "critical"]);
  const normalized = str(value).toLowerCase();
  return valid.has(normalized) ? normalized : "medium";
}

function sanitizeCallCategory(value) {
  const valid = new Set(["satisfaction", "upsell", "both", "other"]);
  const normalized = str(value).toLowerCase();
  return valid.has(normalized) ? normalized : "other";
}

function parseIntSafe(value) {
  const num = Number.parseInt(str(value), 10);
  return Number.isFinite(num) ? num : null;
}

function parseAgentIdFromIdentity(value) {
  const raw = str(value).replace(/^client:/, "");
  const match = raw.match(/manual_agent_(\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizeName(value) {
  const raw = str(value).replace(/\s+/g, " ");
  if (!raw) return "Unknown";
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .slice(0, 100);
}

function buildAgentIdentity(agentId) {
  return `manual_agent_${agentId}`;
}

export function makeAgentIdentity(agentId) {
  return buildAgentIdentity(agentId);
}

function buildManualMeta(existing, patch) {
  const current = obj(existing);
  const currentEvents = arr(current.events);
  const nextEvents = arr(patch.events);
  return {
    ...current,
    ...patch,
    events: [...currentEvents, ...nextEvents].slice(-50),
  };
}

function buildWebhookEvent(body, kind) {
  return {
    kind,
    at: new Date().toISOString(),
    callSid: str(body.CallSid) || null,
    parentCallSid: str(body.ParentCallSid) || null,
    callStatus: str(body.CallStatus) || null,
    dialCallStatus: str(body.DialCallStatus) || null,
    recordingStatus: str(body.RecordingStatus) || null,
    from: str(body.From || body.Caller) || null,
    to: str(body.To || body.Called) || null,
  };
}

async function findCallByAnySid(candidates) {
  const unique = [...new Set(arr(candidates).map(str).filter(Boolean))];
  for (const sid of unique) {
    const call = await Call.findOne({ where: { callSid: sid } });
    if (call) return call;
  }
  return null;
}

function inferDirection(from, to) {
  const fromRaw = str(from);
  const toRaw = str(to);
  if (fromRaw.startsWith("client:") && !toRaw.startsWith("client:")) {
    return "outbound";
  }
  if (!fromRaw.startsWith("client:") && toRaw.startsWith("client:")) {
    return "inbound";
  }
  return "outbound";
}

function inferCustomerPhone(direction, from, to) {
  if (direction === "inbound") {
    return normalizePhone(from);
  }
  if (direction === "outbound") {
    return normalizePhone(to);
  }
  return normalizePhone(from) || normalizePhone(to);
}

async function saveOrUpdateCall({
  callSid,
  direction,
  from,
  to,
  agentId,
  patchMeta = {},
}) {
  if (!str(callSid)) {
    throw new Error("CallSid is required to save a manual call.");
  }

  const existing = await Call.findOne({ where: { callSid } });
  const type = resolveCallType(direction);
  const customerPhone = inferCustomerPhone(direction, from, to);

  const nextMeta = buildManualMeta(existing?.outboundDetails, {
    source: "manual-calls",
    direction,
    fromEndpoint: normalizeEndpoint(from),
    toEndpoint: normalizeEndpoint(to),
    customerPhone,
    agentId: agentId || existing?.outboundDetails?.agentId || null,
    ...patchMeta,
  });

  const payload = pickAllowedFields(Call, {
    callSid,
    type,
    isManualCall: true,
    outboundDetails: nextMeta,
  });

  log("SAVE_OR_UPDATE_CALL", {
    callSid,
    direction,
    from,
    to,
    agentId,
    type,
    customerPhone,
    existing: Boolean(existing),
    payloadKeys: Object.keys(payload),
  });

  if (existing) {
    await existing.update(payload);
    return existing.reload();
  }

  const created = await Call.create(payload);
  return created;
}

export async function getAgentsByPriority() {
  const agents = await Agent.findAll({
    where: { isActive: true },
    order: [["callPriority", "ASC"]],
  });

  log("GET_AGENTS_BY_PRIORITY", {
    count: agents.length,
    agents: agents.map((a) => ({
      id: a.id,
      name: `${a.firstName} ${a.lastName}`,
      twilioNumber: a.twilioNumber || null,
      callPriority: a.callPriority ?? null,
    })),
  });

  return agents;
}

export async function isAgentBusy(twilioNumber) {
  if (!twilioNumber) return true;

  try {
    const client = getTwilioClient();

    const [inboundCalls, outboundCalls] = await Promise.all([
      client.calls.list({ to: twilioNumber, status: "in-progress" }),
      client.calls.list({ from: twilioNumber, status: "in-progress" }),
    ]);

    const busy = inboundCalls.length > 0 || outboundCalls.length > 0;

    log("IS_AGENT_BUSY", {
      twilioNumber,
      inboundActive: inboundCalls.length,
      outboundActive: outboundCalls.length,
      busy,
    });

    return busy;
  } catch (error) {
    log("IS_AGENT_BUSY_ERROR", {
      twilioNumber,
      message: error?.message || String(error),
    });
    return true;
  }
}

export async function getNextAvailableAgent(priorityList, alreadyTriedIndex) {
  for (let i = alreadyTriedIndex; i < priorityList.length; i++) {
    const agent = priorityList[i];
    if (!agent.twilioNumber) continue;

    const busy = await isAgentBusy(agent.twilioNumber);

    log("GET_NEXT_AVAILABLE_AGENT_CHECK", {
      agentId: agent.id,
      twilioNumber: agent.twilioNumber,
      priority: agent.callPriority,
      busy,
    });

    if (!busy) {
      return { agent, index: i };
    }
  }

  return null;
}

export async function resolveInboundRouting(callSid, req) {
  const agents = await getAgentsByPriority();

  if (agents.length === 0) {
    log("RESOLVE_INBOUND_ROUTING_NO_AGENTS", { callSid });
    return {
      type: "fallback",
      fallbackNumber: FALLBACK_NUMBER,
      agents: [],
    };
  }

  const result = await getNextAvailableAgent(agents, 0);

  if (!result) {
    log("RESOLVE_INBOUND_ROUTING_ALL_BUSY", { callSid });
    return {
      type: "fallback",
      fallbackNumber: FALLBACK_NUMBER,
      agents,
    };
  }

  log("RESOLVE_INBOUND_ROUTING_AGENT_FOUND", {
    callSid,
    agentId: result.agent.id,
    twilioNumber: result.agent.twilioNumber,
    priority: result.agent.callPriority,
    agentIndex: result.index,
  });

  return {
    type: "agent",
    agent: result.agent,
    agentIndex: result.index,
    agents,
    fallbackNumber: FALLBACK_NUMBER,
  };
}

export async function resolveNextAgentRouting(callSid, currentIndex) {
  const agents = await getAgentsByPriority();
  const nextIndex = currentIndex + 1;

  if (nextIndex >= agents.length) {
    log("RESOLVE_NEXT_AGENT_ROUTING_EXHAUSTED", { callSid, nextIndex });
    return {
      type: "fallback",
      fallbackNumber: FALLBACK_NUMBER,
      agents,
    };
  }

  const result = await getNextAvailableAgent(agents, nextIndex);

  if (!result) {
    log("RESOLVE_NEXT_AGENT_ROUTING_ALL_BUSY", { callSid });
    return {
      type: "fallback",
      fallbackNumber: FALLBACK_NUMBER,
      agents,
    };
  }

  log("RESOLVE_NEXT_AGENT_ROUTING_FOUND", {
    callSid,
    agentId: result.agent.id,
    twilioNumber: result.agent.twilioNumber,
    agentIndex: result.index,
  });

  return {
    type: "agent",
    agent: result.agent,
    agentIndex: result.index,
    agents,
    fallbackNumber: FALLBACK_NUMBER,
  };
}

export async function getAgentForRequest(req) {
  const agentId =
    req?.user?.id ||
    req?.agent?.id ||
    req?.query?.agentId ||
    req?.body?.agentId ||
    null;

  if (!agentId) {
    throw new Error(
      "agentId is required. Pass it as a query param: /manual-calls/token?agentId=1"
    );
  }

  const agent = await Agent.findByPk(agentId);

  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found.`);
  }

  if (!agent.isActive) {
    throw new Error(`Agent ${agentId} is inactive and cannot place calls.`);
  }

  if (!agent.twilioNumber) {
    throw new Error(
      `Agent ${agentId} does not have a Twilio number assigned. Please set twilioNumber in the agents table.`
    );
  }

  return agent;
}

export async function createVoiceAccessToken(req) {
  const agent = await getAgentForRequest(req);

  const accountSid = getVoiceAccountSid();
  const apiKeySid = getVoiceApiKeySid();
  const apiKeySecret = getVoiceApiKeySecret();
  const twimlAppSid = getVoiceAppSid();

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error(
      "Twilio Voice token configuration is incomplete. Check account SID, API key SID, API key secret, and TwiML App SID."
    );
  }

  const identity = buildAgentIdentity(agent.id);

  log("VOICE_TOKEN_CONFIG", {
    accountSid: mask(accountSid),
    apiKeySid: mask(apiKeySid),
    twimlAppSid: mask(twimlAppSid),
    identity,
    twilioNumber: agent.twilioNumber || null,
    baseUrl: getBaseUrl(req),
  });

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    })
  );

  return {
    token: token.toJwt(),
    identity,
    callerId: agent.twilioNumber || getCallerId(),
    agent: {
      id: agent.id,
      email: agent.email,
      name:
        [agent.firstName, agent.lastName].filter(Boolean).join(" ").trim() ||
        null,
      twilioNumber: agent.twilioNumber || null,
    },
  };
}

export async function handleOutboundVoiceRequest(body) {
  const to = str(body.To);
  if (!to) {
    throw new Error("Missing destination number or client identity.");
  }

  const from = str(body.From || body.Caller || "");
  const agentId = parseAgentIdFromIdentity(from);

  let callerId = getCallerId();

  if (agentId) {
    const agent = await Agent.findByPk(agentId);
    if (agent && agent.twilioNumber) {
      callerId = agent.twilioNumber;
    }
  }

  if (!callerId) {
    throw new Error("No callerId could be resolved for this outbound call.");
  }

  const callSid = str(body.CallSid);

  log("HANDLE_OUTBOUND_VOICE_REQUEST", {
    callSid,
    from,
    to,
    callerId,
    agentId,
  });

  await saveOrUpdateCall({
    callSid,
    direction: "outbound",
    from,
    to,
    agentId,
    patchMeta: {
      status: "initiated",
      startedAt: new Date().toISOString(),
      events: [buildWebhookEvent(body, "outbound_voice_request")],
    },
  });

  return { to, callerId };
}

export async function handleInboundVoiceRequest(body, req) {
  const callSid = str(body.CallSid);
  const from = str(body.From || body.Caller || "");
  const to = str(body.To || body.Called || "");

  log("HANDLE_INBOUND_VOICE_REQUEST", { callSid, from, to });

  const routing = await resolveInboundRouting(callSid, req);

  await saveOrUpdateCall({
    callSid,
    direction: "inbound",
    from,
    to,
    agentId: routing.type === "agent" ? routing.agent.id : null,
    patchMeta: {
      status: "initiated",
      startedAt: new Date().toISOString(),
      inboundRouting: {
        type: routing.type,
        agentId: routing.type === "agent" ? routing.agent.id : null,
        agentNumber:
          routing.type === "agent" ? routing.agent.twilioNumber : null,
        agentIndex: routing.type === "agent" ? routing.agentIndex : null,
        totalAgents: routing.agents.length,
      },
      events: [buildWebhookEvent(body, "inbound_voice_request")],
    },
  });

  return routing;
}

export async function handleNextAgentRequest(body, req) {
  const callSid = str(body.CallSid || body.ParentCallSid || "");
  const dialCallStatus = str(body.DialCallStatus || "").toLowerCase();

  log("HANDLE_NEXT_AGENT_REQUEST", {
    callSid,
    dialCallStatus,
    body,
  });

  if (dialCallStatus === "completed" || dialCallStatus === "answered") {
    log("HANDLE_NEXT_AGENT_REQUEST_ALREADY_ANSWERED", { callSid });
    return { type: "done" };
  }

  const call = await findCallByAnySid([callSid]);
  const currentIndex = call?.outboundDetails?.inboundRouting?.agentIndex ?? -1;

  const routing = await resolveNextAgentRouting(callSid, currentIndex);

  if (call) {
    const nextMeta = buildManualMeta(call.outboundDetails, {
      inboundRouting: {
        type: routing.type,
        agentId: routing.type === "agent" ? routing.agent.id : null,
        agentNumber:
          routing.type === "agent" ? routing.agent.twilioNumber : null,
        agentIndex: routing.type === "agent" ? routing.agentIndex : null,
        totalAgents: routing.agents.length,
      },
      events: [buildWebhookEvent(body, "next_agent_routing")],
    });

    await call.update(
      pickAllowedFields(Call, {
        outboundDetails: nextMeta,
        isManualCall: true,
      })
    );
  }

  return routing;
}

export async function handleCallStatusWebhook(body) {
  const candidateSid = str(
    body.ParentCallSid || body.CallSid || body.DialCallSid
  );
  const from = str(body.From || body.Caller || "");
  const to = str(body.To || body.Called || "");
  const direction = inferDirection(from, to);

  log("HANDLE_CALL_STATUS_WEBHOOK_START", {
    candidateSid,
    callSid: str(body.CallSid),
    parentCallSid: str(body.ParentCallSid),
    dialCallSid: str(body.DialCallSid),
    callStatus: str(body.CallStatus),
    dialCallStatus: str(body.DialCallStatus),
    from,
    to,
    direction,
  });

  let call = await findCallByAnySid([
    body.ParentCallSid,
    body.CallSid,
    body.DialCallSid,
  ]);

  log("HANDLE_CALL_STATUS_WEBHOOK_LOOKUP", {
    foundCallSid: call?.callSid || null,
  });

  if (!call) {
    call = await saveOrUpdateCall({
      callSid: candidateSid,
      direction,
      from,
      to,
      agentId: parseAgentIdFromIdentity(from) || parseAgentIdFromIdentity(to),
      patchMeta: {
        status: str(body.DialCallStatus || body.CallStatus || "initiated"),
        events: [buildWebhookEvent(body, "status_webhook_create")],
      },
    });
  }

  const meta = obj(call.outboundDetails);
  const durationSeconds =
    parseIntSafe(body.CallDuration) || parseIntSafe(body.DialCallDuration);

  const nextMeta = buildManualMeta(meta, {
    status: str(
      body.DialCallStatus || body.CallStatus || meta.status || "unknown"
    ),
    answeredAt:
      str(body.CallStatus).toLowerCase() === "in-progress" ||
      str(body.DialCallStatus).toLowerCase() === "answered"
        ? meta.answeredAt || new Date().toISOString()
        : meta.answeredAt || null,
    endedAt:
      durationSeconds !== null ||
      ["completed", "busy", "failed", "no-answer", "canceled"].includes(
        str(body.DialCallStatus || body.CallStatus).toLowerCase()
      )
        ? new Date().toISOString()
        : meta.endedAt || null,
    durationSeconds: durationSeconds ?? meta.durationSeconds ?? null,
    agentId:
      parseAgentIdFromIdentity(from) ||
      parseAgentIdFromIdentity(to) ||
      meta.agentId ||
      null,
    events: [buildWebhookEvent(body, "status_webhook")],
  });

  const payload = pickAllowedFields(Call, {
    outboundDetails: nextMeta,
    isManualCall: true,
  });

  await call.update(payload);

  log("HANDLE_CALL_STATUS_WEBHOOK_DONE", {
    storedCallSid: call.callSid,
    updatedStatus: nextMeta.status,
  });

  return { callSid: call.callSid };
}

export async function handleRecordingWebhook(body) {
  const callSid = str(body.CallSid || body.ParentCallSid);
  const recordingStatus = str(body.RecordingStatus);
  const recordingUrl = str(body.RecordingUrl);
  const recordingSid = str(body.RecordingSid);

  log("HANDLE_RECORDING_WEBHOOK_START", {
    callSid,
    recordingSid,
    recordingStatus,
    recordingUrl,
    recordingDuration: parseIntSafe(body.RecordingDuration),
    recordingChannels: parseIntSafe(body.RecordingChannels),
  });

  if (!callSid) {
    throw new Error("Recording webhook is missing CallSid.");
  }

  let call = await findCallByAnySid([body.CallSid, body.ParentCallSid]);

  if (!call) {
    call = await saveOrUpdateCall({
      callSid,
      direction: "outbound",
      from: str(body.From || ""),
      to: str(body.To || ""),
      agentId: null,
      patchMeta: {
        status: "completed",
        events: [buildWebhookEvent(body, "recording_webhook_create")],
      },
    });
  }

  const meta = buildManualMeta(call.outboundDetails, {
    recordingSid:
      recordingSid || obj(call.outboundDetails).recordingSid || null,
    recordingStatus:
      recordingStatus || obj(call.outboundDetails).recordingStatus || null,
    recordingDurationSeconds:
      parseIntSafe(body.RecordingDuration) ||
      obj(call.outboundDetails).recordingDurationSeconds ||
      null,
    recordingChannels:
      parseIntSafe(body.RecordingChannels) ||
      obj(call.outboundDetails).recordingChannels ||
      null,
    events: [buildWebhookEvent(body, "recording_webhook")],
  });

  await call.update(
    pickAllowedFields(Call, {
      outboundDetails: meta,
      isManualCall: true,
    })
  );

  const result = {
    shouldProcess:
      recordingStatus.toLowerCase() === "completed" &&
      Boolean(recordingUrl) &&
      Boolean(recordingSid),
    callSid,
    recordingSid,
    recordingUrl,
    recordingStatus,
    recordingDuration: parseIntSafe(body.RecordingDuration),
    recordingChannels: parseIntSafe(body.RecordingChannels),
  };

  log("HANDLE_RECORDING_WEBHOOK_DONE", result);

  return result;
}

export async function updateCallRecordingMeta(callSid, patch) {
  const call = await findCallByAnySid([callSid]);
  if (!call) {
    throw new Error(`Call not found for CallSid ${callSid}.`);
  }

  const nextMeta = buildManualMeta(call.outboundDetails, patch);

  log("UPDATE_CALL_RECORDING_META", { callSid, patch });

  await call.update(
    pickAllowedFields(Call, {
      outboundDetails: nextMeta,
      recordingUrl: patch.s3Key || call.recordingUrl || null,
      isManualCall: true,
    })
  );

  return call.reload();
}

export async function markManualCallProcessingFailed(callSid, stage, error) {
  const call = await findCallByAnySid([callSid]);
  if (!call) return null;

  log("MARK_MANUAL_CALL_PROCESSING_FAILED", {
    callSid,
    stage,
    message: error?.message || String(error),
  });

  const meta = buildManualMeta(call.outboundDetails, {
    transcriptionStatus:
      stage === "transcription"
        ? "failed"
        : obj(call.outboundDetails).transcriptionStatus || null,
    analysisStatus:
      stage === "analysis"
        ? "failed"
        : obj(call.outboundDetails).analysisStatus || null,
    lastProcessingError: error?.message || String(error),
    lastFailedStage: stage,
    events: [
      {
        kind: "processing_failed",
        stage,
        at: new Date().toISOString(),
        message: error?.message || String(error),
      },
    ],
  });

  await call.update(
    pickAllowedFields(Call, {
      outboundDetails: meta,
      isManualCall: true,
    })
  );

  return call.reload();
}

export async function finalizeManualCallProcessing({
  callSid,
  s3Key,
  transcriptText,
  analysis,
  recordingMeta = {},
}) {
  const call = await findCallByAnySid([callSid]);

  if (!call) {
    throw new Error(`Call not found while finalizing CallSid ${callSid}.`);
  }

  const meaningful =
    Boolean(analysis?.isMeaningfulConversation) &&
    str(transcriptText).length >= 15;

  log("FINALIZE_MANUAL_CALL_PROCESSING_START", {
    callSid,
    s3Key,
    transcriptLength: str(transcriptText).length,
    meaningful,
    issueResolved: analysis?.issueResolved,
    customerName: analysis?.customerName || "",
    languages: analysis?.languages || [],
    ticketType: analysis?.ticketType || null,
    priority: analysis?.priority || null,
    callCategory: analysis?.callCategory || null,
  });

  return sequelize.transaction(async (transaction) => {
    log("FINALIZE_MANUAL_CALL_PROCESSING_TRANSACTION_BEGIN", { callSid });

    const currentMeta = obj(call.outboundDetails);
    const customerPhone = str(currentMeta.customerPhone) || null;
    const agentId = currentMeta.agentId || null;

    let user = null;

    if (meaningful && customerPhone) {
      user = await User.findOne({
        where: { phone: customerPhone },
        transaction,
      });

      log("FINALIZE_USER_LOOKUP", {
        callSid,
        customerPhone,
        foundUserId: user?.id || null,
      });

      if (!user) {
        const userPayload = pickAllowedFields(User, {
          name: normalizeName(analysis?.customerName),
          phone: customerPhone,
          role: "user",
          status: "active",
        });

        log("FINALIZE_USER_CREATE", { callSid, userPayload });

        user = await User.create(userPayload, { transaction });
      }
    } else {
      log("FINALIZE_USER_SKIPPED", { callSid, meaningful, customerPhone });
    }

    let ticket = null;
    const shouldCreateTicket = meaningful && analysis?.issueResolved === false;

    if (shouldCreateTicket) {
      const ticketPayload = pickAllowedFields(Ticket, {
        status: "open",
        ticketType: sanitizeTicketType(analysis?.ticketType),
        priority: sanitizePriority(analysis?.priority),
        summary: str(analysis?.summary) || "Manual call requires follow-up.",
        userId: user?.id || null,
        agentId: agentId || null,
        isManualCall: true,
      });

      log("FINALIZE_TICKET_CREATE", { callSid, ticketPayload });

      ticket = await Ticket.create(ticketPayload, { transaction });
    } else {
      log("FINALIZE_TICKET_SKIPPED", {
        callSid,
        meaningful,
        issueResolved: analysis?.issueResolved,
      });
    }

    const nextMeta = buildManualMeta(currentMeta, {
      recordingSid:
        recordingMeta.recordingSid || currentMeta.recordingSid || null,
      recordingStatus:
        recordingMeta.recordingStatus ||
        currentMeta.recordingStatus ||
        "completed",
      recordingDurationSeconds:
        recordingMeta.recordingDuration ||
        currentMeta.recordingDurationSeconds ||
        null,
      recordingChannels:
        recordingMeta.recordingChannels ||
        currentMeta.recordingChannels ||
        null,
      transcriptionStatus: "completed",
      analysisStatus: "completed",
      meaningful,
      processedAt: new Date().toISOString(),
      s3Key,
      events: [
        {
          kind: "post_call_completed",
          at: new Date().toISOString(),
        },
      ],
    });

    const callPayload = pickAllowedFields(Call, {
      userId: user?.id || call.userId || null,
      ticketId: ticket?.id || call.ticketId || null,
      QuestionsAnswers: {
        rawTranscript: transcriptText,
        analysis,
      },
      languages: arr(analysis?.languages),
      summary: meaningful
        ? str(analysis?.summary) || "Manual call processed."
        : "No meaningful conversation detected.",
      recordingUrl: s3Key || call.recordingUrl || null,
      callCategory: sanitizeCallCategory(analysis?.callCategory),
      isResolvedByAi: meaningful ? Boolean(analysis?.issueResolved) : null,
      isManualCall: true,
      outboundDetails: nextMeta,
    });

    log("FINALIZE_CALL_UPDATE", {
      callSid,
      callPayloadKeys: Object.keys(callPayload),
      userId: callPayload.userId || null,
      ticketId: callPayload.ticketId || null,
      summary: callPayload.summary || null,
      languages: callPayload.languages || [],
      callCategory: callPayload.callCategory || null,
      isResolvedByAi: callPayload.isResolvedByAi,
    });

    await call.update(callPayload, { transaction });

    const result = {
      callSid: call.callSid,
      userId: user?.id || null,
      ticketId: ticket?.id || null,
      meaningful,
    };

    log("FINALIZE_MANUAL_CALL_PROCESSING_TRANSACTION_DONE", result);

    return result;
  });
}

export async function getPlaybackUrlByCallSid(callSid) {
  const call = await Call.findOne({ where: { callSid: str(callSid) } });

  if (!call) {
    const error = new Error("Call not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!str(call.recordingUrl)) {
    const error = new Error("No recording key is stored for this call.");
    error.statusCode = 404;
    throw error;
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: call.recordingUrl,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

  return {
    callSid: call.callSid,
    playbackUrl: url,
    recordingKey: call.recordingUrl,
  };
}
