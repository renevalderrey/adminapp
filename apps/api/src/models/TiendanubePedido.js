// ════════════════════════════════════════════
//  ADMINAPP · Modelo: TiendanubePedido
//  La idempotencia del webhook, y qué pasó con cada ítem
//
//  ── Por qué esta tabla y no un índice único sobre `stock_movements` ──
//
//  FR-026 pide `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements`, y
//  eso rompería el punto de venta el día del deploy: `referencia_id` no es único
//  en ninguno de sus tres usos. `routes/sales.js:557` escribe **una fila por
//  línea** de la venta con el mismo `sale.id`, la anulación escribe encima de
//  esos mismos valores, y el propio pedido de TiendaNube escribe una fila **por
//  ítem**. Un ticket de dos productos revertiría la transacción entera.
//
//  `uq_tn_pedido (empresa_id, tiendanube_order_id)` es una fila **por pedido**,
//  que es la unidad de idempotencia de verdad. La fila se inserta PRIMERO y
//  DENTRO de la transacción que descuenta, y el `SequelizeUniqueConstraintError`
//  es lo que sostiene la garantía cuando llegan dos entregas del mismo webhook
//  **a la vez** — la mitad que un test secuencial no toca nunca. Es la misma
//  forma que `POST /api/sales`.
//
//  ── Y sirve para lo que hoy no tiene dónde quedar ──
//
//  Un ítem cuya variante no está mapeada, o cuyo producto no tiene fila de stock
//  en la sucursal, hoy se saltea con un `continue` y lo único que queda es que
//  el inventario está mal. Acá queda escrito en `items`, con su motivo, y
//  `items_sin_descontar` es el número que lo hace visible desde la pantalla sin
//  recorrer el JSONB.
//
//  ⚠ **Estas filas no se borran nunca.** Un pedido borrado es un pedido que se
//  puede volver a descontar si TiendaNube reintenta un webhook viejo — y los
//  reintenta. El barrido de `POST /api/tareas/ejecutar` borra corridas viejas,
//  no pedidos.
//
//  Sin asociaciones, por el motivo escrito en `TiendanubeTienda.js`.
// ════════════════════════════════════════════

const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

const TiendanubePedido = sequelize.define('TiendanubePedido', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // BIGINT: lo decide TiendaNube. ⚠ El driver lo devuelve como **string**.
  tiendanube_order_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  // El número que ve el comprador, para que la pantalla nombre el pedido con lo
  // que el cliente va a leer por teléfono y no con un id interno.
  numero: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  recibido_en: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  // La sucursal designada AL MOMENTO del pedido, y no la que diga
  // `tiendanube_tiendas` cuando alguien mire: si la designada cambia la semana
  // que viene, el pedido de hoy tiene que seguir diciendo de dónde salió la
  // mercadería.
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // Una entrada por ítem: `{ variante, cantidad, product_id, descontado, motivo }`.
  // JSONB y no una tabla hija porque nadie va a consultar por un ítem: se leen
  // todos juntos, con su pedido, para dibujar una fila. Mismo criterio que
  // `supplier_orders.detail`.
  items: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
  items_descontados: {
    type: DataTypes.SMALLINT,
    allowNull: false,
    defaultValue: 0,
  },
  items_sin_descontar: {
    type: DataTypes.SMALLINT,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'tiendanube_pedidos',
  // Una fila se escribe una vez. La migración no crea `updated_at`.
  updatedAt: false,
  indexes: [
    // Es lo ÚNICO que sostiene la idempotencia. Con `name` explícito e idéntico
    // al de la migración, como los demás.
    { unique: true, name: 'uq_tn_pedido', fields: ['empresa_id', 'tiendanube_order_id'] },
    // Parcial: la lista de «lo que no descontó» es la única lectura frecuente, y
    // los pedidos que descontaron todo —que son casi todos— no tienen por qué
    // estar en el índice.
    {
      name: 'idx_tn_pedidos_pendientes',
      fields: ['empresa_id', 'recibido_en'],
      where: { items_sin_descontar: { [Op.gt]: 0 } },
    },
  ],
});

module.exports = TiendanubePedido;
