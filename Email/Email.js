// controllers/gmailController.js
// ESM + Render-friendly (no filesystem writes). Requires env REFRESH_TOKEN.
// Saves new emails to MySQL via Sequelize only if sender exists in users table.

import dotenv from "dotenv";
import { google } from "googleapis";
import User from "../models/user.js"; // expects users(id, email)
import { Email } from "../models/Email.js"; // maps to Emails table you created
import Ticket from "../models/ticket.js";

dotenv.config();

// ===== ENV =====
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI; // used for local /auth flow only
const REFRESH_TOKEN = process.env.REFRESH_TOKEN; // <-- set this in Render
const TOPIC = process.env.TOPIC; // projects/<GCP_PROJECT>/topics/gmail-notify

// in-memory cursor (ephemeral on Render Free)
let lastHistoryId = null;

// ===== GOOGLE AUTH =====
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const gmail = () => google.gmail({ version: "v1", auth: oauth2 });

// ===== UTILS =====
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
const parseAddress = (fromHeader = "") => {
  const m = fromHeader.match(/<([^>]+)>/);
  const addr = (m ? m[1] : fromHeader).trim().toLowerCase();
  return addr.replace(/^"(.+)"$/, "$1");
};

// recursively pull the best text/plain, fall back to stripped HTML/snippet
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

// ===== BOOT =====
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

// ===== OAUTH (use locally to obtain REFRESH_TOKEN once) =====
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
    res.send(`
      <h3>Copy your REFRESH_TOKEN</h3>
      <pre style="white-space:pre-wrap">${
        tokens.refresh_token ||
        "(no refresh_token returned; remove app access and try again with prompt=consent)"
      }</pre>
      <p>Set this as REFRESH_TOKEN in your Render Environment.</p>
    `);
  } catch (e) {
    console.error("oauth2callback error:", e?.response?.data || e);
    res.status(500).send("Auth error. Check logs.");
  }
}

// ===== WATCH (INBOX only) =====
async function startWatch() {
  const resp = await gmail().users.watch({
    userId: "me",
    requestBody: {
      topicName: TOPIC, // projects/<id>/topics/gmail-notify
      labelIds: ["INBOX"],
      labelFilterAction: "include",
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

// ===== PUSH WEBHOOK (Pub/Sub) =====
export async function pushWebhook(req, res) {
  try {
    const msg = req.body?.message;
    if (!msg?.data) return res.status(204).end();

    const data = JSON.parse(b64urlToStr(msg.data)); // { emailAddress, historyId }
    console.log("[push] received", data);

    const incomingHistoryId = data.historyId;
    const startId = lastHistoryId || incomingHistoryId;

    let pageToken;
    let found = 0;

    do {
      const h = await gmail().users.history.list({
        userId: "me",
        startHistoryId: startId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });

      for (const entry of h.data.history || []) {
        for (const { message } of entry.messagesAdded || []) {
          // fetch full to decode body
          const full = await gmail().users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });

          const hs = full.data.payload?.headers || [];
          const subject = header(hs, "Subject") || "(no subject)";
          const from = header(hs, "From");
          const dateHdr = header(hs, "Date");
          const body = (
            extractText(full.data.payload) ||
            full.data.snippet ||
            ""
          ).trim();
          const sender = parseAddress(from);

          // 1) check if sender exists in users table
          const user = await User.findOne({ where: { email: sender } });

          if (!user) {
            console.log(
              "[skip] sender not in users:",
              sender,
              "| subject:",
              subject
            );
          } else {
            // 2) save email (idempotent by Gmail message id)
            await Email.findOrCreate({
              where: { id: full.data.id },
              defaults: {
                subject,
                from,
                date: new Date(dateHdr),
                body,
                userId: user.id,
                isRecieved: true,
                to: "info@getpiepay.com",
              },
            });
            const isTicket = await Ticket.findAll({
              where: { userId: user?.id, status: "open" },
            });
            if (isTicket.length === 0) {
              await Ticket.create({
                userId: user?.id,
                status: "open",
                ticketType: "support",
                priority: "medium",
                summary: "Ticket Generated from New Email",
              });
            }
            // 3) log saved email
            const preview =
              body.length > 1000
                ? body.slice(0, 1000) + " ...[truncated]"
                : body;
            console.log(
              "\n===== SAVED EMAIL ==================================",
              `\nUserId : ${user.id} (${sender})`,
              `\nId     : ${full.data.id}`,
              `\nSubject: ${subject}`,
              `\nFrom   : ${from}`,
              `\nDate   : ${dateHdr}`,
              `\n----- Body (first 1000 chars) -----\n${preview}`,
              "\n====================================================\n"
            );
          }

          found++;
        }
      }

      pageToken = h.data.nextPageToken;
    } while (pageToken);

    // advance in-memory cursor
    lastHistoryId = incomingHistoryId;

    if (!found) console.log("[push] no messageAdded since", startId);

    res.status(200).end();
  } catch (err) {
    console.error("push handler error:", err?.response?.data || err);
    // Ack anyway so Pub/Sub backs off; you can inspect logs.
    res.status(200).end();
  }
}

// ===== DEBUG =====
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
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          const hs = full.data.payload?.headers || [];
          console.log(
            "PULL NOW →",
            header(hs, "Subject") || "(no subject)",
            "| From:",
            header(hs, "From"),
            "| Date:",
            header(hs, "Date"),
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
