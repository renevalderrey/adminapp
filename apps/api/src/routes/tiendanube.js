const express = require('express');
const tiendanubeController = require('../controllers/tiendanube');
const checkPermission = require('../middleware/checkPermission');

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
// ════════════════════════════════════════════

// ── Rutas que llama TiendaNube, sin sesion de usuario ──
const publico = express.Router();

// El OAuth de TiendaNube redirige aca al final del flujo.
publico.get('/callback', tiendanubeController.handleCallback);

// El webhook necesita el cuerpo crudo para poder validar la firma HMAC: si se
// parsea antes, el JSON reserializado no coincide byte a byte con lo que
// TiendaNube firmo.
publico.post(
  '/webhook',
  express.json({
    type: 'application/json',
    verify: (req, res, buf) => { req.rawBody = buf; },
  }),
  tiendanubeController.handleWebhook
);

// ── Rutas que llama la app, con usuario autenticado ──
const privado = express.Router();

privado.get('/auth', checkPermission('config.ver'), tiendanubeController.getAuthUrl);
privado.get('/status', checkPermission('config.ver'), tiendanubeController.getStatus);
privado.get('/products', checkPermission('config.ver'), tiendanubeController.listProducts);
privado.post('/mapping', checkPermission('config.editar'), tiendanubeController.createMapping);
privado.post('/sync-stock', checkPermission('config.editar'), tiendanubeController.syncStock);

module.exports = { publico, privado };
