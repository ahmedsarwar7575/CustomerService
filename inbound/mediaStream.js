// media-stream-bridge.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
import { summarizer } from "./summery.js";
import { connectIndex, semanticSearch } from "../utils/pinecone.js";

dotenv.config();

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  MODEL = "gpt-4o-realtime-preview-2024-12-17",
  PUBLIC_BASE_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TOPK = "8",
  RAG_MIN_SCORE = "0.6",
} = process.env;

if (!OPENAI_API_KEY) console.error("[OPENAI] missing OPENAI_API_KEY");

const SYSTEM_MESSAGE = `
ROLE
You are John Smith, a friendly GETPIE customer support agent.

STYLE
English only. Replies are short (1–2 sentences). One clear question at a time.

STRICT RAG
Use only tool-provided snippets. If none, say: "That isn’t in our knowledge base yet." Ask one clarifying question.

WORKFLOW
1) Acknowledge and ask one focused question until clear.
2) Propose a concise plan.
3) Collect and confirm full name and email before ending.
4) Classify ticket: support / sales / billing. Confirm.
5) End: “Are you satisfied with this solution, or would you like more support?”

QUERY REWRITE BEFORE RAG
Rewrite the transcript into a high-recall search query: fix spelling/ASR artifacts, normalize product names, expand abbreviations, remove fillers, translate to English if needed, add synonyms.
Then call tool search_kb with:
{ query: "<best rewrite>", queries: ["<alt1>","<alt2>"], topK: 8, minScore: 0.6 }.
Answer ONLY from returned snippets. Be brief.

FIRST TURN
“Hello, this is John Smith with GETPIE Customer Support. How can I help you today?”
`;

function safeParse(s) { try { return JSON.parse((s || "").trim()); } catch { return null; } }
function b64(x) { if (!x) return ""; if (typeof x === "string") return x; if (Buffer.isBuffer(x)) return x.toString("base64"); try { return Buffer.from(x).toString("base64"); } catch { return ""; } }
function jaccard(a = "", b = "") {
  const A = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}
async function retrieveAndRerank(queries, { topK, minScore }) {
  const perQ = Math.max(4, Math.ceil(topK / Math.max(1, queries.length)) + 2);
  const bags = await Promise.all(queries.map(q => semanticSearch(q, { topK: perQ, minScore }).catch(() => [])));
  const all = bags.flat();
  const byId = new Map();
  for (const m of all) {
    const prev = byId.get(m.id);
    if (!prev || (m.score ?? 0) > (prev.score ?? 0)) byId.set(m.id, m);
  }
  const dedup = [...byId.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out = [];
  for (const m of dedup) {
    const text = m.metadata?.text || m.metadata?.chunk || "";
    const sim = out.some(o => jaccard(o.metadata?.text || o.metadata?.chunk || "", text) > 0.85);
    if (!sim) out.push(m);
    if (out.length >= topK) break;
  }
  return out;
}

function createOpenAIWebSocket() {
  const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
  return new WebSocket(url, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" } });
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
      temperature: 0.2,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      tools: [{
        type: "function",
        name: "search_kb",
        description: "Search Pinecone knowledge base for relevant snippets.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            queries: { type: "array", items: { type: "string" } },
            topK: { type: "integer", default: 8 },
            minScore: { type: "number", default: 0.6 }
          },
          required: ["query"]
        }
      }]
    }
  };
}

