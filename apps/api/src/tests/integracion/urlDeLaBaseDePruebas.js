// ════════════════════════════════════════════
//  Contra qué base corren los tests de integración
//
//  Está en su propio archivo, sin ningún efecto: lo importan el arnés
//  (`baseDePruebas.js`), el preparador (`prepararBase.js`) y la guardia
//  estática (`arnesDeIntegracion.test.js`), que corre en la suite rápida y no
//  puede permitirse abrir una conexión ni levantar la aplicación.
//
//  ── Por qué hay una guardia sobre el NOMBRE de la base ──
//
//  Lo primero que hace cada test de integración es
//  `TRUNCATE TABLE … CASCADE` sobre todo el esquema. Un `DATABASE_URL_TEST`
//  copiado de la configuración de desarrollo —o de producción— borraría datos
//  reales sin preguntar y sin dejar rastro. La verificación es barata y el
//  accidente que evita no se deshace.
// ════════════════════════════════════════════

/** El Postgres descartable que levanta `npm run test:db:levantar`. */
const URL_POR_DEFECTO = 'postgresql://favalio:favalio@localhost:55432/favalio_integracion';

/**
 * Las palabras que tiene que contener el nombre de la base para que el arnés
 * acepte trabajar sobre ella.
 */
const PALABRAS_DE_PRUEBA = ['test', 'prueba', 'integracion', 'integración'];

/**
 * Verifica que la URL apunte a una base que se puede vaciar sin pensarlo.
 *
 * @param {string} url
 * @returns {string} La misma URL, si pasa.
 * @throws {Error} Si no se puede interpretar o si el nombre no dice que es de
 *   prueba.
 */
function verificarQueEsDePrueba(url) {
  let nombre;

  try {
    nombre = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error(
      `La URL de la base de pruebas no se puede interpretar: ${url}\n` +
      'Tiene que ser una URL de Postgres completa, por ejemplo\n' +
      `  ${URL_POR_DEFECTO}`
    );
  }

  const enMinusculas = nombre.toLowerCase();

  if (!PALABRAS_DE_PRUEBA.some((palabra) => enMinusculas.includes(palabra))) {
    throw new Error(
      `El arnés de integración se niega a trabajar sobre la base "${nombre}".\n` +
      'Cada test TRUNCA TODAS LAS TABLAS, así que el nombre de la base tiene que\n' +
      `decir que es de prueba (${PALABRAS_DE_PRUEBA.join(', ')}).\n` +
      'Si de verdad querés apuntar a otra base, renombrala; no saques esta guardia.'
    );
  }

  return url;
}

/**
 * La URL contra la que corren los tests: `DATABASE_URL_TEST` si está, y si no
 * el contenedor descartable.
 *
 * ⚠ **`DATABASE_URL` a secas NO se usa**, y es a propósito: esa es la variable
 * de la aplicación, la que en una máquina de desarrollo apunta a la base con
 * la que se trabaja todos los días.
 */
function urlDeLaBaseDePruebas(entorno = process.env) {
  return verificarQueEsDePrueba(entorno.DATABASE_URL_TEST || URL_POR_DEFECTO);
}

module.exports = {
  URL_POR_DEFECTO,
  PALABRAS_DE_PRUEBA,
  verificarQueEsDePrueba,
  urlDeLaBaseDePruebas,
};
