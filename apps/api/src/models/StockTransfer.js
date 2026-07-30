const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StockTransfer = sequelize.define('StockTransfer', {
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
  from_location: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  from_punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
  to_punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
  to_location: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  items: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
}, {
  tableName: 'stock_transfers',
});

module.exports = StockTransfer;
