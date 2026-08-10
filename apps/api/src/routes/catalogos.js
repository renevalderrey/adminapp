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
const multer = require('multer');
const router = express.Router();
const { Op } = require('sequelize');
const { calcularPrecios } = require('@favalio/precios');
const {
  Catalogo, CatalogoProducto, CatalogoReglaPrecio, CatalogoVisita,
  Product, Brand, Empresa, PuntoDeVenta, sequelize,
} = require('../models');
const checkPermission = require('../middleware/checkPermission');
const logger = require('../utils/logger');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const { normalizarSlug, validarSlug } = require('../utils/slugDeCatalogo');
const { normalizarTexto } = require('../utils/textoDeBusqueda');
const { validarRegla, resolverPrecios } = require('../utils/reglasDePrecio');
const { redimensionarYGuardar, borrarImagen, esImagenPropia } = require('../utils/imagenes');

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

// ════════════════════════════════════════════
//  Lo que comparten las reglas, la grilla de productos y la previsualización
//
//  ── El precio de lista NO es el costo ──
//
//  Es el `cashPrice` de `calcularPrecios` (`@favalio/precios`): el precio de
//  venta de la empresa **antes** de las reglas del catálogo. Sale del costo y
//  del margen, o del `price_override` cuando hay precio manual. Devolver el
//  costo en su lugar publicaría lo que la empresa paga por el producto.
//
//  ── El universo de la cobertura son los productos DEL CATÁLOGO ──
//
//  Todas las filas de `catalogo_productos`, incluidas las que después no salen
//  —sin precio, no publicables—. Es lo que dice el plan y es lo que hace que
//  «gana en 2 de 4» sea un número estable: si el universo fuera «los que
//  salen», marcar un producto como no publicable cambiaría la cobertura de una
//  regla que nadie tocó.
// ════════════════════════════════════════════

/**
 * La configuración de precios de la empresa de la sesión.
 *
 * `findByPk` con `req.empresaId`, que NO viene del cliente: lo resuelve la
 * cadena de autenticación. Es la misma forma de `routes/afip.js:497`.
 */
async function ajustesDePrecio(empresaId) {
  const empresa = await Empresa.findByPk(empresaId, { attributes: ['id', 'settings'] });
  return (empresa && empresa.settings) || {};
}

/**
 * El producto con la forma que pide `resolverPrecios`, y el producto adentro.
 *
 * `sinCosto` viaja junto al resto porque es la misma cuenta: preguntarlo
 * después, con otra fórmula, es como el mismo producto termina saliendo en una
 * pantalla y no en la otra.
 */
function paraElMotor(producto, settings, orden = 0) {
  const precios = calcularPrecios(producto, settings);

  return {
    id: producto.id,
    brand_id: producto.brand_id,
    category: producto.category,
    precioLista: precios.cashPrice,
    sinCosto: precios.sinCosto,
    orden,
    producto,
  };
}

