// services/sendEmail.js (ESM)
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { Email } from "../models/Email.js";

const FROM_ADDRESS = "info@getpie.com";
const FROM_NAME = process.env.MAIL_FROM_NAME || "GetPie";

function stripHtml(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sendEmail(req, res) {
  const { email, subject, body, userId } = req.body;
  if (!email) throw new Error("email (recipient) is required");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  let info;
  try {
    info = await transporter.sendMail({
      from: { name: FROM_NAME, address: FROM_ADDRESS },
      to: email,
      subject: subject ?? "",
      text: body ? stripHtml(body) : "",
      html: body ?? "",
      replyTo: FROM_ADDRESS,
    });
  } catch (err) {
    throw new Error(`Failed to send email: ${err.message}`);
  }

  const id = randomUUID();
  await Email.create({
    id,
    subject: subject ?? null,
    from: "info@getpiepay.com",
    date: new Date(),
    body: body ?? null,
    userId: userId ?? null,
    isRecieved: false,
    to: email,
  });

  res.json({
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    emailRecordId: id,
  });
}
