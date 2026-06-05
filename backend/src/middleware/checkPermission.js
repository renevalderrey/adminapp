const logger = require('../utils/logger');

function checkPermission(codigo) {
  return (req, res, next) => {
    if (process.env.BYPASS_AUTH === 'true') {
      return next();
    }

    if (!req.usuarioPermisos || !req.usuarioPermisos.includes(codigo)) {
      logger.warn({
        userId: req.userId,
        permission: codigo,
        userPermissions: req.usuarioPermisos,
        path: req.originalUrl,
      }, `Permission denied: ${codigo}`);

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `No tienes permiso para realizar esta acción (${codigo})`,
      });
    }

    next();
  };
}

module.exports = checkPermission;
