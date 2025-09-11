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
  if (/(login|password|verify|otp|lock|unlock|2fa|account)/.test(t))
    return "account";
  if (/(bug|error|crash|fail|broken|not working|issue)/.test(t))
    return "technical";
  if (/(buy|pricing|quote|plan|subscription|upgrade|downgrade)/.test(t))
    return "sales";
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
  if (!OPENAI_API_KEY) console.error("[OPENAI] OPENAI_API_KEY missing");
  const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
  console.log(`[OPENAI] connect: ${url}`);
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
      type: "realtime",
      model: "gpt-realtime",
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcmu" },
          turn_detection: { type: "server_vad" },
        },
        output: { format: { type: "audio/pcmu" }, voice: "alloy" },
      },
      instructions: SYSTEM_MESSAGE,
    },
  };
}

function b64(x) {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (Buffer.isBuffer(x)) return x.toString("base64");
  try {
    return Buffer.from(x).toString("base64");
  } catch {
    return "";
  }
}

await connectIndex().catch((e) => {
  console.error("[PINECONE] connect error", e);
  process.exit(1);
});

export function attachMediaStreamServer(server) {
  const wss = new WebSocketServer({ server, path: "/media-stream" });
  console.log("[WS] /media-stream listening");

  wss.on("connection", (connection) => {
    console.log("[WS] connection opened");
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
        console.log("[OPENAI] session.update sent");

        // Kick off the mandatory greeting immediately (don't wait for user speech)
        setTimeout(() => {
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
            console.log("[OPENAI] response.create (greeting) sent");
          } catch (e) {
            console.error("[OPENAI] response.create greeting error", e);
          }
        }, 150);
      } catch (e) {
        console.error("[OPENAI] session.update error", e);
      }
    };

    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0) {
        try {
          openAiWs.send(JSON.stringify({ type: "response.cancel" }));
          console.log("[OPENAI] response.cancel");
        } catch (e) {
          console.error("[OPENAI] response.cancel error", e);
        }
        try {
          connection.send(JSON.stringify({ event: "clear", streamSid }));
          console.log("[TWILIO] clear sent");
        } catch (e) {
          console.error("[TWILIO] clear error", e);
        }
        markQueue = [];
        responseStartTimestampTwilio = null;
      }
    };

    const sendMark = () => {
      if (!streamSid) return;
      try {
        connection.send(
          JSON.stringify({
            event: "mark",
            streamSid,
            mark: { name: "responsePart" },
          })
        );
        markQueue.push("responsePart");
      } catch (e) {
        console.error("[TWILIO] mark error", e);
      }
    };

    openAiWs.on("open", () => {
      console.log("[OPENAI] WS open");
      setTimeout(initializeSession, 100);
    });
    openAiWs.on("close", (c, r) => {
      console.log("[OPENAI] WS closed", c, r?.toString());
    });
    openAiWs.on("error", (e) => {
      console.error("[OPENAI] WS error", e);
    });

    openAiWs.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (e) {
        console.error("[OPENAI] parse error", e, String(data).slice(0, 120));
        return;
      }

      if (msg.type === "session.created")
        console.log("[OPENAI] session.created");
      if (msg.type === "session.updated")
        console.log("[OPENAI] session.updated");
      if (msg.type === "error") console.error("[OPENAI] error", msg);

      if (msg.type === "response.created") {
        hasActiveResponse = true;
        console.log("[OPENAI] response.created", msg.response?.id || null);
      }

      if (msg.type === "conversation.item.created" && awaitingInjectedAck) {
        lastInjectedItemId = msg.item?.id || null;
        awaitingInjectedAck = false;
        console.log("[RAG] injected item ack", lastInjectedItemId);
      }

      if (
        (msg.type === "response.output_audio.delta" ||
          msg.type === "response.audio.delta") &&
        msg.delta
      ) {
        try {
          const payload = b64(msg.delta);
          if (payload) {
            connection.send(
              JSON.stringify({ event: "media", streamSid, media: { payload } })
            );
            if (!responseStartTimestampTwilio)
              responseStartTimestampTwilio = latestMediaTimestamp;
            sendMark();
          }
        } catch (e) {
          console.error("[TWILIO] media send error", e);
        }
      }

      if (
        msg.type === "response.output_text.delta" &&
        typeof msg.delta === "string"
      ) {
        textBuffer += msg.delta;
      }

      if (msg.type === "response.output_text.done" && !finalJsonString) {
        const maybe = safeParse(textBuffer);
        if (maybe && maybe.session && maybe.customer)
          finalJsonString = JSON.stringify(maybe);
        textBuffer = "";
      }

      if (
        msg.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const q =
          (typeof msg.transcript === "string" && msg.transcript.trim()) ||
          (
            msg.item?.content?.find?.((c) => typeof c?.transcript === "string")
              ?.transcript || ""
          ).trim();
        if (q) {
          pendingUserQ = q;
          console.log(`[ASR] user: "${q}"`);
        }
      }

      if (msg.type === "input_audio_buffer.speech_started") {
        console.log("[TURN] speech_started");
        handleSpeechStartedEvent();
      }

      if (
        msg.type === "input_audio_buffer.speech_stopped" &&
        !hasActiveResponse
      ) {
        const q = (pendingUserQ || "").trim();
        console.log("[TURN] speech_stopped; pendingUserQ=", q || "(none)");

        // ALWAYS perform semantic search when user speaks
        try {
          if (q) {
            console.log(`[RAG] Starting search for: "${q}"`);
            const minScore = Number(process.env.RAG_MIN_SCORE || 0.6);
            const topK = Number(process.env.TOPK || 6);

            // Perform semantic search
            const searchResults = await semanticSearch(q, {
              topK: topK,
              minScore: minScore,
            });
            console.log(
              `[RAG] Search completed. Found ${searchResults.length} results`
            );

            if (searchResults.length > 0) {
              // Build knowledge base context
              const snippetsBlock = buildSnippetsBlock(q, searchResults);
              console.log(
                `[RAG] Built snippets block with ${searchResults.length} snippets`
              );

              // Inject knowledge base context
              awaitingInjectedAck = true;
              const contextMessage = {
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "text",
                      text: `### KNOWLEDGE BASE SNIPPETS
The following information is from our knowledge base. Use ONLY this information to answer the user's question.

${snippetsBlock}

### INSTRUCTIONS
- Answer based ONLY on the above snippets
- If the snippets don't contain the answer, say "That isn't in our knowledge base yet"
- Keep response short (1-2 sentences)
- Be helpful and professional

### USER QUESTION
"${q}"`,
                    },
                  ],
                },
              };

              openAiWs.send(JSON.stringify(contextMessage));
              console.log(
                `[RAG] Injected ${searchResults.length} knowledge base snippets`
              );
            } else {
              // No results found - inject guard
              awaitingInjectedAck = true;
              const guardMessage = {
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "text",
                      text: `### NO KNOWLEDGE BASE RESULTS
No relevant information was found in our knowledge base for the user's question: "${q}"

You must respond: "That isn't in our knowledge base yet. Let me help you in another way."

Then continue with the workflow:
- Ask a clarifying question to better understand their need, or
- Offer to create a support ticket, or  
- Provide our general support contact information

Keep the response to 1-2 sentences and stay professional.`,
                    },
                  ],
                },
              };

              openAiWs.send(JSON.stringify(guardMessage));
              console.log(
                "[RAG] No results found - injected no-knowledge guard"
              );
            }
          } else {
            // No question transcribed - let GPT respond normally
            console.log(
              "[RAG] No user question transcribed, allowing normal response"
            );
          }

          // Trigger response generation
          openAiWs.send(JSON.stringify({ type: "response.create" }));
          console.log("[OPENAI] response.create sent after RAG processing");
        } catch (error) {
          console.error("[RAG] Error during semantic search:", error);
          // Still trigger response even if search fails
          openAiWs.send(JSON.stringify({ type: "response.create" }));
        }
      }

      if (msg.type === "response.done") {
        hasActiveResponse = false;

        // Clean up injected context
        if (lastInjectedItemId) {
          try {
            openAiWs.send(
              JSON.stringify({
                type: "conversation.item.delete",
                item_id: lastInjectedItemId,
              })
            );
            console.log("[RAG] Deleted injected context item");
          } catch (e) {
            console.error("[RAG] Error deleting injected item:", e);
          }
          lastInjectedItemId = null;
        }

        // Process response outputs
        const outputs = msg.response?.output || [];
        for (const out of outputs) {
          if (out?.role === "assistant") {
            const part = Array.isArray(out.content)
              ? out.content.find(
                  (c) =>
                    typeof c?.transcript === "string" && c.transcript.trim()
                )
              : null;
            const a = (part?.transcript || "").trim();
            if (a) {
              if (pendingUserQ) {
                qaPairs.push({ q: pendingUserQ, a });
                console.log(`[QA] Q: "${pendingUserQ}" A: "${a}"`);
                pendingUserQ = null;
              } else {
                qaPairs.push({ q: null, a });
                console.log(`[ASSISTANT] ${a}`);
              }
            }
          }
        }
      }
    });

    const started = new Set();

    connection.on("message", async (message) => {
      let data;
      try {
        data = JSON.parse(message);
      } catch (e) {
        console.error("[WS] parse error", e, String(message).slice(0, 160));
        return;
      }
      switch (data.event) {
        case "connected":
          console.log("[TWILIO] connected");
          break;
        case "start":
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;
          console.log(
            "[TWILIO] start streamSid=",
            streamSid,
            "callSid=",
            callSid
          );
          if (!callSid || started.has(callSid)) return;
          started.add(callSid);
          const base = process.env.PUBLIC_BASE_URL;
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const client = twilio(accountSid, authToken);
          try {
            const rec = await client.calls(callSid).recordings.create({
              recordingStatusCallback: `${base}/recording-status`,
              recordingStatusCallbackEvent: [
                "in-progress",
                "completed",
                "absent",
              ],
              recordingChannels: "dual",
              recordingTrack: "both",
            });
            console.log("▶️ recording started:", rec.sid);
          } catch (e) {
            console.error("[TWILIO] start recording failed:", e?.message || e);
          }
          responseStartTimestampTwilio = null;
          latestMediaTimestamp = 0;
          break;
        case "media":
          latestMediaTimestamp =
            Number(data.media.timestamp) || latestMediaTimestamp;
          if (openAiWs.readyState === WebSocket.OPEN) {
            try {
              openAiWs.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: data.media.payload,
                })
              );
            } catch (e) {
              console.error("[OPENAI] append error", e);
            }
          } else {
            console.warn("[OPENAI] WebSocket not open, cannot send audio");
          }
          break;
        case "mark":
          if (markQueue.length) markQueue.shift();
          break;
        case "stop":
          if (openAiWs.readyState === WebSocket.OPEN) {
            try {
              openAiWs.send(
                JSON.stringify({ type: "input_audio_buffer.commit" })
              );
            } catch (e) {
              console.error("[OPENAI] commit error", e);
            }
            try {
              openAiWs.close();
            } catch (e) {
              console.error("[OPENAI] close error", e);
            }
          }
          emitFinalOnce();
          break;
        default:
          console.log("[TWILIO] event", data.event);
          break;
      }
    });

    function emitFinalOnce() {
      if (printed) return;
      const raw = safeParse(finalJsonString) || safeParse(textBuffer) || {};
      const fallbackPairs = Array.isArray(raw?.transcript)
        ? toQAPairs(raw.transcript)
        : [];
      const pairs = qaPairs.length ? qaPairs : fallbackPairs;
      const name = raw?.customer?.name ?? null;
      const email = raw?.customer?.email?.normalized ?? null;
      const summary = raw?.issue?.user_description ?? null;
      const isIssueResolved = !!raw?.satisfaction?.is_satisfied;
      const issue = classifyIssue(
        [raw?.resolution?.escalation_reason, summary].filter(Boolean).join(" ")
      );
      console.log("[FINAL]", {
        name,
        email,
        issue,
        isIssueResolved,
        qaCount: pairs.length,
      });
      printed = true;
    }

    connection.on("close", async () => {
      console.log("[WS] connection closed");
      if (openAiWs.readyState === WebSocket.OPEN) {
        try {
          openAiWs.close();
        } catch (e) {
          console.error("[OPENAI] close error", e);
        }
      }
      try {
        const allData = await summarizer(qaPairs, callSid);
        console.log("[SUMMARY]", JSON.stringify({ allData }));
      } catch (e) {
        console.error("[SUMMARY] error", e);
      }
    });
  });
}
