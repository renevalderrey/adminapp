const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  Modulos que todavia no se liberaron a los clientes
//
//  Hay funcionalidades terminadas y probadas que no forman parte de lo que ve
//  un cliente todavia: clientes con cuenta corriente, recetas, produccion,
//  caja, impuestos y reportes. La decision de liberarlas es comercial, no
//  tecnica.
//
//  Este middleware es el tercero de los tres gates, y el mas restrictivo:
//
//    permission  -> que puede hacer el usuario dentro de su empresa
//    modulo      -> que modulos tiene contratados la empresa
//    superadmin  -> que existe todavia solo para quien desarrolla
//
//  Va en la API y no solo en el menu del frontend. Ocultar un item de la barra
//  lateral es cosmetica: la ruta sigue existiendo y cualquiera que abra las
//  herramientas del navegador la encuentra.
// ════════════════════════════════════════════

function requireSuperadmin(req, res, next) {
  if (req.usuario?.es_superadmin) return next();

  // 404 y no 403: un 403 confirma que el modulo existe y esta oculto, que es
  // justo lo que no queremos contarle a un cliente que anda probando rutas.
  logger.warn(
    { requestId: req.id, usuario: req.userId, ruta: req.originalUrl },
    'Acceso a un modulo no liberado'
  );

  return res.status(404).json({ ok: false, error: 'No encontrado' });
}

module.exports = requireSuperadmin;
