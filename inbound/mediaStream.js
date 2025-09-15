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
  VAD_THRESHOLD = "0.7",
  VAD_SILENCE_MS = "800",
  DEBUG_LEVEL = "debug" // trace|debug|info|warn|error
} = process.env;

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const MIN_LVL = LEVELS[DEBUG_LEVEL] ?? 30;
const log = (lvl, tag, obj = {}) => {
  const L = LEVELS[lvl] ?? LEVELS.info;
  if (L < MIN_LVL) return;
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, lvl, tag, ...obj }));
};

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
Rewrite the transcript into a high-recall query: fix spelling/ASR artifacts, normalize product names, expand abbreviations, remove fillers, translate to English if needed, add synonyms.
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
      turn_detection: { type: "server_vad", threshold: Number(VAD_THRESHOLD), prefix_padding_ms: 300, silence_duration_ms: Number(VAD_SILENCE_MS) },
      input_audio_format:  { type: "g711_ulaw", sample_rate_hz: 8000 },
      output_audio_format: { type: "g711_ulaw", sample_rate_hz: 8000 },
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

// ───────────────────────────────────────────────────────────────────────────────
// Exported entry: attachMediaStreamServer
// ───────────────────────────────────────────────────────────────────────────────
export async function attachMediaStreamServer(server) {
  await connectIndex().catch(e => { log("error","PINECONE_CONNECT_FAIL",{err: String(e?.message || e)}); process.exit(1); });

  const wss = new WebSocketServer({ server, path: "/media-stream" });
  log("info","WS_READY",{path:"/media-stream"});

  wss.on("connection", (connection) => {
    // state
    let streamSid = null;
    let callSid = null;
    let sessionReady = false;
    let streamReady = false;
    let greeted = false;
    let hasActiveResponse = false;
    let rawTranscript = null;
    let qaPairs = [];
    let toolArgBuffer = {};
    let queuedAudio = [];
    let sentAudioChunks = 0;
    let firstAudioAt = 0;
    let lastAudioAt = 0;
    let lastTextAt = 0;

    // diagnostics
    const ring = [];
    const pushEvt = (src, evt, extra = {}) => {
      const rec = { t: Date.now(), src, evt, ...extra };
      ring.push(rec); if (ring.length > 120) ring.shift();
      log("debug","EVT",{src,evt,...extra});
    };
    const dumpDiag = (why) => {
      const snapshot = {
        why,
        sessionReady, streamReady, greeted, hasActiveResponse,
        streamSid, callSid,
        sentAudioChunks, firstAudioAt, lastAudioAt, lastTextAt,
        last20: ring.slice(-20)
      };
      log("warn","DIAGNOSTICS", snapshot);
    };

    // WS to OpenAI
    const openAiWs = createOpenAIWebSocket();
    const sendAudio = (payload) => {
      if (!payload) return;
      if (!streamSid) { queuedAudio.push(payload); pushEvt("OPENAI","AUDIO_QUEUED",{len: payload.length}); return; }
      connection.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
      sentAudioChunks++; lastAudioAt = Date.now();
      const markName = `r_${sentAudioChunks}`;
      connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }));
      pushEvt("OPENAI","AUDIO_OUT",{chunks: sentAudioChunks});
    };
    const flushQueued = () => {
      if (!streamSid || queuedAudio.length === 0) return;
      for (const p of queuedAudio) sendAudio(p);
      pushEvt("TWILIO","AUDIO_FLUSHED",{count: queuedAudio.length});
      queuedAudio = [];
    };
    const tryGreet = () => {
      if (greeted || !sessionReady || !streamReady) return;
      greeted = true;
      try {
        openAiWs.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio","text"] } }));
        pushEvt("OPENAI","GREETING_SENT");
        // watchdog: if no audio in 4s, re-assert formats and retry once
        setTimeout(() => {
          if (sentAudioChunks === 0) {
            log("warn","NO_AUDIO_FROM_OPENAI_AFTER_GREETING",{sessionReady,streamReady});
            openAiWs.send(JSON.stringify(buildSessionUpdate())); // re-assert formats
            setTimeout(() => {
              if (sentAudioChunks === 0) {
                openAiWs.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio","text"] } }));
                pushEvt("OPENAI","GREETING_RETRY");
              }
            }, 800);
          }
        }, 4000);
      } catch (e) { log("error","GREETING_ERROR",{err:String(e?.message||e)}); }
    };

    // heartbeat for Realtime socket
    const hb = setInterval(() => { try { openAiWs.ping(); } catch {} }, 15000);

    openAiWs.on("open", () => {
      pushEvt("OPENAI","WS_OPEN");
      openAiWs.send(JSON.stringify(buildSessionUpdate()));
    });
    openAiWs.on("close", (code, reason) => { clearInterval(hb); log("warn","OPENAI_WS_CLOSE",{code,reason:String(reason)}); dumpDiag("OPENAI_WS_CLOSE"); });
    openAiWs.on("error", (e) => { log("error","OPENAI_WS_ERROR",{err:String(e?.message||e)}); });

    openAiWs.on("message", async (buf) => {
      const msg = safeParse(buf);
      if (!msg) return;
      switch (msg.type) {
        case "session.created":
        case "session.updated":
          sessionReady = true;
          pushEvt("OPENAI","SESSION_READY");
          tryGreet();
          break;

        case "response.created":
          hasActiveResponse = true;
          pushEvt("OPENAI","RESPONSE_CREATED",{id: msg.response?.id});
          break;

        case "response.output_audio.delta":
        case "response.audio.delta": {
          const payload = b64(msg.delta);
          if (payload && !firstAudioAt) firstAudioAt = Date.now();
          if (payload) sendAudio(payload);
          break;
        }

        case "response.output_text.delta": {
          lastTextAt = Date.now();
          pushEvt("OPENAI","TEXT_DELTA",{len: (msg.delta||"").length});
          break;
        }

        case "conversation.item.input_audio_transcription.completed": {
          const t = (msg.transcript || msg.item?.content?.find?.(c => c?.transcript)?.transcript || "").trim();
          if (t) { rawTranscript = t; log("info","TRANSCRIPT_RAW",{t}); }
          break;
        }

        case "input_audio_buffer.speech_started": {
          if (streamSid) connection.send(JSON.stringify({ event: "clear", streamSid }));
          pushEvt("OPENAI","VAD_SPEECH_STARTED");
          break;
        }

        case "input_audio_buffer.speech_stopped": {
          pushEvt("OPENAI","VAD_SPEECH_STOPPED");
          if (!hasActiveResponse) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio","text"] } }));
              pushEvt("OPENAI","RESPONSE_CREATE_AFTER_STOP");
            } catch (e) { log("error","RESP_CREATE_ERR",{err:String(e?.message||e)}); }
          }
          break;
        }

        case "response.function_call_arguments.delta": {
          const fn = msg.name; toolArgBuffer[fn] = (toolArgBuffer[fn] || "") + (msg.delta || "");
          break;
        }

        case "response.function_call_arguments.done": {
          const fn = msg.name;
          const args = safeParse(toolArgBuffer[fn] || "{}") || {};
          delete toolArgBuffer[fn];
          if (fn === "search_kb" && args.query) {
            const qMain = String(args.query || "").trim();
            const qAlts = Array.isArray(args.queries) ? args.queries.filter(Boolean).map(String) : [];
            const topK = Number(args.topK || TOPK);
            const minScore = Number(args.minScore || RAG_MIN_SCORE);
            if (rawTranscript) log("info","BEFORE_REWRITE",{t: rawTranscript});
            if (qMain) log("info","REWRITE",{best: qMain, alts: qAlts});
            let snippets = [];
            try {
              const queries = Array.from(new Set([qMain, ...qAlts].filter(Boolean)));
              const results = await retrieveAndRerank(queries, { topK, minScore });
              snippets = results.map(r => ({
                id: r.id, score: r.score,
                title: r.metadata?.title || null,
                source: r.metadata?.source || null,
                text: (r.metadata?.text || r.metadata?.chunk || "").slice(0, 1600)
              }));
              log("info","PINECONE_HITS",{n: snippets.length, top: snippets[0]?.score ?? null});
            } catch (e) {
              log("error","PINECONE_ERROR",{err:String(e?.message||e)});
            }
            await openAiWs.send(JSON.stringify({ type: "tool.output", tool_call_id: msg.call_id, output: JSON.stringify({ snippets }) }));
          }
          break;
        }

        case "response.done": {
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
                log("info","ASSISTANT_MSG",{a, audioChunks: sentAudioChunks});
                rawTranscript = null;
              }
            }
          }
          sentAudioChunks = 0;
          break;
        }

        case "error":
          log("error","OPENAI_ERROR_EVT",{msg});
          dumpDiag("OPENAI_ERROR_EVT");
          break;

        default:
          pushEvt("OPENAI","OTHER",{t: msg.type});
      }
    });

    // Twilio side
    connection.on("message", async (message) => {
      const data = safeParse(message);
      if (!data) { log("warn","TWILIO_BAD_JSON"); return; }

      switch (data.event) {
        case "connected":
          pushEvt("TWILIO","CONNECTED");
          break;

        case "start": {
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;
          streamReady = true;
          pushEvt("TWILIO","START",{streamSid, callSid});
          flushQueued();
          tryGreet();
          if (callSid && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && PUBLIC_BASE_URL) {
            const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            try {
              const rec = await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
                recordingChannels: "dual",
                recordingTrack: "both",
              });
              pushEvt("TWILIO","RECORDING_STARTED",{sid: rec.sid});
            } catch (e) { log("warn","TWILIO_RECORDING_FAIL",{err:String(e?.message||e)}); }
          }
          // watchdog if Twilio never sends media
          setTimeout(() => {
            if (sentAudioChunks === 0 && !firstAudioAt) dumpDiag("NO_MEDIA_OR_AUDIO_YET_5S");
          }, 5000);
          break;
        }

        case "media": {
          try {
            openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload }));
          } catch (e) { log("error","OPENAI_APPEND_FAIL",{err:String(e?.message||e)}); }
          break;
        }

        case "mark": {
          pushEvt("TWILIO","MARK_ACK",{name: data.mark?.name});
          break;
        }

        case "stop": {
          pushEvt("TWILIO","STOP");
          try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch {}
          try { openAiWs.close(); } catch {}
          break;
        }

        default:
          pushEvt("TWILIO","OTHER",{event: data.event});
      }
    });

    connection.on("close", async () => {
      try { openAiWs.close(); } catch {}
      log("info","WS_CLOSED",{streamSid, callSid});
      try {
        const allData = await summarizer(qaPairs, callSid);
        log("info","SUMMARY",{allData});
      } catch (e) { log("warn","SUMMARY_FAIL",{err:String(e?.message||e)}); }
    });

    // hard fail-safe: if neither sessionReady nor streamReady within 8s
    setTimeout(() => {
      if (!sessionReady || !streamReady) dumpDiag("NOT_READY_8S");
    }, 8000);
  });
}
