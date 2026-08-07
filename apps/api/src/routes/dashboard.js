const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');

// `dashboard.ver` lo tienen los cinco roles, asi que este permiso solo decide si
// se ve el Panel. QUE se ve adentro lo decide el permiso de cada pantalla: el
// saldo de caja exige `caja.ver`, las cuentas por cobrar `clientes.ver`, el saldo
// de proveedores `proveedores.ver` y los gastos fijos `gastos.ver`. Sin el
// permiso, la clave NO viene — no viene en cero.
router.get('/kpis', checkPermission('dashboard.ver'), async (req, res) => {
  try {
    const data = await dashboardService.getKpis(req.empresaId, {
      permisos: req.usuarioPermisos || [],
      // La sucursal activa solo la usan los avisos de «Requiere tu atención», y
      // solo los de stock: cada aviso sigue el alcance de la pantalla a la que
      // lleva, y `/faltantes` y `/stock` caen a `req.puntoDeVentaId`. Las cuatro
      // tarjetas de indicador siguen siendo de toda la empresa.
      puntoDeVentaId: req.puntoDeVentaId || null,
    });
    res.json({ ok: true, data });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular los indicadores del panel');
  }
});

module.exports = router;
