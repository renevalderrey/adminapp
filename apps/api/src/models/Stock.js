// ════════════════════════════════════════════
//  ADMINAPP · Modelo: Stock
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
  // Espejo del punto de venta, no la identidad (FR-041). Lo escribe siempre el
  // servidor a partir de `code` (o `name`) de la sucursal; el cliente ya no lo
  // manda. Se conserva porque hay consultas y exportaciones que lo leen, pero
  // el dato autoritativo es `punto_de_venta_id`.
  location: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'general',
  },
  // La identidad de la sucursal (FR-040). Obligatorio desde la migración 14:
  // una fila de stock que no dice en qué sucursal está es mercadería que la
  // pantalla no puede mostrar y que una venta no puede descontar.
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
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
  // Esta lista tiene que decir lo que la base REALMENTE tiene después de la
  // migración 14, y no lo que estaría bueno que tuviera.
  //
  // Sequelize solo la aplica con `sync()`, que este proyecto no usa: acá es
  // documentación. Antes declaraba el único `(product_id, punto_de_venta_id)`
  // —que la base no tenía, porque el que existía era el único
  // `(product_id, location)` que puso `20260531-initial-schema.js:544`— y esa
  // mentira es la que hizo que la spec diagnosticara mal el problema: FR-042
  // dice «el índice no separa por los nulos» cuando el motivo real era que no
  // existía. Un modelo que describe un esquema que nadie aplicó es peor que no
  // documentar nada.
  indexes: [
    { unique: true, fields: ['product_id', 'punto_de_venta_id'] },
    { fields: ['location'] },
    { fields: ['empresa_id'] },
    { fields: ['punto_de_venta_id'] },
  ],
});

module.exports = Stock;
