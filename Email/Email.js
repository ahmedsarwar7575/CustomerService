// controllers/gmailController.js  (ESM)
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { google } from "googleapis";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- constants / files ---
const TOKEN_PATH = path.join(__dirname, "..", "token.json"); // saved after first auth
const STATE_PATH = path.join(__dirname, "..", "gmail_state.json"); // stores lastHistoryId
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// --- OAuth client ---
const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
const gmail = () => google.gmail({ version: "v1", auth: oauth2 });

// --- helpers ---
const save = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));
const load = (p, fallback) =>
  fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
const b64urlToBuf = (s) => {
  const pad = (n) => "=".repeat((4 - (n % 4)) % 4);
  return Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/") + pad(s.length),
    "base64"
  );
};
const header = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

// --- public: initial token load (call once on server start) ---
export function bootTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.log("No tokens yet. Visit /auth once, then POST /setup-watch");
  } else {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oauth2.setCredentials(tokens);
    console.log("Tokens loaded.");
  }
}

// --- public: GET /auth → start OAuth ---
export function auth(req, res) {
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
  res.send(`Authorize this app: <a href="${url}">Google OAuth</a>`);
}

// --- public: GET /oauth2callback → finish OAuth, save token.json ---
export async function oauth2callback(req, res) {
  const { tokens } = await oauth2.getToken(req.query.code);
  oauth2.setCredentials(tokens);
  save(TOKEN_PATH, tokens);
  res.send("Authorized. You can close this tab.");
}

// --- internal: call Gmail watch on INBOX only ---
async function startWatch() {
  const resp = await gmail().users.watch({
    userId: "me",
    requestBody: {
      topicName: process.env.TOPIC, // e.g. projects/PROJECT_ID/topics/gmail-notify
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    },
  });
  const { historyId, expiration } = resp.data;
  const state = load(STATE_PATH, {});
  state.lastHistoryId = historyId;
  state.expiration = expiration;
  save(STATE_PATH, state);
  console.log(
    "[watch] armed. historyId=",
    historyId,
    "expires=",
    new Date(Number(expiration)).toISOString()
  );
}

// --- public: POST /setup-watch ---
export async function setupWatch(_req, res) {
  await startWatch();
  res.json({ ok: true });
}

// --- public: POST /gmail/push (Pub/Sub push endpoint) ---
export async function pushWebhook(req, res) {
  try {
    // In production: verify the OIDC JWT in request headers.

    const msg = req.body?.message;
    if (!msg?.data) return res.status(204).end();

    const data = JSON.parse(b64urlToBuf(msg.data).toString("utf8")); // { emailAddress, historyId }
    const incomingHistoryId = data.historyId;

    const state = load(STATE_PATH, {});
    const startHistoryId = state.lastHistoryId || incomingHistoryId;

    let pageToken;
    let maxHistoryId = startHistoryId;

    do {
      const h = await gmail().users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });

      (h.data.history || []).forEach((entry) => {
        (entry.messagesAdded || []).forEach(async ({ message }) => {
          const full = await gmail().users.messages.get({
            userId: "me",
            id: message.id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          const hs = full.data.payload?.headers || [];
          console.log(
            "NEW MAIL:",
            header(hs, "Subject") || "(no subject)",
            "| From:",
            header(hs, "From"),
            "| Date:",
            header(hs, "Date"),
            "| id:",
            full.data.id
          );
        });
      });

      if (h.data.history && h.data.history.length) {
        const last = h.data.history[h.data.history.length - 1];
        if (String(last.id) > String(maxHistoryId)) maxHistoryId = last.id;
      }
      pageToken = h.data.nextPageToken;
    } while (pageToken);

    // move cursor forward to notification's historyId
    state.lastHistoryId = incomingHistoryId;
    save(STATE_PATH, state);

    res.status(200).end();
  } catch (err) {
    console.error("push handler error:", err);
    // Still return 200 so Pub/Sub doesn't retry forever while you debug.
    res.status(200).end();
  }
}
