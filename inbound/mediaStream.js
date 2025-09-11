import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { connectIndex, semanticSearchTopK, buildSnippetsBlock } from "../utils/pinecone.js";

dotenv.config();

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `
ROLE
You are John Smith, a friendly GETPIE customer support agent.

STYLE
English only. Replies are short (1–2 sentences). One clear question at a time. Warm, calm, confident.

STRICT RAG
Only answer with facts from SNIPPETS.
If no relevant snippet exists for this turn, reply EXACTLY: "That isn’t in our knowledge base yet."
Do not invent facts.
`;

const jlog = (event, payload = {}) => {
  try { console.log(JSON.stringify({ ts: Date.now(), event, payload })); } catch {}
};
const jerr = (where, e) => {
  console.error(JSON.stringify({ ts: Date.now(), event: "error", where, message: e?.message || String(e) }));
};

function b64(x) { if (!x) return ""; if (typeof x === "string") return x; if (Buffer.isBuffer(x)) return x.toString("base64"); try { return Buffer.from(x).toString("base64"); } catch { return ""; } }

await connectIndex().catch(e => { jerr("pinecone.connectIndex", e); process.exit(1); });

function createOpenAIWebSocket() {
  try {
    const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
    return new WebSocket(url, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" } });
  } catch (e) { jerr("openai.ws.create", e); throw e; }
}

function buildSessionUpdate() {
  return {
    type: "session.update",
    session: {
      turn_detection: { type: "server_vad", threshold: 0.7, prefix_padding_ms: 300, silence_duration_ms: 800 },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.8,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  };
}

export function attachMediaStreamServer(server) {
  const wss = new WebSocketServer({ server, path: "/media-stream" });

  wss.on("connection", (connection) => {
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    let pendingUserQ = null;
    let hasActiveResponse = false;

    let lastInjectedItemId = null;
    let awaitingInjectedAck = false;
    let pendingResponseAfterInject = false;

    const openAiWs = createOpenAIWebSocket();

    const initializeSession = () => {
      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate()));
        setTimeout(() => {
          try { openAiWs.send(JSON.stringify({ type: "response.create" })); } catch (e) { jerr("openai.response.create.greeting", e); }
        }, 150);
      } catch (e) { jerr("openai.session.update", e); }
    };

    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0) {
        try { openAiWs.send(JSON.stringify({ type: "response.cancel" })); } catch (e) { jerr("openai.response.cancel", e); }
        try { connection.send(JSON.stringify({ event: "clear", streamSid })); } catch (e) { jerr("twilio.clear", e); }
        markQueue = [];
        responseStartTimestampTwilio = null;
      }
    };
    const sendMark = () => {
      if (!streamSid) return;
      try { connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "responsePart" } })); markQueue.push("responsePart"); }
      catch (e) { jerr("twilio.mark", e); }
    };

    openAiWs.on("open", () => { setTimeout(initializeSession, 100); });
    openAiWs.on("close", () => {});
    openAiWs.on("error", (e) => { jerr("openai.ws", e); });

    openAiWs.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { jerr("openai.parse", e); return; }

      if (msg.type === "response.created") { hasActiveResponse = true; }

      if (msg.type === "conversation.item.created" && awaitingInjectedAck && msg.item?.metadata?.rag_injected) {
        lastInjectedItemId = msg.item.id;
        awaitingInjectedAck = false;
        if (pendingResponseAfterInject) {
          pendingResponseAfterInject = false;
          try { openAiWs.send(JSON.stringify({ type: "response.create" })); } catch (e) { jerr("openai.response.create.afterAck", e); }
        }
      }

      if ((msg.type === "response.output_audio.delta" || msg.type === "response.audio.delta") && msg.delta) {
        try {
          const payload = b64(msg.delta);
          if (payload) {
            connection.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
            if (!responseStartTimestampTwilio) responseStartTimestampTwilio = latestMediaTimestamp;
            sendMark();
          }
        } catch (e) { jerr("twilio.media.send", e); }
      }

      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const q =
          (typeof msg.transcript === "string" && msg.transcript.trim()) ||
          (msg.item?.content?.find?.((c) => typeof c?.transcript === "string")?.transcript || "").trim();
        if (q) pendingUserQ = q;
      }

      if (msg.type === "input_audio_buffer.speech_started") handleSpeechStartedEvent();

      if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
        try {
          const q = (pendingUserQ || "").trim();
          if (q) {
            jlog("question", { text: q });

            let results = [];
            try {
              const topK = Number(process.env.TOPK || 6);
              results = await semanticSearchTopK(q, { topK });
              jlog("retrieval", {
                query: q,
                count: results.length,
                items: results.map(r => ({ id: r.id, score: Number((r.score ?? 0).toFixed?.(3) ?? r.score), preview: r.text.slice(0, 500) }))
              });
            } catch (e) { jerr("rag.retrieval", e); }

            if (results.length) {
              const block = buildSnippetsBlock(q, results);
              awaitingInjectedAck = true;
              pendingResponseAfterInject = true;
              try {
                openAiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "system",
                    content: [{ type: "input_text", text: `### SNIPPETS\n${block}\n\n### USER QUESTION\n${q}` }],
                    metadata: { rag_injected: true }
                  }
                }));
              } catch (e) { jerr("openai.item.create.snippets", e); pendingResponseAfterInject = false; }
            } else {
              awaitingInjectedAck = true;
              pendingResponseAfterInject = true;
              try {
                openAiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "system",
                    content: [{ type: "input_text", text:
`### NO_SNIPPETS_GUARD
No relevant knowledge base snippets were found for this turn.
You must reply EXACTLY: "That isn’t in our knowledge base yet."` }],
                    metadata: { rag_injected: true }
                  }
                }));
              } catch (e) { jerr("openai.item.create.guard", e); pendingResponseAfterInject = false; }
            }
          }
        } catch (e) { jerr("turn.stop", e); }
      }

      if (msg.type === "response.done") {
        hasActiveResponse = false;
        if (lastInjectedItemId) {
          try { openAiWs.send(JSON.stringify({ type: "conversation.item.delete", item_id: lastInjectedItemId })); }
          catch (e) { jerr("openai.item.delete", e); }
          lastInjectedItemId = null;
        }
        const outputs = msg.response?.output || [];
        for (const out of outputs) {
          if (out?.role === "assistant") {
            const part = Array.isArray(out.content)
              ? out.content.find((c) => typeof c?.transcript === "string" && c.transcript.trim())
              : null;
            const a = (part?.transcript || "").trim();
            if (a) jlog("answer", { text: a });
          }
        }
      }
    });

    connection.on("message", async (message) => {
      let data;
      try { data = JSON.parse(message); } catch (e) { jerr("ws.parse", e); return; }
      switch (data.event) {
        case "connected": break;
        case "start":
          streamSid = data.start.streamSid;
          responseStartTimestampTwilio = null;
          latestMediaTimestamp = 0;
          setTimeout(initializeSession, 0);
          break;
        case "media":
          latestMediaTimestamp = Number(data.media.timestamp) || latestMediaTimestamp;
          if (openAiWs.readyState === WebSocket.OPEN) {
            try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload })); }
            catch (e) { jerr("openai.buffer.append", e); }
          }
          break;
        case "mark":
          if (markQueue.length) markQueue.shift();
          break;
        case "stop":
          if (openAiWs.readyState === WebSocket.OPEN) {
            try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch (e) { jerr("openai.buffer.commit", e); }
            try { openAiWs.close(); } catch (e) { jerr("openai.ws.close", e); }
          }
          break;
        default: break;
      }
    });

    connection.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN) {
        try { openAiWs.close(); } catch (e) { jerr("openai.ws.close.onClientClose", e); }
      }
    });
  });
}
