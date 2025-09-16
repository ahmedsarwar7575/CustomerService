import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const RAW_NS = process.env.PINECONE_NAMESPACE;
const NS = RAW_NS === "__blank__" || RAW_NS === undefined ? "" : RAW_NS;
const CLOUD = process.env.PINECONE_CLOUD || "aws";
const REGION = process.env.PINECONE_REGION || "us-east-1";

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small"; // 1536
const EXPECT_DIM = Number(process.env.PINECONE_DIM || 1536);
const TOPK = Number(process.env.TOPK || 8);
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE || 0.6);

let index;
let indexDim = EXPECT_DIM;
let warnedDim = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connectIndex() {
  const list = await pc.listIndexes();
  const exists = list.indexes?.some((i) => i.name === INDEX_NAME);
  if (!exists) {
    await pc.createIndex({
      name: INDEX_NAME,
      dimension: EXPECT_DIM,
      metric: "cosine",
      spec: { serverless: { cloud: CLOUD, region: REGION } },
    });
    await sleep(30000);
  }
  const base = pc.index(INDEX_NAME);
  index = NS ? base.namespace(NS) : base;

  try {
    const info = await pc.describeIndex(INDEX_NAME);
    indexDim = Number(info?.dimension || EXPECT_DIM);
  } catch {
    indexDim = EXPECT_DIM;
  }

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
  let v = r.data[0].embedding;
  if (v.length !== indexDim) {
    if (!warnedDim) {
      console.log(
        JSON.stringify({
          ts: Date.now(),
          event: "embed.dim.mismatch",
          got: v.length,
          want: indexDim,
          action: "pad_or_truncate",
        })
      );
      warnedDim = true;
    }
    if (v.length > indexDim) v = v.slice(0, indexDim);
    else v = v.concat(Array(indexDim - v.length).fill(0));
  }
  return v;
}

export async function embedAndSearch(text) {
  const vec = await embed(text);
  const res = await index.query({
    vector: vec,
    topK: TOPK,
    includeMetadata: true,
  });
  const matches = (res.matches || []).filter(
    (m) => (m.score ?? 0) >= MIN_SCORE
  );
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
