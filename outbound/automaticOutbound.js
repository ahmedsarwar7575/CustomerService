// twalio_upsell.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const RT_MODEL = "gpt-4o-realtime-preview-2024-12-17";

function makeSystemMessage({ agentName="xyz", company="mno", product="abc" } = {}) {
  return `You are ${agentName} from ${company}. Purpose: upsell "${product}".
Disclose recording. Confirm time is okay, give a 1–2 sentence value pitch, ask one qualifying question,
handle objections briefly, label user interest (hot/warm/cold), collect consent to send details, and end with clear next steps.
Keep responses under 2 sentences unless asked.`;
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
      modalities: ["text","audio"],
      temperature: 0.7,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  };
}

async function summarizeUpsell({ qaPairs, params }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract call insights. Return ONLY JSON with keys: leadId, product, company, agentName, interest(one of: hot|warm|cold), objections(array), next_steps, consent(boolean), best_time(string|null), contact_info(object with email/phone if mentioned or null), qa_pairs(array of {q,a}). No prose.",
        },
        {
          role: "user",
          content: JSON.stringify({
            meta: {
              agentName: params.agentName || "xyz",
              company: params.company || "mno",
              product: params.product || "abc",
              leadId: params.leadId || null,
            },
            qa_pairs: qaPairs,
          }),
        },
      ],
    }),
  });
  const data = await r.json();
  const txt = data?.choices?.[0]?.message?.content?.trim() || "{}";
  let out;
  try { out = JSON.parse(txt); } catch { out = { raw: txt }; }
  console.log(JSON.stringify(out)); // ← prints the JSON
  return out;
}

export function attachUpsellStreamServer(server) {
  const wss = new WebSocketServer({ server, path: "/upsell-stream" });

  wss.on("connection", (connection) => {
    console.log("upsellStream connected");
    let streamSid = null;
    let callSid = null;
    let latestMediaTimestamp = 0;
    let markQueue = [];
    let hasActiveResponse = false;
    let pendingUserQ = null;
    const qaPairs = [];

    const openAiWs = createOpenAIWs();

    const sendMark = () => {
      if (!streamSid) return;
      try {
        connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "responsePart" } }));
        markQueue.push("responsePart");
      } catch {}
    };

    openAiWs.on("open", () => { 
      console.log("openAiWs opened");
     });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);
        if (msg.type === "response.created") hasActiveResponse = true;

        if ((msg.type === "response.audio.delta" || msg.type === "response.output_audio.delta") && msg.delta) {
          const payload = typeof msg.delta === "string" ? msg.delta : Buffer.from(msg.delta).toString("base64");
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
            try { openAiWs.send(JSON.stringify({ type: "response.cancel" })); } catch {}
            try { connection.send(JSON.stringify({ event: "clear", streamSid })); } catch {}
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
                if (pendingUserQ) { qaPairs.push({ q: pendingUserQ, a }); pendingUserQ = null; }
                else { qaPairs.push({ q: null, a }); }
              }
            }
          }
        }

        if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
          try { openAiWs.send(JSON.stringify({ type: "response.create" })); } catch {}
        }
      } catch {}
    });

    connection.on("message", async (raw) => {
      try {
        console.log("message", raw);
        const data = JSON.parse(raw);
        switch (data.event) {
          case "start": {
            streamSid = data.start.streamSid;
            callSid = data.start.callSid || null;
            const p = data.start?.customParameters || {};
            const instr = makeSystemMessage({ agentName: p.agentName, company: p.company, product: p.product });
            try { 
              openAiWs.send(JSON.stringify(buildSessionUpdate(instr)));
              console.log("session.update sent");
            } catch {}

            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const client = twilio(accountSid, authToken);
            try {
              const base = process.env.PUBLIC_BASE_URL;
              await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${base}/recording-status`,
                recordingStatusCallbackEvent: ["in-progress","completed","absent"],
                recordingChannels: "dual",
                recordingTrack: "both",
              });
            } catch {}
            latestMediaTimestamp = 0;
            break;
          }
          case "media": {
            latestMediaTimestamp = Number(data.media.timestamp) || latestMediaTimestamp;
            if (openAiWs.readyState === WebSocket.OPEN) {
              try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload })); } catch {}
            }
            break;
          }
          case "mark": if (markQueue.length) markQueue.shift(); break;
          case "stop": {
            if (openAiWs.readyState === WebSocket.OPEN) {
              try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch {}
              try { openAiWs.close(); } catch {}
            }
            break;
          }
          default: break;
        }
      } catch {}
    });

    connection.on("close", async () => {
      console.log("connection closed");
      if (openAiWs.readyState === WebSocket.OPEN) { try { openAiWs.close(); } catch {} }
      const params = { flow: "upsell", agentName: null, company: null, product: null, leadId: null };
      try { Object.assign(params, (connection?.start?.customParameters)||{}); } catch {}
      await summarizeUpsell({ qaPairs, params });
    });
  });
}
