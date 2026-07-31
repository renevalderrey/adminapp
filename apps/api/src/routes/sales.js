const express = require('express');
const router = express.Router();
const { Sale, SaleItem, Product, Stock, StockMovement, Empresa } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { verificarTotal, normalizarItem, metodoDePago, esPagoMixto } = require('../utils/calculosVenta');
const logger = require('../utils/logger');
const { fechaDelNegocio, horaDelNegocio } = require('../utils/fechas');
const afipService = require('../services/afipService');

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
    const { id, date, time, total, payment_method, notes, location, seller, items, afip_cae, afip_nro, afip_vto, afip_type, customer_id, customer_name, is_credit } = req.body;

    const lineas = Array.isArray(items) ? items : [];

    // Una cantidad negativa pasaba el control de stock (available < -5 es
    // falso) y despues hacia quantity - (-5), es decir SUMABA inventario.
    // Registrar una venta con cantidad -5 creaba mercaderia de la nada.
    const invalida = lineas
      .map((item, i) => ({ i, ...normalizarItem(item) }))
      .find((l) => l.quantity <= 0 || l.unit_price < 0);

    if (invalida) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        error: 'ITEM_INVALIDO',
        message: `El item "${invalida.product_name}" tiene cantidad o precio inválidos (cantidad ${invalida.quantity}, precio ${invalida.unit_price}).`,
      });
    }

    // El total se recalcula a partir de las lineas y NO se toma del body. Es
    // el registro contable de la operacion: si el cliente lo manda y el
    // servidor lo guarda sin mirar, cualquier bug del frontend —o cualquier
    // request armado a mano— queda asentado como si fuera real.
    //
    // Si el declarado no cierra contra las lineas se rechaza en vez de
    // corregirlo en silencio: en un punto de venta, guardar un total distinto
    // al que vio el operador y le cobro al cliente es peor que fallar.
    const advertencias = [];

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

    // La fecha y la hora las decide el SERVIDOR, en la zona horaria del
    // negocio. Antes venian del navegador con toISOString(), que devuelve UTC:
    // en Argentina (UTC-3), una venta de las 21:30 quedaba asentada al dia
    // siguiente. Eso corre el cierre de caja, el listado del dia y los reportes.
    //
    // Que las decida el servidor ademas evita que el reloj de una caja
    // desconfigurada meta ventas con fecha equivocada.
    const empresa = await Empresa.findByPk(req.empresaId, {
      attributes: ['timezone'],
      transaction: t,
    });
    const zona = empresa && empresa.timezone;

    const saleData = {
      id,
      date: date || fechaDelNegocio(zona),
      time: time || horaDelNegocio(zona),
      notes, location, seller,
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
      // Al contado salvo que se pida lo contrario. Sin cliente asignado no
      // puede haber cuenta corriente.
      saleData.is_credit = is_credit === true || is_credit === 'true';
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

        // Sin fila de stock para ese punto de venta, la venta se registraba y
        // no se descontaba nada, sin ningun aviso. Es el caso tipico cuando el
        // stock se cargo sin sucursal y el POS opera con una: el inventario
        // nunca baja y el faltante aparece recien en un recuento fisico.
        //
        // No se rechaza la venta —hay rubros que venden servicios sin stock—
        // pero se avisa en la respuesta y queda en el log.
        if (!stock) {
          advertencias.push(
            `No hay stock cargado para "${si.product_name}" en este punto de venta: no se descontó inventario.`
          );
          logger.warn(
            { empresaId: req.empresaId, productId: si.product_id, puntoDeVentaId: req.puntoDeVentaId || null },
            'sales: venta sin fila de stock, no se descuenta'
          );
        }

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
    res.status(201).json({ ok: true, data: sale, warnings: advertencias });
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
    //
    // El lock va SIN include a proposito. Con un include, Sequelize arma
    // "SELECT ... LEFT OUTER JOIN sale_items ... FOR UPDATE", y PostgreSQL lo
    // rechaza: "FOR UPDATE cannot be applied to the nullable side of an outer
    // join". La consulta fallaba siempre y ninguna venta se podia anular.
    // Los items se traen aparte, ya con la venta bloqueada.
    const sale = await findScoped(Sale, req.params.id, req.empresaId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    }
    if (sale.status === 'voided') {
      await t.rollback();
      return res.status(400).json({ ok: false, error: 'Venta ya anulada' });
    }

    const items = await SaleItem.findAll({
      where: { sale_id: sale.id },
      transaction: t,
    });

    for (const item of items) {
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

// POST /api/sales/:id/facturar — Pedir el CAE de una venta ya registrada
//
// ── Por qué existe ──
//
// El POS pedía el CAE a AFIP y DESPUÉS guardaba la venta. Si el guardado
// fallaba —red, validación, stock insuficiente— quedaba un comprobante fiscal
// emitido, con número de AFIP consumido, sin ningún registro en el sistema. El
// usuario veía un error genérico y no tenía forma de enterarse de que acababa
// de emitirse una factura a su nombre.
//
// Dando vuelta el orden, el peor caso cambia por completo:
//   - Si falla el guardado → no se pidió ningún CAE. No hay nada huérfano.
//   - Si falla AFIP → la venta existe sin comprobante, y se puede reintentar.
//
// Además el importe que se declara sale de la venta PERSISTIDA, no del carrito
// del navegador: antes podían diferir y nadie lo comparaba.
router.post('/:id/facturar', checkPermission('ventas.crear'), async (req, res) => {
  try {
    const { type, customerCuit, customerVatCondition, pv } = req.body;

    const sale = await findScoped(Sale, req.params.id, req.empresaId);
    if (!sale) return res.status(404).json({ ok: false, error: 'Venta no encontrada' });

    if (sale.status === 'voided') {
      return res.status(400).json({ ok: false, error: 'No se puede facturar una venta anulada' });
    }

    // Idempotente: un reintento sobre una venta ya facturada devuelve el CAE
    // que tiene, en vez de pedir otro y duplicar el comprobante.
    if (sale.afip_cae) {
      return res.json({
        ok: true,
        yaFacturada: true,
        data: {
          cae: sale.afip_cae,
          expiration: sale.afip_vto,
          voucherNumber: sale.afip_nro,
          type: sale.afip_type,
        },
      });
    }

    const puntoDeVenta = parseInt(pv, 10);
    if (!Number.isInteger(puntoDeVenta)) {
      return res.status(400).json({ ok: false, error: 'Falta el punto de venta de AFIP' });
    }

    const resultado = await afipService.createVoucher({
      type: parseInt(type, 10) || 6,
      pv: puntoDeVenta,
      customerCuit,
      // El importe sale de la venta guardada, que es el que ya se validó
      // contra las líneas.
      amount: parseFloat(sale.total),
      customerVatCondition: parseInt(customerVatCondition, 10) || 5,
      empresaId: req.empresaId,
    });

    await sale.update({
      afip_cae: resultado.cae,
      afip_nro: resultado.voucherNumber,
      afip_vto: resultado.expiration,
      afip_type: resultado.type,
    });

    logger.info(
      { empresaId: req.empresaId, saleId: sale.id, cae: resultado.cae },
      'sales: comprobante emitido'
    );

    res.json({ ok: true, data: resultado });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId, saleId: req.params.id }, 'sales: error al facturar');

    // El mensaje de AFIP se devuelve tal cual: el usuario necesita saber por
    // qué le rechazaron el comprobante para poder corregirlo. La venta quedó
    // guardada, así que puede reintentar.
    res.status(502).json({
      ok: false,
      error: err.message,
      message: 'La venta quedó registrada pero no se pudo emitir el comprobante. Podés reintentar desde el listado de ventas.',
    });
  }
});

module.exports = router;
