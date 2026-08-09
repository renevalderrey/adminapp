// ════════════════════════════════════════════
//  Los cinco estados de una suscripción, más el sexto que no existe
//
//  `evaluarSuscripcion` es la única lista de estados del proyecto (FR-110): la
//  miran la cadena privada (`middleware/checkSubscription.js`) y el catálogo
//  público (`routes/catalogoPublico.js`). Un error acá se cobra en los dos
//  lados a la vez, y en direcciones opuestas: cortarle la caja a un comercio
//  que pagó, o dejar un catálogo público vendiendo por una empresa vencida.
//
//  Los dos casos que este archivo existe para sostener:
//
//   · **Un estado que no está en el enum bloquea, no deja pasar.** Es el caso
//     por defecto del `switch`, y es el que se rompe solo: alguien agrega un
//     sexto valor al enum de `models/Suscripcion.js`, se olvida del `switch`,
//     y si el defecto dejara pasar el agujero se abre en silencio. Con el
//     defecto que bloquea, el olvido se nota el primer día.
//
//   · **El período de gracia sigue funcionando.** Es la mitad que se rompe al
//     apretar la otra: un `switch` que bloquea de más le corta el acceso a
//     quien todavía está en el período que ya pagó.
//
//  ⚠ Va en `src/tests/` y no al lado de la función. El `testMatch` de jest
//  solo levanta `src/tests/**` y `__tests__/**`: un `src/utils/*.test.js` no
//  corre nunca, no falla y no avisa. Lo protege `todosLosTestsCorren.test.js`.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const {
  evaluarSuscripcion,
  ESTADOS_CONOCIDOS,
  MOTIVO_ESTADO_DESCONOCIDO,
} = require('../utils/estadoDeSuscripcion');

const AHORA = new Date('2026-08-09T12:00:00Z');
const PASADO = new Date('2026-07-05T00:00:00Z');
const FUTURO = new Date('2026-09-20T00:00:00Z');

/**
 * Una fila de suscripción.
 *
 * ⚠ Las tres fechas por defecto son **distintas entre sí** y caen a los dos
 * lados de `AHORA`: si alguna vez `trial_ends_at` y `grace_period_ends` se
 * confundieran una con la otra, una fixture con las dos fechas iguales daría
 * el mismo resultado por casualidad y el test pasaría igual.
 */
function suscripcion(campos) {
  return {
    id: 1,
    empresa_id: 7,
    trial_ends_at: PASADO,
    grace_period_ends: FUTURO,
    ...campos,
  };
}

describe('los cinco estados del enum', () => {
  it('«active» no bloquea, aunque la gracia esté vencida: quien está al día entra', () => {
    const { bloqueado } = evaluarSuscripcion(
      suscripcion({ status: 'active', grace_period_ends: PASADO }),
      AHORA
    );

    expect(bloqueado).toBe(false);
  });

  it('«expired» bloquea aunque le queden días de gracia: el cron ya la dio por vencida', () => {
    const { bloqueado, motivo } = evaluarSuscripcion(
      suscripcion({ status: 'expired', grace_period_ends: FUTURO }),
      AHORA
    );

    expect(bloqueado).toBe(true);
    expect(motivo).toBe('Tu suscripción venció.');
  });

  // Cancelar dejaba el acceso abierto para siempre: 'cancelled' no estaba en
  // el switch y caía de largo.
  it('«cancelled» bloquea cuando la gracia se agotó — antes no bloqueaba nunca', () => {
    const { bloqueado, motivo } = evaluarSuscripcion(
      suscripcion({ status: 'cancelled', grace_period_ends: PASADO }),
      AHORA
    );

    expect(bloqueado).toBe(true);
    expect(motivo).toBe('Tu suscripción fue cancelada.');
  });

  // Una suscripción impaga seguía funcionando hasta que el cron la pasara a
  // 'expired', que podía ser días después.
  it('«past_due» bloquea cuando la gracia se agotó — antes esperaba al cron', () => {
    const { bloqueado, motivo } = evaluarSuscripcion(
      suscripcion({ status: 'past_due', grace_period_ends: PASADO }),
      AHORA
    );

    expect(bloqueado).toBe(true);
    expect(motivo).toBe('Tu suscripción tiene un pago pendiente.');
  });

  // La otra mitad de los dos de arriba: sin esto, un `switch` que bloqueara
  // por el estado y no por la fecha pasaría igual.
  it('«trialing» con el trial vigente no bloquea', () => {
    const { bloqueado } = evaluarSuscripcion(
      suscripcion({ status: 'trialing', trial_ends_at: FUTURO, grace_period_ends: null }),
      AHORA
    );

    expect(bloqueado).toBe(false);
  });

  it('«trialing» con el trial terminado y la gracia agotada bloquea', () => {
    const { bloqueado, motivo } = evaluarSuscripcion(
      suscripcion({ status: 'trialing', trial_ends_at: PASADO, grace_period_ends: PASADO }),
      AHORA
    );

    expect(bloqueado).toBe(true);
    expect(motivo).toBe('Terminó tu período de prueba.');
  });
});

