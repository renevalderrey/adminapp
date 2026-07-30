const logger = require('../utils/logger');

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
        message: `No tienes permiso para realizar esta acción (${codigo})`,
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
      message: `No tienes permiso para realizar esta acción (${codigo})`,
    });
  };
}

module.exports = checkPermission;
