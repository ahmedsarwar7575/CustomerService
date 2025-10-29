// automaticOutbound.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/user.js";
import { makeSystemMessage } from "./prompt.js";
import { summarizeUpsellLite } from "./summerize.js";

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  REALTIME_MODEL, // optional override via env
} = process.env;

// Default to a stable realtime model name if none provided via env.
// If your account supports a different model, set REALTIME_MODEL=<model> in env.
const RT_MODEL = REALTIME_MODEL || "gpt-4o-realtime-preview";

if (!OPENAI_API_KEY) {
  console.error("[OPENAI] ERROR: Missing OPENAI_API_KEY in environment");
}

/** Create a connection to OpenAI Realtime with strong diagnostics */
function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
    RT_MODEL
  )}`;

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY || "MISSING"}`,
      "OpenAI-Beta": "realtime=v1",
      // Some environments require Origin; it’s harmless to include:
      Origin: "https://server.local",
    },
    perMessageDeflate: false,
  });

  // Log HTTP response when the WS handshake fails
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

/** Build session.update payload */
function buildSessionUpdate(instructions) {
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
      instructions,
      modalities: ["text", "audio"],
      temperature: 0.7,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  };
}

/** Kick off the session: send session.update, then a first response */
function kickoff(openAiWs, instructions, state) {
  try {
    openAiWs.send(JSON.stringify(buildSessionUpdate(instructions)));
    state.sessionConfigured = true; // safe to stream/flush audio now

    openAiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions:
            "Greet, confirm if now is a good time in one sentence, then a brief value pitch.",
        },
      })
    );
    console.log("[OPENAI] kickoff sent");
  } catch (e) {
    console.error("[OPENAI] kickoff error", e?.message || e);
  }
}

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on("connection", async (connection, req) => {
    console.log(`[WS] Twilio connected ${req?.url || ""}`);

    // ---- connection state ----
    let userId = null;
    let kind = null;
    let user = null;

    let streamSid = null;
    let callSid = null;
    let markQueue = [];
    let hasActiveResponse = false;
    let pendingUserQ = null;
    let openaiReady = false;
    let sessionConfigured = false; // set true after session.update
    let commitTimer = null;
    let metricsTimer = null;

    // queue incoming audio frames until OpenAI is ready & configured
    let mediaQueue = [];

    let framesIn = 0,
      framesOut = 0,
      bytesIn = 0,
      bytesOut = 0;

    const qaPairs = [];
    const openAiWs = createOpenAIWs();

    const startMetrics = () => {
      if (metricsTimer) return;
      metricsTimer = setInterval(() => {
        console.log(
          `[METRICS] in=${framesIn}/${bytesIn}B out=${framesOut}/${bytesOut}B active=${hasActiveResponse} openai=${openaiReady} marks=${markQueue.length}`
        );
      }, 3000);
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

    // Parse from URL (best effort; Twilio may strip)
    try {
      const url = new URL(req?.url || "", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "upsell-stream" && parts[1]) userId = parts[1];
      kind = url.searchParams.get("kind") || null;
    } catch {}

    // Fallback parse
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

    console.log("[WS] userID", userId);
    console.log("[WS] kind", kind);
    console.log("[WS] user", user);

    // ---- OpenAI WS lifecycle ----
    openAiWs.on("open", () => {
      openaiReady = true;
      console.log("[OPENAI] socket opened (model:", RT_MODEL, ")");
    });

    openAiWs.on("close", (code, reason) =>
      console.log(
        "[OPENAI] socket closed",
        code,
        reason ? reason.toString() : ""
      )
    );

    openAiWs.on("error", (e) =>
      console.error("[OPENAI] error", e?.message || e)
    );

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        // VAD debug
        if (msg.type === "input_audio_buffer.speech_started") {
          console.log("[OPENAI] speech_started");
          // Cancel/clear TTS if user barges in
          if (markQueue.length) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.cancel" }));
            } catch {}
            try {
              connection.send(JSON.stringify({ event: "clear", streamSid }));
            } catch {}
            markQueue = [];
          }
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          console.log("[OPENAI] speech_stopped");
          if (!hasActiveResponse) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.create" }));
            } catch {}
          }
        }

        if (msg.type === "response.created") hasActiveResponse = true;

        if (
          (msg.type === "response.audio.delta" ||
            msg.type === "response.output_audio.delta") &&
          msg.delta
        ) {
          const payload =
            typeof msg.delta === "string"
              ? msg.delta
              : Buffer.from(msg.delta).toString("base64");
          bytesOut += Buffer.byteLength(payload);
          framesOut++;
          connection.send(
            JSON.stringify({ event: "media", streamSid, media: { payload } })
          );
          sendMark();
        }

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
          if (t) pendingUserQ = t;
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
                console.log("[Q/A]", qaPairs[qaPairs.length - 1]);
              }
            }
          }
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e);
      }
    });

    // ---- Twilio <-> WS bridge ----
    connection.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);
        if (!metricsTimer) startMetrics();

        switch (data.event) {
          case "start": {
            streamSid = data.start.streamSid;
            callSid = data.start.callSid || null;
            console.log(
              `[TWILIO] start streamSid=${streamSid} callSid=${callSid}`
            );

            // Authoritative params from TwiML <Parameter>
            const cp = (data.start && data.start.customParameters) || {};
            if (!kind && typeof cp.kind === "string") kind = cp.kind;
            if (!userId && typeof cp.userId === "string") userId = cp.userId;
            console.log("[TWILIO] start customParameters", cp);

            // (Re)load user if needed
            if (!user || String(user.id) !== String(userId)) {
              try {
                user = await User.findOne({ where: { id: userId } });
                if (user)
                  console.log("[WS] user reloaded via start.customParameters");
              } catch (e) {
                console.error("[WS] user reload error", e?.message || e);
              }
            }

            if (!kind) {
              console.warn("[OPENAI] missing kind; defaulting to 'upsell'");
              kind = "upsell";
            }

            // Wait for OpenAI socket to open, up to ~5s
            const waitStart = Date.now();
            const waitUntil = (ms) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            while (!openaiReady && Date.now() - waitStart < 5000) {
              await waitUntil(50);
            }
            if (!openaiReady) {
              console.error(
                "[OPENAI] socket did not open in time; check API key/model/network. Model=",
                RT_MODEL
              );
            }

            // Build prompt + kickoff (this sets sessionConfigured=true)
            const instr = makeSystemMessage(userId, kind);
            console.log("[OPENAI] instructions", instr);
            kickoff(openAiWs, instr, { sessionConfigured });

            // Start periodic commits so VAD can process buffered audio
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

            // Flush any queued media frames captured before sessionConfigured
            if (mediaQueue.length) {
              try {
                for (const payload of mediaQueue) {
                  openAiWs.send(
                    JSON.stringify({
                      type: "input_audio_buffer.append",
                      audio: payload,
                    })
                  );
                }
                mediaQueue = [];
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
              } catch (e) {
                console.error("[OPENAI] flush queued media error", e?.message);
              }
            }

            // Optional: start call recording
            try {
              const client = twilio(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
              );
              const base = process.env.PUBLIC_BASE_URL || "https://example.com";
              await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${base}/recording-status`,
                recordingStatusCallbackEvent: [
                  "in-progress",
                  "completed",
                  "absent",
                ],
                recordingChannels: "dual",
                recordingTrack: "both",
              });
              console.log("[TWILIO] recording started");
            } catch (e) {
              console.error("[TWILIO] recording error", e?.message || e);
            }
            break;
          }

          case "media": {
            const payload = data.media?.payload || "";
            framesIn++;
            bytesIn += Buffer.byteLength(payload);

            // If not ready yet, queue; else send straight through
            if (openAiWs.readyState === WebSocket.OPEN && sessionConfigured) {
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
            console.log("[TWILIO] stop");
            if (commitTimer) {
              clearInterval(commitTimer);
              commitTimer = null;
            }
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
            console.log("[TWILIO] event", data.event);
            break;
        }
      } catch (e) {
        console.error("[WS] parse error", e);
      }
    });

    connection.on("close", async () => {
      console.log("[WS] Twilio disconnected");
      if (metricsTimer) clearInterval(metricsTimer);
      if (commitTimer) {
        clearInterval(commitTimer);
        commitTimer = null;
      }
      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}
      console.log("[SUMMARY] qaPairs", qaPairs.length);
      summarizeUpsellLite(qaPairs, userId);
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  console.log("[WS] upsell WSS ready (noServer)");
  return wss;
}
