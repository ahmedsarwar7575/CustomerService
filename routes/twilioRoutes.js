// src/routes/twilioRoutes.js
import { Router } from 'express';

const router = Router();

router.all('/incoming-call', (req, res) => {
  const host = req.get('host');
  const wsUrl = `wss://${host}/media-stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please wait while we connect your call to the A. I. voice assistant, powered by Twilio and the Open A. I. Realtime API.</Say>
  <Pause length="1"/>
  <Say>O.K., you can start talking!</Say>
  <Connect>
    <Stream url="${wsUrl}" bidirectional="true" />
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});

export default router;
