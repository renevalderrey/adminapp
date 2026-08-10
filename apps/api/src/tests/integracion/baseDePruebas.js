// ════════════════════════════════════════════
//  El arnés de los tests de integración: la base real y cómo se aísla
//
//  ── Qué problema resuelve ──
//
//  `tests/helpers/modelosFalsos.js` lo dice en su propio encabezado: «un bug
//  que solo aparece contra Postgres real —por ejemplo, DECIMAL devuelto como
//  string— NO lo atrapan». Ese ejemplo dejó de ser hipotético varias veces, y
//  hay garantías enteras que los dobles no pueden ni empezar a ejercitar: no
//  entienden `lock`, ni transacciones, ni `group`. La idempotencia de
//  `POST /api/sales`, el `GROUP BY` del saldo de proveedores y el aislamiento
//  entre empresas **no se pueden testear con dobles**: un test escrito sobre
//  ellos probaría el doble.
//
//  Acá se levanta la aplicación de verdad —`server.js` exporta `app` sin abrir
//  el puerto— contra un Postgres de verdad con las migraciones aplicadas.
//
//  ── Decisión: se TRUNCA, no se envuelve cada test en una transacción ──
//
//  Las dos formas habituales de aislar tests contra una base son abrir una
//  transacción por test y hacer rollback al final, o truncar las tablas entre
//  test y test. Acá se trunca, por dos motivos:
//
//  1. **La transacción por test no alcanza a supertest.** El request entra por
//     la aplicación real, que pide su propia conexión al pool y abre sus
//     propias transacciones. El test no tiene forma de meterle la suya: las
//     escrituras del handler quedarían fuera de la transacción del test y el
//     rollback no las borraría. Sería aislamiento aparente.
//
//  2. **El commit real es justamente lo que se quiere probar.** La idempotencia
//     de `POST /api/sales` depende de que dos requests EN PARALELO —dos
//     conexiones distintas, dos transacciones distintas— choquen contra la
//     clave primaria y que el que pierde relea la venta que el que ganó ya
//     commiteó. Con todo adentro de una transacción de test eso no puede pasar:
//     una transacción no ve lo que otra no commiteó, y el caso desaparecería.
//
//  Lo que se paga es velocidad —un `TRUNCATE` de ~40 tablas por test— y que no
//  se puedan correr dos archivos en paralelo sobre la misma base. Por eso
//  `npm run test:integracion` va con `--runInBand`.
//
//  ── Decisión: si no hay Postgres, FALLA. No se saltea ──
//
//  Un test que se saltea en silencio es un test que deja de correr y nadie se
//  entera. Es literalmente el modo de falla que este repositorio viene
//  juntando: un `testMatch` que no levantaba nada y pasaba en verde, un
//  `--passWithNoTests`, dos guardias que se quedaron recorriendo un árbol
//  vacío.
//
//  La forma de que eso no moleste no es saltear: es que estos tests **no estén
//  en la corrida rápida**. `npm test` los excluye por nombre de archivo
//  (`*.integracion.test.js`) y `npm run test:integracion` corre solo estos. O
//  sea: cuando se corren, se corrieron porque alguien los pidió, y entonces no
//  hay ninguna razón honesta para pasar en verde sin base. El mensaje de la
//  falla dice el comando exacto que levanta la base.
//
//  ── Contra qué base ──
//
//  Ver `urlDeLaBaseDePruebas.js`: nunca contra la base de desarrollo, y el
//  nombre tiene que decir que es de prueba antes de que nadie trunque nada.
// ════════════════════════════════════════════

const path = require('path');
const { urlDeLaBaseDePruebas } = require('./urlDeLaBaseDePruebas');

const URL_DE_PRUEBA = urlDeLaBaseDePruebas();

// ── El orden de los require importa, y por eso se verifica ──
//
// `config/database.js` construye la instancia de Sequelize AL IMPORTARSE, con
// el `DATABASE_URL` que haya en ese momento. Si un test importa la aplicación
// —o cualquier modelo— antes que este archivo, la conexión queda armada contra
// la base de desarrollo y los TRUNCATE caen ahí.
//
// No se puede resolver con `setupFiles` sin tocar `jest.config.js`, así que se
// resuelve haciéndolo ruidoso: si el módulo ya estaba en el cache, se corta con
// un mensaje que dice exactamente qué hacer.
const RUTA_DE_DATABASE = require.resolve('../../config/database');

if (require.cache[RUTA_DE_DATABASE]) {
  throw new Error(
    'baseDePruebas.js tiene que ser el PRIMER require de un test de integración.\n' +
    `Alguien ya importó ${path.relative(process.cwd(), RUTA_DE_DATABASE)} antes, así que\n` +
    'la conexión a Postgres quedó armada contra otra base. Movelo arriba de todo.'
  );
}

process.env.DATABASE_URL = URL_DE_PRUEBA;
// El contenedor de pruebas no tiene TLS. Sin esto, `config/database.js` exige
// SSL —que es lo correcto contra Neon— y la conexión local falla con un error
// que no nombra al SSL.
process.env.DB_SSL = 'false';

// ⚠ **Sin clave de Resend, y a propósito.**
//
// El arnés levanta la aplicación de verdad, así que los handlers que mandan
// correo lo mandan de verdad: con la clave puesta en el `.env` local, correr la
// suite le disparaba emails reales a las direcciones inventadas de las fixtures
// —`martina@ejemplo.test` y compañía—. En CI no pasaba porque ahí no hay clave,
// que es exactamente el motivo por el que nadie lo veía.
//
// Se borra acá, antes de requerir nada: `services/email.js` construye el cliente
// **al cargarse**, así que sacarla después no tendría efecto. Sin clave,
// `sendEmail` devuelve `{ ok: false }` sin tocar la red, que es el mismo camino
// que corre en CI y el que los tests afirman.
delete process.env.RESEND_API_KEY;

