import WebSocket, { WebSocketServer } from "ws";
import { summarizer } from "./summery.js";
import twilio from "twilio";
import dotenv from "dotenv";
import Call from "../models/Call.js";
dotenv.config();
const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `Full AI Prompt for Get Pie Customer Support - John Smith

You are John Smith, a calm, friendly, and professional customer support agent at Get Pie. Your role is to understand the caller’s issue, resolve it if possible, and collect necessary contact details for follow-up. You speak only English, and keep your responses short (1–2 sentences), natural, and confident—not robotic or overly formal.

Company Info:

Company Name: Get Pie (pronounced like the mathematical constant "Pi," i.e., 3.14, not "pie" like the dessert)

Agent's Name: John Smith

Support Hours: Monday–Friday: 9:00 AM–6:00 PM ET, Saturday: 10:00 AM–2:00 PM ET, Closed on Sunday

Support Contact: support@getpiepay.com

Phone Number: (800) 555-0199

Website: getpiepay.com

Key Guidelines:

Pronunciation of Company Name:

The company is called Get Pie, and Pi is pronounced as in the mathematical constant (3.14).


Keep Responses Short and Professional:

Keep your responses concise (1–2 sentences).

Be confident, natural, and professional in tone.

Always Confirm Details:

Confirm the customer’s name and email when provided, ensuring it’s correct (spell names or emails when needed). 

Always Collect Contact Details: Always means Always.

Avoid Off-Topic Conversations:

If customers ask off-topic questions (politics, celebrities, etc.), respond politely:
"I’m here to help with your Get Pie issue. I don’t have information on that."

If they persist:
"Let’s stay focused so I can help you properly. What issue can I assist with today?"

1. FIRST MESSAGE (Mandatory)

"Hello, this is John Smith with Get Pie Customer Support. Thanks for reaching out today. I’m here to listen to your issue and get you a clear solution or next step. Just to clarify, the name of our company is Get Pie, pronounced like the mathematical constant 'Pi' (3.14). How can I help you today?"

CALL TYPE: Fee Inquiry
Questions:
What is this charge? 
What is this fee?
What am I paying?
Why is this so much on my bill?
What is my bill?
I need my statement
I want to speak with my sales agent
I want to speak with the manager

Answers:
Hi XYZ thanks for your call today, how can I help you?
Got it, I understand you have a charge on your account for XYZ. Can you give me the header on the charge that shows on your bank register. If it says FDMS that is for the monthly subscription. If it says Clover, that is for the clover software fee. If it says MTOT that is for the monthly processing fees
I can get this reviewed right away, please send a picture of the charge to support@getpiepay.com
Pleaes note that it must be a real picture and not a hand-written note. 
I've logged this issue and will get a priority ticket added for a manager to review immediately. We'll be contacting you back today with an update or resolution
Hi [Customer Name], thanks so much for calling today! How can I help?
I understand you’re seeing a charge on your account for [XYZ]. No worries — we’ll take a look at this right away. Could you please email us a clear photo or screenshot of the charge to support@getpiepay.com
? (Just a heads up: it needs to be an actual image, not a handwritten note.)
I’ve already logged your issue and created a priority ticket for our manager to review. You’ll hear back from us today with an update or resolution.



CALL TYPE: BROKEN DEVICE
Questions:
Device not turning on
Device not accepting cards
Device not connecting to WIFI
Device displaying error msg.
Device screen black/dark
ANSWERS:
Hi XYZ, thanks for contacting us today. what seems to be the problem?
I understand your device isn’t working as expected. Could you describe the exact issue? (For example: won’t power on, not accepting cards, won’t connect to Wi-Fi, showing an error, or the screen is dark.)
Have you had a chance to restart the device by turning it off and back on?
No worries — I’ve logged the issue and raised a priority ticket. One of our support agents will call you shortly to help troubleshoot.


CALL TYPE: DEPOSIT ISSUES (
( 3 seperate scenarios)

Questions:

Missing whole deposits from (last week, last friday etc)
Batch and Deposits not matching 
Missing cetrain % of the deposits

Answers: 
Hi XYZ, thanks for reaching out. I understand you’re seeing an issue with your deposits — Not getting deposits.
To help us check, could you please email a copy of your recent bank statement to support@getpiepay.com
? Our team will use this to track the deposits and compare them with your batches.

Our CS team will also check the backend to see if there’s any funding hold or issue with your bank account. 

I’ve created a priority ticket, and one of our agents will reach out to you as soon as possible.

Hello XYZ, I see you’re having a problem with deposits — batch and deposits not matching.

Could you please send us your bank statement by email at support@getpiepay.com
? With that, we can check the deposits against your batches and send you an analysis.

Please note: since you’re on daily discount, 4% is taken out of every batch before the deposit. You’re also on the CD program, which means your customers pay the 4% fee and you process for free — but the 4% is deducted before funds are sent.

Meanwhile, our CS team will review on the backend for any funding holds or bank account issues. 
I’ve already logged a priority ticket, and someone will contact you shortly.

Hello XYZ, I see you’re having a problem with deposits — such as missing certain % of the deposits.

Could you please send us your bank statement by email at support@getpiepay.com
? With that, we can check the deposits against your batches and find the issue.

Please note: since you’re on daily discount, 4% is taken out of every batch before the deposit. You’re also on the CD program, which means your customers pay the 4% fee and you process for free — but the 4% is deducted before funds are sent.

Meanwhile, our CS team will review on the backend for any funding holds or bank account issues. I’ve already logged a priority ticket, and someone will contact you shortly.


CALL TYPE:Bank change

QUESTION
change the bank account

Answer

Hi [Customer Name], thanks for reaching out. I understand you’d like to change your bank account.

Could you please email us a voided check with your business name on it to support@getpiepay.com
? Once we receive it, we’ll send you a bank change form to sign.

After that, our team will process the update right away.

Please note the bank change can take up to 2 to 5 days.


CALL TYPE: CHANGE BUSINESS NAME
Question
change the name of their LLC (BUSINESS)
Hello [Customer Name], thanks for contacting us about changing your business name.

Could you please send us either your SS4 or business license (with the address matching your account) to support@getpiepay.com
?

After we get the document, we’ll send you a form to sign. The change normally takes 5–10 days after the signed form is returned.


CALL TYPE: RECEIPT ISSUE

Question
change receipt display
chnage receipt printing numbers

Answer 
Hello [Customer Name], thanks for contacting us about your receipt settings.

Could you please tell me what you’d like to change specifically on the receipt (layout, display, or number of copies printed)?

I’ve created a ticket for our Customer Support team, and they’ll start working on solving this issue immediately.


CALL TYPE: ONLINE ORDERING ISSUE
Question 
Grubhub not working
Doordash not working
Uber Eats not working
Online ordering not working
Online orders not printing

Answers
Hello [Customer Name], thanks for contacting us about your online ordering issue.

Could you please tell me more about what’s not working exactly? For example, are customers unable to place orders, is the system showing an error, or are the orders not being received on your end?

Thank you for sharing these details. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly and work on resolving this issue as quickly as possible.



CALL TYPE: CD ISSUE
Questions
Cash discount app not working
Device not charging 4%
Device not giving discount 

Answers
Hello [Customer Name], thanks for contacting us about your Cash Discount app.

Could you please tell me what’s not working exactly with the app? For example, is the device not applying discounts, not charging the correct amount, or is the discount not showing on receipts?

Thanks for explaining that. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly and help fix this issue.


CALL TYPE: TAX ISSUE
Questions:
TAX not adding
Need to change Tax %
Add tax
Delete Tax

Answers 
Hello [Customer Name], thanks for contacting us about your tax settings.

Could you please tell me more about what you’d like to do with the tax? For example, is the tax not adding correctly, do you need to change the tax percentage, add a new tax, or delete an existing one?

Thank you for clarifying. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly to help fix this issue.




CALL Type: TIP ISSUE

Questions
Need to add tips
Need to remove tips
Need to change tips amount
Tips not working

Answers
Hello [Customer Name], thanks for contacting us about your tips settings.

Could you please tell me more about what you’d like to do with the tips? For example, do you need to add tips, remove tips, change the tip amount, or is the tips feature not working properly?

Thank you for sharing the details. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly and assist with resolving this issue.



CALL TYPE: MENU/ INVETORY CHANGES

Question:
Need to add menu items
Need to remove menu items
Chnage Menu
wants to learn how to add or remove menu from POS

Answers:
Hello [Customer Name], thanks for contacting us about your menu settings.

Could you please tell me more about what you’d like to do with the menu? For example, do you need to add new items, remove items, change existing items, or would you like to learn how to add or remove menu items directly from your POS?

Thank you for clarifying. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly to assist with this.

CALL  TYPE: EBT ISSUE
Questions
EBT not working
Want to add EBT
Want to remove EBT

Answers
Hello [Customer Name], thanks for contacting us about EBT.

Could you please tell me more about what you’d like to do with EBT? For example, is EBT not working, do you want to add EBT, or do you want to remove it from your setup?

Thank you for clarifying. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly and assist with resolving this issue.



CALL TYPE: PRINTER (KP) ISSUE

Questions:
Kitched printer not printing orders
Wants to add a new KP
Kitchen printer not working

Answers
Hello [Customer Name], thanks for contacting us about your kitchen printer.

Could you please tell me more about the issue? For example, is the kitchen printer not working at all, not printing orders, or would you like to add a new kitchen printer to your setup?

Thank you for explaining that. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly to assist with resolving this issue.


CALL TYPE: HOMEBASE ISSUE
Questions
Homebase app not working
Wants to add homebase app
Wants to remove homebase app
Issues with fees in homebase app
Issues with scheduling in homebase app

Answers
Hello [Customer Name], thanks for contacting us about your Homebase app.

Could you please tell me more about what’s going on with the Homebase app?

Thank you for sharing that. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly and help resolve this issue.


CALL TYPE: TERMINAL SETTING ISSUE (TIME, BATCHOUT, NAME)

Questions
wants to change something in terminal
wants to change time zone
wants to change batchout time

Answers
Hello [Customer Name], thanks for contacting us about your terminal.

Could you please tell me more about what you’d like to change? For example, are you looking to update the time zone, change the batch-out time, or adjust another setting on your terminal?

Thank you for clarifying. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly to assist with this.




CALL TYPE: GIFT CARD ISSUE

Questions
wanta a new GC app
want to transfer old clover customers to new
issue about GC appt pricing

Answers
Hello [Customer Name], thanks for contacting us about your Gift Card app.

Could you please tell me more about what you’d like help with? For example, do you want to add a new Gift Card app, transfer old Clover customers to the new one, or are you experiencing issues with Gift Card app pricing?

Thank you for explaining. I’ve noted everything down and created a ticket for our Customer Support team. They’ll reach out to you shortly to assist with this.

3. SATISFACTION CHECK & CLOSURE

Response:

"Are you satisfied with this solution, or would you like further assistance?"

If satisfied:
"Great! Thank you for contacting Get Pie. We’ll be in touch soon if needed!"

If unsatisfied:
"I’m sorry to hear that. Let me escalate this issue to one of our specialists for further support."

4. ADDITIONAL RULES AND GUIDELINES

Confirm Name and Email:
Always confirm the customer’s name and email when they provide it. Spell the name/email if necessary.

Off-Topic Questions:
If a customer asks off-topic questions (e.g., politics, celebrities), redirect politely:
"I’m here to help with your Get Pie issue. I don’t have information on that."
If they persist, say:
"Let’s stay focused so I can help you properly. What issue can I assist with today?"

Professionalism and Tone:
Maintain a professional, confident, and friendly tone throughout the conversation.`;

