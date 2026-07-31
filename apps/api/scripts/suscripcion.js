#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  Administrar suscripciones desde la línea de comandos
 *
 *  Hoy no hay ninguna forma de activar un plan: el modelo Suscripcion tiene
 *  todos los campos, el cron maneja los vencimientos y la app muestra el
 *  estado, pero la única ruta que existe es un GET. No hay endpoint ni panel
 *  para marcar una suscripción como paga.
 *
 *  Esto no es una pasarela de pago. Es el mínimo para poder cobrarle al primer
 *  cliente por transferencia bancaria y activarlo a mano, sin tener que editar
 *  la base con SQL suelto.
 *
 *  Se hace como script y no como endpoint a propósito: activar una suscripción
 *  es una operación del dueño del SaaS, no de un usuario de una empresa. El
 *  modelo de roles es por empresa y no tiene un concepto de operador de la
 *  plataforma, así que un endpoint necesitaría inventar un mecanismo de
 *  autenticación nuevo. Un script que corre con las credenciales de la base
 *  evita esa superficie.
 *
 *  ── Uso ──
 *
 *    node scripts/suscripcion.js listar
 *    node scripts/suscripcion.js ver <empresaId>
 *    node scripts/suscripcion.js activar <empresaId> --plan pro --meses 1
 *    node scripts/suscripcion.js extender <empresaId> --dias 15
 *    node scripts/suscripcion.js cancelar <empresaId>
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const { sequelize, Suscripcion, Empresa } = require('../src/models');

const PLANES_CONOCIDOS = ['free', 'pro', 'enterprise'];

function parsearArgs(argv) {
  const posicionales = [];
  const opciones = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      opciones[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      posicionales.push(a);
    }
  }

  return { posicionales, opciones };
}

function fecha(d) {
  return d ? new Date(d).toISOString().split('T')[0] : '—';
}

async function listar() {
  const suscripciones = await Suscripcion.findAll({
    include: [{ model: Empresa, as: 'empresa', attributes: ['id', 'name', 'cuit'] }],
    order: [['empresa_id', 'ASC']],
  });

  if (!suscripciones.length) {
    console.log('No hay suscripciones cargadas.');
    return;
  }

  console.log('');
  console.log('ID   EMPRESA                        PLAN        ESTADO      VENCE');
  console.log('─'.repeat(78));

  for (const s of suscripciones) {
    const nombre = (s.empresa?.name || '(sin empresa)').slice(0, 28).padEnd(28);
    const vence = s.status === 'trialing' ? fecha(s.trial_ends_at) : fecha(s.grace_period_ends);

    console.log(
      String(s.empresa_id).padEnd(4) +
      nombre + '   ' +
      String(s.plan || '—').padEnd(11) +
      String(s.status).padEnd(11) +
      vence
    );
  }

  console.log('');
}

