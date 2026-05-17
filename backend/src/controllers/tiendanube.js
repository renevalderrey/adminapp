const tiendanubeService = require('../services/tiendanubeService');

const getAuthUrl = (req, res) => {
  const clientId = process.env.TIENDANUBE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'TIENDANUBE_CLIENT_ID no configurado en el servidor.' });
  }
  // El usuario deberá instalar la app desde el link de TiendaNube.
  // Esta URL sirve de referencia si tenemos un flujo iniciado por el admin.
  const authUrl = `https://www.tiendanube.com/apps/${clientId}/authorize`;
  res.json({ url: authUrl });
};

const handleCallback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Código de autorización no proporcionado por TiendaNube' });
  }

  try {
    const data = await tiendanubeService.getAccessToken(code);
    // Redirigir al frontend mostrando éxito
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?tiendanube=success`);
  } catch (error) {
    console.error('Error en el callback de TiendaNube:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?tiendanube=error`);
  }
};

const getStatus = async (req, res) => {
  try {
    const credentials = await tiendanubeService.getStoredToken();
    res.json({ linked: !!credentials });
  } catch (error) {
    res.status(500).json({ error: 'Error al comprobar el estado de TiendaNube' });
  }
};

const handleWebhook = async (req, res) => {
  // Aquí recibiremos los eventos de TiendaNube (ej. order/created, product/updated)
  console.log('Webhook de TiendaNube recibido:', req.headers['x-event'], req.body);
  
  const event = req.headers['x-event']; // Ej: order/created
  
  // TODO: Procesar el evento y actualizar stock local
  
  res.status(200).send('OK');
};

module.exports = {
  getAuthUrl,
  handleCallback,
  getStatus,
  handleWebhook
};
