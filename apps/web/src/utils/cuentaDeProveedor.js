// ════════════════════════════════════════════
//  FAVALIO · El estado de la cuenta de un proveedor, y su color
//
//  Son los cuatro estados del legacy (`:7522`), que es lo que Comprafit leyó
//  durante años, y la regla detrás del badge de deuda del listado (FR-055).
//
//  ── Qué NO se hace acá ──
//
//  **No se suma plata.** Los tres números —`deuda`, `pagado` y `saldo`— llegan
//  calculados por `resumenDeCuenta` de la API, que suma en centavos enteros
//  (decisión 3 y FR-101). Acá solo se los clasifica.
//
//  Es deliberado que este archivo NO recalcule `saldo = deuda − pagado` cuando
//  el saldo no viene: sería la segunda suma que FR-101 prohíbe, escrita en
//  punto flotante, y el residuo de `1234.5600000000002` es exactamente lo que
//  convierte una cuenta cancelada en una cuenta con deuda sin que nada falle.
//  Una sola fuente para el saldo, y es el servidor.
//
//  ── Por qué el color se decide acá y no lo manda la API ──
//
//  Mismo criterio que `estadoVenta.js`: el significado lo decide el servidor,
//  la paleta sale de `docs/REGLAS-DISENO.md`. Si la API devolviera un
//  hexadecimal, cambiar la paleta obligaría a tocar el backend.
// ════════════════════════════════════════════

/**
 * Los cuatro estados con su etiqueta, tal cual la tabla de la spec.
 *
 * Las claves son los códigos que devuelve `estadoDeProveedor`; los textos, lo
 * que se lee en el badge. Están juntos para que agregar un quinto estado sin su
 * etiqueta sea imposible: el badge dibujaría el código crudo, que es lo que ya
 * pasó con `tc3` en los comprobantes.
 */
export const ETIQUETAS = {
  sin_movimientos: 'Sin movimientos',
  saldado: 'Saldado',
  pago_parcial: 'Pago parcial',
  con_deuda: 'Con deuda',
}

/**
 * Los tonos de cada estado: línea, fondo y texto, **juntos**.
 *
 * Copia el molde de `tonoDeStock` (`utils/inventario.js:221`) y no la función:
 * las clases del stock no son las del saldo. Lo que se copia es la forma —las
 * tres clases en un solo string, todas salidas de tokens de `index.css`—
 * porque un color de estado suelto sobre el fondo de la tarjeta se lee como un
 * error de estilo (FR-056, REGLAS-DISENO).
 */
const TONOS = {
  // Neutro: no hay nada que informar todavía. El mismo trío que usa el badge
  // de stock en su caso «está bien», para que «no pasa nada» se vea igual en
  // las dos pantallas.
  sin_movimientos: 'border-border bg-surface-3 text-fg-2',
  saldado: 'border-ok-line bg-ok-soft text-ok',
  pago_parcial: 'border-warn-line bg-warn-soft text-warn',
  con_deuda: 'border-danger-line bg-danger-soft text-danger',
}

/**
 * Un número, venga como número o como el string que devuelve un DECIMAL.
 *
 * ⚠ **No es defensivo de más: es el caso normal.** Postgres devuelve DECIMAL
 * como texto y Sequelize lo pasa tal cual (US6 escenario 7). Sin esta
 * conversión, un proveedor sin un solo movimiento llega con
 * `deuda: '0.00'`, y `'0.00' === 0` es `false`: la primera condición no
 * matchea, la cuenta cae en `saldo <= 0` —porque `'0.00' <= 0` sí es `true`
 * por coerción— y el badge dice «Saldado» a alguien a quien nunca se le
 * compró nada.
 */
function aNumero(valor) {
  return Number(valor) || 0
}

/**
 * Cuál de los cuatro estados describe esta cuenta.
 *
 * @param {{deuda?: number|string, pagado?: number|string, saldo?: number|string}} cuenta
 *   Los tres números tal cual los devuelve `GET /suppliers`.
 * @returns {'sin_movimientos'|'saldado'|'pago_parcial'|'con_deuda'}
 *
 * El orden de las condiciones es la tabla de la spec y no se puede reordenar:
 * «Sin movimientos» tiene que ganar antes de mirar el saldo, porque una cuenta
 * vacía también tiene saldo cero y si no, diría «Saldado».
 */
export function estadoDeProveedor({ deuda, pagado, saldo } = {}) {
  const deudaTotal = aNumero(deuda)
  const pagadoTotal = aNumero(pagado)
  const saldoActual = aNumero(saldo)

  if (deudaTotal === 0 && pagadoTotal === 0) return 'sin_movimientos'

  // ⚠ `<= 0` y no `=== 0`, a propósito y por los DOS lados. Con `=== 0`, un
  // pago mayor que la deuda —un adelanto: el proveedor me debe a mí— caería en
  // «Pago parcial», que es mentira (US6 escenario 6). Con `< 0`, una deuda que
  // se compensa exactamente diría «Con deuda» teniendo saldo cero, que es el
  // criterio de éxito 8. Saldado es «no le debo nada», y eso incluye el cero.
  if (saldoActual <= 0) return 'saldado'

  // Queda saldo, así que la única pregunta es si hubo algún pago a cuenta.
  if (pagadoTotal > 0) return 'pago_parcial'

  return 'con_deuda'
}

/**
 * Las tres clases del badge de un estado, en un solo string.
 *
 * Un código desconocido cae en el tono neutro en vez de devolver `undefined`:
 * una fila con el badge sin pintar es un bug visible, un `className` con
 * `undefined` adentro es una pantalla rota.
 */
export function tonoDeProveedor(estado) {
  return TONOS[estado] || TONOS.sin_movimientos
}
