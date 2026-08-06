// ⚠ Va en `src/tests/` y NO en `utils/antiguedad.test.js`: el `testMatch` de
// `jest.config.js` solo levanta `src/tests/**` y `__tests__/**`, así que un
// archivo al lado del código no lo corre nadie — no falla, no avisa, y alguien
// lee el nombre y da por cubierto lo que jamás se ejecutó.

const { repartirPorAntiguedad } = require('../utils/antiguedad');

// La referencia es fija: un test de antigüedad contra `new Date()` cambia de
// resultado según el día en que se corra.
const HOY = new Date('2026-07-31T00:00:00Z');

/** Un comprobante de `dias` de antigüedad respecto de HOY. */
function haceDias(dias, monto) {
  const fecha = new Date(HOY.getTime() - dias * 24 * 60 * 60 * 1000);

  return { fecha: fecha.toISOString().split('T')[0], monto };
}

function sumaDeTramos(tramos) {
  return Object.values(tramos).reduce((a, b) => a + b, 0);
}

describe('repartirPorAntiguedad', () => {
  it('un saldo de 0 se reparte en cuatro ceros y NO en cuatro NaN', () => {
    const tramos = repartirPorAntiguedad([haceDias(10, 1000)], HOY, {
      saldoImpago: 0,
      totalFacturado: 1000,
    });

    for (const [nombre, valor] of Object.entries(tramos)) {
      expect(Number.isNaN(valor)).toBe(false);
      expect(valor).toBe(0);
      expect(typeof valor).toBe('number');
      expect(nombre).toBeTruthy();
    }
  });

  it('sin comprobantes tampoco devuelve NaN', () => {
    const tramos = repartirPorAntiguedad([], HOY, { saldoImpago: 500, totalFacturado: 0 });

    expect(sumaDeTramos(tramos)).toBe(0);
  });

  it('NO devuelve undefined para ningún tramo, aunque la entrada sea basura', () => {
    const tramos = repartirPorAntiguedad(null, HOY, {});

    expect(Object.keys(tramos).sort()).toEqual(['0_30', '31_60', '61_90', '90_plus']);
  });

  // ── Los tres cortes ──
  //
  // Cada corte se prueba en sus DOS lados. Con un solo caso por tramo, cambiar
  // un `<=` por un `<` mueve el borde un día y ningún test se pone en rojo:
  // es exactamente la mutación que este bloque tiene que atrapar.

  it('un comprobante de EXACTAMENTE 30 días es «0 a 30», y el de 31 no', () => {
    const treinta = repartirPorAntiguedad([haceDias(30, 1000)], HOY, {
      saldoImpago: 1000, totalFacturado: 1000,
    });
    const treintaYUno = repartirPorAntiguedad([haceDias(31, 1000)], HOY, {
      saldoImpago: 1000, totalFacturado: 1000,
    });

    expect(treinta['0_30']).toBe(1000);
    expect(treinta['31_60']).toBe(0);
    expect(treintaYUno['0_30']).toBe(0);
    expect(treintaYUno['31_60']).toBe(1000);
  });

  it('un comprobante de EXACTAMENTE 60 días es «31 a 60», y el de 61 no', () => {
    const sesenta = repartirPorAntiguedad([haceDias(60, 800)], HOY, {
      saldoImpago: 800, totalFacturado: 800,
    });
    const sesentaYUno = repartirPorAntiguedad([haceDias(61, 800)], HOY, {
      saldoImpago: 800, totalFacturado: 800,
    });

    expect(sesenta['31_60']).toBe(800);
    expect(sesenta['61_90']).toBe(0);
    expect(sesentaYUno['31_60']).toBe(0);
    expect(sesentaYUno['61_90']).toBe(800);
  });

  it('un comprobante de EXACTAMENTE 90 días es «61 a 90», y el de 91 no', () => {
    const noventa = repartirPorAntiguedad([haceDias(90, 640)], HOY, {
      saldoImpago: 640, totalFacturado: 640,
    });
    const noventaYUno = repartirPorAntiguedad([haceDias(91, 640)], HOY, {
      saldoImpago: 640, totalFacturado: 640,
    });

    expect(noventa['61_90']).toBe(640);
    expect(noventa['90_plus']).toBe(0);
    expect(noventaYUno['61_90']).toBe(0);
    expect(noventaYUno['90_plus']).toBe(640);
  });

  // ── El invariante: los cuatro tramos suman el total de arriba ──
  //
  // Es FR-045. El defecto P3 es literalmente esto sin cumplir: el total suma lo
  // impago y los tramos sumaban lo facturado.

  it('los cuatro tramos suman EXACTAMENTE el saldo impago, con un importe que no se divide bien', () => {
    // 100,00 repartido en tres partes iguales da 33,33 × 3 = 99,99 si cada
    // tramo se redondea por su cuenta. Este es el caso que lo detecta.
    const tramos = repartirPorAntiguedad(
      [haceDias(10, 100), haceDias(45, 100), haceDias(75, 100)],
      HOY,
      { saldoImpago: 100, totalFacturado: 300 }
    );

    expect(sumaDeTramos(tramos)).toBe(100);
  });

  it('los cuatro tramos suman el saldo impago con centavos que no cierran solos', () => {
    const tramos = repartirPorAntiguedad(
      [haceDias(5, 1234.56), haceDias(40, 0.1), haceDias(70, 0.2), haceDias(120, 999.99)],
      HOY,
      { saldoImpago: 777.77, totalFacturado: 2234.85 }
    );

    expect(sumaDeTramos(tramos)).toBe(777.77);
  });

  it('reparte proporcionalmente: la mitad impaga de dos comprobantes iguales cae mitad y mitad', () => {
    const tramos = repartirPorAntiguedad(
      [haceDias(10, 1000), haceDias(45, 1000)],
      HOY,
      { saldoImpago: 1000, totalFacturado: 2000 }
    );

    expect(tramos['0_30']).toBe(500);
    expect(tramos['31_60']).toBe(500);
  });

  // ── Lo que llega de la base ──

  it('lee los importes que Postgres devuelve como STRING y contesta números', () => {
    const tramos = repartirPorAntiguedad(
      [{ date: '2026-07-25', amount: '1234.56' }],
      HOY,
      { saldoImpago: 1234.56, totalFacturado: 1234.56, fecha: 'date', importe: 'amount' }
    );

    // `toBeCloseTo` acepta una cadena y la compara como número: sin esto, un
    // '1234.56' que nunca se convirtió pasaría el test.
    expect(typeof tramos['0_30']).toBe('number');
    expect(tramos['0_30']).toBe(1234.56);
  });

  it('acepta el «hoy» del negocio como texto YYYY-MM-DD y no manda todo a «más de 90»', () => {
    // `hoyDelNegocio` devuelve texto. Restar un Date de un string da NaN, y un
    // NaN cae en el último `else`: todo el saldo aterrizaría en «90_plus».
    const tramos = repartirPorAntiguedad([haceDias(5, 500)], '2026-07-31', {
      saldoImpago: 500, totalFacturado: 500,
    });

    expect(tramos['0_30']).toBe(500);
    expect(tramos['90_plus']).toBe(0);
  });
});
