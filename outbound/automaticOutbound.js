// ws/upsell-wss.ts
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PUBLIC_BASE_URL = "https://example.com",
} = process.env;

// Use your current realtime model
const RT_MODEL = process.env.RT_MODEL || "gpt-4o-realtime-preview-2024-12-17";

/** Prompt for the upsell agent */
function makeSystemMessage() {
  return (
    "You are an upsell agent. Disclose recording, confirm timing, a 1–2 sentence value pitch, " +
    "ask one qualifier, brief objection handling, label interest (hot/warm/cold), collect consent, " +
    "and end with next steps. Keep replies ≤2 sentences unless asked."
  );
}

/** OpenAI Realtime WS */
function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${RT_MODEL}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
}

/** Correct nested audio config: μ-law 8k in/out to match Twilio Media Streams */
function buildSessionUpdate(instructions) {
  return {
    type: "session.update",
    session: {
      instructions,
      modalities: ["audio", "text"],
      temperature: 0.7,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      audio: {
        input: {
          // Twilio sends μ-law 8k base64 via <Connect><Stream>
          format: { type: "audio/pcmu" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.6,
            prefix_padding_ms: 200,
            silence_duration_ms: 300,
          },
        },
        output: {
          // Ask OpenAI to speak back in μ-law 8k so we can forward straight to Twilio
          format: { type: "audio/pcmu" },
          voice: REALTIME_VOICE,
        },
      },
    },
  };
}

