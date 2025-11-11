import Ticket from "../models/ticket.js";
import Agent from "../models/agent.js";
import User from "../models/user.js";
import Call from "../models/Call.js";
import { randomUUID } from 'node:crypto';
import { Email } from "../models/Email.js";
const nz = (arr) => (Array.isArray(arr) ? arr : []);
// Create new ticket
export const createTicket = async (req, res) => {
  try {
    // Generate unique ticket ID (5-10 words)
    const ticketId = generateTicketId();

    const ticket = await Ticket.create({
      ...req.body,
      id: ticketId,
      userId: req.body.userId,
      status: "open",
    });

    res.status(201).json({
      message: "Ticket created successfully",
      ticket,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Assign ticket to agent
export const assignTicket = async (req, res) => {
  try {
    const { ticketId, agentId } = req.params;

    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const agent = await Agent.findByPk(agentId);
    if (!agent || !agent.isActive) {
      return res.status(404).json({ error: "Agent not found or inactive" });
    }

    // Check if agent can handle this ticket type
    if (agent.ticketType !== ticket.ticketType) {
      return res.status(400).json({
        error: `Agent can only handle ${agent.ticketType} tickets`,
      });
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
      order: [["updatedAt", "DESC"]],
    });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAllTickets = async (req, res) => {
  try {
    const tickets = await Ticket.findAll({
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
      order: [["updatedAt", "DESC"]],
    });
    if (!tickets) {
      return res.status(404).json({ error: "Tickets not found" });
    }
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
        { model: User, attributes: ["id", "name", "email"] },
        {
          model: Call,
          attributes: ["id", "type", "summary", "createdAt", "QuestionsAnswers"],
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

    const note = { id: randomUUID(), text: String(text).trim(), timestamp: new Date().toISOString() };
    ticket.set('notes', [...nz(ticket.notes), note]);
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
    const note = nz(ticket.notes).find(n => n.id === noteId);
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
    const i = notes.findIndex(n => n.id === noteId);
    if (i === -1) return res.status(404).json({ error: "Note not found" });

    const updated = { ...notes[i], text: String(text).trim(), timestamp: new Date().toISOString() };
    const next = notes.slice(); next[i] = updated;
    ticket.set('notes', next);
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
    if (!notes.some(n => n.id === noteId)) return res.status(404).json({ error: "Note not found" });

    ticket.set('notes', notes.filter(n => n.id !== noteId));
    await ticket.save();

    res.json({ message: "Note deleted", noteId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};