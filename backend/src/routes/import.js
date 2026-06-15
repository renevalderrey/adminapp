const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { Product, Brand, Supplier, Stock, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const logger = require('../utils/logger');

const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) return cb(null, true);
    cb(new Error('Formato no soportado. Subí CSV o Excel (.xlsx / .xls)'));
  },
});

const BASE_COLUMN_MAP = {
  nombre: 'name',
  name: 'name',
  descripcion: 'description',
  description: 'description',
  sku: 'sku',
  codigo: 'sku',
  codigo_barras: 'barcode',
  barcode: 'barcode',
  costo: 'cost',
  cost: 'cost',
  precio_costo: 'cost',
  marca: 'brand_name',
  brand: 'brand_name',
  proveedor: 'supplier_name',
  supplier: 'supplier_name',
  margen: 'margin_override',
  margen_personalizado: 'margin_override',
  precio_venta: 'price_override',
  precio: 'price_override',
  margen_mayorista: 'wholesale_margin',
  precio_mayorista: 'wholesale_price',
  categoria: 'category',
  category: 'category',
  unidad: 'unit_type',
  unit_type: 'unit_type',
  tamaño_envase: 'unit_size',
  unit_size: 'unit_size',
  gravado: 'taxed',
  taxed: 'taxed',
  imagen: 'image_url',
  image_url: 'image_url',
  activo: 'is_active',
  is_active: 'is_active',
  stock: 'quantity',
  cantidad: 'quantity',
  quantity: 'quantity',
  sucursal: 'location',
  location: 'location',
  lote: 'current_batch',
  vencimiento: 'expiration_date',
  fecha_compra: 'purchase_date',
  stock_minimo: 'min_stock',
};

const TEMPLATES = {
  products: {
    headers: [
      { header: 'nombre', key: 'name', note: 'Obligatorio' },
      { header: 'sku', key: 'sku', note: 'Código interno' },
      { header: 'codigo_barras', key: 'barcode', note: '' },
      { header: 'costo', key: 'cost', note: 'Número, ej: 1500.50' },
      { header: 'marca', key: 'brand_name', note: 'Nombre de la marca' },
      { header: 'proveedor', key: 'supplier_name', note: 'Nombre del proveedor' },
      { header: 'margen_personalizado', key: 'margin_override', note: 'Porcentaje, ej: 40' },
      { header: 'precio_venta', key: 'price_override', note: 'Precio manual, anula margen' },
      { header: 'categoria', key: 'category', note: 'proteina, creatina, pre, etc' },
      { header: 'unidad', key: 'unit_type', note: 'unidad / kg / gr / litro / ml' },
      { header: 'tamaño_envase', key: 'unit_size', note: 'Ej: 500 (gr), 1 (kg)' },
      { header: 'gravado', key: 'taxed', note: 'true / false' },
      { header: 'stock', key: 'quantity', note: 'Cantidad en inventario' },
      { header: 'sucursal', key: 'location', note: 'general / ortiz / mayo' },
      { header: 'lote', key: 'current_batch', note: '' },
      { header: 'vencimiento', key: 'expiration_date', note: 'YYYY-MM-DD' },
    ],
  },
  sales: {
    headers: [
      { header: 'fecha', key: 'date', note: 'YYYY-MM-DD, Obligatorio' },
      { header: 'hora', key: 'time', note: 'HH:mm' },
      { header: 'producto', key: 'product_name', note: 'Nombre del producto, Obligatorio' },
      { header: 'cantidad', key: 'quantity', note: 'Número entero' },
      { header: 'precio_unitario', key: 'unit_price', note: 'Precio por unidad' },
      { header: 'total', key: 'total', note: 'Total de la venta' },
      { header: 'metodo_pago', key: 'payment_method', note: 'ef / tr / td / tc1 / qr' },
      { header: 'cliente', key: 'customer_name', note: 'Nombre del cliente' },
      { header: 'sucursal', key: 'location', note: 'general / ortiz / mayo' },
    ],
  },
  customers: {
    headers: [
      { header: 'nombre', key: 'name', note: 'Obligatorio' },
      { header: 'cuit', key: 'tax_id', note: 'Sin guiones' },
      { header: 'email', key: 'email', note: '' },
      { header: 'telefono', key: 'phone', note: '' },
      { header: 'direccion', key: 'address', note: '' },
      { header: 'condicion_iva', key: 'tax_condition', note: 'consumidor_final / responsable_inscripto / monotributo' },
    ],
  },
  suppliers: {
    headers: [
      { header: 'nombre', key: 'name', note: 'Obligatorio' },
      { header: 'cuit', key: 'cuit', note: '' },
      { header: 'email', key: 'email', note: '' },
      { header: 'telefono', key: 'phone', note: '' },
      { header: 'direccion', key: 'address', note: '' },
    ],
  },
};

