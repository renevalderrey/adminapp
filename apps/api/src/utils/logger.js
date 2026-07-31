const pino = require('pino');

// ════════════════════════════════════════════
//  Logging
//
//  En produccion los logs van a STDOUT, no a un archivo.
//
//  La version anterior escribia a ./logs/app.log con pino/file. En Render, en
//  Railway y en cualquier PaaS eso significa dos cosas, las dos malas:
//
//   - La plataforma captura STDOUT. Un archivo no lo ve nadie: no aparece en
//     el panel, no se puede consultar, no se puede filtrar.
//   - El filesystem es efimero. Ese archivo se pierde en cada deploy y en cada
//     reinicio, justo cuando mas falta hace mirarlo.
//
//  El efecto neto era que en produccion NO habia logs: cada logger.error del
//  codigo escribia a un archivo que nadie iba a leer nunca.
// ════════════════════════════════════════════

const esProduccion = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (esProduccion ? 'info' : 'debug'),

  customLevels: { http: 10 },
  useOnlyCustomLevels: false,

  // En desarrollo, formato legible. En produccion, JSON a stdout: es lo que
  // las plataformas saben parsear e indexar.
  transport: esProduccion
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },

  // Timestamp ISO en vez del epoch en milisegundos que usa pino por defecto:
  // los agregadores de logs lo entienden sin configuracion extra.
  timestamp: pino.stdTimeFunctions.isoTime,

  base: {
    servicio: 'adminapp-api',
    entorno: process.env.NODE_ENV || 'development',
  },

  // Lo que nunca puede aparecer en un log.
  //
  // A la lista original se le sumaron las credenciales que maneja el sistema y
  // que, si se loguean, quedan expuestas en el panel de la plataforma: la clave
  // privada de AFIP, el certificado, y los tokens de TiendaNube.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.token',

      // AFIP: material fiscal sensible.
      'body.key',
      'body.cert',
      'afip_key',
      'afip_cert',
      '*.afip_key',
      '*.afip_cert',

      // TiendaNube.
      'body.access_token',
      'access_token',
      '*.access_token',
      'tiendanube_access_token',
    ],
    censor: '[REDACTADO]',
  },
});

module.exports = logger;
