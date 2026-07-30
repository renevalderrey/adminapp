const express = require('express');
const router = express.Router();
const { Op, fn, col } = require('sequelize');
const { Sale, SaleItem, Product, Stock, FixedExpense, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');

// GET /api/reports/sales?from=&to=
router.get('/sales', checkPermission('reportes.ver'), async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];
    const empresaId = req.empresaId || 1;

    const items = await SaleItem.findAll({
      attributes: [
        'sale_id', 'product_name', 'quantity', 'unit_price',
        [col('Sale.date'), 'sale_date'],
      ],
      include: [
        {
          model: Sale,
          as: 'sale',
          attributes: [],
          where: { empresa_id: empresaId, date: { [Op.between]: [from, to] } },
          required: true,
        },
        {
          model: Product,
          as: 'product',
          attributes: ['cost'],
          required: false,
        },
      ],
      raw: true,
    });

    const mapped = items.map(i => {
      const qty = parseFloat(i.quantity) || 0;
      const price = parseFloat(i.unit_price) || 0;
      const cost = parseFloat(i['product.cost']) || 0;
      const subtotal = qty * price;
      const totalCost = qty * cost;
      const margin = subtotal - totalCost;
      return {
        sale_id: i.sale_id,
        date: i.sale_date,
        product_name: i.product_name,
        quantity: qty,
        unit_price: price,
        cost,
        margin: Math.round(margin * 100) / 100,
        margin_pct: totalCost > 0 ? Math.round((margin / totalCost) * 100) : 0,
      };
    });

    const totalSales = mapped.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
    const totalCost = mapped.reduce((s, i) => s + (i.quantity * i.cost), 0);

    res.json({
      ok: true,
      data: {
        summary: {
          total_sales: Math.round(totalSales * 100) / 100,
          total_cost: Math.round(totalCost * 100) / 100,
          gross_profit: Math.round((totalSales - totalCost) * 100) / 100,
          margin_pct: totalSales > 0 ? Math.round(((totalSales - totalCost) / totalSales) * 100) : 0,
          sale_count: [...new Set(mapped.map(i => i.sale_id))].length,
        },
        items: mapped,
      },
    });
  } catch (err) {
    console.error('[reports/sales]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/reports/inventory
router.get('/inventory', checkPermission('reportes.ver'), async (req, res) => {
  try {
    const stock = await Stock.findAll({
      where: { empresa_id: req.empresaId || 1, quantity: { [Op.gt]: 0 } },
      include: [
        {
          model: Product,
          as: 'product',
          attributes: ['name', 'sku', 'cost', 'is_active'],
          required: true,
        },
      ],
      order: [[col('product.name'), 'ASC']],
    });

    const items = stock.map(s => {
      const qty = s.quantity;
      const cost = parseFloat(s.product?.cost) || 0;
      return {
        product_id: s.product_id,
        product_name: s.product?.name || 'Unknown',
        sku: s.product?.sku || '',
        location: s.location,
        punto_de_venta_id: s.punto_de_venta_id,
        quantity: qty,
        cost,
        total_value: Math.round(qty * cost * 100) / 100,
      };
    });

    const totalValue = items.reduce((s, i) => s + i.total_value, 0);

    res.json({
      ok: true,
      data: {
        total_value: Math.round(totalValue * 100) / 100,
        items,
      },
    });
  } catch (err) {
    console.error('[reports/inventory]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/reports/profit?from=&to=
router.get('/profit', checkPermission('reportes.ver'), async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];
    const empresaId = req.empresaId || 1;

    const totalRevenue = parseFloat(await Sale.sum('total', { where: { empresa_id: empresaId, date: { [Op.between]: [from, to] } } })) || 0;

    const costOfGoods = parseFloat(await SaleItem.sum(
      sequelize.literal('"SaleItem"."quantity" * COALESCE("product"."cost", 0)'),
      {
        include: [
          {
            model: Product,
            as: 'product',
            attributes: [],
            required: false,
          },
          {
            model: Sale,
            as: 'sale',
            attributes: [],
            where: { empresa_id: empresaId, date: { [Op.between]: [from, to] } },
            required: true,
          },
        ],
      }
    )) || 0;

    const fixedExpenses = parseFloat(await FixedExpense.sum('amount', { where: { empresa_id: empresaId } })) || 0;
    const grossProfit = totalRevenue - costOfGoods;
    const netProfit = grossProfit - fixedExpenses;

    res.json({
      ok: true,
      data: {
        period: { from, to },
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_cost_of_goods: Math.round(costOfGoods * 100) / 100,
        gross_profit: Math.round(grossProfit * 100) / 100,
        fixed_expenses: Math.round(fixedExpenses * 100) / 100,
        net_profit: Math.round(netProfit * 100) / 100,
        net_margin_pct: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0,
      },
    });
  } catch (err) {
    console.error('[reports/profit]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
