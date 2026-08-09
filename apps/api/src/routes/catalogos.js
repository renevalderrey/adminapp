// ════════════════════════════════════════════
//  FAVALIO · Rutas: Catálogos
//
//  El ABM de las tiendas públicas de una empresa. Todo lo de acá es privado y
//  pasa por `authEmpresa` + `requireModulo('catalogo')`; lo que ve el visitante
//  del QR vive en otro router.
//
//  ── La regla que ordena todo este archivo ──
//
//  Cada id que llega del cliente pasa por `findScoped(Modelo, id, req.empresaId)`.
//  Nunca `findByPk`. Y cuando lo que llega es el id de un objetivo —una marca, un
//  producto— el `findScoped` va **delante y en el mismo handler** que el
//  `create`, no en un helper: es lo que hace que el detector de «padre ajeno» de
//  `tests/aislamientoEmpresas.test.js` lo vea.
//
//  ── Y la que ordena el slug ──
//
//  La unicidad la garantiza el índice `uq_catalogo_slug`, **no un `findOne`
//  previo**. Dos empresas pidiendo el mismo slug al mismo tiempo pasan las dos
//  por ese `findOne` y las dos llegan al `create`. Por eso el `catch` del
//  `SequelizeUniqueConstraintError` es el camino real y no el excepcional, y
//  `GET /slug-disponible` es una ayuda para el formulario que **no sustituye**
//  al índice: entre la consulta y el guardado pasa tiempo.
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  Catalogo, CatalogoProducto, CatalogoReglaPrecio, CatalogoVisita,
  Product, Brand, PuntoDeVenta, sequelize,
} = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { normalizarSlug, validarSlug } = require('../utils/slugDeCatalogo');

/**
 * Los campos que el cliente puede escribir.
 *
 * Se enumera lo permitido y no lo prohibido: con una lista de prohibidos, cada
 * columna nueva queda editable por omisión y nadie se acuerda de agregarla.
 *
 * ⚠ `empresa_id`, `slug` y `estado` **no están acá**. El primero porque mandarlo
 * movería el catálogo a otra empresa; el segundo porque se normaliza aparte; el
 * tercero porque cambiar de estado es una verificación de cuatro condiciones y
 * no una asignación —ver `POST /:id/publicar`—.
 */
const CAMPOS_EDITABLES = [
  'punto_de_venta_id', 'nombre_visible', 'descripcion', 'color_marca',
  'whatsapp_destino', 'email_avisos', 'datos_transferencia',
  'retiro_socio', 'retiro_socio_direccion', 'retiro_local',
  'envio', 'envio_costo', 'envio_gratis_desde', 'coordinar_whatsapp',
  'pide_nro_socio', 'mostrar_precio_lista',
];

function camposEditables(body = {}) {
  const limpio = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (body[campo] !== undefined) limpio[campo] = body[campo];
  }
  return limpio;
}

/** Lo que se devuelve de un catálogo. Lista blanca, nunca el objeto del modelo. */
const vista = (c) => ({
  id: c.id,
  slug: c.slug,
  nombre_visible: c.nombre_visible,
  descripcion: c.descripcion,
  logo_url: c.logo_url,
  portada_url: c.portada_url,
  color_marca: c.color_marca,
  punto_de_venta_id: c.punto_de_venta_id,
  whatsapp_destino: c.whatsapp_destino,
  email_avisos: c.email_avisos,
  datos_transferencia: c.datos_transferencia,
  retiro_socio: c.retiro_socio,
  retiro_socio_direccion: c.retiro_socio_direccion,
  retiro_local: c.retiro_local,
  envio: c.envio,
  envio_costo: c.envio_costo,
  envio_gratis_desde: c.envio_gratis_desde,
  coordinar_whatsapp: c.coordinar_whatsapp,
  pide_nro_socio: c.pide_nro_socio,
  mostrar_precio_lista: c.mostrar_precio_lista,
  mp_habilitado: c.mp_habilitado,
  estado: c.estado,
  publicado_en: c.publicado_en,
  created_at: c.created_at,
  updated_at: c.updated_at,
});

/**
 * El choque de slug, contado sin decir de quién es.
 *
 * «Ese slug ya lo usa Comprafit» le contaría a cualquier empresa qué otras
 * empresas hay en la plataforma y cómo se llaman sus tiendas.
 */
const SLUG_TOMADO = 'Esa dirección web ya está en uso. Probá con otra.';

const esChoqueDeSlug = (err) =>
  err?.name === 'SequelizeUniqueConstraintError'
  && (err.errors || []).some((e) => e.path === 'slug' || e.path === 'uq_catalogo_slug');

// ════════════════════════════════════════════
//  ABM
// ════════════════════════════════════════════

