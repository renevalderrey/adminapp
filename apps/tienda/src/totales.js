// ════════════════════════════════════════════
//  Los importes que se muestran, y de dónde salen
//
//  ── La tienda no calcula precios (H2) ──
//
//  Ni uno. El precio de cada producto lo resolvió el servidor con las reglas del
//  catálogo (`utils/reglasDePrecio.js`) y llegó ya resuelto en `precio`. Acá se
//  **multiplica por la cantidad y se suma**, que es aritmética de carrito, no
//  formación de precio: no hay margen, no hay descuento, no hay regla.
//
//  La diferencia importa y es la que prueba `totales.test.js`: con una regla de
//  precio fijo, `precio` y `precio_lista` son números distintos, y sumar el que
//  no corresponde da un total que el servidor va a desmentir en el paso
//  siguiente. El único total que vale es el que devuelve `POST …/pedidos`, y es
//  el que muestra la confirmación.
//
//  ── El envío sí es una regla portada, y se dice ──
//
//  `envioDelPedido` es la misma regla que `apps/api/src/utils/totalDePedido.js`:
//  gratis con `subtotal >= umbral`, umbral nulo o cero significa «no hay envío
//  gratis», y sólo se cobra con entrega a domicilio. Está portada —igual que
//  `normalizarTexto` en `formato.js`— porque el comprador tiene que ver el costo
//  del envío **antes** de mandar el pedido, y la única forma de no portarla sería
//  una llamada por cada cambio de opción.
//
//  Lo que la mantiene honesta: el servidor recalcula igual y **su número es el
//  que se guarda**. Si estas dos se separan, lo que ve el comprador cambia en la
//  confirmación, que es visible; no es un error silencioso.
// ════════════════════════════════════════════

/** La suma de las líneas, con el precio que ya resolvió el servidor. */
export const subtotalDelCarrito = (lineas = []) =>
  lineas.reduce((suma, l) => suma + (Number(l.precio) || 0) * (Number(l.cantidad) || 0), 0)

/**
 * Cuánto sale el envío para esta entrega, y si salió gratis.
 *
 * @param {object} entrega El bloque `entrega` del catálogo público.
 * @param {string} elegida `retiro_socio` | `retiro_local` | `envio` | `coordinar`.
 */
export function envioDelPedido(entrega = {}, elegida, subtotal = 0) {
  // Sólo con envío a domicilio **y** con el envío habilitado. Un cargo de envío
  // en un pedido que se retira es plata que el comprador reclama y que nadie
  // sabe explicar.
  if (elegida !== 'envio' || entrega.envio !== true) return { costo: 0, gratis: false }

  const umbral = entrega.envio_gratis_desde
  // Nulo, indefinido o cero significan **«no hay envío gratis»**. Al revés, con
  // `subtotal >= 0` todo pedido viajaría gratis.
  const hayUmbral = umbral !== null && umbral !== undefined && Number(umbral) > 0

  // `>=` y no `>`: «envío gratis desde $50.000» incluye los $50.000, que es lo
  // que dice el cartel.
  const gratis = hayUmbral && subtotal >= Number(umbral)

  return { costo: gratis ? 0 : Number(entrega.envio_costo) || 0, gratis }
}

/** Cuánto falta para el envío gratis, o `null` si no hay umbral o ya se llegó. */
export function faltaParaElEnvioGratis(entrega = {}, subtotal = 0) {
  const umbral = entrega.envio_gratis_desde
  if (entrega.envio !== true) return null
  if (umbral === null || umbral === undefined || !(Number(umbral) > 0)) return null

  const falta = Number(umbral) - subtotal
  return falta > 0 ? falta : null
}

/** Los tres números que dibuja el pie del carrito y el paso de pago. */
export function totalesDelPedido(lineas, entrega, elegida) {
  const subtotal = subtotalDelCarrito(lineas)
  const envio = envioDelPedido(entrega, elegida, subtotal)

  return { subtotal, envio: envio.costo, envio_gratis: envio.gratis, total: subtotal + envio.costo }
}