/** Create the WSS (noServer) so you can attach it to your HTTP server's 'upgrade' */
export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  console.log("[WS] upsell WSS ready (noServer)");

  wss.on("connection", (twilioWs, req) => {
    console.log(`[WS] Twilio connected ${req?.url || ""}`);

    // State
    let streamSid= null;
    let callSid = null;
    let markQueue = [];
    let openaiReady = false;
    let hasActiveResponse = false;
    let pendingUserQ = null;
    let metricsTimer = null;

    // Counters
    let framesIn = 0,
      framesOut = 0,
      bytesIn = 0,
      bytesOut = 0;

    // Heartbeats
    const PING_MS = 15000;
    let hbTimer = null;
    function startHeartbeat() {
      if (hbTimer) return;
      hbTimer = setInterval(() => {
        try {
          if (twilioWs.readyState === WebSocket.OPEN) twilioWs.ping();
          if (openAiWs.readyState === WebSocket.OPEN) openAiWs.ping();
        } catch {}
      }, PING_MS);
    }

    function startMetrics() {
      if (metricsTimer) return;
      metricsTimer = setInterval(() => {
        console.log(
          `[METRICS] in=${framesIn}/${bytesIn}B out=${framesOut}/${bytesOut}B active=${hasActiveResponse} openai=${openaiReady} marks=${markQueue.length}`
        );
      }, 3000);
    }

    /** Helper to send a Twilio mark (useful to flush jitter buffers) */
    function sendMark(name = "resp") {
      if (!streamSid) return;
      try {
        twilioWs.send(
          JSON.stringify({ event: "mark", streamSid, mark: { name } })
        );
        markQueue.push(name);
      } catch {}
    }

    /** Create OpenAI WS */
    const openAiWs = createOpenAIWs();

    openAiWs.on("open", () => {
      openaiReady = true;
      console.log("[OPENAI] socket opened");

      // Configure audio/text modes before any responses
      const instr = makeSystemMessage();
      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate(instr)));
      } catch (e) {
        console.error("[OPENAI] session.update send error", (e )?.message || e);
      }
    });

    openAiWs.on("error", (e) =>
      console.error("[OPENAI] error", (e )?.message || e)
    );
    openAiWs.on("close", () => console.log("[OPENAI] socket closed"));

    /** OpenAI -> (events) */
    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString());

        // Log key events for observability
        const logTypes = new Set([
          "session.updated",
          "response.created",
          "response.completed",
          "response.done",
          "response.output_audio.delta",
          "response.audio.delta",
          "input_audio_buffer.speech_started",
          "input_audio_buffer.speech_stopped",
          "conversation.item.input_audio_transcription.completed",
          "response.error",
        ]);
        if (logTypes.has(msg.type)) console.log("[OPENAI EVT]", msg.type);

        // Kickoff AFTER the session applies audio config
        if (msg.type === "session.updated") {
          try {
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
            console.log("[OPENAI] kickoff sent (after session.updated)");
          } catch (e) {
            console.error("[OPENAI] kickoff error", (e )?.message || e);
          }
        }

        if (msg.type === "response.created") hasActiveResponse = true;

        // Audio deltas from the model (either field name)
        if (
          msg.type === "response.output_audio.delta" ||
          msg.type === "response.audio.delta"
        ) {
          const b64 =
            typeof msg.delta === "string"
              ? msg.delta
              : typeof msg.audio === "string"
              ? msg.audio
              : null;

          if (b64 && streamSid && twilioWs.readyState === WebSocket.OPEN) {
            bytesOut += Buffer.byteLength(b64);
            framesOut++;
            twilioWs.send(
              JSON.stringify({ event: "media", streamSid, media: { payload: b64 } })
            );
            sendMark();
          }
        }

        // Capture user transcription for Q/A pairs (optional)
        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          const t =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (msg.item?.content?.find?.(
              (c) => typeof c?.transcript === "string"
            )?.transcript || ""
            ).trim();
          if (t) pendingUserQ = t;
        }

        // Barge-in: user started talking—cancel TTS and clear Twilio buffer
        if (msg.type === "input_audio_buffer.speech_started") {
          if (markQueue.length) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.cancel" }));
            } catch {}
            try {
              if (streamSid)
                twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
            } catch {}
            markQueue = [];
          }
        }

        // Response finished -> optionally collect last assistant text
        if (msg.type === "response.done" || msg.type === "response.completed") {
          hasActiveResponse = false;
          // (Optional) extract assistant transcript if present
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
                console.log("[ASSISTANT SAID]", a);
                pendingUserQ = null;
              }
            }
          }
        }

        // If the user stopped speaking and we don't have an active response, nudge the model
        if (
          msg.type === "input_audio_buffer.speech_stopped" &&
          !hasActiveResponse
        ) {
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch {}
        }

        // Optional: log response errors
        if (msg.type === "response.error") {
          console.error("[OPENAI] response.error", msg.error || msg);
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e);
      }
    });

    /** Twilio -> (events) */
    twilioWs.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (!metricsTimer) startMetrics();
        startHeartbeat();

        switch (data.event) {
          case "start": {
            streamSid = data.start.streamSid;
            callSid = data.start.callSid || null;
            console.log(
              `[TWILIO] start streamSid=${streamSid} callSid=${callSid}`
            );

            // If OpenAI already open, make sure session is configured (idempotent)
            if (openaiReady) {
              try {
                openAiWs.send(
                  JSON.stringify(buildSessionUpdate(makeSystemMessage()))
                );
              } catch {}
            }

            // (Optional) Twilio call recording. Note: recording won't capture streamed audio.
            try {
              if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && callSid) {
                const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
                await client.calls(callSid).recordings.create({
                  recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                  recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
                  recordingChannels: "dual",
                  recordingTrack: "both",
                });
                console.log("[TWILIO] recording started");
              }
            } catch (e) {
              console.error("[TWILIO] recording error", (e )?.message || e);
            }
            break;
          }

          case "media": {
            const payload = data.media?.payload || "";
            framesIn++;
            bytesIn += Buffer.byteLength(payload);

            if (openAiWs.readyState === WebSocket.OPEN) {
              // Twilio payload is base64 μ-law 8k; send directly to OpenAI buffer
              try {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.append", audio: payload })
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
            try {
              if (openAiWs.readyState === WebSocket.OPEN) {
                // Finalize any buffered input before closing
                openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
              }
            } catch {}
            try {
              openAiWs.close();
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

    twilioWs.on("close", () => {
      console.log("[WS] Twilio disconnected");
      if (metricsTimer) clearInterval(metricsTimer);
      if (hbTimer) clearInterval(hbTimer);
      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}
    });

    twilioWs.on("error", (e) =>
      console.error("[WS] error", (e )?.message || e)
    );
  });

  return wss;
}