/** Los productos del catálogo, en el orden de la grilla y con su precio de lista. */
async function productosDelCatalogo(catalogo, settings) {
  const filas = await CatalogoProducto.findAll({
    where: { catalogo_id: catalogo.id },
    order: [['orden', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  if (filas.length === 0) return [];

  // El `empresa_id` va igual aunque la fila ya cuelgue de un catálogo que pasó
  // por `findScoped`: es la segunda mitad del par y no cuesta nada.
  const productos = await Product.findAll({
    where: { id: filas.map((f) => f.product_id), empresa_id: catalogo.empresa_id },
  });
  const porId = new Map(productos.map((p) => [p.id, p]));

  return filas
    .filter((f) => porId.has(f.product_id))
    .map((f) => paraElMotor(porId.get(f.product_id), settings, f.orden));
}

// ════════════════════════════════════════════
//  Las reglas de precio
//
//  ── La categoría se guarda NORMALIZADA, y eso no es cosmético ──
//
//  `products.category` es texto libre y no hay tabla de categorías, así que la
//  comparación la hace `normalizarTexto` (FR-079). Pero el índice único de la
//  base es `uq_regla_categoria (catalogo_id, categoria)` sobre el texto crudo:
//  guardando «Proteínas» y «proteinas» tal cual, la base las ve distintas y el
//  motor las ve iguales. Quedarían **dos reglas de categoría con la misma
//  clave**, el índice del motor se quedaría con una y la otra sería una fila que
//  existe, no hace nada y muestra «0 de 0» sin ninguna explicación.
//
//  Guardándola normalizada, el índice de la base y el del motor son el mismo, y
//  la segunda choca con un 409 que se puede leer. La etiqueta linda —la que ve
//  el usuario— la devuelve `GET /:id/categorias`.
//
//  ── El `findScoped` del objetivo va DELANTE del create y en este handler ──
//
//  No en un helper. Es lo que hace que el detector de «padre ajeno» de
//  `tests/aislamientoEmpresas.test.js` lo vea, y es lo que hace que una regla
//  sobre la marca de otra empresa responda 404 **sin dejar ninguna fila**
//  (FR-081).
// ════════════════════════════════════════════

/** Lo que se devuelve de una regla. Lista blanca, como el catálogo. */
const vistaRegla = (r) => ({
  id: r.id,
  catalogo_id: r.catalogo_id,
  ambito: r.ambito,
  categoria: r.categoria,
  brand_id: r.brand_id,
  product_id: r.product_id,
  tipo: r.tipo,
  // DECIMAL vuelve de Postgres como string. Sin este `Number`, el panel suma
  // «12.00» concatenando y la comparación con un número da siempre false.
  valor: Number(r.valor),
  activo: r.activo,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const TEXTO_DE_TIPO = {
  porcentaje_descuento: (v) => `${v} % de descuento`,
  monto_descuento: (v) => `$${v} de descuento`,
  precio_fijo: (v) => `precio fijo de $${v}`,
};

/** «12 % de descuento». Es lo que nombra a la regla que ya estaba en el 409. */
function textoDeRegla(regla) {
  const arma = TEXTO_DE_TIPO[regla.tipo];
  return arma ? arma(Number(regla.valor)) : `${regla.tipo} ${regla.valor}`;
}

const aEnteroPositivo = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Las tres columnas anulables, con exactamente la del ámbito cargada.
 *
 * Es lo mismo que exige el CHECK `ck_regla_ambito`, contestado acá con un
 * mensaje que se puede mostrar. Se arma campo por campo y nunca con
 * `...req.body`: así una regla de marca no puede llegar con `product_id`.
 *
 * @returns {null} cuando el ámbito no es uno de los cuatro.
 */
function objetivoDeLaRegla(ambito, body = {}) {
  switch (ambito) {
    case 'catalogo':
      return { categoria: null, brand_id: null, product_id: null };
    case 'categoria':
      return {
        categoria: normalizarTexto(body.categoria).slice(0, 50) || null,
        brand_id: null,
        product_id: null,
      };
    case 'marca':
      return { categoria: null, brand_id: aEnteroPositivo(body.brand_id), product_id: null };
    case 'producto':
      return { categoria: null, brand_id: null, product_id: aEnteroPositivo(body.product_id) };
    default:
      return null;
  }
}

/**
 * El choque contra uno de los cuatro índices únicos parciales.
 *
 * Son los únicos índices únicos de la tabla, así que cualquier
 * `SequelizeUniqueConstraintError` que llegue de un `create` de regla es este.
 * El nombre se mira igual, porque un índice nuevo mañana no tiene por qué
 * heredar este mensaje.
 */
const esChoqueDeRegla = (err) => {
  if (err?.name !== 'SequelizeUniqueConstraintError') return false;

  const nombre = err.parent?.constraint || err.original?.constraint || '';
  const enErrores = (err.errors || []).some((e) => String(e.path || '').startsWith('uq_regla_'));

  return String(nombre).startsWith('uq_regla_') || enErrores;
};

// GET /api/catalogos/:id/reglas — las reglas con su cobertura
router.get('/:id/reglas', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const reglas = await CatalogoReglaPrecio.findAll({
      where: { catalogo_id: catalogo.id, empresa_id: req.empresaId },
      order: [['id', 'ASC']],
    });

    const settings = await ajustesDePrecio(req.empresaId);
    const productos = await productosDelCatalogo(catalogo, settings);

    // La cobertura sale del MISMO recorrido que los precios: los dos números no
    // pueden contradecirse porque son el mismo paso.
    const { cobertura } = resolverPrecios(productos, reglas);

    res.json({
      ok: true,
      data: {
        reglas: reglas.map((r) => ({
          ...vistaRegla(r),
          // Una desactivada y una huérfana no tienen entrada en el mapa: se
          // dibujan «0 de 0», que es lo que hace visible que no hacen nada.
          cobertura: cobertura.get(r.id) || { alcanza: 0, gana: 0 },
        })),
        productos: productos.length,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las reglas de precio');
  }
});

// POST /api/catalogos/:id/reglas
router.post('/:id/reglas', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const { ambito } = req.body;
    const objetivo = objetivoDeLaRegla(ambito, req.body);
    if (!objetivo) {
      return res.status(400).json({
        ok: false,
        error: 'El ámbito de la regla no es uno de los cuatro que existen.',
      });
    }

    // Se valida ANTES de escribir: un porcentaje de 120 % o un precio fijo de $0
    // se rechazan en el formulario, donde alguien los puede corregir, y no el
    // día que un producto sale a la calle a $0.
    const validacion = validarRegla({ ...objetivo, ambito, tipo: req.body.tipo, valor: req.body.valor });
    if (!validacion.ok) return res.status(400).json({ ok: false, error: validacion.motivo });

    // ⚠ Acá, delante del create y en este mismo handler. Ver el encabezado.
    let nombreDelObjetivo = 'todo el catálogo';

    if (ambito === 'marca') {
      const marca = await findScoped(Brand, objetivo.brand_id, req.empresaId);
      // 404 y no 403: un id ajeno no se distingue de uno que no existe.
      if (!marca) return res.status(404).json({ ok: false, error: 'La marca indicada no existe.' });
      nombreDelObjetivo = `la marca «${marca.name}»`;
    }

    if (ambito === 'producto') {
      const producto = await findScoped(Product, objetivo.product_id, req.empresaId);
      if (!producto) return res.status(404).json({ ok: false, error: 'El producto indicado no existe.' });
      nombreDelObjetivo = `el producto «${producto.name}»`;
    }

    if (ambito === 'categoria') nombreDelObjetivo = `la categoría «${objetivo.categoria}»`;

    let regla;
    try {
      regla = await CatalogoReglaPrecio.create({
        empresa_id: req.empresaId,
        catalogo_id: catalogo.id,
        ambito,
        categoria: objetivo.categoria,
        brand_id: objetivo.brand_id,
        product_id: objetivo.product_id,
        tipo: req.body.tipo,
        valor: req.body.valor,
        activo: req.body.activo === undefined ? true : Boolean(req.body.activo),
      });
    } catch (err) {
      if (!esChoqueDeRegla(err)) throw err;

      // El mensaje nombra la que ya estaba: sin eso, «ya existe una regla» deja
      // a alguien buscando cuál entre veinte filas. Es de la misma empresa y del
      // mismo catálogo, así que no cuenta nada de nadie.
      const existente = await CatalogoReglaPrecio.findOne({
        where: { empresa_id: req.empresaId, catalogo_id: catalogo.id, ambito, ...objetivo },
      });

      return res.status(409).json({
        ok: false,
        error: existente
          ? `Ya hay una regla sobre ${nombreDelObjetivo}: ${textoDeRegla(existente)}. Editala o borrala en vez de crear otra.`
          : `Ya hay una regla sobre ${nombreDelObjetivo}.`,
        data: existente ? vistaRegla(existente) : null,
      });
    }

    res.status(201).json({ ok: true, data: vistaRegla(regla) });
  } catch (err) {
    fallo(req, res, err, 'Error al crear la regla de precio');
  }
});

// PUT /api/catalogos/:id/reglas/:reglaId
//
// Mandar `ambito` es lo que significa «apuntá esta regla a otra cosa»: sin él se
// editan sólo `tipo`, `valor` y `activo` y el objetivo queda como estaba.
router.put('/:id/reglas/:reglaId', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const regla = await findScoped(CatalogoReglaPrecio, req.params.reglaId, req.empresaId);
    // Y además tiene que ser de ESTE catálogo: una empresa puede tener varios, y
    // «el precio se cambió en el catálogo equivocado» es el defecto que esto
    // cierra.
    if (!regla || regla.catalogo_id !== catalogo.id) {
      return res.status(404).json({ ok: false, error: 'Regla no encontrada' });
    }

    const reapunta = req.body.ambito !== undefined;
    const ambito = reapunta ? req.body.ambito : regla.ambito;
    const objetivo = reapunta
      ? objetivoDeLaRegla(ambito, req.body)
      : { categoria: regla.categoria, brand_id: regla.brand_id, product_id: regla.product_id };

    if (!objetivo) {
      return res.status(400).json({
        ok: false,
        error: 'El ámbito de la regla no es uno de los cuatro que existen.',
      });
    }

    const cambios = {
      ambito,
      ...objetivo,
      tipo: req.body.tipo === undefined ? regla.tipo : req.body.tipo,
      valor: req.body.valor === undefined ? regla.valor : req.body.valor,
    };

    // ⚠ Una regla huérfana —la marca se borró y el `ON DELETE SET NULL` la dejó
    // con `brand_id` en NULL— NO pasa `validarRegla`, y tiene que poder
    // apagarse y borrarse: es lo único que se puede hacer con ella. Validarla
    // igual la dejaría atrapada, sin forma de sacarla de la pantalla.
    const esHuerfana = regla.ambito === 'marca' && regla.brand_id === null;

    if (!esHuerfana || reapunta) {
      const validacion = validarRegla(cambios);
      if (!validacion.ok) return res.status(400).json({ ok: false, error: validacion.motivo });
    }

    // El objetivo nuevo se valida contra la empresa igual que en el create, y
    // por el mismo motivo: reapuntar una regla a la marca de otra empresa es la
    // misma fuga escrita con otro verbo.
    if (reapunta && ambito === 'marca') {
      const marca = await findScoped(Brand, objetivo.brand_id, req.empresaId);
      if (!marca) return res.status(404).json({ ok: false, error: 'La marca indicada no existe.' });
    }

    if (reapunta && ambito === 'producto') {
      const producto = await findScoped(Product, objetivo.product_id, req.empresaId);
      if (!producto) return res.status(404).json({ ok: false, error: 'El producto indicado no existe.' });
    }

    if (req.body.activo !== undefined) cambios.activo = Boolean(req.body.activo);

    try {
      await regla.update(cambios);
    } catch (err) {
      if (!esChoqueDeRegla(err)) throw err;
      return res.status(409).json({
        ok: false,
        error: 'Ya hay otra regla de este ámbito sobre lo mismo. Editala o borrala en vez de duplicarla.',
      });
    }

    res.json({ ok: true, data: vistaRegla(regla) });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar la regla de precio');
  }
});

// DELETE /api/catalogos/:id/reglas/:reglaId
router.delete('/:id/reglas/:reglaId', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const regla = await findScoped(CatalogoReglaPrecio, req.params.reglaId, req.empresaId);
    if (!regla || regla.catalogo_id !== catalogo.id) {
      return res.status(404).json({ ok: false, error: 'Regla no encontrada' });
    }

    await regla.destroy();

    res.json({ ok: true, message: 'Regla eliminada' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar la regla de precio');
  }
});

// GET /api/catalogos/:id/categorias
//
// Las categorías que existen HOY en los productos publicables del catálogo
// (FR-078). No hay lista fija ni tabla de categorías: `products.category` es
// texto libre, así que se agrupan con `normalizarTexto`.
//
// Devuelve las dos cosas: `categoria` es lo que se manda al crear la regla —la
// clave normalizada, la misma que compara el motor— y `etiqueta` es lo que se
// dibuja, con sus mayúsculas y sus acentos.
router.get('/:id/categorias', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const filas = await CatalogoProducto.findAll({
      where: { catalogo_id: catalogo.id },
      raw: true,
    });
    if (filas.length === 0) return res.json({ ok: true, data: [] });

    const productos = await Product.findAll({
      where: {
        id: filas.map((f) => f.product_id),
        empresa_id: req.empresaId,
        publicable: true,
      },
      attributes: ['id', 'category'],
      // ⚠ Orden explícito, y no es cosmético: la etiqueta de una categoría la
      // fija el PRIMER producto que se lea con esa clave normalizada. Sin
      // `order`, Postgres devuelve las filas como quiera y «Proteínas» o
      // «proteinas» ganan según la corrida — pasó en CI y no en la máquina de
      // trabajo, que es la peor forma de descubrirlo.
      order: [['id', 'ASC']],
    });

    const porClave = new Map();

    for (const p of productos) {
      const clave = normalizarTexto(p.category);
      // Un producto sin categoría no inventa una: la regla no tendría a qué
      // apuntar.
      if (clave === '') continue;

      const ya = porClave.get(clave);
      if (ya) { ya.productos += 1; continue; }

      porClave.set(clave, { categoria: clave, etiqueta: String(p.category).trim(), productos: 1 });
    }

    res.json({
      ok: true,
      data: [...porClave.values()].sort((a, b) => a.categoria.localeCompare(b.categoria)),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las categorías del catálogo');
  }
});

// ════════════════════════════════════════════
//  Los productos del catálogo y la previsualización
//
//  ── Los dos endpoints de productos son EN LOTE ──
//
//  `catalogo_productos` es una lista de inclusión y se arma a mano (decisión 9):
//  sin acciones masivas, montar el catálogo de Comprafit el primer día son 62
//  clics. El lote no es un adorno de la maqueta, es lo que hace usable la
//  selección explícita (FR-066).
//
//  ── Un id ajeno en el lote no agrega nada, y tampoco tumba el lote ──
//
//  Se filtra por `empresa_id` y se cuenta cuántos entraron. Rechazar los 62
//  porque uno de los ids ya no existe deja al comercio sin forma de avanzar y
//  sin saber cuál era.
// ════════════════════════════════════════════

/** Los ids del cuerpo, enteros, sin repetidos y sin basura. */
function idsDelLote(body = {}) {
  if (!Array.isArray(body.ids)) return [];
  return [...new Set(body.ids.map((v) => aEnteroPositivo(v)).filter((v) => v !== null))];
}

// GET /api/catalogos/:id/productos
//
// Los del catálogo Y los publicables que todavía no están: es una sola pantalla
// de selección, no dos. Un producto que está en el catálogo y dejó de ser
// publicable sigue apareciendo —con `publicable: false`—, o desaparecería de la
// pantalla sin que nadie pueda sacarlo.
router.get('/:id/productos', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const filas = await CatalogoProducto.findAll({
      where: { catalogo_id: catalogo.id },
      raw: true,
      // Orden explícito: lo que sale de acá alimenta una lista, y sin él el
      // resultado depende de cómo Postgres decida leer las filas.
      order: [['id', 'ASC']],
    });
    const ordenPorProducto = new Map(filas.map((f) => [f.product_id, f.orden]));

    const productos = await Product.findAll({
      where: {
        empresa_id: req.empresaId,
        [Op.or]: [{ publicable: true }, { id: filas.map((f) => f.product_id) }],
      },
      // Orden explícito: lo que sale de acá alimenta una lista, y sin él el
      // resultado depende de cómo Postgres decida leer las filas.
      order: [['id', 'ASC']],
    });

    const settings = await ajustesDePrecio(req.empresaId);

    const data = productos.map((p) => {
      const precios = calcularPrecios(p, settings);
      const avisos = [];

      // No va a salir aunque esté marcado publicable: hoy son 376 de los 431 de
      // Comprafit.
      if (precios.sinCosto) avisos.push('SIN_PRECIO');
      // La foto vive en un hosting de terceros que puede caerse, cambiar la
      // imagen o pedir referer. No se publica.
      if (p.image_url && !esImagenPropia(p.image_url)) avisos.push('FOTO_EXTERNA');

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        brand_id: p.brand_id,
        image_url: p.image_url,
        precio_lista: precios.cashPrice,
        en_el_catalogo: ordenPorProducto.has(p.id),
        orden: ordenPorProducto.has(p.id) ? ordenPorProducto.get(p.id) : null,
        publicable: p.publicable,
        is_active: p.is_active,
        avisos,
      };
    });

    // Los del catálogo primero y en el orden de la grilla; los demás por nombre.
    data.sort((a, b) => {
      if (a.en_el_catalogo !== b.en_el_catalogo) return a.en_el_catalogo ? -1 : 1;
      if (a.en_el_catalogo) return a.orden - b.orden || a.id - b.id;
      return String(a.name).localeCompare(String(b.name));
    });

    res.json({ ok: true, data });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los productos del catálogo');
  }
});

