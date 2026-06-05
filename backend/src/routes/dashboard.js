const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');
const checkPermission = require('../middleware/checkPermission');

router.get('/kpis', checkPermission('dashboard.ver'), async (req, res) => {
  try {
    const data = await dashboardService.getKpis(req.empresaId || 1);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[dashboard] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
