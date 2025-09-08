// routes/recording-status.js
import axios from "axios";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import express from "express";

const router = express.Router();

// Set your region; e.g. "ap-south-1" (Mumbai) or whichever you use
// const REGION = process.env.AWS_REGION || "ap-south-1";
export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Use your bucket name "customersupport"
const BUCKET = process.env.AWS_S3_BUCKET || "customersupport";

router.post("/recording-status", async (req, res) => {
  try {
    const {
      RecordingSid,
      CallSid,
      RecordingStatus,
      RecordingChannels,   // "1" or "2"
      RecordingUrl         // base URL without extension
    } = req.body;

    console.log("Recording webhook:", req.body);

    if (RecordingStatus !== "completed" || !RecordingUrl) {
      return res.sendStatus(200);
    }

    // Build Twilio media URL (.mp3) and request dual channels if applicable
    const asMp3 = `${RecordingUrl}.mp3${RecordingChannels === "2" ? "?RequestedChannels=2" : ""}`;

    // Download from Twilio (Basic Auth: Account SID + Auth Token)
    const audioResp = await axios.get(asMp3, {
      responseType: "stream",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
      maxRedirects: 5,
    });

    // S3 key: twilio/YYYY-MM-DD/<CallSid>/<RecordingSid>.mp3
    const date = new Date().toISOString().slice(0, 10);
    const key = `twilio/${date}/${CallSid}/${RecordingSid}.mp3`;

    await new Upload({
      client: s3,
      params: {
        Bucket: BUCKET,
        Key: key,
        Body: audioResp.data,
        ContentType: "audio/mpeg",
      },
    }).done();

    console.log(`✅ Uploaded: s3://${BUCKET}/${key}`);
    res.sendStatus(200);
  } catch (err) {
    console.error("S3 upload failed:", err?.response?.status || "", err?.message);
    res.sendStatus(200); // acknowledge so Twilio doesn't retry forever
  }
});

export default router;
