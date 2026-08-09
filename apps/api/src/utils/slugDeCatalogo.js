// ════════════════════════════════════════════
//  FAVALIO · El slug de un catálogo público
//
//  Es la dirección del catálogo: `tienda.favalio.com/c/<slug>`. Y esa dirección
//  **se imprime en una pared** —el QR pegado en la recepción del gimnasio—, así
//  que este archivo no es una prolijidad de formato: es la garantía de que lo
//  que el comercio leyó antes de apretar «Publicar» es lo que quedó publicado.
//
//  ── Por qué hay UNA sola función y no una por lado ──
//
//  El formulario del panel propone el slug mientras el usuario escribe el
//  nombre, y el servidor lo normaliza otra vez antes de guardarlo (FR-051). Si
//  las dos normalizaciones no dan lo mismo, el usuario apretó «Publicar» sobre
//  `comprafit-fitnet` y quedó publicada otra dirección: el QR ya está impreso,
//  el enlace no abre nada, y nada falló en ningún log. Alcanza con que un lado
//  colapse los guiones repetidos y el otro no.
//
//  `apps/web` **duplica** estas ocho líneas —no hay un paquete compartido para
//  ellas— y las ata con una guardia de texto que lee este archivo y compara la
//  lista de reservados y el regex (T1453, molde de
//  `apps/web/src/tests/mediosDePago.test.js:46`). La copia se acepta y el motivo
//  se escribe: crear un tercer paquete compartido para ocho líneas sin
//  dependencias engordaría el corte de workspaces sin resolver nada que la
//  guardia no resuelva. Si aparece una tercera regla compartida, ahí nace
//  `packages/comun`.
//
//  ⚠ Por eso `RESERVADOS` y `FORMATO` son constantes con nombre y literales
//  planos: hay un test de otro paquete que los lee **como texto**.
// ════════════════════════════════════════════

/**
 * Los nombres que un catálogo no puede tomar (FR-052).
 *
 * `'c'` es el más importante y el menos obvio: es el prefijo de la propia URL
 * pública, así que un catálogo llamado `c` produciría `/c/c/...` y volvería
 * ambigua la ruta que este mismo archivo tiene que saber leer. Los demás son
 * caminos que el sitio público sirve o puede llegar a servir —`robots.txt`,
 * `favicon.ico`, `assets`, `img`, `static`, `public`— y los dos prefijos que ya
 * usa el sistema, `api` y `admin`.
 *
 * Los dos con punto están tal cual los pide FR-052, y conviene saber que
 * `normalizarSlug` nunca los produce: el punto es un separador, así que
 * `robots.txt` sale `robots-txt`. Sirven para el camino corto —alguien que
 * manda el slug directo en el cuerpo del request— y no hace falta agregar sus
 * versiones con guión: el catálogo vive bajo `/c/`, donde no compite con el
 * `robots.txt` de la raíz.
 */
const RESERVADOS = [
  'c',
  'api',
  'assets',
  'admin',
  'robots.txt',
  'favicon.ico',
  'img',
  'static',
  'public',
];

/**
 * La forma que tiene un slug ya normalizado.
 *
 * Está escrito como «grupos separados por un guión» y no como
 * `/^[a-z0-9-]+$/`, porque así el propio regex prohíbe las tres cosas que
 * `normalizarSlug` saca: el guión del principio, el del final y los repetidos.
 * Un regex más permisivo aceptaría `-comprafit--fitnet-`, que es exactamente el
 * string que la normalización existe para no producir.
 */
const FORMATO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const LARGO_MINIMO = 3;
const LARGO_MAXIMO = 60;

/**
 * Un texto cualquiera llevado a la forma que puede vivir en una URL.
 *
 * Minúsculas, sin acentos, sólo `[a-z0-9-]`, sin guiones repetidos ni en los
 * bordes. «Comprafít / Fitnet» da `comprafit-fitnet`.
 *
 * La tilde de la `ñ` también se saca —`niño` da `nino`—, y es a propósito: una
 * URL con `ñ` viaja percent-encodeada y se copia y pega distinto según de dónde
 * se copie. Un slug tiene que poder dictarse por teléfono.
 *
 * @param {string|null|undefined} texto
 * @returns {string} El slug normalizado. Puede quedar vacío: normalizar no es
 *   validar, y el vacío lo rechaza `validarSlug`.
 */
