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
  name: {
    type: DataTypes.STRING(255), // Campo "n" original
    allowNull: false,
  },
  sku: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true,
  },
  cost: {
    type: DataTypes.DECIMAL(12, 2), // Campo "c" original (costo de compra)
    allowNull: false,
    defaultValue: 0,
  },
  brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'brands', key: 'id' },
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
    { fields: ['brand_id'] },
    { fields: ['name'] },
    { fields: ['sku'] },
  ],
});

module.exports = Product;
