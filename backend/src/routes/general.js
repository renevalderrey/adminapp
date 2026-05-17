// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Stock, Marcas, Gastos, Settings
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Stock, Brand, Product, FixedExpense, Setting } = require('../models');

// ═══════ STOCK ═══════

// GET /api/stock?location=general — Stock por sucursal
router.get('/stock', async (req, res) => {
  try {
    const { location } = req.query;
    const where = {};
    if (location) where.location = location;

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
router.put('/stock/:id', async (req, res) => {
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
router.post('/stock/bulk', async (req, res) => {
  try {
    const { items, location } = req.body; // [{ product_id, quantity }]
    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'Formato inválido' });
    const loc = location || 'general';

    let updated = 0;
    for (const item of items) {
      const [stock, created] = await Stock.findOrCreate({
        where: { product_id: item.product_id, location: loc },
        defaults: { quantity: item.quantity, available: item.quantity },
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
router.get('/brands', async (req, res) => {
  try {
    const brands = await Brand.findAll({ order: [['name', 'ASC']] });
    res.json({ ok: true, data: brands });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/brands
router.post('/brands', async (req, res) => {
  try {
    const brand = await Brand.create(req.body);
    res.status(201).json({ ok: true, data: brand });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════ GASTOS FIJOS ═══════

// GET /api/expenses?group=gf1
router.get('/expenses', async (req, res) => {
  try {
    const where = {};
    if (req.query.group) where.group = req.query.group;
    const expenses = await FixedExpense.findAll({ where, order: [['id', 'ASC']] });
    res.json({ ok: true, data: expenses });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/expenses
router.post('/expenses', async (req, res) => {
  try {
    const expense = await FixedExpense.create(req.body);
    res.status(201).json({ ok: true, data: expense });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', async (req, res) => {
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
router.delete('/expenses/:id', async (req, res) => {
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
router.get('/settings', async (req, res) => {
  try {
    const settings = await Setting.findAll();
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json({ ok: true, data: obj });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/settings/:key — Una configuración específica
router.get('/settings/:key', async (req, res) => {
  try {
    const setting = await Setting.findByPk(req.params.key);
    res.json({ ok: true, data: setting ? setting.value : null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/settings/:key — Guardar configuración
router.put('/settings/:key', async (req, res) => {
  try {
    const [setting, created] = await Setting.findOrCreate({
      where: { key: req.params.key },
      defaults: { value: req.body.value },
    });
    if (!created) await setting.update({ value: req.body.value });
    res.json({ ok: true, data: setting });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
