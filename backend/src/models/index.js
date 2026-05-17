// ════════════════════════════════════════════
//  COMPRAFIT · Models Index
//  Importa todos los modelos y define relaciones
// ════════════════════════════════════════════

const sequelize = require('../config/database');

// Importar modelos
const Brand = require('./Brand');
const Product = require('./Product');
const Stock = require('./Stock');
const { Sale, SaleItem } = require('./Sale');
const { Supplier, SupplierOrder, SupplierMovement, SupplierDocument } = require('./Supplier');
const FixedExpense = require('./FixedExpense');
const Setting = require('./Setting');

// ── Relaciones ──

// Product ↔ Brand
Brand.hasMany(Product, { foreignKey: 'brand_id', as: 'products' });
Product.belongsTo(Brand, { foreignKey: 'brand_id', as: 'brand' });

// Product ↔ Stock
Product.hasMany(Stock, { foreignKey: 'product_id', as: 'stock' });
Stock.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Product ↔ SaleItem (opcional, los productos pueden ser eliminados)
Product.hasMany(SaleItem, { foreignKey: 'product_id', as: 'saleItems' });
SaleItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

module.exports = {
  sequelize,
  Brand,
  Product,
  Stock,
  Sale,
  SaleItem,
  Supplier,
  SupplierOrder,
  SupplierMovement,
  SupplierDocument,
  FixedExpense,
  Setting,
};
