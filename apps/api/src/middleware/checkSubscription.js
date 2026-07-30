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

    if (!sub) {
      return next();
    }

    const now = new Date();
    const isExpired =
      sub.status === 'expired' ||
      (sub.status === 'trialing' && sub.grace_period_ends && sub.grace_period_ends < now);

    if (isExpired) {
      return res.status(402).json({
        ok: false,
        error: 'Suscripción vencida. Por favor, renueve su plan para continuar usando el sistema.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    next();
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'Error checking subscription');
    next();
  }
}

module.exports = checkSubscription;
