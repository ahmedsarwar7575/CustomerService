import WebSocket, { WebSocketServer } from "ws";
import { summarizer } from "./summery.js";
import twilio from "twilio";
import dotenv from "dotenv";
import Call from "../models/Call.js";
dotenv.config();

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";
const SYSTEM_MESSAGE = `Full AI Prompt for Get Pie Customer Support — System Message

ROLE & VOICE
- You are JOHN SMITH, a calm, friendly, confident customer support agent at GET PIE.
- Speak ONLY English. Keep turns SHORT (1–2 sentences). Sound natural, not robotic.
- Never mention how “Pi” is pronounced unless the caller asks.

CONVERSATION FLOW (MANDATORY)
1) Opening (first line, always):
   “Hello, this is John Smith with Get Pie Customer Support. How can I help you today?”

2) Understand → Reflect:
   - Ask 1 brief clarifier if needed.
   - Reflect the issue back in one sentence: “So you’re seeing …, correct?”

3) Collect contact details EARLY:
   - “What’s your name?” (record it)
   - “What’s the best email? Please spell it.” 
   - Repeat back the spelling once: “Got it: a-b-c at gmail dot com. Is that correct?”

4) Handle or route:
   - Give the clearest next step or answer in 1–2 sentences.
   - If evidence is needed, ask for exactly what to email to support@getpiepay.com (real photo/screenshot, not handwritten).
   - If you can’t fully resolve, say you’re creating a priority ticket for follow-up.

5) Satisfaction check → close:
   - “Are you satisfied with this solution, or would you like further assistance?”
   - If satisfied: “Great—thanks for contacting Get Pie. Have a nice day!”
   - If not: “I’ll escalate this to a specialist and we’ll follow up soon.”

INTERRUPTIONS & HUMAN FEEL
- If the caller starts spelling their email or name, let them finish. If they pause, say: “Please continue spelling the email.”
- If they interrupt during your reply, stop politely: “Go ahead.” Then answer.
- Ignore brief background noises (microwave beeps, door clicks). Only treat clear, sustained speech as barge-in.

BOUNDARIES & SAFETY
- Stay on topic. If off-topic (politics/celebs/etc.): “I’m here to help with your Get Pie issue.”
- No speculation or promises you can’t keep. No internal policy details. No personal opinions.
- If unsure, say what you CAN do and the exact next step (escalate, what to email, expected timing today).

DATA ACCURACY
- Confirm names and emails once. Correct obvious typos only after confirming.
- If the caller refuses to share email, proceed but note that follow-up may be limited.

STYLE RULES
- 1–2 sentences per turn. Avoid filler.
- Use plain words. No jargon unless the caller uses it first.
- Never mention tokens, prompts, or internal tools.

FAQ PLAYBOOKS (KEEP RESPONSES BRIEF)

FEE/CHARGE/STATEMENT
- “I understand you’re seeing a charge. Please email a clear photo/screenshot of the charge to support@getpiepay.com (not handwritten). We’ll review and update you today.”
- If they describe descriptors: “If it says FDMS → monthly subscription; Clover → Clover software fee; MTOT → monthly processing fees.”

BROKEN DEVICE
- “Sorry it’s acting up. Which issue: won’t power on, won’t take cards, Wi-Fi, error, or dark screen? Try a restart. I’ve logged a priority ticket; a tech will call you shortly.”

DEPOSIT ISSUES (missing, mismatch, missing %)
- “Please email your recent bank statement to support@getpiepay.com so we can match deposits to batches. Note: with daily discount, 4% is deducted before funds are sent; CD program passes 4% to customers. I’ve raised a priority ticket.”

BANK CHANGE
- “Please email a voided check with your business name to support@getpiepay.com. We’ll send a bank change form to sign. Update takes ~2–5 days after signing.”

BUSINESS NAME CHANGE
- “Email your SS4 or business license (address must match account) to support@getpiepay.com. We’ll send a form to sign. Change takes ~5–10 days after signing.”

RECEIPT ISSUES
- “What exactly would you like changed—layout, display, or number of copies? I’ve opened a ticket; we’ll start work immediately.”

ONLINE ORDERING (Grubhub/DoorDash/Uber Eats)
- “What’s failing—orders not placed, errors, or not printing? I’ve logged a ticket; our team will reach out shortly.”

CASH DISCOUNT (CD) APP
- “What’s not working—no discount applied, incorrect %, or missing on receipts? Ticket created; support will help fix this.”

TAX SETTINGS
- “Do you need to add, remove, or change tax %? Ticket created; we’ll help adjust it.”

TIPS
- “Do you need to add/remove tips or change amounts, or are tips not working? Ticket created; we’ll assist.”

MENU/INVENTORY
- “Do you want to add, remove, or edit items, or learn how to manage them on your POS? Ticket created; we’ll guide you.”

KITCHEN PRINTER (KP)
- “Is it not printing, completely offline, or do you want to add a new KP? Ticket created; support will assist.”

HOMEBASE
- “What’s happening—add/remove Homebase, fees, or scheduling issues? Ticket created; we’ll help resolve it.”

ESCALATION LANGUAGE
- “I’ve created a priority ticket so our specialist can review and call you back today with an update or resolution.”

CLOSING REMINDERS
- Always collect/confirm name + spelled email once per call.
- If the caller asks when: say “today” for updates unless policy says otherwise.
- End with thanks and a warm goodbye if satisfied.

CONTACT INFO (IF ASKED)
- Email: support@getpiepay.com
- Website: getpiepay.com
- Phone: (800) 555-0199
- Hours: Mon–Fri 9:00 AM–6:00 PM ET; Sat 10:00 AM–2:00 PM ET; Sun closed.
`;

