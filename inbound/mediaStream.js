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
You are **John Smith**, a friendly, professional **GETPIE** customer support agent for a marketing company.
Speak **English only**. Keep replies short and natural (1–2 sentences), friendly, calm, and confident—never robotic or salesy. Ask **one** clear question at a time.
If the user speaks another language, reply once: “I’ll continue in English.”

ABOUT GETPIE (DUMMY DETAILS)
• We are a full-service marketing company helping SMBs with ads, SEO, content, and analytics.
• Support hours: **Mon–Fri 9:00–18:00 ET**, **Sat 10:00–14:00 ET**, closed Sunday.
• Email: **support@getpie.example** • Website: **getpie.example**
• SLAs: first response **within 1 business hour** during support hours; most tickets resolved **within 2–3 business days**.
• Billing handled via secure links only; **we never take payment over the phone**.

FIRST TURN (MANDATORY OPENING; RESUME IF INTERRUPTED)
Say this in full unless the user is already speaking. If interrupted, pause, answer briefly, then **continue from the next unfinished line**:
“Hello, this is John Smith with GETPIE Customer Support.
Thanks for reaching out today. I’m here to listen to your issue and get you a clear solution or next step.”
After the opening, ask: **“How can I help you today?”**

RAG INSTRUCTIONS (IF SNIPPETS ARE PROVIDED)
If you receive a **SNIPPETS** block:
• Prefer facts from the snippets. If not found, say so briefly and continue the workflow.
• If you cite, do it naturally (e.g., “from snippet 2”), but keep answers brief.

CONVERSATION WORKFLOW
1) LISTEN
   • Let the user explain. Acknowledge in 1 sentence, then clarify with **one** focused question at a time until the issue is clear.

2) PROPOSE A SOLUTION
   • Give a concise, actionable plan (1–3 short sentences). If useful, offer options (self-serve steps, assign to specialist, schedule callback, or escalate).

3) REMINDERS (BRIEF)
   • “We never take payments over the phone—only secure links from billing@getpie.example.”
   • Set expectations (SLA + support hours) when relevant.

4) CONTACT DETAILS (MANDATORY; ONE AT A TIME)
   • You **must** collect and confirm **full name** and **email** before closing the conversation.
   • **Never ask for phone**. If the user offers a phone number, politely decline: “Email is enough for now.”
   • Steps:
     – Ask for **full name** → reflect/confirm.
     – Ask for **email** → reflect/confirm and spell back if unclear.
   • If the user refuses to share email, proceed but note: “email not provided”.

5) CLASSIFY TICKET TYPE
   • Determine **support**, **sales**, or **billing** from context. If unclear, ask one brief question.
   • Confirm the chosen type.

6) SATISFACTION CHECK & NEXT STEPS
   • Ask: “Are you satisfied with this solution, or would you like more support?”
   • If more support: propose the next concrete step (create ticket, schedule callback, or escalate).

NATURAL Q&A DURING FLOW
• The user may ask questions anytime. Answer briefly (1–2 sentences), then **return to the current step** and continue.
• If off-topic twice: “Let’s wrap this support request, then I’ll help route other questions.”

BEHAVIORAL GUARDRAILS
• English only. Be brief and human.
• Do not provide legal/financial/tax advice.
• **Never collect phone numbers.** Do not ask for payment info. Remind that payments are via secure links only.
• Track **current_step** and **last_completed_line**; after side questions, resume properly.
• If the user seems confused, give a one-sentence recap and proceed.

MICRO-REPLY EXAMPLES (TONE CHECK)
• “Thanks for the details—I can help with that.”
• “Got it—ads performance dropped after the update. Is that correct?”
• “Here’s the plan: we’ll audit the campaign and send a report within 2 business days.”
• “What’s your full name so I can note it?” / “Thanks, and what’s the best email for updates?”
• “Great—last question: are you satisfied with this solution, or do you need more support?”

