const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductionOrder = sequelize.define('ProductionOrder', {
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
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  quantity_produced: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
  },
  batch_code: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  production_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  unit_cost_calculated: {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: false,
  },
  total_cost: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('completed', 'voided'),
    allowNull: false,
    defaultValue: 'completed',
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  voided_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  location: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'general',
  },
  cost_snapshot: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'production_orders',
  indexes: [
    { fields: ['product_id'] },
    { fields: ['production_date'] },
    { fields: ['batch_code'] },
    { fields: ['status'] },
    { fields: ['empresa_id'] },
    { fields: ['punto_de_venta_id'] },
  ],
});

module.exports = ProductionOrder;