// ── El período de gracia, que es la mitad que se rompe al apretar la otra ──

describe('el período de gracia sigue funcionando', () => {
  // 'expired' no está: ese bloquea sin mirar la gracia, y es a propósito.
  it.each(['trialing', 'past_due', 'cancelled'])(
    '«%s» con la gracia todavía corriendo NO bloquea: es tiempo ya pagado',
    (status) => {
      const { bloqueado } = evaluarSuscripcion(
        suscripcion({ status, trial_ends_at: PASADO, grace_period_ends: FUTURO }),
        AHORA
      );

      expect(bloqueado).toBe(false);
    }
  );

  it.each(['trialing', 'past_due', 'cancelled'])(
    '«%s» sin fecha de gracia bloquea: la gracia ausente no es gracia infinita',
    (status) => {
      const { bloqueado } = evaluarSuscripcion(
        suscripcion({ status, trial_ends_at: PASADO, grace_period_ends: null }),
        AHORA
      );

      expect(bloqueado).toBe(true);
    }
  );

  // El borde exacto. `<` y no `<=`: el instante justo en que vence todavía
  // está adentro. Se fija para que un cambio de comparador no pase inadvertido.
  it('el instante exacto en que vence la gracia todavía no bloquea', () => {
    const { bloqueado } = evaluarSuscripcion(
      suscripcion({ status: 'past_due', grace_period_ends: AHORA }),
      AHORA
    );

    expect(bloqueado).toBe(false);
  });
});

// ── El sexto estado, el que no existe ──

describe('un estado que no está en el enum bloquea, no deja pasar', () => {
  it.each([
    ['paused', 'un estado nuevo del enum que nadie agregó al switch'],
    ['ACTIVE', 'el mismo valor con otra caja: los estados son sensibles a mayúsculas'],
    ['', 'una columna vacía'],
    [null, 'una fila con el status en null'],
    [undefined, 'una fila leída sin el atributo status'],
  ])('«%s» bloquea (%s)', (status) => {
    const { bloqueado, motivo } = evaluarSuscripcion(suscripcion({ status }), AHORA);

    expect(bloqueado).toBe(true);
    expect(motivo).toBe(MOTIVO_ESTADO_DESCONOCIDO);
  });

  // Defensivo. Los dos llamadores resuelven «sin fila» antes de llegar acá,
  // cada uno con su redacción, así que este camino no debería alcanzarse; si
  // alguna vez se alcanza, que sea del lado seguro. Una empresa sin fila de
  // suscripción con acceso ilimitado y gratis es uno de los tres errores más
  // caros que cita CONVENCIONES.md.
  it('una fila ausente bloquea, no deja pasar', () => {
    expect(evaluarSuscripcion(null, AHORA).bloqueado).toBe(true);
    expect(evaluarSuscripcion(undefined, AHORA).bloqueado).toBe(true);
  });
});

// ── Anclas: que la lista única siga siendo única, y siga siendo la del enum ──

const MODELO = fs.readFileSync(
  path.join(__dirname, '..', 'models', 'Suscripcion.js'),
  'utf8'
);

describe('la lista de estados es UNA y es la del enum', () => {
  // Es el modo de falla que la extracción existe para evitar (FR-110), y no lo
  // ve ningún test de comportamiento: agregar un valor al enum y olvidarse del
  // `switch` deja todo en verde hasta que aparece una fila con ese valor en
  // producción.
  it('ESTADOS_CONOCIDOS tiene exactamente los cinco valores del ENUM del modelo', () => {
    const declarado = MODELO.match(/status:\s*\{[\s\S]*?DataTypes\.ENUM\(([^)]*)\)/);

    // Ancla del recorte: si el modelo cambia de forma, el `match` devolvería
    // null y las comparaciones de abajo dirían cualquier cosa.
    expect(declarado).not.toBeNull();

    const delEnum = declarado[1]
      .split(',')
      .map((valor) => valor.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);

    expect(delEnum).toHaveLength(5);
    expect([...ESTADOS_CONOCIDOS].sort()).toEqual([...delEnum].sort());
  });

  // `ESTADOS_CONOCIDOS` y el `switch` viven en el mismo archivo, pero son dos
  // escrituras: esto ata una a la otra. Si alguien agrega un `case` y no toca
  // la lista, el estado bloquearía bien pero el llamador lo loguearía como
  // desconocido en cada request.
  it('ninguno de los cinco cae en el caso por defecto del switch', () => {
    for (const status of ESTADOS_CONOCIDOS) {
      const { motivo } = evaluarSuscripcion(suscripcion({ status }), AHORA);

      expect(motivo).not.toBe(MOTIVO_ESTADO_DESCONOCIDO);
    }
  });
});
