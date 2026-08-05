// ════════════════════════════════════════════
//  Fechas en la zona horaria del negocio
//
//  El sistema guardaba las fechas en UTC. Argentina es UTC-3: despues de las
//  21:00 hora local, UTC ya esta en el dia siguiente, y las ventas de la noche
//  se asentaban al dia siguiente.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// `hoyDelNegocio` lee la empresa de la base. El modelo se requiere adentro de
// la función, así que alcanza con doblar `../models` antes de cargar el módulo.
const mockEmpresa = { findByPk: jest.fn() };
jest.mock('../models', () => ({ Empresa: mockEmpresa }));

const {
  fechaDelNegocio,
  horaDelNegocio,
  fechaParaAfip,
  hoyDelNegocio,
  ZONA_POR_DEFECTO,
} = require('../utils/fechas');

const AR = 'America/Argentina/Buenos_Aires';

describe('fechaDelNegocio', () => {
  it('a media tarde coincide con la fecha UTC', () => {
    // 31/07 15:00 UTC = 31/07 12:00 en Argentina.
    const momento = new Date('2026-07-31T15:00:00Z');

    expect(fechaDelNegocio(AR, momento)).toBe('2026-07-31');
  });

  // El caso que motiva todo. A las 21:30 de Argentina, en UTC ya es el dia
  // siguiente: la venta se asentaba el 1 de agosto.
  it('una venta de las 21:30 sigue siendo del mismo dia', () => {
    const momento = new Date('2026-08-01T00:30:00Z'); // 31/07 21:30 ART

    expect(fechaDelNegocio(AR, momento)).toBe('2026-07-31');
    // Lo que devolvia el codigo anterior:
    expect(momento.toISOString().split('T')[0]).toBe('2026-08-01');
  });

  it('a las 23:59 de Argentina todavia es el mismo dia', () => {
    const momento = new Date('2026-08-01T02:59:00Z'); // 31/07 23:59 ART

    expect(fechaDelNegocio(AR, momento)).toBe('2026-07-31');
  });

  it('pasada la medianoche local ya es el dia siguiente', () => {
    const momento = new Date('2026-08-01T03:01:00Z'); // 01/08 00:01 ART

    expect(fechaDelNegocio(AR, momento)).toBe('2026-08-01');
  });

  it('respeta otras zonas horarias', () => {
    const momento = new Date('2026-08-01T00:30:00Z');

    expect(fechaDelNegocio('UTC', momento)).toBe('2026-08-01');
    expect(fechaDelNegocio('America/Argentina/Buenos_Aires', momento)).toBe('2026-07-31');
  });

  // Una zona invalida en la configuracion de una empresa no puede tumbar una
  // venta: se cae al default en vez de lanzar.
  it('una zona invalida cae al default sin romper', () => {
    const momento = new Date('2026-08-01T00:30:00Z');

    expect(fechaDelNegocio('Zona/Inexistente', momento)).toBe('2026-07-31');
    expect(fechaDelNegocio(null, momento)).toBe('2026-07-31');
    expect(fechaDelNegocio(undefined, momento)).toBe('2026-07-31');
  });

  it('el default es Buenos Aires', () => {
    expect(ZONA_POR_DEFECTO).toBe(AR);
  });
});

describe('horaDelNegocio', () => {
  it('devuelve la hora local en formato 24h', () => {
    const momento = new Date('2026-08-01T00:30:00Z'); // 21:30 ART

    expect(horaDelNegocio(AR, momento)).toBe('21:30');
  });

  it('las horas de un digito llevan cero adelante', () => {
    const momento = new Date('2026-07-31T12:05:00Z'); // 09:05 ART

    expect(horaDelNegocio(AR, momento)).toBe('09:05');
  });
});

describe('fechaParaAfip', () => {
  it('devuelve YYYYMMDD, que es lo que espera el WSFE', () => {
    const momento = new Date('2026-07-31T15:00:00Z');

    expect(fechaParaAfip(AR, momento)).toBe('20260731');
  });

  // Un comprobante fechado el dia siguiente al de la operacion es una
  // inconsistencia entre el libro de ventas y lo declarado.
  it('una factura de las 21:30 lleva la fecha del dia de la venta', () => {
    const momento = new Date('2026-08-01T00:30:00Z');

    expect(fechaParaAfip(AR, momento)).toBe('20260731');
  });
});

describe('hoyDelNegocio', () => {
  // Vivia dentro de routes/sales.js. Se subio a utils porque la recepcion de
  // una orden de compra necesita exactamente la misma fecha: el movimiento de
  // deuda de una recepcion de las 21:30 del 31 de julio se fechaba el 1 de
  // agosto y se iba al mes siguiente del estado de cuenta.
  beforeEach(() => {
    jest.useFakeTimers();
    mockEmpresa.findByPk.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hoyDelNegocio NO devuelve mañana a las 21:30 de Argentina', async () => {
    // ⚠ El instante importa. Las 21:30 ART del 31/07 son las 00:30 UTC del
    // 01/08: recien ahi UTC esta en el dia siguiente y la linea vieja se
    // equivoca. Congelar el reloj en 2026-07-31T23:30:00Z serian las 20:30 ART
    // y el test pasaria con y sin la correccion, que es no probar nada.
    jest.setSystemTime(new Date('2026-08-01T00:30:00Z')); // 31/07 21:30 ART
    mockEmpresa.findByPk.mockResolvedValue({ timezone: AR });

    expect(await hoyDelNegocio(7)).toBe('2026-07-31');
    // Lo que devolvia —y todavia devuelve purchaseService— la linea vieja:
    expect(new Date().toISOString().split('T')[0]).toBe('2026-08-01');
  });

  it('una empresa sin timezone cae a la zona por defecto y no a UTC', async () => {
    jest.setSystemTime(new Date('2026-08-01T00:30:00Z'));
    mockEmpresa.findByPk.mockResolvedValue({ timezone: null });

    expect(await hoyDelNegocio(7)).toBe('2026-07-31');
  });

  it('una empresa que no existe tampoco cae a UTC', async () => {
    jest.setSystemTime(new Date('2026-08-01T00:30:00Z'));
    mockEmpresa.findByPk.mockResolvedValue(null);

    expect(await hoyDelNegocio(7)).toBe('2026-07-31');
  });

  it('sales.js ya no declara su propia hoyDelNegocio', () => {
    // Dos declaraciones de la misma fecha del negocio son dos que se pueden
    // separar: alcanza con que alguien corrija una.
    const fuente = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'sales.js'),
      'utf8'
    );

    expect(fuente).toMatch(/require\('\.\.\/utils\/fechas'\)/);
    expect(fuente).not.toMatch(/function\s+hoyDelNegocio\s*\(/);
  });
});
