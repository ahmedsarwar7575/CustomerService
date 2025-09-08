import { Router } from "express";

const router = Router();
router.all("/incoming-call", async (req, res) => {
  const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/media-stream`;

  // TwiML: just greet + connect the bidirectional stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please wait while we connect your call to the AI assistant.</Say>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);

  // IMPORTANT: Start recording via REST on the live call
  const callSid =
    (req.body && req.body.CallSid) || (req.query && req.query.CallSid);
  if (!callSid) return console.warn("No CallSid in /incoming-call webhook");

  const base = process.env.PUBLIC_BASE_URL; // e.g. https://your-app.onrender.com
  try {
    const recording = await req.twilioClient.calls(callSid).recordings.create({
      recordingStatusCallback: `${base}/recording-status`,
      recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
      recordingChannels: "dual",
      recordingTrack: "both",
    });
    console.log("▶️ started recording:", recording.sid);
  } catch (e) {
    console.error("❌ failed to start recording:", e);
  }
});

export default router;