// POST /api/catalogos/:id/productos — agregar en lote
router.post('/:id/productos', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const ids = idsDelLote(req.body);
    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'Hace falta al menos un producto.' });
    }

    // Sólo los de esta empresa. Un id de otra no agrega nada.
    const propios = await Product.findAll({
      where: { id: ids, empresa_id: req.empresaId },
      attributes: ['id'],
      raw: true,
    });

    const yaEstaban = await CatalogoProducto.findAll({
      where: { catalogo_id: catalogo.id },
      raw: true,
    });
    const presentes = new Set(yaEstaban.map((f) => f.product_id));

    let orden = yaEstaban.reduce((max, f) => Math.max(max, f.orden), -1);

    // ⚠ El orden de los nuevos sale del orden en que el cliente mandó los ids,
    // no del que devuelva Postgres.
    //
    // `propios` viene de un `findAll` sin `order`: sin esta línea, el `orden`
    // que recibe cada producto depende de cómo el motor decida leer las filas, y
    // eso cambia entre corridas. Se descubrió en CI, con el test verde en la
    // máquina de trabajo — que es la peor forma de descubrirlo.
    //
    // Y respetar el orden del cliente no es sólo determinismo: es el orden en
    // que quien armó el catálogo eligió los productos, que es el que espera ver
    // en la grilla.
    const posicionPedida = new Map(ids.map((id, i) => [Number(id), i]));
    const enOrden = [...propios].sort(
      (a, b) => (posicionPedida.get(a.id) ?? 0) - (posicionPedida.get(b.id) ?? 0)
    );

    const nuevas = enOrden
      .filter((p) => !presentes.has(p.id))
      .map((p) => ({ catalogo_id: catalogo.id, product_id: p.id, orden: ++orden }));

    if (nuevas.length > 0) {
      // `ignoreDuplicates` es la red del índice `uq_catalogo_producto`: el filtro
      // de arriba resuelve el caso normal, y dos pedidos simultáneos con el
      // mismo producto pasan los dos por él.
      await CatalogoProducto.bulkCreate(nuevas, { ignoreDuplicates: true });
    }

    res.json({
      ok: true,
      data: {
        pedidos: ids.length,
        agregados: nuevas.length,
        ya_estaban: propios.length - nuevas.length,
        ajenos: ids.length - propios.length,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al agregar productos al catálogo');
  }
});

