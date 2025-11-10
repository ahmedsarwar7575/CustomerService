import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Ticket = sequelize.define(
  "Ticket",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true, // ✅ add autoIncrement
    },
    status: {
      type: DataTypes.ENUM("open", "in_progress", "resolved", "closed"),
      defaultValue: "open",
    },
    ticketType: {
      type: DataTypes.ENUM("support", "sales", "billing"),
      allowNull: true, // ✅ allow null when model says "not specified"
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high", "critical"),
      defaultValue: "medium",
    },
    proposedSolution: {
      type: DataTypes.TEXT,
      allowNull: true, // ✅ "not specified" → null instead of forcing text
    },
    isSatisfied: {
      type: DataTypes.BOOLEAN,
      allowNull: true, // ✅ allow null when unknown
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: ``
    },
    userId: {
      type: DataTypes.INTEGER, // ✅ INTEGER (not NUMBER)
      allowNull: true,
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    notes: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
    },
  },
  {
    tableName: "tickets",
    timestamps: true,
  }
);

export default Ticket;
