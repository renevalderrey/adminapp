import { precioTexto } from './formato.js'

// ════════════════════════════════════════════
//  Las reglas del checkout, separadas de su dibujo
//
//  Qué opciones se ofrecen, qué falta para poder avanzar y qué textos van: todo
//  eso es lógica y se prueba sin montar nada. La pantalla las aplica.
//
//  ── La puerta de FR-147a ──
//
//  `PUERTA_DE_DATOS_PERSONALES` está en `false` y **no se dibuja lo que tapa**:
//  ni el campo de DNI ni la casilla de marketing. No deshabilitados —dibujados
//  en gris—, sino **ausentes**.
//
//  El motivo no es de producto: Favalio todavía no tiene publicados sus Términos
//  ni su Política de Privacidad, y pedir un documento de identidad o un
//  consentimiento de comunicaciones sin esos textos es juntar un dato personal
//  sin base para tenerlo. Del otro lado el servidor **los descarta aunque
//  vengan** (`utils/pedidoPublico.js`), así que la puerta está cerrada de los dos
//  lados: si alguien dibuja el campo, el dato igual no se guarda.
//
//  Cuando la puerta se abra, la casilla arranca **desmarcada** y **no es
//  condición para comprar** (FR-145).
// ════════════════════════════════════════════

export const PUERTA_DE_DATOS_PERSONALES = false

export const PASOS = ['datos', 'entrega', 'pago']

/**
 * Las opciones de entrega que este catálogo tiene encendidas (FR-141).
 *
 * Se arman desde el bloque `entrega` que devolvió la API. Ofrecer una que el
 * comercio no hace termina en un pedido que no puede cumplir, y el que da la
 * cara es el gimnasio.
 *
 * ⚠ Esta es la lista **cruda**. La que se dibuja es `opcionesDeEntrega`, que le
 * saca las que no se pueden pagar.
 */
function entregasEncendidas(catalogo = {}) {
  const e = catalogo.entrega || {}
  const opciones = []

  if (e.retiro_socio === true) {
    opciones.push({
      clave: 'retiro_socio',
      titulo: 'Retiro en el gimnasio',
      detalle: e.retiro_socio_direccion || 'Coordinamos el día con vos.',
      costo: 'Gratis',
    })
  }

  if (e.retiro_local === true) {
    opciones.push({
      clave: 'retiro_local',
      titulo: 'Retiro en el local',
      detalle: 'Pasás a buscarlo cuando esté listo.',
      costo: 'Gratis',
    })
  }

  if (e.envio === true) {
    // El umbral se anuncia acá, donde se elige, y no después: enterarse del
    // envío gratis en la pantalla siguiente es enterarse tarde.
    const umbral = Number(e.envio_gratis_desde) > 0
      ? ` · gratis desde ${precioTexto(e.envio_gratis_desde)}`
      : ''

    opciones.push({
      clave: 'envio',
      titulo: 'Envío a domicilio',
      detalle: `Te lo llevamos${umbral}`,
      costo: precioTexto(e.envio_costo),
    })
  }

  if (e.coordinar_whatsapp === true) {
    opciones.push({
      clave: 'coordinar',
      titulo: 'A coordinar por WhatsApp',
      detalle: 'Nos escribimos y lo arreglamos.',
      costo: '',
    })
  }

  return opciones
}

/**
 * Las entregas que se ofrecen de verdad: encendidas **y pagables**.
 *
 * ⚠ Una entrega sin ningún medio de pago es un callejón sin salida, y el
 * comprador lo descubre en el último paso, con el formulario ya lleno. Pasó de
 * verdad: un catálogo con envío encendido y sin CBU cargado dejaba «efectivo»
 * como única forma de pago, y con envío a domicilio el efectivo no se ofrece
 * (FR-142). El paso 3 quedaba vacío.
 *
 * No ofrecerla es mejor que ofrecerla y frenar después: el comprador elige otra
 * y compra igual. El servidor además lo frena al **publicar**, que es donde el
 * comercio lo puede arreglar; esto es la red para el catálogo que ya estaba
 * publicado cuando le apagaron la transferencia.
 */
export function opcionesDeEntrega(catalogo = {}) {
  return entregasEncendidas(catalogo)
    .filter((o) => opcionesDePago(catalogo, o.clave).length > 0)
}

/**
 * Las opciones de pago, que dependen de la entrega elegida.
 *
 * ⚠ **«Efectivo al retirar» no se ofrece con envío a domicilio** (FR-142). No es
 * un detalle: quien elige las dos cosas está pidiendo que le lleven el pedido a
 * la casa y pagarlo al retirarlo en un local al que no va a ir. El pedido entra,
 * el comercio lo prepara, y el malentendido aparece en la puerta.
 */
