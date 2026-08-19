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
  // ── Las cuatro son DECIMAL(14,4) desde la migración 31 ──
  //
  // Son la foto de `stock.quantity` y `stock.available` antes y después de cada
  // movimiento. Si la foto tuviera menos precisión que lo fotografiado, el
  // historial diría que un stock pasó de 10 a 10 cuando pasó de 10 a 9,6: el
  // único registro de qué se movió quedaría mintiendo, y en silencio.
  //
  // El tipo lo ata a la migración `tests/modeloStockMovement.test.js`.
  cantidad_anterior: {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: false,
  },
  cantidad_nueva: {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: false,
  },
  disponible_anterior: {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: false,
  },
  disponible_nuevo: {
    type: DataTypes.DECIMAL(14, 4),
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
