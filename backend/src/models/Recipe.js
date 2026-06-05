const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Recipe = sequelize.define('Recipe', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  loss_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  yield: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 1.0000,
  },
}, {
  tableName: 'recipes',
  indexes: [
    { unique: true, fields: ['product_id'] },
  ],
});

module.exports = Recipe;
