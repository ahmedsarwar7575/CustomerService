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


// inbound/twilioRoutes.js
// import { Router } from "express";
// const router = Router();

// router.all("/incoming-call", async (req, res) => {
//   // Put your 3 forwarding numbers in env (E.164 format, like +14155552671)
//   const numbers = [
//     process.env.FORWARD_NUMBER_1,
//     process.env.FORWARD_NUMBER_2,
//     process.env.FORWARD_NUMBER_3,
//   ].filter(Boolean);

//   const ringSeconds = Number(process.env.RING_SECONDS || 20);

//   const twiml = `<?xml version="1.0" encoding="UTF-8"?>
// <Response>
//   <Pause length="1"/>
//   <Say>Welcome to Get Pie Pay. Please hold while I connect you.</Say>

//   ${
//     numbers.length
//       ? `<Dial sequential="true">
//           ${numbers
//             .map((n) => `<Number timeout="${ringSeconds}">${n}</Number>`)
//             .join("\n")}
//         </Dial>
//         <Say>Sorry, we are busy right now. Please try again later.</Say>
//         <Hangup/>`
//       : `<Say>Sorry, we are busy right now. Please try again later.</Say>
//          <Hangup/>`
//   }
// </Response>`;

//   res.type("text/xml").send(twiml);
// });

// export default router;