// models/Email.js (ESM)
import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export const Email = sequelize.define(
  "Email",
  {
    id: { type: DataTypes.STRING(128), primaryKey: true, field: "Id" },
    subject: { type: DataTypes.STRING(512), allowNull: true, field: "Subject" },
    from: { type: DataTypes.STRING(512), allowNull: false, field: "From" },
    to: { type: DataTypes.STRING(512), allowNull: false, field: "To" },
    date: { type: DataTypes.DATE, allowNull: false, field: "Date" },
    body: { type: DataTypes.TEXT("medium"), field: "Body" },
    userId: { type: DataTypes.INTEGER, allowNull: true, field: "UserId" },
    isRecieved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "IsRecieved",
    },
  },
  {
    tableName: "Emails",
    timestamps: true, // uses createdAt/updatedAt that map to same-named columns
  }
);
