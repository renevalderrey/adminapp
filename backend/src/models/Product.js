// ════════════════════════════════════════════
//  COMPRAFIT · Modelo: Product (Producto)
//  Migra la estructura del array DB[] original
//  Campos originales: { n, c, marca, _mgOv, _precioOv }
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Product = sequelize.define('Product', {
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
    type: DataTypes.STRING(255), // Campo "n" original
    allowNull: false,
  },
  sku: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  cost: {
    type: DataTypes.DECIMAL(12, 2), // Campo "c" original (costo de compra)
    allowNull: false,
    defaultValue: 0,
  },
  brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Precios de venta calculados o personalizados
  margin_override: {
    type: DataTypes.DECIMAL(5, 2), // Campo "_mgOv" original (% margen personalizado)
    allowNull: true,
  },
  price_override: {
    type: DataTypes.DECIMAL(12, 2), // Campo "_precioOv" original (precio manual)
    allowNull: true,
  },
  wholesale_margin: {
    type: DataTypes.DECIMAL(5, 2), // Porcentaje de margen mayorista
    allowNull: true,
  },
  wholesale_price: {
    type: DataTypes.DECIMAL(12, 2), // Precio mayorista manual fijo
    allowNull: true,
  },
  category: {
    type: DataTypes.STRING(30), // Categoría inferida: proteina, creatina, pre, etc.
    allowNull: true,
    defaultValue: 'otro',
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'products',
  indexes: [
    { fields: ['empresa_id'] },
    { fields: ['brand_id'] },
    { fields: ['name'] },
    { fields: ['sku'] },
    { unique: true, fields: ['empresa_id', 'sku'] },
  ],
});

module.exports = Product;
