import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Ticket = sequelize.define('Ticket', {
  id: {
    type: DataTypes.STRING(50),
    primaryKey: true,
    unique: true,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed', 'escalated'),
    defaultValue: 'open'
  },
  ticketType: {
    type: DataTypes.ENUM('support', 'sales', 'billing'),
    allowNull: false
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    defaultValue: 'medium'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'tickets',
  timestamps: true
});

export default Ticket;