// automaticOutbound.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/user.js";
import { makeSystemMessage } from "./prompt.js";
import Call from "../models/Call.js";
import processCallOutcome from "./summerize.js";

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  REALTIME_MODEL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
} = process.env;

const RT_MODEL = REALTIME_MODEL || "gpt-4o-realtime-preview";

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// ---- tuning knobs ----
const MIN_USER_SPEECH_MS = 180; // ignore tiny VAD blips (noise)
const GOODBYE_WAIT_MS = 3000; // user wants 3 seconds
const GOODBYE_GRACE_MS = 300; // small buffer so last TTS frames aren't cut

if (!OPENAI_API_KEY) {
  console.error("[OPENAI] ERROR: Missing OPENAI_API_KEY in environment");
}

/** ---------------- OPENAI WS FACTORY ---------------- */
function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
    RT_MODEL
  )}`;

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY || "MISSING"}`,
      "OpenAI-Beta": "realtime=v1",
      Origin: "https://server.local",
    },
    perMessageDeflate: false,
  });

  ws.on("unexpected-response", async (_req, res) => {
    let body = "";
    try {
      body = await new Promise((resolve) => {
        let data = "";
        res.on("data", (c) => (data += c.toString("utf8")));
        res.on("end", () => resolve(data));
        res.on("error", () => resolve("(read error)"));
      });
    } catch {}
    console.error(
      "[OPENAI] unexpected-response",
      res.statusCode,
      res.statusMessage,
      body
    );
  });

  ws.on("error", (e) => {
    console.error("[OPENAI] socket error:", e?.message || e);
  });

  return ws;
}

/** ---------------- SESSION CONFIG ---------------- */
function buildSessionUpdate(instructions) {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.85,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: false,
        interrupt_response: false,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions,
      modalities: ["text", "audio"],
      temperature: 0.6,
      input_audio_transcription: {
        // use stable model; if your preview exists you can swap it back
        model: "gpt-4o-mini-transcribe",
        language: "en",
        prompt:
          "Transcribe ONLY English. If caller speaks another language, translate to English meaning. Do not output non-English.",
      },
    },
  };
}

/** ---------------- GOODBYE DETECTION ---------------- */
function isGoodbye(text = "") {
  const t = text.toLowerCase();
  return (
    t.includes("goodbye") ||
    /\bbye\b/.test(t) ||
    t.includes("talk to you soon") ||
    t.includes("see you") ||
    t.includes("thanks for your time") ||
    t.includes("have a nice day") ||
    t.includes("have a great day")
  );
}

