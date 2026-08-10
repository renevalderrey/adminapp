// ════════════════════════════════════════════
//  FAVALIO · Rutas: la bandeja de pedidos
//
//  Tres endpoints, y **uno solo escribe**. Es donde el comercio ve lo que entró
//  por el catálogo y lo mueve por sus estados.
//
//  ── `POST /:id/cobrado` NO existe, y es a propósito ──
//
//  Cobrar, en esta etapa, **es cambiar un estado**: no crea la venta, no
//  descuenta stock y no toca la caja. Un endpoint llamado `cobrado` prometería en
//  la API lo mismo que la maqueta promete en la pantalla, y sería igual de falso.
//  La regla es «si toca stock, genera venta; si no genera venta, no toca stock»,
//  y las dos mitades entran juntas en la etapa siguiente.
//
//  ── Las transiciones se validan contra la BASE ──
//
//  No contra el estado que tenía cargado la pantalla. Dos pestañas abiertas sobre
//  el mismo pedido —o dos personas del mostrador— no lo pueden dejar en un estado
//  imposible: el que llega segundo encuentra el estado ya cambiado y su
//  transición no existe.
//
//  Eso es también lo que hace que **marcar cobrado dos veces sea idempotente sin
//  clave de idempotencia** (FR-169): `pagado → pagado` no está en la tabla de
//  transiciones, así que el segundo request se rechaza por construcción.
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Pedido, PedidoItem, Catalogo, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { findScoped, scoped } = require('../utils/tenantScope');
const { fallo } = require('../utils/errores');
const logger = require('../utils/logger');
const { ESTADOS, transicionesDesde, validarTransicion } = require('../utils/estadoDePedido');

/** Cuántos pedidos trae una página de la bandeja. */
const POR_PAGINA = 30;

/** Los canales que pueden originar un pedido. Hoy hay uno. */
const ORIGENES = ['catalogo'];

