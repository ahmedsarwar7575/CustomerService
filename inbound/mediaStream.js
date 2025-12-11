import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
import Call from "../models/Call.js";
import User from "../models/user.js"; // 👈 adjust path/model name as needed
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

function buildSessionUpdate(userProfile = null) {
  // Dynamic instructions depending on whether the caller exists in DB
  const dynamicContext = userProfile
    ? `
==================================================
CALLER PROFILE FROM DATABASE (RETURNING CUSTOMER)
==================================================
- Name on file: ${userProfile.name || "Unknown"}
- Email on file: ${userProfile.email || "Unknown"}

For this call:
- Treat the caller as a returning customer.
- In your first reply, greet them warmly using their name "${
        userProfile.name || ""
      }" and ask how you can help today.
- Do NOT ask "What is your name?" as if you do not know it.
- You already know their email on file: "${userProfile.email || ""}".
- At a natural moment early in the conversation, say something like:
  "We have your email as ${
    userProfile.email || ""
  }. Do you want to keep this email or change it?"
    But always ask for email confirmation at end that we have your email do you want to keep it or not.
- If they say it is correct / they want to keep it:
Say something like: "Great! I’ll keep that email."
- If they want to change it:
  - Collect a NEW email using the normal spell-and-confirm flow.
- You do NOT need to re-collect their name unless they say it is wrong or want to change it. 
`
    : `
==================================================
CALLER PROFILE FROM DATABASE (NEW CUSTOMER)
==================================================
- No existing customer record was found for this phone number.

For this call:
- Follow your normal flow to:
  - Ask for and confirm their NAME.
  - Ask for and confirm their EMAIL with spelling, repeat, and confirmation.
`;

  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.85,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: false, // ❌ let US call response.create
        interrupt_response: false, // ❌ no server barge-in
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE + dynamicContext,
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
    /\bbye\b/.test(t)
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

      // returning-customer info
      let knownUser = null;
      let openAiReady = false;
      let userLookupDone = false;
      let twilioStarted = false;

      // For summarizer
      let qaPairs = [];
      let pendingUserQ = null;

      // response state
      let hasActiveResponse = false;

      const started = new Set();
      const openAiWs = createOpenAIWebSocket();

      const initializeSession = () => {
        try {
          openAiWs.send(JSON.stringify(buildSessionUpdate(knownUser)));
          sessionInitialized = true;
          maybeSendGreeting();
        } catch (e) {
          console.error("session.update error", e);
        }
      };

      function maybeInitializeSession() {
        if (sessionInitialized) return;
        if (!openAiReady || !twilioStarted || !userLookupDone) return;
        initializeSession();
      }

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

        let greetingInstruction;
        if (knownUser && knownUser.name) {
          greetingInstruction =
            `In this first reply, greet the caller warmly in English using their name "${knownUser.name}", and ask how you can help today. ` +
            `Keep it to one or two short sentences. Do NOT ask for their name or email yet.`;
        } else {
          greetingInstruction =
            "In this first reply, greet the caller warmly in English and ask how you can help today. Keep it to one or two short sentences, and do not ask for their name or email yet. Wait for their answer first.";
        }

        try {
          openAiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions: greetingInstruction,
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
        openAiReady = true;
        maybeInitializeSession();
      });

      openAiWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data);

          // track response state
          if (msg.type === "response.created") {
            hasActiveResponse = true;
          }

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
            }
          }

          // --- 1b) Manual turn handling: when user stops talking, trigger response ---
          if (msg.type === "input_audio_buffer.speech_stopped") {
            // Only create a new response if none is currently active
            if (!hasActiveResponse && openAiWs.readyState === WebSocket.OPEN) {
              try {
                openAiWs.send(JSON.stringify({ type: "response.create" }));
              } catch (e) {
                console.error("manual response.create error", e);
              }
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
            hasActiveResponse = false; // response finished

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

              // try multiple places to get the caller's phone (adapt as needed)
              callerFrom =
                data.start?.customParameters?.from ||
                data.start?.callFrom ||
                data.start?.from ||
                callerFrom;

              calledTo =
                data.start?.customParameters?.to || data.start?.to || calledTo;

              await Call.findOrCreate({
                where: { callSid },
                defaults: { callSid },
              });

              if (!callSid || started.has(callSid)) return;
              started.add(callSid);

              // Start Twilio dual-channel recording (optional)
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
              twilioStarted = true;

              // --- Look up user by phone BEFORE initializing session ---
              try {
                if (callerFrom) {
                  knownUser = await User.findOne({
                    where: { phone: callerFrom },
                  });
                  if (knownUser) {
                    console.log(
                      "Returning user found for phone:",
                      callerFrom,
                      "->",
                      knownUser.name,
                      knownUser.email
                    );
                  } else {
                    console.log(
                      "No existing user found for phone:",
                      callerFrom
                    );
                  }
                } else {
                  console.log("No callerFrom phone number available");
                }
              } catch (e) {
                console.error("User lookup error:", e?.message || e);
              }

              userLookupDone = true;
              maybeInitializeSession();
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
