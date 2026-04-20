import Ticket from "../models/ticket.js";
import Agent from "../models/agent.js";
import User from "../models/user.js";
import Call from "../models/Call.js";
import { randomUUID } from "node:crypto";
import { Email } from "../models/Email.js";
import Rating from "../models/rating.js";
import sequelize from "../config/db.js";
import Sequelize from "sequelize";
import { Op } from "sequelize";
import { uploadAudioToS3 } from "../utils/s3.js";
import { extractManualCallDataFromAudio } from "../utils/openaiCallParser.js";
const nz = (arr) => (Array.isArray(arr) ? arr : []);
// Create new ticket
const parseNullableBoolean = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
};
export const createTicket = async (req, res) => {
  let transaction;

  try {
    const {
      status,
      ticketType,
      priority,
      proposedSolution,
      isSatisfied,
      summary,
      userId,
      agentId,
      createdByAgentId,
    } = req.body;

    const recordingFile = req.file || null;
    console.log(recordingFile);
    const manualSummary = (summary || "").trim();

    const validPriorities = ["low", "medium", "high", "critical"];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: "Invalid priority value" });
    }

    const parsedUserId = Number(userId);
    const parsedAgentId = agentId ? Number(agentId) : null;
    const parsedCreatedByAgentId = createdByAgentId
      ? Number(createdByAgentId)
      : null;
    const parsedIsSatisfied = parseNullableBoolean(isSatisfied);

    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (
      parsedAgentId !== null &&
      (!Number.isInteger(parsedAgentId) || parsedAgentId <= 0)
    ) {
      return res.status(400).json({ error: "Invalid agentId" });
    }

    if (
      parsedCreatedByAgentId !== null &&
      (!Number.isInteger(parsedCreatedByAgentId) || parsedCreatedByAgentId <= 0)
    ) {
      return res.status(400).json({ error: "Invalid createdByAgentId" });
    }

    if (!recordingFile && manualSummary.length < 10) {
      return res.status(400).json({
        error:
          "Summary must be at least 10 characters when no recording is uploaded",
      });
    }

    let uploadedAudio = null;
    let aiData = null;

    if (recordingFile) {
      uploadedAudio = await uploadAudioToS3(recordingFile);

      try {
        aiData = await extractManualCallDataFromAudio(recordingFile);
      } catch (aiError) {
        console.error("Audio processing failed:", aiError.message);
        aiData = null;
      }
    }

    const finalTicketSummary =
      manualSummary || aiData?.Summary?.trim() || "Manual call ticket created";

    transaction = await sequelize.transaction();

    await Ticket.update(
      { order: sequelize.literal("`order` + 1") },
      { where: {}, transaction }
    );

    const ticket = await Ticket.create(
      {
        status: status || "open",
        ticketType: ticketType || "support",
        priority: priority || "medium",
        proposedSolution: proposedSolution?.trim() || null,
        isSatisfied: parsedIsSatisfied,
        summary: finalTicketSummary,
        userId: parsedUserId,
        agentId: parsedAgentId,
        isManual: true,
        isManualCall: true,
        createdByAgentId: parsedCreatedByAgentId,
        order: 1,
      },
      { transaction }
    );

    let call = null;

    // Only create Call when audio is uploaded
    if (recordingFile) {
      call = await Call.create(
        {
          type: "outbound",
          userId: parsedUserId,
          ticketId: ticket.id,
          QuestionsAnswers: aiData?.QuestionsAnswers || [],
          languages: aiData?.LANGUAGES || [],
          summary: aiData?.Summary || finalTicketSummary,
          recordingUrl: uploadedAudio?.key || null, // store S3 key, not signed URL
          callCategory: "manual",
          customerSatisfied: parsedIsSatisfied,
          isManualCall: true,
        },
        { transaction }
      );
    }

    await transaction.commit();

    return res.status(201).json({
      message: "Manual ticket created successfully",
      ticket,
      call,
    });
  } catch (error) {
    if (transaction) {
      await transaction.rollback();
    }

    return res.status(500).json({
      error: error.message || "Failed to create manual ticket",
    });
  }
};

