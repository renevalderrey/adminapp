// ════════════════════════════════════════════
//  FAVALIO · El vuelto del mostrador
//
//  Estas dos cuentas vivían adentro de un `useMemo` de `Billing.jsx`, donde
//  ningún test las alcanzaba: FR-018 daba por conservadas las sugerencias de
//  billetes sin que existiera nada que lo garantizara. Es aritmética con plata,
//  y CONVENCIONES obliga a probarla con casos de borde.
//
//  ⚠ Al moverlas se encontró que el comentario que las acompañaba decía algo
//  distinto de lo que hacía el código: afirmaba que con un total de $47.300 se
//  proponen $50.000, $60.000 y $100.000, y lo que se propone de verdad es
//  $48.000, $50.000 y $60.000 —el escalón de $1.000 produce el primero—. Se
//  conserva el COMPORTAMIENTO, que es lo que pide FR-018 («tal como está hoy»),
//  y se corrige el comentario. `utils/vuelto.test.js` fija los tres valores
//  reales para que la próxima vez la diferencia salte acá y no en el mostrador.
// ════════════════════════════════════════════

/**
 * Los escalones «de bolsillo» con los que se redondea el total hacia arriba.
 *
 * No son los billetes que existen: son las cifras con las que alguien paga.
 * Proponer $47.400 para un total de $47.300 no le sirve a nadie.
 */
const ESCALONES = [1000, 5000, 10000, 20000, 50000, 100000]

/** Cuántas sugerencias entran en la fila del pie de cobro. */
const CUANTAS = 3

/**
 * Los importes con los que más probablemente pague el cliente.
 *
 * Ninguno puede ser menor o igual al total: un billete que no alcanza no es una
 * sugerencia, y uno igual al total es «pagó justo», que no necesita botón.
 *
 * @param {number} total
 * @returns {number[]} Hasta tres importes, de menor a mayor.
 */
export function sugerenciasDeVuelto(total) {
  const importe = Number(total)
  if (!Number.isFinite(importe) || importe <= 0) return []

  const montos = new Set()

  for (const escalon of ESCALONES) {
    const redondeado = Math.ceil(importe / escalon) * escalon

    // `>` y no `>=`: con un total que ya es un escalón exacto —$50.000— el
    // redondeo devuelve el mismo $50.000, y proponer «pagá $50.000» cuando el
    // total es $50.000 ocupa un botón para no decir nada.
    if (redondeado > importe) montos.add(redondeado)
  }

  return [...montos].sort((a, b) => a - b).slice(0, CUANTAS)
}

/**
 * Cuánto vuelto va, o cuánto falta.
 *
 * Devuelve las dos cosas separadas y nunca un número negativo. Mostrar
 * «−$3.200» obliga al operador a interpretar un signo en el momento en que
 * tiene la mano en la caja; «faltan $3.200» se lee de una (escenario 5.10).
 *
 * @param {number|string} pagaCon Lo que el operador escribió. Puede venir vacío.
 * @param {number} total
 * @returns {{vuelto: number, falta: number}} Uno de los dos siempre es 0.
 */
export function calcularVuelto(pagaCon, total) {
  // El campo puede quedar vacío a propósito —un 0 obligaría a borrarlo antes de
  // tipear—, así que llega como texto. Cualquier cosa que no sea un número se
  // trata como 0: un `NaN` acá se dibuja como «$NaN» y no rompe nada.
  const entregado = Number(pagaCon)
  const cobrado = Number(total)

  const recibido = Number.isFinite(entregado) ? entregado : 0
  const aCobrar = Number.isFinite(cobrado) ? cobrado : 0

  const diferencia = Math.round((recibido - aCobrar) * 100) / 100

  return diferencia >= 0
    ? { vuelto: diferencia, falta: 0 }
    : { vuelto: 0, falta: Math.abs(diferencia) }
}
