// inbound/twilioRoutes.js
import { Router } from "express";
import twilio from "twilio";

const router = Router();
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

router.all("/incoming-call", async (req, res) => {
  const WS_HOST =
    process.env.WS_HOST ||
    req.get("host") ||
    "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/media-stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please wait while we connect your call to the AI assistant.</Say>
  <Connect><Stream url="${wsUrl}" /></Connect>
</Response>`;
  res.type("text/xml").send(twiml);

  const callSid = req.body?.CallSid || req.query?.CallSid;
  if (!callSid) return;

  const base = process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`;
  try {
    await client.calls(callSid).recordings.create({
      recordingStatusCallback: `${base}/recording-status`,
      recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
      recordingChannels: "dual",
      recordingTrack: "both",
    });
  } catch (e) {
    console.error("recording start failed:", e);
  }
});

export default router;
