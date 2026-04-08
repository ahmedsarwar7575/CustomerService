import dotenv from "dotenv";
import twilio from "twilio";
import User from "../models/user.js";
import Agent from "../models/agent.js";
import TwilioMessage from "../models/twilioMessage.js";

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const sendSmsMessage = async (req, res) => {
  try {
    const { userId, agentId: bodyAgentId, body } = req.body;

    const agentId = bodyAgentId || req.user?.id || null;
    const messageBody = body?.trim();

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!messageBody) {
      return res.status(400).json({ error: "Message body is required" });
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
      return res.status(400).json({ error: "User does not have a phone number" });
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

    const twilioPayload = {
      from: process.env.TWILIO_SMS_FROM,
      to: user.phone,
      body: messageBody,
    };

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
      body: messageBody,
      status: twilioResponse.status || "queued",
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

    return res.status(201).json({
      message: "SMS sent successfully",
      sms: {
        ...savedMessage.toJSON(),
        user: user.toJSON(),
        agent: agent ? agent.toJSON() : null,
      },
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

    const agentIds = [...new Set(messages.map((msg) => msg.agentId).filter(Boolean))];

    const agents = agentIds.length
      ? await Agent.findAll({
          where: { id: agentIds },
          attributes: ["id", "firstName", "lastName", "email"],
        })
      : [];

    const agentMap = new Map(agents.map((agent) => [agent.id, agent.toJSON()]));
    const userJson = user.toJSON();

    const enrichedMessages = messages.map((message) => ({
      ...message.toJSON(),
      user: userJson,
      agent: message.agentId ? agentMap.get(message.agentId) || null : null,
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

    return res.sendStatus(200);
  } catch (error) {
    console.error("handleTwilioMessageStatus error:", error);
    return res.sendStatus(200);
  }
};



export const handleIncomingSms = async (req, res) => {
    try {
      const { MessageSid, From, To, Body } = req.body;
  
      if (!MessageSid || !From || !To) {
        return res
          .status(200)
          .type("text/xml")
          .send("<Response></Response>");
      }
  
      const existingMessage = await TwilioMessage.findOne({
        where: { twilioMessageSid: MessageSid },
      });
  
      if (existingMessage) {
        return res
          .status(200)
          .type("text/xml")
          .send("<Response></Response>");
      }
  
      const user = await User.findOne({
        where: { phone: From },
        attributes: ["id", "name", "phone", "email"],
      });
  
      await TwilioMessage.create({
        userId: user?.id || null,
        agentId: null,
        twilioMessageSid: MessageSid,
        direction: "inbound",
        fromNumber: From,
        toNumber: To,
        body: Body || "",
        status: "received",
        sentAt: null,
        receivedAt: new Date(),
        deliveredAt: null,
        errorCode: null,
        errorMessage: null,
      });
  
      return res
        .status(200)
        .type("text/xml")
        .send("<Response></Response>");
    } catch (error) {
      console.error("handleIncomingSms error:", error);
      return res
        .status(200)
        .type("text/xml")
        .send("<Response></Response>");
    }
  };








