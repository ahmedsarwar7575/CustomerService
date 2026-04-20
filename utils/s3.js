import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;

export const uploadAudioToS3 = async (file) => {
  if (!file?.path) {
    throw new Error("Recording file path is missing");
  }

  const fileBuffer = await fs.readFile(file.path);
  const ext = path.extname(file.originalname || "") || ".mp3";
  const key = `manual-calls/${Date.now()}-${crypto.randomUUID()}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: file.mimetype || "audio/mpeg",
      ContentLength: file.size,
    })
  );

  return { key };
};

export const getAudioSignedUrl = async (s3Key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  return getSignedUrl(s3, command, { expiresIn: 3600 });
};