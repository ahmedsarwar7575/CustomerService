import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
import Call from "../models/Call.js";
import User from "../models/user.js";
import { SYSTEM_MESSAGE } from "./prompt.js";
import { summarizer } from "./summery.js";

dotenv.config();

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "echo",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PUBLIC_BASE_URL,
} = process.env;

const MODEL = "gpt-realtime-2025-08-28";

// Helps prevent the assistant from replying during tiny pauses (“uh…”, “umm…”, etc.)
const USER_PAUSE_GRACE_MS = 350;

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

function createOpenAIWebSocket() {
  const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
}

function buildSessionUpdate(userProfile = null) {
  const dynamicContext = userProfile
    ? `CALLER PROFILE FROM DATABASE (RETURNING CUSTOMER)
- Name on file: ${userProfile.name || "Unknown"}
- Email on file: ${userProfile.email}

RETURNING CUSTOMER SEQUENCE (HARD)
1) Confirm issue (one sentence + one question).
2) Provide the playbook solution + next step immediately.
3) Do NOT mention tickets yet. If they add more issues, say: “Got it—I’ll note that too.”
4) Near the end (after solution), do email keep/change.
5) After they confirm no more issues: ticket once + satisfaction.

KEEP/CHANGE QUESTION (EXACT, ASK NEAR END ONLY)
- Ask ONLY this:
“So our team can reach you, I have your email as <email>. Do you want to keep it or change it? Please say keep or change.”

FOR THIS CALL
KEEP/CHANGE DECISION RULE (HARD)
- Accept ONLY a clear “keep” or “change”.
- Never assume from “yes/yeah/mm-hmm”.
- If unclear or “keep but…” / “change but…”, do NOT commit.
Say only: “I’m listening—please finish,” then repeat the keep/change question.

END OF CALL (HARD)
- After the caller says there are no more issues, say:
“I’ll create one priority ticket for everything we discussed.”
- Then ask: “Are you satisfied with that?”

- Treat the caller as returning.
- In your first reply, greet them warmly using their name only if it is longer than 2 characters ("${
        userProfile.name
      }").
- Do NOT ask for their name unless they say the name on file is wrong or they want to update it.
`
    : ``;

  return {
    type: "session.update",
    session: {
      // Key: make VAD less aggressive so it doesn’t “end the turn” on tiny pauses.
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 500,
        silence_duration_ms: 500, // was 200 -> too aggressive for phone calls
        create_response: false,
        interrupt_response: false,
      },

      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,

      instructions: SYSTEM_MESSAGE + dynamicContext,
      modalities: ["text", "audio"],
      temperature: 0.8,

      // If you want better phone-call transcription, try:
      // model: "gpt-4o-mini-transcribe"
      input_audio_transcription: {
        model: "whisper-1",
        language: "en",
        prompt:
          "The caller is speaking English (even with an accent). Always transcribe to English.",
      },
    },
  };
}

function isGoodbye(text = "") {
  const t = text.toLowerCase();
  return t.includes("goodbye") || /\bbye\b/.test(t);
}

function extractTranscriptFromTranscriptionMsg(msg) {
  const direct =
    (typeof msg.transcript === "string" && msg.transcript.trim()) || "";

  if (direct) return direct;

  const fromItem = (
    msg.item?.content?.find?.((c) => typeof c?.transcript === "string")
      ?.transcript || ""
  ).trim();

  return fromItem || "";
}

