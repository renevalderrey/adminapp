// ════════════════════════════════════════════
//  FAVALIO · Modelo: CatalogoProducto
//  La lista de INCLUSIÓN: si un producto no está acá, no sale a ese catálogo.
//
//  Sin asociaciones declaradas, por el motivo escrito en `models/index.js`:
//  `analizarIncludes` clasificaría cualquier `include` como «hijo con
//  empresa_id» y movería un ancla que existe para no moverse.
//
//  ── Sin `empresa_id`, a propósito ──
//
//  La tabla se opera siempre como «las filas del catálogo X», y X ya pasó por
//  `findScoped`. La columna daría una segunda fuente de verdad sobre a quién
//  pertenece la fila, y dos fuentes es una que puede estar mal.
//
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CatalogoProducto = sequelize.define('CatalogoProducto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  catalogo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'catalogo_productos',
  indexes: [
    // Agregar dos veces el mismo producto es un no-op, no una fila duplicada.
    { unique: true, name: 'uq_catalogo_producto', fields: ['catalogo_id', 'product_id'] },
    // El orden en el que se dibuja la grilla de la tienda.
    { name: 'idx_catalogo_producto_catalogo', fields: ['catalogo_id', 'orden'] },
  ],
});

module.exports = CatalogoProducto;
