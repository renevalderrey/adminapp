const express = require('express');
const crypto = require('crypto');
const { Setting, Product, Stock, TiendanubeMapping } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const tiendanubeService = require('../services/tiendanubeService');
const { findScoped } = require('../utils/tenantScope');
const { fallo, ErrorDeNegocio } = require('../utils/errores');
const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  TiendaNube · dos routers con exposicion distinta
//
//  Antes era un router unico montado en server.js SIN la cadena de
//  autenticacion. Eso producia dos problemas opuestos al mismo tiempo:
//
//   - /webhook quedaba abierto a internet y, como el controlador resolvia la
//     empresa con `req.empresaId || 1`, cualquiera podia postear un pedido
//     falso y descontarle stock a la empresa 1, que en produccion es un
//     cliente real.
//
//   - /status, /products, /mapping y /sync-stock usaban checkPermission, que
//     lee req.usuarioPermisos. Ese campo lo llena loadEmpresaContext, que no
//     corria: en produccion esos endpoints respondian 403 siempre y la
//     integracion no se podia usar.
//
//  Ahora se separan: `publico` para lo que TiendaNube llama desde afuera y
//  `privado` para lo que llama la app, que server.js monta detras de la
//  cadena de autenticacion.
//
//  ── Por que los handlers viven ACA y no en un controllers/ ──
//
//  Hasta el hito 013 estos siete handlers vivian en `src/controllers/`, el
//  unico directorio del servidor que **ninguna** de las cinco guardias
//  estaticas mira: `aislamientoEmpresas.test.js` recorre routes/, services/ y
//  utils/; `observabilidad.test.js` y `permisosDeRutas.test.js` solo routes/.
//  Un solo archivo, con una convencion que el resto del repositorio no usa, y
//  fuera del radar de todo.
//
//  Lo que se pago por eso: `createMapping` colgaba una fila de un producto que
//  nadie habia validado —el mismo IDOR que dfd7009 cerro en los pagos a
//  proveedores— y respondia 201. El detector `analizarCreates` reconoce esa
//  forma y la habria nombrado con archivo y linea. Nunca miro ahi.
//
//  El directorio se borro, y hay una guardia en `observabilidad.test.js` que
//  falla si vuelve a existir. No alcanza con no volver a usarlo: cada guardia
//  futura vuelve a nacer sin ese directorio en su lista.
// ════════════════════════════════════════════

// ── Rutas que llama TiendaNube, sin sesion de usuario ──
const publico = express.Router();

/**
 * Verifica la firma HMAC-SHA256 que TiendaNube adjunta a cada webhook.
 *
 * Sin esto, el endpoint acepta cualquier cuerpo de cualquier origen: un tercero
 * podia postear un pedido inventado y descontar inventario.
 */
function firmaValida(req) {
  const secret = process.env.TIENDANUBE_CLIENT_SECRET;
  const recibida = req.headers['x-linkedstore-hmac-sha256'];

  if (!secret || !recibida || !req.rawBody) return false;

  const esperada = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(recibida), 'utf8');
  if (a.length !== b.length) return false;

  // Comparacion en tiempo constante: comparar con === filtra informacion sobre
  // la firma correcta a traves del tiempo de respuesta.
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resuelve a que empresa pertenece un webhook, a partir del id de tienda.
 *
 * getAccessToken guarda ese id en el setting tiendanube_user_id de la empresa
 * que vinculo la cuenta, asi que la busqueda inversa es directa.
 */
async function empresaDeLaTienda(storeId) {
  if (!storeId) return null;

  // El valor es JSONB: puede estar guardado como number o como string, asi que
  // la comparacion se hace sobre el texto.
  const vinculadas = await Setting.findAll({ where: { key: 'tiendanube_user_id' } });
  const match = vinculadas.find((s) => String(s.value) === String(storeId));

  return match ? match.empresa_id : null;
}

/**
 * Callback del OAuth de TiendaNube.
 *
 * Es publico —TiendaNube redirige el navegador del usuario hasta aca— asi que
 * no hay sesion. La empresa se identifica con el parametro `state`, que se
 * genera al iniciar el flujo.
 *
 * NOTA: hoy el frontend no manda `state`. Sin el no hay forma segura de saber
 * a que empresa corresponde el token, y la version anterior lo resolvia con
 * `|| 1`, guardando el token de cualquier empresa bajo la empresa 1. Se
 * rechaza en vez de adivinar. Ver la duda anotada en docs/ANALISIS.md.
 */
publico.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code) {
    return res.redirect(`${frontend}/settings?tiendanube=error&motivo=sin_codigo`);
  }

  const empresaId = parseInt(state, 10);
  if (!Number.isInteger(empresaId)) {
    logger.warn({ state }, 'tiendanube: callback sin state valido, no se puede resolver la empresa');
    return res.redirect(`${frontend}/settings?tiendanube=error&motivo=sin_empresa`);
  }

  try {
    await tiendanubeService.getAccessToken(code, empresaId);
    res.redirect(`${frontend}/settings?tiendanube=success`);
  } catch (error) {
    logger.error({ err: error, empresaId }, 'tiendanube: error en el callback');
    res.redirect(`${frontend}/settings?tiendanube=error`);
  }
});

