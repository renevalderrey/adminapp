const { Suscripcion } = require('../models');
const logger = require('../utils/logger');

const EXEMPT_PREFIXES = [
  '/api/empresas',
  '/api/auth',
  '/api/ping',
  '/api/tiendanube',
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
