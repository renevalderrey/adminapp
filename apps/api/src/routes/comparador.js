const express = require('express');
const router = express.Router();

const { ListaProveedor, Supplier } = require('../models');
const comparador = require('../services/comparadorService');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');

// ════════════════════════════════════════════
//  Comparador de proveedores
//
//  Se cargan las listas de precios de varios proveedores y el sistema dice
//  quien tiene cada producto mas barato. Es como se decide a quien comprarle.
//
//  Las listas se guardan en la base y no en el navegador —que es donde las
//  tenia el sistema anterior— por dos motivos: sobreviven a un cambio de
//  computadora, y las ve todo el equipo, no solo quien las cargo.
// ════════════════════════════════════════════

/** Tope por lista. Una lista de proveedor real tiene cientos, no miles. */
const MAXIMO_ITEMS = 5000;

// GET /api/comparador/listas
router.get('/listas', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const listas = await ListaProveedor.findAll({
      where: { empresa_id: req.empresaId },
      order: [['activa', 'DESC'], ['fecha', 'DESC'], ['id', 'DESC']],
    });

    // El detalle de los items no va en el listado: son cientos por lista y no
    // se muestran hasta que alguien abre una.
    res.json({
      ok: true,
      data: listas.map((l) => ({
        id: l.id,
        nombre: l.nombre,
        supplier_id: l.supplier_id,
        fecha: l.fecha,
        activa: l.activa,
        cantidad_items: (l.items || []).length,
      })),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las listas de precios');
  }
});

// GET /api/comparador/listas/:id — Con los items
router.get('/listas/:id', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const lista = await findScoped(ListaProveedor, req.params.id, req.empresaId);
    if (!lista) return res.status(404).json({ ok: false, error: 'Lista no encontrada' });

    res.json({ ok: true, data: lista });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la lista de precios');
  }
});

// POST /api/comparador/listas
//
// Acepta dos formas de cargar: `texto` (pegado tal cual del mail o del PDF) o
// `items` ya parseados (por ejemplo desde un Excel leido en el navegador).
router.post('/listas', checkPermission('proveedores.crear'), async (req, res) => {
  try {
    const { nombre, supplier_id, fecha, texto, items } = req.body;

    if (!nombre || !String(nombre).trim()) {
      throw new ErrorDeNegocio('Poné un nombre para la lista (el del proveedor).');
    }

    let filas = [];
    let ignoradas = 0;

    if (Array.isArray(items) && items.length > 0) {
      filas = items
        .map((i) => ({
          nombre: String(i.nombre || i.producto || '').trim(),
          precio: Number(i.precio),
          sku: i.sku ? String(i.sku).trim() : null,
          marca: i.marca ? String(i.marca).trim() : null,
        }))
        .filter((i) => i.nombre && Number.isFinite(i.precio) && i.precio > 0);

      ignoradas = items.length - filas.length;
    } else if (texto) {
      const parseado = comparador.parsearTexto(texto);
      filas = parseado.items;
      ignoradas = parseado.ignoradas;
    } else {
      throw new ErrorDeNegocio('Pegá la lista o subí el archivo.');
    }

    if (filas.length === 0) {
      throw new ErrorDeNegocio(
        'No se pudo leer ningún producto con precio. Cada línea tiene que terminar con el precio.'
      );
    }

    if (filas.length > MAXIMO_ITEMS) {
      throw new ErrorDeNegocio(`La lista tiene ${filas.length} productos y el máximo es ${MAXIMO_ITEMS}.`);
    }

    // El proveedor, si viene, tiene que ser de esta empresa. Sin este chequeo
    // se podria colgar una lista del proveedor de otra empresa cliente.
    let proveedorId = null;

    if (supplier_id) {
      const proveedor = await findScoped(Supplier, supplier_id, req.empresaId, { attributes: ['id'] });
      if (!proveedor) throw new ErrorDeNegocio('El proveedor no existe en esta empresa.');
      proveedorId = proveedor.id;
    }

    const lista = await ListaProveedor.create({
      empresa_id: req.empresaId,
      supplier_id: proveedorId,
      nombre: String(nombre).trim(),
      fecha: fecha || new Date().toISOString().slice(0, 10),
      items: filas,
    });

    res.status(201).json({
      ok: true,
      data: { id: lista.id, nombre: lista.nombre, cantidad_items: filas.length, ignoradas },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al cargar la lista de precios');
  }
});

// PUT /api/comparador/listas/:id — Activar o desactivar, renombrar
router.put('/listas/:id', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    const lista = await findScoped(ListaProveedor, req.params.id, req.empresaId);
    if (!lista) return res.status(404).json({ ok: false, error: 'Lista no encontrada' });

    const cambios = {};
    if (req.body.nombre !== undefined) cambios.nombre = String(req.body.nombre).trim();
    if (req.body.activa !== undefined) cambios.activa = Boolean(req.body.activa);

    await lista.update(cambios);

    res.json({ ok: true, data: { id: lista.id, nombre: lista.nombre, activa: lista.activa } });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar la lista de precios');
  }
});

// DELETE /api/comparador/listas/:id
router.delete('/listas/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  try {
    const borradas = await ListaProveedor.destroy({
      where: { id: req.params.id, empresa_id: req.empresaId },
    });

    if (!borradas) return res.status(404).json({ ok: false, error: 'Lista no encontrada' });

    res.json({ ok: true, message: 'Lista eliminada' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar la lista de precios');
  }
});

// GET /api/comparador?umbral=0.45
router.get('/', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const listas = await ListaProveedor.findAll({
      where: { empresa_id: req.empresaId, activa: true },
      order: [['id', 'ASC']],
    });

    if (listas.length < 2) {
      return res.json({
        ok: true,
        data: {
          grupos: [],
          total: 0,
          comparables: 0,
          solo_en_uno: 0,
          proveedores: listas.map((l) => ({
            lista_id: l.id, nombre: l.nombre, items: (l.items || []).length, gana: 0,
          })),
          // No es un error: es que todavia no hay con que comparar.
          aviso: 'Hacen falta al menos dos listas activas para comparar.',
        },
      });
    }

    const umbral = Number(req.query.umbral);

    const resultado = comparador.comparar(
      listas.map((l) => ({ id: l.id, nombre: l.nombre, items: l.items })),
      { umbral: Number.isFinite(umbral) && umbral > 0 && umbral <= 1 ? umbral : undefined }
    );

    res.json({ ok: true, data: resultado });
  } catch (err) {
    fallo(req, res, err, 'Error al comparar los proveedores');
  }
});

module.exports = router;
