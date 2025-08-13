import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Rating = sequelize.define('Rating', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    }
  },
  comments: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'ratings',
  timestamps: true
});

export default Rating;