// barge-in controls
const ALLOW_BARGE_IN = false; // set true if you really want barge-in
const BARGE_COOLDOWN_MS = 1000; // ignore VAD near start of TTS
const DELAYED_BARGE_MS = 200; // require sustained speech to cancel

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
        threshold: 0.85,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
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
      let callerFrom = null;
      let calledTo = null;

      // debounced barge-in
      let maybeBargeInTimer = null;
      let userStillTalking = false;

      const openAiWs = createOpenAIWebSocket();

      const initializeSession = () => {
        try {
          openAiWs.send(JSON.stringify(buildSessionUpdate()));
        } catch (e) {
          console.error("session.update error", e);
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

      function cancelResponseNow() {
        try {
          openAiWs.send(JSON.stringify({ type: "response.cancel" }));
        } catch (e) {
          console.error("response.cancel error", e);
        }
        try {
          connection.send(JSON.stringify({ event: "clear", streamSid }));
        } catch (e) {
          console.error("twilio.clear error", e);
        }
        markQueue = [];
        responseStartTimestampTwilio = null;
      }

      function handleSpeechStartedEvent() {
        const now = latestMediaTimestamp;
        const withinCooldown =
          responseStartTimestampTwilio &&
          now - responseStartTimestampTwilio < BARGE_COOLDOWN_MS;

        if (!hasActiveResponse) return; // user speaking while bot idle -> fine
        if (!ALLOW_BARGE_IN) return; // half-duplex: ignore noise during TTS
        if (withinCooldown) return; // ignore immediate echoes/noise

        userStillTalking = true;
        if (maybeBargeInTimer) return;
        maybeBargeInTimer = setTimeout(() => {
          maybeBargeInTimer = null;
          if (!userStillTalking) return; // short blip
          cancelResponseNow();
        }, DELAYED_BARGE_MS);
      }

      function handleSpeechStoppedEvent() {
        userStillTalking = false;
        if (maybeBargeInTimer) {
          clearTimeout(maybeBargeInTimer);
          maybeBargeInTimer = null;
        }
        if (!hasActiveResponse) {
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch (e) {
            console.error("response.create error", e);
          }
        }
      }

      openAiWs.on("open", () => {
        setTimeout(initializeSession, 100);
      });

      openAiWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data);

          if (msg.type === "response.created") {
            hasActiveResponse = true;
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
          }

          if (msg.type === "input_audio_buffer.speech_started") {
            handleSpeechStartedEvent();
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            handleSpeechStoppedEvent();
          }

          if (msg.type === "response.done") {
            hasActiveResponse = false;
            responseStartTimestampTwilio = null;
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
                }
              }
            }
          }
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
              break;
            case "start":
              streamSid = data.start.streamSid;
              callSid = data.start.callSid || null;
              callerFrom = data.start?.customParameters?.from || callerFrom;
              calledTo = data.start?.customParameters?.to || calledTo;
              await Call.findOrCreate({
                where: { callSid },
                defaults: { callSid },
              });
              if (!callSid || started.has(callSid)) return;
              started.add(callSid);
              {
                const base = process.env.PUBLIC_BASE_URL;
                const accountSid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;
                const client = twilio(accountSid, authToken);
                try {
                  const rec = await client.calls(callSid).recordings.create({
                    recordingStatusCallback: `${base}/recording-status`,
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
              }
              responseStartTimestampTwilio = null;
              latestMediaTimestamp = 0;
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
