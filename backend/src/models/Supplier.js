// ════════════════════════════════════════════
//  COMPRAFIT · Modelos: Supplier, SupplierAccount, SupplierMovement
//  Migra CUENTAS_PROV[] del sistema original
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ── Proveedor ──
const Supplier = sequelize.define('Supplier', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
    unique: true,
  },
}, {
  tableName: 'suppliers',
});

// ── Pedidos a proveedores ──
const SupplierOrder = sequelize.define('SupplierOrder', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'suppliers', key: 'id' },
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  total: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Detalle del pedido en JSON (productos, cantidades) — para compatibilidad
  detail: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'supplier_orders',
  indexes: [
    { fields: ['supplier_id'] },
    { fields: ['date'] },
  ],
});

// ── Movimientos financieros con proveedores (deudas, pagos) ──
const SupplierMovement = sequelize.define('SupplierMovement', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'suppliers', key: 'id' },
  },
  type: {
    type: DataTypes.ENUM('deuda', 'pago'), // deuda = pedido confirmado, pago = adelanto/pago
    allowNull: false,
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  payment_method: {
    type: DataTypes.STRING(30), // transferencia, efectivo, cheque, qr
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'supplier_movements',
  indexes: [
    { fields: ['supplier_id'] },
    { fields: ['date'] },
  ],
});

// ── Documentos/Facturas de proveedores ──
const SupplierDocument = sequelize.define('SupplierDocument', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'suppliers', key: 'id' },
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING(30), // factura, remito, presupuesto, otro
    allowNull: true,
    defaultValue: 'factura',
  },
  url: {
    type: DataTypes.TEXT, // Link a Google Drive / Dropbox / etc.
    allowNull: true,
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'supplier_documents',
  indexes: [
    { fields: ['supplier_id'] },
  ],
});

// ── Relaciones ──
Supplier.hasMany(SupplierOrder, { foreignKey: 'supplier_id', as: 'orders' });
Supplier.hasMany(SupplierMovement, { foreignKey: 'supplier_id', as: 'movements' });
Supplier.hasMany(SupplierDocument, { foreignKey: 'supplier_id', as: 'documents' });

SupplierOrder.belongsTo(Supplier, { foreignKey: 'supplier_id' });
SupplierMovement.belongsTo(Supplier, { foreignKey: 'supplier_id' });
SupplierDocument.belongsTo(Supplier, { foreignKey: 'supplier_id' });

module.exports = { Supplier, SupplierOrder, SupplierMovement, SupplierDocument };
