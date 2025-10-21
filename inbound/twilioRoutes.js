// inbound/twilioRoutes.js
import { Router } from "express";

const router = Router();


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


});

export default router;
