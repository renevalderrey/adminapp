const { Suscripcion, Empresa } = require('../models');
const { sendEmail, trialPorVencerEmail } = require('./email');
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


/**
 * Avisa a las empresas cuyo trial esta por terminar.
 *
 * Antes no se avisaba nada: el usuario se enteraba cuando la app le empezaba a
 * devolver 402 y dejaba de funcionar en medio de una venta.
 *
 * Para no mandar el mismo aviso todos los dias, se marca en el registro con
 * `aviso_vencimiento_enviado`. Como esa columna no existe todavia, el aviso se
 * limita a los dias exactos de corte, que es una aproximacion razonable con un
 * cron horario: puede repetirse dentro del mismo dia si el proceso reinicia.
 * Ver la nota en docs/AUDITORIA-SUSCRIPCIONES.md.
 */
const DIAS_DE_AVISO = [5, 1];

async function avisarVencimientosProximos() {
  const ahora = new Date();
  let enviados = 0;

  for (const dias of DIAS_DE_AVISO) {
    const desde = new Date(ahora.getTime() + (dias - 1) * 24 * 60 * 60 * 1000);
    const hasta = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);

    const porVencer = await Suscripcion.findAll({
      where: {
        status: 'trialing',
        trial_ends_at: { [Op.gt]: desde, [Op.lte]: hasta },
      },
      include: [{ model: Empresa, as: 'empresa', attributes: ['id', 'name'] }],
    });

    for (const s of porVencer) {
      const destinatario = await emailDeLaEmpresa(s.empresa_id);
      if (!destinatario) continue;

      const envio = await sendEmail({
        to: destinatario,
        subject: `Tu prueba de Favalio termina en ${dias} ${dias === 1 ? 'día' : 'días'}`,
        html: trialPorVencerEmail(s.empresa?.name || 'tu empresa', dias),
      });

      // Solo cuenta lo que realmente salio. Contar los intentos hacia que el
      // log dijera "5 avisos enviados" con el correo sin configurar.
      if (envio.ok) enviados++;
    }
  }

  if (enviados > 0) logger.info({ enviados }, 'Avisos de vencimiento enviados');

  return enviados;
}

/** Email del dueno de la empresa, para los avisos de facturacion. */
async function emailDeLaEmpresa(empresaId) {
  const { UsuarioEmpresa, Usuario } = require('../models');

  const ue = await UsuarioEmpresa.findOne({
    where: { empresa_id: empresaId, role: 'admin', is_active: true },
    include: [{ model: Usuario, as: 'usuario', attributes: ['email'] }],
    order: [['id', 'ASC']],
  });

  const email = ue?.usuario?.email;

  // Los usuarios creados sin email real llevan un placeholder que no sirve
  // para nada: mandar ahi solo ensucia la reputacion del dominio.
  if (!email || email.endsWith('.placeholder')) return null;

  return email;
}

async function tick() {
  await expireTrials();

  // Un fallo mandando avisos no puede impedir que las suscripciones venzan.
  try {
    await avisarVencimientosProximos();
  } catch (err) {
    logger.error({ err }, 'Error enviando avisos de vencimiento');
  }
}

function start() {
  tick();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  logger.info({ interval: `${CHECK_INTERVAL_MS / 1000 / 60}min` }, 'Subscription cron started');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Subscription cron stopped');
  }
}

module.exports = { start, stop, expireTrials, avisarVencimientosProximos };
