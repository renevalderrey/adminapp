const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductCostHistory = sequelize.define('ProductCostHistory', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  change_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  old_cost: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  new_cost: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'product_cost_history',
  indexes: [
    { fields: ['product_id'] },
    { fields: ['change_date'] },
  ],
});

module.exports = ProductCostHistory;
