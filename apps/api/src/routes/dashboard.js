const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');

router.get('/kpis', checkPermission('dashboard.ver'), async (req, res) => {
  try {
    const data = await dashboardService.getKpis(req.empresaId);
    res.json({ ok: true, data });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular los indicadores del panel');
  }
});

module.exports = router;
