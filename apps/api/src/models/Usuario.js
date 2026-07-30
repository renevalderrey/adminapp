const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Usuario = sequelize.define('Usuario', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  auth0_sub: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  nombre: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'usuarios',
  indexes: [
    { unique: true, fields: ['auth0_sub'] },
  ],
});

module.exports = Usuario;
