const express = require('express');
const router = express.Router();
const { Stock, StockTransfer, Product, PuntoDeVenta, sequelize } = require('../models');
const { Op } = require('sequelize');
const checkPermission = require('../middleware/checkPermission');

// POST /api/stock/transfer — Transferir stock entre sucursales
router.post('/transfer', checkPermission('stock.transferir'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { from_location, to_location, items } = req.body;
    const empresaId = req.empresaId || 1;

    if (!from_location || !to_location) {
      return res.status(400).json({ ok: false, error: 'Origen y destino son requeridos' });
    }
    if (from_location === to_location) {
      return res.status(400).json({ ok: false, error: 'Origen y destino deben ser diferentes' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Debe incluir al menos un producto' });
    }

    const [fromPv, toPv] = await Promise.all([
      PuntoDeVenta.findOne({ where: { empresa_id: empresaId, code: from_location } }),
      PuntoDeVenta.findOne({ where: { empresa_id: empresaId, code: to_location } }),
    ]);

    const transferItems = [];

    for (const item of items) {
      const productId = item.product_id;
      const qty = parseFloat(item.quantity);
      if (!productId || qty <= 0) continue;

      const sourceWhere = { product_id: productId, empresa_id: empresaId };
      if (fromPv) {
        sourceWhere.punto_de_venta_id = fromPv.id;
      } else {
        sourceWhere.location = from_location;
      }

      const sourceStock = await Stock.findOne({
        where: sourceWhere,
        transaction: t,
      });

      if (!sourceStock || sourceStock.quantity < qty) {
        const product = await Product.findByPk(productId);
        throw new Error(`Stock insuficiente en "${from_location}" para "${product?.name || 'Producto'}" (disponible: ${sourceStock?.quantity || 0}, requerido: ${qty})`);
      }

      sourceStock.quantity -= qty;
      sourceStock.available -= qty;
      await sourceStock.save({ transaction: t });

      const destWhere = { product_id: productId, empresa_id: empresaId };
      if (toPv) {
        destWhere.punto_de_venta_id = toPv.id;
      } else {
        destWhere.location = to_location;
      }

      let destStock = await Stock.findOne({
        where: destWhere,
        transaction: t,
      });

      if (destStock) {
        destStock.quantity += qty;
        destStock.available += qty;
        await destStock.save({ transaction: t });
      } else {
        const createData = {
          product_id: productId,
          location: to_location,
          quantity: qty,
          available: qty,
          min_stock: 0,
          empresa_id: empresaId,
        };
        if (toPv) createData.punto_de_venta_id = toPv.id;
        await Stock.create(createData, { transaction: t });
      }

      const product = await Product.findByPk(productId, { transaction: t });
      transferItems.push({
        product_id: productId,
        product_name: product?.name || 'Unknown',
        quantity: qty,
      });
    }

    const transfer = await StockTransfer.create({
      from_location,
      to_location,
      from_punto_de_venta_id: fromPv?.id || null,
      to_punto_de_venta_id: toPv?.id || null,
      items: transferItems,
      empresa_id: empresaId,
    }, { transaction: t });

    await t.commit();
    res.status(201).json({ ok: true, data: transfer });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/stock/transfers — Historial
router.get('/transfers', checkPermission('stock.ver'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const { count, rows } = await StockTransfer.findAndCountAll({
      where: { empresa_id: req.empresaId || 1 },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.json({ ok: true, data: rows, total: count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
