const { Suscripcion, Empresa } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let timer = null;

async function expireTrials() {
  try {
    const now = new Date();

    const [expiredTrials] = await Suscripcion.update(
      { status: 'expired' },
      {
        where: {
          status: 'trialing',
          trial_ends_at: { [Op.lt]: now },
          grace_period_ends: { [Op.lt]: now },
        },
      }
    );

    if (expiredTrials > 0) {
      logger.info({ count: expiredTrials }, 'Trials expired');
    }

    const [pastDueCancelled] = await Suscripcion.update(
      { status: 'expired' },
      {
        where: {
          status: 'past_due',
          grace_period_ends: { [Op.lt]: now },
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
