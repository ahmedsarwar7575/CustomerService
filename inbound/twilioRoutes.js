import { Router } from "express";

const router = Router();

router.all("/incoming-call", (req, res) => {
  const WS_HOST = process.env.WS_HOST || "customerservice-kabe.onrender.com";
  const wsUrl = `wss://${WS_HOST}/media-stream`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Start>
      <Record
        recordingStatusCallback="https://customerservice-kabe.onrender.com/recording-status"
        recordingStatusCallbackEvent="completed"
      />
    </Start>
    <Say>Please wait while we connect your call to the AI assistant.</Say>
    <Connect>
      <Stream url="${wsUrl}" />
    </Connect>
  </Response>`;

  res.type("text/xml").send(twiml);
});

export default router;
