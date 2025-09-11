import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const RAW_NS = process.env.PINECONE_NAMESPACE;
const NS = RAW_NS === "__blank__" || RAW_NS === undefined ? "" : RAW_NS; // default to blank
const HOST = process.env.PINECONE_INDEX_HOST || null;
const REGION = process.env.PINECONE_REGION || "us-east-1";
const CLOUD = process.env.PINECONE_CLOUD || "aws";
const DIMENV = Number(process.env.PINECONE_DIM || 2048);

// IMPORTANT: match your stored vectors (ada-002)
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-ada-002";

const TOPK = Number(process.env.TOPK || 6);

export let index;
export let indexDim = DIMENV;

const jerr = (where, e) =>
  console.error(
    JSON.stringify({
      ts: Date.now(),
      event: "error",
      where,
      message: e?.message || String(e),
    })
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const connectIndex = async () => {
  try {
    const list = await pc.listIndexes();
    const exists = list.indexes?.some((i) => i.name === NAME);
    if (!exists) {
      await pc.createIndex({
        name: NAME,
        dimension: DIMENV,
        metric: "cosine",
        spec: { serverless: { cloud: CLOUD, region: REGION } },
      });
      await sleep(30000);
    }
    const base = HOST ? pc.index(NAME, HOST) : pc.index(NAME);
    index = NS === "" ? base : base.namespace(NS);

    try {
      const info = await pc.describeIndex(NAME);
      indexDim = Number(info?.dimension || DIMENV);
    } catch {
      indexDim = DIMENV;
    }

    try {
      const stats = (await index.describeIndexStats?.()) || {};
      const nsStats =
        stats.namespaces && NS in stats.namespaces ? stats.namespaces[NS] : {};
      const count = Number(nsStats?.vectorCount ?? nsStats?.vector_count ?? 0);
      console.log(
        JSON.stringify({
          ts: Date.now(),
          event: "pinecone.ready",
          index: NAME,
          ns: NS || "(blank)",
          dim: indexDim,
          count,
        })
      );
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
  return v.concat(Array(dim - v.length).fill(0));
};

const queryPinecone = async (vector, topK) => {
  const res = await index.query({ topK, vector, includeMetadata: true });
  return (res?.matches || []).map((m) => ({
    id: m.id,
    score: m.score,
    text: String(
      m.metadata?.text ||
        m.metadata?.chunk_text ||
        m.metadata?.content ||
        m.metadata?.body ||
        ""
    ),
  }));
};

export const embed = async (text) => {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
  return r.data[0].embedding;
};

export const semanticSearch = async (query, { topK = TOPK } = {}) => {
  try {
    const vec = fitDim(await embed(query), indexDim);
    return await queryPinecone(vec, topK);
  } catch (e) {
    jerr("pinecone.semanticSearchTopK", e);
    return [];
  }
};

export const buildSnippetsBlock = (query, items) =>
  items
    .map(
      (m, i) =>
        `● (${i + 1}) id=${m.id} score=${(m.score ?? 0).toFixed(
          3
        )}\n${m.text.slice(0, 800)}`
    )
    .join("\n\n");
