// ════════════════════════════════════════════
//  FAVALIO · Modelo: PedidoItem
//  Todo congelado.
//
//  ── Por qué cuatro copias y no dos referencias ──
//
//  `nombre`, `precio_unitario`, `precio_lista` y `regla_id` son copias del
//  momento del pedido.
//
//  El nombre, para que un pedido cuyo producto se borró se siga viendo. Los
//  otros tres, para poder contestar **«¿por qué este pedido salió a este
//  precio?»** seis meses después, cuando las reglas ya cambiaron: el precio
//  unitario solo dice cuánto, no por qué.
//
//  Sin `empresa_id`, a propósito: la tabla se opera siempre como «las líneas del
//  pedido X», y X ya se resolvió con su empresa. Es además lo que mantiene el
//  ancla de `aislamientoEmpresas.test.js` en su lugar.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PedidoItem = sequelize.define('PedidoItem', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  pedido_id: { type: DataTypes.UUID, allowNull: false },
  // SET NULL en la base: borrar el producto no borra la línea histórica.
  product_id: { type: DataTypes.INTEGER, allowNull: true },

  nombre: { type: DataTypes.STRING(200), allowNull: false },
  precio_unitario: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  precio_lista: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  regla_id: { type: DataTypes.INTEGER, allowNull: true },
  // La EFECTIVAMENTE pedida, después del recorte por stock.
  cantidad: { type: DataTypes.INTEGER, allowNull: false },
  subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
}, {
  tableName: 'pedido_items',
  indexes: [
    { name: 'idx_pedido_item_pedido', fields: ['pedido_id'] },
  ],
});

module.exports = PedidoItem;
