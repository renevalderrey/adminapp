const express = require('express');
const router = express.Router();
const taxService = require('../services/taxService');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');

router.get('/config/:taxType', checkPermission('config.ver'), async (req, res) => {
  try {
    const config = await taxService.getConfig(req.params.taxType, req.empresaId);
    res.json({ ok: true, data: config });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la configuración impositiva');
  }
});

router.put('/config/:taxType', checkPermission('config.editar'), async (req, res) => {
  try {
    const config = await taxService.updateConfig(req.params.taxType, req.body.config, req.empresaId);
    res.json({ ok: true, data: config });
  } catch (err) {
    fallo(req, res, err, 'Error al guardar la configuración impositiva');
  }
});

router.get('/calculation', checkPermission('reportes.ver'), async (req, res) => {
  try {
    const result = await taxService.calculateMonotributo(req.query.year, req.empresaId);
    res.json({ ok: true, data: result });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular el monotributo');
  }
});

router.get('/payments', checkPermission('caja.ver'), async (req, res) => {
  try {
    const payments = await taxService.getPayments(req.query, req.empresaId);
    res.json({ ok: true, data: payments });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los pagos de impuestos');
  }
});

router.post('/payments', checkPermission('caja.crear'), async (req, res) => {
  try {
    const payment = await taxService.registerPayment(req.body, req.empresaId);
    res.status(201).json({ ok: true, data: payment });
  } catch (err) {
    fallo(req, res, err, 'Error al registrar el pago de impuestos');
  }
});

module.exports = router;
