// ════════════════════════════════════════════
//  FAVALIO · Que cuenta como "stock bajo"
//
//  Existe porque hubo dos reglas distintas para la misma pregunta:
//
//   - GET /api/faltantes usa el min_stock de la fila si esta cargado y, si no,
//     un umbral general de 3 unidades. El 3 estaba escrito como literal ahi
//     adentro.
//   - El panel de control exigia `min_stock > 0`, o sea que un producto SIN
//     minimo cargado no alertaba nunca, aunque estuviera en cero.
//
//  El resultado era que dos pantallas del mismo sistema no coincidian sobre que
//  falta. FR-016 y FR-017 piden una sola regla, y esta es. El umbral entra
//  **por parametro**: la misma funcion se porta al navegador
//  (apps/web/src/utils/stockBajo.js) y dos literales iguales en dos
//  repositorios empiezan iguales y terminan distintos.
//
//  ── El panel de control tambien usa esta regla, desde la 014 ──
//
//  Hasta ese corte, este encabezado decia que el panel quedaba afuera **a
//  proposito** (riesgo 6 del plan de la 011): cambiarlo movia un numero que el
//  dueño mira todos los dias. Lo que volvio intolerable la divergencia es que el
//  Panel pasa a ENLAZAR a la pantalla de Faltantes: un aviso que dice «7
//  productos por debajo del minimo» y lleva a una pantalla que muestra doce es
//  peor que los dos numeros sueltos.
//
//  Asi que `dashboardService._productStats` y `_lowStockAlerts` leen las filas y
//  cuentan con `esStockBajo`, igual que GET /api/faltantes. Traducir la regla a
//  SQL habria sido mas barato y habria dejado **dos escrituras de la misma
//  regla**, que es exactamente por lo que este archivo existe.
//
//  Consecuencia visible, avisada en docs/OPERACION.md: el numero de «stock bajo»
//  del Panel **subio**, porque ahora cuenta los productos en cero sin minimo
//  cargado.
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