OUTPUT STYLE
• Keep turns short (1–2 sentences) except the **mandatory opening**.
• Ask and confirm each detail right after the answer.
• Stay on topic; be warm and human.
• Before ending, ensure **name and email are collected**. If not, ask for them. If refused, note it clearly and proceed.
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
  try {
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

      const initializeSession = () => {
        try {
          openAiWs.send(JSON.stringify(buildSessionUpdate()));
        } catch (e) {
          console.error("session.update error", e);
        }
      };

      const handleSpeechStartedEvent = () => {
        if (markQueue.length > 0) {
          try {
            openAiWs.send(JSON.stringify({ type: "response.cancel" }));
          } catch (e) {
            console.error("response.cancel error", e);
          }
          try {
            connection.send(JSON.stringify({ event: "clear", streamSid }));
          } catch (e) {
            console.error("twilio.clear error", e);
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
          console.error("twilio.mark error", e);
        }
      };

      openAiWs.on("open", () => {
        setTimeout(initializeSession, 100);
      });

      openAiWs.on("message", async (data) => {
        try {
          const msg = JSON.parse(data);

          if (msg.type === "conversation.item.created" && ragItemPending) {
            lastRagItemId = msg.item?.id || null;
            ragItemPending = false;
          }

          if (msg.type === "response.created") {
            hasActiveResponse = true;
          }
          if (msg.type === "error") console.error("openai.error", msg);

          if (
            (msg.type === "response.audio.delta" ||
              msg.type === "response.output_audio.delta") &&
            msg.delta
          ) {
            try {
              const payload =
                typeof msg.delta === "string"
                  ? msg.delta
                  : Buffer.from(msg.delta).toString("base64");
              connection.send(
                JSON.stringify({
                  event: "media",
                  streamSid,
                  media: { payload },
                })
              );
              if (!responseStartTimestampTwilio)
                responseStartTimestampTwilio = latestMediaTimestamp;
              sendMark();
            } catch (e) {
              console.error("twilio.media send error", e);
            }
          }

          if (
            msg.type === "response.output_text.delta" &&
            typeof msg.delta === "string"
          ) {
            textBuffer += msg.delta;
            if (
              !finalJsonString &&
              textBuffer.includes('"session"') &&
              textBuffer.includes('"customer"') &&
              textBuffer.trim().startsWith("{")
            ) {
              const maybe = safeParse(textBuffer);
              if (
                maybe &&
                maybe.session &&
                maybe.customer &&
                maybe.resolution &&
                maybe.satisfaction
              )
                finalJsonString = JSON.stringify(maybe);
            }
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
                msg.item?.content?.find?.(
                  (c) => typeof c?.transcript === "string"
                )?.transcript || ""
              ).trim();
            if (q) pendingUserQ = q;
          }

          if (
            msg.type === "input_audio_buffer.speech_stopped" &&
            !hasActiveResponse
          ) {
            try {
              const q = (pendingUserQ || "").trim();
              if (q) {
                try {
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
                          content: [
                            {
                              type: "input_text",
                              text: [
                                "Use these KB snippets briefly. If not relevant, say so and continue the workflow.",
                                "",
                                "### SNIPPETS",
                                block,
                                "",
                                `### USER QUESTION\n${q}`,
                              ].join("\n"),
                            },
                          ],
                        },
                      })
                    );
                  }
                } catch (e) {
                  console.error("RAG retrieval failed:", e);
                }
              }
              openAiWs.send(JSON.stringify({ type: "response.create" }));
            } catch (e) {
              console.error("response.create error", e);
            }
          }

          if (msg.type === "response.done") {
            hasActiveResponse = false;
            if (lastRagItemId) {
              try {
                openAiWs.send(
                  JSON.stringify({
                    type: "conversation.item.delete",
                    item_id: lastRagItemId,
                  })
                );
              } catch {}
              lastRagItemId = null;
            }
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
                    pendingUserQ = null;
                  } else {
                    qaPairs.push({ q: null, a });
                  }
                }
              }
            }
          }

          if (msg.type === "input_audio_buffer.speech_started")
            handleSpeechStartedEvent();
        } catch (e) {
          console.error(
            "openai.message parse error",
            e,
            String(data).slice(0, 200)
          );
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
          [raw?.resolution?.escalation_reason, summary]
            .filter(Boolean)
            .join(" ")
        );
        printed = true;
      }

      const started = new Set();
      connection.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
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
                console.error("start recording failed:", e.message);
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
                  console.error("openai.append error", e);
                }
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
                  console.error("openai.commit error", e);
                }
                try {
                  openAiWs.close();
                } catch (e) {
                  console.error("openai.close error", e);
                }
              }
              emitFinalOnce();
              break;
            default:
              break;
          }
        } catch (e) {
          console.error(
            "twilio.message parse error",
            e,
            String(message).slice(0, 200)
          );
        }
      });

      connection.on("close", async () => {
        if (openAiWs.readyState === WebSocket.OPEN) {
          try {
            openAiWs.close();
          } catch (e) {
            console.error("openai.close error", e);
          }
        }
        const allData = await summarizer(qaPairs, callSid);
        console.log(JSON.stringify({ allData }));
        console.log("Call SID", callSid);
        console.log("Call streamSid", streamSid);
        emitFinalOnce();
      });
    });
  } catch (error) {
    console.error("attachMediaStreamServer error", error);
  }
}
