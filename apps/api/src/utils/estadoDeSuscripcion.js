// ════════════════════════════════════════════
//  FAVALIO · Los cinco estados de una suscripcion
//
//  Este switch vivia adentro de `middleware/checkSubscription.js` y ahi estaba
//  bien mientras hubo un solo camino que lo miraba. El catalogo publico —una
//  pagina que se abre sin login— tambien tiene que saber si la suscripcion del
//  comercio esta al dia, y copiar el switch hubiera dejado **dos** listas de
//  estados: el dia que el enum de `models/Suscripcion.js` sume un sexto valor,
//  una de las dos se olvida, y el olvido se paga en cualquiera de las dos
//  direcciones —un catalogo publico vendiendo por una empresa vencida, o una
//  caja cortada para una empresa que pago—.
//
//  Por eso la regla vive aca y los dos caminos la llaman. Es lo que hace
//  verificable FR-110: no hay una segunda lista, hay UNA.
//
//  ── ⚠ La asimetria que esta funcion NO decide, y que es deliberada ──
//
//  Aca se contesta «¿esta suscripcion bloquea?». NO se contesta «¿que hago si
//  no la pude consultar?», y en esa segunda pregunta los dos llamadores hacen
//  cosas **distintas a proposito**:
//
//   · `middleware/checkSubscription.js` (cadena privada) **deja pasar**: su
//     catch loguea y llama a `next()`. Un hipo de la base no puede tumbar la
//     caja de un comercio que ya pago.
//
//   · `routes/catalogoPublico.js` (camino publico, FR-112a) **cierra con
//     503**. Es una superficie sin login: ahi dejar pasar significa vender en
//     nombre de una empresa que quiza esta vencida. Y responde **503 y no
//     402** porque el 402 afirmaria que la suscripcion vencio, y lo que paso
//     es que **no se pudo saber**.
//
//  Los dos comentarios son gemelos: el otro esta sobre el `catch` de
//  `checkSubscription.js`. Si alguien llega hasta aca a «unificar» esa
//  inconsistencia — no es una inconsistencia, es la decision.
// ════════════════════════════════════════════

/**
 * Los cinco valores del enum de `models/Suscripcion.js`, en una sola lista.
 *
 * Se exporta para que el llamador pueda registrar un estado fuera del enum
 * **sin escribir una segunda lista**: el log queda en cada camino porque el
 * contexto util para investigarlo es distinto (la empresa de la sesion en la
 * cadena privada; el slug y la empresa en el publico, FR-112a), pero la lista
 * contra la que se compara sale de este archivo, que es el mismo donde esta el
 * `switch`.
 */
const ESTADOS_CONOCIDOS = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

/** El motivo del caso por defecto. Nombrado para que el test lo pueda anclar. */
const MOTIVO_ESTADO_DESCONOCIDO = 'No pudimos verificar el estado de tu suscripción.';

/**
 * Si la suscripcion bloquea el acceso, y por que.
 *
 * Antes solo se contemplaban 'expired' y 'trialing'. Los otros dos estados del
 * enum pasaban de largo:
 *   - 'cancelled' no bloqueaba nada, asi que cancelar dejaba el acceso abierto
 *     para siempre.
 *   - 'past_due' tampoco, con lo cual una suscripcion impaga seguia
 *     funcionando hasta que el cron la pasara a 'expired'.
 *
 * ⚠ `motivo` es el que **corresponderia** si bloqueara, y viene lleno tambien
 * en algunos casos que no bloquean (un trial vigente ya trae «Terminó tu
 * período de prueba»). Se lee solo cuando `bloqueado` es `true`; no sirve como
 * senal de nada por si mismo.
 *
 * @param {{ status?: string, trial_ends_at?: Date|null, grace_period_ends?: Date|null }|null} sub
 * @param {Date} ahora
 * @returns {{ bloqueado: boolean, motivo: string|null }}
 */
function evaluarSuscripcion(sub, ahora) {
  // Defensivo. «Sin fila de suscripcion» no es un estado transitorio sino un
  // dato inconsistente —toda empresa se crea con suscripcion en el
  // onboarding—, y fue el agujero que dejaba acceso ilimitado y gratis. Cada
  // llamador lo resuelve **antes** de llegar aca, con su propia redaccion (402
  // SIN_SUSCRIPCION en la cadena privada, `no_disponible` en el publico), asi
  // que este `return` no deberia alcanzarse nunca; si se alcanza, bloquea, que
  // es el lado seguro.
  if (!sub) {
    return { bloqueado: true, motivo: null };
  }

  const graciaVencida = !sub.grace_period_ends || sub.grace_period_ends < ahora;

  let bloqueado = false;
  let motivo = null;

  switch (sub.status) {
    case 'expired':
      bloqueado = true;
      motivo = 'Tu suscripción venció.';
      break;

    case 'trialing':
      // Durante el trial y su periodo de gracia el acceso sigue abierto.
      bloqueado = sub.trial_ends_at && sub.trial_ends_at < ahora && graciaVencida;
      motivo = 'Terminó tu período de prueba.';
      break;

    case 'past_due':
    case 'cancelled':
      // Se respeta el periodo ya pagado y despues se corta.
      bloqueado = graciaVencida;
      motivo = sub.status === 'cancelled'
        ? 'Tu suscripción fue cancelada.'
        : 'Tu suscripción tiene un pago pendiente.';
      break;

    case 'active':
      bloqueado = false;
      break;

    default:
      // Un estado desconocido es un error de datos: se bloquea. El log lo pone
      // el llamador, con el contexto que a el le sirve.
      bloqueado = true;
      motivo = MOTIVO_ESTADO_DESCONOCIDO;
  }

  // `Boolean` y no el valor crudo: en 'trialing' el `&&` devuelve `null`
  // cuando `trial_ends_at` viene vacio. Al middleware le daba igual —hacia
  // `if (bloqueado)`— pero una funcion compartida que promete un booleano y
  // devuelve `null` es una trampa para el segundo llamador, que va a
  // serializar esto en una respuesta JSON. No cambia ninguna decision: solo
  // fija el tipo.
  return { bloqueado: Boolean(bloqueado), motivo };
}

module.exports = { evaluarSuscripcion, ESTADOS_CONOCIDOS, MOTIVO_ESTADO_DESCONOCIDO };
