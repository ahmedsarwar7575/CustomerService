// routes/calls.js
import express, { Router } from "express";
import twilio from "twilio";
import crypto from "crypto";

const router = Router();
router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const log = (label, data = {}) =>
  console.log(`[${new Date().toISOString()}] ${label} ${JSON.stringify(data)}`);

router.use((req, res, next) => {
  const id = crypto.randomUUID().slice(0, 8);
  req.reqId = id;
  log("REQ", {
    id,
    method: req.method,
    path: req.path,
    query: req.query,
    headers: {
      "x-twilio-signature": req.get("x-twilio-signature") || null,
      "user-agent": req.get("user-agent"),
      host: req.get("host"),
      "content-type": req.get("content-type"),
    },
  });
  res.on("finish", () => log("RES", { id, status: res.statusCode }));
  next();
});

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
const BASE = process.env.PUBLIC_BASE_URL; // https://your-ngrok-or-domain
const FROM = process.env.TWILIO_NUMBER;
const AGENT = +15677722608 ;

const confName = () =>
  "room-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(-6);

// POST { "to": "+1..." }
router.post("/api/calls/start", async (req, res) => {
  try {
    if (!BASE || !FROM || !AGENT) throw new Error("Missing env BASE/FROM/AGENT");
    const to = (req.body?.to || "").trim();
    if (!to) return res.status(400).json({ error: "`to` required" });

    const conference = confName();
    log("START_OUTBOUND", { conference, to, agent: AGENT });

    const common = {
      from: FROM,
      statusCallback: `${BASE}/call-status`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    };

    const customerCall = await client.calls.create({
      ...common,
      to,
      url: `${BASE}/twiml/leg?role=customer&conf=${encodeURIComponent(conference)}`,
    });
    log("CUSTOMER_CALL_CREATED", customerCall);

    const agentCall = await client.calls.create({
      ...common,
      to: AGENT,
      url: `${BASE}/twiml/leg?role=agent&conf=${encodeURIComponent(conference)}`,
    });
    log("AGENT_CALL_CREATED", agentCall);

    res.json({
      ok: true,
      conference,
      customerCallSid: customerCall.sid,
      agentCallSid: agentCall.sid,
    });
  } catch (e) {
    log("ERR_START_OUTBOUND", { message: e.message, stack: e.stack });
    res.status(500).json({ error: e.message });
  }
});

// TwiML for both legs: fork audio -> join conference
router.all("/twiml/leg", (req, res) => {
  const role = (req.query.role || req.body.role || "customer").toString();
  const conf = (req.query.conf || req.body.conf || "default").toString();
  const callSid = req.body?.CallSid || req.query?.CallSid || "";
  const wsUrl = `wss://${WS_HOST}/media-stream`;

  log("TWIML_LEG", {
    role,
    conf,
    callSid,
    from: req.body?.From,
    to: req.body?.To,
  });

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}" track="both_tracks" name="stream-${conf}-${role}">
      <Parameter name="role" value="${role}"/>
      <Parameter name="conference" value="${conf}"/>
      <Parameter name="callSid" value="${callSid}"/>
    </Stream>
  </Start>
  <Say voice="alice">Connecting you now.</Say>
  <Dial>
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="${role === "agent" ? "true" : "false"}"
      statusCallback="${BASE}/conference-status"
      statusCallbackEvent="start end join leave speaker"
      record="record-from-start"
      recordingStatusCallback="${BASE}/recording-status"
      recordingStatusCallbackEvent="in-progress completed absent"
    >${conf}</Conference>
  </Dial>
</Response>`;

  res.type("text/xml").send(twiml);
});

router.post("/call-status", (req, res) => {
  log("CALL_STATUS", req.body);
  res.sendStatus(204);
});

router.post("/conference-status", (req, res) => {
  log("CONF_STATUS", req.body);
  res.sendStatus(204);
});

router.post("/recording-status", (req, res) => {
  log("REC_STATUS", req.body);
  res.sendStatus(204);
});

export default router;