// GET /api/catalogos
router.get('/', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const catalogos = await Catalogo.findAll({
      where: { empresa_id: req.empresaId },
      order: [['created_at', 'DESC']],
    });

    // El conteo de productos por catálogo, en una sola consulta: la lista
    // muestra «8 productos» por fila y hacerlo con un `count` por fila serían N+1
    // consultas para una pantalla que se abre todo el tiempo.
    const conteos = await CatalogoProducto.findAll({
      attributes: ['catalogo_id', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      where: { catalogo_id: catalogos.map((c) => c.id) },
      group: ['catalogo_id'],
      raw: true,
    });
    const porCatalogo = new Map(conteos.map((c) => [c.catalogo_id, Number(c.n)]));

    res.json({
      ok: true,
      data: catalogos.map((c) => ({ ...vista(c), productos: porCatalogo.get(c.id) || 0 })),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los catálogos');
  }
});

// GET /api/catalogos/slug-disponible?slug=
//
// Va ANTES de `/:id` — Express resuelve por orden de declaración y `slug-disponible`
// matchearía como id.
router.get('/slug-disponible', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const slug = normalizarSlug(req.query.slug || '');
    const validacion = validarSlug(slug);

    if (!validacion.ok) {
      return res.json({ ok: true, data: { slug, disponible: false, motivo: validacion.motivo } });
    }

    // Se consulta SIN filtrar por empresa a propósito: el slug es único global,
    // así que «está tomado» es una verdad de toda la plataforma. Lo que no se
    // dice es de quién.
    const tomado = await Catalogo.count({ where: { slug } });

    res.json({
      ok: true,
      data: { slug, disponible: tomado === 0, motivo: tomado === 0 ? null : SLUG_TOMADO },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al consultar la dirección web');
  }
});

// POST /api/catalogos
router.post('/', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const { nombre_visible, slug, punto_de_venta_id } = req.body;

    if (!nombre_visible || !String(nombre_visible).trim()) {
      return res.status(400).json({ ok: false, error: 'Hace falta el nombre visible del catálogo.' });
    }

    // El punto de venta es de esta empresa o no existe. `findScoped` delante del
    // `create` y en el mismo handler.
    const punto = await findScoped(PuntoDeVenta, punto_de_venta_id, req.empresaId);
    if (!punto) {
      return res.status(404).json({ ok: false, error: 'La sucursal indicada no existe.' });
    }

    const slugNormalizado = normalizarSlug(slug || nombre_visible);
    const validacion = validarSlug(slugNormalizado);
    if (!validacion.ok) {
      return res.status(400).json({ ok: false, error: validacion.motivo });
    }

    const catalogo = await Catalogo.create({
      ...camposEditables(req.body),
      empresa_id: req.empresaId,
      punto_de_venta_id: punto.id,
      nombre_visible: String(nombre_visible).trim(),
      slug: slugNormalizado,
      // Nace en borrador SIEMPRE. Crear no es publicar: publicar es una
      // verificación de cuatro condiciones.
      estado: 'borrador',
    });

    res.status(201).json({ ok: true, data: vista(catalogo) });
  } catch (err) {
    if (esChoqueDeSlug(err)) {
      return res.status(409).json({ ok: false, error: SLUG_TOMADO });
    }
    fallo(req, res, err, 'Error al crear el catálogo');
  }
});

// GET /api/catalogos/:id
router.get('/:id', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    // 404 y no 403: un id ajeno no se puede distinguir de uno que no existe.
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    res.json({ ok: true, data: vista(catalogo) });
  } catch (err) {
    fallo(req, res, err, 'Error al leer el catálogo');
  }
});

// PUT /api/catalogos/:id
router.put('/:id', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const cambios = camposEditables(req.body);

    // Cambiar de sucursal también valida que la nueva sea de esta empresa.
    if (cambios.punto_de_venta_id !== undefined) {
      const punto = await findScoped(PuntoDeVenta, cambios.punto_de_venta_id, req.empresaId);
      if (!punto) return res.status(404).json({ ok: false, error: 'La sucursal indicada no existe.' });
      cambios.punto_de_venta_id = punto.id;
    }

    // El slug se normaliza antes de guardar, o el formulario propone una
    // dirección y queda publicada otra — con el QR ya impreso.
    if (req.body.slug !== undefined) {
      const slugNormalizado = normalizarSlug(req.body.slug);
      const validacion = validarSlug(slugNormalizado);
      if (!validacion.ok) return res.status(400).json({ ok: false, error: validacion.motivo });
      cambios.slug = slugNormalizado;
    }

    await catalogo.update(cambios);

    res.json({ ok: true, data: vista(catalogo) });
  } catch (err) {
    if (esChoqueDeSlug(err)) {
      return res.status(409).json({ ok: false, error: SLUG_TOMADO });
    }
    fallo(req, res, err, 'Error al actualizar el catálogo');
  }
});

