// server.js
import http from "http";
import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const RAW_NS = process.env.PINECONE_NAMESPACE;
const NS = RAW_NS === "__blank__" || RAW_NS === undefined ? "" : RAW_NS;

let pineIndex;
(async () => {
  pineIndex = NS ? pc.index(INDEX_NAME).namespace(NS) : pc.index(INDEX_NAME);
})();

const TRACE = (id, ev, data = {}) =>
  console.log(JSON.stringify({ ts: Date.now(), trace_id: id, event: ev, ...data }));

// Twilio endpoint -> WS stream
app.all("/incoming-call", (req, res) => {
  const WS_HOST = process.env.WS_HOST || "localhost:3000";
  const wsUrl = `wss://${WS_HOST}/whisper-media`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to the assistant.</Say>
  <Connect>
    <Stream url="${wsUrl}"/>
  </Connect>
</Response>`;
  res.type("text/xml").send(twiml);
});

app.get("/health", (_, res) => res.json({ ok: true }));

const server = http.createServer(app);

// ---- Audio utils (μ-law/PCM/WAV/VAD) ----
const MULAW_MAX = 0x1fff;
const BIAS = 0x84;
function ulawDecodeByte(u8) {
  u8 = ~u8 & 0xff;
  const sign = u8 & 0x80;
  let exponent = (u8 >> 4) & 0x07;
  let mantissa = u8 & 0x0f;
  let sample = ((mantissa << 4) + 8) << (exponent + 3);
  sample -= BIAS;
  if (sign) sample = -sample;
  if (sample > 32767) sample = 32767;
  if (sample < -32768) sample = -32768;
  return sample;
}
function ulawEncodeSample(pcm) {
  let sign = (pcm >> 8) & 0x80;
  if (sign) pcm = -pcm;
  if (pcm > MULAW_MAX) pcm = MULAW_MAX;
  pcm = pcm + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
function decodeMuLawToPCM16(mu) {
  const out = new Int16Array(mu.length);
  for (let i = 0; i < mu.length; i++) out[i] = ulawDecodeByte(mu[i]);
  return out;
}
function encodePCM16ToMuLaw(pcm) {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = ulawEncodeSample(pcm[i]);
  return out;
}
function resamplePCM16_16k_to_8k(pcm16k) {
  const out = new Int16Array(Math.floor(pcm16k.length / 2));
  for (let i = 0, j = 0; j < out.length; i += 2, j++) out[j] = (pcm16k[i] + pcm16k[i + 1]) / 2;
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
  let voiced = false, silence = 0;
  return {
    feed(framePCM) {
      let sum = 0;
      for (let i = 0; i < framePCM.length; i++) sum += Math.abs(framePCM[i]);
      const avg = sum / framePCM.length;
      if (avg > energy) { voiced = true; silence = 0; return "speech"; }
      if (voiced) { silence++; if (silence >= wins) { voiced = false; silence = 0; return "utterance_end"; } }
      return "silence";
    },
    reset() { voiced = false; silence = 0; }
  };
}

// ---- Pipeline (Whisper → Pinecone → GPT → TTS) ----
async function transcribeWhisper(wavPath, promptHint = "") {
  const r = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: fs.createReadStream(wavPath),
    prompt: promptHint
  });
  return r.text?.trim() || "";
}
async function embedAndSearch(text) {
  const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
  const vec = (await openai.embeddings.create({ model: EMBED_MODEL, input: text })).data[0].embedding;
  const res = await pineIndex.query({
    vector: vec,
    topK: Number(process.env.TOPK || 8),
    includeMetadata: true
  });
  const minScore = Number(process.env.RAG_MIN_SCORE || 0.6);
  const matches = (res.matches || []).filter(m => (m.score ?? 0) >= minScore);
  return matches.map(m => ({
    id: m.id,
    score: m.score,
    text: String(m.metadata?.text || m.metadata?.chunk || m.metadata?.content || m.metadata?.body || "")
  }));
}
async function answerGrounded(systemText, transcript, snippets) {
  const payload = { transcript_text: transcript, snippets: snippets.slice(0, 5).map(s => ({ id: s.id, score: s.score, text: s.text.slice(0, 1600) })) };
  const r = await openai.chat.completions.create({
    model: process.env.GPT_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: JSON.stringify(payload) }
    ]
  });
  return r.choices[0]?.message?.content?.trim() || "";
}
async function ttsToPCM16(text) {
  const r = await openai.audio.speech.create({
    model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
    voice: process.env.TTS_VOICE || "alloy",
    input: text,
    format: "pcm"
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

// ---- WS: Twilio Media Streams ----
const wss = new WebSocketServer({ server, path: "/whisper-media" });
console.log(JSON.stringify({ ts: Date.now(), event: "ws.ready", path: "/whisper-media" }));

wss.on("connection", (conn) => {
  const trace_id = uuidv4();
  let streamSid = null;
  let muChunks = [];
  let playing = false;
  const vad = vadSegmenter({
    windowMs: Number(process.env.VAD_WINDOW_MS || 200),
    silenceMs: Number(process.env.VAD_SILENCE_MS || 900),
    energy: Number(process.env.VAD_ENERGY || 900)
  });

  const flushUtterance = async () => {
    if (muChunks.length === 0) return;
    try {
      const mu = Buffer.concat(muChunks);
      const pcm8k = decodeMuLawToPCM16(mu);
      const wav = buildWavFromPCM16(pcm8k, 8000);
      const tmp = path.join(os.tmpdir(), `utt_${Date.now()}.wav`);
      fs.writeFileSync(tmp, wav);

      TRACE(trace_id, "stt.start", { dur_ms: Math.round((pcm8k.length/8000)*1000) });
      const transcript = await transcribeWhisper(tmp, process.env.WHISPER_HINT || "");
      fs.unlink(tmp, () => {});
      TRACE(trace_id, "stt.done", { text: transcript });

      TRACE(trace_id, "retrieval.start");
      const snippets = await embedAndSearch(transcript);
      TRACE(trace_id, "retrieval.done", { hits: snippets.length, top: snippets[0]?.score ?? null });

      const system = "Short answers. Use ONLY provided snippets; if none, say it isn’t in our knowledge base and ask one clarifier.";
      TRACE(trace_id, "llm.start");
      const answer = await answerGrounded(system, transcript, snippets);
      TRACE(trace_id, "llm.done", { len: answer.length });

      TRACE(trace_id, "tts.start");
      const pcm16k = await ttsToPCM16(answer);
      const pcm8kTTS = resamplePCM16_16k_to_8k(pcm16k);
      const muTTS = encodePCM16ToMuLaw(pcm8kTTS);
      TRACE(trace_id, "tts.done", { samples: pcm8kTTS.length });

      // 20ms frames @8k => 160 samples
      const frame = 160;
      playing = true;
      for (let i = 0; i < muTTS.length; i += frame) {
        if (!streamSid) break;
        const slice = muTTS.subarray(i, Math.min(i + frame, muTTS.length));
        conn.send(JSON.stringify({ event: "media", streamSid, media: { payload: Buffer.from(slice).toString("base64") } }));
        conn.send(JSON.stringify({ event: "mark", streamSid, mark: { name: `f_${(i/frame)|0}` } }));
        await new Promise(r => setTimeout(r, 20));
      }
      playing = false;
    } catch (e) {
      playing = false;
      TRACE(trace_id, "pipeline.error", { err: String(e?.message || e) });
    }
    muChunks = [];
    vad.reset();
  };

  conn.on("message", async (msg) => {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }

    switch (data.event) {
      case "connected":
        TRACE(trace_id, "twilio.connected");
        break;
      case "start":
        streamSid = data.start.streamSid;
        TRACE(trace_id, "twilio.start", { streamSid, callSid: data.start.callSid || null });
        break;
      case "media": {
        const payload = data.media?.payload;
        if (!payload) return;
        if (playing) break; // drop mic while playing
        const mu = Buffer.from(payload, "base64");
        muChunks.push(mu);
        const pcm = decodeMuLawToPCM16(mu);
        const decision = vad.feed(pcm);
        if (decision === "utterance_end") {
          TRACE(trace_id, "vad.utterance.end");
          await flushUtterance();
        }
        break;
      }
      case "stop":
        TRACE(trace_id, "twilio.stop");
        await flushUtterance();
        break;
      default:
        break;
    }
  });

  conn.on("close", () => TRACE(trace_id, "ws.closed", { streamSid }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`listening on :${PORT}`));
