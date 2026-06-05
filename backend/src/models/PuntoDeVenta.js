const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PuntoDeVenta = sequelize.define('PuntoDeVenta', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  code: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'puntos_de_venta',
  indexes: [
    { fields: ['empresa_id'] },
    { unique: true, fields: ['empresa_id', 'code'] },
  ],
});

module.exports = PuntoDeVenta;
