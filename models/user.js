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
    allowNull: true
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
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
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'pending'),
    defaultValue: 'active'
  },
  isUpSellCall: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isSatisfactionCall: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isBothCall: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
}, {
  tableName: 'users',
  timestamps: true
});

export default User;