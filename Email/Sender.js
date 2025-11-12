import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { Email } from "../models/Email.js";

function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function buildTransport() {
  const user = must("GMAIL_USER").trim().toLowerCase();
  const pass = must("GMAIL_PASS").replace(/\s+/g, "");
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

export async function sendEmail(req, res) {
  try {
    const { email, subject, body, userId } = req.body || {};
    if (!email) return res.status(400).json({ error: "email (recipient) is required" });

    const transporter = buildTransport();
    try {
      await transporter.verify();
    } catch (err) {
      return res.status(500).json({ error: `SMTP verify failed: ${err?.message || String(err)}` });
    }

    const fromAddress = process.env.GMAIL_USER.trim().toLowerCase();

    let info;
    try {
      info = await transporter.sendMail({
        from: { name: "GetPie", address: fromAddress },
        to: email,
        subject: subject ?? "",
        text: body ? stripHtml(body) : "",
        html: body ?? "",
        replyTo: fromAddress,
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to send email: ${err?.message || String(err)}` });
    }

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
    } catch {
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
    return res.status(500).json({ error: err?.message || "Unknown server error" });
  }
}

export default sendEmail;
