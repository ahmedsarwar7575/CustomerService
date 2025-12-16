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
  REALTIME_VOICE = "echo",
  REALTIME_MODEL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PUBLIC_BASE_URL,
} = process.env;

const MODEL = REALTIME_MODEL || "gpt-4o-realtime-preview-2024-12-17";
const GOODBYE_WAIT_MS = 3000;
const REPROMPT_MS = 8000;
const MIN_SPEECH_MS = 350;

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function createOpenAIWebSocket() {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
    MODEL
  )}`;
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
    perMessageDeflate: false,
  });
}

function buildSessionUpdate(instructions) {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.9,
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
        prompt:
          "Transcribe ONLY spoken audio to English. If non-English is spoken, translate meaning to English. If unclear/noise/silence, output nothing.",
      },
    },
  };
}

function isJunkTranscript(s = "") {
  const t = String(s).trim().toLowerCase();
  if (!t) return true;
  if (t === "english only" || t === "english only.") return true;
  if (t.includes("transcribe only")) return true;
  if (t.includes("do not output")) return true;
  if (t.includes("additional context/instructions")) return true;
  if (t.includes("###") || t.startsWith("you will receive")) return true;
  return false;
}

function endsWithGoodbye(a = "") {
  const t = String(a).trim().replace(/\s+/g, " ");
  return t.endsWith("Goodbye.") || t.endsWith("Goodbye");
}

function getDisplayName(user) {
  return user?.name || user?.firstName || "there";
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
    let userLookupDone = false;

    let sessionInitialized = false;
    let callStarted = false;
    let greetingSent = false;

    let hasActiveResponse = false;

    let pendingUserQ = null;

    let hangupArmed = false;
    let hangupTimer = null;

    let repromptTimer = null;

    let lastSpeechStartAt = 0;

    const qaPairs = [];
    const openAiWs = createOpenAIWebSocket();

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

    function cancelReprompt() {
      if (repromptTimer) clearTimeout(repromptTimer);
      repromptTimer = null;
    }

    async function hangupNow() {
      if (!callSid || !twilioClient) return;
      try {
        await twilioClient.calls(callSid).update({ status: "completed" });
      } catch (e) {
        console.error("[TWILIO] hangup error", e?.message || e);
      }
    }

    function armHangupWindow() {
      cancelHangup();
      cancelReprompt();
      hangupArmed = true;
      hangupTimer = setTimeout(async () => {
        if (!hangupArmed) return;
        await hangupNow();
      }, GOODBYE_WAIT_MS);
    }

    function armReprompt() {
      cancelReprompt();
      repromptTimer = setTimeout(() => {
        if (!openAiWs || openAiWs.readyState !== WebSocket.OPEN) return;
        if (hasActiveResponse) return;
        if (hangupArmed) return;

        const k = String(inferKind()).toLowerCase();
        const nudge =
          k === "satisfaction"
            ? "English only. Please answer yes or no: are you satisfied with the assistance you received?"
            : "English only. Just a quick yes or no: are you interested in this solution for your business?";

        try {
          openAiWs.send(
            JSON.stringify({
              type: "response.create",
              response: { instructions: nudge },
            })
          );
        } catch {}
      }, REPROMPT_MS);
    }

    async function loadUser() {
      try {
        if (!userId) return;
        user = await User.findOne({ where: { id: userId } });
      } catch (e) {
        console.error("[WS] user load error", e?.message || e);
      } finally {
        userLookupDone = true;
      }
    }

    async function initializeSession() {
      const pickedKind = inferKind();
      let base = "";
      try {
        base = await makeSystemMessage(userId, pickedKind);
      } catch {
        base = "";
      }

      const rules = `
