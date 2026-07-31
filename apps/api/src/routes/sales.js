const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product, Stock, StockMovement } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { verificarTotal, normalizarItem, metodoDePago, esPagoMixto } = require('../utils/calculosVenta');
const logger = require('../utils/logger');

// GET /api/sales?date=YYYY-MM-DD — Ventas de una fecha (paginado)
router.get('/', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { customer_id, page, limit } = req.query;
    const where = { date, empresa_id: req.empresaId };
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
        empresa_id: req.empresaId,
        date: { [Op.between]: [from, to] },
        status: 'active',
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

// POST /api/sales — Registrar venta (con descuento de stock)
router.post('/', checkPermission('ventas.crear'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id, date, time, total, payment_method, notes, location, seller, items, afip_cae, afip_nro, afip_vto, afip_type, customer_id, customer_name } = req.body;

    const lineas = Array.isArray(items) ? items : [];

    // El total se recalcula a partir de las lineas y NO se toma del body. Es
    // el registro contable de la operacion: si el cliente lo manda y el
    // servidor lo guarda sin mirar, cualquier bug del frontend —o cualquier
    // request armado a mano— queda asentado como si fuera real.
    //
    // Si el declarado no cierra contra las lineas se rechaza en vez de
    // corregirlo en silencio: en un punto de venta, guardar un total distinto
    // al que vio el operador y le cobro al cliente es peor que fallar.
    const verificacion = verificarTotal(total, lineas);

    if (!verificacion.ok) {
      await t.rollback();
      logger.warn(
        { empresaId: req.empresaId, declarado: verificacion.declarado, calculado: verificacion.total },
        'sales: el total declarado no coincide con las lineas'
      );
      return res.status(400).json({
        ok: false,
        error: 'TOTAL_INCONSISTENTE',
        message: `El total enviado ($${verificacion.declarado}) no coincide con la suma de los items ($${verificacion.total}).`,
      });
    }

    const saleData = {
      id, date, time, notes, location, seller,
      total: verificacion.total,
      // El metodo de pago sale de las lineas cuando todas coinciden. Antes el
      // frontend mandaba el del PRIMER item, con lo cual una venta con lineas
      // de distinto metodo quedaba registrada entera bajo el de la primera.
      // Si las lineas difieren, no se puede deducir uno solo y se respeta el
      // declarado, que es el comportamiento historico.
      payment_method: metodoDePago(lineas) || payment_method || 'ef',
      afip_cae, afip_nro, afip_vto, afip_type,
      empresa_id: req.empresaId,
      punto_de_venta_id: req.puntoDeVentaId || null,
      status: 'active',
    };
    if (customer_id) {
      saleData.customer_id = customer_id;
      saleData.customer_name = customer_name || null;
    }

    if (esPagoMixto(lineas)) {
      // Queda registrado para poder dimensionar cuantas ventas mixtas hay
      // antes de decidir como representarlas.
      logger.info(
        { empresaId: req.empresaId, metodoDeclarado: saleData.payment_method },
        'sales: venta con lineas de distinto metodo de pago'
      );
    }

    const sale = await Sale.create(saleData, { transaction: t });

    if (lineas.length) {
      const saleItems = lineas.map((item) => ({
        sale_id: sale.id,
        ...normalizarItem(item),
      }));
      await SaleItem.bulkCreate(saleItems, { transaction: t });

      for (const si of saleItems) {
        if (!si.product_id) continue;

        const stock = await Stock.findOne({
          where: {
            product_id: si.product_id,
            empresa_id: req.empresaId,
            punto_de_venta_id: req.puntoDeVentaId || null,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (stock) {
          const qty = si.quantity;
          if (stock.available < qty) {
            throw new Error(`Stock insuficiente para "${si.product_name}": disponible ${stock.available}, requerido ${qty}`);
          }
          const oldQty = stock.quantity;
          const oldAvail = stock.available;
          await stock.update({
            quantity: stock.quantity - qty,
            available: stock.available - qty,
          }, { transaction: t });

          await StockMovement.create({
            empresa_id: req.empresaId,
            product_id: si.product_id,
            punto_de_venta_id: req.puntoDeVentaId || null,
            tipo: 'sale',
            referencia_id: sale.id,
            cantidad_anterior: oldQty,
            cantidad_nueva: stock.quantity,
            disponible_anterior: oldAvail,
            disponible_nuevo: stock.available,
            usuario_id: req.userId,
          }, { transaction: t });
        }
      }
    }

    await t.commit();
    res.status(201).json({ ok: true, data: sale });
  } catch (err) {
    await t.rollback();
    if (err.message.startsWith('Stock insuficiente')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/sales/:id/void — Anular venta (restaurar stock)
router.put('/:id/void', checkPermission('ventas.anular'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Sin el filtro por empresa, este endpoint permitia anular la venta de
    // otra empresa cliente — y la anulacion devuelve stock, asi que ademas de
    // leer, alteraba su inventario.
    const sale = await findScoped(Sale, req.params.id, req.empresaId, {
      include: [{ model: SaleItem, as: 'items' }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sale) return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    if (sale.status === 'voided') return res.status(400).json({ ok: false, error: 'Venta ya anulada' });

    for (const item of sale.items || []) {
      if (!item.product_id) continue;

      const stock = await Stock.findOne({
        where: {
          product_id: item.product_id,
          empresa_id: sale.empresa_id,
          punto_de_venta_id: sale.punto_de_venta_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (stock) {
        const oldQty = stock.quantity;
        const oldAvail = stock.available;
        await stock.update({
          quantity: stock.quantity + item.quantity,
          available: stock.available + item.quantity,
        }, { transaction: t });

        await StockMovement.create({
          empresa_id: sale.empresa_id,
          product_id: item.product_id,
          punto_de_venta_id: sale.punto_de_venta_id,
          tipo: 'sale_void',
          referencia_id: sale.id,
          cantidad_anterior: oldQty,
          cantidad_nueva: stock.quantity,
          disponible_anterior: oldAvail,
          disponible_nuevo: stock.available,
          usuario_id: req.userId,
        }, { transaction: t });
      }
    }

    await sale.update({
      status: 'voided',
      voided_at: new Date(),
      voided_by: req.userId,
    }, { transaction: t });

    await t.commit();
    res.json({ ok: true, message: 'Venta anulada y stock restaurado' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
