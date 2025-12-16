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
        threshold: 0.75,
        prefix_padding_ms: 250,
        silence_duration_ms: 650,
        create_response: false,
        interrupt_response: false,
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions,
      modalities: ["text", "audio"],
      temperature: 0.55,
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "en",
        prompt:
          "Transcribe spoken audio to English. If the caller speaks another language, translate to English meaning. If silence/noise, output nothing.",
      },
    },
  };
}

function getDisplayName(user) {
  return user?.name || user?.firstName || "there";
}

function looksLikeJunkTranscript(s = "") {
  const t = String(s).trim().toLowerCase();
  if (!t) return true;
  if (t === "english only" || t === "english only.") return true;
  if (t.includes("transcribe only english")) return true;
  if (t.includes("do not output non-english")) return true;
  if (t.includes("additional context/instructions")) return true;
  if (t.includes("delimiters")) return true;
  if (t.includes("###")) return true;
  if (t.startsWith("you will receive")) return true;
  return false;
}

function cleanUserTranscript(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  if (looksLikeJunkTranscript(s)) return null;
  return s;
}

function isFinalGoodbye(text = "") {
  const s = String(text || "").trim();
  if (!s) return false;
  const last = s
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]+$/g, "")
    .split(" ")
    .pop();
  const w = String(last || "").toLowerCase();
  return w === "goodbye" || w === "bye";
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
    let gotFirstMedia = false;

    let sessionSent = false;
    let sessionUpdated = false;

    let greetingSent = false;
    let hasActiveResponse = false;

    let commitTimer = null;

    let pendingUserQ = null;
    const qaPairs = [];

    let mediaQueue = [];

    let hangupArmed = false;
    let hangupTimer = null;

    const openAiWs = createOpenAIWs();

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

    async function hangupNow() {
      if (!callSid || !twilioClient) return;
      try {
        await twilioClient.calls(callSid).update({ status: "completed" });
        console.log(`[TWILIO] hung up ${callSid}`);
      } catch (e) {
        console.error("[TWILIO] hangup error", e?.message || e);
      }
    }

    function armHangupWaitWindow() {
      cancelHangup();
      hangupArmed = true;
      hangupTimer = setTimeout(async () => {
        if (!hangupArmed) return;
        await hangupNow();
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

    function maybeSendGreeting() {
      if (greetingSent) return;
      if (!sessionUpdated) return;
      if (!twilioStarted || !streamSid) return;
      if (!gotFirstMedia) return;
      if (openAiWs.readyState !== WebSocket.OPEN) return;

      greetingSent = true;

      const displayName = getDisplayName(user);
      const k = String(inferKind()).toLowerCase();

      const greetingInstruction =
        k === "satisfaction"
          ? `You must speak first. English only. Calm tone.
Say: "Hi ${displayName}, this is a quick follow-up from our customer success team."
Then ask: "Are you satisfied with the assistance you received?"
After the question, STOP and wait.
Important: When you are ending the call, make the LAST word exactly: "Goodbye."`
          : `You must speak first. English only. Calm tone.
Say: "Hi ${displayName}, this is a quick call from our customer success team."
Then ask: "Is now a good moment for a quick 30-second chat?"
After the question, STOP and wait.
Important: When you are ending the call, make the LAST word exactly: "Goodbye."`;

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

    async function maybeInitSession() {
      if (sessionSent) return;
      if (!openaiReady || !twilioStarted) return;

      await ensureUserLoaded();
      const pickedKind = inferKind();

      let baseInstr = await makeSystemMessage(userId, pickedKind);

      const instr =
        baseInstr +
        `

GLOBAL RULES:
- Speak ONLY English.
- Calm, friendly tone. Short sentences.
- Do NOT end the call unless you are done.
- When you end, the LAST word must be exactly: "Goodbye."
`.trim();

      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate(instr)));
        sessionSent = true;

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

        if (mediaQueue.length && openAiWs.readyState === WebSocket.OPEN) {
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
          } catch {}
        }
      } catch (e) {
        console.error("[OPENAI] session.update error", e?.message || e);
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
      await maybeInitSession();
    });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        if (msg.type === "session.updated") {
          sessionUpdated = true;
          maybeSendGreeting();
        }

        if (msg.type === "input_audio_buffer.speech_started") {
          if (hangupArmed) cancelHangup();
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (!greetingSent) return;
          if (hasActiveResponse) return;
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

            if (isFinalGoodbye(a)) {
              armHangupWaitWindow();
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
          await maybeInitSession();

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

          maybeSendGreeting();
          return;
        }

        if (data.event === "media") {
          const payload = data.media?.payload || "";
          if (!payload) return;

          gotFirstMedia = true;
          maybeSendGreeting();

          if (hangupArmed) {
            // user might be speaking; OpenAI VAD will confirm, but we also keep this conservative
          }

          if (openAiWs.readyState === WebSocket.OPEN && sessionSent) {
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
