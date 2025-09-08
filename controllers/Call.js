// routes/play-recording.js
import "dotenv/config";
import express from "express";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Call  from "../models/Call.js";

async function findRecordingByCallSid(callSid) {
  const call = await Call.findOne({ where: { callSid } });
  if (!call) return null;
  return call.recordingUrl; // make sure you stored the S3 key here
}

const router = express.Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.AWS_S3_BUCKET;

export const playRecording = async (req, res) => {
  try {
    const { callSid } = req.params;

    // 1) Lookup S3 key in DB
    const s3Key = await findRecordingByCallSid(callSid);
    if (!s3Key) {
      return res.status(404).json({ error: "No recording for this CallSid" });
    }

    // 2) Create signed URL (valid for 1h)
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    // 3) Return JSON with URL
    res.json({ callSid, playbackUrl: signedUrl });
  } catch (e) {
    console.error("Play API failed:", e.message);
    res.status(500).json({ error: "Internal error" });
  }
};

