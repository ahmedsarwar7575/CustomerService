import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const NS = process.env.PINECONE_NAMESPACE || "default";
const DIM = Number(process.env.PINECONE_DIM || 2048);
const REGION = process.env.PINECONE_REGION || "us-east-1";
const CLOUD = process.env.PINECONE_CLOUD || "aws";
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

export let index;
export let indexDim = DIM;

export const connectIndex = async () => {
  const list = await pc.listIndexes();
  const exists = list.indexes?.some(i => i.name === NAME);
  if (!exists) {
    await pc.createIndex({
      name: NAME,
      dimension: DIM,
      metric: "cosine",
      spec: { serverless: { cloud: CLOUD, region: REGION } }
    });
    await new Promise(r => setTimeout(r, 30000));
  }
  index = pc.index(NAME).namespace(NS);
  
  try {
    const info = await pc.describeIndex(NAME);
    indexDim = Number(info?.dimension || DIM);
    console.log(`Pinecone index ${NAME} dimension: ${indexDim}`);
  } catch {
    indexDim = DIM;
  }
};

const padOrTrim = (vals, dim) => {
  if (vals.length === dim) return vals;
  if (vals.length > dim) return vals.slice(0, dim);
  const out = vals.slice();
  while (out.length < dim) out.push(0);
  return out;
};

export const semanticSearch = async (query, { topK = 6, minScore = 0.55 } = {}) => {
  const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: query });
  const vec = padOrTrim(emb.data[0].embedding, indexDim);
  const res = await index.query({ topK, vector: vec, includeMetadata: true });
  const items = (res.matches || [])
    .map(m => ({
      id: m.id,
      score: m.score,
      text: String(m.metadata?.text || m.metadata?.chunk_text || m.metadata?.content || "")
    }))
    .filter(m => (m.score ?? 0) >= minScore);
  return items;
};

export const buildSnippetsBlock = (query, items) =>
  items.map((m, i) => `● (${i + 1}) id=${m.id} score=${(m.score ?? 0).toFixed(3)}\n${m.text.slice(0, 800)}`).join("\n\n");
