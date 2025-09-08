// routes/recording-status.js
import axios from "axios";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import express from "express";
import  Call  from "../models/Call.js";
const router = express.Router();

// S3 client with explicit creds
export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Your bucket name
const BUCKET = process.env.AWS_S3_BUCKET || "customersupport";

router.post("/recording-status", async (req, res) => {
  try {
    const {
      RecordingSid,
      CallSid,
      RecordingStatus,
      RecordingChannels,
      RecordingUrl
    } = req.body;

    console.log("Recording webhook:", req.body);

    if (RecordingStatus !== "completed" || !RecordingUrl) {
      return res.sendStatus(200);
    }

    // Twilio recording URL
    const asMp3 = `${RecordingUrl}.mp3${RecordingChannels === "2" ? "?RequestedChannels=2" : ""}`;

    // Download from Twilio
    const audioResp = await axios.get(asMp3, {
      responseType: "stream",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
      maxRedirects: 5,
    });

    // Choose S3 key
    const date = new Date().toISOString().slice(0, 10);
    const key = `twilio/${date}/${CallSid}/${RecordingSid}.mp3`;

    // Upload to S3
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
    const call = await Call.findOne({ where: { callSid: CallSid } });
    call.recordingUrl = key;
    await call.save();
    // Generate a presigned URL valid for 1 hour
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    console.log("🎧 Playable link:", signedUrl);

    // Respond to Twilio (they don't need the URL, but you can also return it for debugging)
    res.json({ success: true, playbackUrl: signedUrl });
  } catch (err) {
    console.error("S3 upload failed:", err?.response?.status || "", err?.message);
    res.sendStatus(200);
  }
});

export default router;