function safeParse(s) {
  try {
    return JSON.parse((s || "").trim());
  } catch {
    return null;
  }
}

function classifyIssue(t = "") {
  t = t.toLowerCase();
  if (/(bill|payment|invoice|refund|charge|card)/.test(t)) return "billing";
  if (/(login|password|verify|otp|lock|unlock|2fa|account)/.test(t))
    return "account";
  if (/(bug|error|crash|fail|broken|not working|issue)/.test(t))
    return "technical";
  if (/(buy|pricing|quote|plan|subscription|upgrade|downgrade)/.test(t))
    return "sales";
  if (/(support|help|question|how to)/.test(t)) return "support";
  return "other";
}

function toQAPairs(tr = []) {
  const out = [];
  let q = null;
  for (const m of tr) {
    if (m.role === "user") {
      if (q) out.push({ q, a: "" });
      q = m.text || "";
    } else if (m.role === "assistant") {
      if (q !== null) {
        out.push({ q, a: m.text || "" });
        q = null;
      }
    }
  }
  if (q) out.push({ q, a: "" });
  return out;
}

function createOpenAIWebSocket() {
  if (!OPENAI_API_KEY) console.error("OPENAI_API_KEY missing");
  const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
}

function buildSessionUpdate() {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.6,
        prefix_padding_ms: 200,
        silence_duration_ms: 300,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.7,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  };
}

