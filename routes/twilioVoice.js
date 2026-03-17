import express from "express";
import twilio from "twilio";

const router = express.Router();

router.use(express.urlencoded({ extended: false }));

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const DEFAULT_IDENTITY = "agent_demo";

function getIdentity(req) {
  return String(req.query.identity || DEFAULT_IDENTITY).trim();
}

function isE164(value = "") {
  const normalized = String(value).replace(/\s+/g, "");
  return /^\+[1-9]\d{6,14}$/.test(normalized);
}

function isSafeClientIdentity(value = "") {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(String(value).trim());
}

function getBaseUrl(req) {
  const envUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const proto =
    String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

function absoluteUrl(req, path) {
  return `${getBaseUrl(req)}${path.startsWith("/") ? path : `/${path}`}`;
}

router.get("/token", (req, res) => {
  const identity = getIdentity(req);

  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID_SDK,
    process.env.TWILIO_API_KEY_SID_SDK,
    process.env.TWILIO_API_KEY_SECRET_SDK,
    { identity, ttl: 3600 }
  );

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID_SDK,
      incomingAllow: true,
    })
  );

  res.json({
    identity,
    token: token.toJwt(),
  });
});

router.post("/voice", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = String(req.body.To || "").trim();

  if (!to) {
    twiml.say("Missing destination.");
    return res.type("text/xml").send(twiml.toString());
  }

  const dialOptions = {
    callerId: process.env.TWILIO_CALLER_ID_SDK,
    action: absoluteUrl(req, "/twilio/dial-result"),
    method: "POST",
    record: "record-from-answer-dual",
    recordingTrack: "both",
    recordingStatusCallback: absoluteUrl(req, "/twilio/recording-status"),
    recordingStatusCallbackMethod: "POST",
  };

  if (isE164(to)) {
    const dial = twiml.dial(dialOptions);
    dial.number(to.replace(/\s+/g, ""));
    return res.type("text/xml").send(twiml.toString());
  }

  if (isSafeClientIdentity(to)) {
    const dial = twiml.dial({
      action: absoluteUrl(req, "/twilio/dial-result"),
      method: "POST",
      record: "record-from-answer-dual",
      recordingTrack: "both",
      recordingStatusCallback: absoluteUrl(req, "/twilio/recording-status"),
      recordingStatusCallbackMethod: "POST",
    });
    dial.client(to);
    return res.type("text/xml").send(twiml.toString());
  }

  twiml.say("Invalid destination.");
  return res.type("text/xml").send(twiml.toString());
});

router.post("/incoming", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const dial = twiml.dial({
    timeout: 20,
    answerOnBridge: true,
    action: absoluteUrl(req, "/twilio/dial-result"),
    method: "POST",
    record: "record-from-answer-dual",
    recordingTrack: "both",
    recordingStatusCallback: absoluteUrl(req, "/twilio/recording-status"),
    recordingStatusCallbackMethod: "POST",
  });

  dial.client(DEFAULT_IDENTITY);

  return res.type("text/xml").send(twiml.toString());
});

router.post("/dial-result", (req, res) => {
  console.log("DIAL RESULT", {
    DialCallStatus: req.body.DialCallStatus,
    DialCallSid: req.body.DialCallSid,
    CallSid: req.body.CallSid,
  });

  const twiml = new twilio.twiml.VoiceResponse();
  return res.type("text/xml").send(twiml.toString());
});

export default router;
