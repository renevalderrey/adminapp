const express = require('express');
const router = express.Router();

const preciosService = require('../services/preciosService');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');

// ════════════════════════════════════════════
//  Actualizacion de precios en masa
//
//  Va en su propio archivo y no dentro de products.js por una razon
//  practica: products.js tiene rutas /:id, y una ruta /precios/... ahi adentro
//  depende del orden de declaracion para no quedar capturada por ellas. Un
//  bug de ese tipo no se ve leyendo el codigo.
// ════════════════════════════════════════════

// POST /api/precios/masivo — Aplicar a los productos seleccionados
router.post('/masivo', checkPermission('products.editar'), async (req, res) => {
  try {
    const { product_ids, modo, valor, descripcion } = req.body;

    const resultado = await preciosService.aplicarMasivo({
      empresaId: req.empresaId,
      productIds: product_ids,
      modo,
      valor,
      descripcion,
      usuario: req.usuario?.nombre || req.userId || null,
      // `usuario` es el NOMBRE, que es lo que muestra el historial de
      // actualizaciones. `usuarioId` es la clave contra `usuarios`, que es lo
      // unico con lo que el historial de costos puede contestar "quien" sin
      // depender de que nadie se haya cambiado el nombre.
      usuarioId: req.usuario?.id ?? null,
    });

    res.status(201).json({ ok: true, data: resultado });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar los precios');
  }
});

// GET /api/precios/historial — Ultimas actualizaciones
router.get('/historial', checkPermission('products.ver'), async (req, res) => {
  try {
    const historial = await preciosService.listarHistorial(req.empresaId, req.query.limite);
    res.json({ ok: true, data: historial });
  } catch (err) {
    fallo(req, res, err, 'Error al listar el historial de precios');
  }
});

// GET /api/precios/historial/:id — Detalle, producto por producto
router.get('/historial/:id', checkPermission('products.ver'), async (req, res) => {
  try {
    const actualizacion = await preciosService.verDetalle(req.empresaId, req.params.id);

    res.json({
      ok: true,
      data: {
        id: actualizacion.id,
        modo: actualizacion.modo,
        valor: Number(actualizacion.valor),
        descripcion: actualizacion.descripcion,
        usuario: actualizacion.usuario,
        revertida: actualizacion.revertida,
        fecha: actualizacion.created_at,
        cambios: actualizacion.cambios,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la actualizacion');
  }
});

// POST /api/precios/historial/:id/deshacer — Volver a los precios anteriores
router.post('/historial/:id/deshacer', checkPermission('products.editar'), async (req, res) => {
  try {
    const resultado = await preciosService.deshacer({
      empresaId: req.empresaId,
      id: req.params.id,
      usuarioId: req.usuario?.id ?? null,
    });

    res.json({ ok: true, data: resultado });
  } catch (err) {
    fallo(req, res, err, 'Error al deshacer la actualizacion');
  }
});

module.exports = router;
