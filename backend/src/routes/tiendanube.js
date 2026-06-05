const express = require('express');
const router = express.Router();
const tiendanubeController = require('../controllers/tiendanube');
const checkPermission = require('../middleware/checkPermission');

// Rutas para la integración con TiendaNube

// Iniciar proceso de autenticación (Opcional, usualmente inicia desde el panel de TN)
router.get('/auth', tiendanubeController.getAuthUrl);

// Endpoint de Callback donde TiendaNube envía el "code" luego de autorizar
router.get('/callback', tiendanubeController.handleCallback);

// Comprobar si TiendaNube ya está vinculada en el sistema
router.get('/status', checkPermission('config.ver'), tiendanubeController.getStatus);

// Recepción de Webhooks desde TiendaNube
router.post('/webhook', express.json({type: 'application/json'}), tiendanubeController.handleWebhook);

module.exports = router;
