// ════════════════════════════════════════════
//  FAVALIO · Plata en centavos enteros
//
//  FR-050 pide que el saldo de un proveedor se sume «con la misma disciplina
//  que esCambioSignificativo»: en centavos enteros y no en punto flotante.
//  Esa conversión ya estaba escrita —una vez— dentro de
//  utils/historialDeCostos.js, sin exportar.
//
//  Sin sacarla de ahí, cada suma nueva escribe su propio Math.round(n * 100), y
//  dos conversiones a centavos son dos redondeos que se separan: alcanza con
//  que una use Math.round y la otra Math.trunc, o que una convierta el string
//  del driver y la otra no, para que el saldo de la pantalla y el del archivo
//  exportado difieran en un centavo sin que nada falle.
//
//  ── Por qué hace falta convertir antes de sumar ──
//
//  Los importes son DECIMAL(14,2) y el driver de Postgres los devuelve como
//  **string**. Sumarlos en pesos con punto flotante da residuos visibles:
//  0.1 + 0.2 es 0.30000000000000004, y una cuenta corriente de veinte
//  movimientos termina diciendo 1234.5600000000002. De ese número cuelga el
//  badge «Saldado», que compara contra cero.
//
//  Un centavo es la unidad mínima que la columna puede guardar, así que es la
//  unidad en la que hay que sumar y comparar.
// ════════════════════════════════════════════

/**
 * Un importe llevado a centavos enteros, que es como lo guarda la columna.
 *
 * El `Number(n) || 0` no es defensivo de más: `null`, `undefined` y el `''` de
 * un campo vacío llegan acá desde la base y desde el cuerpo de un request, y
 * `Math.round(undefined * 100)` es `NaN`. Un `NaN` en una suma de plata se
 * propaga a todo el total y no lo detiene nada.
 *
 * @param {number|string|null|undefined} n
 * @returns {number} Centavos enteros.
 */
function aCentavos(n) {
  return Math.round((Number(n) || 0) * 100);
}

/**
 * Centavos enteros de vuelta a pesos, con dos decimales exactos.
 *
 * @param {number|string|null|undefined} centavos
 * @returns {number}
 */
function deCentavos(centavos) {
  return (Number(centavos) || 0) / 100;
}

/**
 * La suma de una lista de importes, hecha en centavos y devuelta en pesos.
 *
 * El acumulador es entero de punta a punta: convertir cada importe y sumar
 * enteros es lo que hace que veinte movimientos den 1234.56 y no
 * 1234.5600000000002.
 *
 * @param {Array<number|string|null|undefined>} importes
 * @returns {number} La suma en pesos.
 */
function sumaEnCentavos(importes = []) {
  let total = 0;

  for (const importe of importes) total += aCentavos(importe);

  return deCentavos(total);
}

module.exports = { aCentavos, deCentavos, sumaEnCentavos };
