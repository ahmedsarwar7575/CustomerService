import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NAME   = process.env.PINECONE_INDEX       || "ai-chatbot";
const NS     = process.env.PINECONE_NAMESPACE   || "default";
const HOST   = process.env.PINECONE_INDEX_HOST  || null;
const REGION = process.env.PINECONE_REGION      || "us-east-1";
const CLOUD  = process.env.PINECONE_CLOUD       || "aws";
const DIMENV = Number(process.env.PINECONE_DIM  || 2048);
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const MIN_SCORE   = Number(process.env.RAG_MIN_SCORE || 0.6);
const TOPK        = Number(process.env.TOPK || 6);

export let index;
export let indexDim = DIMENV;

export const connectIndex = async () => {
  console.log(`[PINECONE] connect name=${NAME} ns=${NS} host=${HOST || "(auto)"}`);
  const list = await pc.listIndexes();
  const exists = list.indexes?.some(i => i.name === NAME);
  if (!exists) {
    console.log(`[PINECONE] creating index ${NAME} dim=${DIMENV}`);
    await pc.createIndex({
      name: NAME,
      dimension: DIMENV,
      metric: "cosine",
      spec: { serverless: { cloud: CLOUD, region: REGION } }
    });
    console.log("[PINECONE] waiting 30s for readiness");
    await new Promise(r => setTimeout(r, 30000));
  }
  const base = HOST ? pc.index(NAME, HOST) : pc.index(NAME);
  index = base.namespace(NS);

  try {
    const info = await pc.describeIndex(NAME);
    indexDim = Number(info?.dimension || DIMENV);
    console.log(`[PINECONE] ready name=${NAME} ns=${NS} dim=${indexDim} host=${info?.host || "(runtime)"}`);
  } catch (e) {
    console.warn("[PINECONE] describeIndex failed; using env dim", e?.message || e);
    indexDim = DIMENV;
  }
};

const fitDim = (v, dim) => {
  if (!Array.isArray(v)) return [];
  if (v.length === dim) return v;
  if (v.length > dim) return v.slice(0, dim);
  const out = v.slice();
  while (out.length < dim) out.push(0);
  return out;
};

export const semanticSearch = async (query, { topK = TOPK, minScore = MIN_SCORE } = {}) => {
  console.log(`[RAG] embed model=${EMBED_MODEL} query="${query}"`);
  const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: query });
  const vec = fitDim(emb.data[0].embedding, indexDim);

  console.log(`[RAG] query topK=${topK} minScore=${minScore} dim=${vec.length}`);
  const res = await index.query({ topK, vector: vec, includeMetadata: true });

  const matches = (res?.matches || []).map(m => ({
    id: m.id,
    score: m.score,
    text: String(
      m.metadata?.text ||
      m.metadata?.chunk_text ||
      m.metadata?.content ||
      m.metadata?.body || ""
    )
  }));

  console.log(`[RAG] matches=${matches.length} sample=${JSON.stringify(matches.slice(0,2))}`);
  const filtered = matches.filter(m => (m.score ?? 0) >= minScore);
  console.log(`[RAG] filtered>=${minScore}: ${filtered.length}`);
  return filtered;
};

export const buildSnippetsBlock = (query, items) =>
  items.map((m, i) => `● (${i + 1}) id=${m.id} score=${(m.score ?? 0).toFixed(3)}\n${m.text.slice(0,800)}`).join("\n\n");
