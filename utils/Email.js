// services/emailService.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.FROM_GMAIL,
    pass: process.env.GMAIL_PASS,
  },
});

const sendEmailFunc = async (to, subject, text) => {
  try {
    console.log("send Email called");
    const mailOptions = {
      from: process.env.FROM_GMAIL,
      to,
      subject,
      html: text,
    };

    const res = await transporter.sendMail(mailOptions);
    console.log(res);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

export default sendEmailFunc;
