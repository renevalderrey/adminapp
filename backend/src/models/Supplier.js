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
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  cuit: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
}, {
  tableName: 'suppliers',
  indexes: [
    { unique: true, fields: ['empresa_id', 'name'] },
  ],
});

// ── Pedidos a proveedores ──
const SupplierOrder = sequelize.define('SupplierOrder', {
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
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
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
  detail: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'partial', 'received', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
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
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
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
  due_date: {
    type: DataTypes.DATEONLY,
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
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
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
