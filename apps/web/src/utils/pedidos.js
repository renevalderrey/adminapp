// ════════════════════════════════════════════
//  Los nombres y los tonos de un pedido
//
//  Funciones puras, separadas de la pantalla por el mismo motivo que
//  `utils/catalogos.js`: qué dice cada estado y de qué color se dibuja son
//  decisiones que se prueban sin montar un componente.
//
//  ── El formato del número está en SEIS lugares ──
//
//  `#1042`. El numeral es de presentación y **no se guarda**; el formato tiene
//  que ser el mismo en la confirmación de la tienda, en esta bandeja, en el panel
//  lateral, en los dos emails y en el mensaje de WhatsApp (FR-137b). Si el panel
//  dijera `1042` y el WhatsApp `#1042`, el comprador que llama diciendo «mi
//  pedido numeral mil cuarenta y dos» y el vendedor que busca «1042» estarían
//  hablando de lo mismo sin darse cuenta.
//
//  El servidor lo escribe con `@favalio/pedido`, que `apps/web` **no puede**
//  importar sin declararlo: son dos líneas y la copia está atada por su test.
// ════════════════════════════════════════════

export const ESTADOS_DE_PEDIDO = [
  'pendiente_pago',
  'pagado',
  'en_preparacion',
  'listo',
  'entregado',
  'cancelado',
]

const ETIQUETAS = {
  pendiente_pago: 'Pendiente',
  pagado: 'Pagado',
  en_preparacion: 'En preparación',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

/**
 * Los tonos, con los tokens del sistema y ningún hexadecimal.
 *
 * `pendiente_pago` va en aviso y no en error: que un pedido esté esperando el
 * pago **no es un problema**, es el estado normal del que acaba de entrar.
 * Pintarlo de rojo haría que una bandeja sana se vea como una bandeja rota.
 */
const TONOS = {
  pendiente_pago: 'bg-warn-soft text-warn',
  pagado: 'bg-ok-soft text-ok',
  en_preparacion: 'bg-info-soft text-info',
  listo: 'bg-info-soft text-info',
  entregado: 'bg-surface-3 text-fg-2',
  cancelado: 'bg-surface-3 text-fg-3',
}

export const etiquetaDeEstadoDePedido = (estado) => ETIQUETAS[estado] || estado
export const tonoDeEstadoDePedido = (estado) => TONOS[estado] || 'bg-surface-3 text-fg-2'

/** `#1042`. Ver el encabezado. */
export const numeroDePedido = (numero) => `#${numero}`

const ENTREGAS = {
  retiro_socio: 'Retiro en el gimnasio',
  retiro_local: 'Retiro en el local',
  envio: 'Envío a domicilio',
  coordinar: 'A coordinar por WhatsApp',
}

const PAGOS = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo al retirar',
}

export const etiquetaDeEntrega = (clave) => ENTREGAS[clave] || clave
export const etiquetaDePago = (clave) => PAGOS[clave] || clave

/**
 * El verbo del botón para cada transición.
 *
 * Las transiciones **las decide el servidor** y llegan en la respuesta; acá sólo
 * se les pone nombre. Si esta pantalla decidiera cuáles ofrecer, serían dos
 * reglas para lo mismo y la de acá ofrecería lo que la otra rechaza.
 */
const VERBOS = {
  pagado: 'Marcar cobrado',
  en_preparacion: 'Preparar',
  listo: 'Marcar listo',
  entregado: 'Marcar entregado',
  cancelado: 'Cancelar pedido',
}

export const verboDeTransicion = (estado) => VERBOS[estado] || etiquetaDeEstadoDePedido(estado)

/** La dirección de envío en un renglón, o `null` si el pedido no se envía. */
export function direccionDelPedido(pedido = {}) {
  if (pedido.entrega !== 'envio') return null

  const partes = [pedido.envio_direccion, pedido.envio_localidad, pedido.envio_cp].filter(Boolean)
  return partes.length ? partes.join(', ') : null
}
