const { Setting, TiendanubeMapping, Stock, StockMovement } = require('../models');
const tiendanubeService = require('../services/tiendanubeService');

const getAuthUrl = (req, res) => {
  const clientId = process.env.TIENDANUBE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'TIENDANUBE_CLIENT_ID no configurado en el servidor.' });
  }
  const authUrl = `https://www.tiendanube.com/apps/${clientId}/authorize`;
  res.json({ url: authUrl });
};

const handleCallback = async (req, res) => {
  const { code } = req.query;
  const empresaId = req.empresaId || 1;

  if (!code) {
    return res.status(400).json({ error: 'Código de autorización no proporcionado por TiendaNube' });
  }

  try {
    const data = await tiendanubeService.getAccessToken(code, empresaId);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?tiendanube=success`);
  } catch (error) {
    console.error('Error en el callback de TiendaNube:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?tiendanube=error`);
  }
};

const getStatus = async (req, res) => {
  try {
    const credentials = await tiendanubeService.getStoredToken(req.empresaId || 1);
    res.json({ linked: !!credentials });
  } catch (error) {
    res.status(500).json({ error: 'Error al comprobar el estado de TiendaNube' });
  }
};

const handleWebhook = async (req, res) => {
  try {
    const event = req.headers['x-event'];
    const empresaId = req.empresaId || 1;

    if (event === 'order/created' || event === 'order/paid') {
      const orderData = req.body;
      await tiendanubeService.processOrderCreated(orderData, empresaId, req.puntoDeVentaId || null);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing TiendaNube webhook:', error);
    res.status(200).send('OK');
  }
};

const listProducts = async (req, res) => {
  try {
    const products = await tiendanubeService.getProducts(req.empresaId || 1);
    res.json({ ok: true, data: products });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

const createMapping = async (req, res) => {
  try {
    const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;
    const mapping = await TiendanubeMapping.create({
      empresa_id: req.empresaId || 1,
      product_id,
      tiendanube_variant_id,
      tiendanube_product_id,
    });
    res.status(201).json({ ok: true, data: mapping });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

const syncStock = async (req, res) => {
  try {
    const { punto_de_venta_id } = req.body;
    const empresaId = req.empresaId || 1;

    const mappings = await TiendanubeMapping.findAll({ where: { empresa_id: empresaId } });
    const stockWhere = { empresa_id: empresaId };
    if (punto_de_venta_id) stockWhere.punto_de_venta_id = punto_de_venta_id;

    const stockEntries = await Stock.findAll({ where: stockWhere });

    let synced = 0;
    for (const stock of stockEntries) {
      const mapping = mappings.find(m => m.product_id === stock.product_id);
      if (mapping) {
        await tiendanubeService.updateVariantStock(empresaId, mapping.tiendanube_variant_id, stock.quantity);
        synced++;
      }
    }

    res.json({ ok: true, synced });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
