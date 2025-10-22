// outbound/automaticOutbound.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PUBLIC_BASE_URL = "https://example.com",
  RT_MODEL = "gpt-4o-realtime-preview-2024-12-17",
  LOOPBACK = "0", // set to "1" to echo caller audio back to them (debug)
} = process.env;

/* ----------------------------- Audio helpers ----------------------------- */

// Linear resampler: Int16 PCM @ srcHz -> Int16 PCM @ dstHz (mono)
function resamplePCM16(pcm, srcHz, dstHz) {
  if (srcHz === dstHz) return pcm;
  const ratio = srcHz / dstHz;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = idx - i0;
    out[i] = (1 - frac) * pcm[i0] + frac * pcm[i1];
  }
  return out;
}

// μ-law (G.711 u-law) encoder for Int16 PCM
function encodeMuLaw(pcm16) {
  const out = new Uint8Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    let s = pcm16[i];
    s = Math.max(-32768, Math.min(32767, s));
    const sign = (s >> 8) & 0x80;
    if (sign) s = -s;
    let exponent = 7;
    for (
      let expMask = 0x4000;
      (s & expMask) === 0 && exponent > 0;
      exponent--, expMask >>= 1
    ) {}
    const mantissa = (s >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

// Heuristic: μ-law chunks from OpenAI are typically small/odd-sized; PCM16 are even-sized and larger.
function looksLikeMuLaw(buf) {
  return buf.byteLength % 2 === 1 || buf.byteLength <= 320;
}

/* --------------------------- OpenAI Realtime WS -------------------------- */

function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${RT_MODEL}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
}

// We request G.711 both directions (best case: no transcode).
// If the session ignores it, we transcode dynamically in the handler.
function sessionUpdatePayload(instructions) {
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

function systemPrompt() {
  return "You are an upsell agent. Disclose recording, confirm timing, 1–2 sentence pitch, one qualifier, brief objection handling, label interest (hot/warm/cold), collect consent, end with next steps. Keep replies ≤2 sentences unless asked.";
}

/* ----------------------------- Exported WSS ------------------------------ */

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  console.log("[WS] outbound upsell WSS ready (noServer)");

  wss.on("connection", (twilioWs, req) => {
    console.log(`[WS] Twilio connected (outbound) ${req?.url || ""}`);

    // --- State ---
    let streamSid = null;
    let callSid = null;

    // Metrics
    let framesIn = 0,
      framesOut = 0,
      bytesIn = 0,
      bytesOut = 0;
    let metricsTimer = null,
      hbTimer = null;

    // Force-commit any appended audio every 500ms (so your voice actually gets processed)
    let appendSinceCommit = 0;
    let commitTimer = null;
    const startCommitter = (openAiWs) => {
      if (commitTimer) return;
      commitTimer = setInterval(() => {
        if (appendSinceCommit > 0 && openAiWs.readyState === WebSocket.OPEN) {
          try {
            openAiWs.send(
              JSON.stringify({ type: "input_audio_buffer.commit" })
            );
          } catch {}
          appendSinceCommit = 0;
        }
      }, 500);
    };
    const stopCommitter = () => {
      if (commitTimer) clearInterval(commitTimer);
      commitTimer = null;
    };

    function startMetrics() {
      if (metricsTimer) return;
      metricsTimer = setInterval(() => {
        console.log(
          `[METRICS: outbound] in=${framesIn}/${bytesIn}B out=${framesOut}/${bytesOut}B`
        );
      }, 3000);
    }

    function startHeartbeat(openAiWs) {
      if (hbTimer) return;
      hbTimer = setInterval(() => {
        try {
          twilioWs.readyState === WebSocket.OPEN && twilioWs.ping();
        } catch {}
        try {
          openAiWs.readyState === WebSocket.OPEN && openAiWs.ping();
        } catch {}
      }, 15000);
    }

    const openAiWs = createOpenAIWs();

    /* ----------------------------- OpenAI events ----------------------------- */

    openAiWs.on("open", () => {
      console.log("[OPENAI] outbound socket opened");
      try {
        openAiWs.send(JSON.stringify(sessionUpdatePayload(systemPrompt())));
      } catch {}
    });

    openAiWs.on("message", (buf) => {
      const msg = JSON.parse(buf.toString());

      if (
        [
          "session.updated",
          "response.created",
          "response.done",
          "response.completed",
          "response.output_audio.delta",
          "response.audio.delta",
          "response.error",
        ].includes(msg.type)
      ) {
        console.log("[OPENAI EVT outbound]", msg.type);
      }

      // Kickoff AFTER session config is applied
      if (msg.type === "session.updated") {
        try {
          openAiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["audio"],
                instructions:
                  "Greet, confirm timing (1 sentence), brief value pitch.",
              },
            })
          );
          console.log("[OPENAI] outbound kickoff sent");
        } catch {}
      }

      // Audio deltas from model → ensure μ-law@8k → Twilio media payload
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
        if (!b64 || !streamSid || twilioWs.readyState !== WebSocket.OPEN)
          return;

        let outB64 = b64;
        const raw = Buffer.from(b64, "base64");
        if (!looksLikeMuLaw(raw)) {
          // Transcode PCM16@24k → μ-law@8k
          const pcm16 = new Int16Array(
            raw.buffer,
            raw.byteOffset,
            raw.byteLength / 2
          );
          const pcm8k = resamplePCM16(pcm16, 24000, 8000);
          const mulaw = encodeMuLaw(pcm8k);
          outB64 = Buffer.from(mulaw).toString("base64");
        }

        bytesOut += Buffer.byteLength(outB64);
        framesOut++;
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: outB64 },
          })
        );
        // Mark helps Twilio flush jitter
        try {
          twilioWs.send(
            JSON.stringify({ event: "mark", streamSid, mark: { name: "resp" } })
          );
        } catch {}
      }

      if (msg.type === "response.error") {
        console.error("[OPENAI] outbound response.error", msg.error || msg);
      }
    });

    openAiWs.on("error", (e) =>
      console.error("[OPENAI] outbound error", e?.message || e)
    );
    openAiWs.on("close", () => {
      console.log("[OPENAI] outbound socket closed");
      stopCommitter();
    });

    /* ----------------------------- Twilio events ----------------------------- */

    twilioWs.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        startMetrics();
        startHeartbeat(openAiWs);

        if (data.event === "connected") {
          console.log("[TWILIO] outbound event connected");
          return;
        }

        if (data.event === "start") {
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;
          console.log(
            `[TWILIO] outbound start streamSid=${streamSid} callSid=${callSid}`
          );

          // Optional: start Twilio recording (note: streamed audio won’t appear in Twilio recording)
          try {
            if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && callSid) {
              const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
              await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                recordingStatusCallbackEvent: [
                  "in-progress",
                  "completed",
                  "absent",
                ],
                recordingChannels: "dual",
                recordingTrack: "both",
              });
              console.log("[TWILIO] outbound recording started");
            }
          } catch (e) {
            console.error("[TWILIO] outbound recording error", e?.message || e);
          }

          startCommitter(openAiWs);
          return;
        }

        if (data.event === "media") {
          const payload = data.media?.payload || "";
          framesIn++;
          bytesIn += Buffer.byteLength(payload);

          // Quick echo test path: set LOOPBACK=1 in env to verify Twilio ⇄ WS transport
          if (LOOPBACK === "1") {
            twilioWs.send(
              JSON.stringify({ event: "media", streamSid, media: { payload } })
            );
          }

          if (openAiWs.readyState === WebSocket.OPEN) {
            try {
              // Twilio payload is base64 μ-law/8k 20ms frames; append as-is.
              openAiWs.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: payload,
                })
              );
              appendSinceCommit++;
            } catch (e) {
              console.error("[OPENAI] outbound append error", e?.message || e);
            }
          }
          return;
        }

        if (data.event === "mark") {
          // no-op, but could manage a markQueue here
          return;
        }

        if (data.event === "stop") {
          console.log("[TWILIO] outbound stop");
          try {
            openAiWs.readyState === WebSocket.OPEN &&
              openAiWs.send(
                JSON.stringify({ type: "input_audio_buffer.commit" })
              );
          } catch {}
          try {
            openAiWs.close();
          } catch {}
          stopCommitter();
          return;
        }

        // Fallback logging
        console.log("[TWILIO] outbound event", data.event);
      } catch (e) {
        console.error("[WS] outbound parse error", e);
      }
    });

    twilioWs.on("close", () => {
      console.log("[WS] Twilio disconnected (outbound)");
      metricsTimer && clearInterval(metricsTimer);
      hbTimer && clearInterval(hbTimer);
      stopCommitter();
      try {
        openAiWs.readyState === WebSocket.OPEN && openAiWs.close();
      } catch {}
    });

    twilioWs.on("error", (e) =>
      console.error("[WS] outbound error", e?.message || e)
    );
  });

  return wss;
}
