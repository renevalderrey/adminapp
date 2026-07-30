const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Suscripcion = sequelize.define('Suscripcion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  plan: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'free',
  },
  status: {
    type: DataTypes.ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired'),
    allowNull: false,
    defaultValue: 'trialing',
  },
  trial_starts_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  trial_ends_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  grace_period_ends: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  stripe_customer_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  stripe_subscription_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  cancel_at_period_end: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'suscripciones',
  indexes: [
    { unique: true, fields: ['empresa_id'] },
  ],
});

module.exports = Suscripcion;
