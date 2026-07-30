const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const crypto = require('crypto');

const Invitacion = sequelize.define('Invitacion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('admin', 'vendedor', 'produccion', 'compras'),
    allowNull: false,
    defaultValue: 'vendedor',
  },
  token: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    defaultValue: () => crypto.randomBytes(32).toString('hex'),
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'accepted', 'expired', 'revoked'),
    allowNull: false,
    defaultValue: 'pending',
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d;
    },
  },
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'invitaciones',
  indexes: [
    { fields: ['empresa_id'] },
    { fields: ['email'] },
    { unique: true, fields: ['token'] },
  ],
});

module.exports = Invitacion;
