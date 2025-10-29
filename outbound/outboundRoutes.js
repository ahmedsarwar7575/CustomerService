// routes/outbound-upsell.ts
import { Router } from "express";
const router = Router();

router.all("/outbound-upsell/:userId", async (req, res) => {
  const { userId } = req.params;
  const {kind} = req.query
  // In prod, use a stable public domain instead of ngrok if possible
  const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/upsell-stream/${userId}?kind=${kind}`;
  console.log("USER ID RECIEVED ON TWALIO ROUTE1", userId);
  console.log(
    `[HTTP] /outbound-upsell from ${req.ip} ua=${req.headers["user-agent"]} userId=${userId}`
  );

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please wait while we connect your call to the AI assistant.</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="userId" value="${userId ?? ""}"/>
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

export default router;
