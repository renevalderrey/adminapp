const {
  ESTADOS,
  puedeTransicionar,
  validarTransicion,
  transicionesDesde,
} = require('../utils/estadoDePedido');

// ════════════════════════════════════════════
//  Las transiciones — y las dos que NO existen
// ════════════════════════════════════════════

describe('estadoDePedido', () => {
  it('son seis estados', () => {
    expect(ESTADOS).toHaveLength(6);
  });

  it('de cancelado no se sale a ningún lado', () => {
    // Un pedido cancelado que vuelve a `en_preparacion` es un pedido que el
    // comercio ya le dijo al cliente que no existía.
    for (const hacia of ESTADOS) {
      expect(puedeTransicionar('cancelado', hacia)).toBe(false);
    }

    expect(transicionesDesde('cancelado')).toEqual([]);
    expect(validarTransicion('cancelado', 'pagado')).toMatchObject({ ok: false, error: 'ESTADO_TERMINAL' });
  });

  it('de entregado tampoco', () => {
    // Lo que ya salió del local no se cancela: se devuelve, y una devolución es
    // otra cosa que todavía no existe.
    for (const hacia of ESTADOS) {
      expect(puedeTransicionar('entregado', hacia)).toBe(false);
    }
  });

  it('`pagado → pagado` no está permitida', () => {
    // Esto es lo que hace que marcar cobrado dos veces sea idempotente por
    // construcción, sin clave de idempotencia: no hay estado desde el que la
    // segunda pasada sea legal.
    expect(puedeTransicionar('pagado', 'pagado')).toBe(false);
    expect(validarTransicion('pagado', 'pagado')).toMatchObject({ ok: false, error: 'SIN_CAMBIO' });
  });

  it('ningún estado transiciona a sí mismo', () => {
    for (const estado of ESTADOS) {
      expect(puedeTransicionar(estado, estado)).toBe(false);
    }
  });

  it('el camino normal del pedido está permitido', () => {
    expect(puedeTransicionar('pendiente_pago', 'pagado')).toBe(true);
    expect(puedeTransicionar('pagado', 'en_preparacion')).toBe(true);
    expect(puedeTransicionar('en_preparacion', 'listo')).toBe(true);
    expect(puedeTransicionar('listo', 'entregado')).toBe(true);
  });

  it('se puede cancelar desde cualquier estado que no sea terminal', () => {
    for (const desde of ['pendiente_pago', 'pagado', 'en_preparacion', 'listo']) {
      expect(puedeTransicionar(desde, 'cancelado')).toBe(true);
    }
  });

  it('no se vuelve para atrás', () => {
    expect(puedeTransicionar('listo', 'en_preparacion')).toBe(false);
    expect(puedeTransicionar('pagado', 'pendiente_pago')).toBe(false);
    expect(puedeTransicionar('en_preparacion', 'pagado')).toBe(false);
  });

  it('un estado que no existe es false, no una excepción', () => {
    // El que llama es un handler con datos de la red.
    expect(puedeTransicionar('pagado', 'despachado')).toBe(false);
    expect(puedeTransicionar(undefined, 'pagado')).toBe(false);
    expect(validarTransicion('pagado', 'despachado')).toMatchObject({ ok: false, error: 'ESTADO_INVALIDO' });
    expect(transicionesDesde('inventado')).toEqual([]);
  });
});
