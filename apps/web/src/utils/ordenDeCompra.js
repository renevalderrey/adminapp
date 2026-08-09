// ════════════════════════════════════════════
//  FAVALIO · Los cuatro estados de una orden de compra, y lo que se decide con ellos
//
//  La lista de estados estaba escrita DOS veces —`pages/Orders.jsx:47` y
//  `pages/PurchaseOrders.jsx:51`— y con etiquetas que ya no eran iguales entre
//  sí. Es el mismo problema que tuvieron los medios de pago: dos copias de la
//  misma lista empiezan iguales y terminan distintas, y nada falla cuando una
//  etiqueta no está: se dibuja el código crudo. Así fue como `tc3` estuvo meses
//  a la vista del dueño sin que nadie lo viera.
//
//  Acá vive la única fuente del navegador (FR-107), y
//  `src/tests/estadosDeOrden.test.js` la ata contra el `ENUM` del modelo
//  (`apps/api/src/models/Supplier.js`) leyendo ese archivo como texto: si el
//  modelo gana un quinto estado, la pantalla lo dibujaría crudo y nadie lo vería.
//
//  ── Las tres cosas que no son obvias ──
//
//  1. `anulable: true` para `partial` es una decisión, no un descuido
//     ([PENDIENTE 9] de la spec): se puede anular una orden a medias, la deuda
//     de lo YA RECIBIDO queda viva —la mercadería llegó y se debe— y la
//     pantalla lo dice con el número antes de confirmar. Lo que no podía quedar
//     es sin escribir.
//
//  2. `porcentajeRecibido` es de UNIDADES y no de importe ([PENDIENTE 6]): es
//     lo único que el modelo guarda por línea. Con precios unitarios muy
//     distintos los dos números difieren mucho, y la etiqueta de la pantalla
//     dice de qué está hablando.
//
//  3. `tono` son nombres del sistema de diseño —`neutro`, `warn`, `ok`—, no
//     clases ni colores. Quién los traduce a tokens es la pantalla; que acá
//     hubiera un `text-…` ataría esta lista a un diseño y obligaría a tocarla
//     para cambiar un color.
// ════════════════════════════════════════════

/**
 * Los cuatro estados del `ENUM` de `supplier_orders`, con todo lo que la
 * pantalla decide a partir de uno.
 *
 * `recibible` y `anulable` están acá y no repartidos en condiciones adentro de
 * los componentes: hoy las dos pantallas preguntan
 * `status === 'pending' || status === 'partial'` en cinco lugares distintos, y
 * cada uno es una oportunidad de olvidarse de `partial`.
 */
export const ESTADOS = {
  pending: { etiqueta: 'Pendiente', tono: 'neutro', recibible: true, anulable: true },
  partial: { etiqueta: 'Recibida parcial', tono: 'warn', recibible: true, anulable: true },
  received: { etiqueta: 'Recibida', tono: 'ok', recibible: false, anulable: false },
  cancelled: { etiqueta: 'Anulada', tono: 'neutro', recibible: false, anulable: false },
}

/**
 * Los cuatro segmentos del control de arriba de la lista (FR-008).
 *
 * `estados: null` es «no filtra nada» y no «ningún estado»: «Todas» incluye
 * también las anuladas, que la tabla dibuja al 55 % de opacidad (FR-006). Si
 * las escondiera, anular una orden la haría desaparecer y el usuario no tendría
 * cómo comprobar que la anuló.
 */
export const SEGMENTOS = [
  { clave: 'todas', etiqueta: 'Todas', estados: null },
  { clave: 'pendientes', etiqueta: 'Pendientes', estados: ['pending'] },
  { clave: 'parciales', etiqueta: 'Parciales', estados: ['partial'] },
  { clave: 'recibidas', etiqueta: 'Recibidas', estados: ['received'] },
]

const ESTADOS_DEL_SEGMENTO = Object.fromEntries(
  SEGMENTOS.map((s) => [s.clave, s.estados])
)

/**
 * Las líneas de una orden, se llamen como se llamen.
 *
 * ⚠ El modelo guarda la columna `detail` (JSONB) y **la API la serializa como
 * `items`** (`purchaseService.js:599` y `:661`). Las dos formas circulan por la
 * web al mismo tiempo: `Orders.jsx` rearma `detail` a mano desde `items`, y el
 * listado que consume `PurchaseOrders.jsx` trae `items` pelado. Leer solo una
 * de las dos deja la barra de recepción en 0 % para siempre, sin que nada falle.
 */
function lineasDe(orden) {
  return orden?.detail || orden?.items || []
}

