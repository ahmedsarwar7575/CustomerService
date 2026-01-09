// automaticOutbound.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/user.js";
import Call from "../models/Call.js";
import { makeSystemMessage } from "./prompt.js";
import processCallOutcome from "./summerize.js";

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "cedar",
  REALTIME_MODEL = "gpt-realtime-2025-08-28",
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PUBLIC_BASE_URL,
} = process.env;

const USER_PAUSE_GRACE_MS = 350;

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
    REALTIME_MODEL
  )}`;

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY || "MISSING"}`,
      "OpenAI-Beta": "realtime=v1",
      Origin: "https://server.local",
    },
    perMessageDeflate: false,
  });

  ws.on("unexpected-response", async (_req, res) => {
    let body = "";
    try {
      body = await new Promise((resolve) => {
        let data = "";
        res.on("data", (c) => (data += c.toString("utf8")));
        res.on("end", () => resolve(data));
        res.on("error", () => resolve("(read error)"));
      });
    } catch {}
    console.error("[OPENAI] unexpected-response", res.statusCode, body);
  });

  ws.on("error", (e) =>
    console.error("[OPENAI] socket error:", e?.message || e)
  );
  return ws;
}

function buildSessionUpdate(instructions) {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 500,
        silence_duration_ms: 500,
        create_response: false,
        interrupt_response: false,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions,
      modalities: ["text", "audio"],
      temperature: 0.7,
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "en",
        prompt: "The caller is speaking English. Always transcribe to English.",
      },
    },
  };
}

function getDisplayName(user) {
  return (user && (user.name || user.firstName)) || "there";
}

function isGoodbye(text = "") {
  const t = String(text).toLowerCase();
  return t.includes("goodbye") || /\bbye\b/.test(t);
}

