import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { Email } from "../models/Email.js";
import sendEmailFunc from "../utils/Email.js";

export async function sendEmail(req, res) {
  try {
    const { email, subject, body, userId } = req.body || {};
    if (!email)
      return res.status(400).json({ error: "email (recipient) is required" });
    await sendEmailFunc(email, subject, body);

    const id = randomUUID();
    try {
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
    } catch {
      return res.status(207).json({
        warning: "Email sent, but failed to save record",
      });
    }

    return res.json({
      message: "Email sent successfully",
      id,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: err?.message || "Unknown server error" });
  }
}

export default sendEmail;
