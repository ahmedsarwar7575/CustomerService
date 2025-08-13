import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Agent = sequelize.define('Agent', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  firstName: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  lastName: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  rating: {
    type: DataTypes.FLOAT,
    defaultValue: 0.0,
    validate: {
      min: 0,
      max: 5
    }
  },
  ticketType: {
    type: DataTypes.ENUM('support', 'sales', 'billing'),
    allowNull: false
  }
}, {
  tableName: 'agents',
  timestamps: true
});

export default Agent;