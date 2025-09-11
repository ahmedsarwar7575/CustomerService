import { Router } from "express";
import {
  connectIndex,
  semanticSearch,
  buildSnippetsBlock,
} from "../utils/pinecone.js";

const router = Router();

const SYSTEM_MESSAGE = `
You are John Smith, a friendly GETPIE support agent.
English only. 1–2 sentence replies. One clear question at a time.
STRICT: Only answer using facts in the injected SNIPPETS. If none match, say:
"That isn’t in our knowledge base yet." Then continue the workflow (clarify or next step).
Before ending, collect/confirm full name and email. Never ask for phone.
First line: "Hello, this is John Smith with GETPIE Customer Support. Thanks for reaching out today. I’m here to listen and get you a clear next step."
Then: "How can I help you today?"
`;

await connectIndex().catch((e) => {
  console.error("[BOOT] Pinecone error", e);
  process.exit(1);
});

// Create ephemeral key for WebRTC
router.get("/realtime-session", async (req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        instructions: SYSTEM_MESSAGE,
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
        modalities: ["audio", "text"],
        turn_detection: {
          type: "server_vad",
          threshold: 0.7,
          prefix_padding_ms: 300,
          silence_duration_ms: 800,
        },
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      }),
    });

    const txt = await r.text();
    console.log("[SESSION] status:", r.status);
    console.log("[SESSION] body:", txt);

    if (!r.ok) return res.status(r.status).send(txt);
    const json = JSON.parse(txt);
    const key = json.client_secret?.value || json.client_secret || null;
    if (!key)
      return res
        .status(500)
        .json({ error: "No client_secret in response", raw: json });
    res.json({ client_secret: key });
  } catch (e) {
    console.error("[SESSION] error:", e);
    res.status(500).json({ error: String(e) });
  }
});

// RAG API called by frontend each user turn
router.post("/rag", async (req, res) => {
  try {
    const { query, topK, minScore } = req.body || {};
    if (!query || !String(query).trim())
      return res.status(400).json({ error: "Missing 'query'" });
    console.log(`[RAG API] query="${query}"`);
    const items = await semanticSearch(String(query), { topK, minScore });
    const block = items.length ? buildSnippetsBlock(query, items) : "";
    console.log(`[RAG API] snippets=${items.length}`);
    res.json({ count: items.length, block });
  } catch (e) {
    console.error("[RAG API] error:", e);
    res.status(500).json({ error: String(e) });
  }
});

export default router;
