const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductionOrderItem = sequelize.define('ProductionOrderItem', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  production_order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  ingredient_product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  quantity_used: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
  },
  unit_cost_at_time: {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: false,
  },
}, {
  tableName: 'production_order_items',
  indexes: [
    { fields: ['production_order_id'] },
    { fields: ['ingredient_product_id'] },
  ],
});

module.exports = ProductionOrderItem;
