const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Empresa = sequelize.define('Empresa', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  cuit: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  rubro: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  phone: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  state: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  country: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: 'Argentina',
  },
  timezone: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'America/Argentina/Buenos_Aires',
  },
  currency: {
    type: DataTypes.STRING(10),
    allowNull: true,
    defaultValue: 'ARS',
  },
  logo: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  settings: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
  },
  onboarding_completed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'empresas',
});

module.exports = Empresa;
