import { Router } from "express";

const router = Router();
router.all("/incoming-call", async (req, res) => {
  const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/media-stream`;

  // TwiML: just greet + connect the bidirectional stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello, Welcome to GET PIE Customer Support. How can I help you today?</Say>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);

});

export default router;
