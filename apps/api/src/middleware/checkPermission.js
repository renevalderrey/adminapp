const logger = require('../utils/logger');

/**
 * Lo que el usuario lee cuando le falta un permiso.
 *
 * ── Por que nombra el codigo del permiso ──
 *
 * Porque el usuario no puede pedir lo que no puede nombrar. «No tenes permiso
 * para esto» deja a alguien parado con un pedido de compra armado y sin nada
 * concreto que decirle a quien administra la empresa; «te falta el permiso
 * ordenes_compra.crear» se reenvia por mensaje y se resuelve en un minuto.
 *
 * ── Y por que tutea rioplatense ──
 *
 * Decia «No tienes permiso», que es la unica forma verbal en segunda persona de
 * toda la aplicacion que no es rioplatense. No es un detalle de gusto: en una
 * pantalla donde todo lo demas dice «Cargá», «Pegá» y «Revisá», la frase que
 * aparece cuando algo sale mal era la unica que sonaba de otro producto.
 *
 * ⚠ El campo `error` sigue siendo `FORBIDDEN`, y eso es a proposito: es el
 * codigo que el cliente puede comparar. Lo que NO puede pasar es que una
 * pantalla lo muestre crudo — para eso esta `mensajeDeError` de
 * `utils/erroresDeApi.js`, que distingue un codigo de maquina de un mensaje.
 */
function mensajeDeFalta(codigo) {
  return `Te falta el permiso «${codigo}». Pediselo a quien administra la empresa.`;
}

function checkPermission(codigo) {
  return (req, res, next) => {
    if (process.env.BYPASS_AUTH === 'true') {
      if (process.env.NODE_ENV === 'production') {
        logger.error('BYPASS_AUTH está activo en producción. Negando acceso por seguridad.');
        return res.status(500).json({ error: 'CONFIG_ERROR', message: 'Error de configuración del servidor' });
      }
      return next();
    }

    if (!req.usuarioPermisos || !Array.isArray(req.usuarioPermisos)) {
      logger.warn({
        userId: req.userId,
        permission: codigo,
        path: req.originalUrl,
      }, 'Permission denied: no permissions loaded');

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: mensajeDeFalta(codigo),
      });
    }

    const wildcard = codigo.split('.').slice(0, -1).join('.') + '.*';

    if (req.usuarioPermisos.includes(codigo) || req.usuarioPermisos.includes(wildcard)) {
      return next();
    }

    logger.warn({
      userId: req.userId,
      permission: codigo,
      wildcard,
      userPermissions: req.usuarioPermisos,
      path: req.originalUrl,
    }, `Permission denied: ${codigo}`);

    return res.status(403).json({
      error: 'FORBIDDEN',
      message: mensajeDeFalta(codigo),
    });
  };
}

module.exports = checkPermission;
module.exports.mensajeDeFalta = mensajeDeFalta;
