const { Suscripcion, Empresa } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let timer = null;

async function expireTrials() {
  try {
    const now = new Date();

    // El periodo de gracia es opcional: grace_period_ends puede ser NULL.
    //
    // La version anterior exigia `grace_period_ends < now` sin contemplarlo, y
    // en SQL comparar NULL con cualquier cosa devuelve NULL, que no matchea en
    // un WHERE. Resultado: toda suscripcion sin periodo de gracia quedaba en
    // estado trialing PARA SIEMPRE. La que crea setup.js es una de esas.
    //
    // Ahora: si hay periodo de gracia, se respeta; si no, alcanza con que haya
    // terminado el trial.
    const [expiredTrials] = await Suscripcion.update(
      { status: 'expired' },
      {
        where: {
          status: 'trialing',
          trial_ends_at: { [Op.lt]: now },
          [Op.or]: [
            { grace_period_ends: { [Op.lt]: now } },
            { grace_period_ends: null },
          ],
        },
      }
    );

    if (expiredTrials > 0) {
      logger.info({ count: expiredTrials }, 'Trials expired');
    }

    // Mismo criterio para las que quedaron impagas: sin periodo de gracia
    // definido, vencen de inmediato.
    const [pastDueCancelled] = await Suscripcion.update(
      { status: 'expired' },
      {
        where: {
          status: 'past_due',
          [Op.or]: [
            { grace_period_ends: { [Op.lt]: now } },
            { grace_period_ends: null },
          ],
        },
      }
    );

    if (pastDueCancelled > 0) {
      logger.info({ count: pastDueCancelled }, 'Past-due subscriptions expired');
    }

    return { expiredTrials, pastDueCancelled };
  } catch (err) {
    logger.error({ err }, 'Subscription cron error');
  }
}

function start() {
  expireTrials();
  timer = setInterval(expireTrials, CHECK_INTERVAL_MS);
  logger.info({ interval: `${CHECK_INTERVAL_MS / 1000 / 60}min` }, 'Subscription cron started');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Subscription cron stopped');
  }
}

module.exports = { start, stop, expireTrials };
