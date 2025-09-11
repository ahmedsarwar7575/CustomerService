// utils/query-check.js
import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NAME = process.env.PINECONE_INDEX || "ai-chatbot";
const RAW_NS = process.env.PINECONE_NAMESPACE;
const NS = (RAW_NS === "__blank__" || RAW_NS === undefined) ? "" : RAW_NS;
const HOST = process.env.PINECONE_INDEX_HOST || null;
const MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-ada-002";
const TOPK = Number(process.env.TOPK || 6);

const base = HOST ? pc.index(NAME, HOST) : pc.index(NAME);
const index = NS === "" ? base : base.namespace(NS);

const q = process.argv.slice(2).join(" ") || "Tell me about the POS";
const emb = await openai.embeddings.create({ model: MODEL, input: q });
const info = await pc.describeIndex(NAME).catch(()=>({}));
const dim = Number(info?.dimension || 2048);
const fit = (v)=> v.length===dim ? v : v.length>dim ? v.slice(0,dim) : v.concat(Array(dim-v.length).fill(0));

const res = await index.query({ topK: TOPK, vector: fit(emb.data[0].embedding), includeMetadata: true });
console.log(JSON.stringify({
  index: NAME,
  ns: (NS || "(blank)"),
  matches: (res.matches||[]).map(m=>({id:m.id, score:m.score, preview: String(m.metadata?.text||"").slice(0,140)}))
}, null, 2));