export function opcionesDePago(catalogo = {}, entrega) {
  const p = catalogo.pagos || {}
  const opciones = []

  if (p.transferencia === true) {
    opciones.push({
      clave: 'transferencia',
      titulo: 'Transferencia bancaria',
      detalle: 'Te pasamos los datos en el paso siguiente.',
    })
  }

  if (p.efectivo === true && entrega !== 'envio') {
    opciones.push({
      clave: 'efectivo',
      titulo: 'Efectivo al retirar',
      detalle: 'Lo pagás cuando lo buscás.',
    })
  }

  return opciones
}

const vacio = (v) => !String(v || '').trim()

/**
 * Qué falta para poder salir de este paso, o `null` si no falta nada.
 *
 * Los pasos 2 y 3 **no se pueden saltear** (FR-149b): el pedido necesita entrega
 * y medio de pago, y los dos son del catálogo, no del comprador.
 *
 * @returns {{campo: string, mensaje: string}|null}
 */
export function faltaDelPaso(paso, formulario = {}, catalogo = {}) {
  if (paso === 'datos') {
    // **Nombre y teléfono, y nada más** (FR-149). El email es opcional a
    // propósito: el aviso por mail es un extra, y exigirlo pierde al comprador
    // que no quiere dejarlo.
    if (vacio(formulario.nombre)) return { campo: 'nombre', mensaje: 'Escribí tu nombre.' }

    const digitos = String(formulario.telefono || '').replace(/\D/g, '')
    if (digitos.length < 6) return { campo: 'telefono', mensaje: 'Escribí un teléfono donde te podamos avisar.' }

    return null
  }

  if (paso === 'entrega') {
    const validas = opcionesDeEntrega(catalogo).map((o) => o.clave)
    if (!validas.includes(formulario.entrega)) {
      return { campo: 'entrega', mensaje: 'Elegí cómo lo querés recibir.' }
    }

    if (formulario.entrega === 'envio') {
      if (vacio(formulario.envio_direccion)) return { campo: 'envio_direccion', mensaje: 'Falta la dirección.' }
      if (vacio(formulario.envio_localidad)) return { campo: 'envio_localidad', mensaje: 'Falta la localidad.' }
      if (vacio(formulario.envio_cp)) return { campo: 'envio_cp', mensaje: 'Falta el código postal.' }
    }

    return null
  }

  if (paso === 'pago') {
    const validos = opcionesDePago(catalogo, formulario.entrega).map((o) => o.clave)
    if (!validos.includes(formulario.medio_pago)) {
      return { campo: 'medio_pago', mensaje: 'Elegí cómo vas a pagar.' }
    }
    return null
  }

  return null
}

/**
 * El cuerpo que se manda a `POST /c/:slug/pedidos`.
 *
 * ⚠ Lleva **`product_id` y `cantidad`** de cada línea y nada más: ningún precio
 * viaja, ni siquiera para que el servidor lo ignore (FR-130). Y del comprador
 * viaja lo que el formulario tiene, que —con la puerta cerrada— no incluye ni
 * DNI ni consentimiento porque esos campos no existen.
 */
export function cuerpoDelPedido(formulario = {}, lineas = [], idempotencyKey) {
  const comprador = {
    nombre: String(formulario.nombre || '').trim(),
    telefono: String(formulario.telefono || '').trim(),
    entrega: formulario.entrega,
    medio_pago: formulario.medio_pago,
  }

  if (formulario.email) comprador.email = String(formulario.email).trim()
  if (formulario.nro_socio) comprador.nro_socio = String(formulario.nro_socio).trim()
  if (formulario.notas) comprador.notas = String(formulario.notas).trim()

  if (formulario.entrega === 'envio') {
    comprador.envio_direccion = String(formulario.envio_direccion || '').trim()
    comprador.envio_localidad = String(formulario.envio_localidad || '').trim()
    comprador.envio_cp = String(formulario.envio_cp || '').trim()
  }

  return {
    idempotency_key: idempotencyKey,
    items: lineas.map(({ product_id, cantidad }) => ({ product_id, cantidad })),
    comprador,
  }
}

/**
 * La clave que hace que tocar «Confirmar» dos veces cree **un** pedido.
 *
 * Se genera **una sola vez por intento** y sobrevive a los reintentos: si se
 * generara en cada envío, el segundo toque tendría una clave nueva y el servidor
 * lo tomaría como un pedido distinto — que es exactamente el defecto que la
 * clave existe para evitar.
 *
 * `crypto.randomUUID` no existe en contextos sin HTTPS (un teléfono viejo
 * entrando por IP), y ahí la tienda no puede caerse: hay un respaldo.
 */
export function claveDeIntento() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
  } catch {
    /* Sigue por el respaldo. */
  }

  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
