// routes/play-recording.js
import "dotenv/config";
import express from "express";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Call  from "../models/Call.js";
import { Op } from 'sequelize';
import User from "../models/user.js";
import Ticket from "../models/ticket.js";
const PER_PAGE = 10;
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

export const getAllCalls = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const { type, userId, ticketId, search } = req.query;
    const where = {};

    if (type) where.type = type;
    if (userId) where.userId = Number(userId);
    if (ticketId) where.ticketId = Number(ticketId);
    if (search) where.summary = { [Op.iLike || Op.substring]: `%${search}%` };

    const offset = (page - 1) * PER_PAGE;

    const { rows, count } = await Call.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: PER_PAGE,
      offset,
    });

    const callsWithUsers = await Promise.all(
      rows.map(async (call) => {
        let userIdField = call.userId;
        if (call.userId) {
          const user = await User.findOne({
            where: { id: call.userId },
            attributes: ["id", "name", "email", "phone"],
          });
          userIdField = user;
        }
        return {
          ...call.toJSON(),
          userId: userIdField,
        };
      })
    );

    const totalPages = Math.max(Math.ceil(count / PER_PAGE), 1);

    res.json({
      data: callsWithUsers,
      meta: {
        page,
        perPage: PER_PAGE,
        total: count,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch calls.' });
  }
};

export const getCallById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id parameter.' });
    }

    const call = await Call.findByPk(id);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    let userIdField = call.userId;
    if (call.userId) {
      const user = await User.findOne({
        where: { id: call.userId },
        attributes: ["id", "name", "email", "phone"],
      });
      userIdField = user;
    }

    res.json({
      data: {
        ...call.toJSON(),
        userId: userIdField,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch the call.' });
  }
};

export const getAllCallsForAgent = async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return res.status(400).json({ error: 'Invalid id parameter.' });
    }

    // Get all tickets assigned to this agent
    const tickets = await Ticket.findAll({
      where: { agentId },
    });

    if (tickets.length === 0) {
      return res.status(404).json({ error: "No tickets found for this agent." });
    }

    // Extract ticketIds and userIds
    const ticketIds = tickets.map(t => t.id);
    const userIds = tickets.map(t => t.userId).filter(Boolean);

    // Find calls related to those tickets OR users
    const calls = await Call.findAll({
      where: {
        [Op.or]: [
          { ticketId: ticketIds },
          { userId: userIds }
        ]
      },
      include: [
        {
          model: User,
          attributes: ["id", "name", "email", "phone"],
        },
        {
          model: Ticket,
        },
      ],
    });

    res.json(calls);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch calls." });
  }
};

export const deleteCall = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id parameter.' });
    }

    const call = await Call.findByPk(id);
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' });
    }

    await call.destroy();
    res.json({ message: 'Call deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete the call.' });
  }
};