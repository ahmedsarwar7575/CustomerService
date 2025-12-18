import Agent from "../models/agent.js";
import Ticket from "../models/ticket.js";
import Rating from "../models/rating.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/user.js";
import Call from "../models/Call.js";
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
    let token;
    if (agent.role === "admin") {
      token = jwt.sign(
        { id: agent.id, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );
    } else {
      token = jwt.sign(
        { id: agent.id, role: "agent" },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );
    }
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
        ticketType: agent?.ticketType,
        role: agent.role,
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
        token,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        isActive: agent.isActive,
        rating: agent.rating,
        ticketType: agent.ticketType,
        role: agent.role,
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

export const getAllAgents = async (req, res) => {
  try {
    const agents = await Agent.findAll({
      where: { role: "agent" },
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
    console.log(JSON.stringify(agents));
    const result = await Promise.all(
      agents.map(async (agent) => {
        // --- Get all tickets for this agent ---
        const tickets = await Ticket.findAll({
          where: { agentId: agent.id },
          attributes: [
            "id",
            "priority",
            "ticketType",
            "status",
            "summary",
            "userId",
          ],
        });

        // Attach user to each ticket
        const ticketsWithUsers = await Promise.all(
          tickets.map(async (ticket) => {
            let userData = null;

            if (ticket.userId) {
              const user = await User.findOne({
                where: { id: ticket.userId },
                attributes: ["id", "name", "email", "phone"],
              });
              userData = user;
            }

            return {
              ...ticket.toJSON(),
              user: userData, // changed key so it's clearer than 'userId'
            };
          })
        );

        // --- Get all ratings for this agent ---
        const ratings = await Rating.findAll({
          where: { agentId: agent.id },
          attributes: [
            "id",
            "score",
            "comments",
            "userId",
            "ticketId",
            "createdAt",
          ],
        });

        // --- Calculate average rating ---
        let averageRating = null;
        if (ratings.length > 0) {
          const total = ratings.reduce((sum, r) => sum + r.score, 0);
          averageRating = total / ratings.length;
        }

        return {
          ...agent.toJSON(),
          tickets: ticketsWithUsers,
          ratings, // all rating records for this agent
          averageRating, // computed average (null if no ratings)
          ratingsCount: ratings.length,
        };
      })
    );

    res.json(result);
  } catch (error) {
    console.error(error);
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

    const tickets = await Ticket.findAll({
      where: { agentId: agent.id },
      attributes: [
        "id",
        "priority",
        "ticketType",
        "status",
        "summary",
        "userId",
      ],
    });

    const ticketsWithUsers = await Promise.all(
      tickets.map(async (ticket) => {
        let userId = ticket.userId;
        if (ticket.userId) {
          const user = await User.findOne({
            where: { id: ticket.userId },
            attributes: ["id", "name", "email", "phone"],
          });
          userId = user;
        }
        return {
          ...ticket.toJSON(),
          userId,
        };
      })
    );

    const ratings = await Rating.findAll({
      where: { agentId: agent.id },
      attributes: [
        "id",
        "score",
        "comments",
        "ticketId",
        "userId",
        "createdAt",
      ],
    });

    let averageRating = null;
    if (ratings.length > 0) {
      const total = ratings.reduce((sum, r) => sum + r.score, 0);
      averageRating = Number((total / ratings.length).toFixed(2));
    }

    const ratingUserIds = Array.from(
      new Set(ratings.map((r) => r.userId).filter(Boolean))
    );
    const ratingTicketIds = Array.from(
      new Set(ratings.map((r) => r.ticketId).filter(Boolean))
    );

    const ratingUsers = ratingUserIds.length
      ? await User.findAll({
          where: { id: ratingUserIds },
          attributes: ["id", "name", "email", "phone"],
        })
      : [];

    const ratingTickets = ratingTicketIds.length
      ? await Ticket.findAll({
          where: { id: ratingTicketIds },
          attributes: ["id", "summary", "status", "priority", "ticketType"],
        })
      : [];

    const userMap = new Map(ratingUsers.map((u) => [u.id, u.toJSON()]));
    const ticketMap = new Map(ratingTickets.map((t) => [t.id, t.toJSON()]));

    const ratingsWithDetails = ratings.map((r) => {
      const rJson = r.toJSON();
      const tinyUser = rJson.userId ? userMap.get(rJson.userId) || null : null;
      const tinyTicket = rJson.ticketId
        ? ticketMap.get(rJson.ticketId) || null
        : null;

      return {
        ...rJson,
        userId: tinyUser,
        ticketId: tinyTicket,
      };
    });

    res.json({
      ...agent.toJSON(),
      tickets: ticketsWithUsers,
      ratings: ratingsWithDetails,
      ratingsCount: ratings.length,
      averageRating,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const updateAgent = async (req, res) => {
  try {
    const agent = await Agent.findByPk(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { password, ...rest } = req.body || {};
    const payload = { ...rest };

    if (typeof password === "string" && password.trim() !== "") {
      payload.password = await bcrypt.hash(password, 10);
    }

    await agent.update(payload);
    return res.json({ message: "Agent updated successfully" });
  } catch (error) {
    return res.status(400).json({ error: error.message });
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

export const getAllTicketsByAgentId = async (req, res) => {
  try {
    const agentId = req.params.id;

    if (!agentId) {
      return res.status(400).json({ error: "Agent ID is required" });
    }

    const tickets = await Ticket.findAll({
      where: { agentId },
      include: [
        {
          model: Agent,
          attributes: ["firstName", "lastName"],
        },
        {
          model: User,
          attributes: ["id", "name", "email", "phone"],
          include: [
            {
              model: Call, // Include calls of the user
              attributes: [
                "id",
                "type",
                "summary",
                "createdAt",
                "updatedAt",
                "QuestionsAnswers",
              ],
            },
          ],
        },
      ],
    });

    if (!tickets || tickets.length === 0) {
      return res.status(404).json({ error: "Tickets not found" });
    }

    res.json(tickets);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ error: error.message });
  }
};
export const deleteAgent = async (req, res) => {
  try {
    const agentId = req.params.id;

    // Find agent
    const agent = await Agent.findByPk(agentId);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // Check for active tickets
    const ticketCount = await Ticket.count({
      where: { agentId, status: "open" },
    });
    if (ticketCount > 0) {
      return res.status(400).json({
        error: `Cannot delete agent with ${ticketCount} active tickets`,
      });
    }

    // Delete all ratings for this agent
    await Rating.destroy({ where: { agentId } });

    // Delete the agent
    await agent.destroy();

    return res.status(200).json({
      message: "Agent deleted successfully",
      deletedAgentId: agentId,
    });
  } catch (error) {
    console.error("Delete agent error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};
export const getAllUsersByAgentId = async (req, res) => {
  try {
    const agentId = req.params.id;
    if (!agentId)
      return res.status(400).json({ error: "Agent ID is required" });

    const rows = await Ticket.findAll({
      where: { agentId },
      attributes: [], // ✅ excludes ticket fields from the result
      include: [
        {
          model: Agent,
          attributes: ["id", "firstName", "lastName"],
        },
        {
          model: User,
          // pick what you want to return (recommended) OR use exclude
          // attributes: ["id", "firstName", "lastName", "email"],
          attributes: { exclude: ["password"] },
        },
      ],
    });

    if (!rows?.length)
      return res.status(404).json({ error: "No users found for this agent" });

    const agent = rows[0].Agent;

    // ✅ collect users and dedupe (since multiple tickets can reference same user)
    const users = [
      ...new Map(
        rows.map((r) => [r.User?.id, r.User]).filter(([, u]) => u)
      ).values(),
    ];

    return res.json({ agent, users });
  } catch (error) {
    console.error("Error fetching users by agent:", error);
    return res.status(500).json({ error: error.message });
  }
};
