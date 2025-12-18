// routes/outbound-upsell.js
import { Router } from "express";
const router = Router();

// Accept /outbound-upsell/:userId with any number of leading slashes
router.all(/^\/+outbound-upsell\/([^/]+)$/, async (req, res) => {
  const userId = req.params[0]; // from regex capture
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";

  const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/upsell-stream/${encodeURIComponent(
    userId
  )}?kind=${encodeURIComponent(kind)}`;

  console.log("USER ID RECIEVED ON TWALIO ROUTE1", userId);
  console.log(
    `[HTTP] /outbound-upsell from ${req.ip} ua=${req.headers["user-agent"]} userId=${userId} kind=${kind}`
  );

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Pause length="1"/>
    <Say>Hello, this is a call from Get Pie Pay. Please hold for a moment while we connect you with our agent, Max.</Say>
    <Connect>
      <Stream url="${wsUrl}">
        <Parameter name="userId" value="${userId || ""}"/>
        <Parameter name="kind" value="${kind || ""}"/>
      </Stream>
    </Connect>
  </Response>
  `;

  res.type("text/xml").send(twiml);
});

export default router;
