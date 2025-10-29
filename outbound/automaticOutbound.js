// automaticOutbound.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/user.js";
import { makeSystemMessage } from "./prompt.js";
import { summarizeUpsellLite } from "./summerize.js";

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const RT_MODEL = "gpt-4o-realtime-preview-2024-12-17";

/** Create a connection to OpenAI Realtime */
function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${RT_MODEL}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
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

/** Send session.update, then prime a first response */
function kickoff(openAiWs, instructions, state) {
  try {
    openAiWs.send(JSON.stringify(buildSessionUpdate(instructions)));
    // Mark session as configured AFTER sending session.update
    state.sessionConfigured = true;

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

    // --- shared connection state ---
    let userId = null;
    let kind = null;
    let user = null;

    let streamSid = null;
    let callSid = null;
    let markQueue = [];
    let hasActiveResponse = false;
    let pendingUserQ = null;
    let openaiReady = false;
    let sessionConfigured = false; // gate: only stream audio after session.update
    let commitTimer = null; // periodic commits to trigger VAD
    let metricsTimer = null;

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

    // ---- Try to parse userId/kind from URL (may be missing on Twilio) ----
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

    // Load user if we have an id now
    if (userId) {
      try {
        user = await User.findOne({ where: { id: userId } });
      } catch (e) {
        console.error("[WS] user load error", e?.message || e);
      }
    }

    console.log("[WS] kind", kind);
    console.log("[WS] user", user);
    console.log("[WS] userID", userId);

    // ---- OpenAI WS lifecycle ----
    openAiWs.on("open", () => {
      openaiReady = true;
      console.log("[OPENAI] socket opened");
    });
    openAiWs.on("error", (e) =>
      console.error("[OPENAI] error", e?.message || e)
    );
    openAiWs.on("close", () => console.log("[OPENAI] socket closed"));

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        // Debug: confirm VAD events fire
        if (msg.type === "input_audio_buffer.speech_started") {
          console.log("[OPENAI] speech_started");
          // If assistant was speaking, cancel & clear to avoid barge-in clash
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

            // Authoritative parameters from Twilio <Stream><Parameter>
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

            // Always have a kind default to avoid null prompts
            if (!kind) {
              console.warn("[OPENAI] missing kind; defaulting to 'upsell'");
              kind = "upsell";
            }

            // Build instructions and kickoff
            const instr = makeSystemMessage(userId, kind);
            console.log("[OPENAI] instructions", instr);

            if (openaiReady) {
              kickoff(openAiWs, instr, {
                sessionConfiguredRef: null,
                sessionConfigured: (sessionConfigured = true),
              });
            } else {
              // Wait briefly until WS is open
              const t = setInterval(() => {
                if (openaiReady) {
                  kickoff(openAiWs, instr, {
                    sessionConfiguredRef: null,
                    sessionConfigured: (sessionConfigured = true),
                  });
                  clearInterval(t);
                }
              }, 50);
              setTimeout(() => clearInterval(t), 5000);
            }

            // Periodic commit so VAD can detect turn boundaries
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
              }, 300); // 300ms works well with 8kHz μ-law frames
            }

            // Start dual-channel recording (optional)
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

            // Only forward audio AFTER session.update is sent
            if (openAiWs.readyState === WebSocket.OPEN && sessionConfigured) {
              try {
                openAiWs.send(
                  JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: payload,
                  })
                );
              } catch {}
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
            if (openAiWs.readyState === WebSocket.OPEN) {
              try {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
              } catch {}
              try {
                openAiWs.close();
              } catch {}
            }
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
