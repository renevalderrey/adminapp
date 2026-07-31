#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  Migraciones con lock, para que dos instancias no compitan
 *
 *  Las migraciones corren en el CMD del Dockerfile, al arrancar el contenedor.
 *  Con una sola instancia eso funciona. Al escalar a varias, todas arrancan a
 *  la vez y todas ejecutan `sequelize-cli db:migrate` en paralelo sobre la
 *  misma base.
 *
 *  Sequelize registra lo aplicado en la tabla SequelizeMeta, pero esa lectura
 *  y la escritura no son atomicas entre procesos: dos instancias pueden leer
 *  "esta migracion falta", ejecutarla las dos, y la segunda fallar a mitad de
 *  camino con la tabla ya modificada. Segun que hiciera la migracion, eso deja
 *  el schema en un estado intermedio.
 *
 *  Este script toma un advisory lock de PostgreSQL antes de migrar. La segunda
 *  instancia espera a que la primera termine, ve que ya no falta nada, y sigue.
 *
 *  Los advisory locks se liberan solos si el proceso muere, asi que un
 *  contenedor que se cae a mitad de una migracion no deja la base trabada.
 *
 *  ── Uso ──
 *
 *    node scripts/migrar.js
 *
 *  Reemplaza a `npx sequelize-cli db:migrate` en el arranque.
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const { spawn } = require('child_process');
const path = require('path');
const sequelize = require('../src/config/database');

// Identificador arbitrario pero fijo del lock. Cualquier numero sirve mientras
// sea el mismo en todas las instancias y no lo use otra cosa.
const LOCK_ID = 947213;

// Si una migracion tarda mas que esto, algo anda mal y conviene fallar en vez
// de dejar el arranque colgado indefinidamente.
const ESPERA_MAXIMA_MS = 5 * 60 * 1000;

function log(mensaje) {
  console.log(`[migrar] ${mensaje}`);
}

/**
 * Espera hasta conseguir el lock.
 *
 * Se usa pg_try_advisory_lock en un bucle en vez de pg_advisory_lock a secas,
 * porque el bloqueante no admite timeout: si la instancia que lo tiene se
 * cuelga sin morir, el arranque se queda esperando para siempre.
 */
async function tomarLock() {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  let avisado = false;

  for (;;) {
    const [filas] = await sequelize.query(`SELECT pg_try_advisory_lock(${LOCK_ID}) AS obtenido`);

    if (filas[0].obtenido) return true;

    if (!avisado) {
      log('Otra instancia esta migrando. Esperando...');
      avisado = true;
    }

    if (Date.now() > limite) {
      throw new Error('Timeout esperando el lock de migraciones (5 min).');
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function liberarLock() {
  try {
    await sequelize.query(`SELECT pg_advisory_unlock(${LOCK_ID})`);
  } catch {
    // Si la conexion ya se cerro, Postgres libera el lock solo.
  }
}

function correrMigraciones() {
  return new Promise((resolve, reject) => {
    const raiz = path.resolve(__dirname, '..');

    // --migrations-path va EXPLICITO a proposito.
    //
    // sequelize-cli deduce donde estan las migraciones leyendo .sequelizerc
    // desde el cwd. Ese archivo no se copiaba a la imagen de Docker, con lo
    // cual dentro del contenedor caia al default path.resolve(cwd,'migrations')
    // = /app/migrations, que no existe: umzug hacia readdir, ENOENT, y
    // sequelize-cli salia con codigo 1. Como el CMD encadena con &&, el
    // servidor NUNCA arrancaba.
    //
    // Pasar la ruta por argumento hace que no dependa de que un archivo suelto
    // llegue a la imagen.
    const proceso = spawn(
      'npx',
      [
        'sequelize-cli', 'db:migrate',
        '--config', 'src/config/sequelize-cli.js',
        '--migrations-path', 'src/migrations',
      ],
      { cwd: raiz, stdio: 'inherit', shell: process.platform === 'win32' }
    );

    proceso.on('close', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`sequelize-cli termino con codigo ${codigo}`));
    });

    proceso.on('error', reject);
  });
}

async function main() {
  await tomarLock();
  log('Lock obtenido. Aplicando migraciones.');

  try {
    await correrMigraciones();
    log('Migraciones aplicadas.');
  } finally {
    await liberarLock();
  }
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error(`[migrar] ${err.message}`);
    await liberarLock();
    await sequelize.close();
    // Codigo distinto de cero: el contenedor no debe levantar con el schema
    // a medio migrar.
    process.exit(1);
  });