/**
 * Qué porcentaje de las unidades pedidas llegó, entre 0 y 100.
 *
 * Tres decisiones que se pagan si se toman al revés:
 *
 *  · **Una orden sin líneas da 0 y no 100.** El reflejo es escribirlo con un
 *    `.every`, y `[].every(...)` devuelve `true` por vacuidad: una orden vacía
 *    —o una a la que todavía no le llegó el detalle— se dibujaría con la barra
 *    llena y la etiqueta «recibida».
 *  · **Cada línea se recorta contra lo suyo**, no el total contra el total.
 *    Recibir 20 de un producto del que se pidieron 10 y 0 de otro del que se
 *    pidieron 10 es la mitad de la orden, no la orden entera; con el recorte
 *    global la barra diría 100 % y la mitad que falta no la vería nadie.
 *  · **Se redondea para abajo.** 199 unidades de 200 son 99 %: decir 100 % de
 *    algo que no llegó entero es exactamente el defecto que la barra existe
 *    para evitar.
 *
 * @param {{detail?: Array, items?: Array}} orden
 */
export function porcentajeRecibido(orden) {
  let pedido = 0
  let recibido = 0

  for (const linea of lineasDe(orden)) {
    const cantidad = Number(linea?.quantity) || 0

    // Una línea de cantidad cero o negativa no aporta denominador: sumarla no
    // cambia nada y dividir por ella da Infinity.
    if (cantidad <= 0) continue

    const llegado = Number(linea?.quantity_received) || 0

    pedido += cantidad
    recibido += Math.min(Math.max(llegado, 0), cantidad)
  }

  if (pedido <= 0) return 0

  return Math.floor((recibido / pedido) * 100)
}

/** Si a esta orden todavía se le puede recibir mercadería. */
export function esRecibible(orden) {
  return ESTADOS[orden?.status]?.recibible === true
}

/** Si esta orden se puede anular. Incluye las parciales: ver [PENDIENTE 9]. */
export function esAnulable(orden) {
  return ESTADOS[orden?.status]?.anulable === true
}

/**
 * Las órdenes que muestra un segmento con una búsqueda puesta.
 *
 * La búsqueda entra por **nombre de proveedor y por número de orden** (FR-009).
 * Buscar solo por proveedor obliga a recorrer la lista a ojo cuando lo que se
 * tiene a mano es el número —que es el dato que el proveedor menciona por
 * teléfono—.
 *
 * Un `segmento` desconocido no filtra por estado: una clave mal escrita tiene
 * que mostrar de más, nunca una lista vacía que se lee como «no hay órdenes».
 */
export function filtrarOrdenes(ordenes, { segmento = 'todas', busqueda = '' } = {}) {
  const estados = ESTADOS_DEL_SEGMENTO[segmento] ?? null

  // El `#` se saca porque la pantalla escribe «Orden #12» y quien copia el
  // número se lo lleva puesto.
  const texto = String(busqueda ?? '').trim().replace(/^#/, '').toLowerCase()

  return (ordenes || []).filter((orden) => {
    if (estados && !estados.includes(orden?.status)) return false

    if (!texto) return true

    const proveedor = String(orden?.supplier_name ?? '').toLowerCase()
    const numero = String(orden?.id ?? '')

    return proveedor.includes(texto) || numero.includes(texto)
  })
}

// ── Acá vivía `contadoresPorSegmento`, y se borró el 5/8/2026 ──
//
// Contaba cuántas órdenes muestra cada segmento aplicando `filtrarOrdenes` una
// vez por clave. Dejó de tener sentido cuando el listado pasó a paginarse en el
// servidor: **los cuatro contadores los cuenta la API** y `PurchaseOrders.jsx`
// los lee de la respuesta (`:583-591`, estado `contadores`). Contar en el
// navegador sobre la página cargada diría «3» arriba de un segmento con 300.
//
// Se borró **junto con sus dos tests**, y ese es el punto: seguía verde, así que
// la suite daba la impresión de estar cubriendo el contador del segmentado
// cuando el número que se dibuja sale de otro lado. Es el problema que persigue
// `apps/api/src/tests/todosLosTestsCorren.test.js` visto por el otro lado —allá
// un test que nunca corre, acá uno que corre sobre algo que ya no se dibuja—.
//
// ⚠ `filtrarOrdenes` quedó en la misma situación y NO se borró acá: su único
// llamador de producción era esta función, y hoy la búsqueda y el filtro por
// estado también los hace el servidor (`PurchaseOrders.jsx:103` y `:120` lo
// cuentan en pasado). Sus dos tests son los que quedan abajo. Está anotado para
// que se decida de una vez: o vuelve a usarse, o se va con ellos.
