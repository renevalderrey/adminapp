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
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  color: {
    type: DataTypes.STRING(7),
    allowNull: true,
    defaultValue: '#4d6fff',
  },
}, {
  tableName: 'brands',
  indexes: [
    { unique: true, fields: ['empresa_id', 'name'] },
  ],
});

module.exports = Brand;