function buildColumnMap(override) {
  if (!override || typeof override !== 'object') return BASE_COLUMN_MAP;
  const merged = { ...BASE_COLUMN_MAP };
  for (const [userColumn, systemField] of Object.entries(override)) {
    const normalized = userColumn.toLowerCase().trim().replace(/\s+/g, '_').replace(/[áéíóú]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' })[c] || c);
    merged[normalized] = systemField;
  }
  return merged;
}

function mapRow(row, columnMap) {
  const mapped = {};
  for (const [col, val] of Object.entries(row)) {
    const normalized = col.toLowerCase().trim().replace(/\s+/g, '_').replace(/[áéíóú]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' })[c] || c);
    const target = columnMap[normalized];
    if (target) mapped[target] = val;
  }
  return mapped;
}

// GET /api/import/template/:type — Descargar plantilla Excel
router.get('/template/:type', checkPermission('products.crear'), (req, res) => {
  try {
    const type = req.params.type;
    const config = TEMPLATES[type];
    if (!config) return res.status(404).json({ ok: false, error: 'Tipo de plantilla no válido. Usá: products, sales, customers, suppliers' });

    const wb = XLSX.utils.book_new();
    const wsData = [config.headers.map(h => h.header)];
    wsData.push(config.headers.map(h => h.note));
    wsData.push([]);
    const sampleRow = config.headers.reduce((acc, h) => {
      acc[h.header] = '';
      return acc;
    }, {});
    wsData.push(Object.values(sampleRow));

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = config.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="plantilla_${type}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/import/products — Importar productos desde CSV o Excel
router.post('/products', checkPermission('products.crear'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Subí un archivo CSV o Excel' });

    let userMapping = {};
    if (req.body.mapping) {
      try {
        userMapping = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
      } catch { /* silent */ }
    }
    logger.info({ userMapping, bodyMapping: req.body.mapping }, 'Import mapping debug');
    const columnMap = buildColumnMap(userMapping);

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rows = [];

    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf-8');
      const wb = XLSX.read(content, { type: 'string', raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      const wb = XLSX.readFile(filePath, { raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    }

    fs.unlinkSync(filePath);

    if (rows.length === 0) return res.status(400).json({ ok: false, error: 'El archivo está vacío' });

    const empresaId = req.empresaId || 1;
    let created = 0, updated = 0, errors = [];

    for (const [i, raw] of rows.entries()) {
      try {
        const data = mapRow(raw, columnMap);
        if (!data.name && !data.sku) {
          errors.push({ fila: i + 2, error: 'Falta nombre o sku' });
          continue;
        }

        let brandId = null;
        if (data.brand_name) {
          const [brand] = await Brand.findOrCreate({
            where: { name: data.brand_name, empresa_id: empresaId },
            defaults: { empresa_id: empresaId },
          });
          brandId = brand.id;
        }

        let supplierId = null;
        if (data.supplier_name) {
          const [supplier] = await Supplier.findOrCreate({
            where: { name: data.supplier_name, empresa_id: empresaId },
            defaults: { empresa_id: empresaId },
          });
          supplierId = supplier.id;
        }

        const cost = parseFloat(data.cost) || 0;
        const marginOverride = data.margin_override !== undefined ? parseFloat(data.margin_override) : undefined;
        const priceOverride = data.price_override !== undefined ? parseFloat(data.price_override) : undefined;
        const wholesaleMargin = data.wholesale_margin !== undefined ? parseFloat(data.wholesale_margin) : undefined;
        const wholesalePrice = data.wholesale_price !== undefined ? parseFloat(data.wholesale_price) : undefined;
        const unitSize = data.unit_size !== undefined ? parseFloat(data.unit_size) : undefined;
        const taxed = data.taxed !== undefined ? (data.taxed === 'true' || data.taxed === true || data.taxed === '1' || data.taxed === 1) : undefined;
        const isActive = data.is_active !== undefined ? (data.is_active === 'true' || data.is_active === true || data.is_active === '1' || data.is_active === 1) : undefined;

        let product = null;
        if (data.sku) product = await Product.findOne({ where: { sku: data.sku, empresa_id: empresaId } });
        if (!product) product = await Product.findOne({ where: { name: data.name, empresa_id: empresaId } });

        const productData = {
          name: data.name, description: data.description, sku: data.sku, barcode: data.barcode,
          cost, brand_id: brandId, supplier_id: supplierId,
          category: data.category || 'otro',
          unit_type: data.unit_type, unit_size: unitSize,
          taxed, image_url: data.image_url,
          empresa_id: empresaId,
        };

        if (marginOverride !== undefined) productData.margin_override = marginOverride;
        if (priceOverride !== undefined) productData.price_override = priceOverride;
        if (wholesaleMargin !== undefined) productData.wholesale_margin = wholesaleMargin;
        if (wholesalePrice !== undefined) productData.wholesale_price = wholesalePrice;
        if (isActive !== undefined) productData.is_active = isActive;

        if (product) {
          await product.update(productData);
          updated++;
        } else {
          product = await Product.create(productData);
          created++;
        }

        if (data.quantity !== undefined) {
          const qty = parseInt(data.quantity) || 0;
          const location = data.location || 'general';
          const [stock] = await Stock.findOrCreate({
            where: { product_id: product.id, location, empresa_id: empresaId },
            defaults: { quantity: qty, available: qty, location, empresa_id: empresaId, min_stock: parseInt(data.min_stock) || 0, current_batch: data.current_batch || null, expiration_date: data.expiration_date || null, purchase_date: data.purchase_date || null },
          });
          if (!stock.isNewRecord) {
            await stock.update({ quantity: qty, available: qty });
          }
        }
      } catch (err) {
        errors.push({ fila: i + 2, error: err.message });
      }
    }

    res.json({
      ok: true,
      created, updated, errors: errors.length > 0 ? errors : undefined,
      total: rows.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
