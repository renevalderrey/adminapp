// ════════════════════════════════════════════
//  ADMINAPP · TiendaNube · el backoff, la clasificación del error y qué empujar
//
//  Tres funciones puras. Acá no hay red ni base: el backoff es aritmética, la
//  clasificación son ramas sobre un objeto de axios, y «hay que empujar» es una
//  comparación de dos números. Lo que hace red vive en
//  `services/tiendanubeSincronizacion.js` y se prueba en integración.
//
//  ── Por qué la clasificación es una función y no un `switch` en la pantalla ──
//
//  Un fallo de TiendaNube y un fallo de AdminApp se veían iguales para el
//  usuario: «No se pudo sincronizar el stock con TiendaNube», para los cuatro
//  casos. Los cuatro se arreglan distinto —esperar, volver a vincular, avisar a
//  TiendaNube, o abrir un ticket acá— y sin distinguirlos la pantalla manda a
//  revisar el lado equivocado. El texto sale del servidor, que es el único que
//  sabe el contexto.
//
//  ── Por qué el reintento se agota ──
//
//  A los 8 intentos la fila deja de reintentarse sola: queda con su
//  `ultimo_error`, la pantalla la muestra en rojo, y solo la vuelve a mover una
//  corrida manual o la reconciliación diaria. Una fila que reintenta para
//  siempre contra un token revocado es un ataque a la cuota de la tienda, y la
//  cuota es por tienda: se la come a todas las demás variantes.
// ════════════════════════════════════════════

/**
 * Cuántos intentos fallidos aguanta una fila antes de dejar de reintentar sola.
 *
 * Con la espera creciente de abajo, ocho intentos son ~4 horas de reintentos.
 * Después de eso el problema no es transitorio.
 */
const MAX_INTENTOS = 8;

/**
 * El tope de la espera creciente, en minutos.
 *
 * Sin tope, `2^intentos` llega a días en el intento 11 y la fila queda parada
 * hasta la semana que viene sin que nada lo diga. El tope hace que la espera se
 * estacione en una hora, que es el ritmo con el que la reconciliación diaria ya
 * convive.
 */
const TOPE_DE_ESPERA_MINUTOS = 60;

const MINUTO_MS = 60 * 1000;

/** Las clases de fallo, cada una con una reacción distinta. */
const CLASES = {
  TIMEOUT: 'timeout',
  TOKEN_INVALIDO: 'token_invalido',
  LIMITE: 'limite',
  CAIDA_DE_TIENDANUBE: 'caida_de_tiendanube',
  PETICION_RECHAZADA: 'peticion_rechazada',
  DESCONOCIDO: 'desconocido',
};

/** Los motivos por los que una variante mapeada no se publica (FR-046). */
const MOTIVOS_NO_PUBLICADO = {
  SIN_STOCK_EN_SUCURSAL: 'sin_stock_en_sucursal',
  SIN_MAPEO: 'sin_mapeo',
  PRODUCTO_INACTIVO: 'producto_inactivo',
};

/**
 * Los códigos de axios y de Node que significan «no contestó a tiempo».
 *
 * `ECONNABORTED` es el del `timeout` de axios; `ETIMEDOUT` y `ECONNRESET` son
 * de la capa de sockets y llegan cuando la conexión se corta antes. Los tres
 * son la misma situación para quien mira la pantalla.
 */
const CODIGOS_DE_TIMEOUT = ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'];

/**
 * Cuándo volver a intentar esta variante, o `null` si ya no se reintenta sola.
 *
 * @param {number} intentos Cuántos fallaron **ya**. Cero = es el primer fallo.
 * @param {string|number|null} [retryAfter] La cabecera `Retry-After` de la
 *   respuesta, si vino: segundos o una fecha HTTP. Un 429 no es un error, es
 *   «más despacio», y el número lo pone el que sabe: la tienda.
 * @param {Date} [ahora] El reloj, inyectable para poder afirmar el resultado
 *   exacto en vez de un rango.
 * @returns {Date|null}
 */
