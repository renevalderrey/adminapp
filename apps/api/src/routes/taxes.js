const express = require('express');
const router = express.Router();
const taxService = require('../services/taxService');
const checkPermission = require('../middleware/checkPermission');

router.get('/config/:taxType', checkPermission('config.ver'), async (req, res) => {
  try {
    const config = await taxService.getConfig(req.params.taxType, req.empresaId || 1);
    res.json({ ok: true, data: config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/config/:taxType', checkPermission('config.editar'), async (req, res) => {
  try {
    const config = await taxService.updateConfig(req.params.taxType, req.body.config, req.empresaId || 1);
    res.json({ ok: true, data: config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/calculation', checkPermission('reportes.ver'), async (req, res) => {
  try {
    const result = await taxService.calculateMonotributo(req.query.year, req.empresaId || 1);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/payments', checkPermission('caja.ver'), async (req, res) => {
  try {
    const payments = await taxService.getPayments(req.query, req.empresaId || 1);
    res.json({ ok: true, data: payments });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/payments', checkPermission('caja.crear'), async (req, res) => {
  try {
    const payment = await taxService.registerPayment(req.body, req.empresaId || 1);
    res.status(201).json({ ok: true, data: payment });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
