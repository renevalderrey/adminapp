const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StockMovement = sequelize.define('StockMovement', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  tipo: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  referencia_id: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  cantidad_anterior: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  cantidad_nueva: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  disponible_anterior: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  disponible_nuevo: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'stock_movements',
  timestamps: true,
  updatedAt: false,
  underscored: true,
});

module.exports = StockMovement;
