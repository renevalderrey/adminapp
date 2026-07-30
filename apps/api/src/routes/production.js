const express = require('express');
const router = express.Router();
const productionService = require('../services/productionService');
const checkPermission = require('../middleware/checkPermission');

router.get('/', checkPermission('produccion.ver'), async (req, res) => {
  try {
    const result = await productionService.listProductionOrders(req.query, req.empresaId || 1);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[production:list]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:id', checkPermission('produccion.ver'), async (req, res) => {
  try {
    const order = await productionService.getProductionOrder(req.params.id);
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
    const result = await productionService.createProductionOrder(req.body, req.empresaId || 1, req.puntoDeVentaId || null);
    res.status(201).json({
      ok: true,
      data: result.order,
      warnings: result.warnings,
    });
  } catch (err) {
    if (err.message.includes('no tiene una receta') || err.message.includes('debe ser mayor a 0')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('[production:create]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/void', checkPermission('produccion.anular'), async (req, res) => {
  try {
    const order = await productionService.voidProductionOrder(req.params.id);
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
    console.error('[production:void]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
