import WebSocket, { WebSocketServer } from "ws";
import { summarizer } from "./summery.js";
import twilio from "twilio";
import dotenv from "dotenv";
import {
  connectIndex,
  semanticSearch,
  buildSnippetsBlock,
} from "../utils/pinecone.js";

dotenv.config();
const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `
ROLE & VOICE
You are **John Smith**, a friendly, professional **GETPIE** customer support agent.
Speak English only. Replies must be short (1–2 sentences), natural, friendly, calm, confident. Ask one clear question at a time. If user speaks another language, reply once: “I’ll continue in English.”

WORKFLOW
1) Listen → Acknowledge briefly → Clarify with one focused question at a time.
2) Use KB snippets if provided. If no relevant snippet, say so briefly and continue workflow.
3) Propose a concise solution (1–3 short sentences). Offer options if useful (self-serve, escalate, schedule).
4) Always collect and confirm **full name** and **email** before ending. Never ask for phone. If user offers phone, politely decline: “Email is enough for now.”
5) Classify ticket as support / sales / billing. Confirm with user if unclear.
6) End by asking: “Are you satisfied with this solution, or would you like more support?” If more support: offer next step (ticket, callback, escalate).

GUARDRAILS
• Never collect phone numbers or payment info. Payments handled only via secure links.  
• Always prefer factual answers from snippets. If answer not found, say: “Not in our knowledge base, but here’s what I can do…”  
• Keep conversation on topic. If off-topic twice: “Let’s wrap this support request, then I’ll help route other questions.”  
• Warm, human tone. Short turns except first greeting.  

FIRST TURN (MANDATORY)
“Hello, this is John Smith with GETPIE Customer Support. Thanks for reaching out today. I’m here to listen to your issue and get you a clear solution or next step.”  
Then ask: “How can I help you today?”
`;

function safeParse(s) {
  try {
    return JSON.parse((s || "").trim());
  } catch {
    return null;
  }
}

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
  const out = [];
  let q = null;
  for (const m of tr) {
    if (m.role === "user") {
      if (q) out.push({ q, a: "" });
      q = m.text || "";
    } else if (m.role === "assistant") {
      if (q !== null) {
        out.push({ q, a: m.text || "" });
        q = null;
      }
    }
  }
  if (q) out.push({ q, a: "" });
  return out;
}

function createOpenAIWebSocket() {
  if (!OPENAI_API_KEY) console.error("OPENAI_API_KEY missing");
  const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });
}

function buildSessionUpdate() {
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
      instructions: SYSTEM_MESSAGE,
      modalities: ["text", "audio"],
      temperature: 0.7,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  };
}

await connectIndex();

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
    let lastRagItemId = null;
    let ragItemPending = false;

    const openAiWs = createOpenAIWebSocket();
    openAiWs.on("open", () => setTimeout(() => openAiWs.send(JSON.stringify(buildSessionUpdate())), 100));

    openAiWs.on("message", async (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "conversation.item.created" && ragItemPending) {
          lastRagItemId = msg.item?.id || null;
          ragItemPending = false;
        }

        if (msg.type === "response.created") hasActiveResponse = true;
        if (msg.type === "error") console.error("openai.error", msg);

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const q =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (msg.item?.content?.find?.((c) => typeof c?.transcript === "string")?.transcript || "").trim();
          if (q) pendingUserQ = q;
        }

        if (msg.type === "input_audio_buffer.speech_stopped" && !hasActiveResponse) {
          try {
            const q = (pendingUserQ || "").trim();
            if (q) {
              const minScore = Number(process.env.RAG_MIN_SCORE || 0.6);
              const topK = Number(process.env.TOPK || 6);
              const items = await semanticSearch(q, { topK, minScore });
              if (items.length) {
                const block = buildSnippetsBlock(q, items);
                ragItemPending = true;
                openAiWs.send(
                  JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "message",
                      role: "system",
                      content: [{ type: "input_text", text: `### SNIPPETS\n${block}\n\n### USER QUESTION\n${q}` }],
                    },
                  })
                );
              }
            }
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch (e) {
            console.error("RAG retrieval failed:", e);
          }
        }

        if (msg.type === "response.done") {
          hasActiveResponse = false;
          if (lastRagItemId) {
            openAiWs.send(JSON.stringify({ type: "conversation.item.delete", item_id: lastRagItemId }));
            lastRagItemId = null;
          }
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
              }
            }
          }
        }
      } catch (e) {
        console.error("openai.message parse error", e, String(data).slice(0, 200));
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
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      const allData = await summarizer(qaPairs, callSid);
      console.log(JSON.stringify({ allData }));
      emitFinalOnce();
    });
  });
}
