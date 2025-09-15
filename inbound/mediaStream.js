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
  DEBUG_LEVEL = "error"
} = process.env;

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const MIN_LVL = LEVELS[DEBUG_LEVEL] ?? 30;
const log = (lvl, tag, obj = {}) => {
  const L = LEVELS[lvl] ?? LEVELS.info;
  if (L < MIN_LVL) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), lvl, tag, ...obj }));
};

const SYSTEM_MESSAGE = `
ROLE
You are John Smith, a friendly GETPIE customer support agent.
STYLE
English only. Replies are short (1–2 sentences). One clear question at a time.
STRICT RAG
Use only tool-provided snippets. If none, say: "That isn’t in our knowledge base yet." Ask one clarifying question.
WORKFLOW
Acknowledge → ask one focused question → propose a concise plan → collect name+email → classify (support/sales/billing) → close.
QUERY REWRITE BEFORE RAG
Rewrite transcript into a high-recall query (fix ASR, normalize names, expand abbreviations, remove fillers, translate to English if needed, add synonyms). Then call tool search_kb with { query, queries, topK, minScore }. Answer ONLY from returned snippets. Be brief.
FIRST TURN
“Hello, this is John Smith with GETPIE Customer Support. How can I help you today?”
`;

const b64 = (x) => (typeof x === "string" ? x : Buffer.isBuffer(x) ? x.toString("base64") : Buffer.from(x || "").toString("base64"));
const peek = (buf, n = 180) => { try { return (Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf)).slice(0, n); } catch { return ""; } };
function parseMsg(data, isBinary, srcTag) {
  try {
    const s = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
    return JSON.parse(s.trim());
  } catch (e) {
    log("warn", `${srcTag}_BAD_JSON`, { isBinary: !!isBinary, len: (data?.length || 0), peek: peek(data) });
    return null;
  }
}

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
  for (const m of all) { const p = byId.get(m.id); if (!p || (m.score ?? 0) > (p.score ?? 0)) byId.set(m.id, m); }
  const dedup = [...byId.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out = [];
  for (const m of dedup) {
    const t = m.metadata?.text || m.metadata?.chunk || "";
    const sim = out.some(o => jaccard(o.metadata?.text || o.metadata?.chunk || "", t) > 0.85);
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
      input_audio_format:  "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.7, // >= 0.6 per your error
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
  await connectIndex().catch(e => { log("error","PINECONE_CONNECT_FAIL",{err:String(e?.message||e)}); process.exit(1); });

  const wss = new WebSocketServer({ server, path: "/media-stream" });
  log("info","WS_READY",{path:"/media-stream"});

  wss.on("connection", (connection) => {
    let streamSid = null, callSid = null;
    let sessionReady = false, streamReady = false, greeted = false;
    let rawTranscript = null, qaPairs = [];
    let toolArgBuffer = {}, queuedOutAudio = [];
    let sentAudioChunks = 0, firstAudioAt = 0;

    // inbound audio buffer (Twilio -> OpenAI) until OpenAI is ready
    const inBuf = []; const INBUF_MAX = 220;

    // response gating: never send response.create while one is active
    let activeResponse = false;
    let pendingResponse = false;
    let pendingReason = "";

    const openAiWs = createOpenAIWebSocket();
    const openAiReady = () => openAiWs.readyState === WebSocket.OPEN && sessionReady;

    const requestResponse = (reason = "") => {
      if (!openAiReady()) return; // ignore until session ready
      if (activeResponse) { pendingResponse = true; pendingReason = reason || pendingReason; log("debug","RESP_QUEUED",{reason}); return; }
      try {
        activeResponse = true;
        openAiWs.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio","text"] } }));
        log("debug","RESP_CREATE",{reason});
      } catch (e) { log("error","RESP_CREATE_ERR",{err:String(e?.message||e)}); activeResponse = false; }
    };

    const onResponseDone = () => {
      activeResponse = false;
      if (pendingResponse) {
        const why = pendingReason;
        pendingResponse = false; pendingReason = "";
        requestResponse(`after_${why}`);
      }
    };

    const sendToTwilio = (payload) => {
      if (!payload) return;
      if (!streamSid) { queuedOutAudio.push(payload); return; }
      connection.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
      sentAudioChunks++;
      connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: `r_${sentAudioChunks}` } }));
    };
    const flushOutAudio = () => {
      if (!streamSid || !queuedOutAudio.length) return;
      for (const p of queuedOutAudio) sendToTwilio(p);
      log("debug","AUDIO_FLUSHED_TO_TWILIO",{count: queuedOutAudio.length});
      queuedOutAudio.length = 0;
    };

    const flushInBufToOpenAI = () => {
      if (!openAiReady() || !inBuf.length) return;
      const n = inBuf.length;
      for (const payload of inBuf) {
        try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload })); }
        catch (e) { log("error","OPENAI_APPEND_FAIL_FLUSH",{err:String(e?.message||e)}); break; }
      }
      log("debug","INBUF_FLUSHED",{count: n});
      inBuf.length = 0;
    };

    const tryGreet = () => {
      if (greeted || !streamReady || !openAiReady()) return;
      greeted = true;
      requestResponse("greet");
      setTimeout(() => {
        if (sentAudioChunks === 0) {
          log("warn","NO_AUDIO_AFTER_GREETING_RETRY");
          try { openAiWs.send(JSON.stringify(buildSessionUpdate())); } catch {}
          requestResponse("greet_retry");
        }
      }, 3500);
    };

    const hb = setInterval(() => { try { openAiWs.ping(); } catch {} }, 15000);

    openAiWs.on("open", () => {
      log("debug","OPENAI_WS_OPEN");
      openAiWs.send(JSON.stringify(buildSessionUpdate()));
    });
    openAiWs.on("close", (c, r) => { clearInterval(hb); log("warn","OPENAI_WS_CLOSE",{code:c,reason:String(r)}); });
    openAiWs.on("error", (e) => log("error","OPENAI_WS_ERROR",{err:String(e?.message||e)}));

    openAiWs.on("message", async (data, isBinary) => {
      const msg = parseMsg(data, isBinary, "OPENAI");
      if (!msg) return;

      if (msg.type === "session.created" || msg.type === "session.updated") {
        sessionReady = true;
        log("debug","SESSION_READY");
        flushInBufToOpenAI();
        tryGreet();
        return;
      }
      if (msg.type === "response.created") { activeResponse = true; return; }

      if (msg.type === "response.output_audio.delta" || msg.type === "response.audio.delta") {
        const payload = b64(msg.delta);
        if (payload && !firstAudioAt) firstAudioAt = Date.now();
        sendToTwilio(payload);
        return;
      }

      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const t = (msg.transcript || msg.item?.content?.find?.(c => c?.transcript)?.transcript || "").trim();
        if (t) { rawTranscript = t; log("info","TRANSCRIPT_RAW",{t}); }
        return;
      }

      if (msg.type === "input_audio_buffer.speech_started") {
        // Cancel any current response audio, but don't immediately create a new one
        try { openAiWs.send(JSON.stringify({ type: "response.cancel" })); } catch {}
        if (streamSid) connection.send(JSON.stringify({ event: "clear", streamSid }));
        return;
      }

      if (msg.type === "input_audio_buffer.speech_stopped") {
        // Schedule a response after the current one (if any) finishes
        requestResponse("speech_stopped");
        return;
      }

      if (msg.type === "response.function_call_arguments.delta") {
        const fn = msg.name; toolArgBuffer[fn] = (toolArgBuffer[fn] || "") + (msg.delta || "");
        return;
      }

      if (msg.type === "response.function_call_arguments.done") {
        const fn = msg.name;
        const args = parseMsg(toolArgBuffer[fn] || "{}", false, "OPENAI_TOOL_ARGS") || {};
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
          } catch (e) { log("error","PINECONE_ERROR",{err:String(e?.message||e)}); }

          await openAiWs.send(JSON.stringify({ type: "tool.output", tool_call_id: msg.call_id, output: JSON.stringify({ snippets }) }));
        }
        return;
      }

      if (msg.type === "response.done") {
        // capture assistant text for your summary
        const outs = msg.response?.output || [];
        for (const out of outs) {
          if (out?.role === "assistant") {
            const part = Array.isArray(out.content)
              ? (out.content.find(c => typeof c?.transcript === "string")?.transcript ||
                 out.content.find(c => typeof c?.text === "string")?.text)
              : null;
            const a = (part || "").trim();
            if (a) { const q = rawTranscript || "not specified"; qaPairs.push({ q, a }); log("info","ASSISTANT_MSG",{a, audioChunks: sentAudioChunks}); rawTranscript = null; }
          }
        }
        sentAudioChunks = 0;
        onResponseDone();
        return;
      }

      if (msg.type === "error") {
        // If it's "conversation_already_has_active_response", queue another one
        const code = msg.error?.code || "";
        if (code === "conversation_already_has_active_response") {
          pendingResponse = true; pendingReason = "auto_from_error";
          log("warn","ACTIVE_RESPONSE_BUSY_QUEUE");
        } else if (code === "decimal_below_min_value") {
          // self-heal: resend session with temperature 0.6
          try { openAiWs.send(JSON.stringify(buildSessionUpdate())); log("warn","TEMP_SELF_HEAL"); } catch {}
        }
        log("error","OPENAI_ERROR_EVT",{msg});
        return;
      }
    });

    connection.on("message", async (message, isBinary) => {
      const data = parseMsg(message, isBinary, "TWILIO");
      if (!data) return;

      switch (data.event) {
        case "connected":
          log("debug","TWILIO_CONNECTED");
          break;

        case "start": {
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;
          log("info","TWILIO_START",{streamSid,callSid});
          streamReady = true;
          flushOutAudio();
          tryGreet();
          if (callSid && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && PUBLIC_BASE_URL) {
            const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            try {
              const rec = await client.calls(callSid).recordings.create({
                recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
                recordingChannels: "dual", recordingTrack: "both",
              });
              log("debug","TWILIO_RECORDING_STARTED",{sid: rec.sid});
            } catch (e) { log("warn","TWILIO_RECORDING_FAIL",{err:String(e?.message||e)}); }
          }
          break;
        }

        case "media": {
          const payload = data.media?.payload; if (!payload) return;
          if (!openAiReady()) {
            if (inBuf.length >= INBUF_MAX) { inBuf.shift(); log("debug","INBUF_DROP_OVERFLOW",{size: inBuf.length}); }
            inBuf.push(payload);
            log("debug","INBUF_QUEUED",{size: inBuf.length});
          } else {
            try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload })); }
            catch (e) { log("error","OPENAI_APPEND_FAIL",{err:String(e?.message||e)}); }
          }
          break;
        }

        case "mark":
          log("debug","TWILIO_MARK_ACK",{name: data.mark?.name});
          break;

        case "stop":
          log("info","TWILIO_STOP");
          try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch {}
          try { openAiWs.close(); } catch {}
          break;

        default:
          log("debug","TWILIO_EVENT_OTHER",{event: data.event});
      }
    });

    connection.on("close", async () => {
      try { openAiWs.close(); } catch {}
      log("info","WS_CLOSED",{streamSid, callSid});
      try { const allData = await summarizer(qaPairs, callSid); log("info","SUMMARY",{allData}); }
      catch (e) { log("warn","SUMMARY_FAIL",{err:String(e?.message||e)}); }
    });

    setTimeout(() => {
      if (!sessionReady || !streamReady) log("warn","NOT_READY_8S",{sessionReady,streamReady});
    }, 8000);
  });
}
