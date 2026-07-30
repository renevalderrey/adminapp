const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CustomerPayment = sequelize.define('CustomerPayment', {
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
  customer_id: {
    type: DataTypes.INTEGER,
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
  payment_method: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'ef',
  },
  reference: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'customer_payments',
  indexes: [
    { fields: ['customer_id'] },
    { fields: ['payment_date'] },
  ],
});

module.exports = CustomerPayment;
