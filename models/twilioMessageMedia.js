import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const TwilioMessageMedia = sequelize.define(
  "TwilioMessageMedia",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    twilioMessageId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    mediaSid: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    mediaUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    contentType: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    fileName: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    tableName: "twilio_message_media",
    timestamps: true,
    indexes: [
      { fields: ["twilioMessageId"] },
      { fields: ["mediaSid"] },
    ],
  }
);

export default TwilioMessageMedia;