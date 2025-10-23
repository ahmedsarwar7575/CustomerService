import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Call = sequelize.define('Call', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  type: {
    type: DataTypes.ENUM("inbound", "outbound"),
    allowNull: true
  },
  userId: {                         // ✅ so you can store the FK you pass in
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  ticketId: {                       // ✅ likewise
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  QuestionsAnswers: {
    type: DataTypes.JSON,           // or JSONB if Postgres
    allowNull: true,
  },
  languages: {                      // ✅ fix typo
    type: DataTypes.JSON,
    allowNull: true,
  },
  isResolvedByAi: {
    type: DataTypes.BOOLEAN,
    allowNull: true                 // ✅ allow unknown
  },
  summary: {
    type: DataTypes.TEXT,
    defaultValue: ''                // ✅ TEXT should default to string
  },
  recordingUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  callSid:{
    type: DataTypes.STRING,
    allowNull: true
  },
  outboundDetails: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'calls',
  timestamps: true
});

export default Call;
