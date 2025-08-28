// src/ws/mediaStream.js
import WebSocket, { WebSocketServer } from "ws";

const { OPENAI_API_KEY, REALTIME_VOICE = "alloy" } = process.env;

const MODEL = "gpt-4o-realtime-preview-2024-10-01";

const SYSTEM_MESSAGE = `
You are a professional, friendly customer service AI for a website. You speak clearly and briefly, and you strictly follow the flow below.
IMPORTANT: Speak normally during the interview, but for the FINAL SUMMARY you must return a single text message that is PURE JSON and DO NOT produce audio for that final message.

# Conversation Flow
1) Greet the user warmly.
2) Collect contact details in order:
   • Name (first + last if available).
   • Email — ask them to SPELL it letter-by-letter (e.g., “john dot doe at mail dot com”). Confirm back what you heard.
   • Phone — ask them to read the digits one-by-one (and country code if any). Confirm back what you heard.
   Validation:
     - Email must contain one “@”, a domain, and a TLD with letters only. If invalid/unclear, politely re-ask once.
     - Phone should be 7–15 digits (ignore spaces/dashes). If unclear, politely re-ask once.
3) Ask the user to describe their problem in their own words. Ask up to 2 brief clarifying questions if needed (but don’t overwhelm).
4) Attempt a solution: provide clear, step-by-step guidance tailored to the problem. If the issue requires escalation (billing, account lockout, outage), acknowledge and propose next steps (ticket/escalation), plus any safety steps.
5) Ask if they are satisfied with the solution. If not, attempt ONE short refinement or offer escalation. Then ask again if they are satisfied now.
6) After you have the satisfaction answer (yes/no), END THE CONVERSATION with a text-only message containing a JSON object that matches EXACTLY the schema below. DO NOT say anything else outside the JSON. DO NOT include trailing commentary. DO NOT include code fences.
7) DO NOT include jokes during data capture. Keep it concise and professional.

# Data Handling Rules
- CONFIRM each captured field (email & phone) by reading it back in human format (e.g., “I have john.doe@example.com — is that correct?”).
- Normalize email to lowercase. Strip non-digits for phone but keep a separate pretty format with spacing.
- Timezone is Asia/Karachi; include absolute timestamps in ISO 8601 for the final JSON.

# FINAL SUMMARY — JSON Schema (produce keys exactly)
{
  "session": {
    "started_at": "<ISO8601>",
    "ended_at": "<ISO8601>"
  },
  "customer": {
    "name": "<string|null>",
    "email": {
      "raw_spelling": "<what they spelled>",
      "normalized": "<lowercased email or null>",
      "valid": <true|false>
    },
    "phone": {
      "raw_spelling": "<what they read>",
      "normalized_e164_like": "<digits with optional leading + or null>",
      "pretty": "<spaced grouping or null>",
      "valid": <true|false>
    }
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
  "satisfaction": {
    "is_satisfied": <true|false>,
    "rating_1_to_5": <number|null>,
    "verbatim_feedback": "<string|null>"
  },
  "transcript": [
    {"role":"user","text":"<...>"},
    {"role":"assistant","text":"<...>"}
  ]
}

# Examples & Formatting
- During the call: natural voice.
- FINAL SUMMARY: A single message that is valid JSON ONLY, matching the schema above, no extra text, no code fences, no audio.

# Edge Cases
- If the user refuses to give email/phone, continue with what they accept; put null and valid=false as needed.
- If the user goes off-topic, gently steer back to the flow.
- If safety/security issues arise, prioritize user safety and escalate when necessary.
`;

const LOG_EVENT_TYPES = [
  "error",
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
];

const SHOW_TIMING_MATH = false;

export function attachMediaStreamServer(server) {
  const wss = new WebSocketServer({ server, path: "/media-stream" });
  console.log("WebSocket server ready at /media-stream");

  wss.on("connection", (connection) => {
    console.log("Twilio Media Stream connected");

    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${MODEL}`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    const initializeSession = () => {
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: REALTIME_VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.3,
        },
      };
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH) {
          console.log(
            `Truncate elapsed: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );
        }

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid,
          })
        );

        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    const sendMark = () => {
      if (!streamSid) return;
      const markEvent = {
        event: "mark",
        streamSid,
        mark: { name: "responsePart" },
      };
      connection.send(JSON.stringify(markEvent));
      markQueue.push("responsePart");
    };

    // --- OpenAI WS events ---
    openAiWs.on("open", () => {
      console.log("Connected to OpenAI Realtime");
      setTimeout(initializeSession, 100);
    });

    openAiWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
    
        // Optional: log selected event types
        if (LOG_EVENT_TYPES.includes(msg.type)) {
          console.log('[OpenAI]', msg.type);
        }
    
        // Streamed AUDIO from OpenAI -> forward to Twilio <Stream>
        if (msg.type === 'response.audio.delta' && msg.delta) {
          const audioDelta = {
            event: 'media',
            streamSid,
            media: { payload: msg.delta },
          };
          connection.send(JSON.stringify(audioDelta));
    
          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
            if (SHOW_TIMING_MATH) {
              console.log(`[timing] start ts set: ${responseStartTimestampTwilio}ms`);
            }
          }
    
          if (msg.item_id) {
            lastAssistantItem = msg.item_id;
          }
    
          sendMark();
        }
    
        // Optional: capture streamed TEXT (useful if model outputs a final JSON summary)
        if (msg.type === 'response.output_text.delta' && msg.delta) {
          console.log('[OpenAI text]', msg.delta);
          // stream partial text if you want:
          // console.log('[OpenAI text]', msg.delta);
        }
    
        // Final response arrived — dump full text, try to parse JSON
        if (msg.type === 'response.done') {
          const fullText = msg.response?.output_text?.join('') ?? '';
          if (fullText) {
            console.log('=== FINAL AI TEXT OUTPUT ===');
            console.log(fullText);
    
            try {
              const parsed = JSON.parse(fullText);
              console.log('=== PARSED JSON SUMMARY ===');
              console.dir(parsed, { depth: null });
            } catch {
              // Not JSON — that's fine if the AI didn't send JSON this turn
            }
          }
        }
    
        // User started speaking (from Twilio) — truncate any ongoing TTS
        if (msg.type === 'input_audio_buffer.speech_started') {
          handleSpeechStartedEvent();
        }
      } catch (e) {
        console.error('OpenAI message parse error:', e, 'raw:', data);
      }
    });
    

    openAiWs.on("close", () => console.log("OpenAI WS closed"));
    openAiWs.on("error", (err) => console.error("OpenAI WS error:", err));

    // --- Twilio <Stream> WS events ---
    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case "start":
            streamSid = data.start.streamSid;
            console.log("Stream started:", streamSid);
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case "media":
            latestMediaTimestamp = data.media.timestamp;
            if (SHOW_TIMING_MATH) {
              console.log(`media ts: ${latestMediaTimestamp}ms`);
            }
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              };
              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;

          case "mark":
            if (markQueue.length) markQueue.shift();
            break;

          case "stop":
            // Call ended by Twilio
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            break;

          default:
            // other events: dtmf, dtmf_received, etc.
            break;
        }
      } catch (e) {
        console.error("Twilio message parse error:", e, "raw:", message);
      }
    });

    connection.on("close", () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log("Twilio Media Stream disconnected");
    });
  });
}



