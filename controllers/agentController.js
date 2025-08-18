import Agent from "../models/agent.js";
import Ticket from "../models/ticket.js";
import Rating from "../models/rating.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// Agent authentication
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await Agent.findOne({ where: { email } });

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: agent.id, role: "agent" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      message: "Login successful",
      token,
      agent: {
        id: agent.id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        isActive: agent.isActive,
        rating: agent.rating,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create new agent
export const createAgent = async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const existingAgent = await Agent.findOne({
      where: { email: req.body.email },
    });
    if (existingAgent) {
      return res
        .status(400)
        .json({ error: "Agent with this email already exists" });
    }
    const agent = await Agent.create({
      ...req.body,
      password: hashedPassword,
    });
    const token = jwt.sign(
      { id: agent.id, role: "agent" },
      process.env.JWT_SECRET,
      { expiresIn: "10d" }
    );
    res.status(201).json({
      message: "Agent created successfully",
      agent: {
        id: agent.id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        isActive: agent.isActive,
        rating: agent.rating,
        token,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get agent performance metrics
export const getAgentPerformance = async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = await Agent.findByPk(agentId, {
      include: [
        {
          model: Ticket,
          attributes: ["id", "status", "createdAt", "updatedAt"],
        },
        {
          model: Rating,
          attributes: ["score", "comments"],
        },
      ],
    });

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // Calculate performance metrics
    const totalTickets = agent.Tickets.length;
    const resolvedTickets = agent.Tickets.filter(
      (t) => t.status === "resolved"
    ).length;
    const avgRating =
      agent.Ratings.reduce((sum, rating) => sum + rating.score, 0) /
      agent.Ratings.length;

    res.json({
      agentId: agent.id,
      name: `${agent.firstName} ${agent.lastName}`,
      totalTickets,
      resolvedTickets,
      resolutionRate:
        totalTickets > 0 ? (resolvedTickets / totalTickets) * 100 : 0,
      averageRating: isNaN(avgRating) ? 0 : avgRating.toFixed(2),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Additional CRUD operations
export const getAllAgents = async (req, res) => {
  try {
    const agents = await Agent.findAll({
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "isActive",
        "rating",
        "ticketType",
      ],
      order: [["rating", "DESC"]],
    });
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAgentById = async (req, res) => {
  try {
    const agent = await Agent.findByPk(req.params.id, {
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "isActive",
        "rating",
        "ticketType",
      ],
    });

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateAgent = async (req, res) => {
  try {
    const agent = await Agent.findByPk(req.params.id);

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // Update password if provided
    if (req.body.password) {
      req.body.password = await bcrypt.hash(req.body.password, 10);
    }

    await agent.update(req.body);
    res.json({ message: "Agent updated successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deactivateAgent = async (req, res) => {
  try {
    const agent = await Agent.findByPk(req.params.id);

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    await agent.update({ isActive: false });
    res.json({ message: "Agent deactivated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      email !== process.env.ADMIN_EMAIL ||
      password !== process.env.ADMIN_PASSWORD
    ) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: process.env.ADMIN_ID, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "10d" }
    );

    res.json({
      message: "Admin login successful",
      token,
      admin: {
        email: process.env.ADMIN_EMAIL,
        role: process.env.ADMIN_ROLE,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
