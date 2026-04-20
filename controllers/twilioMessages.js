import dotenv from "dotenv";
import twilio from "twilio";
import axios from "axios";
import { Op } from "sequelize";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import TwilioMessage from "../models/twilioMessage.js";
import TwilioMessageMedia from "../models/twilioMessageMedia.js";
import { getIo } from "../socket.js";

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const getEmptyTwiml = () => {
  const twiml = new twilio.twiml.MessagingResponse();
  return twiml.toString();
};

const getTwilioMediaAuth = () => {
  if (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) {
    return {
      username: process.env.TWILIO_API_KEY_SID,
      password: process.env.TWILIO_API_KEY_SECRET,
    };
  }

  return {
    username: process.env.TWILIO_ACCOUNT_SID,
    password: process.env.TWILIO_AUTH_TOKEN,
  };
};

const normalizeBaseUrl = (req) => {
  const envBase = process.env.PUBLIC_BASE_URL?.trim();
  if (envBase) {
    return envBase.replace(/\/$/, "");
  }
  return `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
};

const inferFileName = (mediaSid, contentType, fallbackName) => {
  if (fallbackName) return fallbackName;
  const extension =
    contentType?.split("/")[1]?.split(";")[0]?.trim()?.toLowerCase() || "bin";
  return mediaSid ? `${mediaSid}.${extension}` : `attachment.${extension}`;
};

const extractMediaSid = (mediaUrl) => {
  try {
    const url = new URL(mediaUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
};

const emitToSmsRoom = (userId, event, payload) => {
  if (!userId) return;

  try {
    getIo().to(`sms:user:${userId}`).emit(event, payload);
  } catch (error) {
    console.error("Socket emit error:", error.message);
  }
};

export const sendSmsMessage = async (req, res) => {
  try {
    const { userId, agentId: bodyAgentId, body } = req.body;

    const agentId = bodyAgentId || req.user?.id || null;
    const messageBody = typeof body === "string" ? body.trim() : "";
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!messageBody && uploadedFiles.length === 0) {
      return res
        .status(400)
        .json({ error: "Message body or at least one media file is required" });
    }

    if (!process.env.TWILIO_SMS_FROM) {
      return res
        .status(500)
        .json({ error: "TWILIO_SMS_FROM is not configured in .env" });
    }

    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "phone", "email"],
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.phone) {
      return res
        .status(400)
        .json({ error: "User does not have a phone number" });
    }

    let agent = null;

    if (agentId) {
      agent = await Agent.findByPk(agentId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }
    }

    const baseUrl = normalizeBaseUrl(req);
    const publicMediaUrls = uploadedFiles.map(
      (file) => `${baseUrl}/uploads/mms/${file.filename}`
    );

    const twilioPayload = {
      from: process.env.TWILIO_SMS_FROM,
      to: user.phone,
    };

    if (messageBody) {
      twilioPayload.body = messageBody;
    }

    if (publicMediaUrls.length) {
      twilioPayload.mediaUrl = publicMediaUrls;
    }

    if (process.env.TWILIO_SMS_STATUS_CALLBACK_URL) {
      twilioPayload.statusCallback = process.env.TWILIO_SMS_STATUS_CALLBACK_URL;
    }

    const twilioResponse = await client.messages.create(twilioPayload);

    const savedMessage = await TwilioMessage.create({
      userId: user.id,
      agentId: agent?.id || null,
      twilioMessageSid: twilioResponse.sid,
      direction: "outbound",
      fromNumber: process.env.TWILIO_SMS_FROM,
      toNumber: user.phone,
      body: messageBody || "",
      status: twilioResponse.status || "queued",
      hasMedia: publicMediaUrls.length > 0,
      numMedia: publicMediaUrls.length,
      sentAt: twilioResponse.dateCreated
        ? new Date(twilioResponse.dateCreated)
        : new Date(),
      receivedAt: null,
      deliveredAt:
        twilioResponse.status === "delivered" && twilioResponse.dateSent
          ? new Date(twilioResponse.dateSent)
          : null,
      errorCode: twilioResponse.errorCode || null,
      errorMessage: twilioResponse.errorMessage || null,
    });

    if (uploadedFiles.length) {
      await TwilioMessageMedia.bulkCreate(
        uploadedFiles.map((file, index) => ({
          twilioMessageId: savedMessage.id,
          mediaSid: null,
          mediaUrl: publicMediaUrls[index],
          contentType: file.mimetype || "application/octet-stream",
          fileName: file.originalname || file.filename,
        }))
      );
    }

    const media = await TwilioMessageMedia.findAll({
      where: { twilioMessageId: savedMessage.id },
      order: [["id", "ASC"]],
    });

    const enrichedSms = {
      ...savedMessage.toJSON(),
      user: user.toJSON(),
      agent: agent ? agent.toJSON() : null,
      media: media.map((item) => item.toJSON()),
    };

    emitToSmsRoom(user.id, "sms:new", enrichedSms);

    return res.status(201).json({
      message: "SMS sent successfully",
      sms: enrichedSms,
      twilio: {
        sid: twilioResponse.sid,
        status: twilioResponse.status,
        to: twilioResponse.to,
        from: twilioResponse.from,
      },
    });
  } catch (error) {
    console.error("sendSmsMessage error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Failed to send SMS",
    });
  }
};

export const getMessagesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const user = await User.findByPk(userId, {
      attributes: ["id", "name", "phone", "email"],
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const messages = await TwilioMessage.findAll({
      where: { userId: Number(userId) },
      order: [["createdAt", "ASC"]],
    });

    const messageIds = messages.map((message) => message.id);

    const mediaRows = messageIds.length
      ? await TwilioMessageMedia.findAll({
          where: {
            twilioMessageId: {
              [Op.in]: messageIds,
            },
          },
          order: [["id", "ASC"]],
        })
      : [];

    const agentIds = [
      ...new Set(messages.map((msg) => msg.agentId).filter(Boolean)),
    ];

    const agents = agentIds.length
      ? await Agent.findAll({
          where: { id: agentIds },
          attributes: ["id", "firstName", "lastName", "email"],
        })
      : [];

    const agentMap = new Map(agents.map((agent) => [agent.id, agent.toJSON()]));
    const mediaMap = new Map();

    mediaRows.forEach((media) => {
      const mediaJson = media.toJSON();
      if (!mediaMap.has(mediaJson.twilioMessageId)) {
        mediaMap.set(mediaJson.twilioMessageId, []);
      }
      mediaMap.get(mediaJson.twilioMessageId).push(mediaJson);
    });

    const userJson = user.toJSON();

    const enrichedMessages = messages.map((message) => ({
      ...message.toJSON(),
      user: userJson,
      agent: message.agentId ? agentMap.get(message.agentId) || null : null,
      media: mediaMap.get(message.id) || [],
    }));

    return res.status(200).json({
      message: "Messages fetched successfully",
      user: userJson,
      messages: enrichedMessages,
    });
  } catch (error) {
    console.error("getMessagesByUserId error:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch messages",
    });
  }
};

export const handleTwilioMessageStatus = async (req, res) => {
  try {
    const { MessageSid, MessageStatus, ErrorCode } = req.body;

    if (!MessageSid) {
      return res.sendStatus(200);
    }

    const sms = await TwilioMessage.findOne({
      where: { twilioMessageSid: MessageSid },
    });

    if (!sms) {
      return res.sendStatus(200);
    }

    const updates = {
      status: MessageStatus || sms.status,
      errorCode: ErrorCode ? Number(ErrorCode) : sms.errorCode,
    };

    if (MessageStatus === "sent" && !sms.sentAt) {
      updates.sentAt = new Date();
    }

    if (MessageStatus === "delivered") {
      updates.deliveredAt = new Date();
    }

    if (
      (MessageStatus === "failed" || MessageStatus === "undelivered") &&
      !sms.errorMessage
    ) {
      updates.errorMessage = "Message failed or was undelivered";
    }

    await sms.update(updates);

    emitToSmsRoom(sms.userId, "sms:status", {
      id: sms.id,
      twilioMessageSid: sms.twilioMessageSid,
      status: updates.status,
      errorCode: updates.errorCode,
      errorMessage: updates.errorMessage || sms.errorMessage || null,
      deliveredAt: updates.deliveredAt || sms.deliveredAt || null,
      sentAt: updates.sentAt || sms.sentAt || null,
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error("handleTwilioMessageStatus error:", error);
    return res.sendStatus(200);
  }
};

export const handleIncomingSms = async (req, res) => {
  try {
    const { MessageSid, From, To, Body, NumMedia } = req.body;

    if (!MessageSid || !From || !To) {
      return res.status(200).type("text/xml").send(getEmptyTwiml());
    }

    const existingMessage = await TwilioMessage.findOne({
      where: { twilioMessageSid: MessageSid },
    });

    if (existingMessage) {
      return res.status(200).type("text/xml").send(getEmptyTwiml());
    }

    const user = await User.findOne({
      where: { phone: From },
      attributes: ["id", "name", "phone", "email"],
    });

    const mediaCount = Number(NumMedia || 0);

    const savedMessage = await TwilioMessage.create({
      userId: user?.id || null,
      agentId: null,
      twilioMessageSid: MessageSid,
      direction: "inbound",
      fromNumber: From,
      toNumber: To,
      body: Body || "",
      status: "received",
      hasMedia: mediaCount > 0,
      numMedia: mediaCount,
      sentAt: null,
      receivedAt: new Date(),
      deliveredAt: null,
      errorCode: null,
      errorMessage: null,
    });

    if (mediaCount > 0) {
      const mediaItems = [];

      for (let i = 0; i < mediaCount; i += 1) {
        const mediaUrl = req.body[`MediaUrl${i}`];
        const contentType = req.body[`MediaContentType${i}`];

        if (!mediaUrl || !contentType) {
          continue;
        }

        const mediaSid = extractMediaSid(mediaUrl);

        mediaItems.push({
          twilioMessageId: savedMessage.id,
          mediaSid,
          mediaUrl,
          contentType,
          fileName: inferFileName(mediaSid, contentType),
        });
      }

      if (mediaItems.length) {
        await TwilioMessageMedia.bulkCreate(mediaItems);
      }
    }

    if (user?.id) {
      const media = await TwilioMessageMedia.findAll({
        where: { twilioMessageId: savedMessage.id },
        order: [["id", "ASC"]],
      });

      emitToSmsRoom(user.id, "sms:new", {
        ...savedMessage.toJSON(),
        user: user.toJSON(),
        agent: null,
        media: media.map((item) => item.toJSON()),
      });
    }

    return res.status(200).type("text/xml").send(getEmptyTwiml());
  } catch (error) {
    console.error("handleIncomingSms error:", error);
    return res.status(200).type("text/xml").send(getEmptyTwiml());
  }
};

export const streamMessageMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;
    const download = req.query.download === "1";

    const media = await TwilioMessageMedia.findByPk(mediaId);

    if (!media) {
      return res.status(404).json({ error: "Media not found" });
    }

    const isTwilioHostedMedia =
      typeof media.mediaUrl === "string" &&
      media.mediaUrl.includes("api.twilio.com");

    if (!isTwilioHostedMedia) {
      const normalizedBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
      if (
        normalizedBase &&
        typeof media.mediaUrl === "string" &&
        media.mediaUrl.startsWith(normalizedBase)
      ) {
        return res.redirect(media.mediaUrl + (download ? "?download=1" : ""));
      }

      return res.redirect(media.mediaUrl);
    }

    const mediaResponse = await axios.get(media.mediaUrl, {
      responseType: "stream",
      auth: getTwilioMediaAuth(),
    });

    const contentType =
      media.contentType ||
      mediaResponse.headers["content-type"] ||
      "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${
        media.fileName || `attachment-${media.id}`
      }"`
    );

    mediaResponse.data.pipe(res);
  } catch (error) {
    console.error("streamMessageMedia error:", error);
    return res.status(500).json({ error: "Failed to load media" });
  }
};
