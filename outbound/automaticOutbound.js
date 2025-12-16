// automaticOutbound.js
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/user.js";
import { makeSystemMessage } from "./prompt.js";
import Call from "../models/Call.js";
import processCallOutcome from "./summerize.js";

const {
  OPENAI_API_KEY,
  REALTIME_VOICE = "alloy",
  REALTIME_MODEL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
} = process.env;

const RT_MODEL = REALTIME_MODEL || "gpt-4o-realtime-preview";
const GOODBYE_WAIT_MS = 3000;
const EARLY_VAD_IGNORE_MS = 1200;
const MIN_MEDIA_CHUNKS_FOR_TURN = 4;

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function createOpenAIWs() {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
    RT_MODEL
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
        threshold: 0.85,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: false,
        interrupt_response: false,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions,
      modalities: ["text", "audio"],
      temperature: 0.6,
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "en",
        prompt: "English only. If non-English, translate to English meaning.",
      },
    },
  };
}

function isGoodbye(text = "") {
  const t = text.toLowerCase();
  return (
    t.includes("goodbye") ||
    /\bbye\b/.test(t) ||
    t.includes("talk to you soon") ||
    t.includes("see you") ||
    t.includes("thanks for your time") ||
    t.includes("have a nice day") ||
    t.includes("have a great day")
  );
}

function looksLikeInstructionLeak(s = "") {
  const t = String(s).trim().toLowerCase();
  if (!t) return true;
  if (t.includes("transcribe only english")) return true;
  if (t.includes("do not output non-english")) return true;
  if (t.includes("additional context/instructions")) return true;
  if (t.includes("###")) return true;
  if (t.includes("delimiters")) return true;
  if (t.startsWith("you will receive")) return true;
  return false;
}

function cleanUserTranscript(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  if (looksLikeInstructionLeak(s)) return null;
  return s;
}