function extractAssistantTextFromResponseDone(msg) {
  const outputs = msg.response?.output || [];

  for (const out of outputs) {
    // Some payloads use out.type/message; some include role directly.
    const role = out?.role || out?.message?.role;
    if (role !== "assistant") continue;

    const content = Array.isArray(out.content)
      ? out.content
      : Array.isArray(out.message?.content)
      ? out.message.content
      : [];

    // Prefer transcript if present (voice responses)
    const transcriptPart = content.find(
      (c) => typeof c?.transcript === "string" && c.transcript.trim()
    );
    if (transcriptPart?.transcript) return transcriptPart.transcript.trim();

    // Otherwise fallback to text if present
    const textPart = content.find(
      (c) => typeof c?.text === "string" && c.text.trim()
    );
    if (textPart?.text) return textPart.text.trim();
  }

  return "";
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
      let callerFrom = null;
      let calledTo = null;

      let sessionInitialized = false;
      let callStarted = false;
      let greetingSent = false;
      let hangupScheduled = false;

      let knownUser = null;
      let openAiReady = false;
      let userLookupDone = false;
      let twilioStarted = false;

      // Q/A storage
      let qaPairs = [];

      // Out-of-order safe pairing by item_id
      const transcriptsByItemId = new Map(); // item_id -> user transcript
      const assistantByItemId = new Map(); // item_id -> assistant text

      // Which user audio item the assistant is currently responding to
      let currentUserItemId = null;

      // If user speaks while assistant is responding, we queue the next item_id here
      let pendingUserItemId = null;

      // Debounce to avoid responding to tiny pauses
      let scheduledResponseTimer = null;
      let scheduledUserItemId = null;

      // Response state watchdog
      let hasActiveResponse = false;
      let responseStartedAt = 0;

      const started = new Set();
      const openAiWs = createOpenAIWebSocket();

      const safeSendOpenAI = (payload) => {
        if (openAiWs.readyState !== WebSocket.OPEN) return;
        try {
          openAiWs.send(JSON.stringify(payload));
        } catch {}
      };

      const clearScheduledResponse = () => {
        if (scheduledResponseTimer) {
          clearTimeout(scheduledResponseTimer);
          scheduledResponseTimer = null;
        }
        scheduledUserItemId = null;
      };

      const tryFinalizePair = (itemId) => {
        if (!itemId) return;

        const a = assistantByItemId.get(itemId);
        if (!a) return;

        const q = transcriptsByItemId.get(itemId) || null;

        qaPairs.push({ q, a });

        // cleanup
        assistantByItemId.delete(itemId);
        transcriptsByItemId.delete(itemId);
      };

      const startResponseForItem = (itemId) => {
        // If we somehow try to respond while active, queue it
        if (hasActiveResponse) {
          pendingUserItemId = itemId;
          return;
        }

        currentUserItemId = itemId || null;
        safeSendOpenAI({ type: "response.create" });
      };

      const scheduleResponseForItem = (itemId) => {
        clearScheduledResponse();
        scheduledUserItemId = itemId;

        scheduledResponseTimer = setTimeout(() => {
          scheduledResponseTimer = null;
          const id = scheduledUserItemId;
          scheduledUserItemId = null;

          // If assistant started speaking in the meantime, queue
          if (hasActiveResponse) {
            pendingUserItemId = id;
            return;
          }

          startResponseForItem(id);
        }, USER_PAUSE_GRACE_MS);
      };

      const maybeStartPendingTurn = () => {
        if (!pendingUserItemId) return;
        const id = pendingUserItemId;
        pendingUserItemId = null;
        scheduleResponseForItem(id);
      };

      const maybeSendGreeting = () => {
        if (
          greetingSent ||
          !sessionInitialized ||
          !callStarted ||
          openAiWs.readyState !== WebSocket.OPEN
        )
          return;

        greetingSent = true;

        const greetingInstruction =
          knownUser && knownUser.name
            ? `FIRST REPLY MUST BE EXACTLY THIS SENTENCE, WORD FOR WORD: "Hey ${knownUser.name}, I am Max from Get Pie Pay. How can I help you today?" Do not add or remove words.  Keep it to one or two short sentences. Do NOT ask for their name or email yet.`
            : `FIRST REPLY MUST BE EXACTLY THIS SENTENCE, WORD FOR WORD: "Hey, I am Max from Get Pie Pay. How can I help you today?" Do not add or remove words.Keep it to one or two short sentences, and do not ask for their name or email yet. Wait for their answer first.`;

        // Greeting is not tied to a user item_id
        currentUserItemId = null;

        safeSendOpenAI({
          type: "response.create",
          response: { instructions: greetingInstruction },
        });
      };

      const initializeSession = () => {
        safeSendOpenAI(buildSessionUpdate(knownUser));
        sessionInitialized = true;
        maybeSendGreeting();
      };

      const maybeInitializeSession = () => {
        if (sessionInitialized) return;
        if (!openAiReady || !twilioStarted || !userLookupDone) return;
        initializeSession();
      };

      const scheduleHangup = () => {
        if (hangupScheduled || !callSid) return;
        hangupScheduled = true;

        setTimeout(() => {
          twilioClient
            .calls(callSid)
            .update({ status: "completed" })
            .catch(() => {});
        }, 5000);
      };

      const watchdog = setInterval(() => {
        if (!hasActiveResponse) return;
        if (!responseStartedAt) return;

        if (Date.now() - responseStartedAt > 20000) {
          hasActiveResponse = false;
          responseStartedAt = 0;
          safeSendOpenAI({ type: "response.cancel" });
          clearScheduledResponse();
          maybeStartPendingTurn();
        }
      }, 1000);

      openAiWs.on("open", () => {
        openAiReady = true;
        maybeInitializeSession();
      });

      openAiWs.on("message", (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }

        // Assistant response lifecycle
        if (msg.type === "response.created") {
          hasActiveResponse = true;
          responseStartedAt = Date.now();
        }

        if (
          msg.type === "response.failed" ||
          msg.type === "response.canceled" ||
          msg.type === "error"
        ) {
          hasActiveResponse = false;
          responseStartedAt = 0;
          clearScheduledResponse();
          maybeStartPendingTurn();
        }

        // User started speaking -> do NOT talk over them.
        if (msg.type === "input_audio_buffer.speech_started") {
          // If we were about to respond because of a tiny pause, cancel that response scheduling
          clearScheduledResponse();

          // If assistant is currently speaking, stop immediately
          if (hasActiveResponse) {
            safeSendOpenAI({ type: "response.cancel" });
            hasActiveResponse = false;
            responseStartedAt = 0;
          }
        }

        // IMPORTANT: In server_vad, the server commits automatically.
        // Use the committed event as the real "end of user turn".
        if (msg.type === "input_audio_buffer.committed") {
          const itemId = msg.item_id || msg.item?.id;
          if (!itemId) return;

          // If assistant still active, queue the turn; otherwise schedule with grace
          if (hasActiveResponse) {
            pendingUserItemId = itemId;
          } else {
            scheduleResponseForItem(itemId);
          }
        }

        // Transcription completed (can arrive out of order)
        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          const itemId = msg.item_id || msg.item?.id;
          if (!itemId) return;

          const q = extractTranscriptFromTranscriptionMsg(msg);
          if (q) transcriptsByItemId.set(itemId, q);

          // If assistant answer already arrived first, finalize now
          tryFinalizePair(itemId);
        }

        // Stream assistant audio to Twilio
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

            if (streamSid) {
              connection.send(
                JSON.stringify({
                  event: "media",
                  streamSid,
                  media: { payload },
                })
              );
            }
          } catch {}
        }

        // Response completed -> capture assistant text and pair with the correct user item_id
        if (msg.type === "response.done") {
          hasActiveResponse = false;
          responseStartedAt = 0;

          const a = extractAssistantTextFromResponseDone(msg);

          if (a) {
            if (currentUserItemId) {
              assistantByItemId.set(currentUserItemId, a);
              tryFinalizePair(currentUserItemId);
            } else {
              // greeting or system-generated response not tied to a user item
              qaPairs.push({ q: null, a });
            }

            if (isGoodbye(a)) scheduleHangup();
          }

          currentUserItemId = null;

          // If user talked while assistant was responding, handle that next
          maybeStartPendingTurn();
        }
      });

      openAiWs.on("error", () => {});

      const onTwilioMessage = async (message) => {
        let data;
        try {
          data = JSON.parse(message);
        } catch {
          return;
        }

        switch (data.event) {
          case "start": {
            streamSid = data.start.streamSid;
            callSid = data.start.callSid || null;

            callerFrom =
              data.start?.customParameters?.from ||
              data.start?.callFrom ||
              data.start?.from ||
              callerFrom;

            calledTo =
              data.start?.customParameters?.to || data.start?.to || calledTo;

            try {
              await Call.findOrCreate({
                where: { callSid },
                defaults: { callSid },
              });
            } catch {}

            if (!callSid || started.has(callSid)) break;
            started.add(callSid);

            if (PUBLIC_BASE_URL && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
              try {
                await twilioClient.calls(callSid).recordings.create({
                  recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                  recordingStatusCallbackEvent: [
                    "in-progress",
                    "completed",
                    "absent",
                  ],
                  recordingChannels: "dual",
                  recordingTrack: "both",
                });
              } catch {}
            }

            callStarted = true;
            twilioStarted = true;

            try {
              if (callerFrom) {
                knownUser = await User.findOne({
                  where: { phone: callerFrom },
                });
              }
            } catch {}

            userLookupDone = true;
            maybeInitializeSession();
            maybeSendGreeting();
            break;
          }

          case "media": {
            if (openAiWs.readyState === WebSocket.OPEN) {
              safeSendOpenAI({
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              });
            }
            break;
          }

          case "stop": {
            try {
              if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            } catch {}
            break;
          }

          default:
            break;
        }
      };

      connection.on("message", onTwilioMessage);

      connection.on("close", async () => {
        clearInterval(watchdog);
        clearScheduledResponse();

        try {
          if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
        } catch {}

        try {
          await summarizer(qaPairs, callSid, callerFrom);
        } catch {}
      });
    });

    return wss;
  } catch {
    return null;
  }
}