const entero = (valor) => {
  const n = Number.parseInt(valor, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** La fila de la tabla. Lista blanca: la bandeja no necesita el teléfono ni las notas. */
const filaDeLaBandeja = (p) => ({
  id: p.id,
  numero: p.numero,
  estado: p.estado,
  origen: p.origen,
  catalogo_id: p.catalogo_id,
  comprador_nombre: p.comprador_nombre,
  entrega: p.entrega,
  medio_pago: p.medio_pago,
  total: Number(p.total),
  created_at: p.created_at,
});

// GET /api/pedidos
//
// ── `por_estado` viene SIEMPRE, con o sin filtro ──
//
// Son los números que la pantalla dibuja en las píldoras de filtro, y tienen que
// estar aunque haya un filtro puesto: si sólo vinieran sin filtrar, al elegir
// «pagados» las otras píldoras se quedarían sin número y el comercio perdería de
// vista cuántos hay en cada estado, que es justo lo que estaba mirando.
//
// Sale de **un `GROUP BY`**, no de un `COUNT` por estado. Con seis consultas,
// abrir la bandeja son siete viajes a la base en vez de dos.
router.get('/', checkPermission('pedidos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresaId;

    const filtros = {};
    if (ESTADOS.includes(req.query.estado)) filtros.estado = req.query.estado;
    if (ORIGENES.includes(req.query.origen)) filtros.origen = req.query.origen;

    const catalogoId = entero(req.query.catalogo_id);
    if (catalogoId) filtros.catalogo_id = catalogoId;

    const pagina = entero(req.query.pagina) || 1;

    const { rows, count } = await Pedido.findAndCountAll({
      where: scoped(filtros, empresaId),
      order: [['created_at', 'DESC'], ['numero', 'DESC']],
      limit: POR_PAGINA,
      offset: (pagina - 1) * POR_PAGINA,
    });

    // El conteo por estado **no** lleva el filtro de estado —sería contarse a sí
    // mismo— pero sí los otros: con un catálogo elegido, los números tienen que
    // ser los de ese catálogo.
    const paraElConteo = scoped({}, empresaId);
    if (filtros.origen) paraElConteo.origen = filtros.origen;
    if (filtros.catalogo_id) paraElConteo.catalogo_id = filtros.catalogo_id;

    const agrupado = await Pedido.findAll({
      attributes: ['estado', [sequelize.fn('COUNT', sequelize.col('id')), 'cuantos']],
      where: paraElConteo,
      group: ['estado'],
      raw: true,
    });

    // Los seis estados vienen siempre, con cero si no hay ninguno: una píldora
    // sin número se lee como «no se pudo contar», no como «no hay».
    const por_estado = {};
    for (const estado of ESTADOS) por_estado[estado] = 0;
    for (const fila of agrupado) por_estado[fila.estado] = Number(fila.cuantos);

    res.json({
      ok: true,
      data: {
        pedidos: rows.map(filaDeLaBandeja),
        total: count,
        pagina,
        hay_mas: pagina * POR_PAGINA < count,
        por_estado,
        // ⚠ Esto es lo que le permite a la pantalla distinguir los dos vacíos
        // (FR-172): `total: 0` **sin** filtros es «todavía no entró ninguno» y
        // `total: 0` **con** filtros es «el filtro no devolvió nada». Son dos
        // textos distintos, y el segundo tiene una salida —sacar el filtro— que
        // el primero no.
        hay_filtros: Object.keys(filtros).length > 0,
        filtros,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los pedidos');
  }
});

// GET /api/pedidos/:id
//
// ⚠ Las líneas salen de `pedido_items`, **congeladas**, y no del catálogo
// (FR-171). Un pedido de hace tres semanas tiene que seguir diciendo lo que
// costó: si el detalle recalculara contra las reglas de hoy, el comercio vería
// un total distinto del que el comprador tiene en su WhatsApp.
router.get('/:id', checkPermission('pedidos.ver'), async (req, res) => {
  try {
    const pedido = await findScoped(Pedido, req.params.id, req.empresaId);
    if (!pedido) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

    const lineas = await PedidoItem.findAll({
      where: { pedido_id: pedido.id },
      order: [['id', 'ASC']],
    });

    const catalogo = await Catalogo.findOne({
      attributes: ['id', 'nombre_visible', 'slug'],
      where: { id: pedido.catalogo_id, empresa_id: req.empresaId },
    });

    res.json({
      ok: true,
      data: {
        pedido,
        lineas,
        catalogo,
        // Los botones que la pantalla puede dibujar. Los decide el servidor con
        // la misma tabla que valida el `PATCH`: si los decidiera la pantalla,
        // serían dos reglas y la de la pantalla ofrecería lo que la otra rechaza.
        transiciones: transicionesDesde(pedido.estado),
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al abrir el pedido');
  }
});

// PATCH /api/pedidos/:id/estado — el único que escribe.
router.patch('/:id/estado', checkPermission('pedidos.gestionar'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // `lock: true` sobre la fila del pedido: dos requests simultáneos sobre el
    // mismo pedido se serializan acá, así que el segundo lee el estado que dejó
    // el primero y no el de antes. Sin el lock, los dos leen `pendiente_pago`,
    // los dos ven la transición como válida, y los dos escriben.
    const pedido = await findScoped(Pedido, req.params.id, req.empresaId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!pedido) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }

    const hacia = String(req.body?.estado || '');
    const validacion = validarTransicion(pedido.estado, hacia);

    if (!validacion.ok) {
      await t.rollback();
      // El estado actual va en la respuesta: sin él, la pantalla que perdió la
      // carrera muestra «no se puede» y no puede decir por qué ni refrescarse.
      return res.status(409).json({
        ok: false,
        error: validacion.error,
        mensaje: validacion.mensaje,
        estado_actual: pedido.estado,
        transiciones: transicionesDesde(pedido.estado),
      });
    }

    const desde = pedido.estado;
    await pedido.update({ estado: hacia }, { transaction: t });
    await t.commit();

    logger.info(
      { empresa: req.empresaId, pedido: pedido.numero, desde, hacia, usuario: req.userId },
      'pedidos: cambio de estado'
    );

    res.json({
      ok: true,
      data: { pedido, transiciones: transicionesDesde(hacia) },
    });
  } catch (err) {
    await t.rollback();
    fallo(req, res, err, 'Error al cambiar el estado del pedido');
  }
});

module.exports = router;
