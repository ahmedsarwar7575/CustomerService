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

if (!OPENAI_API_KEY) {
  console.error("[OPENAI] ERROR: Missing OPENAI_API_KEY in environment");
}

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

/** ---------------- OPENAI WS FACTORY ---------------- */
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
    console.error(
      "[OPENAI] unexpected-response",
      res.statusCode,
      res.statusMessage,
      body
    );
  });

  ws.on("error", (e) => {
    console.error("[OPENAI] socket error:", e?.message || e);
  });

  return ws;
}

/** ---------------- SESSION CONFIG ---------------- */
function buildSessionUpdate(instructions) {
  return {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
        threshold: 0.85, // less sensitive to tiny noise
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: false, // we call response.create manually
        interrupt_response: false, // no server barge-in
      },
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      voice: REALTIME_VOICE,
      instructions,
      modalities: ["text", "audio"],
      temperature: 0.7,
      input_audio_transcription: {
        // 🔥 better model + hard English
        model: "gpt-4o-transcribe-preview",
        language: "en",
        prompt:
          "Agent and caller must speak ONLY English. If the caller uses any other language, transcribe it as English meaning only.",
      },
    },
  };
}

/** ---------------- GOODBYE DETECTION ---------------- */
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

/** Simple helper to get a nice display name */
function getDisplayName(user) {
  if (!user) return "there";
  return user.name || user.firstName || "there";
}