export async function attachMediaStreamServer(server) {
  await connectIndex().catch(e => { console.error("[PINECONE] connect error", e); process.exit(1); });
  const wss = new WebSocketServer({ server, path: "/media-stream" });
  console.log("[WS] /media-stream");

  wss.on("connection", (connection) => {
    let streamSid = null;
    let callSid = null;
    let latestMediaTimestamp = 0;
    let markQueue = [];
    let hasActiveResponse = false;
    let rawTranscript = null;
    let qaPairs = [];

    const openAiWs = createOpenAIWebSocket();

    const sendMark = () => {
      if (!streamSid) return;
      connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "responsePart" } }));
      markQueue.push("responsePart");
    };

    openAiWs.on("open", () => {
      openAiWs.send(JSON.stringify(buildSessionUpdate()));
      setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 120);
    });
    openAiWs.on("error", (e) => console.error("[OPENAI] WS error", e?.message || e));
    openAiWs.on("close", (c, r) => console.log("[OPENAI] WS closed", c, r?.toString?.() || ""));

    let toolArgBuffer = {};
    openAiWs.on("message", async (buf) => {
      const msg = safeParse(buf);
      if (!msg) return;

      if (msg.type === "response.created") hasActiveResponse = true;

      if ((msg.type === "response.audio.delta" || msg.type === "response.output_audio.delta") && msg.delta) {
        const payload = b64(msg.delta);
        if (payload) { connection.send(JSON.stringify({ event: "media", streamSid, media: { payload } })); sendMark(); }
      }

      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const t = (msg.transcript || msg.item?.content?.find?.(c => c?.transcript)?.transcript || "").trim();
        if (t) { rawTranscript = t; console.log(`[TRANSCRIPT_RAW] ${t}`); }
      }

      if (msg.type === "input_audio_buffer.speech_started") {
        try { openAiWs.send(JSON.stringify({ type: "response.cancel" })); } catch {}
        try { connection.send(JSON.stringify({ event: "clear", streamSid })); } catch {}
        markQueue = [];
      }

      if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
        try { openAiWs.send(JSON.stringify({ type: "response.create" })); } catch {}
      }

      if (msg.type === "response.function_call_arguments.delta") {
        const fn = msg.name;
        toolArgBuffer[fn] = (toolArgBuffer[fn] || "") + (msg.delta || "");
      }

      if (msg.type === "response.function_call_arguments.done") {
        const fn = msg.name;
        const args = safeParse(toolArgBuffer[fn] || "{}") || {};
        delete toolArgBuffer[fn];

        if (fn === "search_kb" && args.query) {
          const qMain = String(args.query || "").trim();
          const qAlts = Array.isArray(args.queries) ? args.queries.filter(Boolean).map(String) : [];
          const topK = Number(args.topK || TOPK);
          const minScore = Number(args.minScore || RAG_MIN_SCORE);
          if (rawTranscript) console.log(`[BEFORE_REWRITE] "${rawTranscript}"`);
          if (qMain) console.log(`[REWRITE] best="${qMain}" alts=${JSON.stringify(qAlts)}`);

          let snippets = [];
          try {
            const queries = Array.from(new Set([qMain, ...qAlts].filter(Boolean)));
            const results = await retrieveAndRerank(queries, { topK, minScore });
            snippets = results.map(r => ({
              id: r.id,
              score: r.score,
              title: r.metadata?.title || null,
              source: r.metadata?.source || null,
              text: (r.metadata?.text || r.metadata?.chunk || "").slice(0, 1600)
            }));
            console.log(`[PINECONE] hits=${snippets.length} top=${snippets[0]?.score?.toFixed?.(3) ?? "-"}`);
          } catch (e) {
            console.error("[PINECONE] error", e?.message || e);
          }

          await openAiWs.send(JSON.stringify({
            type: "tool.output",
            tool_call_id: msg.call_id,
            output: JSON.stringify({ snippets })
          }));
        }
      }

      if (msg.type === "response.done") {
        hasActiveResponse = false;
        const outputs = msg.response?.output || [];
        for (const out of outputs) {
          if (out?.role === "assistant") {
            const part = Array.isArray(out.content)
              ? (out.content.find(c => typeof c?.transcript === "string")?.transcript ||
                 out.content.find(c => typeof c?.text === "string")?.text)
              : null;
            const a = (part || "").trim();
            if (a) {
              const q = rawTranscript || null;
              qaPairs.push({ q, a });
              console.log("[ASSISTANT]", a);
              rawTranscript = null;
            }
          }
        }
      }
    });

    connection.on("message", async (message) => {
      const data = safeParse(message);
      if (!data) return;
      switch (data.event) {
        case "connected":
          break;
        case "start": {
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;
          console.log("[TWILIO] start", streamSid, callSid || "");
          if (callSid && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && PUBLIC_BASE_URL) {
            const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            try {
              const rec = await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
                recordingChannels: "dual",
                recordingTrack: "both",
              });
              console.log("recording:", rec.sid);
            } catch (e) { console.error("[TWILIO] recording error", e?.message || e); }
          }
          latestMediaTimestamp = 0;
          break;
        }
        case "media":
          latestMediaTimestamp = Number(data.media.timestamp) || latestMediaTimestamp;
          try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload })); } catch (e) { console.error("[OPENAI] append error", e?.message || e); }
          break;
        case "mark":
          if (markQueue.length) markQueue.shift();
          break;
        case "stop":
          try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch {}
          try { openAiWs.close(); } catch {}
          break;
        default:
          break;
      }
    });

    connection.on("close", async () => {
      try { openAiWs.close(); } catch {}
      console.log("[WS] closed");
      try {
        const allData = await summarizer(qaPairs, callSid);
        console.log("[SUMMARY]", JSON.stringify({ allData }));
      } catch (e) { console.error("[SUMMARY] error", e); }
    });
  });
}
