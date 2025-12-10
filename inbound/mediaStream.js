import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
import Call from "../models/Call.js";
import { SYSTEM_MESSAGE } from "./prompt.js";
import { summarizer } from "./summery.js";

dotenv.config();

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PUBLIC_BASE_URL,
} = process.env;

const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// --- Realtime helpers ---

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
        create_response: true,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.7,
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "en", // force transcription language to English
        prompt:
          "The caller is speaking English (even with an accent). Always transcribe to English.",
      },
    },
  };
}

// detect when assistant is saying goodbye
function isGoodbye(text = "") {
  const t = text.toLowerCase();
  return (
    t.includes("goodbye") ||
    t.includes("bye-bye") ||
    /\bbye\b/.test(t) ||
    t.includes("talk to you soon") ||
    t.includes("see you") ||
    t.includes("thanks for calling") ||
    t.includes("have a nice day") ||
    t.includes("have a great day")
  );
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

      // For summarizer
      let qaPairs = [];
      let pendingUserQ = null;

      const started = new Set();
      const openAiWs = createOpenAIWebSocket();

      const initializeSession = () => {
        try {
          openAiWs.send(JSON.stringify(buildSessionUpdate()));
          sessionInitialized = true;
          maybeSendGreeting();
        } catch (e) {
          console.error("session.update error", e);
        }
      };

      function maybeSendGreeting() {
        // only greet once, after session + call are ready
        if (
          greetingSent ||
          !sessionInitialized ||
          !callStarted ||
          openAiWs.readyState !== WebSocket.OPEN
        )
          return;

        greetingSent = true;
        try {
          openAiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Start by greeting the caller in English. Keep it to one or two short sentences and then wait for their question.",
              },
            })
          );
        } catch (e) {
          console.error("greeting response.create error", e);
        }
      }

      function scheduleHangup() {
        if (hangupScheduled || !callSid) return;
        hangupScheduled = true;

        setTimeout(() => {
          twilioClient
            .calls(callSid)
            .update({ status: "completed" })
            .then(() => {
              console.log(`☎️ Hung up call ${callSid} 5s after goodbye.`);
            })
            .catch((err) => {
              console.error("Failed to hang up call:", err?.message || err);
            });
        }, 5000);
      }

      // OpenAI WS events
      openAiWs.on("open", () => {
        // tiny delay to let Twilio send "start"
        setTimeout(initializeSession, 100);
      });

      openAiWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data);

          // --- 1) Capture user questions from transcription for summarizer ---
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

            if (q) {
              pendingUserQ = q;
              // console.log("User question:", q);
            }
          }

          // --- 2) Stream assistant audio back to Twilio ---
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
            } catch (e) {
              console.error("twilio.media send error", e);
            }
          }

          // --- 3) On completed assistant response: build QA pairs + detect goodbye ---
          if (msg.type === "response.done") {
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

              // build Q/A pairs for summarizer
              if (pendingUserQ) {
                qaPairs.push({ q: pendingUserQ, a });
                pendingUserQ = null;
              } else {
                // no explicit question (could be greeting, follow-ups)
                qaPairs.push({ q: null, a });
              }

              // goodbye detection
              if (isGoodbye(a)) {
                scheduleHangup();
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

      openAiWs.on("error", (err) => {
        console.error("OpenAI WS error", err);
      });

      // Twilio Media Stream events
      const onTwilioMessage = async (message) => {
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

              // Start Twilio dual-channel recording (optional but kept)
              if (PUBLIC_BASE_URL && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
                try {
                  const rec = await twilioClient
                    .calls(callSid)
                    .recordings.create({
                      recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
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

              callStarted = true;
              maybeSendGreeting();
              break;

            case "media":
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

            case "stop":
              if (openAiWs.readyState === WebSocket.OPEN) {
                try {
                  openAiWs.close();
                } catch (e) {
                  console.error("openai.close error", e);
                }
              }
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
      };

      connection.on("message", onTwilioMessage);

      connection.on("close", async () => {
        // close OpenAI WS if still open
        if (openAiWs.readyState === WebSocket.OPEN) {
          try {
            openAiWs.close();
          } catch (e) {
            console.error("openai.close error", e);
          }
        }

        console.log(
          "Call closed. From",
          callerFrom,
          "To",
          calledTo,
          "Call SID",
          callSid,
          "Stream SID",
          streamSid
        );

        // --- Call your summarizer with all Q/A pairs ---
        try {
          const allData = await summarizer(qaPairs, callSid, callerFrom);
          console.log("📄 Summarizer result:", JSON.stringify({ allData }));
        } catch (e) {
          console.error("summarizer error:", e?.message || e);
        }
      });
    });

    return wss;
  } catch (error) {
    console.error("attachMediaStreamServer error", error);
  }
}
