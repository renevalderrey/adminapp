const express = require('express');
const router = express.Router();
const cashflowService = require('../services/cashflowService');
const checkPermission = require('../middleware/checkPermission');

router.get('/balance', checkPermission('caja.ver'), async (req, res) => {
  try {
    const balance = await cashflowService.getBalance(req.empresaId || 1, req.puntoDeVentaId || null);
    res.json({ ok: true, data: balance });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/movements', checkPermission('caja.ver'), async (req, res) => {
  try {
    const movements = await cashflowService.getAllMovementsUnified(req.query, req.empresaId || 1, req.puntoDeVentaId || null);
    res.json({ ok: true, data: movements, total: movements.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/entries', checkPermission('caja.ver'), async (req, res) => {
  try {
    const result = await cashflowService.getMovements(req.query, req.empresaId || 1, req.puntoDeVentaId || null);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/entries', checkPermission('caja.crear'), async (req, res) => {
  try {
    const entry = await cashflowService.createEntry(req.body, req.empresaId || 1, req.puntoDeVentaId || null);
    res.status(201).json({ ok: true, data: entry });
  } catch (err) {
    if (err.message.includes('debe ser mayor a 0')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/entries/:id', checkPermission('caja.eliminar'), async (req, res) => {
  try {
    await cashflowService.deleteEntry(req.params.id);
    res.json({ ok: true, message: 'Movimiento eliminado' });
  } catch (err) {
    if (err.message === 'Movimiento no encontrado') {
      return res.status(404).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
