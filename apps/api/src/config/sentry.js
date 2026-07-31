const Sentry = require('@sentry/node');
const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  Aviso de errores
//
//  Los logs estructurados dicen que paso, pero solo si alguien los mira. La
//  auditoria de operabilidad lo dejo escrito: "hoy nadie se entera de nada
//  salvo que mire el panel". Entre que una venta empieza a fallar y que el
//  cliente llame pueden pasar dias.
//
//  Esto cierra esa brecha: cada 500 y cada caida del proceso llegan por mail
//  al toque.
//
//  Es OPCIONAL. Sin SENTRY_DSN configurado no se inicializa nada y el resto
//  del sistema funciona igual — no queremos que la aplicacion dependa de un
//  servicio externo para arrancar.
//
//  Para activarlo: crear un proyecto Node en sentry.io (el plan gratuito
//  alcanza de sobra para un solo cliente) y poner el DSN en SENTRY_DSN.
// ════════════════════════════════════════════

let activo = false;

function iniciarSentry() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    logger.info('SENTRY_DSN no configurado: los errores solo quedan en el log.');
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',

    // La version del codigo que produjo el error. Sin esto, un error que se
    // corrigio hace tres deploys sigue apareciendo igual que uno nuevo.
    release: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || undefined,

    // Sin trazas de performance: lo que hace falta es enterarse de los
    // errores, y el muestreo de transacciones consume la cuota gratuita
    // rapido sin aportar nada a eso.
    tracesSampleRate: 0,

    // Que no salga del proceso mas de lo necesario.
    sendDefaultPii: false,

    // Ultimo filtro antes de enviar.
    //
    // El log ya tiene una lista de redaccion; esta es la de este canal, que
    // sale a un tercero. Un certificado de AFIP o un token de TiendaNube en un
    // panel de terceros es una fuga igual que en cualquier otro lado.
    beforeSend(evento) {
      const prohibidas = /afip_key|afip_cert|access_token|password|authorization|private_key/i;

      const limpiar = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;

        for (const clave of Object.keys(obj)) {
          if (prohibidas.test(clave)) obj[clave] = '[REDACTADO]';
          else if (typeof obj[clave] === 'object') limpiar(obj[clave]);
        }

        return obj;
      };

      if (evento.request) limpiar(evento.request);
      if (evento.extra) limpiar(evento.extra);
      if (evento.contexts) limpiar(evento.contexts);

      return evento;
    },
  });

  activo = true;
  logger.info({ entorno: process.env.NODE_ENV }, 'Sentry activo');

  return true;
}

/**
 * Reporta un error, si Sentry esta configurado.
 *
 * El requestId va como etiqueta para poder cruzar el evento de Sentry con las
 * lineas del log de ese mismo request.
 *
 * @param {Error} err
 * @param {object} [contexto] requestId, ruta, metodo, empresaId, usuario.
 */
function reportarError(err, contexto = {}) {
  if (!activo) return;

  Sentry.withScope((scope) => {
    if (contexto.requestId) scope.setTag('requestId', contexto.requestId);
    if (contexto.empresaId) scope.setTag('empresaId', String(contexto.empresaId));
    if (contexto.ruta) scope.setTag('ruta', contexto.ruta);
    if (contexto.usuario) scope.setUser({ id: contexto.usuario });

    scope.setContext('request', {
      ruta: contexto.ruta,
      metodo: contexto.metodo,
    });

    Sentry.captureException(err);
  });
}

/**
 * Espera a que salgan los eventos pendientes.
 *
 * Hace falta en el cierre ordenado: si el proceso se muere con eventos en la
 * cola, el error que causo la caida —justo el que mas importa— nunca se
 * envia.
 */
async function vaciarSentry(msMaximo = 2000) {
  if (!activo) return;

  try {
    await Sentry.flush(msMaximo);
  } catch {
    // Que un fallo mandando el error no complique todavia mas el cierre.
  }
}

module.exports = { iniciarSentry, reportarError, vaciarSentry };
