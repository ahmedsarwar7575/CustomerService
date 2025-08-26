// call.js
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER, // your 2nd Twilio number (caller)
  TWILIO_TO_NUMBER,   // your 1st Twilio number (AI answers here)
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
  console.error('Missing env vars. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TO_NUMBER');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

(async () => {
  try {
    const call = await client.calls.create({
      from: TWILIO_FROM_NUMBER,
      to:   TWILIO_TO_NUMBER,
      // This URL controls what the *caller leg* (your 2nd number) hears.
      // Keep Twilio’s demo TwiML or replace with your own if you want.
      url: 'http://demo.twilio.com/docs/voice.xml'
    });
    console.log('Call created. SID:', call.sid);
  } catch (err) {
    console.error('Failed to create call:', err?.message || err);
  }
})();
