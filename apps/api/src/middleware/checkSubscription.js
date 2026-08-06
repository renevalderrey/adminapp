const { Suscripcion } = require('../models');
const logger = require('../utils/logger');

// ── Lo que no pasa por el paywall ──
//
// TiendaNube estaba con el prefijo entero y eso eximia tambien a las once
// rutas privadas de la integracion: una empresa con la suscripcion vencida
// seguia mapeando productos y sincronizando su stock con la tienda online.
// Es la misma forma del paywall eludible que CONVENCIONES.md cita entre los
// tres errores mas caros del proyecto — la puerta no estaba abierta, estaba en
// otra pared. Ahora se nombran los dos caminos exactos.
//
// isExempt compara con startsWith sobre req.originalUrl, asi que el callback
// que vuelve con ?code=…&state=… sigue entrando.
//
// ⚠ Esas dos lineas de TiendaNube son defensivas y NINGUN test las ejercita, a
// proposito. /callback y /webhook viven en el router `publico`, que server.js
// monta SIN la cadena authEmpresa —o sea, sin este middleware—, y Express
// atiende con el primer montaje que matchee: no llegan hasta aca nunca. Un
// test que afirmara «el webhook funciona con la suscripcion vencida» pasaria
// igual con esta lista vacia, no probaria nada, y seria uno mas de los veinte
// que este repositorio ya junto. Lo que si esta probado es lo contrario —que
// las once privadas queden cortadas— en tests/paywallDeTiendanube.test.js,
// junto con la guardia que fija que el montaje del router publico siga sin
// authEmpresa, que es de donde sale de verdad la exencion.
//
// Se dejan igual porque no cuestan nada y porque el dia que ese montaje se
// mueva, un 402 repetido hace que TiendaNube deshabilite el webhook del lado
// de ellos y la integracion se apague sola.
const EXEMPT_PREFIXES = [
  '/api/empresas',
  '/api/auth',
  '/api/ping',
  '/api/tiendanube/callback',
  '/api/tiendanube/webhook',
];

function isExempt(path) {
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function checkSubscription(req, res, next) {
  if (isExempt(req.originalUrl)) {
    return next();
  }

  if (!req.empresaId) {
    return next();
  }

  try {
    const sub = await Suscripcion.findOne({
      where: { empresa_id: req.empresaId },
      attributes: ['id', 'status', 'trial_ends_at', 'grace_period_ends'],
    });

    // Una empresa sin fila de suscripcion daba acceso ilimitado y gratis.
    // No es un estado transitorio: es un agujero permanente. Toda empresa se
    // crea con suscripcion en el onboarding, asi que si falta es un dato
    // inconsistente y hay que bloquear, no dejar pasar.
    if (!sub) {
      logger.error(
        { empresaId: req.empresaId },
        'Empresa sin fila de suscripcion: se bloquea el acceso'
      );
      return res.status(402).json({
        ok: false,
        error: 'SIN_SUSCRIPCION',
        message: 'No encontramos la suscripción de tu empresa. Escribinos para regularizarla.',
      });
    }

    const now = new Date();
    const graciaVencida = !sub.grace_period_ends || sub.grace_period_ends < now;

    // Antes solo se contemplaban 'expired' y 'trialing'. Los otros dos estados
    // del enum pasaban de largo:
    //   - 'cancelled' no bloqueaba nada, asi que cancelar dejaba el acceso
    //     abierto para siempre.
    //   - 'past_due' tampoco, con lo cual una suscripcion impaga seguia
    //     funcionando hasta que el cron la pasara a 'expired'.
    let bloqueado = false;
    let motivo = null;

    switch (sub.status) {
      case 'expired':
        bloqueado = true;
        motivo = 'Tu suscripción venció.';
        break;

      case 'trialing':
        // Durante el trial y su periodo de gracia el acceso sigue abierto.
        bloqueado = sub.trial_ends_at && sub.trial_ends_at < now && graciaVencida;
        motivo = 'Terminó tu período de prueba.';
        break;

      case 'past_due':
      case 'cancelled':
        // Se respeta el periodo ya pagado y despues se corta.
        bloqueado = graciaVencida;
        motivo = sub.status === 'cancelled'
          ? 'Tu suscripción fue cancelada.'
          : 'Tu suscripción tiene un pago pendiente.';
        break;

      case 'active':
        bloqueado = false;
        break;

      default:
        // Un estado desconocido es un error de datos: se bloquea y se registra.
        logger.error({ empresaId: req.empresaId, status: sub.status }, 'Estado de suscripcion desconocido');
        bloqueado = true;
        motivo = 'No pudimos verificar el estado de tu suscripción.';
    }

    if (bloqueado) {
      return res.status(402).json({
        ok: false,
        error: 'SUBSCRIPTION_EXPIRED',
        message: `${motivo} Tus datos siguen guardados. Escribinos para reactivar la cuenta.`,
        status_suscripcion: sub.status,
      });
    }

    next();
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'Error checking subscription');
    next();
  }
}

module.exports = checkSubscription;