function proximoIntento(intentos, retryAfter = null, ahora = new Date()) {
  const hechos = Number.isFinite(Number(intentos)) ? Math.max(0, Math.trunc(Number(intentos))) : 0;

  // ⚠ El tope gana sobre el `Retry-After`. Ocho fallos seguidos contra la misma
  // variante no son un pico de tráfico: es un token revocado o una variante que
  // ya no existe, y ninguna de las dos se arregla esperando más.
  if (hechos >= MAX_INTENTOS) return null;

  const desde = ahora instanceof Date ? ahora.getTime() : new Date(ahora).getTime();
  const pedida = esperaPedida(retryAfter, desde);

  if (pedida !== null) return new Date(desde + pedida);

  const minutos = Math.min(2 ** hechos, TOPE_DE_ESPERA_MINUTOS);
  return new Date(desde + minutos * MINUTO_MS);
}

/**
 * Los milisegundos que pide un `Retry-After`, o `null` si no vino o no se
 * entiende.
 *
 * Las dos formas del estándar: un número de segundos, o una fecha HTTP. Se
 * recorta al mismo tope que la espera creciente —un `Retry-After` de un día
 * dejaría la fila parada hasta mañana— y nunca es negativo: una fecha ya pasada
 * significa «podés ahora».
 */
function esperaPedida(retryAfter, desde) {
  if (retryAfter === null || retryAfter === undefined || retryAfter === '') return null;

  const tope = TOPE_DE_ESPERA_MINUTOS * MINUTO_MS;
  const texto = String(retryAfter).trim();

  if (/^\d+$/.test(texto)) return Math.min(Number(texto) * 1000, tope);

  const fecha = Date.parse(texto);
  if (Number.isNaN(fecha)) return null;

  return Math.min(Math.max(0, fecha - desde), tope);
}

/**
 * El status HTTP del error, o `null` si no hubo respuesta.
 *
 * ⚠ **Es el caso que más se olvida.** Un error de red no tiene `response`, así
 * que `err.response.status` tira un `TypeError` adentro del `catch` que existía
 * para manejarlo: el fallo original desaparece y en su lugar sale «Cannot read
 * properties of undefined», que no dice absolutamente nada sobre lo que pasó.
 */
function statusDe(err) {
  const status = err && err.response && err.response.status;
  return typeof status === 'number' ? status : null;
}

/** La cabecera `Retry-After` de la respuesta, sin distinguir mayúsculas. */
function retryAfterDe(err) {
  const cabeceras = (err && err.response && err.response.headers) || {};

  for (const [nombre, valor] of Object.entries(cabeceras)) {
    if (String(nombre).toLowerCase() === 'retry-after') return valor;
  }

  return null;
}

/**
 * Qué le pasó a la llamada, y qué se hace con eso.
 *
 * `mensaje: null` significa **«esto no es para el usuario»**: es un fallo de
 * AdminApp —una petición mal armada, un error que no sabemos leer— y le
 * corresponde el mensaje genérico de `fallo`, con su `requestId`. Decirle
 * «TiendaNube tuvo un problema» a alguien cuyo problema es nuestro lo manda a
 * revisar el lado equivocado durante una tarde.
 *
 * @returns {{clase: string, status: number|null, reintentable: boolean,
 *   hayQueVolverAVincular: boolean, retryAfter: string|number|null,
 *   mensaje: string|null}}
 */