async function ver(empresaId) {
  const s = await Suscripcion.findOne({
    where: { empresa_id: empresaId },
    include: [{ model: Empresa, as: 'empresa', attributes: ['id', 'name', 'cuit'] }],
  });

  if (!s) {
    console.error(`No hay suscripción para la empresa ${empresaId}.`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Empresa:          ', s.empresa?.name, `(id ${s.empresa_id})`);
  console.log('CUIT:             ', s.empresa?.cuit || '—');
  console.log('Plan:             ', s.plan);
  console.log('Estado:           ', s.status);
  console.log('Trial:            ', fecha(s.trial_starts_at), '→', fecha(s.trial_ends_at));
  console.log('Fin de gracia:    ', fecha(s.grace_period_ends));
  console.log('');
}

/**
 * Marca una suscripción como paga por N meses.
 *
 * El período pagado se representa con grace_period_ends: es la fecha hasta la
 * que el acceso está garantizado, y el cron la usa para vencerla después.
 */
async function activar(empresaId, { plan = 'pro', meses = '1' }) {
  const cantidadMeses = parseInt(meses, 10);

  if (!Number.isInteger(cantidadMeses) || cantidadMeses < 1) {
    console.error('--meses tiene que ser un entero mayor o igual a 1.');
    process.exitCode = 1;
    return;
  }

  if (!PLANES_CONOCIDOS.includes(plan)) {
    console.error(`Plan desconocido "${plan}". Conocidos: ${PLANES_CONOCIDOS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const s = await Suscripcion.findOne({ where: { empresa_id: empresaId } });

  if (!s) {
    console.error(`No hay suscripción para la empresa ${empresaId}.`);
    process.exitCode = 1;
    return;
  }

  // Si todavía le queda período pagado, se suma; si no, se cuenta desde hoy.
  // Sin esto, renovar antes de tiempo le regalaría días al cliente o se los
  // comería, según cómo se mire.
  const ahora = new Date();
  const desde = s.grace_period_ends && new Date(s.grace_period_ends) > ahora
    ? new Date(s.grace_period_ends)
    : ahora;

  const hasta = new Date(desde);
  hasta.setMonth(hasta.getMonth() + cantidadMeses);

  await s.update({
    plan,
    status: 'active',
    grace_period_ends: hasta,
  });

  console.log('');
  console.log(`Empresa ${empresaId}: plan ${plan}, activa hasta ${fecha(hasta)}.`);
  if (desde > ahora) {
    console.log(`(Tenía período pagado hasta ${fecha(desde)}; los ${cantidadMeses} mes(es) se sumaron a partir de ahí.)`);
  }
  console.log('');
}

async function extender(empresaId, { dias = '15' }) {
  const cantidadDias = parseInt(dias, 10);

  if (!Number.isInteger(cantidadDias) || cantidadDias < 1) {
    console.error('--dias tiene que ser un entero mayor o igual a 1.');
    process.exitCode = 1;
    return;
  }

  const s = await Suscripcion.findOne({ where: { empresa_id: empresaId } });

  if (!s) {
    console.error(`No hay suscripción para la empresa ${empresaId}.`);
    process.exitCode = 1;
    return;
  }

  const ahora = new Date();
  const base = s.trial_ends_at && new Date(s.trial_ends_at) > ahora
    ? new Date(s.trial_ends_at)
    : ahora;

  const nuevoFin = new Date(base);
  nuevoFin.setDate(nuevoFin.getDate() + cantidadDias);

  const nuevaGracia = new Date(nuevoFin);
  nuevaGracia.setDate(nuevaGracia.getDate() + 3);

  await s.update({
    status: 'trialing',
    trial_ends_at: nuevoFin,
    grace_period_ends: nuevaGracia,
  });

  console.log('');
  console.log(`Empresa ${empresaId}: trial extendido hasta ${fecha(nuevoFin)} (gracia hasta ${fecha(nuevaGracia)}).`);
  console.log('');
}

async function cancelar(empresaId) {
  const s = await Suscripcion.findOne({ where: { empresa_id: empresaId } });

  if (!s) {
    console.error(`No hay suscripción para la empresa ${empresaId}.`);
    process.exitCode = 1;
    return;
  }

  await s.update({ status: 'cancelled', cancel_at_period_end: true });

  console.log('');
  console.log(`Empresa ${empresaId}: suscripción cancelada.`);
  console.log(`El acceso se mantiene hasta ${fecha(s.grace_period_ends)} y después el cron la vence.`);
  console.log('');
}

const AYUDA = `
Administrar suscripciones de AdminApp.

  node scripts/suscripcion.js listar
      Lista todas las empresas con su plan, estado y vencimiento.

  node scripts/suscripcion.js ver <empresaId>
      Detalle de una suscripción.

  node scripts/suscripcion.js activar <empresaId> [--plan pro] [--meses 1]
      Marca la suscripción como paga. Si todavía tiene período pagado, los
      meses se suman a partir de esa fecha.

  node scripts/suscripcion.js extender <empresaId> [--dias 15]
      Extiende el trial. Útil para dar más tiempo durante una negociación.

  node scripts/suscripcion.js cancelar <empresaId>
      Cancela. El acceso sigue hasta el fin del período ya pagado.
`;

async function main() {
  const { posicionales, opciones } = parsearArgs(process.argv.slice(2));
  const [comando, empresaId] = posicionales;

  const necesitaEmpresa = ['ver', 'activar', 'extender', 'cancelar'];

  if (necesitaEmpresa.includes(comando) && !empresaId) {
    console.error(`El comando "${comando}" necesita el id de la empresa.`);
    console.log(AYUDA);
    process.exitCode = 1;
    return;
  }

  switch (comando) {
    case 'listar':   await listar(); break;
    case 'ver':      await ver(empresaId); break;
    case 'activar':  await activar(empresaId, opciones); break;
    case 'extender': await extender(empresaId, opciones); break;
    case 'cancelar': await cancelar(empresaId); break;
    default:
      console.log(AYUDA);
      if (comando) process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
