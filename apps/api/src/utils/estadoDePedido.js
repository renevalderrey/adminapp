// ════════════════════════════════════════════
//  Por dónde puede pasar un pedido
//
//  Los seis estados y las transiciones permitidas, como función pura. El handler
//  que cambia el estado no decide: pregunta acá.
//
//  ── Por qué `pagado → pagado` NO está permitida ──
//
//  Es lo que hace que «marcar cobrado» sea **idempotente por construcción**.
//  Tocar el botón dos veces —o que el teléfono reintente— manda dos requests; el
//  segundo encuentra el pedido ya en `pagado`, la transición no existe, y se
//  rechaza. Sin clave de idempotencia, sin ventana de tiempo, sin contar
//  requests: no hay estado desde el que la segunda pasada sea legal.
//
//  Cuando exista el descuento de stock (etapa 3), esto es lo único que impide
//  que un pedido descuente el stock dos veces.
//
//  ── `cancelado` es terminal ──
//
//  De `cancelado` no se sale. Un pedido cancelado que vuelve a `en_preparacion`
//  es un pedido que el comercio ya le dijo al cliente que no existía.
//  Rehabilitar se hace creando otro.
// ════════════════════════════════════════════

const ESTADOS = [
  'pendiente_pago',
  'pagado',
  'en_preparacion',
  'listo',
  'entregado',
  'cancelado',
];

/**
 * A dónde puede ir cada estado.
 *
 * `cancelado` está en casi todos porque un pedido se puede caer en cualquier
 * momento antes de entregarse. No está en `entregado`: lo que ya salió del local
 * no se cancela, se devuelve, y una devolución es otra cosa que todavía no
 * existe.
 */
const TRANSICIONES = {
  pendiente_pago: ['pagado', 'en_preparacion', 'cancelado'],
  pagado: ['en_preparacion', 'listo', 'entregado', 'cancelado'],
  en_preparacion: ['listo', 'entregado', 'cancelado'],
  listo: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

const esEstado = (estado) => ESTADOS.includes(estado);

/**
 * ¿Se puede pasar de `desde` a `hacia`?
 *
 * Un estado desconocido de cualquiera de los dos lados es `false`, no una
 * excepción: el que llama es un handler con datos de la red.
 */
function puedeTransicionar(desde, hacia) {
  if (!esEstado(desde) || !esEstado(hacia)) return false;
  return TRANSICIONES[desde].includes(hacia);
}

/**
 * La transición, con el motivo por el que no se puede cuando no se puede.
 *
 * El motivo es un código, no una frase: la pantalla lo traduce y el test lo
 * afirma sin depender de la redacción.
 *
 * @returns {{ok: true} | {ok: false, error: string, mensaje: string}}
 */
function validarTransicion(desde, hacia) {
  if (!esEstado(hacia)) {
    return { ok: false, error: 'ESTADO_INVALIDO', mensaje: `«${hacia}» no es un estado de pedido.` };
  }

  if (!esEstado(desde)) {
    return { ok: false, error: 'ESTADO_INVALIDO', mensaje: `«${desde}» no es un estado de pedido.` };
  }

  if (desde === hacia) {
    return {
      ok: false,
      error: 'SIN_CAMBIO',
      mensaje: 'El pedido ya está en ese estado.',
    };
  }

  if (TRANSICIONES[desde].length === 0) {
    return {
      ok: false,
      error: 'ESTADO_TERMINAL',
      mensaje: `Un pedido ${desde === 'cancelado' ? 'cancelado' : 'entregado'} no cambia de estado.`,
    };
  }

  if (!TRANSICIONES[desde].includes(hacia)) {
    return {
      ok: false,
      error: 'TRANSICION_NO_PERMITIDA',
      mensaje: `No se puede pasar de «${desde}» a «${hacia}».`,
    };
  }

  return { ok: true };
}

/** Los estados a los que se puede ir desde acá. La pantalla dibuja estos botones y no más. */
const transicionesDesde = (estado) => (esEstado(estado) ? [...TRANSICIONES[estado]] : []);

module.exports = {
  ESTADOS,
  TRANSICIONES,
  esEstado,
  puedeTransicionar,
  validarTransicion,
  transicionesDesde,
};