function getDisplayName(user) {
  if (!user) return "there";
  return user.name || user.firstName || "there";
}

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on("connection", async (connection, req) => {
    let userId = null;
    let kind = null;
    let user = null;

    let streamSid = null;
    let callSid = null;

    let openaiReady = false;
    let twilioStarted = false;

    let sessionInitialized = false;
    let greetingSent = false;
    let hasActiveResponse = false;

    let commitTimer = null;

    let pendingUserQ = null;
    const qaPairs = [];

    let mediaQueue = [];
    let mediaChunksSinceLastTurn = 0;

    let hangupArmed = false;
    let hangupTimer = null;

    const openAiWs = createOpenAIWs();
    const wsConnectedAt = Date.now();

    function inferKind() {
      if (kind) return kind;
      if (user) {
        if (user.isSatisfactionCall === false) return "satisfaction";
        if (user.isUpSellCall === false) return "upsell";
      }
      return "upsell";
    }

    function cancelHangup() {
      hangupArmed = false;
      if (hangupTimer) clearTimeout(hangupTimer);
      hangupTimer = null;
    }

    function armHangup() {
      if (!callSid || !twilioClient) return;
      cancelHangup();
      hangupArmed = true;
      hangupTimer = setTimeout(async () => {
        if (!hangupArmed) return;
        try {
          await twilioClient.calls(callSid).update({ status: "completed" });
          console.log(`[TWILIO] hung up ${callSid} after goodbye wait`);
        } catch (e) {
          console.error("[TWILIO] hangup error", e?.message || e);
        }
      }, GOODBYE_WAIT_MS);
    }

    async function ensureUserLoaded() {
      if (user || !userId) return;
      try {
        user = await User.findOne({ where: { id: userId } });
      } catch (e) {
        console.error("[WS] user load error", e?.message || e);
      }
    }

    async function initializeSessionIfReady() {
      if (sessionInitialized) return;
      if (!openaiReady || !twilioStarted) return;
      await ensureUserLoaded();

      const pickedKind = inferKind();
      let baseInstr = await makeSystemMessage(userId, pickedKind);

      const instr =
        baseInstr +
        `

GLOBAL RULES:
- Speak ONLY English.
- Calm, friendly, slightly slower pace.
- End your final message with a clear goodbye (e.g., "Thanks for your time. Goodbye.").
`.trim();

      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate(instr)));
        sessionInitialized = true;

        if (!commitTimer) {
          commitTimer = setInterval(() => {
            if (openAiWs.readyState === WebSocket.OPEN && !hasActiveResponse) {
              try {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
              } catch {}
            }
          }, 300);
        }

        if (mediaQueue.length) {
          try {
            for (const payload of mediaQueue) {
              openAiWs.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: payload,
                })
              );
            }
            mediaQueue = [];
            openAiWs.send(
              JSON.stringify({ type: "input_audio_buffer.commit" })
            );
          } catch (e) {
            console.error("[OPENAI] flush queued media error", e?.message || e);
          }
        }

        maybeSendGreeting();
      } catch (e) {
        console.error("[OPENAI] session.update error", e?.message || e);
      }
    }

    function maybeSendGreeting() {
      if (greetingSent) return;
      if (!sessionInitialized) return;
      if (!streamSid) return;
      if (openAiWs.readyState !== WebSocket.OPEN) return;

      greetingSent = true;

      const displayName = getDisplayName(user);
      const k = String(inferKind()).toLowerCase();

      const greetingInstruction =
        k === "satisfaction"
          ? `You must speak first. English only. Calm tone.
Greet the customer by name "${displayName}".
Say it's a quick follow-up about their recent support call.
Ask: "Are you satisfied with the assistance you received?"
Then STOP and wait.`
          : `You must speak first. English only. Calm tone.
Greet the customer by name "${displayName}".
Say it's a quick call to share one simple way to help their business grow.
Ask: "Is now a good moment for a quick 30-second chat?"
Then STOP and wait.`;

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
        console.error(
          "[OPENAI] greeting response.create error",
          e?.message || e
        );
      }
    }

    try {
      const url = new URL(req?.url || "", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "upsell-stream" && parts[1]) userId = parts[1];
      kind = url.searchParams.get("kind") || null;
    } catch {}

    openAiWs.on("open", async () => {
      openaiReady = true;
      await initializeSessionIfReady();
    });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        if (msg.type === "input_audio_buffer.speech_started") {
          if (hangupArmed) cancelHangup();
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (!greetingSent) return;
          if (Date.now() - wsConnectedAt < EARLY_VAD_IGNORE_MS) return;
          if (hasActiveResponse) return;
          if (mediaChunksSinceLastTurn < MIN_MEDIA_CHUNKS_FOR_TURN) return;

          mediaChunksSinceLastTurn = 0;
          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch {}
        }

        if (msg.type === "response.created") {
          hasActiveResponse = true;
        }

        if (
          (msg.type === "response.audio.delta" ||
            msg.type === "response.output_audio.delta") &&
          msg.delta &&
          streamSid
        ) {
          const payload =
            typeof msg.delta === "string"
              ? msg.delta
              : Buffer.from(msg.delta).toString("base64");

          connection.send(
            JSON.stringify({ event: "media", streamSid, media: { payload } })
          );
        }

        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          const rawT =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (
              msg.item?.content?.find?.(
                (c) => typeof c?.transcript === "string"
              )?.transcript || ""
            ).trim();

          const t = cleanUserTranscript(rawT);
          if (t) {
            pendingUserQ = t;
            if (hangupArmed) cancelHangup();
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

            if (isGoodbye(a)) {
              armHangup();
            }
          }
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e?.message || e);
      }
    });

    connection.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);

        if (data.event === "start") {
          streamSid = data.start?.streamSid || streamSid || null;
          callSid = data.start?.callSid || callSid || null;

          twilioStarted = true;

          const cp = (data.start && data.start.customParameters) || {};
          if (!kind && typeof cp.kind === "string") kind = cp.kind;
          if (!userId && typeof cp.userId === "string") userId = cp.userId;

          await ensureUserLoaded();
          await initializeSessionIfReady();
          maybeSendGreeting();

          try {
            if (callSid && twilioClient) {
              await Call.findOrCreate({
                where: { callSid },
                defaults: { callSid },
              });

              const base = process.env.PUBLIC_BASE_URL || "https://example.com";
              await twilioClient.calls(callSid).recordings.create({
                recordingStatusCallback: `${base}/recording-status`,
                recordingStatusCallbackEvent: [
                  "in-progress",
                  "completed",
                  "absent",
                ],
                recordingChannels: "dual",
                recordingTrack: "both",
              });
            }
          } catch (e) {
            console.error("[TWILIO] recording error", e?.message || e);
          }

          return;
        }

        if (data.event === "media") {
          const payload = data.media?.payload || "";
          if (!payload) return;

          mediaChunksSinceLastTurn++;

          await initializeSessionIfReady();

          if (openAiWs.readyState === WebSocket.OPEN && sessionInitialized) {
            try {
              openAiWs.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: payload,
                })
              );
            } catch {}
          } else {
            mediaQueue.push(payload);
          }
          return;
        }

        if (data.event === "stop") {
          if (commitTimer) clearInterval(commitTimer);
          commitTimer = null;

          try {
            if (openAiWs.readyState === WebSocket.OPEN) {
              openAiWs.send(
                JSON.stringify({ type: "input_audio_buffer.commit" })
              );
              openAiWs.close();
            }
          } catch {}
          return;
        }
      } catch (e) {
        console.error("[WS] parse error", e?.message || e);
      }
    });

    connection.on("close", async () => {
      cancelHangup();

      if (commitTimer) clearInterval(commitTimer);
      commitTimer = null;

      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}

      try {
        const result = await processCallOutcome({
          qaPairs,
          userId,
          callSid,
          campaignType: String(kind || inferKind()),
        });
        console.log("[SUMMARY] outcome", result?.outcome);
      } catch (e) {
        console.error("[SUMMARY] summarize error", e?.message || e);
      }
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  return wss;
}
