const express = require('express');
const router = express.Router();
const productionService = require('../services/productionService');
const checkPermission = require('../middleware/checkPermission');
const logger = require('../utils/logger');

router.get('/', checkPermission('produccion.ver'), async (req, res) => {
  try {
    const result = await productionService.listProductionOrders(req.query, req.empresaId);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'production:list');
    res.status(500).json({ ok: false, error: 'Error al listar las órdenes' });
  }
});

router.get('/:id', checkPermission('produccion.ver'), async (req, res) => {
  try {
    const order = await productionService.getProductionOrder(req.params.id, req.empresaId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Orden de producción no encontrada' });
    }
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/', checkPermission('produccion.crear'), async (req, res) => {
  try {
    const result = await productionService.createProductionOrder(req.body, req.empresaId, req.puntoDeVentaId || null);
    res.status(201).json({
      ok: true,
      data: result.order,
      warnings: result.warnings,
    });
  } catch (err) {
    if (err.message === 'Producto no encontrado') {
      return res.status(404).json({ ok: false, error: err.message });
    }
    if (err.message.includes('no tiene una receta') || err.message.includes('debe ser mayor a 0')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    logger.error({ err, empresaId: req.empresaId }, 'production:create');
    res.status(500).json({ ok: false, error: 'Error al crear la orden de producción' });
  }
});

router.post('/:id/void', checkPermission('produccion.anular'), async (req, res) => {
  try {
    const order = await productionService.voidProductionOrder(req.params.id, req.empresaId);
    res.json({
      ok: true,
      data: { id: order.id, status: order.status, voided_at: order.voided_at },
      message: 'Orden anulada. Stock revertido correctamente.',
    });
  } catch (err) {
    if (err.message === 'Orden de producción no encontrada') {
      return res.status(404).json({ ok: false, error: err.message });
    }
    if (err.message === 'La orden ya se encuentra anulada') {
      return res.status(400).json({ ok: false, error: err.message });
    }
    logger.error({ err, empresaId: req.empresaId }, 'production:void');
    res.status(500).json({ ok: false, error: 'Error al anular la orden' });
  }
});

module.exports = router;
