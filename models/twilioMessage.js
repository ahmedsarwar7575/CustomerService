import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const TwilioMessage = sequelize.define(
  "TwilioMessage",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    twilioMessageSid: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    direction: {
      type: DataTypes.ENUM("inbound", "outbound"),
      allowNull: false,
    },
    fromNumber: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    toNumber: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "queued",
    },
    hasMedia: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    numMedia: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    receivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    errorCode: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "twilio_messages",
    timestamps: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["agentId"] },
      { fields: ["twilioMessageSid"], unique: true },
      { fields: ["status"] },
      { fields: ["fromNumber"] },
      { fields: ["toNumber"] },
      { fields: ["hasMedia"] },
    ],
  }
);

export default TwilioMessage;