// ════════════════════════════════════════════
//  COMPRAFIT · Modelos: Sale y SaleItem
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
  customer_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  customer_name: {
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
  quantity: {
    type: DataTypes.INTEGER,
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
SaleItem.belongsTo(Sale, { foreignKey: 'sale_id' });

module.exports = { Sale, SaleItem };
