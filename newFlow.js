import { WebSocketServer } from "ws";
import fs from "fs";
import os from "os";
import path from "path";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { embedAndSearch } from "./utils/pinecone.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- logs ----
const log = (trace_id, event, data = {}) =>
  console.log(JSON.stringify({ ts: Date.now(), trace_id, event, ...data }));

// ---- μ-law / PCM / WAV / VAD ----
const BIAS = 0x84;
const CLIP = 32635;

function muLawEncodeSample(s) {
  let sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s = s + BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) {}
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

function muLawDecodeByte(u8) {
  u8 = ~u8 & 0xff;
  const sign = u8 & 0x80;
  const exp = (u8 >> 4) & 0x07;
  const mant = u8 & 0x0f;
  let s = ((mant << 3) + BIAS) << exp;
  s -= BIAS;
  return sign ? -s : s;
}

function decodeMuLawToPCM16(mu) {
  const out = new Int16Array(mu.length);
  for (let i = 0; i < mu.length; i++) out[i] = muLawDecodeByte(mu[i]);
  return out;
}

function encodePCM16ToMuLaw(pcm) {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = muLawEncodeSample(pcm[i]);
  return out;
}

function resamplePCM16_16k_to_8k(pcm16k) {
  const N = Math.floor(pcm16k.length / 2);
  const out = new Int16Array(N);
  let prev = 0;
  for (let j = 0, i = 0; j < N; j++, i += 2) {
    const s0 = pcm16k[i];
    const s1 = pcm16k[i + 1] ?? s0;
    out[j] = (prev + (s0 << 1) + s1) >> 2;
    prev = s0;
  }
  return out;
}

function buildWavFromPCM16(pcm, sampleRate) {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

function vadSegmenter({ windowMs = 200, silenceMs = 900, energy = 900 }) {
  const srate = 8000;
  const wins = Math.max(1, Math.floor(silenceMs / windowMs));
  let voiced = false,
    silence = 0;
  return {
    feed(framePCM) {
      let sum = 0;
      for (let i = 0; i < framePCM.length; i++) sum += Math.abs(framePCM[i]);
      const avg = sum / framePCM.length;
      if (avg > energy) {
        voiced = true;
        silence = 0;
        return "speech";
      }
      if (voiced) {
        silence++;
        if (silence >= wins) {
          voiced = false;
          silence = 0;
          return "utterance_end";
        }
      }
      return "silence";
    },
    reset() {
      voiced = false;
      silence = 0;
    },
  };
}

// ---- OpenAI steps ----
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
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2); // 16k mono
}

// ---- WS Bridge ----
export async function attachNewFlow(server) {
  const wss = new WebSocketServer({ server, path: "/media-stream" });
  console.log(
    JSON.stringify({
      ts: Date.now(),
      event: "ws.ready",
      path: "/media-stream",
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

    const flushUtterance = async () => {
      if (muChunks.length === 0) return;
      try {
        const mu = Buffer.concat(muChunks);
        const pcm8k = decodeMuLawToPCM16(mu);
        const wav = buildWavFromPCM16(pcm8k, 8000);
        const tmp = path.join(os.tmpdir(), `utt_${Date.now()}.wav`);
        fs.writeFileSync(tmp, wav);

        log(trace_id, "stt.start", {
          ms: Math.round((pcm8k.length / 8000) * 1000),
        });
        const transcript = await transcribeWhisper(
          tmp,
          process.env.WHISPER_HINT || ""
        );
        fs.unlink(tmp, () => {});
        log(trace_id, "stt.done", { text: transcript });

        log(trace_id, "retrieval.start");
        let snippets = [];
        try {
          snippets = await embedAndSearch(transcript);
        } catch (e) {
          log(trace_id, "retrieval.error", { err: String(e?.message || e) });
        }
        log(trace_id, "retrieval.done", {
          hits: snippets.length,
          top: snippets[0]?.score ?? null,
        });

        const system =
          "Short answers. Use ONLY provided snippets; if none, say it isn’t in our knowledge base and ask one clarifier.";
        log(trace_id, "llm.start");
        const answer = await answerGrounded(system, transcript, snippets);
        log(trace_id, "llm.done", { len: answer.length });

        log(trace_id, "tts.start");
        const pcm16k = await ttsToPCM16(answer);
        const pcm8kTTS = resamplePCM16_16k_to_8k(pcm16k);
        const muTTS = encodePCM16ToMuLaw(pcm8kTTS);
        log(trace_id, "tts.done", { samples: pcm8kTTS.length });

        if (streamSid) conn.send(JSON.stringify({ event: "clear", streamSid })); // clear jitter buffer

        const frame = 160; // 20ms @8k
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
        log(trace_id, "error", { err: String(e?.message || e) });
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
          log(trace_id, "twilio.connected");
          break;
        case "start":
          streamSid = data.start.streamSid;
          log(trace_id, "twilio.start", {
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
            log(trace_id, "vad.utterance.end");
            await flushUtterance();
          }
          break;
        }
        case "stop":
          log(trace_id, "twilio.stop");
          await flushUtterance();
          break;
        default:
          break;
      }
    });

    conn.on("close", () => log(trace_id, "ws.closed", { streamSid }));
  });
}
