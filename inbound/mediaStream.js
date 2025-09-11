import WebSocket, { WebSocketServer } from "ws";
import { summarizer } from "./summery.js";
import twilio from "twilio";
import dotenv from "dotenv";
import { connectIndex, semanticSearch, buildSnippetsBlock } from "../utils/pinecone.js";

dotenv.config();

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `
ROLE
You are John Smith, a friendly GETPIE customer support agent.

STYLE
English only. Replies are short (1–2 sentences). One clear question at a time. Warm, calm, confident.

STRICT RAG
Only answer with facts from SNIPPETS. If no relevant snippet exists for this turn, say: “That isn’t in our knowledge base yet.” Then continue the workflow (clarify or next step). Do not invent facts.

WORKFLOW
1) Listen → acknowledge briefly → ask one focused question until clear.
2) Propose a concise plan (1–3 short sentences). Offer options if useful.
3) Always collect and confirm full name and email before ending. Never ask for phone. If offered, politely decline.
4) Classify ticket: support / sales / billing (ask once if unclear). Confirm.
5) End: “Are you satisfied with this solution, or would you like more support?” If more, propose next step.

FIRST TURN
“Hello, this is John Smith with GETPIE Customer Support. Thanks for reaching out today. I’m here to listen to your issue and get you a clear solution or next step.”
Then ask: “How can I help you today?”
`;

const jlog = (event, payload = {}) => {
  try { console.log(JSON.stringify({ ts: Date.now(), event, payload })); } catch {}
};
const jerr = (where, e) => {
  console.error(JSON.stringify({ ts: Date.now(), event: "error", where, message: e?.message || String(e) }));
};

function safeParse(s) { try { return JSON.parse((s || "").trim()); } catch { return null; } }

function classifyIssue(t = "") {
  t = t.toLowerCase();
  if (/(bill|payment|invoice|refund|charge|card)/.test(t)) return "billing";
  if (/(login|password|verify|otp|lock|unlock|2fa|account)/.test(t)) return "account";
  if (/(bug|error|crash|fail|broken|not working|issue)/.test(t)) return "technical";
  if (/(buy|pricing|quote|plan|subscription|upgrade|downgrade)/.test(t)) return "sales";
  if (/(support|help|question|how to)/.test(t)) return "support";
  return "other";
}

function toQAPairs(tr = []) {
  const out = []; let q = null;
  for (const m of tr) {
    if (m.role === "user") { if (q) out.push({ q, a: "" }); q = m.text || ""; }
    else if (m.role === "assistant") { if (q !== null) { out.push({ q, a: m.text || "" }); q = null; } }
  }
  if (q) out.push({ q, a: "" });
  return out;
}

function createOpenAIWebSocket() {
  try {
    const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
    return new WebSocket(url, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
    });
  } catch (e) { jerr("openai.ws.create", e); throw e; }
}

function buildSessionUpdate() {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.7,
        prefix_padding_ms: 300,
        silence_duration_ms: 800,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.2,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  };
}

function b64(x) {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (Buffer.isBuffer(x)) return x.toString("base64");
  try { return Buffer.from(x).toString("base64"); } catch { return ""; }
}

await connectIndex().catch(e => { jerr("pinecone.connectIndex", e); process.exit(1); });

