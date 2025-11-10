// controllers/gmailController.js  (ESM, no filesystem writes)
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN; // <-- set this in Render's env
const TOPIC = process.env.TOPIC; // projects/XYZ/topics/gmail-notify

// In-memory cursor (ephemeral)
let lastHistoryId = null;

// OAuth client
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const gmail = () => google.gmail({ version: "v1", auth: oauth2 });

// utils
const b64urlToStr = (s) => {
  if (!s) return "";
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64"
  ).toString("utf8");
};
const header = (hs, name) =>
  hs?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

function extractText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data)
    return b64urlToStr(payload.body.data);
  if (payload.parts?.length) {
    const plain = payload.parts.find(
      (p) => p.mimeType === "text/plain" && p.body?.data
    );
    if (plain) return b64urlToStr(plain.body.data);
    for (const part of payload.parts) {
      const inner = extractText(part);
      if (inner) return inner;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = b64urlToStr(payload.body.data);
    return html.replace(/<[^>]+>/g, "").trim();
  }
  return "";
}

// Boot tokens on server start
export function bootTokens() {
  if (REFRESH_TOKEN) {
    oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
    console.log("✓ Using REFRESH_TOKEN from env (no files).");
  } else {
    console.warn(
      "⚠ No REFRESH_TOKEN set. Run /auth locally to obtain one, then add to Render env."
    );
  }
}

// OAuth routes (use locally to obtain REFRESH_TOKEN once)
export function auth(_req, res) {
  if (!REDIRECT_URI) return res.status(500).send("Missing GOOGLE_REDIRECT_URI");
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  console.log("[auth] redirect_uri =", REDIRECT_URI);
  res.redirect(url);
}

export async function oauth2callback(req, res) {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    const { tokens } = await oauth2.getToken({
      code,
      redirect_uri: REDIRECT_URI,
    });
    // Show refresh_token one time so you can paste it into Render's env
    // (Do this on your local machine, not on public Render.)
    res.send(`
      <h3>Copy your REFRESH_TOKEN</h3>
      <pre style="white-space:pre-wrap">${
        tokens.refresh_token ||
        "(no refresh_token returned; try removing app access and re-consenting)"
      }</pre>
      <p>Set this in Render → Environment as REFRESH_TOKEN (keep Client ID/Secret too).</p>
    `);
  } catch (e) {
    console.error("oauth2callback error:", e?.response?.data || e);
    res.status(500).send("Auth error. Check logs.");
  }
}

// Watch (INBOX only)
async function startWatch() {
  const resp = await gmail().users.watch({
    userId: "me",
    requestBody: {
      topicName: TOPIC, // projects/..../topics/gmail-notify
      labelIds: ["INBOX"],
      labelFilterAction: "include", // include ONLY INBOX events
    },
  });
  lastHistoryId = resp.data.historyId || null;
  console.log(
    "[watch] armed. historyId=",
    lastHistoryId,
    "expires=",
    new Date(Number(resp.data.expiration)).toISOString()
  );
}

export async function setupWatch(_req, res) {
  try {
    await startWatch();
    res.json({ ok: true, historyId: lastHistoryId });
  } catch (e) {
    console.error("setupWatch error:", e?.response?.data || e);
    res.status(500).json({ error: "setup-watch failed" });
  }
}

// Pub/Sub push
export async function pushWebhook(req, res) {
  try {
    const msg = req.body?.message;
    if (!msg?.data) return res.status(204).end();

    const data = JSON.parse(b64urlToStr(msg.data)); // { emailAddress, historyId }
    console.log("[push] received", data);

    const incomingHistoryId = data.historyId;
    const startHistoryId = lastHistoryId || incomingHistoryId;

    let pageToken;
    let found = 0;

    do {
      const h = await gmail().users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });

      for (const entry of h.data.history || []) {
        for (const { message } of entry.messagesAdded || []) {
          const full = await gmail().users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });
          const hs = full.data.payload?.headers || [];
          const subject = header(hs, "Subject") || "(no subject)";
          const from = header(hs, "From");
          const date = header(hs, "Date");
          const body = (
            extractText(full.data.payload) ||
            full.data.snippet ||
            ""
          ).trim();
          const preview =
            body.length > 4000 ? body.slice(0, 4000) + " ...[truncated]" : body;

          console.log(
            "\n===== NEW MAIL =====================================",
            `\nSubject: ${subject}`,
            `\nFrom   : ${from}`,
            `\nDate   : ${date}`,
            `\nID     : ${full.data.id}`,
            `\n----- Body (decoded) -----\n${preview}`,
            "\n====================================================\n"
          );
          found++;
        }
      }
      pageToken = h.data.nextPageToken;
    } while (pageToken);

    lastHistoryId = incomingHistoryId; // advance in-memory cursor

    if (!found) console.log("[push] no messageAdded since", startHistoryId);

    res.status(200).end();
  } catch (err) {
    console.error("push handler error:", err?.response?.data || err);
    res.status(200).end(); // ack anyway so Pub/Sub backs off
  }
}

// tiny debug helpers
export function debugState(_req, res) {
  res.json({ lastHistoryId, hasRefreshToken: !!REFRESH_TOKEN });
}
export async function debugPullNow(_req, res) {
  try {
    if (!lastHistoryId)
      return res
        .status(400)
        .json({ error: "No history cursor yet. POST /setup-watch first." });
    let pageToken,
      fetched = 0;
    do {
      const h = await gmail().users.history.list({
        userId: "me",
        startHistoryId: lastHistoryId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const entry of h.data.history || []) {
        for (const { message } of entry.messagesAdded || []) {
          fetched++;
          const full = await gmail().users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });
          const hs = full.data.payload?.headers || [];
          console.log(
            "PULL NOW →",
            header(hs, "Subject") || "(no subject)",
            "| From:",
            header(hs, "From"),
            "| id:",
            full.data.id
          );
        }
      }
      pageToken = h.data.nextPageToken;
    } while (pageToken);
    res.json({ ok: true, fetched });
  } catch (e) {
    console.error("debugPullNow error:", e?.response?.data || e);
    res.status(500).json({ error: "pull-now failed" });
  }
}