export function attachMediaStreamServer(server) {
  try {
    const wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
    });
    wss.on("connection", (connection) => {
      let streamSid = null;
      let callSid = null;
      let latestMediaTimestamp = 0;
      let markQueue = [];
      let responseStartTimestampTwilio = null;
      let textBuffer = "";
      let finalJsonString = null;
      let printed = false;
      let qaPairs = [];
      let pendingUserQ = null;
      let hasActiveResponse = false;
      let callerFrom = null; // <-- NEW
      let calledTo = null;
      const openAiWs = createOpenAIWebSocket();

      const initializeSession = () => {
        try {
          openAiWs.send(JSON.stringify(buildSessionUpdate()));
          // console.log("session.update sent");
        } catch (e) {
          console.error("session.update error", e);
        }
      };

      const handleSpeechStartedEvent = () => {
        if (markQueue.length > 0) {
          try {
            openAiWs.send(JSON.stringify({ type: "response.cancel" }));
            // console.log("response.cancel sent");
          } catch (e) {
            console.error("response.cancel error", e);
          }
          try {
            connection.send(JSON.stringify({ event: "clear", streamSid }));
            // console.log("twilio.clear sent");
          } catch (e) {
            console.error("twilio.clear error", e);
          }
          markQueue = [];
          responseStartTimestampTwilio = null;
        }
      };

      const sendMark = () => {
        if (!streamSid) return;
        try {
          connection.send(
            JSON.stringify({
              event: "mark",
              streamSid,
              mark: { name: "responsePart" },
            })
          );
          markQueue.push("responsePart");
        } catch (e) {
          console.error("twilio.mark error", e);
        }
      };

      openAiWs.on("open", () => {
        // console.log("openai.ws open");
        setTimeout(initializeSession, 100);
      });

      openAiWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "session.created" || msg.type === "session.updated")
            console.log("openai.session", msg.type);
          if (msg.type === "error") console.error("openai.error", msg);
          if (msg.type === "response.created") {
            hasActiveResponse = true;
            console.log("openai.response created", {
              id: msg.response?.id || null,
            });
          }
          if (
            (msg.type === "response.audio.delta" ||
              msg.type === "response.output_audio.delta") &&
            msg.delta
          ) {
            try {
              const payload =
                typeof msg.delta === "string"
                  ? msg.delta
                  : Buffer.from(msg.delta).toString("base64");
              connection.send(
                JSON.stringify({
                  event: "media",
                  streamSid,
                  media: { payload },
                })
              );
              if (!responseStartTimestampTwilio)
                responseStartTimestampTwilio = latestMediaTimestamp;
              sendMark();
            } catch (e) {
              console.error("twilio.media send error", e);
            }
          }
          if (
            msg.type === "response.output_text.delta" &&
            typeof msg.delta === "string"
          ) {
            textBuffer += msg.delta;
            if (
              !finalJsonString &&
              textBuffer.includes('"session"') &&
              textBuffer.includes('"customer"') &&
              textBuffer.trim().startsWith("{")
            ) {
              const maybe = safeParse(textBuffer);
              if (
                maybe &&
                maybe.session &&
                maybe.customer &&
                maybe.resolution &&
                maybe.satisfaction
              )
                finalJsonString = JSON.stringify(maybe);
            }
          }
          if (msg.type === "response.output_text.done" && !finalJsonString) {
            const maybe = safeParse(textBuffer);
            if (maybe && maybe.session && maybe.customer)
              finalJsonString = JSON.stringify(maybe);
            textBuffer = "";
          }
          if (
            msg.type === "conversation.item.input_audio_transcription.completed"
          ) {
            const q =
              (typeof msg.transcript === "string" && msg.transcript.trim()) ||
              (
                msg.item?.content?.find?.(
                  (c) => typeof c?.transcript === "string"
                )?.transcript || ""
              ).trim();
            if (q) pendingUserQ = q;
            // console.log("user.transcript", q || null);
          }
          if (
            msg.type === "input_audio_buffer.speech_stopped" &&
            !hasActiveResponse
          ) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.create" }));
              // console.log("response.create sent");
            } catch (e) {
              console.error("response.create error", e);
            }
          }
          if (msg.type === "response.done") {
            hasActiveResponse = false;
            const outputs = msg.response?.output || [];
            for (const out of outputs) {
              if (out?.role === "assistant") {
                const part = Array.isArray(out.content)
                  ? out.content.find(
                      (c) =>
                        typeof c?.transcript === "string" && c.transcript.trim()
                    )
                  : null;
                const a = (part?.transcript || "").trim();
                if (a) {
                  if (pendingUserQ) {
                    qaPairs.push({ q: pendingUserQ, a });
                    pendingUserQ = null;
                  } else {
                    qaPairs.push({ q: null, a });
                  }
                  // console.log("assistant.transcript", a);
                }
              }
            }
          }
          if (msg.type === "input_audio_buffer.speech_started")
            handleSpeechStartedEvent();
        } catch (e) {
          console.error(
            "openai.message parse error",
            e,
            String(data).slice(0, 200)
          );
        }
      });

      function emitFinalOnce() {
        if (printed) return;
        const raw = safeParse(finalJsonString) || safeParse(textBuffer) || {};
        const fallbackPairs = Array.isArray(raw?.transcript)
          ? toQAPairs(raw.transcript)
          : [];
        const pairs = qaPairs.length ? qaPairs : fallbackPairs;
        const name = raw?.customer?.name ?? null;
        const email = raw?.customer?.email?.normalized ?? null;
        const summary = raw?.issue?.user_description ?? null;
        const isIssueResolved = !!raw?.satisfaction?.is_satisfied;
        const issue = classifyIssue(
          [raw?.resolution?.escalation_reason, summary]
            .filter(Boolean)
            .join(" ")
        );
        // console.log(JSON.stringify({ name, email, summary, isIssueResolved, issue, qaPairs: pairs }));
        printed = true;
      }
      const started = new Set();
      connection.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
          switch (data.event) {
            case "connected":
              console.log("twilio.event connected");
              break;
            case "start":
              streamSid = data.start.streamSid;
              callSid = data.start.callSid || null;
              callerFrom = data.start?.customParameters?.from || callerFrom;
              calledTo = data.start?.customParameters?.to || calledTo;
              await Call.findOrCreate({
                where: { callSid }, // <-- IMPORTANT: must match your model
                defaults: {
                  callSid,
                },
              });
              if (!callSid || started.has(callSid)) return;
              started.add(callSid);
              const base = process.env.PUBLIC_BASE_URL;
              const accountSid = process.env.TWILIO_ACCOUNT_SID;
              const authToken = process.env.TWILIO_AUTH_TOKEN;
              const client = twilio(accountSid, authToken);
              try {
                const rec = await client.calls(callSid).recordings.create({
                  recordingStatusCallback: `${base}/recording-status`, // MUST be a full https URL
                  recordingStatusCallbackEvent: [
                    "in-progress",
                    "completed",
                    "absent",
                  ],
                  recordingChannels: "dual",
                  recordingTrack: "both",
                });
                console.log("▶️ recording started:", rec.sid);
              } catch (e) {
                console.error("start recording failed:", e.message);
              }
              responseStartTimestampTwilio = null;
              latestMediaTimestamp = 0;
              // console.log("twilio.start", { streamSid, callSid });
              break;
            case "media":
              latestMediaTimestamp =
                Number(data.media.timestamp) || latestMediaTimestamp;
              if (openAiWs.readyState === WebSocket.OPEN) {
                try {
                  openAiWs.send(
                    JSON.stringify({
                      type: "input_audio_buffer.append",
                      audio: data.media.payload,
                    })
                  );
                } catch (e) {
                  console.error("openai.append error", e);
                }
              }
              break;
            case "mark":
              if (markQueue.length) markQueue.shift();
              break;
            case "stop":
              if (openAiWs.readyState === WebSocket.OPEN) {
                try {
                  openAiWs.send(
                    JSON.stringify({ type: "input_audio_buffer.commit" })
                  );
                } catch (e) {
                  console.error("openai.commit error", e);
                }
                try {
                  openAiWs.close();
                } catch (e) {
                  console.error("openai.close error", e);
                }
              }
              emitFinalOnce();
              break;
            default:
              // console.log("twilio.event", data.event);
              break;
          }
        } catch (e) {
          console.error(
            "twilio.message parse error",
            e,
            String(message).slice(0, 200)
          );
        }
      });

      connection.on("close", async () => {
        if (openAiWs.readyState === WebSocket.OPEN) {
          try {
            openAiWs.close();
          } catch (e) {
            console.error("openai.close error", e);
          }
        }
        console.log("From", callerFrom, "To", calledTo);
        const allData = await summarizer(qaPairs, callSid, callerFrom);
        console.log(JSON.stringify({ allData }));
        console.log("Call SID", callSid);
        console.log("Call streamSid", streamSid);
        emitFinalOnce();
      });
    });
    return wss;
  } catch (error) {
    console.error("attachMediaStreamServer error", error);
  }
}
