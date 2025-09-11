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
const MIN_SCORE   = Number(process.env.RAG_MIN_SCORE || 0.35);
const TOPK        = Number(process.env.TOPK || 6);

export let index;
export let indexDim = DIMENV;

const jerr = (where, e) => {
  console.error(JSON.stringify({ ts: Date.now(), event: "error", where, message: e?.message || String(e) }));
};

export const connectIndex = async () => {
  try {
    const list = await pc.listIndexes();
    const exists = list.indexes?.some(i => i.name === NAME);
    if (!exists) {
      await pc.createIndex({
        name: NAME,
        dimension: DIMENV,
        metric: "cosine",
        spec: { serverless: { cloud: CLOUD, region: REGION } }
      });
      await new Promise(r => setTimeout(r, 30000));
    }
    const base = HOST ? pc.index(NAME, HOST) : pc.index(NAME);
    index = base.namespace(NS);

    try {
      const info = await pc.describeIndex(NAME);
      indexDim = Number(info?.dimension || DIMENV);
    } catch {
      indexDim = DIMENV;
    }

    try {
      const stats = await index.describeIndexStats?.() || {};
      const nsStats = stats.namespaces?.[NS] || stats.namespaces?.[""] || {};
      const count = Number(nsStats?.vectorCount || nsStats?.vector_count || 0);
      if (!count) {
        console.error(JSON.stringify({ ts: Date.now(), event: "error", where: "pinecone.namespace", message: `no_vectors_in_namespace name=${NAME} ns=${NS}` }));
      }
    } catch (e) {
      jerr("pinecone.describeIndexStats", e);
    }
  } catch (e) {
    jerr("pinecone.connectIndex", e);
    throw e;
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

const queryPinecone = async (vector, topK) => {
  const res = await index.query({ topK, vector, includeMetadata: true });
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
  return matches;
};

export const embed = async (text) => {
  const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
  return emb.data[0].embedding;
};

export const semanticSearch = async (query, { topK = TOPK, minScore = MIN_SCORE } = {}) => {
  try {
    const vec = fitDim(await embed(query), indexDim);
    const matches = await queryPinecone(vec, topK);
    const filtered = matches.filter(m => (m.score ?? 0) >= minScore);
    return filtered;
  } catch (e) {
    jerr("pinecone.semanticSearch", e);
    return [];
  }
};

export const semanticSearchAny = async (query, { topK = TOPK } = {}) => {
  try {
    const vec = fitDim(await embed(query), indexDim);
    return await queryPinecone(vec, topK);
  } catch (e) {
    jerr("pinecone.semanticSearchAny", e);
    return [];
  }
};

export const buildSnippetsBlock = (query, items) =>
  items.map((m, i) => `● (${i + 1}) id=${m.id} score=${(m.score ?? 0).toFixed(3)}\n${m.text.slice(0,800)}`).join("\n\n");
