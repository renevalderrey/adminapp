const crypto = require('crypto');
const { Setting, TiendanubeMapping, Stock, StockMovement } = require('../models');
const tiendanubeService = require('../services/tiendanubeService');
const logger = require('../utils/logger');

// Los endpoints privados corren detras de requireEmpresa, asi que req.empresaId
// siempre esta definido. Antes todos usaban `req.empresaId || 1` y el router se
// montaba sin autenticacion: en la practica operaban sobre la empresa 1.

const getAuthUrl = (req, res) => {
  const clientId = process.env.TIENDANUBE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ ok: false, error: 'TIENDANUBE_CLIENT_ID no configurado en el servidor.' });
  }
  res.json({ ok: true, url: `https://www.tiendanube.com/apps/${clientId}/authorize` });
};

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
const handleCallback = async (req, res) => {
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
};

const getStatus = async (req, res) => {
  try {
    const credentials = await tiendanubeService.getStoredToken(req.empresaId);
    res.json({ ok: true, linked: !!credentials });
  } catch (error) {
    logger.error({ err: error, empresaId: req.empresaId }, 'tiendanube: status');
    res.status(500).json({ ok: false, error: 'Error al comprobar el estado de TiendaNube' });
  }
};

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

const handleWebhook = async (req, res) => {
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
};

const listProducts = async (req, res) => {
  try {
    const products = await tiendanubeService.getProducts(req.empresaId);
    res.json({ ok: true, data: products });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'tiendanube: listProducts');
    res.status(502).json({ ok: false, error: 'No se pudieron obtener los productos de TiendaNube' });
  }
};

const createMapping = async (req, res) => {
  try {
    const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;

    const mapping = await TiendanubeMapping.create({
      empresa_id: req.empresaId,
      product_id,
      tiendanube_variant_id,
      tiendanube_product_id,
    });

    res.status(201).json({ ok: true, data: mapping });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'tiendanube: createMapping');
    res.status(500).json({ ok: false, error: 'Error al crear el mapeo de producto' });
  }
};

const syncStock = async (req, res) => {
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
    logger.error({ err, empresaId: req.empresaId }, 'tiendanube: syncStock');
    res.status(502).json({ ok: false, error: 'No se pudo sincronizar el stock con TiendaNube' });
  }
};

module.exports = {
  getAuthUrl,
  handleCallback,
  getStatus,
  handleWebhook,
  listProducts,
  createMapping,
  syncStock,
};
