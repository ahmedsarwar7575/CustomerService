import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import Call from '../models/Call.js';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.AWS_S3_BUCKET;

export default async function getRecordingUrlBySid(req, res) {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const call = await Call.findOne({ where: { id } });
    if (!call) return res.status(404).json({ error: 'call not found' });
    if (!call.recordingUrl) return res.status(404).json({ error: 'recording not available' });
    if (!BUCKET) return res.status(500).json({ error: 'AWS_S3_BUCKET not set' });

    let ttlSec = parseInt(req.query.ttlSec || '3600', 10);
    if (!Number.isFinite(ttlSec)) ttlSec = 3600;
    ttlSec = Math.min(Math.max(ttlSec, 60), 604800);

    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key: call.recordingUrl, // e.g. twilio/2025-10-31/CA.../RE....mp3
      ResponseContentType: 'audio/mpeg',
      ResponseContentDisposition: `inline; filename="${call.sid}.mp3"`,
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: ttlSec });
    return res.json({ url, expiresIn: ttlSec });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
