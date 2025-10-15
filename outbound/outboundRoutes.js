// routes-upsell.js
import { Router } from "express";
const router = Router();

router.all("/outbound-upsell", async (req, res) => {
  const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/upsell-stream`;

  const agentName = (req.query.agentName || "xyz").toString();
  const company   = (req.query.company   || "mno").toString();
  const product   = (req.query.product   || "abc").toString();
  const leadId    = (req.query.leadId    || "").toString();

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This call may be recorded. Connecting now.</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="flow"      value="upsell"/>
      <Parameter name="agentName" value="${agentName}"/>
      <Parameter name="company"   value="${company}"/>
      <Parameter name="product"   value="${product}"/>
      <Parameter name="leadId"    value="${leadId}"/>
    </Stream>
  </Connect>
</Response>`;
  res.type("text/xml").send(twiml);
});

export default router;
