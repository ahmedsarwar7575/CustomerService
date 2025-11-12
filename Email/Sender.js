// services/sendEmail.js (ESM, single-file drop-in)
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { Email } from "../models/Email.js";

/**
 * Required env vars (Render → Environment):
 *   GMAIL_USER = the exact Gmail/Workspace address that created the App Password
 *   GMAIL_PASS = the 16-char App Password (no spaces)
 * Optional:
 *   MAIL_FROM_NAME = display name, e.g. "GetPie"
 *   MAIL_FROM_ADDRESS = use ONLY if this address is the same as GMAIL_USER or a verified "Send mail as" alias
 *   MAIL_REPLY_TO = where replies should go (falls back to MAIL_FROM_ADDRESS or GMAIL_USER)
 */

const FROM_NAME = process.env.MAIL_FROM_NAME || "GetPie";
const RAW_FROM_ADDRESS =
  process.env.MAIL_FROM_ADDRESS || process.env.GMAIL_USER || "";

/** sanitize and pick final sender */
function getFromAddress() {
  const addr = (RAW_FROM_ADDRESS || "").trim();
  if (!addr) return null;
  return addr.toLowerCase();
}

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function stripHtml(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTransport() {
  const user = must("GMAIL_USER").trim().toLowerCase();
  // Google displays app passwords with spaces; strip them
  const pass = must("GMAIL_PASS").replace(/\s+/g, "");
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

/**
 * Express handler: POST /api/send-email
 * Body: { email, subject, body, userId }
 */
export async function sendEmail(req, res) {
  try {
    const { email, subject, body, userId } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "email (recipient) is required" });
    }

    const transporter = buildTransport();

    // Catch auth/network issues early
    try {
      await transporter.verify();
    } catch (err) {
      console.error("SMTP verify failed:", err);
      return res
        .status(500)
        .json({ error: `SMTP verify failed: ${err?.message || String(err)}` });
    }

    const gmailUser = process.env.GMAIL_USER.trim().toLowerCase();
    const fromAddress = getFromAddress() || gmailUser;
    const replyTo = (
      process.env.MAIL_REPLY_TO ||
      fromAddress ||
      gmailUser
    ).toLowerCase();

    let info;
    try {
      info = await transporter.sendMail({
        from: { name: FROM_NAME, address: fromAddress },
        to: email,
        subject: subject ?? "",
        text: body ? stripHtml(body) : "",
        html: body ?? "",
        replyTo,
      });
    } catch (err) {
      console.error("sendMail error:", err);
      // Avoid leaking secrets in responses
      return res
        .status(500)
        .json({
          error: `Failed to send email: ${err?.message || String(err)}`,
        });
    }

    // Persist a record of what was sent
    const id = randomUUID();
    try {
      await Email.create({
        id,
        subject: subject ?? null,
        from: fromAddress,
        date: new Date(),
        body: body ?? null,
        userId: userId ?? null,
        isRecieved: false,
        to: email,
      });
    } catch (err) {
      console.error("DB save failed (Email.create):", err);
      // Email was sent but DB save failed—report partial success
      return res.status(207).json({
        warning: "Email sent, but failed to save record",
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      });
    }

    return res.json({
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      emailRecordId: id,
    });
  } catch (err) {
    console.error("sendEmail handler fatal error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Unknown server error" });
  }
}

export default sendEmail;
