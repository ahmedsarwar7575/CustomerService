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
- Email on file: ${userProfile.email || "Unknown"}

FOR THIS CALL
- Treat the caller as returning.
- In your first reply, greet them warmly using their name "${
        userProfile.name || ""
      }" and ask how you can help today.
- Do NOT ask for their name unless they say the name on file is wrong or they want to update it.

RETURNING CUSTOMER FLOW (HARD)
- Confirm issue first.
- Give the solution and next steps immediately after confirming the issue.
- Ask keep/change email only near the end, after the solution.

EMAIL ON FILE VALIDATION (HARD)
- Validate email on file: one "@", no spaces, dot in domain, not containing “let me confirm” or “is that correct”.
- If invalid/Unknown, collect a new email with strict spell-and-confirm.

KEEP/CHANGE QUESTION (ASK NEAR END ONLY)
“So our team can reach you, I have your email as ${
        userProfile.email || ""
      }. Do you want to keep it or change it? Please say keep or change.”

IF KEEP
- “Got it—I’ll keep that email.”

IF CHANGE
- Collect a new email letter by letter; spell back; confirm.
- After confirmed: “Got it—I’ve updated that email.”
`
    : `
=
`;

  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.6,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: false,
        interrupt_response: false,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE + dynamicContext,
      modalities: ["text", "audio"],
      temperature: 0.8,
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

      let qaPairs = [];
      let pendingUserQ = null;

      let hasActiveResponse = false;
      let responseStartedAt = 0;
      let pendingUserTurn = false;

      const started = new Set();
      const openAiWs = createOpenAIWebSocket();

      const safeSendOpenAI = (payload) => {
        if (openAiWs.readyState !== WebSocket.OPEN) return;
        try {
          openAiWs.send(JSON.stringify(payload));
        } catch {}
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
            ? `In this first reply, greet the caller warmly in English using their name "${knownUser.name}", and ask how you can help today. Keep it to one or two short sentences. Do NOT ask for their name or email yet.`
            : `In this first reply, greet the caller warmly in English and ask how you can help today. Keep it to one or two short sentences, and do not ask for their name or email yet. Wait for their answer first.`;

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

      const flushQueuedTurn = () => {
        if (!pendingUserTurn) return;
        pendingUserTurn = false;
        safeSendOpenAI({ type: "response.create" });
      };

      const watchdog = setInterval(() => {
        if (!hasActiveResponse) return;
        if (!responseStartedAt) return;

        if (Date.now() - responseStartedAt > 20000) {
          hasActiveResponse = false;
          responseStartedAt = 0;
          safeSendOpenAI({ type: "response.cancel" });
          flushQueuedTurn();
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
          flushQueuedTurn();
        }

        if (msg.type === "input_audio_buffer.speech_started") {
          if (hasActiveResponse) {
            safeSendOpenAI({ type: "response.cancel" });
            hasActiveResponse = false;
            responseStartedAt = 0;
          }
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

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (hasActiveResponse) {
            pendingUserTurn = true;
          } else {
            safeSendOpenAI({ type: "input_audio_buffer.commit" });
            safeSendOpenAI({ type: "response.create" });
          }
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

        if (msg.type === "response.done") {
          hasActiveResponse = false;
          responseStartedAt = 0;

          const outputs = msg.response?.output || [];
          for (const out of outputs) {
            if (out?.role !== "assistant") continue;

            const part = Array.isArray(out.content)
              ? out.content.find(
                  (c) =>
                    typeof c?.transcript === "string" && c.transcript.trim()
                )
              : null;

            const a = (part?.transcript || "").trim();
            if (!a) continue;

            if (pendingUserQ) {
              qaPairs.push({ q: pendingUserQ, a });
              pendingUserQ = null;
            } else {
              qaPairs.push({ q: null, a });
            }

            if (isGoodbye(a)) scheduleHangup();
          }

          flushQueuedTurn();
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
