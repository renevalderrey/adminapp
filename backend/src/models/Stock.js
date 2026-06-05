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
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // Sucursal: 'general' (Jesús), 'ortiz', 'mayo'
  location: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'general',
  },
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
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
  min_stock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  current_batch: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  expiration_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  purchase_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'stock',
  indexes: [
    { unique: true, fields: ['product_id', 'punto_de_venta_id'] },
    { fields: ['location'] },
    { fields: ['empresa_id'] },
    { fields: ['punto_de_venta_id'] },
  ],
});

module.exports = Stock;
