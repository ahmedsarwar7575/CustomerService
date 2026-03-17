import twilio from "twilio";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sequelize from "../config/db.js";
import Agent from "../models/agent.js";
import Call from "../models/Call.js";
import Ticket from "../models/ticket.js";
import User from "../models/user.js";

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

function str(value) {
  return String(value || "").trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function getBaseUrl(req) {
  const envUrl = str(process.env.PUBLIC_BASE_URL);
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const forwardedProto = str(req.headers["x-forwarded-proto"]).split(",")[0].trim();
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
  return str(process.env.TWILIO_ACCOUNT_SID_SDK || process.env.TWILIO_ACCOUNT_SID);
}

function getVoiceApiKeySid() {
  return str(process.env.TWILIO_API_KEY_SID_SDK);
}

function getVoiceApiKeySecret() {
  return str(process.env.TWILIO_API_KEY_SECRET_SDK);
}

function getVoiceAppSid() {
  return str(process.env.TWILIO_TWIML_APP_SID_SDK || process.env.TWILIO_TWIML_APP_SID);
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
    Object.entries(payload).filter(([key, value]) => allowed.has(key) && value !== undefined)
  );
}

function getEnumValues(Model, field) {
  return arr(Model?.rawAttributes?.[field]?.values);
}

function resolveCallType(direction) {
  const values = getEnumValues(Call, "type");
  const preferred = direction === "inbound" ? "manual_inbound" : "manual_outbound";

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

function getAgentFromReq(req) {
  const source = req.user || req.agent || {};
  const id =
    source.id ||
    source.agentId ||
    source.AgentId ||
    source?.dataValues?.id ||
    source?.dataValues?.agentId ||
    null;

  if (!id) {
    throw new Error("Authenticated agent ID is missing on the request.");
  }

  return {
    id: Number(id),
    email: source.email || source?.dataValues?.email || null,
    firstName: source.firstName || source?.dataValues?.firstName || null,
    lastName: source.lastName || source?.dataValues?.lastName || null,
  };
}

function buildAgentIdentity(agentId) {
  return `manual_agent_${agentId}`;
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

async function saveOrUpdateCall({ callSid, direction, from, to, agentId, patchMeta = {} }) {
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

  if (existing) {
    await existing.update(payload);
    return existing.reload();
  }

  const created = await Call.create(payload);
  return created;
}

export async function createVoiceAccessToken(req) {
  const agent = getAgentFromReq(req);

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
    agent: {
      id: agent.id,
      email: agent.email,
      name: [agent.firstName, agent.lastName].filter(Boolean).join(" ").trim() || null,
    },
  };
}

export async function resolveInboundIdentities() {
  const singleIdentity = str(process.env.MANUAL_INBOUND_AGENT_IDENTITY);
  if (singleIdentity) {
    return [singleIdentity];
  }

  const agents = await Agent.findAll({
    where: { isActive: true },
    attributes: ["id"],
    order: [["id", "ASC"]],
    limit: 10,
  });

  return agents.map((agent) => buildAgentIdentity(agent.id));
}

export async function handleOutboundVoiceRequest(body) {
  const to = str(body.To);
  if (!to) {
    throw new Error("Missing destination number or client identity.");
  }

  const callerId = getCallerId();
  if (!callerId) {
    throw new Error("TWILIO_CALLER_ID_SDK or TWILIO_CALLER_ID is missing.");
  }

  const callSid = str(body.CallSid);
  const from = str(body.From || body.Caller || "");
  const agentId = parseAgentIdFromIdentity(from);

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

export async function handleInboundVoiceRequest(body) {
  const callSid = str(body.CallSid);
  const from = str(body.From || body.Caller || "");
  const to = str(body.To || body.Called || "");
  const identities = await resolveInboundIdentities();

  await saveOrUpdateCall({
    callSid,
    direction: "inbound",
    from,
    to,
    agentId: null,
    patchMeta: {
      status: "initiated",
      startedAt: new Date().toISOString(),
      events: [buildWebhookEvent(body, "inbound_voice_request")],
    },
  });

  return { identities };
}

export async function handleCallStatusWebhook(body) {
  const candidateSid = str(body.ParentCallSid || body.CallSid || body.DialCallSid);
  const from = str(body.From || body.Caller || "");
  const to = str(body.To || body.Called || "");
  const direction = inferDirection(from, to);

  let call = await findCallByAnySid([
    body.ParentCallSid,
    body.CallSid,
    body.DialCallSid,
  ]);

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
    status: str(body.DialCallStatus || body.CallStatus || meta.status || "unknown"),
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

  return {
    callSid: call.callSid,
  };
}

export async function handleRecordingWebhook(body) {
  const callSid = str(body.CallSid || body.ParentCallSid);
  const recordingStatus = str(body.RecordingStatus);
  const recordingUrl = str(body.RecordingUrl);
  const recordingSid = str(body.RecordingSid);

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
    recordingSid: recordingSid || obj(call.outboundDetails).recordingSid || null,
    recordingStatus: recordingStatus || obj(call.outboundDetails).recordingStatus || null,
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

  return {
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
}

export async function updateCallRecordingMeta(callSid, patch) {
  const call = await findCallByAnySid([callSid]);
  if (!call) {
    throw new Error(`Call not found for CallSid ${callSid}.`);
  }

  const nextMeta = buildManualMeta(call.outboundDetails, patch);

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

  const meta = buildManualMeta(call.outboundDetails, {
    transcriptionStatus:
      stage === "transcription" ? "failed" : obj(call.outboundDetails).transcriptionStatus || null,
    analysisStatus:
      stage === "analysis" ? "failed" : obj(call.outboundDetails).analysisStatus || null,
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
    Boolean(analysis?.isMeaningfulConversation) && str(transcriptText).length >= 15;

  return sequelize.transaction(async (transaction) => {
    const currentMeta = obj(call.outboundDetails);
    const customerPhone = str(currentMeta.customerPhone) || null;
    const agentId = currentMeta.agentId || null;

    let user = null;

    if (meaningful && customerPhone) {
      user = await User.findOne({
        where: { phone: customerPhone },
        transaction,
      });

      if (!user) {
        const userPayload = pickAllowedFields(User, {
          name: normalizeName(analysis?.customerName),
          phone: customerPhone,
          role: "user",
          status: "active",
        });

        user = await User.create(userPayload, { transaction });
      }
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

      ticket = await Ticket.create(ticketPayload, { transaction });
    }

    const nextMeta = buildManualMeta(currentMeta, {
      recordingSid: recordingMeta.recordingSid || currentMeta.recordingSid || null,
      recordingStatus: recordingMeta.recordingStatus || currentMeta.recordingStatus || "completed",
      recordingDurationSeconds:
        recordingMeta.recordingDuration ||
        currentMeta.recordingDurationSeconds ||
        null,
      recordingChannels:
        recordingMeta.recordingChannels || currentMeta.recordingChannels || null,
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

    await call.update(callPayload, { transaction });

    return {
      callSid: call.callSid,
      userId: user?.id || null,
      ticketId: ticket?.id || null,
      meaningful,
    };
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