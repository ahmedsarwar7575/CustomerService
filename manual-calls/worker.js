import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import OpenAI from "openai";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";
import {
  finalizeManualCallProcessing,
  markManualCallProcessingFailed,
  updateCallRecordingMeta,
} from "./service.js";
import {
  MANUAL_CALL_ANALYSIS_SCHEMA,
  MANUAL_CALL_ANALYSIS_SYSTEM,
} from "./prompt.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

const BUCKET = process.env.AWS_S3_BUCKET || "customersupport";
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

function str(value) {
  return String(value || "").trim();
}

function buildRecordingDownloadUrl(recordingUrl, recordingChannels) {
  let url = str(recordingUrl);

  if (!url) {
    throw new Error("Recording URL is missing.");
  }

  if (!/\.mp3(\?|$)/i.test(url)) {
    url = `${url}.mp3`;
  }

  if (String(recordingChannels) === "2" && !url.includes("RequestedChannels=2")) {
    url += url.includes("?") ? "&RequestedChannels=2" : "?RequestedChannels=2";
  }

  return url;
}

function buildTempFilePath(callSid, recordingSid) {
  const safeCallSid = str(callSid).replace(/[^\w.-]/g, "_");
  const safeRecordingSid = str(recordingSid).replace(/[^\w.-]/g, "_");
  return path.join(os.tmpdir(), `${safeCallSid}_${safeRecordingSid}.mp3`);
}

async function downloadRecordingToTemp({
  recordingUrl,
  recordingChannels,
  tempPath,
}) {
  const accountSid = str(process.env.TWILIO_ACCOUNT_SID);
  const authToken = str(process.env.TWILIO_AUTH_TOKEN);

  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing.");
  }

  const url = buildRecordingDownloadUrl(recordingUrl, recordingChannels);

  const response = await axios.get(url, {
    responseType: "stream",
    auth: {
      username: accountSid,
      password: authToken,
    },
    maxRedirects: 5,
    timeout: 60000,
  });

  await pipeline(response.data, fs.createWriteStream(tempPath));

  const stats = await fs.promises.stat(tempPath);

  if (stats.size === 0) {
    throw new Error("Downloaded recording file is empty.");
  }

  return {
    tempPath,
    size: stats.size,
  };
}

async function uploadToS3({ callSid, recordingSid, tempPath }) {
  const date = new Date().toISOString().slice(0, 10);
  const key = `manual-calls/${date}/${callSid}/${recordingSid}.mp3`;

  await new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: fs.createReadStream(tempPath),
      ContentType: "audio/mpeg",
    },
  }).done();

  return key;
}

async function transcribeAudio(tempPath) {
  const stats = await fs.promises.stat(tempPath);

  if (stats.size > MAX_TRANSCRIPTION_BYTES) {
    throw new Error(
      "Recording is larger than 25MB and cannot be sent directly to OpenAI transcription. Split long recordings first."
    );
  }

  const result = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempPath),
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
  });

  const text = typeof result === "string" ? result : result?.text || "";

  if (!str(text)) {
    throw new Error("Transcription returned empty text.");
  }

  return text.trim();
}

function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const outputs = Array.isArray(response?.output) ? response.output : [];

  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  throw new Error("OpenAI analysis response did not contain text output.");
}

async function analyzeTranscript(transcriptText) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: MANUAL_CALL_ANALYSIS_SYSTEM }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Analyze this manual call transcript:\n\n${transcriptText}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "manual_call_analysis",
        strict: true,
        schema: MANUAL_CALL_ANALYSIS_SCHEMA,
      },
    },
  });

  const text = extractResponseText(response);
  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI analysis returned invalid JSON.");
  }

  return parsed;
}

async function cleanupTempFile(tempPath) {
  if (!tempPath) return;

  try {
    await fs.promises.unlink(tempPath);
  } catch {}
}

export async function runPostCallPipeline({
  callSid,
  recordingSid,
  recordingUrl,
  recordingChannels,
  recordingDuration,
  recordingStatus,
}) {
  const tempPath = buildTempFilePath(callSid, recordingSid);

  try {
    await updateCallRecordingMeta(callSid, {
      recordingSid,
      recordingStatus,
      recordingDurationSeconds: recordingDuration || null,
      recordingChannels: recordingChannels || null,
      transcriptionStatus: "processing",
      analysisStatus: "pending",
    });

    await downloadRecordingToTemp({
      recordingUrl,
      recordingChannels,
      tempPath,
    });

    const s3Key = await uploadToS3({
      callSid,
      recordingSid,
      tempPath,
    });

    await updateCallRecordingMeta(callSid, {
      s3Key,
      transcriptionStatus: "processing",
      analysisStatus: "pending",
    });

    const transcriptText = await transcribeAudio(tempPath);

    await updateCallRecordingMeta(callSid, {
      transcriptionStatus: "completed",
      analysisStatus: "processing",
    });

    const analysis = await analyzeTranscript(transcriptText);

    const result = await finalizeManualCallProcessing({
      callSid,
      s3Key,
      transcriptText,
      analysis,
      recordingMeta: {
        recordingSid,
        recordingStatus,
        recordingDuration,
        recordingChannels,
      },
    });

    return {
      success: true,
      callSid,
      ...result,
    };
  } catch (error) {
    const stage =
      /transcription/i.test(error?.message || "")
        ? "transcription"
        : /analysis/i.test(error?.message || "")
        ? "analysis"
        : "pipeline";

    await markManualCallProcessingFailed(callSid, stage, error);

    throw error;
  } finally {
    await cleanupTempFile(tempPath);
  }
}