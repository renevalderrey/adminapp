// ════════════════════════════════════════════
//  El aviso de vencimiento no se repite
//
//  La ventana de aviso se calcula contra `ahora`, asi que un trial que vence
//  en T entra en ella mientras `ahora` va de `T - dias` a `T - (dias - 1)`:
//  veinticuatro horas seguidas. `tick()` corre CADA HORA, asi que sin un
//  registro de lo ya enviado el mismo cliente recibia el mismo correo hasta
//  veinticuatro veces.
//
//  Todo este archivo prueba eso: que el segundo tick del mismo dia no mande
//  nada, y que el aviso de «un dia» salga igual despues del de «cinco».
// ════════════════════════════════════════════

const { Op } = require('sequelize');

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Las filas que el doble devuelve, con `update` que escribe en la fila. */
const mockSuscripcion = {
  filas: [],

  async findAll(opciones = {}) {
    return mockSuscripcion.filas
      .filter((f) => cumple(f, opciones.where))
      .map((f) => ({
        ...f,
        empresa: { id: f.empresa_id, name: 'Comprafit' },
        async update(cambios) { Object.assign(f, cambios); },
      }));
  },
};

/** Evalua el where del cron: igualdades, Op.gt, Op.lte y Op.or. */
function cumple(fila, where = {}) {
  for (const clave of Reflect.ownKeys(where)) {
    const valor = where[clave];

    if (clave === Op.or) {
      if (!valor.some((sub) => cumple(fila, sub))) return false;
      continue;
    }

    const actual = fila[clave];

    if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
      // Comparar NULL con cualquier cosa da NULL en SQL: la fila NO entra.
      // Es justo lo que hace falta la rama explicita del Op.or.
      if (actual === null || actual === undefined) return false;
      if (Op.gt in valor && !(actual > valor[Op.gt])) return false;
      if (Op.lte in valor && !(actual <= valor[Op.lte])) return false;
      continue;
    }

    if (actual !== valor) return false;
  }

  return true;
}

const mockUsuarioEmpresa = {
  async findOne() {
    return { usuario: { email: 'duenio@comprafit.com' } };
  },
};

jest.mock('../models', () => ({
  Suscripcion: mockSuscripcion,
  Empresa: {},
  UsuarioEmpresa: mockUsuarioEmpresa,
  Usuario: {},
}));

const mockEnviados = [];
let mockEnvioSale = true;

jest.mock('../services/email', () => ({
  sendEmail: jest.fn(async (m) => {
    mockEnviados.push(m);
    return { ok: mockEnvioSale };
  }),
  trialPorVencerEmail: () => '<p>tu prueba termina</p>',
}));

const { avisarVencimientosProximos } = require('../services/subscriptionCron');

/** Un trial que vence dentro de `dias` dias y algunas horas. */
function trialQueVenceEn(dias, { aviso = null, id = 1 } = {}) {
  return {
    id,
    empresa_id: id,
    status: 'trialing',
    // Media ventana adentro: no en el borde, para que el test no dependa de
    // como se redondea el limite.
    trial_ends_at: new Date(Date.now() + dias * DIA - 12 * HORA),
    aviso_vencimiento_enviado: aviso,
  };
}

beforeEach(() => {
  mockSuscripcion.filas = [];
  mockEnviados.length = 0;
  mockEnvioSale = true;
});

describe('avisarVencimientosProximos no repite el correo', () => {
  it('NO manda el mismo aviso dos veces aunque el tick corra de nuevo', async () => {
    // El defecto: el tick es horario y la ventana dura un dia entero. Sin la
    // marca, esto mandaba un correo por hora — hasta veinticuatro.
    mockSuscripcion.filas = [trialQueVenceEn(5)];

    expect(await avisarVencimientosProximos()).toBe(1);
    expect(await avisarVencimientosProximos()).toBe(0);
    expect(await avisarVencimientosProximos()).toBe(0);

    expect(mockEnviados).toHaveLength(1);
  });

  it('deja la marca en el aviso que salio, y no en otro', async () => {
    mockSuscripcion.filas = [trialQueVenceEn(5)];

    await avisarVencimientosProximos();

    expect(mockSuscripcion.filas[0].aviso_vencimiento_enviado).toBe(5);
  });

  it('el aviso de UN dia sale igual despues del de cinco', async () => {
    // Es lo que un booleano no podria expresar: «ya se aviso» tiene que
    // bloquear la repeticion del mismo aviso sin bloquear el siguiente.
    mockSuscripcion.filas = [trialQueVenceEn(1, { aviso: 5 })];

    expect(await avisarVencimientosProximos()).toBe(1);
    expect(mockSuscripcion.filas[0].aviso_vencimiento_enviado).toBe(1);
    expect(mockEnviados[0].subject).toContain('1 día');
  });

  it('una suscripcion que nunca recibio aviso SI entra, aunque la columna sea NULL', async () => {
    // En SQL `NULL > 5` no es verdadero. Sin la rama explicita del Op.or, el
    // filtro dejaria afuera exactamente a las que nunca recibieron nada — o
    // sea a todas las de hoy, y el aviso no saldria nunca.
    mockSuscripcion.filas = [trialQueVenceEn(5, { aviso: null })];

    expect(await avisarVencimientosProximos()).toBe(1);
  });

  it('un envio que FALLA no deja marca: el reintento tiene que seguir vivo', async () => {
    // Marcar lo que no salio apagaria el aviso en silencio. Es el molde del
    // defecto que este repositorio ya pago: `sendEmail` devolvia ok sin mandar
    // nada y las invitaciones se perdian.
    mockSuscripcion.filas = [trialQueVenceEn(5)];
    mockEnvioSale = false;

    expect(await avisarVencimientosProximos()).toBe(0);
    expect(mockSuscripcion.filas[0].aviso_vencimiento_enviado).toBeNull();

    mockEnvioSale = true;
    expect(await avisarVencimientosProximos()).toBe(1);
  });

  it('un trial fuera de toda ventana no recibe nada', async () => {
    // Las cuatro suscripciones reales vencen a once dias vista: hoy no les
    // corresponde ningun aviso, y es lo que hizo que la primera corrida del
    // cron pudiera dispararse sin mandarle nada a nadie.
    mockSuscripcion.filas = [trialQueVenceEn(11)];

    expect(await avisarVencimientosProximos()).toBe(0);
    expect(mockEnviados).toHaveLength(0);
  });
});
