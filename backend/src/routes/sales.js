// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Ventas
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');

// GET /api/sales?date=YYYY-MM-DD — Ventas de una fecha
router.get('/', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { location } = req.query;
    const where = { date };
    if (location) where.location = location;

    const sales = await Sale.findAll({
      where,
      include: [{ model: SaleItem, as: 'items' }],
      order: [['time', 'ASC']],
    });

    res.json({ ok: true, data: sales });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD — Resumen por período
router.get('/summary', async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    const summary = await Sale.findAll({
      attributes: [
        'date',
        'payment_method',
        [sequelize.fn('COUNT', sequelize.col('Sale.id')), 'count'],
        [sequelize.fn('SUM', sequelize.col('total')), 'total'],
      ],
      where: {
        date: { [Op.between]: [from, to] },
      },
      group: ['date', 'payment_method'],
      order: [['date', 'DESC']],
      raw: true,
    });

    res.json({ ok: true, data: summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sales — Registrar venta
router.post('/', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id, date, time, total, payment_method, notes, location, seller, items, afip_cae, afip_nro, afip_vto, afip_type } = req.body;

    const sale = await Sale.create(
      { id, date, time, total, payment_method, notes, location, seller, afip_cae, afip_nro, afip_vto, afip_type },
      { transaction: t }
    );

    if (Array.isArray(items) && items.length) {
      const saleItems = items.map(item => ({
        sale_id: sale.id,
        product_name: item.product_name || item.n || 'Producto',
        product_id: item.product_id || null,
        quantity: item.quantity || item.qty || 1,
        unit_price: item.unit_price || item.precio || 0,
        payment_method: item.payment_method || item.mp || null,
      }));
      await SaleItem.bulkCreate(saleItems, { transaction: t });
    }

    await t.commit();
    res.status(201).json({ ok: true, data: sale });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/sales/:id — Eliminar venta
router.delete('/:id', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    await SaleItem.destroy({ where: { sale_id: req.params.id }, transaction: t });
    const deleted = await Sale.destroy({ where: { id: req.params.id }, transaction: t });
    await t.commit();
    if (!deleted) return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    res.json({ ok: true, message: 'Venta eliminada' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
