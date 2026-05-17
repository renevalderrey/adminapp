// ════════════════════════════════════════════
//  COMPRAFIT · Modelo: Brand (Marca)
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Brand = sequelize.define('Brand', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  color: {
    type: DataTypes.STRING(7), // Hex color: #ff6b4a
    allowNull: true,
    defaultValue: '#4d6fff',
  },
}, {
  tableName: 'brands',
});

module.exports = Brand;
