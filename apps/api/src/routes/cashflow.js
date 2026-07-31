const express = require('express');
const router = express.Router();
const cashflowService = require('../services/cashflowService');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');

router.get('/balance', checkPermission('caja.ver'), async (req, res) => {
  try {
    const balance = await cashflowService.getBalance(req.empresaId, req.puntoDeVentaId || null);
    res.json({ ok: true, data: balance });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular el saldo de caja');
  }
});

router.get('/movements', checkPermission('caja.ver'), async (req, res) => {
  try {
    const movements = await cashflowService.getAllMovementsUnified(req.query, req.empresaId, req.puntoDeVentaId || null);
    res.json({ ok: true, data: movements, total: movements.length });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los movimientos de caja');
  }
});

router.get('/entries', checkPermission('caja.ver'), async (req, res) => {
  try {
    const result = await cashflowService.getMovements(req.query, req.empresaId, req.puntoDeVentaId || null);
    res.json({ ok: true, ...result });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los asientos de caja');
  }
});

router.post('/entries', checkPermission('caja.crear'), async (req, res) => {
  try {
    const entry = await cashflowService.createEntry(req.body, req.empresaId, req.puntoDeVentaId || null);
    res.status(201).json({ ok: true, data: entry });
  } catch (err) {
    if (err.message.includes('debe ser mayor a 0')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    fallo(req, res, err, 'Error al registrar el movimiento de caja');
  }
});

router.delete('/entries/:id', checkPermission('caja.eliminar'), async (req, res) => {
  try {
    await cashflowService.deleteEntry(req.params.id, req.empresaId);
    res.json({ ok: true, message: 'Movimiento eliminado' });
  } catch (err) {
    if (err.message === 'Movimiento no encontrado') {
      return res.status(404).json({ ok: false, error: err.message });
    }
    fallo(req, res, err, 'Error al eliminar el movimiento de caja');
  }
});

module.exports = router;
