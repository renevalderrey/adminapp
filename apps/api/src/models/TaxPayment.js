const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TaxPayment = sequelize.define('TaxPayment', {
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
  tax_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  payment_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  period_from: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  period_to: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'tax_payments',
  indexes: [
    { fields: ['tax_type'] },
    { fields: ['payment_date'] },
  ],
});

module.exports = TaxPayment;