// DELETE /api/catalogos/:id
//
// 📌 Todavía NO responde 409 TIENE_PEDIDOS: la tabla `pedidos` no existe hasta
// la etapa 2. Acá borra en cascada y está bien, porque no hay pedido que perder.
// El rechazo se agrega junto con la bandeja.
router.delete('/:id', checkPermission('catalogo.editar'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId, { transaction: t });
    if (!catalogo) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });
    }

    // La base ya tiene ON DELETE CASCADE en las tres. Se borran explícitamente
    // igual para que el orden sea legible acá y no dependa de leer la migración.
    await CatalogoProducto.destroy({ where: { catalogo_id: catalogo.id }, transaction: t });
    await CatalogoReglaPrecio.destroy({ where: { catalogo_id: catalogo.id }, transaction: t });
    await CatalogoVisita.destroy({ where: { catalogo_id: catalogo.id }, transaction: t });
    await catalogo.destroy({ transaction: t });

    await t.commit();
    res.json({ ok: true, message: 'Catálogo eliminado' });
  } catch (err) {
    await t.rollback();
    fallo(req, res, err, 'Error al eliminar el catálogo');
  }
});

// ════════════════════════════════════════════
//  Publicar, pausar, despublicar
//
//  ── Publicar no es cambiar una columna ──
//
//  Son cuatro condiciones, y si falta alguna la respuesta es una **lista**. Un
//  solo mensaje concatenado obliga al comercio a arreglar una cosa, reintentar,
//  descubrir la siguiente y repetir: con la lista ve las cuatro de una.
//
//  ── Pausar y despublicar NO son lo mismo ──
//
//  Pausado: la tienda dibuja la pantalla de pausa, con la portada apagada y el
//  «volvemos pronto». El socio ve que llegó al lugar correcto.
//  Borrador: el enlace da 404. Es lo que corresponde a algo que nunca estuvo
//  publicado, o que se retiró de verdad.
// ════════════════════════════════════════════

router.post('/:id/publicar', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const faltan = [];

    if (!catalogo.nombre_visible || !catalogo.nombre_visible.trim()) {
      faltan.push({ que: 'nombre_visible', detalle: 'El catálogo necesita un nombre visible.' });
    }

    const validacion = validarSlug(catalogo.slug || '');
    if (!validacion.ok) {
      faltan.push({ que: 'slug', detalle: validacion.motivo });
    }

    const punto = await findScoped(PuntoDeVenta, catalogo.punto_de_venta_id, req.empresaId);
    if (!punto || punto.is_active === false) {
      faltan.push({
        que: 'punto_de_venta',
        detalle: punto
          ? `La sucursal «${punto.name}» está desactivada, y de ahí sale el stock que se publica.`
          : 'La sucursal del catálogo ya no existe.',
      });
    }

    // Al menos un producto que SALGA de verdad: publicable, activo y con
    // precio. Contar filas de `catalogo_productos` diría «tiene 8» sobre un
    // catálogo que se abre vacío.
    const queSalen = await productosQueSalen(catalogo);
    if (queSalen.length === 0) {
      faltan.push({
        que: 'productos',
        detalle: 'Ningún producto del catálogo puede salir: revisá que estén publicables, activos y con precio.',
      });
    }

    if (faltan.length > 0) {
      return res.status(409).json({ ok: false, error: 'FALTAN_REQUISITOS', faltan });
    }

    await catalogo.update({ estado: 'publicado', publicado_en: new Date() });

    res.json({ ok: true, data: vista(catalogo) });
  } catch (err) {
    fallo(req, res, err, 'Error al publicar el catálogo');
  }
});

router.post('/:id/pausar', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    await catalogo.update({ estado: 'pausado' });
    res.json({ ok: true, data: vista(catalogo) });
  } catch (err) {
    fallo(req, res, err, 'Error al pausar el catálogo');
  }
});

router.post('/:id/despublicar', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    // A borrador, no a pausado: el enlace pasa a dar 404. Es lo que corresponde
    // a algo retirado de verdad, y es distinto de «volvemos pronto».
    await catalogo.update({ estado: 'borrador', publicado_en: null });
    res.json({ ok: true, data: vista(catalogo) });
  } catch (err) {
    fallo(req, res, err, 'Error al despublicar el catálogo');
  }
});

/**
 * Los productos del catálogo que de verdad pueden salir.
 *
 * Publicable, activo y con precio. Los tres filtros importan y ninguno es
 * redundante: un producto puede estar en la lista de inclusión, marcado
 * publicable, y no tener costo — hoy 376 de los 431 de Comprafit están así.
 */
async function productosQueSalen(catalogo) {
  const filas = await CatalogoProducto.findAll({
    where: { catalogo_id: catalogo.id },
    raw: true,
  });
  if (filas.length === 0) return [];

  return Product.findAll({
    where: {
      id: filas.map((f) => f.product_id),
      empresa_id: catalogo.empresa_id,
      publicable: true,
      is_active: true,
      [Op.or]: [
        { cost: { [Op.gt]: 0 } },
        { price_override: { [Op.gt]: 0 } },
      ],
    },
  });
}

module.exports = router;
module.exports.productosQueSalen = productosQueSalen;