// DELETE /api/catalogos/:id/productos — quitar en lote
//
// Quitar BORRA la fila (FR-065). No hay columna `visible`: sería una tercera
// bandera para decir lo que dice que la fila no exista.
router.delete('/:id/productos', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const ids = idsDelLote(req.body);
    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'Hace falta al menos un producto.' });
    }

    // El `catalogo_id` acota el borrado a un catálogo que ya pasó por
    // `findScoped`: un id de otra empresa no borra nada.
    const quitados = await CatalogoProducto.destroy({
      where: { catalogo_id: catalogo.id, product_id: ids },
    });

    res.json({ ok: true, data: { pedidos: ids.length, quitados } });
  } catch (err) {
    fallo(req, res, err, 'Error al quitar productos del catálogo');
  }
});

// GET /api/catalogos/:id/previsualizacion
//
// Las cinco columnas de la maqueta —producto, precio de lista, regla que gana,
// pisadas y precio final— más las dos listas que no son adorno:
//
//  · `avisos: ["QUEDA_EN_CERO"]` cuando una regla deja el precio en $0. En el
//    punto de venta eso lo mira una persona antes de cobrar; en una página
//    pública **un producto a $0 es una oferta**, y alguien la va a tomar.
//  · `sin_precio`, los que NO van a salir aunque estén marcados publicables.
//    Hoy en Comprafit serían 376 de 431, así que el panel dice cuántos son **y
//    cuáles**: «55 de 431 productos» sin la lista no le sirve a nadie para
//    arreglarlo.
router.get('/:id/previsualizacion', checkPermission('catalogo.ver'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const settings = await ajustesDePrecio(req.empresaId);
    const productos = await productosDelCatalogo(catalogo, settings);

    const reglas = await CatalogoReglaPrecio.findAll({
      where: { catalogo_id: catalogo.id, empresa_id: req.empresaId },
      order: [['id', 'ASC']],
    });

    const { porProducto } = resolverPrecios(productos, reglas);

    const salen = [];
    const sinPrecio = [];
    const noPublicables = [];

    for (const item of productos) {
      const p = item.producto;
      const identidad = { id: p.id, name: p.name, sku: p.sku };

      // El orden de los dos filtros importa: «no está marcado publicable» y «no
      // tiene precio» son dos problemas distintos y se arreglan en pantallas
      // distintas.
      if (!p.publicable || !p.is_active) {
        noPublicables.push({ ...identidad, publicable: p.publicable, is_active: p.is_active });
        continue;
      }

      if (item.sinCosto) {
        sinPrecio.push(identidad);
        continue;
      }

      const calculado = porProducto.get(p.id);
      const avisos = [];
      if (calculado.precio === 0) avisos.push('QUEDA_EN_CERO');

      salen.push({
        ...identidad,
        category: p.category,
        brand_id: p.brand_id,
        image_url: p.image_url,
        precio_lista: calculado.precioLista,
        precio: calculado.precio,
        regla: calculado.gana ? vistaRegla(calculado.gana) : null,
        // Las pisadas se devuelven: la pantalla las muestra tachadas debajo de
        // la que ganó, y es lo que hace entendible por qué el precio es ese.
        pisadas: calculado.pisadas.map(vistaRegla),
        avisos,
      });
    }

    res.json({
      ok: true,
      data: {
        productos: salen,
        sin_precio: sinPrecio,
        no_publicables: noPublicables,
        totales: {
          en_el_catalogo: productos.length,
          salen: salen.length,
          sin_precio: sinPrecio.length,
          no_publicables: noPublicables.length,
        },
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al previsualizar el catálogo');
  }
});

// ════════════════════════════════════════════
//  El logo y la portada
//
//  Reusan `utils/imagenes.js` tal cual, con sus dos usos propios: portada
//  1200×480 JPEG y logo 400×400 **PNG**. El logo va en PNG porque la pantalla lo
//  dibuja sobre un recuadro y necesita el fondo transparente — un JPEG lo pierde
//  en silencio y el logo sale con un rectángulo negro detrás.
//
//  Las columnas guardan la **ruta relativa** (`/img/aa/bb/xxx.png`), nunca la
//  URL absoluta: mudarse de dominio no puede exigir migrar datos.
// ════════════════════════════════════════════

const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;

const subirImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGEN_BYTES },
}).single('imagen');

