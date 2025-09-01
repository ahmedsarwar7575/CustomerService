import WebSocket, { WebSocketServer } from "ws";

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;
const MODEL = "gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_MESSAGE = `
You are a professional, friendly customer service AI for a website. Speak clearly and briefly.
Conversation flow:
1) Greet the user, then ask them to describe the problem. If the caller says they are a GetPie agent, request a short description of the issue they’re handling.
2) After they describe the problem, verify whether it has been resolved or not.
3) Collect contact details:
   • Name — capture and confirm pronunciation is correct.
   • Email — ask them to spell it letter-by-letter. Confirm back what you heard and validate format (one "@", domain, TLD letters only).
4) If needed, ask up to 2 brief clarifying questions, then provide tailored steps. If escalation is required (billing, account lockout, outage), acknowledge and propose next steps.
5) Ask if they are satisfied. If not, try ONE short refinement or offer escalation, then ask again.
6) END the conversation by sending a single TEXT-ONLY message that is valid JSON using the EXACT schema below. Do NOT send audio for this final message. Do NOT include any extra text or code fences.
Data handling:
- Normalize email to lowercase.
- Strip non-digits for phone if collected; keep a pretty version too.
- Timezone is Asia/Karachi; use absolute ISO 8601 for timestamps.
FINAL SUMMARY — JSON Schema (produce keys exactly)
{
  "session": { "started_at": "<ISO8601>", "ended_at": "<ISO8601>" },
  "customer": {
    "name": "<string|null>",
    "email": { "raw_spelling": "<what they spelled>", "normalized": "<lowercased email or null>", "valid": <true|false> },
    "phone": { "raw_spelling": "<what they read>", "normalized_e164_like": "<digits with optional + or null>", "pretty": "<spaced grouping or null>", "valid": <true|false> }
  },
  "issue": {
    "user_description": "<string>",
    "clarifying_questions": ["<q1>", "<q2>"],
    "answers_to_clarifying": ["<a1>", "<a2>"]
  },
  "resolution": {
    "proposed_steps": ["<step1>", "<step2>", "..."],
    "did_escalate": <true|false>,
    "escalation_reason": "<string|null>",
    "next_actions_owner": "<\"agent\"|\"user\"|\"support\"|null>",
    "eta_if_any": "<string|null>"
  },
  "satisfaction": { "is_satisfied": <true|false>, "rating_1_to_5": <number|null>, "verbatim_feedback": "<string|null>"},
  "transcript": [
    {"role":"user","text":"<...>"},
    {"role":"assistant","text":"<...>"}
  ]
}
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
        if (msg.type === "input_audio_buffer.speech_started")
          handleSpeechStartedEvent();
      } catch {}
    });

    function emitFinalOnce() {
      if (printed) return;
      const raw = safeParse(finalJsonString) || safeParse(textBuffer) || {};
      const name = raw?.customer?.name ?? null;
      const email = raw?.customer?.email?.normalized ?? null;
      const summary = raw?.issue?.user_description ?? null;
      const isIssueResolved = !!raw?.satisfaction?.is_satisfied;
      const issue = classifyIssue(
        [raw?.resolution?.escalation_reason, summary].filter(Boolean).join(" ")
      );
      const fullConvo = Array.isArray(raw?.transcript)
        ? toQAPairs(raw.transcript)
        : [];
      console.log(
        JSON.stringify({
          name,
          email,
          summary,
          isIssueResolved,
          issue,
          fullConvo,
        })
      );
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
            emitFinalOnce();
            break;
          default:
            break;
        }
      } catch {}
    });

    connection.on("close", () => {
      if (openAiWs.readyState === WebSocket.OPEN) {
        try {
          openAiWs.close();
        } catch {}
      }
      emitFinalOnce();
    });
  });
}
