// ════════════════════════════════════════════
//  Vencimiento de suscripciones
//
//  Es lo unico que separa un trial de un cliente que paga. Si no vence, el
//  producto se regala; si vence antes de tiempo, se le corta el acceso a
//  alguien que esta al dia.
// ════════════════════════════════════════════

const { Op } = require('sequelize');

// El cron usa Suscripcion.update con un where que incluye Op.lt y Op.or. El
// doble evalua esos operadores para poder afirmar sobre a quien alcanza.
const mockSuscripcion = {
  filas: [],
  actualizaciones: [],

  async update(cambios, opciones = {}) {
    const alcanzadas = mockSuscripcion.filas.filter((f) => cumple(f, opciones.where));

    for (const f of alcanzadas) Object.assign(f, cambios);
    mockSuscripcion.actualizaciones.push({ cambios, alcanzadas: alcanzadas.length });

    return [alcanzadas.length];
  },
};

/** Evalua un where de Sequelize con Op.lt, Op.or e igualdades. */
function cumple(fila, where = {}) {
  for (const clave of Reflect.ownKeys(where)) {
    const valor = where[clave];

    if (clave === Op.or) {
      if (!valor.some((sub) => cumple(fila, sub))) return false;
      continue;
    }

    const actual = fila[clave];

    if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
      // Comparar NULL con cualquier cosa da NULL en SQL: la fila no entra.
      if (actual === null || actual === undefined) return false;
      if (Op.lt in valor && !(actual < valor[Op.lt])) return false;
      continue;
    }

    if (actual !== valor) return false;
  }

  return true;
}

jest.mock('../models', () => ({
  Suscripcion: mockSuscripcion,
  Empresa: {},
}));

const { expireTrials } = require('../services/subscriptionCron');

const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);
const HACE_UNA_SEMANA = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const MANANA = new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(() => {
  mockSuscripcion.filas = [];
  mockSuscripcion.actualizaciones = [];
});

describe('expireTrials', () => {
  it('vence un trial terminado con su periodo de gracia cumplido', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'trialing',
      trial_ends_at: HACE_UNA_SEMANA,
      grace_period_ends: AYER,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('expired');
  });

  // El bug que dejaba trials inmortales. grace_period_ends es opcional, y en
  // SQL comparar NULL con una fecha devuelve NULL, que no matchea en el WHERE.
  // Como la version anterior exigia esa comparacion, toda suscripcion sin
  // periodo de gracia se quedaba en trialing para siempre. La que crea
  // setup.js era una de esas.
  it('vence un trial terminado aunque no tenga periodo de gracia', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'trialing',
      trial_ends_at: HACE_UNA_SEMANA,
      grace_period_ends: null,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('expired');
  });

  it('no vence un trial que todavia esta corriendo', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'trialing',
      trial_ends_at: MANANA,
      grace_period_ends: null,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('trialing');
  });

  // Cortarle el acceso a alguien que todavia esta en su periodo de gracia es
  // peor que dejarlo un dia de mas.
  it('respeta el periodo de gracia todavia vigente', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'trialing',
      trial_ends_at: AYER,
      grace_period_ends: MANANA,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('trialing');
  });

  it('vence una suscripcion impaga con la gracia cumplida', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'past_due',
      trial_ends_at: HACE_UNA_SEMANA,
      grace_period_ends: AYER,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('expired');
  });

  it('no toca una suscripcion activa', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'active',
      trial_ends_at: HACE_UNA_SEMANA,
      grace_period_ends: AYER,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('active');
  });

  it('no toca una suscripcion ya cancelada', async () => {
    mockSuscripcion.filas = [{
      id: 1, status: 'cancelled',
      trial_ends_at: HACE_UNA_SEMANA,
      grace_period_ends: AYER,
    }];

    await expireTrials();

    expect(mockSuscripcion.filas[0].status).toBe('cancelled');
  });

  it('devuelve la cuenta de lo que vencio', async () => {
    mockSuscripcion.filas = [
      { id: 1, status: 'trialing', trial_ends_at: AYER, grace_period_ends: null },
      { id: 2, status: 'trialing', trial_ends_at: AYER, grace_period_ends: AYER },
      { id: 3, status: 'trialing', trial_ends_at: MANANA, grace_period_ends: null },
    ];

    const r = await expireTrials();

    expect(r.expiredTrials).toBe(2);
  });
});
