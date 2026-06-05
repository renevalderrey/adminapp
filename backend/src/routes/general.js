// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Stock, Marcas, Gastos, Settings
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Stock, Brand, Product, FixedExpense, Setting } = require('../models');
const checkPermission = require('../middleware/checkPermission');

// ═══════ STOCK ═══════

// GET /api/stock — Stock (filtrado por punto de venta activo)
router.get('/stock', checkPermission('stock.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId || 1;
    const where = {
      [Op.or]: [
        { empresa_id: empresaId },
        { empresa_id: null },
      ],
    };
    if (req.puntoDeVentaId) {
      where.punto_de_venta_id = req.puntoDeVentaId;
    } else if (req.query.location) {
      where.location = req.query.location;
    }

    const stock = await Stock.findAll({
      where,
      include: [{ model: Product, as: 'product', include: [{ model: Brand, as: 'brand' }] }],
      order: [[{ model: Product, as: 'product' }, 'name', 'ASC']],
    });

    res.json({ ok: true, data: stock });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/stock/:id — Actualizar cantidad
router.put('/stock/:id', checkPermission('stock.editar'), async (req, res) => {
  try {
    const stock = await Stock.findByPk(req.params.id);
    if (!stock) return res.status(404).json({ ok: false, error: 'Registro de stock no encontrado' });
    await stock.update(req.body);
    res.json({ ok: true, data: stock });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/stock/bulk — Carga masiva de stock por sucursal
router.post('/stock/bulk', checkPermission('stock.editar'), async (req, res) => {
  try {
    const { items, location } = req.body;
    const empresaId = req.empresaId || 1;
    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'Formato inválido' });
    const loc = location || 'general';
    const pvId = req.puntoDeVentaId || null;

    let updated = 0;
    for (const item of items) {
      const where = pvId
        ? { product_id: item.product_id, punto_de_venta_id: pvId, empresa_id: empresaId }
        : { product_id: item.product_id, location: loc, empresa_id: empresaId };
      const [stock, created] = await Stock.findOrCreate({
        where,
        defaults: { quantity: item.quantity, available: item.quantity, location: loc, empresa_id: empresaId, punto_de_venta_id: pvId },
      });
      if (!created) {
        await stock.update({ quantity: item.quantity, available: item.quantity });
      }
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════ MARCAS ═══════

// GET /api/brands
router.get('/brands', checkPermission('products.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId || 1;
    const brands = await Brand.findAll({
      where: {
        [Op.or]: [
          { empresa_id: empresaId },
          { empresa_id: null },
        ],
      },
      order: [['name', 'ASC']],
    });
    res.json({ ok: true, data: brands });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/brands
router.post('/brands', checkPermission('products.crear'), async (req, res) => {
  try {
    const brand = await Brand.create({ ...req.body, empresa_id: req.empresaId || 1 });
    res.status(201).json({ ok: true, data: brand });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════ GASTOS FIJOS ═══════

// GET /api/expenses?group=gf1
router.get('/expenses', checkPermission('gastos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId || 1;
    const where = {
      [Op.or]: [
        { empresa_id: empresaId },
        { empresa_id: null },
      ],
    };
    if (req.query.group) where.group = req.query.group;
    const expenses = await FixedExpense.findAll({ where, order: [['id', 'ASC']] });
    res.json({ ok: true, data: expenses });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/expenses
router.post('/expenses', checkPermission('gastos.crear'), async (req, res) => {
  try {
    const expense = await FixedExpense.create({ ...req.body, empresa_id: req.empresaId || 1 });
    res.status(201).json({ ok: true, data: expense });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', checkPermission('gastos.editar'), async (req, res) => {
  try {
    const expense = await FixedExpense.findByPk(req.params.id);
    if (!expense) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });
    await expense.update(req.body);
    res.json({ ok: true, data: expense });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/expenses/:id
router.delete('/expenses/:id', checkPermission('gastos.eliminar'), async (req, res) => {
  try {
    const deleted = await FixedExpense.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Gasto no encontrado' });
    res.json({ ok: true, message: 'Gasto eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════ SETTINGS ═══════

// GET /api/settings — Todas las configuraciones
router.get('/settings', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId || 1;
    const settings = await Setting.findAll({
      where: {
        [Op.or]: [
          { empresa_id: empresaId },
          { empresa_id: null },
        ],
      },
    });
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    const empresa = req.empresa;
    if (empresa && empresa.settings) {
      Object.assign(obj, empresa.settings);
    }
    res.json({ ok: true, data: obj });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/settings/:key — Una configuración específica
router.get('/settings/:key', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId || 1;
    const setting = await Setting.findOne({
      where: {
        key: req.params.key,
        [Op.or]: [
          { empresa_id: empresaId },
          { empresa_id: null },
        ],
      },
    });
    res.json({ ok: true, data: setting ? setting.value : null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/settings/:key — Guardar configuración
router.put('/settings/:key', checkPermission('config.editar'), async (req, res) => {
  try {
    const [setting, created] = await Setting.findOrCreate({
      where: { key: req.params.key, empresa_id: req.empresaId || 1 },
      defaults: { value: req.body.value, empresa_id: req.empresaId || 1 },
    });
    if (!created) await setting.update({ value: req.body.value });
    res.json({ ok: true, data: setting });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/alerts — Alertas de stock mínimo y vencimientos próximos
router.get('/alerts', checkPermission('stock.ver'), async (req, res) => {
  try {
    const sequelize = require('../config/database');
    const today = new Date().toISOString().split('T')[0];
    const next30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const empresaId = req.empresaId || 1;
    const empresaOrNull = { [Op.or]: [{ empresa_id: empresaId }, { empresa_id: null }] };

    // Alertas de stock mínimo
    const lowStock = await Stock.findAll({
      where: {
        ...empresaOrNull,
        quantity: { [Op.lte]: sequelize.col('min_stock') },
        min_stock: { [Op.gt]: 0 },
      },
      include: [{ model: Product, as: 'product' }]
    });

    // Alertas de vencimiento (próximos 30 días)
    const expiringStock = await Stock.findAll({
      where: {
        ...empresaOrNull,
        expiration_date: {
          [Op.between]: [today, next30Days]
        },
      },
      include: [{ model: Product, as: 'product' }]
    });

    res.json({
      ok: true,
      data: {
        lowStock: lowStock.map(s => ({
          id: s.id,
          product_id: s.product_id,
          product_name: s.product ? s.product.name : 'Desconocido',
          location: s.location,
          punto_de_venta_id: s.punto_de_venta_id,
          quantity: s.quantity,
          min_stock: s.min_stock
        })),
        expiringStock: expiringStock.map(s => ({
          id: s.id,
          product_id: s.product_id,
          product_name: s.product ? s.product.name : 'Desconocido',
          location: s.location,
          punto_de_venta_id: s.punto_de_venta_id,
          quantity: s.quantity,
          expiration_date: s.expiration_date,
          current_batch: s.current_batch
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
