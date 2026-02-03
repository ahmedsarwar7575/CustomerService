import express from "express";
import twilio from "twilio";

const router = express.Router();

// For Twilio webhooks (POST form-encoded)
router.use(express.urlencoded({ extended: false }));

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

function getIdentity(req) {
  return req.query.identity || "agent_demo";
}

function isE164(str = "") {
  return /^\+?[1-9]\d{6,14}$/.test(str.replace(/\s+/g, ""));
}

// ✅ 1) Token endpoint for browser
router.get("/token", (req, res) => {
  const identity = getIdentity(req);

  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID_SDK,
    process.env.TWILIO_API_KEY_SID_SDK,
    process.env.TWILIO_API_KEY_SECRET_SDK,
    { identity, ttl: 3600 }
  );

  const grant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID_SDK,
    incomingAllow: true,
  });

  token.addGrant(grant);

  res.json({ identity, token: token.toJwt() });
});

// ✅ 2) TwiML for outbound calls from browser
router.post("/voice", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to = req.body.To;

  if (!to) {
    twiml.say("Missing To.");
    return res.type("text/xml").send(twiml.toString());
  }

  if (isE164(to)) {
    const dial = twiml.dial({ callerId: process.env.TWILIO_CALLER_ID_SDK });
    dial.number(to);
  } else {
    const dial = twiml.dial();
    dial.client(to);
  }

  res.type("text/xml").send(twiml.toString());
});

// ✅ 3) TwiML for inbound calls to ring your web agent
router.post("/incoming", (req, res) => {
  console.log(req.body);
  console.log("Incoming call");
  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial();
  dial.client("agent_demo");
  res.type("text/xml").send(twiml.toString());
});

export default router;
