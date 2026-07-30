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
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  sku: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  barcode: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  cost: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  margin_override: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
  },
  price_override: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  wholesale_margin: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
  },
  wholesale_price: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'otro',
  },
  unit_type: {
    type: DataTypes.ENUM('unidad', 'kg', 'gr', 'litro', 'ml'),
    allowNull: true,
    defaultValue: 'unidad',
  },
  unit_size: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  taxed: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  image_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  tiendanube_variant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'products',
  indexes: [
    { fields: ['empresa_id'] },
    { fields: ['brand_id'] },
    { fields: ['supplier_id'] },
    { fields: ['name'] },
    { fields: ['sku'] },
    { fields: ['barcode'] },
    { fields: ['category'] },
    { unique: true, fields: ['empresa_id', 'sku'] },
  ],
});

module.exports = Product;
