// ════════════════════════════════════════════
//  ADMINAPP · Que cuenta como "stock bajo"
//
//  Existe porque hoy hay dos reglas distintas para la misma pregunta:
//
//   - GET /api/faltantes (general.js:416) usa el min_stock de la fila si esta
//     cargado y, si no, un umbral general de 3 unidades. El 3 esta escrito
//     como literal ahi adentro.
//   - GET /api/alerts (general.js:351) exige `min_stock > 0`, o sea que un
//     producto SIN minimo cargado no alerta nunca, aunque este en cero.
//
//  El resultado es que dos pantallas del mismo sistema no coinciden sobre que
//  falta. FR-016 y FR-017 piden una sola regla, y esta es. El umbral entra
//  **por parametro**: la misma funcion se porta al navegador
//  (apps/web/src/utils/stockBajo.js) y dos literales iguales en dos
//  repositorios empiezan iguales y terminan distintos.
//
//  Lo que NO se toca a proposito: GET /api/alerts y dashboardService.js:250
//  siguen con la regla vieja. Es el riesgo 6 del plan —cambiarlos mueve un
//  numero que el usuario mira todos los dias desde el panel de control, y
//  FR-016 no los incluye—, asi que Inventario va a mostrar mas productos en
//  stock bajo que el panel.
// ════════════════════════════════════════════

/**
 * Cuantas unidades hacen falta para considerar bajo un producto sin minimo
 * cargado. Es el valor que ya usaba el sistema anterior y que hoy esta
 * escrito a mano en GET /api/faltantes.
 */
const UMBRAL_POR_DEFECTO = 3;

/**
 * El limite por debajo del cual (o igual al cual) la fila esta en falta.
 *
 * El minimo cargado manda; el umbral es solo para las filas que no tienen
 * ninguno. Un minimo en 0 —el default de la columna— significa "no lo
 * cargaron", no "el minimo es cero".
 *
 * @param {{min_stock?: number|string}} fila
 * @param {number} [umbral]
 * @returns {number}
 */
function limiteDeStockBajo(fila, umbral = UMBRAL_POR_DEFECTO) {
  const minimo = Number(fila && fila.min_stock) || 0;

  // Un minimo negativo es dato roto: se trata como si no estuviera cargado.
  if (minimo > 0) return minimo;

  const general = Number(umbral);

  return Number.isFinite(general) ? general : UMBRAL_POR_DEFECTO;
}

/**
 * Si esta fila de stock cuenta como "stock bajo".
 *
 * Es `<=` y no `<` porque la pregunta que contesta es "hay que reponerlo": un
 * producto con minimo 5 y cinco unidades ya llego al minimo. Es la misma
 * comparacion que hace hoy GET /api/faltantes.
 *
 * @param {{quantity?: number|string, min_stock?: number|string}} fila
 * @param {number} [umbral]
 * @returns {boolean}
 */
function esStockBajo(fila, umbral = UMBRAL_POR_DEFECTO) {
  const cantidad = Number(fila && fila.quantity) || 0;

  return cantidad <= limiteDeStockBajo(fila, umbral);
}

module.exports = { UMBRAL_POR_DEFECTO, limiteDeStockBajo, esStockBajo };