function getDisplayName(user) {
  if (!user) return "there";
  return user.name || user.firstName || "there";
}

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on("connection", async (connection, req) => {
    let userId = null;
    let kind = null; // "satisfaction" | "upsell"
    let user = null;

    let streamSid = null;
    let callSid = null;

    let openaiReady = false;
    let twilioStarted = false;
    let callStarted = false;
    let firstMediaReceived = false;

    let sessionConfigured = false;
    let sessionAcked = false; // ✅ wait for session.updated before greeting (noise fix)
    let greetingSent = false;

    let hasActiveResponse = false;
    let pendingUserQ = null;

    let commitTimer = null;
    let metricsTimer = null;

    // speech duration tracking (noise control)
    let lastSpeechStartAt = null;

    // goodbye window state
    let goodbyePending = false;
    let goodbyeTimer = null;
    let goodbyeSpeechStartAt = null;
    let hangupDone = false;

    // assistant text fallback
    let currentAssistantText = "";

    // queues
    let markQueue = [];
    let mediaQueue = [];

    // QA for summarizer
    const qaPairs = [];

    const openAiWs = createOpenAIWs();

    function inferKind() {
      if (kind) return kind;
      if (user) {
        if (user.isSatisfactionCall === false) return "satisfaction";
        if (user.isUpSellCall === false) return "upsell";
      }
      return "upsell";
    }

    const startMetrics = () => {
      if (metricsTimer) return;
      metricsTimer = setInterval(() => {}, 3000);
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
      } catch {}
    };

    function clearGoodbyeWindow() {
      goodbyePending = false;
      goodbyeSpeechStartAt = null;
      if (goodbyeTimer) clearTimeout(goodbyeTimer);
      goodbyeTimer = null;
    }

    async function hangupCallNow() {
      if (hangupDone || !callSid || !twilioClient) return;
      hangupDone = true;

      try {
        await twilioClient.calls(callSid).update({ status: "completed" });
        console.log(`[TWILIO] Hung up outbound call ${callSid}`);
      } catch (err) {
        console.error("[TWILIO] hangup error", err?.message || err);
      }
    }

    // ✅ NEW: goodbye → wait 3s → if user speaks cancel, else hang up
    function startGoodbyeWindow() {
      clearGoodbyeWindow();
      goodbyePending = true;

      // small grace so last audio frames finish playing
      goodbyeTimer = setTimeout(async () => {
        if (!goodbyePending) return;
        console.log("[HANGUP] goodbye window expired, hanging up");
        await hangupCallNow();
      }, GOODBYE_GRACE_MS + GOODBYE_WAIT_MS);
    }

    /** --------------- GREETING LOGIC (AGENT SPEAKS FIRST) --------------- */
    function maybeSendGreeting() {
      if (greetingSent) return;
      if (!sessionConfigured || !sessionAcked) return; // ✅ wait for session.updated
      if (!callStarted || !twilioStarted) return;
      if (!firstMediaReceived) return; // ✅ wait for stream audio path
      if (openAiWs.readyState !== WebSocket.OPEN) return;

      greetingSent = true;

      const displayName = getDisplayName(user);
      const k = String(inferKind() || "").toLowerCase();

      const greetingInstruction =
        k === "satisfaction"
          ? `
Speak ONLY English. Calm, friendly tone. Short sentences.

FIRST: Greet the customer by name "${displayName}" if natural.
SECOND: Say this is a quick follow-up about their recent support interaction.
THIRD: Ask: "Are you satisfied with the assistance you received?"

Then STOP and wait for their answer. You must speak first.
`.trim()
          : `
Speak ONLY English. Calm, friendly tone. Short sentences.

FIRST: Greet the customer by name "${displayName}" if natural.
SECOND: Say this is a quick call to share one simple way to help their business grow using their existing payment processing.
THIRD: Ask: "Is now a good moment to talk for less than a minute?"

Then STOP and wait for their answer. You must speak first.
`.trim();

      try {
        openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio"],
              instructions: greetingInstruction,
            },
          })
        );
        console.log("[OPENAI] greeting sent (agent spoke first)");
      } catch (e) {
        console.error("[OPENAI] greeting response.create error", e);
      }
    }

    /** --------------- SESSION CONFIG WHEN READY --------------- */
    const configureSessionIfNeeded = async () => {
      if (sessionConfigured) return;
      if (!openaiReady) return;
      if (!twilioStarted) return;

      try {
        const pickedKind = inferKind() || "upsell";
        const instrBase = await makeSystemMessage(userId, pickedKind);

        const instr =
          instrBase +
          `

GLOBAL BEHAVIOR (VERY IMPORTANT):
- Speak ONLY English (no Urdu, no Punjabi). If caller uses another language, respond in English.
- Calm, clear, human tone. No robotic style.
- Never produce sound effects or filler noises.
- When ending the call, say a clear goodbye sentence, then stay silent briefly to let the caller respond.
`.trim();

        openAiWs.send(JSON.stringify(buildSessionUpdate(instr)));
        sessionConfigured = true;
        sessionAcked = false; // will flip on "session.updated"
        console.log("[OPENAI] session.update sent");
      } catch (e) {
        console.error(
          "[OPENAI] configureSessionIfNeeded error",
          e?.message || e
        );
      }
    };

    /** --------------- PARSE userId / kind FROM URL --------------- */
    try {
      const url = new URL(req?.url || "", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "upsell-stream" && parts[1]) userId = parts[1];
      kind = url.searchParams.get("kind") || null;
    } catch {}
    if (!userId || !kind) {
      try {
        const raw = req?.url || "";
        const qs = raw.includes("?") ? raw.split("?")[1] : "";
        const sp = new URLSearchParams(qs);
        userId = userId || sp.get("userId") || null;
        kind = kind || sp.get("kind") || null;
      } catch {}
    }

    if (userId) {
      try {
        user = await User.findOne({ where: { id: userId } });
      } catch (e) {
        console.error("[WS] user load error", e?.message || e);
      }
    }

    /** --------------- OPENAI WS LIFECYCLE --------------- */
    openAiWs.on("open", async () => {
      openaiReady = true;
      console.log("[OPENAI] socket opened (model:", RT_MODEL, ")");
      await configureSessionIfNeeded();
    });

    openAiWs.on("close", (code, reason) => {
      console.log(
        "[OPENAI] socket closed",
        code,
        reason ? reason.toString() : ""
      );
    });

    openAiWs.on("error", (e) => {
      console.error("[OPENAI] error", e?.message || e);
    });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        // ✅ this is the key for the noise fix
        if (msg.type === "session.updated") {
          sessionAcked = true;
          console.log("[OPENAI] session.updated (ack)");
          maybeSendGreeting();
        }

        // capture assistant text as fallback (goodbye detection)
        if (msg.type === "response.created") {
          hasActiveResponse = true;
          currentAssistantText = "";
        }
        if (
          msg.type === "response.text.delta" &&
          typeof msg.delta === "string"
        ) {
          currentAssistantText += msg.delta;
        }
        if (
          msg.type === "response.output_text.delta" &&
          typeof msg.delta === "string"
        ) {
          currentAssistantText += msg.delta;
        }

        // speech started (used for noise gating + goodbye cancel)
        if (msg.type === "input_audio_buffer.speech_started") {
          lastSpeechStartAt = Date.now();

          if (goodbyePending) {
            goodbyeSpeechStartAt = Date.now();
          }
        }

        // user stopped talking => create response only if it was real speech (not tiny noise)
        if (msg.type === "input_audio_buffer.speech_stopped") {
          const dur = lastSpeechStartAt ? Date.now() - lastSpeechStartAt : 0;
          lastSpeechStartAt = null;

          // If user spoke during goodbye window long enough -> cancel hangup and continue
          if (goodbyePending && goodbyeSpeechStartAt) {
            const gdDur = Date.now() - goodbyeSpeechStartAt;
            if (gdDur >= MIN_USER_SPEECH_MS) {
              console.log(
                "[HANGUP] user spoke during goodbye window -> cancel hangup"
              );
              clearGoodbyeWindow();
            }
          }

          // only respond if speech was not just noise
          if (dur >= MIN_USER_SPEECH_MS && !hasActiveResponse) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.create" }));
            } catch (e) {
              console.error("[OPENAI] manual response.create error", e);
            }
          }
        }

        // stream assistant audio to Twilio
        if (
          (msg.type === "response.audio.delta" ||
            msg.type === "response.output_audio.delta") &&
          msg.delta
        ) {
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
            sendMark();
          }
        }

        // transcription completed (also cancels goodbye if real text came in)
        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          const t =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (
              msg.item?.content?.find?.(
                (c) => typeof c?.transcript === "string"
              )?.transcript || ""
            ).trim();

          if (t) {
            pendingUserQ = t;

            if (goodbyePending) {
              console.log(
                "[HANGUP] transcription arrived during goodbye window -> cancel hangup"
              );
              clearGoodbyeWindow();
            }
          }
        }

        // response done => Q/A logging + goodbye window start
        if (msg.type === "response.done") {
          hasActiveResponse = false;

          const outputs = msg.response?.output || [];
          for (const out of outputs) {
            if (out?.role !== "assistant") continue;

            const part = Array.isArray(out.content)
              ? out.content.find(
                  (c) =>
                    typeof c?.transcript === "string" && c.transcript.trim()
                )
              : null;

            const a = (part?.transcript || currentAssistantText || "").trim();
            if (!a) continue;

            if (pendingUserQ) {
              qaPairs.push({ q: pendingUserQ, a });
              pendingUserQ = null;
            } else {
              qaPairs.push({ q: null, a });
            }

            // ✅ NEW behavior: goodbye -> wait 3 seconds -> if user doesn't speak => hang up
            if (isGoodbye(a)) {
              console.log("[HANGUP] assistant said goodbye -> start 3s window");
              startGoodbyeWindow();
            }
          }
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e);
      }
    });

    /** --------------- TWILIO <-> WS BRIDGE --------------- */
    connection.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);
        if (!metricsTimer) startMetrics();

        switch (data.event) {
          case "start": {
            streamSid = data.start?.streamSid || streamSid || null;
            callSid = data.start?.callSid || callSid || null;

            twilioStarted = true;
            callStarted = true;

            const cp = (data.start && data.start.customParameters) || {};
            if (!kind && typeof cp.kind === "string") kind = cp.kind;
            if (!userId && typeof cp.userId === "string") userId = cp.userId;

            if (!user || String(user.id) !== String(userId)) {
              try {
                user = await User.findOne({ where: { id: userId } });
              } catch (e) {
                console.error("[WS] user reload error", e?.message || e);
              }
            }

            await configureSessionIfNeeded();

            // commit loop (helps VAD segmentation)
            if (!commitTimer) {
              commitTimer = setInterval(() => {
                if (
                  openAiWs.readyState === WebSocket.OPEN &&
                  sessionConfigured &&
                  !hasActiveResponse
                ) {
                  try {
                    openAiWs.send(
                      JSON.stringify({ type: "input_audio_buffer.commit" })
                    );
                  } catch {}
                }
              }, 300);
            }

            // create Call row (optional)
            try {
              if (callSid) {
                await Call.findOrCreate({
                  where: { callSid },
                  defaults: { callSid },
                });
              }
            } catch {}

            break;
          }

          case "media": {
            if (!streamSid && data.streamSid) streamSid = data.streamSid;

            const payload = data.media?.payload || "";

            if (!firstMediaReceived) {
              firstMediaReceived = true;
              // after first media arrives, greeting is now safe once session.updated arrives
              maybeSendGreeting();
            }

            await configureSessionIfNeeded();

            if (
              openAiWs.readyState === WebSocket.OPEN &&
              sessionConfigured === true
            ) {
              try {
                openAiWs.send(
                  JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: payload,
                  })
                );
              } catch {}
            } else {
              mediaQueue.push(payload);
            }
            break;
          }

          case "mark": {
            if (markQueue.length) markQueue.shift();
            break;
          }

          case "stop": {
            if (commitTimer) {
              clearInterval(commitTimer);
              commitTimer = null;
            }
            clearGoodbyeWindow();
            try {
              if (openAiWs.readyState === WebSocket.OPEN) {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
                openAiWs.close();
              }
            } catch {}
            break;
          }

          default:
            break;
        }
      } catch (e) {
        console.error("[WS] parse error", e);
      }
    });

    connection.on("close", async () => {
      if (metricsTimer) clearInterval(metricsTimer);
      if (commitTimer) clearInterval(commitTimer);
      clearGoodbyeWindow();

      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}

      try {
        const result = await processCallOutcome({
          qaPairs,
          userId,
          callSid,
          campaignType: inferKind() || "upsell",
        });
        console.log("[SUMMARY] outcome", result?.outcome);
      } catch (e) {
        console.error("[SUMMARY] summarize error", e?.message || e);
      }
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  console.log("[WS] outbound WSS ready (noServer)");
  return wss;
}
