#!/usr/bin/env node
// ════════════════════════════════════════════
//  Deja lista la base de los tests de integración
//
//  Dos modos:
//
//    node src/tests/integracion/prepararBase.js            migra y verifica
//    node src/tests/integracion/prepararBase.js --levantar  además crea el
//                                                           contenedor
//
//  El primero es el que corre `npm run test:integracion` antes de jest: aplica
//  las migraciones que falten y falla ruidosamente si no hay base. El segundo
//  es el comando que se corre una vez en la máquina de quien desarrolla, y en
//  CI no se usa porque ahí el Postgres lo pone el propio workflow.
//
//  ── Por qué es un script de Node y no una línea de shell ──
//
//  Porque tiene que funcionar en las dos: `DATABASE_URL=… node …` es sintaxis
//  de sh y en Windows npm corre los scripts con `cmd.exe`, donde eso no asigna
//  nada — el script arrancaría contra la base de desarrollo sin avisar. Con un
//  proceso hijo y `env` explícito, el mismo comando anda en las dos.
//
//  ── Por qué se migra en cada corrida ──
//
//  Es idempotente (sequelize-cli lleva la cuenta en `SequelizeMeta`) y cuesta
//  unos segundos. A cambio, agregar una migración no obliga a acordarse de
//  nada: el arnés no puede quedar corriendo contra un esquema viejo, que es
//  una falla que se ve como un test roto y no como una base desactualizada.
// ════════════════════════════════════════════

const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const { urlDeLaBaseDePruebas } = require('./urlDeLaBaseDePruebas');

/** Nombre del contenedor descartable. Fijo, para poder bajarlo después. */
const CONTENEDOR = 'favalio-pg-integracion';

/** La imagen es la MISMA que usa CI: probar contra otra versión no prueba CI. */
const IMAGEN = 'postgres:16-alpine';

const RAIZ_API = path.resolve(__dirname, '..', '..', '..');

function log(mensaje) {
  console.log(`[integracion] ${mensaje}`);
}

/**
 * Corre un comando y resuelve con su código de salida.
 *
 * `shell` en Windows porque `docker` y `npx` son `.cmd` y `spawn` sin shell no
 * los encuentra — el mismo motivo que `scripts/migrar.js`.
 */
function correr(comando, argumentos, opciones = {}) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, argumentos, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...opciones,
    });

    proceso.on('close', (codigo) => resolve(codigo));
    proceso.on('error', reject);
  });
}

/** Igual que `correr`, pero devuelve la salida en vez de imprimirla. */
function salidaDe(comando, argumentos) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, argumentos, {
      shell: process.platform === 'win32',
    });

    let texto = '';
    proceso.stdout.on('data', (d) => { texto += d; });
    proceso.stderr.on('data', () => {});
    proceso.on('close', (codigo) => resolve({ codigo, texto: texto.trim() }));
    proceso.on('error', reject);
  });
}

/**
 * ¿Contesta Postgres?
 *
 * Se usa `pg` directo y no Sequelize: un fallo de conexión tiene que salir como
 * un fallo de conexión, y no con los tres reintentos que `config/database.js`
 * hace por Neon.
 */
async function contesta(url) {
  const cliente = new Client({ connectionString: url, ssl: false });

  try {
    await cliente.connect();
    await cliente.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function levantarContenedor(url) {
  const existente = await salidaDe('docker', ['ps', '-aq', '--filter', `name=^${CONTENEDOR}$`]);

  if (existente.codigo !== 0) {
    throw new Error(
      'No se pudo hablar con Docker. Si no lo tenés, levantá un Postgres como quieras y\n' +
      `apuntá el arnés con DATABASE_URL_TEST=${url}`
    );
  }

  if (existente.texto) {
    log(`El contenedor ${CONTENEDOR} ya existe; se arranca.`);
    await correr('docker', ['start', CONTENEDOR]);
  } else {
    const { port, pathname, username, password } = new URL(url);

    log(`Creando ${CONTENEDOR} (${IMAGEN}) en el puerto ${port}.`);

    const codigo = await correr('docker', [
      'run', '-d', '--name', CONTENEDOR,
      '-e', `POSTGRES_USER=${username}`,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-e', `POSTGRES_DB=${pathname.replace(/^\//, '')}`,
      '-p', `${port}:5432`,
      IMAGEN,
    ]);

    if (codigo !== 0) throw new Error('docker run falló. Ver la salida de arriba.');
  }
}

/** Espera a que la base acepte conexiones. */
async function esperar(url, segundos = 60) {
  for (let i = 0; i < segundos; i++) {
    if (await contesta(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function migrar(url) {
  const codigo = await correr('node', ['scripts/migrar.js'], {
    cwd: RAIZ_API,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DB_SSL: 'false',
      // Sin esto, `config/database.js` loguea cada consulta de las migraciones.
      NODE_ENV: 'test',
    },
  });

  if (codigo !== 0) throw new Error('Las migraciones fallaron. Ver la salida de arriba.');
}

async function main() {
  const url = urlDeLaBaseDePruebas();
  const levantar = process.argv.includes('--levantar');

  log(`Base de pruebas: ${url.replace(/:[^:@/]*@/, ':***@')}`);

  if (levantar) await levantarContenedor(url);

  // Sin `--levantar` se espera poco: la base tiene que estar. Diez segundos y
  // no uno porque en CI el servicio recién arrancó y la primera conexión puede
  // llegar antes de que Postgres termine de abrir el socket; y no sesenta
  // porque el que corre esto en su máquina y se olvidó de levantar el
  // contenedor tiene que enterarse enseguida.
  if (!(await esperar(url, levantar ? 60 : 10))) {
    throw new Error(
      'No hay Postgres escuchando en esa dirección.\n\n' +
      'Para levantar el contenedor descartable y dejarlo migrado:\n' +
      '  npm --prefix apps/api run test:db:levantar\n\n' +
      'Los tests de integración NO se saltean cuando falta la base: un test que se\n' +
      'saltea en silencio es un test que deja de correr y nadie se entera.'
    );
  }

  await migrar(url);
  log('La base de integración está lista.');
}

main().catch((err) => {
  console.error(`\n[integracion] ${err.message}\n`);
  process.exit(1);
});