STRICT RULES:
- Speak ONLY English. Never speak any other language.
- Never say the phrase "English only" to the customer.
- Calm, soft tone. Short sentences.
- When you end the call, your LAST word must be exactly: "Goodbye."
- After you say "Goodbye.", stop speaking and wait.
`;

      try {
        openAiWs.send(
          JSON.stringify(buildSessionUpdate(base + "\n\n" + rules))
        );
        sessionInitialized = true;
        setTimeout(() => maybeSendGreeting(), 120);
      } catch (e) {
        console.error("[OPENAI] session.update error", e?.message || e);
      }
    }

    function maybeInitializeSession() {
      if (sessionInitialized) return;
      if (!openAiReady || !twilioStarted || !userLookupDone) return;
      initializeSession();
    }

    function maybeSendGreeting() {
      if (
        greetingSent ||
        !sessionInitialized ||
        !callStarted ||
        !streamSid ||
        openAiWs.readyState !== WebSocket.OPEN
      )
        return;

      greetingSent = true;

      const name = getDisplayName(user);
      const k = String(inferKind()).toLowerCase();

      const greeting =
        k === "satisfaction"
          ? `You must speak first. English only. Calm tone.
Say: "Hi ${name}, this is a quick follow-up from our customer success team."
Then ask: "Our agent spoke with you recently. Are you satisfied with the assistance you received?"
Stop and wait.`
          : `You must speak first. English only. Calm tone.
Say: "Hi ${name}, this is a quick call from our customer success team."
Then ask: "Would you be interested in this kind of solution for your business?"
Stop and wait.`;

      try {
        openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: { instructions: greeting },
          })
        );
        armReprompt();
      } catch (e) {
        console.error("[OPENAI] greeting error", e?.message || e);
      }
    }

    try {
      const url = new URL(req?.url || "", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "upsell-stream" && parts[1]) userId = parts[1];
      kind = url.searchParams.get("kind") || null;
    } catch {}

    openAiWs.on("open", async () => {
      openAiReady = true;
      await loadUser();
      maybeInitializeSession();
    });

    openAiWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === "response.created") hasActiveResponse = true;

        if (msg.type === "input_audio_buffer.speech_started") {
          lastSpeechStartAt = Date.now();
          if (hangupArmed) cancelHangup();
          cancelReprompt();
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

          if (!isJunkTranscript(q)) pendingUserQ = q;
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (hangupArmed) return;
          if (hasActiveResponse) return;

          const dur = lastSpeechStartAt ? Date.now() - lastSpeechStartAt : 0;
          if (dur < MIN_SPEECH_MS) return;

          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch {}
          armReprompt();
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
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload },
            })
          );
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

            if (endsWithGoodbye(a)) {
              armHangupWindow();
            } else {
              armReprompt();
            }
          }
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e?.message || e);
      }
    });

    connection.on("message", async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.event === "start") {
          streamSid = data.start.streamSid;
          callSid = data.start.callSid || null;

          twilioStarted = true;
          callStarted = true;

          const cp = (data.start && data.start.customParameters) || {};
          if (!kind && typeof cp.kind === "string") kind = cp.kind;
          if (!userId && typeof cp.userId === "string") userId = cp.userId;

          await loadUser();
          maybeInitializeSession();
          maybeSendGreeting();

          try {
            if (callSid) {
              await Call.findOrCreate({
                where: { callSid },
                defaults: { callSid },
              });

              if (twilioClient && PUBLIC_BASE_URL) {
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
              }
            }
          } catch {}

          return;
        }

        if (data.event === "media") {
          if (hangupArmed) cancelHangup();
          cancelReprompt();

          if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              })
            );
          }
          return;
        }

        if (data.event === "stop") {
          cancelHangup();
          cancelReprompt();
          try {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
          } catch {}
        }
      } catch (e) {
        console.error("[WS] parse error", e?.message || e);
      }
    });

    connection.on("close", async () => {
      cancelHangup();
      cancelReprompt();
      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}

      try {
        await processCallOutcome({
          qaPairs,
          userId,
          callSid,
          campaignType: String(kind || inferKind()),
        });
      } catch (e) {
        console.error("[SUMMARY] error", e?.message || e);
      }
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  return wss;
}
