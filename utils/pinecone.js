import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const RAW_NS = process.env.PINECONE_NAMESPACE;
const NS = RAW_NS === "__blank__" || RAW_NS === undefined ? "" : RAW_NS;

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small"; // 1536
const EXPECT_DIM = Number(process.env.PINECONE_DIM || 1536);

let index;
let indexDim = EXPECT_DIM;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connectIndex() {
  const list = await pc.listIndexes();
  const exists = list.indexes?.some((i) => i.name === INDEX_NAME);
  if (!exists) {
    await pc.createIndex({
      name: INDEX_NAME,
      dimension: EXPECT_DIM,
      metric: "cosine",
      spec: {
        serverless: {
          cloud: process.env.PINECONE_CLOUD || "aws",
          region: process.env.PINECONE_REGION || "us-east-1",
        },
      },
    });
    await sleep(30000);
  }
  const base = pc.index(INDEX_NAME);
  index = NS ? base.namespace(NS) : base;
  try {
    const info = await pc.describeIndex(INDEX_NAME);
    indexDim = Number(info?.dimension || EXPECT_DIM);
  } catch {}
  console.log(
    JSON.stringify({
      ts: Date.now(),
      event: "pinecone.ready",
      index: INDEX_NAME,
      ns: NS || "(blank)",
      dim: indexDim,
    })
  );
}

async function embed(text) {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
  const v = r.data[0].embedding;
  if (v.length !== indexDim)
    throw new Error(
      `Embedding dim ${v.length} != index dim ${indexDim}. Fix EMBED_MODEL/PINECONE_DIM.`
    );
  return v;
}

export async function embedAndSearch(text) {
  const vec = await embed(text);
  const res = await index.query({
    vector: vec,
    topK: Number(process.env.TOPK || 8),
    includeMetadata: true,
  });
  const minScore = Number(process.env.RAG_MIN_SCORE || 0.6);
  const matches = (res.matches || []).filter((m) => (m.score ?? 0) >= minScore);
  return matches.map((m) => ({
    id: m.id,
    score: m.score,
    text: String(
      m.metadata?.text ||
        m.metadata?.chunk ||
        m.metadata?.content ||
        m.metadata?.body ||
        ""
    ),
  }));
}
