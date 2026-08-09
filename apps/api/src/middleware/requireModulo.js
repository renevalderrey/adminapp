const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  El gate del módulo, del lado del servidor
//
//  ── Por qué esto no existía ──
//
//  `enabled_modules` vive en `empresas.settings` desde el hito 1, y hasta el
//  hito 10 tuvo **cero apariciones en `apps/api/src`**: el gate era sólo el
//  `RouteGuard` de `App.jsx:38-67` y la barra lateral. O sea que apagarle un
//  módulo a una empresa le sacaba la pantalla y **le dejaba la API abierta**;
//  cualquiera con las herramientas del navegador seguía llegando.
//
//  Este middleware es la mitad que faltaba. De los tres gates que describe
//  `requireSuperadmin.js`, éste es el del medio:
//
//    permission  -> qué puede hacer el usuario dentro de su empresa
//    modulo      -> qué módulos tiene contratados la empresa   ← éste
//    superadmin  -> lo que todavía existe sólo para quien desarrolla
//
//  ── Se aplica sólo al catálogo y a los pedidos, y no retroactivamente ──
//
//  No se le pone a TiendaNube ni a ningún módulo existente. Hoy
//  `enabled_modules` no tiene **ninguna** semántica probada del lado del
//  servidor: encenderla de golpe para once endpoints de una integración que está
//  en producción, y encima dentro de una funcionalidad que no es de ella, es
//  cambiarle el comportamiento a un cliente por un efecto colateral. Queda
//  anotado como deuda.
// ════════════════════════════════════════════

/**
 * @param {string} modulo El nombre tal como aparece en `settings.enabled_modules`.
 */
function requireModulo(modulo) {
  return function gate(req, res, next) {
    const settings = req.empresaSettings || {};

    // ── (c) La excepción del dueño ──
    //
    // Va PRIMERO, igual que en `RouteGuard` (`App.jsx:59`). Los dos lados tienen
    // que decir lo mismo: si el navegador deja entrar al dueño y la API le
    // contesta 404 a todo, el resultado es una pantalla rota llena de errores,
    // que es exactamente el modo de falla que el gate existe para evitar.
    if (settings.owner_auth0_sub && settings.owner_auth0_sub === req.userId) {
      return next();
    }

    // ── (a) Sin lista declarada, pasa ──
    //
    // `enabled_modules` ausente —o guardado como algo que no es un arreglo—
    // significa «esta empresa tiene todo», que es el estado de **todas** las
    // empresas de hoy: ninguna lo tiene puesto. Cerrar por ausencia apagaría el
    // sistema entero en el primer deploy.
    //
    // Es una decisión incómoda y por eso está escrita: el default de un gate
    // debería ser cerrar. Acá abre, porque el dato todavía no existe en ninguna
    // fila y un gate que apaga a todos los clientes no es un gate, es una caída.
    const habilitados = settings.enabled_modules;
    if (!Array.isArray(habilitados)) return next();

    if (habilitados.includes(modulo)) return next();

    // ── (b) 404 y no 403 ──
    //
    // Mismo motivo escrito en `requireSuperadmin.js`: un 403 confirma que el
    // módulo está ahí y sólo oculto, que es justo lo que no hay que contarle a
    // alguien probando rutas.
    logger.warn(
      { requestId: req.id, usuario: req.userId, empresa: req.empresaId, modulo, ruta: req.originalUrl },
      'Acceso a un modulo que la empresa no tiene habilitado'
    );

    return res.status(404).json({ ok: false, error: 'No encontrado' });
  };
}

module.exports = requireModulo;
