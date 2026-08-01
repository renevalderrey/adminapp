// ════════════════════════════════════════════
//  Lectura de importes escritos por una persona
//
//  Esta funcion decide cuanto cuesta un producto a partir de lo que alguien
//  escribio en una planilla. Los dos errores que evita no fallan: dejan un
//  numero equivocado cargado y siguen.
//
//   - 1.234,50 leido al reves es 1.234: el proveedor parece mil veces mas
//     barato y la comparacion entera miente.
//   - Una celda vacia leida como 0 pone el costo del producto en cero, y el
//     margen que muestra el POS pasa a ser mentira (FR-099).
//
//  Los casos que ya cubria comparador.test.js siguen ahi sin tocar: esa es la
//  prueba de que la funcion se movio y no se reescribio.
// ════════════════════════════════════════════

const { aNumero } = require('../utils/importes');

describe('aNumero · formato argentino', () => {
  it.each([
    ['1.234,50', 1234.5, 'punto de miles y coma decimal'],
    ['1.234', 1234, 'solo punto de miles'],
    ['12.345.678', 12345678, 'dos puntos de miles'],
    ['0,99', 0.99, 'solo decimales'],
    ['1234', 1234, 'entero pelado'],
  ])('%s → %s (%s)', (entrada, esperado) => {
    expect(aNumero(entrada)).toBe(esperado);
  });

  it('NO lee 1.234 como 1,234', () => {
    // El error que arruina el costo de un producto sin fallar.
    expect(aNumero('1.234')).toBe(1234);
    expect(aNumero('1.234')).not.toBeCloseTo(1.234);
  });
});

describe('aNumero · lo que trae una planilla de proveedor', () => {
  it('lee el importe aunque venga con el simbolo de moneda pegado', () => {
    // Antes del movimiento esto devolvia null: el "$" sobrevivia al parseo y
    // Number("$1234.50") es NaN. Una columna de costos con el simbolo adentro
    // se importaba entera sin costo.
    expect(aNumero('$1.234,50')).toBe(1234.5);
    expect(aNumero('$ 1.234,50')).toBe(1234.5);
    expect(aNumero('ARS 1.234,50')).toBe(1234.5);
  });

  it('lee el punto decimal cuando el ultimo grupo no es de tres', () => {
    expect(aNumero('1234.50')).toBe(1234.5);
    expect(aNumero('1234.5')).toBe(1234.5);
  });

  it('lee el formato ingles: el separador decimal es el que va ultimo', () => {
    // Muchas planillas se exportan con la configuracion regional en ingles.
    // Sin esta regla, 1,234.50 se leia 1.2345 —cuatro ordenes de magnitud— y
    // el producto quedaba costando un peso con veinte.
    expect(aNumero('1,234.50')).toBe(1234.5);
    expect(aNumero('12,345,678.90')).toBe(12345678.9);
  });

  it('no rompe con el espacio duro que pegan las planillas', () => {
    expect(aNumero('1.234,50 ')).toBe(1234.5);
  });

  it('devuelve el numero tal cual cuando la celda ya es numerica', () => {
    // Una celda de .xlsx llega como number, no como texto. Pasarla por el
    // parser de separadores la rompe: "1234.567" tiene el ultimo grupo de
    // tres digitos y se leeria 1.234.567.
    expect(aNumero(1234.567)).toBe(1234.567);
    expect(aNumero(0)).toBe(0);
  });
});

describe('aNumero · cuando no hay nada que leer devuelve null y NO 0', () => {
  // FR-099. Es la diferencia entre "este producto no trae costo en el archivo,
  // se deja el que tenia" y "este producto ahora cuesta cero".
  it.each([
    ['celda vacia', ''],
    ['solo espacios', '   '],
    ['null', null],
    ['undefined', undefined],
    ['solo el simbolo de moneda', '$'],
    ['un guion', '-'],
    ['texto sin numeros', 'consultar'],
  ])('%s → null', (_nombre, entrada) => {
    expect(aNumero(entrada)).toBeNull();
    expect(aNumero(entrada)).not.toBe(0);
  });

  it('el cero escrito SI es cero', () => {
    // No confundir "no vino nada" con "vino un cero": son decisiones
    // distintas para quien importa.
    expect(aNumero('0')).toBe(0);
    expect(aNumero('0,00')).toBe(0);
  });
});