function shouldIgnoreTranscript(t = "") {
  const s = String(t).trim();
  if (!s) return true;
  if (/^transcribe\s+only\s+english/i.test(s)) return true;
  if (s.includes("You will receive additional context/instructions"))
    return true;
  if (/^the caller is speaking english\.?$/i.test(s)) return true;
  return false;
}

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on("connection", async (connection, req) => {
    let userId = null;
    let kind = null;
    let user = null;

    let streamSid = null;
    let callSid = null;

    let openAiReady = false;
    let twilioStarted = false;
    let callStarted = false;
    let userLoaded = false;

    let sessionInitialized = false;
    let sessionInitializing = false;
    let greetingSent = false;

    let hasActiveResponse = false;
    let pendingUserQ = null;
    const qaPairs = [];

    let hangupTimer = null;
    let callEnding = false;

    let scheduledResponseTimer = null;

    const openAiWs = createOpenAIWs();

    function clearScheduledResponse() {
      if (scheduledResponseTimer) {
        clearTimeout(scheduledResponseTimer);
        scheduledResponseTimer = null;
      }
    }

    function scheduleAgentResponse() {
      if (callEnding) return;
      clearScheduledResponse();
      scheduledResponseTimer = setTimeout(() => {
        scheduledResponseTimer = null;
        if (callEnding) return;
        if (!hasActiveResponse && openAiWs.readyState === WebSocket.OPEN) {
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch {}
        }
      }, USER_PAUSE_GRACE_MS);
    }

    function scheduleHangupFixed() {
      if (hangupTimer || !callSid || !twilioClient) return;
      callEnding = true;
      clearScheduledResponse();
      hangupTimer = setTimeout(async () => {
        try {
          await twilioClient.calls(callSid).update({ status: "completed" });
          console.log(
            `[TWILIO] Hung up outbound call ${callSid} after 5s goodbye.`
          );
        } catch (e) {
          console.error("[TWILIO] hangup error", e?.message || e);
        }
      }, 5000);
    }

    function maybeSendGreeting() {
      if (greetingSent) return;
      if (!sessionInitialized || !callStarted) return;
      if (!streamSid) return;
      if (openAiWs.readyState !== WebSocket.OPEN) return;

      greetingSent = true;

      const name = getDisplayName(user);
      const k = String(kind || "").toLowerCase();

      const greetingInstruction =
        k === "satisfaction"
          ? `Speak FIRST. English only. Calm tone. Greet "${name}". Then say: our agent spoke with you recently. Ask exactly: "Are you satisfied with the assistance you received?" Then STOP and wait.`
          : `Speak FIRST. English only. Calm tone. Greet "${name}". Say this is a quick call to share one simple way to help their business grow using their existing payments. Ask: "Is now a good moment to talk for less than a minute?" Then STOP and wait.`;

      try {
        openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio"],
              instructions: greetingInstruction,
            },
          })
        );
      } catch (e) {
        console.error("[OPENAI] greeting error", e?.message || e);
      }
    }

    async function initializeSession() {
      if (sessionInitialized || sessionInitializing) return;
      if (!openAiReady || !twilioStarted || !userLoaded) return;

      sessionInitializing = true;
      try {
        const pickedKind = String(kind || "upsell").toLowerCase();
        const base = await makeSystemMessage(userId, pickedKind);

        const extra = `
VOICE STYLE:
- Calm, soft, relaxed tone.
- Slightly slower than normal, not robotic.

RULES:
- Speak ONLY English.
- When you are ending the call, your FINAL word must be exactly: "Goodbye."
`;

        openAiWs.send(JSON.stringify(buildSessionUpdate(base + "\n" + extra)));
        sessionInitialized = true;
        sessionInitializing = false;
        maybeSendGreeting();
      } catch (e) {
        sessionInitializing = false;
        console.error("[OPENAI] session.init error", e?.message || e);
      }
    }

    try {
      const url = new URL(req?.url || "", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "upsell-stream" && parts[1]) userId = parts[1];
      kind = url.searchParams.get("kind") || null;
    } catch {}

    if (!userId || !kind) {
      try {
        const raw = req?.url || "";
        const qs = raw.includes("?") ? raw.split("?")[1] : "";
        const sp = new URLSearchParams(qs);
        userId = userId || sp.get("userId") || null;
        kind = kind || sp.get("kind") || null;
      } catch {}
    }

    if (userId) {
      try {
        user = await User.findOne({ where: { id: userId } });
        userLoaded = true;
      } catch (e) {
        userLoaded = true;
        console.error("[WS] user load error", e?.message || e);
      }
    } else {
      userLoaded = true;
    }

    openAiWs.on("open", async () => {
      openAiReady = true;
      await initializeSession();
    });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        if (msg.type === "response.created") {
          hasActiveResponse = true;
          clearScheduledResponse();
        }

        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          const t =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (
              msg.item?.content?.find?.(
                (c) => typeof c?.transcript === "string"
              )?.transcript || ""
            ).trim();

          if (!shouldIgnoreTranscript(t)) pendingUserQ = t;
        }

        if (msg.type === "input_audio_buffer.speech_started") {
          clearScheduledResponse();
        }

        if (msg.type === "input_audio_buffer.committed") {
          if (!hasActiveResponse && openAiWs.readyState === WebSocket.OPEN) {
            scheduleAgentResponse();
          }
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (!hasActiveResponse && openAiWs.readyState === WebSocket.OPEN) {
            scheduleAgentResponse();
          }
        }

        if (
          (msg.type === "response.audio.delta" ||
            msg.type === "response.output_audio.delta") &&
          msg.delta
        ) {
          const payload =
            typeof msg.delta === "string"
              ? msg.delta
              : Buffer.from(msg.delta).toString("base64");

          if (streamSid) {
            connection.send(
              JSON.stringify({ event: "media", streamSid, media: { payload } })
            );
          }
        }

        if (msg.type === "response.done") {
          hasActiveResponse = false;

          const outputs = msg.response?.output || [];
          for (const out of outputs) {
            if (out?.role !== "assistant") continue;

            const part = Array.isArray(out.content)
              ? out.content.find(
                  (c) =>
                    typeof c?.transcript === "string" && c.transcript.trim()
                )
              : null;

            const a = (part?.transcript || "").trim();
            if (!a) continue;

            if (pendingUserQ) {
              qaPairs.push({ q: pendingUserQ, a });
              pendingUserQ = null;
            } else {
              qaPairs.push({ q: null, a });
            }

            if (isGoodbye(a)) scheduleHangupFixed();
          }
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e?.message || e);
      }
    });

    openAiWs.on("close", (code, reason) => {
      console.log(
        "[OPENAI] socket closed",
        code,
        reason ? reason.toString() : ""
      );
    });

    connection.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);

        switch (data.event) {
          case "start": {
            streamSid = data.start?.streamSid || streamSid || null;
            callSid = data.start?.callSid || callSid || null;

            twilioStarted = true;
            callStarted = true;

            const cp = data.start?.customParameters || {};
            if (!kind && typeof cp.kind === "string") kind = cp.kind;
            if (!userId && typeof cp.userId === "string") userId = cp.userId;

            if (userId && (!user || String(user.id) !== String(userId))) {
              try {
                user = await User.findOne({ where: { id: userId } });
              } catch {}
              userLoaded = true;
            }

            await Call.findOrCreate({
              where: { callSid },
              defaults: { callSid },
            });

            if (PUBLIC_BASE_URL && twilioClient && callSid) {
              try {
                await twilioClient.calls(callSid).recordings.create({
                  recordingStatusCallback: `${PUBLIC_BASE_URL}/recording-status`,
                  recordingStatusCallbackEvent: [
                    "in-progress",
                    "completed",
                    "absent",
                  ],
                  recordingChannels: "dual",
                  recordingTrack: "both",
                });
              } catch {}
            }

            await initializeSession();
            maybeSendGreeting();
            break;
          }

          case "media": {
            const payload = data.media?.payload || "";
            if (openAiWs.readyState === WebSocket.OPEN) {
              try {
                openAiWs.send(
                  JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: payload,
                  })
                );
              } catch {}
            }
            break;
          }

          case "stop": {
            try {
              if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            } catch {}
            break;
          }

          default:
            break;
        }
      } catch (e) {
        console.error("[WS] parse error", e?.message || e);
      }
    });

    connection.on("close", async () => {
      clearScheduledResponse();

      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}

      try {
        const result = await processCallOutcome({
          qaPairs,
          userId,
          callSid,
          campaignType: String(kind || "upsell").toLowerCase(),
        });
        console.log("[SUMMARY] outcome", result?.outcome);
      } catch (e) {
        console.error("[SUMMARY] error", e?.message || e);
      }
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  return wss;
}