export function attachMediaStreamServer(server) {
  const wss = new WebSocketServer({ server, path: "/media-stream" });

  wss.on("connection", (connection) => {
    let streamSid = null;
    let callSid = null;
    let latestMediaTimestamp = 0;
    let markQueue = [];
    let responseStartTimestampTwilio = null;
    let textBuffer = "";
    let finalJsonString = null;
    let printed = false;
    let qaPairs = [];
    let pendingUserQ = null;
    let hasActiveResponse = false;
    let lastInjectedItemId = null;
    let awaitingInjectedAck = false;

    const openAiWs = createOpenAIWebSocket();

    const initializeSession = () => {
      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate()));
        setTimeout(() => {
          try { openAiWs.send(JSON.stringify({ type: "response.create" })); }
          catch (e) { jerr("openai.response.create.greeting", e); }
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
      try {
        connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "responsePart" } }));
        markQueue.push("responsePart");
      } catch (e) { jerr("twilio.mark", e); }
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

      if (msg.type === "response.output_text.delta" && typeof msg.delta === "string") {
        textBuffer += msg.delta;
      }

      if (msg.type === "response.output_text.done" && !finalJsonString) {
        const maybe = safeParse(textBuffer);
        if (maybe && maybe.session && maybe.customer) finalJsonString = JSON.stringify(maybe);
        textBuffer = "";
      }

      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const q =
          (typeof msg.transcript === "string" && msg.transcript.trim()) ||
          (msg.item?.content?.find?.((c) => typeof c?.transcript === "string")?.transcript || "").trim();
        if (q) pendingUserQ = q;
      }

      if (msg.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }

      if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
        try {
          const q = (pendingUserQ || "").trim();
          let injected = false;

          if (q) {
            jlog("question", { text: q });
            try {
              const minScore = Number(process.env.RAG_MIN_SCORE || 0.6);
              const topK = Number(process.env.TOPK || 6);
              const results = await semanticSearch(q, { topK, minScore });

              jlog("retrieval", {
                query: q,
                count: results.length,
                items: results.map(r => ({
                  id: r.id,
                  score: Number(r.score?.toFixed ? r.score.toFixed(3) : r.score),
                  preview: r.text.slice(0, 500)
                }))
              });

              if (results.length) {
                const block = buildSnippetsBlock(q, results);
                awaitingInjectedAck = true; injected = true;
                openAiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "system",
                    content: [{ type: "input_text", text: `### SNIPPETS\n${block}\n\n### USER QUESTION\n${q}` }],
                    metadata: { rag_injected: true }
                  }
                }));
              } else {
                awaitingInjectedAck = true; injected = true;
                openAiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "system",
                    content: [{ type: "input_text", text:
`### NO_SNIPPETS_GUARD
No relevant knowledge base snippets were found for this turn.
You must respond: "That isn’t in our knowledge base yet." Then continue the workflow:
• Ask one concise clarifying question or
• Offer the next step (create ticket, escalate, or share our support email).
Never invent facts. Keep replies 1–2 sentences.` }],
                    metadata: { rag_injected: true }
                  }
                }));
              }
            } catch (e) { jerr("rag.retrieval", e); }
          }

          openAiWs.send(JSON.stringify({ type: "response.create" }));
        } catch (e) { jerr("openai.response.create", e); }
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
            const part = Array.isArray(out.content) ? out.content.find((c) => typeof c?.transcript === "string" && c.transcript.trim()) : null;
            const a = (part?.transcript || "").trim();
            if (a) {
              jlog("answer", { text: a });
            }
          }
        }
      }
    });

    const started = new Set();

    connection.on("message", async (message) => {
      let data;
      try { data = JSON.parse(message); } catch (e) { jerr("ws.parse", e); return; }
      switch (data.event) {
        case "connected":
          break;
        case "start":
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;
          if (!callSid || started.has(callSid)) return;
          started.add(callSid);
          const base = process.env.PUBLIC_BASE_URL;
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const client = twilio(accountSid, authToken);
          try {
            await client.calls(callSid).recordings.create({
              recordingStatusCallback: `${base}/recording-status`,
              recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
              recordingChannels: "dual",
              recordingTrack: "both",
            });
          } catch (e) { jerr("twilio.recording.start", e); }
          responseStartTimestampTwilio = null;
          latestMediaTimestamp = 0;
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
          emitFinalOnce();
          break;
        default:
          break;
      }
    });

    function emitFinalOnce() {
      if (printed) return;
      const raw = safeParse(finalJsonString) || safeParse(textBuffer) || {};
      const fallbackPairs = Array.isArray(raw?.transcript) ? toQAPairs(raw.transcript) : [];
      const pairs = qaPairs.length ? qaPairs : fallbackPairs;
      const name = raw?.customer?.name ?? null;
      const email = raw?.customer?.email?.normalized ?? null;
      const summary = raw?.issue?.user_description ?? null;
      const isIssueResolved = !!raw?.satisfaction?.is_satisfied;
      const issue = classifyIssue([raw?.resolution?.escalation_reason, summary].filter(Boolean).join(" "));
      jlog("final", { name, email, issue, isIssueResolved, qaCount: pairs.length });
      printed = true;
    }

    connection.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN) {
        try { openAiWs.close(); } catch (e) { jerr("openai.ws.close.onClientClose", e); }
      }
      try {
        const allData = await summarizer(qaPairs, callSid);
        jlog("summary", { ok: true, meta: !!allData });
      } catch (e) { jerr("summary.generate", e); }
    });
  });
}