// Assign ticket to agent
export const assignTicket = async (req, res) => {
  try {
    const ticketId = Number(req.params.ticketId);
    const agentId = Number(req.params.agentId);

    if (!Number.isInteger(ticketId) || !Number.isInteger(agentId)) {
      return res.status(400).json({ error: "Invalid ticketId or agentId" });
    }

    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const agent = await Agent.findByPk(agentId);
    if (!agent || !agent.isActive) {
      return res.status(404).json({ error: "Agent not found or inactive" });
    }

    await ticket.update({
      agentId,
      status: "in_progress",
    });

    res.json({
      message: "Ticket assigned successfully",
      ticketId: ticket.id,
      agentId: agent.id,
      agentName: `${agent.firstName} ${agent.lastName}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update ticket status
export const updateTicketStatus = async (req, res) => {
  try {
    const ticket = await Ticket.findByPk(req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const validStatuses = [
      "open",
      "in_progress",
      "resolved",
      "closed",
      "escalated",
    ];
    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    await ticket.update({ status: req.body.status });
    res.json({
      message: "Ticket status updated",
      ticketId: ticket.id,
      newStatus: req.body.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const updatePiority = async (req, res) => {
  try {
    const ticket = await Ticket.findByPk(req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const validPriorities = ["low", "medium", "high", "critical"];
    if (!validPriorities.includes(req.body.priority)) {
      return res.status(400).json({ error: "Invalid priority value" });
    }

    await ticket.update({ priority: req.body.priority });

    res.json({
      message: "Ticket priority updated",
      ticketId: ticket.id,
      newPriority: req.body.priority,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// Get tickets by status
export const getTicketsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const tickets = await Ticket.findAll({
      where: { status },
      include: [
        { model: Agent, attributes: ["id", "firstName", "lastName"] },
        { model: User, attributes: ["id", "name", "email"] },
      ],
      order: [["order", "ASC"]],
    });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAllTickets = async (req, res) => {
  try {
    const { type, userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const agent = await Agent.findByPk(userId);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const isAdmin = agent.role === "admin";

    const where = {};
    if (type === "manual") {
      where.isManual = true;
    } else if (type === "system") {
      where[Op.or] = [{ isManual: false }, { isManual: null }];
    }

    if (!isAdmin) {
      where.agentId = userId;
    }

    const tickets = await Ticket.findAll({
      where,
      include: [
        { model: Agent, attributes: ["id", "firstName", "lastName"] },
        { model: User, attributes: ["id", "name", "email"] },
        {
          model: Call,
          attributes: [
            "id",
            "type",
            "summary",
            "createdAt",
            "QuestionsAnswers",
          ],
        },
      ],
      order: [["order", "ASC"]],
    });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// Escalate ticket
export const escalateTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findByPk(req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Escalation logic would go here
    await ticket.update({
      status: "escalated",
      priority: "high",
    });

    res.json({
      message: "Ticket escalated successfully",
      ticketId: ticket.id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Helper function to generate unique ticket ID
function generateTicketId() {
  const words = [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Echo",
    "Foxtrot",
    "Golf",
    "Hotel",
    "India",
    "Juliet",
    "Kilo",
    "Lima",
    "Mike",
    "November",
    "Oscar",
    "Papa",
    "Quebec",
    "Romeo",
    "Sierra",
    "Tango",
    "Uniform",
    "Victor",
    "Whiskey",
    "Xray",
    "Yankee",
    "Zulu",
  ];

  const length = Math.floor(Math.random() * 6) + 5; // 5-10 words
  const ticketId = Array.from(
    { length },
    () => words[Math.floor(Math.random() * words.length)]
  ).join("-");

  return ticketId;
}
export const getticketById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id parameter." });
    }

    const ticket = await Ticket.findOne({
      where: { id },
      include: [
        { model: Agent, attributes: ["id", "firstName", "lastName"] },
        { model: User, attributes: ["id", "name", "email", "phone"] },
        {
          model: Call,
          attributes: [
            "id",
            "type",
            "summary",
            "createdAt",
            "QuestionsAnswers",
          ],
        },
      ],
    });
    if (!ticket) {
      return res.status(404).json({ error: "ticket not found." });
    }

    let emails = [];
    const userId = ticket?.User?.id ?? null;
    if (userId) {
      emails = await Email.findAll({
        where: { userId },
        attributes: [
          "id",
          "subject",
          "from",
          "date",
          "body",
          "userId",
          "isRecieved",
          "createdAt",
          "updatedAt",
        ],
        order: [
          ["date", "DESC"],
          ["createdAt", "DESC"],
        ],
      });
    }

    const data = ticket.toJSON();
    data.emails = emails.map((e) => e.toJSON());
    res.json({ data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch the ticket." });
  }
};
export const deleteTicket = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Ticket id is required" });
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    await Rating.destroy({ where: { ticketId: id } });
    await ticket.destroy();
    res.json({ message: "Ticket deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const addNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!id) return res.status(400).json({ error: "Ticket id is required" });
    if (!text) return res.status(400).json({ error: "text is required" });

    const ticket = await Ticket.findByPk(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const note = {
      id: randomUUID(),
      text: String(text).trim(),
      timestamp: new Date().toISOString(),
    };
    ticket.set("notes", [...nz(ticket.notes), note]);
    await ticket.save();

    res.json({ message: "Note added", note });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getNotes = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Ticket id is required" });
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    res.json({ notes: nz(ticket.notes) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getNoteById = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    const note = nz(ticket.notes).find((n) => n.id === noteId);
    if (!note) return res.status(404).json({ error: "Note not found" });
    res.json({ note });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const updateNoteById = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    const ticket = await Ticket.findByPk(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const notes = nz(ticket.notes);
    const i = notes.findIndex((n) => n.id === noteId);
    if (i === -1) return res.status(404).json({ error: "Note not found" });

    const updated = {
      ...notes[i],
      text: String(text).trim(),
      timestamp: new Date().toISOString(),
    };
    const next = notes.slice();
    next[i] = updated;
    ticket.set("notes", next);
    await ticket.save();

    res.json({ message: "Note updated", note: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const deleteNoteById = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const notes = nz(ticket.notes);
    if (!notes.some((n) => n.id === noteId))
      return res.status(404).json({ error: "Note not found" });

    ticket.set(
      "notes",
      notes.filter((n) => n.id !== noteId)
    );
    await ticket.save();

    res.json({ message: "Note deleted", noteId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
export const reorderAllTickets = async (req, res) => {
  const { ticketIds } = req.body;

  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    return res.status(400).json({ error: "ticketIds array required" });
  }

  const transaction = await sequelize.transaction();
  try {
    const cases = ticketIds
      .map((id, idx) => `WHEN id = ${id} THEN ${idx + 1}`)
      .join(" ");
    const idsList = ticketIds.join(",");

    await sequelize.query(
      `UPDATE tickets SET \`order\` = CASE ${cases} ELSE \`order\` END WHERE id IN (${idsList})`,
      { transaction }
    );

    await transaction.commit();
    res.json({ success: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: error.message });
  }
};

export const getPaginatedTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      priority = "",
      ticketType = "",
      agentId = "",
      sortBy = "order",
      sortOrder = "ASC",
      userId,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const agent = await Agent.findByPk(userId);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }
    const isAdmin = agent.role === "admin";

    const where = {};

    if (!isAdmin) {
      where.agentId = userId;
    } else if (agentId) {
      where.agentId = agentId;
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (ticketType) where.ticketType = ticketType;

    const include = [
      {
        model: User,
        as: "User",
        attributes: ["id", "name", "email", "phone"],
        required: !!search,
        where: search
          ? {
              [Op.or]: [
                { name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { phone: { [Op.like]: `%${search}%` } },
              ],
            }
          : undefined,
      },
      {
        model: Agent,
        as: "Agent",
        attributes: ["id", "firstName", "lastName"],
        required: false,
      },
      {
        model: Call,
        as: "Calls",
        attributes: ["id", "type", "summary", "createdAt", "QuestionsAnswers"],
        required: false,
      },
    ];

    const { count, rows } = await Ticket.findAndCountAll({
      where,
      include,
      order: [[sortBy, sortOrder]],
      limit: limitNum,
      offset,
      distinct: true,
    });

    res.json({
      tickets: rows,
      total: count,
      page: pageNum,
      totalPages: Math.ceil(count / limitNum),
      limit: limitNum,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
