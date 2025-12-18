// inbound/twilioRoutes.js
import { Router } from "express";
const router = Router();

router.all("/incoming-call", async (req, res) => {
  const WS_HOST =
    process.env.WS_HOST ||
    req.get("host") ||
    "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/media-stream`;

  // Twilio sends these in the webhook POST body
  const from = req.body?.From || "";
  const to = req.body?.To || "";
  const callSid = req.body?.CallSid || "";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
  <Pause length="2"/>
  <Say>Welcome to Get Pie Pay. Please hold for a moment while I connect you with Max.</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${from}"/>
      <Parameter name="to" value="${to}"/>
      <Parameter name="callSid" value="${callSid}"/>
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

export default router;
