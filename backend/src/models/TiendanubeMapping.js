const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TiendanubeMapping = sequelize.define('TiendanubeMapping', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  empresa_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  tiendanube_variant_id: { type: DataTypes.INTEGER, allowNull: false },
  tiendanube_product_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'tiendanube_mappings',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['empresa_id', 'product_id'] },
    { unique: true, fields: ['empresa_id', 'tiendanube_variant_id'] },
  ],
});

module.exports = TiendanubeMapping;
