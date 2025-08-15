import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
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
  role:{
    type: DataTypes.STRING,
    defaultValue: 'user'
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  ticketType: {
    type: DataTypes.ENUM('support', 'sales', 'billing'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'pending'),
    defaultValue: 'active'
  },
  isOutbound: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isUpsales: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'users',
  timestamps: true
});

export default User;