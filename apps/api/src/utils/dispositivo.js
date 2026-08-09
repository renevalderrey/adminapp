// ════════════════════════════════════════════
//  FAVALIO · Qué tipo de aparato es este user-agent
//
//  ── Por qué es una función pura y no una columna ──
//
//  Lo que se guarda en `sesiones.user_agent` es el **texto crudo** que mandó el
//  navegador. La etiqueta que ve el usuario —«computadora», «celular»— se deriva
//  acá, en el momento de dibujar la lista. La diferencia importa: el día que
//  aparezca un navegador nuevo que hoy cae en «desconocido», corregir esta
//  función arregla **también las sesiones que ya estaban guardadas**. Con la
//  etiqueta persistida haría falta una migración de datos para arreglar un
//  cartel.
//
//  Es el mismo criterio que `utils/stockBajo.js`: la regla se calcula, no se
//  guarda.
//
//  ── Lo que esto NO intenta ser ──
//
//  No es detección de dispositivo. No hay forma confiable de sacar el aparato de
//  un user-agent —Chrome dice «Mozilla/5.0», iPadOS dice «Macintosh», cualquiera
//  lo puede falsear— y no hace falta: la pregunta que contesta la pantalla es
//  «¿cuál de estas filas es la notebook del local y cuál es mi teléfono?», y para
//  eso alcanza con tres categorías y con equivocarse hacia «desconocido».
//
//  Por eso las tres etiquetas son fijas y **nunca devuelve `undefined`**: es la
//  misma regla que `tonoDeProveedor` en el navegador. Una etiqueta ausente en una
//  tabla se dibuja como celda vacía y nadie sabe si es que no se supo o que no se
//  miró.
// ════════════════════════════════════════════

/** Las tres respuestas posibles. Escritas una vez para que nadie invente una cuarta. */
const DISPOSITIVOS = {
  COMPUTADORA: 'computadora',
  CELULAR: 'celular',
  DESCONOCIDO: 'desconocido',
};

/**
 * Señales de un aparato de mano.
 *
 * ⚠ **Se miran primero**, y no es indistinto: `Windows Phone` contiene
 * `Windows`, así que evaluar el escritorio antes convertiría todos los Windows
 * Phone en computadoras. Lo mismo `Android`, que en una tablet no trae `Mobi`.
 *
 * Las tablets caen acá: para lo que la pantalla contesta —«esto no es la
 * computadora del mostrador»— un iPad y un teléfono son lo mismo, y una cuarta
 * etiqueta sería una distinción que nadie usa.
 */
const DE_MANO = /(android|iphone|ipad|ipod|windows phone|iemobile|blackberry|bb10|opera mini|mobile safari|\bmobi\b)/i;

/**
 * Señales de un equipo de escritorio.
 *
 * `X11` y `CrOS` entran porque Linux y ChromeOS no dicen «Windows» ni
 * «Macintosh», y sin ellas una notebook con Ubuntu caería en «desconocido».
 */
const DE_ESCRITORIO = /(windows nt|macintosh|mac os x|cros|x11|\blinux\b)/i;

/**
 * La etiqueta del aparato desde el que se abrió una sesión.
 *
 * @param {string|null|undefined} ua El user-agent crudo, tal como llegó.
 * @returns {'computadora'|'celular'|'desconocido'} Nunca `undefined`.
 */
function dispositivoDeUserAgent(ua) {
  // ⚠ La guarda del nulo no es defensiva por costumbre: `sesiones.user_agent`
  // es NULLABLE —un cliente puede no mandar la cabecera— y esta función la llama
  // el listado de sesiones, fila por fila. Sin esto, una sola sesión sin
  // user-agent tira un TypeError y la pantalla de Equipo entera responde 500.
  if (typeof ua !== 'string') return DISPOSITIVOS.DESCONOCIDO;

  const texto = ua.trim();
  if (!texto) return DISPOSITIVOS.DESCONOCIDO;

  if (DE_MANO.test(texto)) return DISPOSITIVOS.CELULAR;
  if (DE_ESCRITORIO.test(texto)) return DISPOSITIVOS.COMPUTADORA;

  // Un `curl`, un script, un navegador que nadie vio nunca. Decir «computadora»
  // acá sería inventar: la lista tiene que poder mostrar «desconocido» y el
  // user-agent crudo al lado, que es lo que permite reconocerlo a ojo.
  return DISPOSITIVOS.DESCONOCIDO;
}

module.exports = { dispositivoDeUserAgent, DISPOSITIVOS };
