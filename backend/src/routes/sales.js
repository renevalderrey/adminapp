// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Ventas
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const checkPermission = require('../middleware/checkPermission');

// GET /api/sales?date=YYYY-MM-DD — Ventas de una fecha (paginado)
router.get('/', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { customer_id, page, limit } = req.query;
    const where = { date, empresa_id: req.empresaId || 1 };
    if (req.puntoDeVentaId) {
      where.punto_de_venta_id = req.puntoDeVentaId;
    } else if (req.query.location) {
      where.location = req.query.location;
    }
    if (customer_id) where.customer_id = customer_id;

    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || null;
    const offset = pageLimit ? (pageNum - 1) * pageLimit : null;

    const queryOpts = {
      where,
      include: [{ model: SaleItem, as: 'items' }],
      order: [['time', 'ASC']],
    };

    if (pageLimit) {
      queryOpts.limit = pageLimit;
      queryOpts.offset = offset;
    }

    const { count, rows } = await Sale.findAndCountAll(queryOpts);

    res.json({
      ok: true,
      data: rows,
      total: count,
      page: pageNum,
      totalPages: pageLimit ? Math.ceil(count / pageLimit) : 1,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD — Resumen por período
router.get('/summary', checkPermission('ventas.ver'), async (req, res) => {
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
        empresa_id: req.empresaId || 1,
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
router.post('/', checkPermission('ventas.crear'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id, date, time, total, payment_method, notes, location, seller, items, afip_cae, afip_nro, afip_vto, afip_type, customer_id, customer_name } = req.body;

    const saleData = { id, date, time, total, payment_method, notes, location, seller, afip_cae, afip_nro, afip_vto, afip_type, empresa_id: req.empresaId || 1, punto_de_venta_id: req.puntoDeVentaId || null };
    if (customer_id) {
      saleData.customer_id = customer_id;
      saleData.customer_name = customer_name || null;
    }

    const sale = await Sale.create(saleData, { transaction: t });

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
router.delete('/:id', checkPermission('ventas.anular'), async (req, res) => {
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
