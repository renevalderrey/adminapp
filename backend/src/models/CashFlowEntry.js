const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CashFlowEntry = sequelize.define('CashFlowEntry', {
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
  type: {
    type: DataTypes.ENUM('inflow', 'outflow'),
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'otro',
  },
  amount: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  entry_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  reference: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
  is_recurring: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  recurring_frequency: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
}, {
  tableName: 'cashflow_entries',
  indexes: [
    { fields: ['entry_date'] },
    { fields: ['type'] },
    { fields: ['category'] },
    { fields: ['punto_de_venta_id'] },
  ],
});

module.exports = CashFlowEntry;
