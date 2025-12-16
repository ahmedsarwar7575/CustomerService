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
  REALTIME_VOICE = "fable",
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
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY || "MISSING"}`,
      "OpenAI-Beta": "realtime=v1",
      Origin: "https://server.local",
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
      temperature: 0.5,
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
        language: "en",
        prompt:
          "Transcribe ONLY spoken audio to English. If non-English is spoken, translate meaning to English. If silence/noise, output nothing.",
      },
    },
  };
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

function isFinalGoodbye(text = "") {
  const s = String(text || "").trim();
  if (!s) return false;
  const cleaned = s.replace(/\s+/g, " ").replace(/[^\w\s]+$/g, "");
  const last = cleaned.split(" ").pop()?.toLowerCase();
  return last === "goodbye" || last === "bye";
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

    let sessionInitialized = false;
    let callStarted = false;

    let greetingSent = false;
    let greetingDone = false;

    let hasActiveResponse = false;

    let pendingUserQ = null;
    let lastTranscriptAt = 0;

    let hangupArmed = false;
    let hangupTimer = null;

    let audioMode = null; // "output" | "audio" (choose first delta type we see)

    const qaPairs = [];
    const openAiWs = createOpenAIWs();

    function inferKind() {
      if (kind) return kind;
      if (user) {
        if (user.isSatisfactionCall === false) return "satisfaction";
        if (user.isUpSellCall === false) return "upsell";
      }
      return "upsell";
    }

    async function loadUser() {
      if (user || !userId) return;
      try {
        user = await User.findOne({ where: { id: userId } });
      } catch (e) {
        console.error("[WS] user load error", e?.message || e);
      }
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
      } catch (e) {
        console.error("[TWILIO] hangup error", e?.message || e);
      }
    }

    function armHangupWindow() {
      cancelHangup();
      hangupArmed = true;
      hangupTimer = setTimeout(async () => {
        if (!hangupArmed) return;
        await hangupNow();
      }, GOODBYE_WAIT_MS);
    }

    function maybeSendGreeting() {
      if (
        greetingSent ||
        !sessionInitialized ||
        !callStarted ||
        openAiWs.readyState !== WebSocket.OPEN
      )
        return;

      greetingSent = true;

      const name = getDisplayName(user);
      const k = String(inferKind()).toLowerCase();

      const greetingInstruction =
        k === "satisfaction"
          ? `You must speak first. English only. Calm tone.
Say: "Hi ${name}, this is a quick follow-up from our customer success team."
Ask: "Our agent spoke with you recently. Are you satisfied with the assistance you received?"
Stop and wait.
When you end the call, the LAST word must be exactly: "Goodbye."`
          : `You must speak first. English only. Calm tone.
Say: "Hi ${name}, this is a quick call from our customer success team."
Ask: "Is now a good moment for a quick 30-second chat?"
Stop and wait.
When you end the call, the LAST word must be exactly: "Goodbye."`;

      try {
        openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio"], instructions: greetingInstruction },
          })
        );
      } catch (e) {
        console.error("[OPENAI] greeting error", e?.message || e);
      }
    }

    async function initializeSession() {
      if (sessionInitialized) return;
      if (!openAiReady || !twilioStarted) return;

      await loadUser();

      const pickedKind = inferKind();
      const base = await makeSystemMessage(userId, pickedKind);

      const instructions =
        base +
        `

GLOBAL:
- Speak ONLY English.
- Calm, friendly voice. Short sentences.
- Do NOT invent what the caller said.
- Only end when finished.
- When ending, the LAST word must be exactly: "Goodbye."
`.trim();

      try {
        openAiWs.send(JSON.stringify(buildSessionUpdate(instructions)));
        sessionInitialized = true;
        setTimeout(() => maybeSendGreeting(), 200);
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
      openAiReady = true;
      await initializeSession();
    });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        if (msg.type === "input_audio_buffer.speech_started") {
          if (hangupArmed) cancelHangup();
        }

        if (msg.type === "input_audio_buffer.speech_stopped") {
          if (!greetingDone) return;
          if (hasActiveResponse) return;
          if (hangupArmed) return;

          const recent = Date.now() - lastTranscriptAt < 2000;
          if (!recent) return;

          try {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
          } catch {}
        }

        if (msg.type === "response.created") {
          hasActiveResponse = true;
        }

        const isOutputDelta =
          msg.type === "response.output_audio.delta" && msg.delta;
        const isAudioDelta = msg.type === "response.audio.delta" && msg.delta;

        if ((isOutputDelta || isAudioDelta) && streamSid) {
          if (!audioMode) audioMode = isOutputDelta ? "output" : "audio";

          const shouldForward =
            (audioMode === "output" && isOutputDelta) ||
            (audioMode === "audio" && isAudioDelta);

          if (shouldForward) {
            const payload =
              typeof msg.delta === "string"
                ? msg.delta
                : Buffer.from(msg.delta).toString("base64");

            connection.send(
              JSON.stringify({ event: "media", streamSid, media: { payload } })
            );
          }
        }

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const rawT =
            (typeof msg.transcript === "string" && msg.transcript.trim()) ||
            (
              msg.item?.content?.find?.((c) => typeof c?.transcript === "string")
                ?.transcript || ""
            ).trim();

          if (looksLikeJunkTranscript(rawT)) return;

          const t = String(rawT).trim();
          if (!t) return;

          pendingUserQ = t;
          lastTranscriptAt = Date.now();
          if (hangupArmed) cancelHangup();
        }

        if (msg.type === "response.done") {
          hasActiveResponse = false;

          const outputs = msg.response?.output || [];
          for (const out of outputs) {
            if (out?.role !== "assistant") continue;

            const part = Array.isArray(out.content)
              ? out.content.find(
                  (c) => typeof c?.transcript === "string" && c.transcript.trim()
                )
              : null;

            const a = (part?.transcript || "").trim();
            if (!a) continue;

            if (!greetingDone && greetingSent) greetingDone = true;

            if (pendingUserQ) {
              qaPairs.push({ q: pendingUserQ, a });
              pendingUserQ = null;
            } else {
              qaPairs.push({ q: null, a });
            }

            if (isFinalGoodbye(a)) armHangupWindow();
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
          callStarted = true;

          const cp = (data.start && data.start.customParameters) || {};
          if (!kind && typeof cp.kind === "string") kind = cp.kind;
          if (!userId && typeof cp.userId === "string") userId = cp.userId;

          await loadUser();
          await initializeSession();

          try {
            if (callSid) {
              await Call.findOrCreate({
                where: { callSid },
                defaults: { callSid },
              });
            }
          } catch {}

          setTimeout(() => maybeSendGreeting(), 200);
          return;
        }

        if (data.event === "media") {
          const payload = data.media?.payload || "";
          if (!payload) return;

          if (hangupArmed) cancelHangup();

          if (openAiWs.readyState === WebSocket.OPEN) {
            try {
              openAiWs.send(
                JSON.stringify({ type: "input_audio_buffer.append", audio: payload })
              );
            } catch {}
          }
          return;
        }

        if (data.event === "stop") {
          cancelHangup();
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
        console.error("[SUMMARY] summarize error", e?.message || e);
      }
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  return wss;
}
