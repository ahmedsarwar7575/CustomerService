import WebSocket, { WebSocketServer } from "ws";

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `
ROLE & VOICE
You are **John Smith**, a friendly, professional **GETPIE** customer service agent for a marketing company.
Speak **English only**. Keep replies short and natural (1–2 sentences), friendly, calm, and confident—never robotic or salesy. Ask one clear question at a time. If the user speaks another language, reply once: “I’ll continue in English.”

ABOUT GETPIE (DUMMY DETAILS)
• We are a full-service marketing company helping SMBs with ads, SEO, content, and analytics.  
• Support hours: **Mon–Fri 9:00–18:00 ET**, **Sat 10:00–14:00 ET**, closed Sunday.  
• Phone: **(800) 555-0199**  •  Email: **support@getpie.example**  •  Website: **getpie.example**  
• SLAs: first response **within 1 business hour** during support hours; most tickets resolved **within 2–3 business days**.  
• Billing handled via secure links only; **we never take payment over the phone**.  

FIRST TURN (MANDATORY OPENING; RESUME IF INTERRUPTED)
Say this in full unless the user is already speaking; if interrupted, pause, answer briefly, and **continue from the next unfinished line**:
“Hello, this is John Smith with GETPIE Customer Support.  
Thanks for reaching out to us today. I’m here to listen to your issue and get you a clear solution or next step.”

After the opening (or after resuming to complete it), ask: **“How can I help you today?”**

CONVERSATION WORKFLOW
1) LISTEN
   - Let the user explain. Acknowledge in 1 sentence, then clarify with **one** focused question at a time until the issue is clear.

2) PROPOSE A SOLUTION
   - Give a concise, actionable plan (1–3 short sentences). If needed, offer options (self-serve steps, assign to specialist, schedule callback, or escalate).

3) IMPORTANT REMINDERS
    Always collect **contact details** for follow-up.
   - Natural tone, keep it brief:
     • “We never take payments over the phone—only secure links from billing@getpie.example.”  
     • Expected timelines (SLA above).  
     • Availability (support hours above).  

4) COLLECT & VERIFY CONTACT DETAILS (ONE AT A TIME) (important)
   - Ask for **full name** → reflect/confirm.  
   - Ask for **email** → reflect/confirm and spell back if unclear.  
   - Ask for **phone** → reflect/confirm with digits.  
   - Classify **Ticket Type** from context or by asking if unclear: **support**, **sales**, or **billing**. Confirm the chosen type.

5) SATISFACTION CHECK & NEXT STEPS
   - Ask: “Are you satisfied with this solution, or would you like more support?”  
   - If more support: propose the next concrete step (e.g., create ticket, schedule callback, or escalate).

NATURAL Q&A DURING FLOW
- User can ask questions anytime. Answer briefly (1–2 sentences), then **return to the current step** and continue.
- If off-topic twice: “Let’s wrap this support request, then I’ll help route other questions.”

BEHAVIORAL GUARDRAILS
- English only; brief and human.  
- Don’t provide legal/financial/tax advice.  
- Always track **current_step** and **last_completed_line**; after side questions, resume from the next line.  
- If user seems confused, give a one-sentence recap and proceed.

MICRO-REPLY EXAMPLES (TONE CHECK)
- “Thanks for the details—I can help with that.”  
- “Got it—ads performance dropped after the update. Is that correct?”  
- “Here’s the plan: we’ll audit the campaign, revert risky changes, and send you a report within 2 business days.”  
- “Please share your best email so we can send updates.”  
- “Great—last question: are you satisfied with this solution, or do you need more support?”

OUTPUT STYLE
- Keep turns short (1–2 sentences) except the **mandatory opening**, which must be delivered fully (with resume on interruption).  
- Ask and confirm each detail right after the answer.  
- Stay on topic; be warm and human.
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
      temperature: 0.2,
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
      },
    },
  };
}

export function attachMediaStreamServer(server) {
  const wss = new WebSocketServer({ server, path: "/media-stream" });
  wss.on("connection", (connection) => {
    let streamSid = null,
      callSid = null,
      latestMediaTimestamp = 0,
      lastAssistantItem = null,
      markQueue = [],
      responseStartTimestampTwilio = null,
      textBuffer = "",
      finalJsonString = null,
      printed = false;

    // NEW: capture Q↔A in real time from specific events
    let qaPairs = [];
    let pendingUserQ = null;

    const openAiWs = createOpenAIWebSocket();
    const initializeSession = () => {
      openAiWs.send(JSON.stringify(buildSessionUpdate()));
    };
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsed = latestMediaTimestamp - responseStartTimestampTwilio;
        if (lastAssistantItem) {
          openAiWs.send(
            JSON.stringify({
              type: "conversation.item.truncate",
              item_id: lastAssistantItem,
              content_index: 0,
              audio_end_ms: Math.max(0, elapsed),
            })
          );
        }
        connection.send(JSON.stringify({ event: "clear", streamSid }));
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };
    const sendMark = () => {
      if (!streamSid) return;
      connection.send(
        JSON.stringify({
          event: "mark",
          streamSid,
          mark: { name: "responsePart" },
        })
      );
      markQueue.push("responsePart");
    };

    openAiWs.on("open", () => setTimeout(initializeSession, 100));
    openAiWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data);

        // === audio stream out ===
        if (msg.type === "response.audio.delta" && msg.delta) {
          connection.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: msg.delta },
            })
          );
          if (!responseStartTimestampTwilio)
            responseStartTimestampTwilio = latestMediaTimestamp;
          if (msg.item_id) lastAssistantItem = msg.item_id;
          sendMark();
        }

        // === text stream out (final JSON collection you already had) ===
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
            ) {
              finalJsonString = JSON.stringify(maybe);
            }
          }
        }
        if (msg.type === "response.output_text.done" && !finalJsonString) {
          const maybe = safeParse(textBuffer);
          if (maybe && maybe.session && maybe.customer)
            finalJsonString = JSON.stringify(maybe);
          textBuffer = "";
        }

        // === NEW: catch the user's completed transcription (Q) ===
        // Structure mirrors your snippet: { type: "conversation.item.input_audio_transcription.completed", transcript: "..." }
        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          const q =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            // fallback if the event nests it
            (
              msg.item?.content?.find?.(
                (c) => typeof c?.transcript === "string"
              )?.transcript || ""
            ).trim();
          if (q) {
            pendingUserQ = q;
          }
        }

        // === NEW: pair with assistant answer when response is done (A) ===
        // Structure mirrors your snippet: { type: "response.done", response: { output: [...] } }
        if (msg.type === "response.done") {
          const outputs = msg.response?.output || [];
          for (const out of outputs) {
            if (out?.role === "assistant") {
              const part =
                (Array.isArray(out.content) &&
                  out.content.find(
                    (c) =>
                      typeof c?.transcript === "string" && c.transcript.trim()
                  )) ||
                null;
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
      } catch {
        // swallow malformed frames
      }
    });

    function emitFinalOnce() {
      if (printed) return;

      // Prefer the live-built qaPairs; otherwise fall back to transcript→pairs
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

      // Your existing summary log, now with qaPairs included
      console.log(
        JSON.stringify({
          name,
          email,
          summary,
          isIssueResolved,
          issue,
          qaPairs: pairs,
        })
      );

      // If you *also* want a minimal log of just Q/A array, uncomment:
      // console.log(JSON.stringify({ qaPairs: pairs }));

      printed = true;
    }

    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        switch (data.event) {
          case "start":
            streamSid = data.start.streamSid;
            callSid = data.start.callSid || null;
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;
          case "media":
            latestMediaTimestamp =
              Number(data.media.timestamp) || latestMediaTimestamp;
            if (openAiWs.readyState === WebSocket.OPEN)
              openAiWs.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: data.media.payload,
                })
              );
            break;
          case "mark":
            if (markQueue.length) markQueue.shift();
            break;
          case "stop":
            // finish audio to OpenAI
            if (openAiWs.readyState === WebSocket.OPEN) {
              try {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
              } catch {}
              try {
                openAiWs.close();
              } catch {}
            }
            // "Return" Q/A array on stop/close: we print it once here.
            emitFinalOnce();
            break;
          default:
            break;
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    connection.on("close", () => {
      if (openAiWs.readyState === WebSocket.OPEN) {
        try {
          console.log(
            JSON.stringify({
              qaPairs,
            })
          );
          openAiWs.close();
        } catch {}
      }
      // Print the Q/A array (and summary fields) once on socket close as well.
      emitFinalOnce();
    });
  });
}