// El webhook necesita el cuerpo crudo para poder validar la firma HMAC: si se
// parsea antes, el JSON reserializado no coincide byte a byte con lo que
// TiendaNube firmo.
publico.post(
  '/webhook',
  express.json({
    type: 'application/json',
    verify: (req, res, buf) => { req.rawBody = buf; },
  }),
  async (req, res) => {
    // Siempre 200: TiendaNube reintenta y deshabilita el webhook si recibe
    // errores repetidos. Los rechazos se registran, no se devuelven.
    try {
      if (!firmaValida(req)) {
        logger.warn(
          { ip: req.ip, evento: req.headers['x-event'] },
          'tiendanube: webhook con firma invalida, descartado'
        );
        return res.status(401).send('firma invalida');
      }

      const evento = req.headers['x-event'];
      const orderData = req.body || {};

      // Antes se procesaban 'order/created' Y 'order/paid'. Un pedido normal
      // dispara los dos, con lo cual el stock se descontaba DOS veces por la
      // misma venta. Se toma solo uno: 'order/paid', que es el momento en que la
      // venta esta confirmada.
      if (evento !== 'order/paid') {
        return res.status(200).send('OK');
      }

      const empresaId = await empresaDeLaTienda(orderData.store_id);

      if (!empresaId) {
        logger.warn(
          { storeId: orderData.store_id },
          'tiendanube: webhook de una tienda que no esta vinculada a ninguna empresa'
        );
        return res.status(200).send('OK');
      }

      await tiendanubeService.processOrderCreated(orderData, empresaId, null);

      res.status(200).send('OK');
    } catch (error) {
      logger.error({ err: error }, 'tiendanube: error procesando el webhook');
      res.status(200).send('OK');
    }
  }
);

// ── Rutas que llama la app, con usuario autenticado ──
const privado = express.Router();

// Los endpoints privados corren detras de requireEmpresa, asi que req.empresaId
// siempre esta definido. Antes todos usaban `req.empresaId || 1` y el router se
// montaba sin autenticacion: en la practica operaban sobre la empresa 1.

/**
 * Un fallo de TiendaNube no es un fallo de AdminApp.
 *
 * Se responde 502 —el que no contesto es el tercero— y el error real va al log
 * con el requestId con el que se encuentra la linea en Render. `fallo` con un
 * ErrorDeNegocio deja solo un `warn` con el texto publico, asi que el detalle
 * de axios —el status, el cuerpo de la respuesta— se perderia justo en el
 * unico caso donde hace falta.
 *
 * Es lo minimo que sostiene esta distincion hoy. La clasificacion completa
 * —timeout, 401, 429, 5xx, cada uno con su mensaje— es `errorDeTiendanube` y
 * llega con la sincronizacion.
 */
function falloDeTiendanube(req, res, err, mensaje) {
  logger.error({ err, empresaId: req.empresaId }, mensaje);
  return fallo(req, res, new ErrorDeNegocio(mensaje, 502), mensaje);
}

/**
 * El id que mando el cliente, como entero positivo, o null.
 *
 * Los tres ids del mapeo son NOT NULL en la tabla. Sin esta validacion un
 * `product_id: 'abc'` llegaba hasta Postgres y volvia como un 500 generico:
 * el usuario leia «Error al crear el mapeo de producto» y no habia forma de
 * saber que lo que estaba mal era el dato que mando.
 */
function idEntero(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor > 0 ? valor : null;

  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const n = parseInt(valor.trim(), 10);
    return n > 0 ? n : null;
  }

  return null;
}

/**
 * Contra que choco el mapeo, en castellano.
 *
 * La tabla tiene DOS indices unicos —`uq_tn_mapping_product` sobre
 * (empresa_id, product_id) y `uq_tn_mapping_variant` sobre (empresa_id,
 * tiendanube_variant_id)— y el usuario tiene que saber cual de los dos fue:
 * «ese producto ya esta mapeado» y «esa variante ya esta mapeada» se corrigen
 * de maneras distintas. Por eso se relee el mapeo existente en vez de repetir
 * el texto del driver.
 *
 * Antes los dos casos respondian el mismo 500 generico.
 */
async function motivoDelChoque(empresaId, producto, varianteId) {
  const porProducto = await TiendanubeMapping.findOne({
    where: { empresa_id: empresaId, product_id: producto.id },
  });

  if (porProducto) {
    return `"${producto.name}" ya está mapeado a la variante ${porProducto.tiendanube_variant_id}.`;
  }

  const porVariante = await TiendanubeMapping.findOne({
    where: { empresa_id: empresaId, tiendanube_variant_id: varianteId },
  });

  if (porVariante) {
    const otro = await findScoped(Product, porVariante.product_id, empresaId);
    const nombre = otro ? otro.name : `el producto ${porVariante.product_id}`;
    return `Esa variante ya está mapeada a "${nombre}".`;
  }

  // No deberia pasar: el choque lo tiro uno de los dos indices. Si llega aca es
  // que la fila desaparecio entre el INSERT y la relectura.
  return 'Ese mapeo ya existe.';
}

