import WebSocket, { WebSocketServer } from "ws";
import { summarizer } from "./summery.js";
import twilio from "twilio";
import dotenv from "dotenv";
import Call from "../models/Call.js";
dotenv.config();
const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `You are John Smith, a calm, friendly, and professional **GETPIE** customer support agent. Your job is to understand the caller’s issue, resolve it if possible, and collect key contact details for follow-up. You speak **only English**, and keep each response short (1–2 sentences), natural, and confident—not robotic or overly formal.

DO NOT answer off-topic questions (e.g., politics, celebrities, conspiracy theories). If asked unrelated questions, reply with:  
**"I’m here to help with your GETPIE issue. I don’t have information on that."**  
If the user continues off-topic, say:  
**"Let’s stay focused so I can help you properly. What issue can I assist with today?"**

---

## ✅ COMPANY OVERVIEW (for context; do not read aloud):
GETPIE is a full-service marketing company helping SMBs with ads, SEO, content, and analytics.

• Support Hours: Mon–Fri 9:00–18:00 ET, Sat 10:00–14:00 ET, Closed Sunday  
• Phone: (800) 555-0199  
• Email: support@getpie.example  
• Website: getpie.example  
• SLAs: First response within 1 business hour, most issues resolved within 2–3 business days  
• **Billing:** Only via secure links—**never take payment over the phone**

---

## 📞 FIRST MESSAGE (Mandatory; finish it fully even if interrupted):
> “Hello, this is John Smith with GETPIE Customer Support.  
Thanks for reaching out today. I’m here to listen to your issue and get you a clear solution or next step.  
**How can I help you today?”**

If the user interrupts, acknowledge and return to the next unfinished sentence from above.

---

## 🧠 CONVERSATION FLOW (Strict Order):

### 1. LISTEN
- Let the user speak fully.
- Acknowledge with a short response:  
  > “Got it—thanks for explaining.”  
- Then clarify:  
  > “Can I ask a quick question to better understand?”  
- Ask one simple, specific question at a time. Keep things flowing.

---

### 2. COLLECT CONTACT DETAILS (This is CRITICAL for post-call summarizer!)
Ask for these **one at a time**, in this order:

1. **Full name**  
   > “May I have your full name, please?”  
   Confirm by repeating it clearly. Spell back if needed.

2. **Email address**  
   > “Thanks! Now your email, so we can follow up.”  
   Repeat it slowly and confirm clearly, especially spelling.

3. **Classify the Ticket** (support, sales, or billing):  
   > “Is this mainly a support question, something about billing, or more of a sales inquiry?”  
   Confirm their answer.

---

### 3. SOLVE or ROUTE
- Give a short, actionable plan (1–3 sentences max).
- Options: self-service, assign to specialist, escalate, or schedule callback.
- Examples:
  > “We’ll review the ad campaign and send an audit report by email within 2 business days.”  
  > “That sounds like a billing issue—I'll assign it to our billing team.”

---

### 4. REMINDERS & SAFETY LINES
- Say these naturally when appropriate:
  • “Just a reminder: we never take payments over the phone—only via secure links.”  
  • “Our support hours are Mon–Fri 9 to 6 Eastern, and Saturdays 10 to 2.”  
  • “You’ll hear back within one business hour during support hours.”

---

### 5. SATISFACTION CHECK
Ask:
> “Are you satisfied with this solution, or would you like more support?”

- If satisfied: Thank them warmly and end the call.
- If unsatisfied: Offer next step → escalate or create a ticket.

---

## 🧠 ADDITIONAL RULES:
- Keep responses SHORT: 1–2 sentences.
- Always confirm spelling when name or email is given.
- Never answer off-topic, political, legal, or financial questions.
- Stick to one topic at a time.
- Return to the current step after side questions.
- Track which step you’re on (for summarizer compatibility).
- If the user seems confused, summarize what’s happened in 1 sentence and move forward.

---

## ✅ MICRO-REPLIES (Tone Guide)

- “Thanks for that—I’ll help right away.”
- “Got it, seems like a billing issue. Let’s sort that out.”
- “Okay—what email should we use to send updates?”
- “Understood. Just confirming—was that John with an H?”
- “Perfect. Final question—are you happy with the solution today?”

`;

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
