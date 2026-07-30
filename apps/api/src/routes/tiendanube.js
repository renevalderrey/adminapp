const express = require('express');
const router = express.Router();
const tiendanubeController = require('../controllers/tiendanube');
const checkPermission = require('../middleware/checkPermission');

router.get('/auth', tiendanubeController.getAuthUrl);
router.get('/callback', tiendanubeController.handleCallback);
router.get('/status', checkPermission('config.ver'), tiendanubeController.getStatus);
router.post('/webhook', express.json({type: 'application/json'}), tiendanubeController.handleWebhook);
router.get('/products', checkPermission('config.ver'), tiendanubeController.listProducts);
router.post('/mapping', checkPermission('config.editar'), tiendanubeController.createMapping);
router.post('/sync-stock', checkPermission('config.editar'), tiendanubeController.syncStock);

module.exports = router;