function normalizarSlug(texto) {
  return (
    String(texto ?? '')
      // NFD separa cada letra acentuada en letra + marca combinante, y el
      // segundo replace se lleva las marcas. Es lo que convierte «í» en «i».
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Todo lo que no sea letra o número es un separador: el espacio, la
      // barra, el punto, el «&». Uno por carácter, a propósito, para que el
      // colapso de la línea siguiente sea el que hace el trabajo y no un
      // detalle escondido en un cuantificador.
      .replace(/[^a-z0-9]/g, '-')
      // ⚠ Sin esta línea, «Comprafit / Fitnet» —espacio, barra, espacio— sale
      // `comprafit---fitnet`. El panel mostraría una dirección y el servidor
      // guardaría otra, que es el defecto que este archivo existe para evitar.
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Si un slug se puede usar, y si no, por qué no.
 *
 * El `motivo` es texto para el usuario —lo muestra el formulario y lo puede
 * levantar un `ErrorDeNegocio`—, no un código para el programa.
 *
 * ⚠ **Los reservados se miran antes que el largo, y ese orden importa.** `c`
 * mide un carácter: con el largo primero, el motivo que vería el usuario sería
 * «tiene que tener entre 3 y 60 caracteres», y volvería a intentar con `cc`
 * sin enterarse nunca de que el problema real es que `c` está tomado por el
 * sistema.
 *
 * Y valida **exactamente lo que recibe**: no recorta espacios ni baja a
 * minúsculas. Es la última puerta antes de escribir en la base, y quien escribe
 * normaliza primero; si acá se arreglara la entrada en silencio, `Comprafit`
 * pasaría la validación y se guardaría un slug que `normalizarSlug` nunca
 * habría producido —o sea, distinto del que el formulario mostró—.
 *
 * @param {string|null|undefined} slug El resultado de `normalizarSlug`.
 * @returns {{ ok: boolean, motivo: string|null }}
 */
function validarSlug(slug) {
  const candidato = String(slug ?? '');

  if (RESERVADOS.includes(candidato)) {
    return {
      ok: false,
      motivo: `La dirección «${candidato}» está reservada por el sistema. Elegí otra.`,
    };
  }

  if (candidato.length < LARGO_MINIMO || candidato.length > LARGO_MAXIMO) {
    return {
      ok: false,
      motivo: `La dirección tiene que tener entre ${LARGO_MINIMO} y ${LARGO_MAXIMO} caracteres.`,
    };
  }

  if (!FORMATO.test(candidato)) {
    return {
      ok: false,
      motivo:
        'La dirección sólo admite letras sin acento, números y guiones, sin ' +
        'guiones repetidos ni al principio o al final.',
    };
  }

  return { ok: true, motivo: null };
}

/**
 * El slug que hay adentro de un camino, o `null` si ese camino no es de un
 * catálogo.
 *
 * ⚠ **Existe porque en el punto de montaje de un router los `req.params`
 * todavía no existen.** El `keyGenerator` del limitador público corre antes de
 * que Express haya emparejado ninguna ruta, así que `req.params.slug` ahí es
 * `undefined`: el único lugar de donde se puede sacar el slug es el camino.
 * Sin esta función, la clave del limitador sería sólo la IP, y un catálogo con
 * mucho tráfico apagaría a todos los demás que salen por la misma IP.
 *
 * El segmento se decodifica y se normaliza en vez de devolverse crudo, y no es
 * cosmética: el resolvedor busca en la base el slug **normalizado**, así que
 * devolver `Comprafit` cuando el resolvedor va a mirar `comprafit` le daría a
 * cada variante de mayúsculas su propio cupo de 120 por minuto sobre el mismo
 * catálogo. La clave del limitador tiene que ser el mismo string que el
 * resolvedor termina buscando.
 *
 * @param {string|null|undefined} path `req.path` en el punto de montaje —
 *   `/c/comprafit-fitnet/productos`— o el camino completo, con o sin el prefijo
 *   `/api/publico`.
 * @returns {string|null}
 */
function slugDeLaRuta(path) {
  const camino = String(path ?? '').split('?')[0].split('#')[0];
  const segmentos = camino.split('/').filter(Boolean);

  // `c` es el prefijo de la URL pública y está en RESERVADOS, así que ningún
  // catálogo puede llamarse así: el primer segmento `c` es siempre el prefijo y
  // nunca un slug, mire uno `/c/x` o `/api/publico/c/x`.
  const prefijo = segmentos.indexOf('c');
  if (prefijo === -1) return null;

  const crudo = segmentos[prefijo + 1];
  if (!crudo) return null;

  let decodificado = crudo;
  try {
    // Un `%` suelto en el camino hace que decodeURIComponent tire URIError, y
    // esto corre adentro del keyGenerator: sin el catch, una URL malformada
    // devolvería 500 en TODAS las peticiones públicas, no sólo en la suya.
    decodificado = decodeURIComponent(crudo);
  } catch {
    decodificado = crudo;
  }

  return normalizarSlug(decodificado) || null;
}

module.exports = {
  normalizarSlug,
  validarSlug,
  slugDeLaRuta,
  RESERVADOS,
  FORMATO,
  LARGO_MINIMO,
  LARGO_MAXIMO,
};