export function createUpsellWSS() {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on("connection", async (connection, req) => {
    let userId = null;
    let kind = null; // "satisfaction" | "upsell"
    let user = null;

    let streamSid = null;
    let callSid = null;
    let markQueue = [];
    let hasActiveResponse = false;
    let pendingUserQ = null;
    let openaiReady = false;
    let sessionConfigured = false;
    let commitTimer = null;
    let metricsTimer = null;
    let hangupScheduled = false;
    let twilioStarted = false;
    let callStarted = false;
    let greetingSent = false;

    let mediaQueue = [];

    let framesIn = 0;
    let framesOut = 0;
    let bytesIn = 0;
    let bytesOut = 0;

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

    const startMetrics = () => {
      if (metricsTimer) return;
      metricsTimer = setInterval(() => {
        // Uncomment to debug metrics:
        // console.log(
        //   `[METRICS] in=${framesIn}/${bytesIn}B out=${framesOut}/${bytesOut}B active=${hasActiveResponse} openai=${openaiReady} marks=${markQueue.length}`
        // );
      }, 3000);
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
      } catch {}
    };

    function scheduleHangup() {
      if (hangupScheduled || !callSid || !twilioClient) return;
      hangupScheduled = true;
      // ⏳ wait longer so closing sentence is NOT cut off
      setTimeout(() => {
        twilioClient
          .calls(callSid)
          .update({ status: "completed" })
          .then(() => {
            console.log(
              `[TWILIO] Hung up outbound call ${callSid} ~7s after goodbye.`
            );
          })
          .catch((err) => {
            console.error("[TWILIO] hangup error", err?.message || err);
          });
      }, 7000);
    }

    /** --------------- GREETING LOGIC (AGENT SPEAKS FIRST) --------------- */
    function maybeSendGreeting() {
      if (greetingSent) return;
      if (!sessionConfigured) return;
      if (!callStarted) return;
      if (openAiWs.readyState !== WebSocket.OPEN) return;

      greetingSent = true;

      const displayName = getDisplayName(user);
      const k = String(kind || "").toLowerCase();

      let greetingInstruction;

      if (k === "satisfaction") {
        // Satisfaction campaign greeting
        greetingInstruction = `
In this FIRST reply, speak in English only, with a calm, natural tone.

1. Greet the customer by name "${displayName}" if it sounds natural.
2. Briefly say this is a quick follow-up about their recent support call.
3. Then clearly ask: "Are you satisfied with the assistance you received?"
4. After asking, STOP and wait for their answer.
You must speak first. Keep it to 1–2 short sentences plus the question.
`.trim();
      } else {
        // Upsell campaign greeting
        greetingInstruction = `
In this FIRST reply, speak in English only, with a calm, natural tone.

1. Greet the customer by name "${displayName}" if it sounds natural.
2. Say this is a quick call to share one simple way to help their business grow using their existing payment processing.
3. Then ask a single short question like: "Is now a good moment to talk for less than a minute?"
4. After asking, STOP and wait for their answer.
You must speak first. Keep it brief and friendly.
`.trim();
      }

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
        console.log("[OPENAI] greeting sent (agent spoke first)");
      } catch (e) {
        console.error("greeting response.create error", e);
      }
    }

    /** --------------- SESSION CONFIG WHEN READY --------------- */
    const configureSessionIfNeeded = async () => {
      if (sessionConfigured) return;
      if (!openaiReady) return;
      if (!twilioStarted) return;

      try {
        const pickedKind = inferKind() || "upsell";

        let instrBase = await makeSystemMessage(userId, pickedKind);

        // Global behavior: English only + calm tone
        const instr =
          instrBase +
          `
          
GLOBAL BEHAVIOR (VERY IMPORTANT):
- Always speak ONLY in English, even if the caller uses another language.
- Use a calm, friendly, human tone. Short sentences, no robotic style.
- Always end the call with a natural goodbye line before hanging up.
`.trim();

        // Only send session.update here (no greeting yet)
        openAiWs.send(JSON.stringify(buildSessionUpdate(instr)));
        sessionConfigured = true;
        console.log("[OPENAI] session.update sent (configured)");

        // Now that session is configured, send the first greeting
        maybeSendGreeting();

        // Start periodic commit loop so VAD can segment audio
        if (!commitTimer) {
          commitTimer = setInterval(() => {
            if (
              openAiWs.readyState === WebSocket.OPEN &&
              sessionConfigured &&
              !hasActiveResponse
            ) {
              try {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
              } catch {}
            }
          }, 300);
        }

        // Flush any queued Twilio audio
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
            console.error("[OPENAI] flush queued media error", e?.message);
          }
        }
      } catch (e) {
        console.error(
          "[OPENAI] configureSessionIfNeeded error",
          e?.message || e
        );
      }
    };

    /** --------------- PARSE userId / kind FROM URL --------------- */
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
      } catch (e) {
        console.error("[WS] user load error", e?.message || e);
      }
    }

    /** --------------- OPENAI WS LIFECYCLE --------------- */
    openAiWs.on("open", async () => {
      openaiReady = true;
      console.log("[OPENAI] socket opened (model:", RT_MODEL, ")");
      await configureSessionIfNeeded();
    });

    openAiWs.on("close", (code, reason) => {
      console.log(
        "[OPENAI] socket closed",
        code,
        reason ? reason.toString() : ""
      );
    });

    openAiWs.on("error", (e) => {
      console.error("[OPENAI] error", e?.message || e);
    });

    openAiWs.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf);

        // We do NOT cancel on speech_started -> avoids tiny-noise barge-in

        if (msg.type === "input_audio_buffer.speech_stopped") {
          console.log("[OPENAI] speech_stopped");
          if (!hasActiveResponse) {
            try {
              openAiWs.send(JSON.stringify({ type: "response.create" }));
            } catch (e) {
              console.error("manual response.create error", e);
            }
          }
        }

        if (msg.type === "response.created") {
          hasActiveResponse = true;
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

          bytesOut += Buffer.byteLength(payload);
          framesOut++;

          if (streamSid) {
            connection.send(
              JSON.stringify({
                event: "media",
                streamSid,
                media: { payload },
              })
            );
            sendMark();
          }
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
          if (t) pendingUserQ = t;
        }

        if (msg.type === "response.done") {
          hasActiveResponse = false;
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

                // goodbye detection -> hang up ~7s later
                if (isGoodbye(a)) {
                  scheduleHangup();
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("[OPENAI] parse error", e);
      }
    });

    /** --------------- TWILIO <-> WS BRIDGE --------------- */
    connection.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);
        if (!metricsTimer) startMetrics();

        switch (data.event) {
          case "start": {
            streamSid = data.start?.streamSid || streamSid || null;
            callSid = data.start?.callSid || callSid || null;
            console.log(
              `[TWILIO] start streamSid=${streamSid} callSid=${callSid}`
            );

            twilioStarted = true;
            callStarted = true;

            const cp = (data.start && data.start.customParameters) || {};
            if (!kind && typeof cp.kind === "string") kind = cp.kind;
            if (!userId && typeof cp.userId === "string") userId = cp.userId;

            if (!user || String(user.id) !== String(userId)) {
              try {
                user = await User.findOne({ where: { id: userId } });
                if (user)
                  console.log("[WS] user reloaded via start.customParameters");
              } catch (e) {
                console.error("[WS] user reload error", e?.message || e);
              }
            }

            await configureSessionIfNeeded();

            try {
              if (callSid && twilioClient) {
                await Call.findOrCreate({
                  where: { callSid },
                  defaults: {
                    callSid,
                  },
                });

                const base =
                  process.env.PUBLIC_BASE_URL || "https://example.com";

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
                console.log("[TWILIO] recording started");
              }
            } catch (e) {
              console.error("[TWILIO] recording error", e?.message || e);
            }
            break;
          }

          case "media": {
            if (!streamSid && data.streamSid) {
              streamSid = data.streamSid;
              console.log("[TWILIO] inferred streamSid", streamSid);
            }

            framesIn++;
            const payload = data.media?.payload || "";
            bytesIn += Buffer.byteLength(payload);

            await configureSessionIfNeeded();

            if (
              openAiWs.readyState === WebSocket.OPEN &&
              sessionConfigured === true
            ) {
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
            break;
          }

          case "mark": {
            if (markQueue.length) markQueue.shift();
            break;
          }

          case "stop": {
            console.log("[TWILIO] stop");
            if (commitTimer) {
              clearInterval(commitTimer);
              commitTimer = null;
            }
            try {
              if (openAiWs.readyState === WebSocket.OPEN) {
                openAiWs.send(
                  JSON.stringify({ type: "input_audio_buffer.commit" })
                );
                openAiWs.close();
              }
            } catch {}
            break;
          }

          default: {
            console.log("[TWILIO] event", data.event);
            break;
          }
        }
      } catch (e) {
        console.error("[WS] parse error", e);
      }
    });

    connection.on("close", async () => {
      console.log("[WS] Twilio disconnected");
      if (metricsTimer) clearInterval(metricsTimer);
      if (commitTimer) {
        clearInterval(commitTimer);
        commitTimer = null;
      }
      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}

      console.log("[SUMMARY] qaPairs", qaPairs.length);

      try {
        const result = await processCallOutcome({
          qaPairs,
          userId,
          callSid,
          campaignType: kind || "upsell",
        });
        console.log("[SUMMARY] outcome", result?.outcome);
      } catch (e) {
        console.error("[SUMMARY] summarize error", e?.message || e);
      }
    });

    connection.on("error", (e) => console.error("[WS] error", e?.message || e));
  });

  console.log("[WS] upsell WSS ready (noServer)");
  return wss;
}
