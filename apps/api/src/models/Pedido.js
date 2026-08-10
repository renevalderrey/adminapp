// ════════════════════════════════════════════
//  FAVALIO · Modelo: Pedido
//  Lo que arma alguien que escaneó un QR.
//
//  Sin asociaciones declaradas, por el motivo escrito en `models/index.js`.
//
//  ── Tres columnas que existen y no se escriben ──
//
//  `comprador_dni`, `acepta_comunicaciones` y los dos de consentimiento. Están
//  para que el esquema no cambie el día que se abra la puerta de los Términos y
//  la Política de Privacidad; hasta entonces el servidor las ignora aunque
//  vengan en el cuerpo, y eso se verifica ejecutándolo.
//
//  ── Y una que existe y queda siempre en NULL ──
//
//  `sale_id`. Marcar cobrado NO crea la venta en estas etapas: la regla es «si
//  toca stock, genera venta; si no genera venta, no toca stock», y las dos
//  mitades van juntas en la etapa siguiente.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Pedido = sequelize.define('Pedido', {
  // Lo genera el servidor y NO viaja en ninguna respuesta pública: lo que el
  // comprador tiene para nombrar su pedido es el número legible.
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  // Sale del resolvedor de slug, NUNCA del cuerpo.
  empresa_id: { type: DataTypes.INTEGER, allowNull: false },
  catalogo_id: { type: DataTypes.INTEGER, allowNull: false },
  // El del catálogo en el momento del pedido, congelado: si mañana el catálogo
  // cambia de sucursal, este pedido tiene que seguir diciendo de dónde salía.
  punto_de_venta_id: { type: DataTypes.INTEGER, allowNull: false },

  origen: {
    type: DataTypes.ENUM('catalogo'),
    allowNull: false,
    defaultValue: 'catalogo',
  },
  // Correlativo por empresa. Lo emite un advisory lock adentro de la
  // transacción; `uq_pedido_numero` es la red.
  numero: { type: DataTypes.INTEGER, allowNull: false },
  estado: {
    type: DataTypes.ENUM('pendiente_pago', 'pagado', 'en_preparacion', 'listo', 'entregado', 'cancelado'),
    allowNull: false,
    defaultValue: 'pendiente_pago',
  },

  comprador_nombre: { type: DataTypes.STRING(120), allowNull: false },
  comprador_telefono: { type: DataTypes.STRING(30), allowNull: false },
  comprador_email: { type: DataTypes.STRING(255), allowNull: true },
  comprador_dni: { type: DataTypes.STRING(20), allowNull: true },
  comprador_nro_socio: { type: DataTypes.STRING(40), allowNull: true },
  customer_id: { type: DataTypes.INTEGER, allowNull: true },

  acepta_comunicaciones: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Un booleano no dice CUÁNDO, y `consentimiento_texto` guarda la versión de
  // lo que se aceptó: sin las dos, «aceptó» no se puede sostener después.
  consentimiento_en: { type: DataTypes.DATE, allowNull: true },
  consentimiento_texto: { type: DataTypes.STRING(60), allowNull: true },

  entrega: {
    type: DataTypes.ENUM('retiro_socio', 'retiro_local', 'envio', 'coordinar'),
    allowNull: false,
  },
  envio_direccion: { type: DataTypes.STRING(255), allowNull: true },
  envio_localidad: { type: DataTypes.STRING(120), allowNull: true },
  envio_cp: { type: DataTypes.STRING(20), allowNull: true },

  // Los calcula el servidor. El cuerpo del pedido manda producto y cantidad,
  // nunca precio.
  subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  envio_costo: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

  // Sin `mp`: la pasarela es la etapa 3, y un valor que nadie puede producir es
  // un valor que nadie probó.
  medio_pago: { type: DataTypes.ENUM('transferencia', 'efectivo'), allowNull: false },
  notas: { type: DataTypes.TEXT, allowNull: true },

  // La garantía de que tocar «enviar» dos veces no crea dos pedidos. Global y no
  // por empresa: la clave la genera el navegador como UUID.
  idempotency_key: { type: DataTypes.STRING(64), allowNull: false },

  sale_id: { type: DataTypes.STRING(40), allowNull: true },
}, {
  tableName: 'pedidos',
  indexes: [
    { unique: true, name: 'uq_pedido_numero', fields: ['empresa_id', 'numero'] },
    { unique: true, name: 'uq_pedido_idempotencia', fields: ['idempotency_key'] },
    { name: 'idx_pedido_bandeja', fields: ['empresa_id', 'estado', 'created_at'] },
    { name: 'idx_pedido_catalogo', fields: ['catalogo_id', 'created_at'] },
    { name: 'idx_pedido_origen', fields: ['empresa_id', 'origen', 'created_at'] },
    { name: 'idx_pedido_customer', fields: ['customer_id'] },
  ],
});

module.exports = Pedido;
