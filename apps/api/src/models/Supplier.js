// ════════════════════════════════════════════
//  FAVALIO · Modelos: Supplier, SupplierAccount, SupplierMovement
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
  // Los dos compuestos por empresa los crea
  // `migrations/20260808-indices-de-empresa-en-proveedores.js`, y llevan `name`
  // explicito por eso: sin el, Sequelize los llamaria
  // `supplier_orders_empresa_id_status` y un `sync({ alter: true })` sobre una
  // base migrada intentaria crear un SEGUNDO indice sobre las mismas columnas.
  //
  // Los dos de una sola columna se quedan: las consultas por proveedor y por
  // fecha sueltas siguen existiendo.
  indexes: [
    { fields: ['supplier_id'] },
    { fields: ['date'] },
    { name: 'idx_supplier_orders_empresa_status', fields: ['empresa_id', 'status'] },
    { name: 'idx_supplier_orders_empresa_date', fields: ['empresa_id', 'date'] },
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
  // El compuesto es el que sostiene el `GROUP BY supplier_id, type` con el que
  // se calculan deuda, pagado y saldo de todos los proveedores de la empresa.
  // Sin el, ese agregado barre los movimientos de todas las empresas cliente.
  indexes: [
    { fields: ['supplier_id'] },
    { fields: ['date'] },
    { name: 'idx_supplier_movements_empresa_supplier', fields: ['empresa_id', 'supplier_id'] },
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
    { name: 'idx_supplier_documents_empresa_supplier', fields: ['empresa_id', 'supplier_id'] },
  ],
});

// ── Relaciones ──
Supplier.hasMany(SupplierOrder, { foreignKey: 'supplier_id', as: 'orders' });
Supplier.hasMany(SupplierMovement, { foreignKey: 'supplier_id', as: 'movements' });
Supplier.hasMany(SupplierDocument, { foreignKey: 'supplier_id', as: 'documents' });

// El `as` no es cosmetico. Sin el, Sequelize registra la asociacion bajo el
// nombre del modelo —'Supplier', con mayuscula— y `purchaseService` la pide
// como `as: 'supplier'`. Eso no falla al arrancar ni al cargar el modulo:
// falla con un SequelizeEagerLoadingError la primera vez que alguien abre
// Ordenes de Compra. Es exactamente lo que ya paso con SaleItem.belongsTo(Sale)
// y dejo caidos /api/reports/sales y /api/reports/profit.
SupplierOrder.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
SupplierMovement.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
SupplierDocument.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });

module.exports = { Supplier, SupplierOrder, SupplierMovement, SupplierDocument };
