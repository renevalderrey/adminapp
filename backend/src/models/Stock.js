// ════════════════════════════════════════════
//  COMPRAFIT · Modelo: Stock
//  Migra STOCK[], STOCK_ORTIZ[], STOCK_MAYO[]
//  Campos originales: { n, sku, t, cant, disp, marca }
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Stock = sequelize.define('Stock', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'products', key: 'id' },
  },
  // Sucursal: 'general' (Jesús), 'ortiz', 'mayo'
  location: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'general',
  },
  quantity: {
    type: DataTypes.INTEGER, // Campo "cant" original
    allowNull: false,
    defaultValue: 0,
  },
  available: {
    type: DataTypes.INTEGER, // Campo "disp" original
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'stock',
  indexes: [
    { unique: true, fields: ['product_id', 'location'] },
    { fields: ['location'] },
  ],
});

module.exports = Stock;
