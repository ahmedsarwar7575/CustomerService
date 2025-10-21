import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const RT_MODEL = "gpt-4o-realtime-preview-2024-12-17";

function makeSystemMessage() {
  return `You are an upsell agent. Disclose recording, confirm timing, 1–2 sentence pitch, one qualifier, brief objection handling, label interest (hot/warm/cold), collect consent, end with next steps. Keep replies ≤2 sentences unless asked.`;
}

function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${RT_MODEL}`;
  return new WebSocket(url, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
  });
}

function buildSessionUpdate(instructions) {
  return {
    type: "session.update",
    session: {
      turn_detection: { type: "server_vad", threshold: 0.6, prefix_padding_ms: 200, silence_duration_ms: 300 },
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

function kickoff(openAiWs, instructions) {
  openAiWs.send(JSON.stringify(buildSessionUpdate(instructions)));
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
}

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (connection, req) => {
    console.log(`[WS] Twilio connected ${req?.url || ""}`);

    let streamSid = null;
    let callSid = null;
    let markQueue = [];
    let hasActiveResponse = false;
    let pendingUserQ = null;
    let openaiReady = false;
    let framesIn = 0,
      framesOut = 0,
      bytesIn = 0,
      bytesOut = 0;
    let metricsTimer = null;

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
        connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "responsePart" } }));
        markQueue.push("responsePart");
      } catch {}
    };

    openAiWs.on("open", () => {
      openaiReady = true;
      console.log("[OPENAI] socket opened");
    });
    openAiWs.on("error", (e) => console.error("[OPENAI] error", e?.message || e));
    openAiWs.on("close", () => console.log("[OPENAI] socket closed"));

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);
        if (msg.type === "response.created") hasActiveResponse = true;

        if ((msg.type === "response.audio.delta" || msg.type === "response.output_audio.delta") && msg.delta) {
          const payload = typeof msg.delta === "string" ? msg.delta : Buffer.from(msg.delta).toString("base64");
          bytesOut += Buffer.byteLength(payload);
          framesOut++;
          connection.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
          sendMark();
        }

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const t =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (msg.item?.content?.find?.((c) => typeof c?.transcript === "string")?.transcript || "").trim();
          if (t) pendingUserQ = t;
        }

        if (msg.type === "input_audio_buffer.speech_started") {
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

        if (msg.type === "response.done") {
          hasActiveResponse = false;
          const outputs = msg.response?.output || [];
          for (const out of outputs) {
            if (out?.role === "assistant") {
              const part = Array.isArray(out.content)
                ? out.content.find((c) => typeof c?.transcript === "string" && c.transcript.trim())
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

        if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch {}
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e);
      }
    });

    connection.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);
        if (!metricsTimer) startMetrics();

        switch (data.event) {
          case "start": {
            streamSid = data.start.streamSid;
            callSid = data.start.callSid || null;
            console.log(`[TWILIO] start streamSid=${streamSid} callSid=${callSid}`);

            const instr = makeSystemMessage();
            if (openaiReady) kickoff(openAiWs, instr);
            else {
              const t = setInterval(() => {
                if (openaiReady) {
                  kickoff(openAiWs, instr);
                  clearInterval(t);
                }
              }, 50);
              setTimeout(() => clearInterval(t), 5000);
            }

            try {
              const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
              const base = process.env.PUBLIC_BASE_URL || "https://example.com";
              await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${base}/recording-status`,
                recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
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
            if (openAiWs.readyState === WebSocket.OPEN) {
              try {
                openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
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
            if (openAiWs.readyState === WebSocket.OPEN) {
              try {
                openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
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
      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}
      console.log("[SUMMARY] qaPairs", qaPairs.length);
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  console.log("[WS] upsell WSS ready (noServer)");
  return wss;
}