/**
 * Envuelve a multer para que sus errores salgan en castellano y con su status.
 *
 * ⚠ Responde acá mismo y **no** hace `next(err)`, igual que `conFoto` de
 * `routes/products.js:367`. Se probó al revés y el error terminaba en el
 * manejador global contestando «Error interno del servidor»: el 500 genérico que
 * este envoltorio existe para evitar.
 */
const conImagen = (req, res, next) => subirImagen(req, res, (err) => {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      ok: false,
      error: `La imagen no puede pesar más de ${MAX_IMAGEN_BYTES / 1024 / 1024} MB.`,
    });
  }

  return res.status(400).json({
    ok: false,
    error: 'No se pudo subir la imagen. Probá de nuevo con otro archivo.',
  });
});

/** Los dos usos, y la columna de cada uno. El `tipo` que llega se busca acá. */
const COLUMNA_DE_IMAGEN = { logo: 'logo_url', portada: 'portada_url' };

const TIPO_INVALIDO = 'Hace falta decir qué imagen es: «logo» o «portada».';

// POST /api/catalogos/:id/imagen — campo `tipo` = logo | portada
router.post('/:id/imagen', checkPermission('catalogo.editar'), conImagen, async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const tipo = String((req.body && req.body.tipo) || req.query.tipo || '');
    const columna = COLUMNA_DE_IMAGEN[tipo];
    if (!columna) return res.status(400).json({ ok: false, error: TIPO_INVALIDO });

    if (!req.file) return res.status(400).json({ ok: false, error: 'No llegó ninguna imagen.' });

    let guardada;
    try {
      // `sharp` es también la validación: un `.exe` renombrado a `.png` muere
      // acá, sin importar qué extensión ni qué Content-Type declaró el cliente.
      guardada = await redimensionarYGuardar(req.file.buffer, tipo);
    } catch (err) {
      if (err.code === 'ENOSPC') {
        logger.error({ msg: 'imagenes: el volumen está lleno', empresa_id: req.empresaId });
        return res.status(507).json({
          ok: false,
          codigo: 'SIN_ESPACIO',
          error: 'No queda espacio para guardar más imágenes. Avisale al administrador del sistema.',
        });
      }
      return res.status(400).json({
        ok: false,
        error: 'El archivo no es una imagen que podamos leer. Probá con un JPG o un PNG.',
      });
    }

    const anterior = catalogo[columna];

    await catalogo.update({ [columna]: guardada.url });

    // La anterior se borra DESPUÉS de que la nueva quedó escrita y referenciada.
    // Al revés, un fallo en el medio deja al catálogo sin ninguna imagen.
    if (anterior && anterior !== guardada.url) {
      await borrarImagen(anterior).catch((err) => {
        logger.warn({ msg: 'imagenes: no se pudo borrar la imagen anterior', url: anterior, err: err.message });
      });
    }

    res.json({ ok: true, data: { tipo, url: guardada.url } });
  } catch (err) {
    fallo(req, res, err, 'Error al subir la imagen del catálogo');
  }
});

