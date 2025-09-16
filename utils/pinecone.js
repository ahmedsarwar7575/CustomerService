import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const RAW_NS = process.env.PINECONE_NAMESPACE;
const NS = RAW_NS === "__blank__" || RAW_NS === undefined ? "" : RAW_NS;
const HOST = process.env.PINECONE_INDEX_HOST || null;
const REGION = process.env.PINECONE_REGION || "us-east-1";
const CLOUD = process.env.PINECONE_CLOUD || "aws";

// Match your model and index dim
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const MODEL_DIM = EMBED_MODEL.includes("large") ? 3072 : 1536;

const TOPK = Number(process.env.TOPK || 8);

export let index;
export let indexDim = Number(process.env.PINECONE_DIM || MODEL_DIM);

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
        dimension: indexDim || MODEL_DIM,
        metric: "cosine",
        spec: { serverless: { cloud: CLOUD, region: REGION } },
      });
      await sleep(30000);
    }
    const base = HOST ? pc.index(NAME, HOST) : pc.index(NAME);
    index = NS === "" ? base : base.namespace(NS);

    try {
      const info = await pc.describeIndex(NAME);
      indexDim = Number(info?.dimension || indexDim || MODEL_DIM);
    } catch {
      // keep env/model default
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

const queryPinecone = async (vector, topK) => {
  const res = await index.query({ topK, vector, includeMetadata: true });
  return (res?.matches || []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata || {},
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
  const v = r.data[0].embedding;
  if (v.length !== indexDim) {
    // hard fail is safer than silent pad/truncate
    throw new Error(
      `Embedding dim ${v.length} != index dim ${indexDim}. Fix EMBED_MODEL or index.`
    );
  }
  return v;
};

export const semanticSearch = async (
  query,
  { topK = TOPK, minScore = 0.0 } = {}
) => {
  try {
    const vec = await embed(query);
    const matches = await queryPinecone(vec, topK);
    return minScore > 0
      ? matches.filter((m) => (m.score ?? 0) >= minScore)
      : matches;
  } catch (e) {
    jerr("pinecone.semanticSearchTopK", e);
    return [];
  }
};

export const buildSnippetsBlock = (query, items) =>
  items
    .map(
      (m, i) =>
        `● (${i + 1}) id=${m.id} score=${(m.score ?? 0).toFixed(3)}\n${String(
          m.text
        ).slice(0, 800)}`
    )
    .join("\n\n");
