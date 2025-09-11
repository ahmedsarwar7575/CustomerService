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
CRITICAL: You MUST ONLY answer based on the knowledge base snippets provided in the SNIPPETS section. 
- If relevant snippets are provided, use ONLY that information to answer
- If no snippets are provided or snippets don't contain the answer, say: "That isn't in our knowledge base yet."
- NEVER make up information or answer from general knowledge
- Always reference the knowledge base when answering

WORKFLOW
1) Listen → acknowledge briefly → ask one focused question until clear.
2) Propose a concise plan (1–3 short sentences). Offer options if useful.
3) Always collect and confirm full name and email before ending. Never ask for phone. If offered, politely decline.
4) Classify ticket: support / sales / billing (ask once if unclear). Confirm.
5) End: "Are you satisfied with this solution, or would you like more support?" If more, propose next step.

FIRST TURN
"Hello, this is John Smith with GETPIE Customer Support. Thanks for reaching out today. I'm here to listen to your issue and get you a clear solution or next step."
Then ask: "How can I help you today?"
`;

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
  if (!OPENAI_API_KEY) console.error("ERROR: OPENAI_API_KEY missing");
  const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
  return new WebSocket(url, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
  });
}

function buildSessionUpdate() {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 800,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.8,
      input_audio_transcription: { model: "whisper-1" },
    },
  };
}

function b64(x) {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (Buffer.isBuffer(x)) return x.toString("base64");
  try { return Buffer.from(x).toString("base64"); } catch { return ""; }
}

await connectIndex().catch(e => { console.error("PINECONE CONNECTION ERROR:", e); process.exit(1); });

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
    let openAiConnected = false;

    const openAiWs = createOpenAIWebSocket();

    const initializeSession = () => {
      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate()));
        setTimeout(() => {
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch (e) {
            console.error("GREETING ERROR:", e);
          }
        }, 300);
      } catch (e) {
        console.error("SESSION INIT ERROR:", e);
      }
    };

    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0) {
        try { openAiWs.send(JSON.stringify({ type: "response.cancel" })); }
        catch (e) { console.error("CANCEL ERROR:", e); }
        try { connection.send(JSON.stringify({ event: "clear", streamSid })); }
        catch (e) { console.error("CLEAR ERROR:", e); }
        markQueue = [];
        responseStartTimestampTwilio = null;
      }
    };

    const sendMark = () => {
      if (!streamSid) return;
      try {
        connection.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "responsePart" } }));
        markQueue.push("responsePart");
      } catch (e) { console.error("MARK ERROR:", e); }
    };

    openAiWs.on("open", () => { setTimeout(initializeSession, 100); });
    openAiWs.on("close", (c, r) => { console.log("OpenAI closed:", c); });
    openAiWs.on("error", (e) => { console.error("OPENAI WS ERROR:", e); });

    openAiWs.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) {
        console.error("OPENAI PARSE ERROR:", e);
        return;
      }

      if (msg.type === "session.updated") {
        openAiConnected = true;
      }
      
      if (msg.type === "error") {
        console.error("OPENAI API ERROR:", msg);
      }

      if (msg.type === "response.created") {
        hasActiveResponse = true;
      }

      if (msg.type === "conversation.item.created" && awaitingInjectedAck) {
        lastInjectedItemId = msg.item?.id || null;
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
        } catch (e) { console.error("AUDIO SEND ERROR:", e); }
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
        if (q) { 
          pendingUserQ = q; 
          console.log("USER QUESTION:", q);
        }
      }

      if (msg.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }

      if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
        const q = (pendingUserQ || "").trim();
        
        try {
          if (q) {
            console.log("SEARCHING PINECONE FOR:", q);
            const minScore = Number(process.env.RAG_MIN_SCORE || 0.3);  // Lower for testing
            const topK = Number(process.env.TOPK || 10);  // Higher for testing
            
            const searchResults = await semanticSearch(q, { topK: topK, minScore: minScore });
            
            console.log("PINECONE RESULTS:", searchResults.length > 0 ? 
              searchResults.map(r => ({ id: r.id, score: r.score?.toFixed(3), text: r.text?.slice(0, 200) })) : 
              "NO MATCHES FOUND"
            );
            
            if (searchResults.length > 0) {
              const snippetsBlock = buildSnippetsBlock(q, searchResults);
              
              awaitingInjectedAck = true;
              const contextMessage = {
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "system",
                  content: [{
                    type: "text",
                    text: `### KNOWLEDGE BASE SNIPPETS