privado.get('/auth', checkPermission('config.ver'), (req, res) => {
  try {
    const clientId = process.env.TIENDANUBE_CLIENT_ID;

    if (!clientId) {
      // El 500 con su texto se conserva: es un estado propio —«la integracion
      // no esta configurada en el servidor»— y es distinto de «no vinculada».
      // Colapsarlos dejaria al usuario intentando vincular algo que el servidor
      // no puede vincular.
      throw new ErrorDeNegocio('TIENDANUBE_CLIENT_ID no configurado en el servidor.', 500);
    }

    res.json({ ok: true, url: `https://www.tiendanube.com/apps/${clientId}/authorize` });
  } catch (err) {
    fallo(req, res, err, 'Error al armar la URL de autorización de TiendaNube');
  }
});

privado.get('/status', checkPermission('config.ver'), async (req, res) => {
  try {
    const credentials = await tiendanubeService.getStoredToken(req.empresaId);
    res.json({ ok: true, linked: !!credentials });
  } catch (err) {
    fallo(req, res, err, 'Error al comprobar el estado de TiendaNube');
  }
});

privado.get('/products', checkPermission('config.ver'), async (req, res) => {
  try {
    const products = await tiendanubeService.getProducts(req.empresaId);
    res.json({ ok: true, data: products });
  } catch (err) {
    falloDeTiendanube(req, res, err, 'No se pudieron obtener los productos de TiendaNube');
  }
});

privado.post('/mapping', checkPermission('config.editar'), async (req, res) => {
  try {
    // `req.body || {}` y no desestructurar: un POST sin cuerpo JSON deja
    // `req.body` sin definir segun el parser que haya corrido, y un
    // TypeError aca saldria como 500 en vez del 400 que corresponde.
    const cuerpo = req.body || {};

    const productId = idEntero(cuerpo.product_id);
    const varianteId = idEntero(cuerpo.tiendanube_variant_id);
    const productoDeLaTienda = idEntero(cuerpo.tiendanube_product_id);

    if (!productId || !varianteId || !productoDeLaTienda) {
      throw new ErrorDeNegocio(
        'El mapeo necesita el producto, la variante y el producto de TiendaNube, ' +
        'los tres como números enteros.'
      );
    }

    // findScoped y no findByPk: el id viene del cuerpo. **Esta es la mitad que
    // no existia.** Sin ella, la empresa B mandaba el product_id de la A y la
    // fila se creaba con el empresa_id de B —asi que revisando la tabla no se
    // ve nada raro— colgada de un producto ajeno, y la respuesta era 201.
    const producto = await findScoped(Product, productId, req.empresaId);

    // 404 y no 403: un 403 confirmaria que ese producto existe en otra empresa,
    // que es justo lo que permite enumerar ids ajenos.
    if (!producto) throw new ErrorDeNegocio('Producto no encontrado', 404);

    let mapping;

    try {
      mapping = await TiendanubeMapping.create({
        empresa_id: req.empresaId,
        // `producto.id` y no `req.body.product_id`: es la forma que dfd7009
        // dejo en routes/suppliers.js y la que `analizarCreates` da por
        // validada. Escribir el id del cuerpo aca reabriria el agujero aunque
        // el findScoped siguiera arriba.
        product_id: producto.id,
        tiendanube_variant_id: varianteId,
        tiendanube_product_id: productoDeLaTienda,
      });
    } catch (err) {
      if (err.name !== 'SequelizeUniqueConstraintError') throw err;

      throw new ErrorDeNegocio(await motivoDelChoque(req.empresaId, producto, varianteId), 409);
    }

    res.status(201).json({ ok: true, data: mapping });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el mapeo de producto');
  }
});

privado.post('/sync-stock', checkPermission('config.editar'), async (req, res) => {
  try {
    const { punto_de_venta_id } = req.body;
    const empresaId = req.empresaId;

    const mappings = await TiendanubeMapping.findAll({ where: { empresa_id: empresaId } });

    const stockWhere = { empresa_id: empresaId };
    if (punto_de_venta_id) stockWhere.punto_de_venta_id = punto_de_venta_id;

    const stockEntries = await Stock.findAll({ where: stockWhere });

    let synced = 0;
    for (const stock of stockEntries) {
      const mapping = mappings.find((m) => m.product_id === stock.product_id);
      if (!mapping) continue;

      await tiendanubeService.updateVariantStock(empresaId, mapping.tiendanube_variant_id, stock.quantity);
      synced++;
    }

    res.json({ ok: true, synced });
  } catch (err) {
    falloDeTiendanube(req, res, err, 'No se pudo sincronizar el stock con TiendaNube');
  }
});

module.exports = { publico, privado };
