// ════════════════════════════════════════════
//  ADMINAPP · Qué cuenta como «stock bajo», del lado del navegador
//
//  Es la MISMA regla que `apps/api/src/utils/stockBajo.js`: el `min_stock` de
//  la fila si está cargado y, si no, un umbral general. La necesitan el
//  indicador «Stock bajo», el conmutador del filtro y el color del badge de
//  cada celda de sucursal, y FR-016 pide que las tres contesten lo mismo que
//  contesta `GET /api/faltantes`.
//
//  ── Por qué el umbral NO está acá adentro ──
//
//  Porque el umbral vive en el servidor y llega por `GET /api/settings` como
//  `umbral_stock_bajo` (T1028). Escribirlo también acá serían dos literales
//  iguales en dos repositorios, y dos literales iguales en dos repositorios
//  empiezan iguales y terminan distintos: alguien sube el del servidor, la
//  pantalla de Faltantes cambia, Inventario no, y las dos pantallas del mismo
//  sistema dejan de coincidir sobre qué falta. Eso es exactamente el defecto
//  que FR-017 viene a cerrar, así que reintroducirlo acá lo dejaría incumplido
//  sin que nada fallara.
//
//  Hay un test que verifica que este archivo no contiene el número del umbral.
//
//  ── Lo que NO se toca a propósito ──
//
//  `GET /api/alerts` y `services/dashboardService.js` siguen con la regla vieja
//  —exigen `min_stock > 0`, así que un producto sin mínimo cargado no alerta
//  nunca, ni estando en cero—. Es el riesgo 6 del plan: cambiarlas mueve un
//  número que el usuario mira todos los días desde el panel de control, y
//  FR-016 no las incluye. La consecuencia es que **Inventario va a mostrar más
//  productos en stock bajo que el panel de control**, y es a propósito.
// ════════════════════════════════════════════

/**
 * El límite por debajo del cual (o igual al cual) la fila está en falta.
 *
 * El mínimo cargado manda; el umbral general es solo para las filas que no
 * tienen ninguno. Un mínimo en 0 —el default de la columna— significa «no lo
 * cargaron», no «el mínimo es cero».
 *
 * @param {{min_stock?: number|string}} fila Una fila de `product.stock`.
 * @param {number} umbral El `umbral_stock_bajo` de `settings`.
 * @returns {number}
 */
export function limiteDeStockBajo(fila, umbral) {
  const minimo = Number(fila && fila.min_stock) || 0

  // Un mínimo negativo es dato roto: se trata como si no estuviera cargado.
  if (minimo > 0) return minimo

  const general = Number(umbral)

  // Sin umbral utilizable no se inventa uno: se cae a cero, que deja marcado
  // solo lo que está efectivamente en cero o en negativo. Es la degradación
  // silenciosa más chica posible — marcar de menos se nota al mirar la fila,
  // marcar de más con un número inventado hace que la pantalla mienta y nadie
  // lo pueda explicar.
  return Number.isFinite(general) ? general : 0
}

/**
 * Si esta fila de stock cuenta como «stock bajo».
 *
 * Es `<=` y no `<` porque la pregunta que contesta es «hay que reponerlo»: un
 * producto con mínimo 5 y cinco unidades ya llegó al mínimo. Es la misma
 * comparación que hace `GET /api/faltantes`.
 *
 * @param {{quantity?: number|string, min_stock?: number|string}} fila
 * @param {number} umbral
 * @returns {boolean}
 */
export function esStockBajo(fila, umbral) {
  const cantidad = Number(fila && fila.quantity) || 0

  return cantidad <= limiteDeStockBajo(fila, umbral)
}
