import { WebSocketServer } from "ws";
import fs from "fs";
import os from "os";
import path from "path";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { embedAndSearch } from "./utils/pinecone.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --------- μ-law / PCM / WAV / VAD ----------
const MULAW_MAX = 0x1fff,
  BIAS = 0x84;
function ulawDecodeByte(u8) {
  u8 = ~u8 & 0xff;
  const s = u8 & 0x80;
  let e = (u8 >> 4) & 7,
    m = u8 & 0xf,
    x = ((m << 4) + 8) << (e + 3);
  x -= BIAS;
  if (s) x = -x;
  return Math.max(-32768, Math.min(32767, x));
}
function ulawEncodeSample(p) {
  let s = (p >> 8) & 0x80;
  if (s) p = -p;
  if (p > MULAW_MAX) p = MULAW_MAX;
  p += BIAS;
  let e = 7;
  for (let m = 0x4000; (p & m) === 0 && e > 0; e--, m >>= 1) {}
  const M = (p >> (e + 3)) & 0x0f;
  return ~(s | (e << 4) | M) & 0xff;
}
function decodeMuLawToPCM16(mu) {
  const o = new Int16Array(mu.length);
  for (let i = 0; i < mu.length; i++) o[i] = ulawDecodeByte(mu[i]);
  return o;
}
function encodePCM16ToMuLaw(pcm) {
  const o = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) o[i] = ulawEncodeSample(pcm[i]);
  return o;
}
function resamplePCM16_16k_to_8k(p) {
  const o = new Int16Array(Math.floor(p.length / 2));
  for (let i = 0, j = 0; j < o.length; i += 2, j++)
    o[j] = (p[i] + p[i + 1]) / 2;
  return o;
}
function buildWavFromPCM16(pcm, sr) {
  const br = sr * 2,
    ba = 2,
    sz = pcm.length * 2,
    b = Buffer.alloc(44 + sz);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + sz, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(br, 28);
  b.writeUInt16LE(ba, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(sz, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}
function vadSegmenter({ windowMs = 200, silenceMs = 900, energy = 900 }) {
  const srate = 8000,
    wins = Math.max(1, Math.floor(silenceMs / windowMs));
  let voiced = false,
    sil = 0;
  return {
    feed(f) {
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += Math.abs(f[i]);
      const avg = sum / f.length;
      if (avg > energy) {
        voiced = true;
        sil = 0;
        return "speech";
      }
      if (voiced) {
        sil++;
        if (sil >= wins) {
          voiced = false;
          sil = 0;
          return "utterance_end";
        }
      }
      return "silence";
    },
    reset() {
      voiced = false;
      sil = 0;
    },
  };
}

// --------- OpenAI steps ----------
async function transcribeWhisper(wavPath, prompt = "") {
  const r = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: fs.createReadStream(wavPath),
    prompt,
  });
  return r.text?.trim() || "";
}
async function answerGrounded(systemText, transcript, snippets) {
  const payload = {
    transcript_text: transcript,
    snippets: snippets
      .slice(0, 5)
      .map((s) => ({ id: s.id, score: s.score, text: s.text.slice(0, 1600) })),
  };
  const r = await openai.chat.completions.create({
    model: process.env.GPT_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });
  return r.choices[0]?.message?.content?.trim() || "";
}
async function ttsToPCM16(text) {
  const r = await openai.audio.speech.create({
    model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
    voice: process.env.TTS_VOICE || "alloy",
    input: text,
    format: "pcm",
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

// --------- WS Bridge (Twilio <-> Pipeline) ----------
export async function attachNewFlow(server) {
  const wss = new WebSocketServer({ server, path: "/whisper-media" });
  console.log(
    JSON.stringify({
      ts: Date.now(),
      event: "ws.ready",
      path: "/whisper-media",
    })
  );

  wss.on("connection", (conn) => {
    const trace_id = uuidv4();
    let streamSid = null;
    let muChunks = [];
    let playing = false;

    const vad = vadSegmenter({
      windowMs: Number(process.env.VAD_WINDOW_MS || 200),
      silenceMs: Number(process.env.VAD_SILENCE_MS || 900),
      energy: Number(process.env.VAD_ENERGY || 900),
    });

    const log = (event, data = {}) =>
      console.log(JSON.stringify({ ts: Date.now(), trace_id, event, ...data }));

    const flushUtterance = async () => {
      if (muChunks.length === 0) return;
      try {
        const mu = Buffer.concat(muChunks);
        const pcm8k = decodeMuLawToPCM16(mu);
        const wav = buildWavFromPCM16(pcm8k, 8000);
        const tmp = path.join(os.tmpdir(), `utt_${Date.now()}.wav`);
        fs.writeFileSync(tmp, wav);

        log("stt.start", { ms: Math.round((pcm8k.length / 8000) * 1000) });
        const transcript = await transcribeWhisper(
          tmp,
          process.env.WHISPER_HINT || ""
        );
        fs.unlink(tmp, () => {});
        log("stt.done", { text: transcript });

        log("retrieval.start");
        const snippets = await embedAndSearch(transcript);
        log("retrieval.done", {
          hits: snippets.length,
          top: snippets[0]?.score ?? null,
        });

        const system =
          "Short answers. Use ONLY provided snippets; if none, say it isn’t in our knowledge base and ask one clarifier.";
        log("llm.start");
        const answer = await answerGrounded(system, transcript, snippets);
        log("llm.done", { len: answer.length });

        log("tts.start");
        const pcm16k = await ttsToPCM16(answer);
        const pcm8kTTS = resamplePCM16_16k_to_8k(pcm16k);
        const muTTS = encodePCM16ToMuLaw(pcm8kTTS);
        log("tts.done", { samples: pcm8kTTS.length });

        // stream back 20ms frames (160 samples @8k)
        const frame = 160;
        playing = true;
        for (let i = 0; i < muTTS.length; i += frame) {
          if (!streamSid) break;
          const slice = muTTS.subarray(i, Math.min(i + frame, muTTS.length));
          conn.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: Buffer.from(slice).toString("base64") },
            })
          );
          conn.send(
            JSON.stringify({
              event: "mark",
              streamSid,
              mark: { name: `f_${(i / frame) | 0}` },
            })
          );
          await new Promise((r) => setTimeout(r, 20));
        }
        playing = false;
      } catch (e) {
        playing = false;
        log("error", { err: String(e?.message || e) });
      }
      muChunks = [];
      vad.reset();
    };

    conn.on("message", async (msg) => {
      let data;
      try {
        data = JSON.parse(msg.toString());
      } catch {
        return;
      }

      switch (data.event) {
        case "connected":
          log("twilio.connected");
          break;
        case "start":
          streamSid = data.start.streamSid;
          log("twilio.start", {
            streamSid,
            callSid: data.start.callSid || null,
          });
          break;
        case "media": {
          const payload = data.media?.payload;
          if (!payload) return;
          if (playing) break;
          const mu = Buffer.from(payload, "base64");
          muChunks.push(mu);
          const pcm = decodeMuLawToPCM16(mu);
          const decision = vad.feed(pcm);
          if (decision === "utterance_end") {
            log("vad.utterance.end");
            await flushUtterance();
          }
          break;
        }
        case "stop":
          log("twilio.stop");
          await flushUtterance();
          break;
        default:
          break;
      }
    });

    conn.on("close", () => log("ws.closed", { streamSid }));
  });
}
