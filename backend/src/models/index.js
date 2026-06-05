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
const Recipe = require('./Recipe');
const RecipeItem = require('./RecipeItem');
const ProductCostHistory = require('./ProductCostHistory');
const ProductionOrder = require('./ProductionOrder');
const ProductionOrderItem = require('./ProductionOrderItem');
const Customer = require('./Customer');
const CustomerPayment = require('./CustomerPayment');
const CashFlowEntry = require('./CashFlowEntry');
const StockTransfer = require('./StockTransfer');
const TaxConfig = require('./TaxConfig');
const TaxPayment = require('./TaxPayment');
const Empresa = require('./Empresa');
const PuntoDeVenta = require('./PuntoDeVenta');
const Usuario = require('./Usuario');
const UsuarioEmpresa = require('./UsuarioEmpresa');
const Suscripcion = require('./Suscripcion');
const Invitacion = require('./Invitacion');
const Permiso = require('./Permiso');
const Rol = require('./Rol');
const RolPermiso = require('./RolPermiso');
const UsuarioPermiso = require('./UsuarioPermiso');

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

// Product ↔ Recipe (Elaborado)
Product.hasOne(Recipe, { foreignKey: 'product_id', as: 'recipe', onDelete: 'CASCADE' });
Recipe.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Recipe ↔ RecipeItem
Recipe.hasMany(RecipeItem, { foreignKey: 'recipe_id', as: 'items', onDelete: 'CASCADE' });
RecipeItem.belongsTo(Recipe, { foreignKey: 'recipe_id', as: 'recipe' });

// Product ↔ RecipeItem (Ingrediente)
Product.hasMany(RecipeItem, { foreignKey: 'ingredient_product_id', as: 'usedInRecipes', onDelete: 'RESTRICT' });
RecipeItem.belongsTo(Product, { foreignKey: 'ingredient_product_id', as: 'ingredient' });

// Product ↔ ProductCostHistory
Product.hasMany(ProductCostHistory, { foreignKey: 'product_id', as: 'costHistory', onDelete: 'CASCADE' });
ProductCostHistory.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Customer ↔ CustomerPayment
Customer.hasMany(CustomerPayment, { foreignKey: 'customer_id', as: 'payments', onDelete: 'CASCADE' });
CustomerPayment.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

// Customer ↔ Sale
Customer.hasMany(Sale, { foreignKey: 'customer_id', as: 'sales' });
Sale.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

// ProductionOrder ↔ ProductionOrderItem
ProductionOrder.hasMany(ProductionOrderItem, { foreignKey: 'production_order_id', as: 'items', onDelete: 'CASCADE' });
ProductionOrderItem.belongsTo(ProductionOrder, { foreignKey: 'production_order_id', as: 'productionOrder' });

// Product ↔ ProductionOrder
Product.hasMany(ProductionOrder, { foreignKey: 'product_id', as: 'productionOrders' });
ProductionOrder.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Product ↔ ProductionOrderItem (ingrediente consumido)
Product.hasMany(ProductionOrderItem, { foreignKey: 'ingredient_product_id', as: 'usedInProduction' });
ProductionOrderItem.belongsTo(Product, { foreignKey: 'ingredient_product_id', as: 'ingredient' });

// ── Empresa ──
Empresa.hasMany(PuntoDeVenta, { foreignKey: 'empresa_id', as: 'puntosDeVenta' });
PuntoDeVenta.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });

Empresa.hasMany(UsuarioEmpresa, { foreignKey: 'empresa_id', as: 'usuarios' });
UsuarioEmpresa.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });

// ── Usuario ──
Usuario.hasMany(UsuarioEmpresa, { foreignKey: 'usuario_id', as: 'empresas' });
UsuarioEmpresa.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });

// ── Suscripcion ──
Empresa.hasOne(Suscripcion, { foreignKey: 'empresa_id', as: 'suscripcion' });
Suscripcion.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });

// ── Invitacion ──
Empresa.hasMany(Invitacion, { foreignKey: 'empresa_id', as: 'invitaciones' });
Invitacion.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });
Invitacion.belongsTo(Usuario, { foreignKey: 'invited_by', as: 'invitador' });

// ── PuntoDeVenta ──
PuntoDeVenta.hasMany(Stock, { foreignKey: 'punto_de_venta_id', as: 'stockEntries' });
Stock.belongsTo(PuntoDeVenta, { foreignKey: 'punto_de_venta_id', as: 'puntoDeVenta' });

PuntoDeVenta.hasMany(Sale, { foreignKey: 'punto_de_venta_id', as: 'sales' });
Sale.belongsTo(PuntoDeVenta, { foreignKey: 'punto_de_venta_id', as: 'puntoDeVenta' });

PuntoDeVenta.hasMany(ProductionOrder, { foreignKey: 'punto_de_venta_id', as: 'productionOrders' });
ProductionOrder.belongsTo(PuntoDeVenta, { foreignKey: 'punto_de_venta_id', as: 'puntoDeVenta' });

PuntoDeVenta.hasMany(CashFlowEntry, { foreignKey: 'punto_de_venta_id', as: 'cashFlowEntries' });
CashFlowEntry.belongsTo(PuntoDeVenta, { foreignKey: 'punto_de_venta_id', as: 'puntoDeVenta' });

PuntoDeVenta.hasMany(StockTransfer, { foreignKey: 'from_punto_de_venta_id', as: 'transfersFrom' });
PuntoDeVenta.hasMany(StockTransfer, { foreignKey: 'to_punto_de_venta_id', as: 'transfersTo' });
StockTransfer.belongsTo(PuntoDeVenta, { foreignKey: 'from_punto_de_venta_id', as: 'fromPuntoDeVenta' });
StockTransfer.belongsTo(PuntoDeVenta, { foreignKey: 'to_punto_de_venta_id', as: 'toPuntoDeVenta' });

// ── Permisos ──
Rol.hasMany(RolPermiso, { foreignKey: 'rol_id', as: 'permisos' });
RolPermiso.belongsTo(Rol, { foreignKey: 'rol_id', as: 'rol' });

Rol.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });
Empresa.hasMany(Rol, { foreignKey: 'empresa_id', as: 'roles' });

// Rol por defecto en UsuarioEmpresa
UsuarioEmpresa.belongsTo(Rol, { foreignKey: 'rol_id', as: 'rol' });
Rol.hasMany(UsuarioEmpresa, { foreignKey: 'rol_id', as: 'usuarios' });

// Overrides de permisos por usuario
UsuarioEmpresa.hasMany(UsuarioPermiso, { foreignKey: 'usuario_empresa_id', as: 'permisos' });
UsuarioPermiso.belongsTo(UsuarioEmpresa, { foreignKey: 'usuario_empresa_id', as: 'usuarioEmpresa' });

PuntoDeVenta.hasMany(UsuarioPermiso, { foreignKey: 'punto_de_venta_id', as: 'permisosUsuario' });
UsuarioPermiso.belongsTo(PuntoDeVenta, { foreignKey: 'punto_de_venta_id', as: 'puntoDeVenta' });

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
  Recipe,
  RecipeItem,
  ProductCostHistory,
  ProductionOrder,
  ProductionOrderItem,
  Customer,
  CustomerPayment,
  CashFlowEntry,
  StockTransfer,
  TaxConfig,
  TaxPayment,
  Empresa,
  PuntoDeVenta,
  Usuario,
  UsuarioEmpresa,
  Suscripcion,
  Invitacion,
  Permiso,
  Rol,
  RolPermiso,
  UsuarioPermiso,
};