function clasificarError(err) {
  const status = statusDe(err);
  const codigo = err && err.code;

  const base = { status, retryAfter: retryAfterDe(err), hayQueVolverAVincular: false };

  if (status === null && CODIGOS_DE_TIMEOUT.includes(codigo)) {
    return {
      ...base,
      clase: CLASES.TIMEOUT,
      reintentable: true,
      mensaje: 'TiendaNube no respondió a tiempo. Volvé a intentar en unos minutos.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      ...base,
      clase: CLASES.TOKEN_INVALIDO,
      reintentable: false,
      hayQueVolverAVincular: true,
      // Es distinto de «no se pudo sincronizar»: no se arregla reintentando, se
      // arregla volviendo a vincular. Sin esta diferencia, la pantalla ofrece
      // «reintentar» para siempre sobre un token que ya no vale.
      mensaje: 'Tu tienda desconectó AdminApp. Hay que volver a vincularla.',
    };
  }

  if (status === 429) {
    return {
      ...base,
      clase: CLASES.LIMITE,
      // No es un error: es «más despacio». Por eso se reintenta y el resto de la
      // corrida no se pierde.
      reintentable: true,
      mensaje: 'TiendaNube está limitando las llamadas. Se reintenta en unos minutos.',
    };
  }

  if (status !== null && status >= 500) {
    return {
      ...base,
      clase: CLASES.CAIDA_DE_TIENDANUBE,
      reintentable: true,
      mensaje: 'TiendaNube tuvo un problema. No es de AdminApp.',
    };
  }

  if (status !== null) {
    // Un 4xx que no es 401 ni 429 es una petición que armamos mal: un id que no
    // existe, un cuerpo que no acepta. Es un fallo de AdminApp y va por el
    // genérico, con su `requestId` para poder encontrar la línea.
    return { ...base, clase: CLASES.PETICION_RECHAZADA, reintentable: false, mensaje: null };
  }

  return { ...base, clase: CLASES.DESCONOCIDO, reintentable: false, mensaje: null };
}

/**
 * El número que se le manda a TiendaNube.
 *
 * TiendaNube no acepta stock negativo, y un stock local negativo existe: sale de
 * un ajuste manual o de una venta contra una fila que ya estaba en cero. Se
 * publica cero, que es la verdad de lo que se puede vender.
 */
function stockAPublicar(disponible) {
  const numero = Number(disponible);
  return Number.isFinite(numero) ? Math.max(0, Math.trunc(numero)) : 0;
}

/**
 * ¿Hay que mandarle un PUT a esta variante?
 *
 * @param {{stock_publicado: number|null}} fila La fila de `tiendanube_variantes`.
 * @param {number|null} disponible `stock.available` de la **sucursal
 *   designada**, o `null` si no hay fila de stock en esa sucursal.
 *
 * ⚠ **Sin fila de stock NO se publica cero** (FR-046). Publicar cero por
 * omisión agota en la tienda una variante que sí tiene mercadería: el producto
 * deja de venderse y nadie entiende por qué. Lo que corresponde es no mandar
 * nada y dejar escrito el motivo, que es lo que la pantalla muestra.
 */
function hayQueEmpujar(fila, disponible) {
  if (disponible === null || disponible === undefined) return false;

  const numero = Number(disponible);
  if (!Number.isFinite(numero)) return false;

  const publicado = fila && fila.stock_publicado !== null && fila.stock_publicado !== undefined
    ? Number(fila.stock_publicado)
    : null;

  // Nunca se publicó: hay que mandarlo aunque el número dé cero.
  if (publicado === null || !Number.isFinite(publicado)) return true;

  // Se comparan los números **como se publican**: con `stock_publicado = 0` y un
  // disponible de -3 los dos mandan cero, así que repetir el PUT es gastar una
  // llamada de la cuota para dejar la tienda igual. Es lo que hace barata a la
  // reconciliación diaria, que compara todo el catálogo.
  return stockAPublicar(numero) !== stockAPublicar(publicado);
}

module.exports = {
  proximoIntento,
  clasificarError,
  hayQueEmpujar,
  stockAPublicar,
  CLASES,
  MOTIVOS_NO_PUBLICADO,
  MAX_INTENTOS,
  TOPE_DE_ESPERA_MINUTOS,
};