${snippetsBlock}

### USER QUESTION: "${q}"

Answer using ONLY the above information. If not covered, say "That isn't in our knowledge base yet."`
                  }]
                }
              };
              
              openAiWs.send(JSON.stringify(contextMessage));
              console.log("INJECTED", searchResults.length, "SNIPPETS");
            } else {
              awaitingInjectedAck = true;
              const guardMessage = {
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "system",
                  content: [{
                    type: "text",
                    text: `No knowledge base results for: "${q}". Respond: "That isn't in our knowledge base yet. Let me help you another way." Then ask how else you can help.`
                  }]
                }
              };
              
              openAiWs.send(JSON.stringify(guardMessage));
              console.log("NO PINECONE MATCHES - GUARD INJECTED");
            }
          }
          
          openAiWs.send(JSON.stringify({ type: "response.create" }));
          
        } catch (error) {
          console.error("PINECONE SEARCH ERROR:", error.message);
          openAiWs.send(JSON.stringify({ type: "response.create" }));
        }
      }

      if (msg.type === "response.done") {
        hasActiveResponse = false;
        
        if (lastInjectedItemId) {
          try { 
            openAiWs.send(JSON.stringify({ 
              type: "conversation.item.delete", 
              item_id: lastInjectedItemId 
            })); 
          } catch (e) { 
            console.error("DELETE ERROR:", e); 
          }
          lastInjectedItemId = null;
        }
        
        const outputs = msg.response?.output || [];
        for (const out of outputs) {
          if (out?.role === "assistant") {
            const part = Array.isArray(out.content) ? out.content.find((c) => typeof c?.transcript === "string" && c.transcript.trim()) : null;
            const a = (part?.transcript || "").trim();
            if (a) {
              console.log("GPT ANSWER:", a);
              if (pendingUserQ) { 
                qaPairs.push({ q: pendingUserQ, a }); 
                pendingUserQ = null; 
              } else { 
                qaPairs.push({ q: null, a }); 
              }
            }
          }
        }
      }
    });

    const started = new Set();

    connection.on("message", async (message) => {
      let data;
      try { data = JSON.parse(message); } catch (e) { console.error("WS PARSE ERROR:", e); return; }
      switch (data.event) {
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
          } catch (e) { console.error("RECORDING ERROR:", e?.message); }
          responseStartTimestampTwilio = null;
          latestMediaTimestamp = 0;
          break;
        case "media":
          latestMediaTimestamp = Number(data.media.timestamp) || latestMediaTimestamp;
          if (openAiWs.readyState === WebSocket.OPEN && openAiConnected) {
            try { 
              openAiWs.send(JSON.stringify({ 
                type: "input_audio_buffer.append", 
                audio: data.media.payload 
              })); 
            }
            catch (e) { console.error("AUDIO APPEND ERROR:", e); }
          }
          break;
        case "mark":
          if (markQueue.length) markQueue.shift();
          break;
        case "stop":
          if (openAiWs.readyState === WebSocket.OPEN) {
            try { openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch (e) { console.error("COMMIT ERROR:", e); }
            try { openAiWs.close(); } catch (e) { console.error("CLOSE ERROR:", e); }
          }
          emitFinalOnce();
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
      printed = true;
    }

    connection.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN) {
        try { openAiWs.close(); } catch (e) { console.error("WS CLOSE ERROR:", e); }
      }
      try {
        const allData = await summarizer(qaPairs, callSid);
        console.log("CALL SUMMARY:", JSON.stringify({ allData }));
      } catch (e) {
        console.error("SUMMARY ERROR:", e);
      }
    });
  });
}