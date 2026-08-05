// ════════════════════════════════════════════
//  Plata en centavos enteros
//
//  Los dos defectos que esta conversión evita ya mordieron en el repositorio:
//
//   1. `Math.abs(1200 - 1200.01)` da 0.009999999999999787 y no llega a 0.01,
//      así que subir un costo de $1.200,00 a $1.200,01 no quedaba registrado.
//      Y depende de la magnitud: con 10.00 → 10.01 la misma cuenta da
//      0.010000000000000675 y sí pasa. El historial se salteaba filas para unos
//      productos y no para otros, sin ningún patrón visible.
//   2. Sumar importes en pesos deja residuos: veinte movimientos de una cuenta
//      corriente terminan diciendo 1234.5600000000002. De ese número cuelga el
//      badge «Saldado», que compara contra cero.
// ════════════════════════════════════════════

const { aCentavos, deCentavos, sumaEnCentavos } = require('../utils/centavos');
const { esCambioSignificativo } = require('../utils/historialDeCostos');

describe('aCentavos', () => {
  it('NO se come el cambio de 1200 a 1200,01', () => {
    // La resta en pesos da 0.009999999999999787: en centavos es exactamente 1.
    expect(aCentavos(1200.01) - aCentavos(1200)).toBe(1);
    expect(Math.abs(1200 - 1200.01) >= 0.01).toBe(false);

    // Y es el caso que esCambioSignificativo documenta, que sigue apoyado acá.
    expect(esCambioSignificativo(1200, 1200.01)).toBe(true);
  });

  it('convierte el DECIMAL que el driver devuelve como string', () => {
    // Sequelize devuelve DECIMAL(14,2) como texto. Sin la conversión explícita,
    // `'1234.56' * 100` funciona por coerción pero `'1234.56' + 0` concatena.
    expect(aCentavos('1234.56')).toBe(123456);
    expect(aCentavos('0.01')).toBe(1);
    expect(aCentavos('-500.50')).toBe(-50050);
  });

  it('null y undefined dan cero y no NaN', () => {
    // Un NaN en una suma de plata se propaga a todo el total y no lo detiene
    // nada: la pantalla muestra «$NaN» o, peor, `Number(NaN) || 0` más arriba
    // lo convierte en cero y el saldo queda mal sin ningún síntoma.
    expect(aCentavos(null)).toBe(0);
    expect(aCentavos(undefined)).toBe(0);
    expect(aCentavos('')).toBe(0);
    expect(aCentavos('no es un número')).toBe(0);

    for (const valor of [null, undefined, '', 'no es un número']) {
      expect(Number.isNaN(aCentavos(valor))).toBe(false);
    }
  });
});

describe('deCentavos', () => {
  it('vuelve a pesos con dos decimales exactos', () => {
    expect(deCentavos(123456)).toBe(1234.56);
    expect(deCentavos(1)).toBe(0.01);
    expect(deCentavos(0)).toBe(0);
    expect(deCentavos(null)).toBe(0);
  });
});

describe('sumaEnCentavos', () => {
  it('NO devuelve 1234.5600000000002 al sumar', () => {
    // Estos tres importes sumados en punto flotante dan exactamente el residuo
    // que da nombre al test.
    const importes = [0.11, 0.29, 1234.16];

    expect(importes.reduce((a, b) => a + b, 0)).toBe(1234.5600000000002);
    expect(sumaEnCentavos(importes)).toBe(1234.56);
  });

  it('una deuda y un pago que se cancelan exactamente dan cero de verdad', () => {
    // De este cero cuelga el badge «Saldado». Un residuo de 0.0000000001 lo
    // convierte en «Con deuda» sin que ningún número se vea distinto.
    expect(sumaEnCentavos(['0.1', '0.2', '-0.3'])).toBe(0);
  });

  it('una lista vacía da cero y no NaN', () => {
    expect(sumaEnCentavos([])).toBe(0);
    expect(sumaEnCentavos()).toBe(0);
  });

  it('suma los DECIMAL que llegan como string', () => {
    expect(sumaEnCentavos(['184000.00', '-120000.00'])).toBe(64000);
  });
});

describe('historialDeCostos usa la conversión compartida', () => {
  const fs = require('fs');
  const path = require('path');

  const fuente = fs.readFileSync(
    path.join(__dirname, '..', 'utils', 'historialDeCostos.js'),
    'utf8'
  );

  it('esCambioSignificativo sigue usando la conversión compartida', () => {
    // Guardia estática: si alguien vuelve a pegar una `aCentavos` local, las dos
    // conversiones pueden separarse —una redondea, la otra trunca— y el umbral
    // del centavo deja de significar lo mismo en los dos lados.
    expect(fuente).toMatch(/require\('\.\/centavos'\)/);
    expect(fuente).not.toMatch(/function\s+aCentavos\s*\(/);
  });
});