const sequelize = require('../../config/database');
const modelos = require('../../models');
const { app } = require('../../server');

// Segunda red, por si alguna vez la primera se puede eludir: la instancia
// construida tiene que ser la que pedimos. Comparar el nombre de la base es
// suficiente y no depende de cómo Sequelize parsee el resto de la URL.
const nombrePedido = new URL(URL_DE_PRUEBA).pathname.replace(/^\//, '');

if (sequelize.config.database !== nombrePedido) {
  throw new Error(
    `La conexión quedó armada contra "${sequelize.config.database}" y se pidió ` +
    `"${nombrePedido}". No se corre nada sobre una base que no es la de pruebas.`
  );
}

// ── Los cinco segundos de jest no alcanzan, y no es una excusa ──
//
// El `beforeEach` de cada test hace un `TRUNCATE` de todo el esquema y siembra
// las dos empresas. Medido contra el contenedor de pruebas eso tarda entre 1,5
// y 7 segundos según cuánto más esté corriendo en la máquina: el costo es el
// viaje de ida y vuelta contra Postgres, no la cantidad de tablas.
//
// Con el timeout por defecto —cinco segundos— el pico hace fallar el HOOK, y un
// test que falla por el reloj y no por lo que afirma es un test que alguien
// termina marcando como inestable y salteando. Se sube acá, en un solo lugar,
// para todos los archivos que importen el arnés.
if (typeof jest !== 'undefined') jest.setTimeout(60000);

/** La tabla de control de sequelize-cli: se conserva o habría que remigrar. */
const TABLA_DE_MIGRACIONES = 'SequelizeMeta';

let tablasCacheadas = null;

/**
 * Las tablas del esquema `public`, menos la de migraciones.
 *
 * Se leen de `pg_tables` y no de una lista escrita a mano: una tabla nueva
 * agregada por una migración tiene que entrar sola al truncado. Una lista
 * escrita a mano se desactualiza y deja filas de un test contaminando al
 * siguiente — que es el bug más difícil de leer que puede tener una suite.
 */
async function tablasDelEsquema() {
  if (tablasCacheadas) return tablasCacheadas;

  const [filas] = await sequelize.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );

  const encontradas = filas
    .map((f) => f.tablename)
    .filter((t) => t !== TABLA_DE_MIGRACIONES);

  if (!encontradas.length) {
    throw new Error(
      'La base de pruebas no tiene ninguna tabla. Faltan las migraciones:\n' +
      '  npm --prefix apps/api run test:db:migrar'
    );
  }

  tablasCacheadas = encontradas;
  return tablasCacheadas;
}

/**
 * Deja la base vacía y las secuencias en 1.
 *
 * `RESTART IDENTITY` no es cosmético: las fixtures dan por sentado que la
 * primera empresa creada es la id 1, porque el bypass de autenticación de
 * `server.js` clava `req.empresaId = 1`. Sin reiniciar las secuencias, el
 * segundo test de un archivo operaría con una sesión apuntando a una empresa
 * que ya no existe.
 *
 * `CASCADE` porque hay claves foráneas entre casi todas: truncar de a una en
 * el orden correcto sería una lista más para mantener.
 *
 * ── Se truncan TODAS, no solo las que tienen datos ──
 *
 * La versión que consultaba primero cuáles tenían filas y truncaba solo esas
 * está medida y **no sirve**: contra el contenedor de pruebas, truncar 39
 * tablas y truncar 1 tardan lo mismo (~1,4 s). El costo no es por tabla, es el
 * viaje de ida y vuelta. Se deja la forma simple, que además no depende de
 * ninguna suposición sobre qué escribió el test anterior.
 */
async function limpiarLaBase() {
  const tablas = await tablasDelEsquema();
  const lista = tablas.map((t) => `"${t}"`).join(', ');

  await sequelize.query(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

/**
 * Conecta, o falla con el comando exacto que hay que correr.
 *
 * Va en un `beforeAll`. No devuelve nada y no se saltea nunca: ver la decisión
 * escrita en el encabezado.
 */
async function conectarOFallar() {
  try {
    await sequelize.authenticate();
  } catch (err) {
    throw new Error(
      'No hay Postgres para los tests de integración.\n\n' +
      `  Base pedida: ${URL_DE_PRUEBA}\n` +
      `  Error:       ${err.message}\n\n` +
      'Para levantarlo y dejarlo migrado:\n' +
      '  npm --prefix apps/api run test:db:levantar\n' +
      '  npm --prefix apps/api run test:integracion\n\n' +
      'Estos tests NO se saltean cuando falta la base: un test que se saltea en ' +
      'silencio es un test que deja de correr y nadie se entera.'
    );
  }

  // Que conecte no significa que esté migrada. Este error es distinto del de
  // arriba y merece su propio mensaje: una base vacía se ve igual que una base
  // sana hasta el primer INSERT.
  await tablasDelEsquema();
}

/** Cierra el pool. Va en el `afterAll` de cada archivo. */
async function cerrar() {
  await sequelize.close();
}

module.exports = {
  app,
  sequelize,
  modelos,
  limpiarLaBase,
  conectarOFallar,
  cerrar,
  URL_DE_PRUEBA,
};
