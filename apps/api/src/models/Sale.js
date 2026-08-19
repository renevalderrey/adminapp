// ════════════════════════════════════════════
//  FAVALIO · Modelos: Sale y SaleItem
//  Migra cf_ventas y la tabla cf_ventas de MySQL
//  Campos originales: { id, fecha, hora, items, total, metodo, obs }
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Sale = sequelize.define('Sale', {
  id: {
    type: DataTypes.STRING(40), // Mantiene el id original para compatibilidad
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
  date: {
    type: DataTypes.DATEONLY, // Campo "fecha"
    allowNull: false,
  },
  time: {
    type: DataTypes.STRING(10), // Campo "hora" (HH:mm)
    allowNull: false,
  },
  total: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  payment_method: {
    type: DataTypes.STRING(20), // Campo "metodo": ef, tr, td, tc1, tc3v, tc3m, tc3n, al, qr
    allowNull: false,
    defaultValue: 'ef',
  },
  // Venta a cuenta corriente. Las ventas son al contado salvo que se marque:
  // en el mostrador lo normal es identificar al cliente y cobrarle igual en el
  // acto. Antes se deducia de customer_id, con lo cual toda venta con cliente
  // quedaba como deuda impaga y los saldos de cuenta corriente estaban
  // inflados con operaciones ya cobradas.
  is_credit: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Punto de venta de AFIP con el que se emitio el comprobante.
  //
  // No se guardaba: la reimpresion tenia el numero clavado en 1 y la
  // verificacion contra AFIP usaba el punto de venta configurado HOY. Si el
  // comercio cambia de punto de venta, todos los comprobantes viejos quedan
  // imposibles de identificar y de reimprimir correctamente.
  afip_pv: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT, // Campo "obs"
    allowNull: true,
  },
  location: {
    type: DataTypes.STRING(30), // Sucursal donde se registró la venta
    allowNull: true,
    defaultValue: 'general',
  },
  seller: {
    type: DataTypes.STRING(50), // Nombre del vendedor
    allowNull: true,
  },
  afip_cae: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  afip_vto: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  afip_nro: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  afip_type: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Por que se guarda el error de AFIP y no solo se loguea.
  //
  // Una venta activa sin CAE puede ser dos cosas distintas: una venta interna
  // que nadie quiso facturar, o una que ARCA rechazo. Las dos son
  // status='active' con afip_cae=NULL, asi que sin este campo son
  // indistinguibles y el operador que vuelve al dia siguiente no tiene forma
  // de saber cual le falta reintentar. Antes el rechazo se logueaba y se
  // devolvia en la respuesta HTTP: al cerrar la pestaña, se perdia.
  //
  // TEXT y no STRING(255) porque el mensaje viene de afipService con un
  // JSON.stringify adentro: un rechazo con dos observaciones pasa los 255
  // caracteres y lo que se corta es el final, que es donde esta el codigo del
  // rechazo. Es el unico pedazo accionable.
  //
  // Un intento nuevo pisa al anterior: se guarda el ultimo, no la serie.
  afip_ultimo_error: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Se escribe en todo intento, exitoso o fallido. En el exitoso el error
  // vuelve a null: sin eso, el panel seguiria mostrando el rechazo de una
  // venta que despues salio bien.
  afip_ultimo_intento: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  customer_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  customer_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'active',
  },
  voided_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  voided_by: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'sales',
  indexes: [
    { fields: ['date'] },
    { fields: ['location'] },
    { fields: ['payment_method'] },
    { fields: ['empresa_id'] },
    { fields: ['punto_de_venta_id'] },
    { fields: ['status'] },
    // El historial siempre consulta `empresa_id = X AND date BETWEEN a AND b`.
    // Con los indices sueltos de arriba Postgres elige uno y filtra el resto
    // fila por fila; el compuesto ataca las dos condiciones a la vez. Los
    // sueltos se dejan: sacarlos es una migracion destructiva sobre una tabla
    // caliente y no molestan.
    { name: 'sales_empresa_date_idx', fields: ['empresa_id', 'date'] },
  ],
});

// ── Items de la venta (normalizados desde el JSON "items") ──
const SaleItem = sequelize.define('SaleItem', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  sale_id: {
    type: DataTypes.STRING(40),
    allowNull: false,
  },
  product_name: {
    type: DataTypes.STRING(255), // Nombre del producto al momento de la venta
    allowNull: false,
  },
  product_id: {
    type: DataTypes.INTEGER, // FK opcional al producto (puede no existir si fue eliminado)
    allowNull: true,
  },
  // DECIMAL(14,4) desde la migración 31, la misma escala que `stock`: una línea
  // de venta y el descuento de inventario que produce tienen que poder
  // representar el mismo número. **Cuantos decimales admite una línea es otra
  // pregunta y la contesta un validador** —hoy `POST /api/sales` solo acepta
  // enteros (`utils/cantidades.js:DECIMALES_DE_UNA_LINEA_DE_VENTA`)—: acá está
  // la capacidad, no la regla de negocio.
  //
  // El tipo lo ata a la migración `tests/modeloSale.test.js`.
  quantity: {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: false,
    defaultValue: 1,
  },
  unit_price: {
    type: DataTypes.DECIMAL(12, 2), // Precio unitario al momento de la venta
    allowNull: false,
    defaultValue: 0,
  },
  payment_method: {
    type: DataTypes.STRING(20), // Método de pago individual del ítem
    allowNull: true,
  },
}, {
  tableName: 'sale_items',
  indexes: [
    { fields: ['sale_id'] },
    { fields: ['product_id'] },
  ],
});

// ── Relaciones ──
Sale.hasMany(SaleItem, { foreignKey: 'sale_id', as: 'items' });
// El alias explicito 'sale' hace falta: sin el, Sequelize registra la
// asociacion bajo el nombre del modelo ('Sale', con mayuscula) y cualquier
// include que use as:'sale' falla en tiempo de ejecucion.
SaleItem.belongsTo(Sale, { foreignKey: 'sale_id', as: 'sale' });

module.exports = { Sale, SaleItem };