// DELETE /api/catalogos/:id/imagen?tipo=logo|portada
router.delete('/:id/imagen', checkPermission('catalogo.editar'), async (req, res) => {
  try {
    const catalogo = await findScoped(Catalogo, req.params.id, req.empresaId);
    if (!catalogo) return res.status(404).json({ ok: false, error: 'Catálogo no encontrado' });

    const tipo = String(req.query.tipo || '');
    const columna = COLUMNA_DE_IMAGEN[tipo];
    if (!columna) return res.status(400).json({ ok: false, error: TIPO_INVALIDO });

    const url = catalogo[columna];

    // Primero la columna: si el `unlink` falla, lo que sobra es un archivo
    // huérfano, que es un problema de disco. Al revés quedaría una columna
    // apuntando a un archivo borrado, que la pantalla dibuja rota.
    await catalogo.update({ [columna]: null });

    await borrarImagen(url).catch((err) => {
      logger.warn({ msg: 'imagenes: no se pudo borrar el archivo', url, err: err.message });
    });

    res.json({ ok: true, message: 'Imagen eliminada' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar la imagen del catálogo');
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
    // Orden explícito: lo que sale de acá alimenta una lista, y sin él el
    // resultado depende de cómo Postgres decida leer las filas.
    order: [['id', 'ASC']],
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
    // Orden explícito: lo que sale de acá alimenta una lista, y sin él el
    // resultado depende de cómo Postgres decida leer las filas.
    order: [['id', 'ASC']],
  });
}

module.exports = router;
module.exports.productosQueSalen = productosQueSalen;
