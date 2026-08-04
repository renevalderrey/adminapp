#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  ¿El esquema migrado sirve para lo que el código va a pedirle?
 *
 *  Hace una consulta REAL —un `findOne`— por cada modelo de `src/models`, y
 *  falla si alguna revienta.
 *
 *  ── Por qué existe ──
 *
 *  El job «la imagen arranca y migra» comprobaba dos cosas: que las migraciones
 *  corrieran y que `/api/health` contestara. Ninguna de las dos mira el
 *  esquema.
 *
 *  Así estuvieron tres meses sin migración las cuatro tablas de permisos
 *  (`roles`, `permisos`, `rol_permisos`, `usuario_permisos`) y la columna
 *  `usuario_empresas.rol_id`. Una base creada solo con migraciones arrancaba
 *  igual —`Server started`, `/api/health` en `ok`— y quedaba inservible: sin
 *  esas tablas, `middleware/auth.js` deja `req.usuarioPermisos` vacío y
 *  `checkPermission` le niega todo a todos.
 *
 *  ── Por qué un `findOne` y no una lista de tablas ──
 *
 *  Porque no hay lista que mantener a mano: los modelos ya están todos en
 *  `src/models/index.js`, y el que se agregue mañana entra solo.
 *
 *  Y porque `findOne` es más estricto que preguntar si la tabla existe:
 *  Sequelize enumera TODAS las columnas del modelo en el SELECT, así que una
 *  columna declarada en el modelo y ausente en la migración también rompe.
 *  Eso es lo que descubrió `cashflow_entries.punto_de_venta_id`.
 *
 *  Lo que NO cubre, y conviene saberlo: índices, únicos, foreign keys, tipos y
 *  nulabilidad. Un SELECT no los toca. Esto responde «¿puede el código leer
 *  esta tabla?», no «¿es el esquema idéntico al de los modelos?».
 *
 *  ── Uso ──
 *
 *    node scripts/verificar-esquema.js
 *
 *  Sale con 0 si todos los modelos contestan, con 1 si alguno falla.
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const modelos = require('../src/models');

const sequelize = modelos.sequelize;

/** Un modelo de Sequelize, y no `sequelize` ni cualquier otra exportación. */
function esModelo(valor) {
  return Boolean(valor && typeof valor.findOne === 'function' && valor.getTableName);
}

/**
 * El mensaje del error, sin el stack.
 *
 * Un stack de Sequelize son treinta líneas de `node_modules` y en el medio,
 * perdida, la única que importa: `relation "roles" does not exist`. Se saca esa
 * y el código de Postgres, que es lo que dice si falta la tabla (42P01), falta
 * una columna (42703) o es otra cosa.
 */
function motivo(err) {
  const original = err?.parent || err?.original || err;
  const codigo = original?.code ? ` [${original.code}]` : '';
  const texto = (original?.message || err?.message || String(err)).split('\n')[0];
  return `${texto}${codigo}`;
}

async function main() {
  await sequelize.authenticate();

  const nombres = Object.keys(modelos).filter((n) => esModelo(modelos[n])).sort();

  if (nombres.length === 0) {
    // Si esto pasa, el script se está mintiendo a sí mismo: pasaría en verde
    // sin haber verificado nada.
    throw new Error('No se encontró ningún modelo en src/models. El chequeo no verificó nada.');
  }

  console.log(`[esquema] Verificando ${nombres.length} modelos contra la base.\n`);

  const fallados = [];

  for (const nombre of nombres) {
    const Modelo = modelos[nombre];
    const tabla = String(Modelo.getTableName());

    try {
      await Modelo.findOne();
      console.log(`  ok    ${nombre.padEnd(22)} → ${tabla}`);
    } catch (err) {
      fallados.push({ nombre, tabla, motivo: motivo(err) });
      console.log(`  FALLA ${nombre.padEnd(22)} → ${tabla}`);
    }
  }

  if (fallados.length === 0) {
    console.log(`\n[esquema] Los ${nombres.length} modelos consultan bien. El esquema sirve.`);
    return;
  }

  console.error(`\n[esquema] ${fallados.length} de ${nombres.length} modelos no pueden consultar su tabla:\n`);

  for (const f of fallados) {
    console.error(`  · ${f.nombre} (tabla ${f.tabla})`);
    console.error(`    ${f.motivo}`);
  }

  console.error(
    '\n  Casi siempre significa lo mismo: el modelo existe y la migración que\n' +
    '  crea su tabla —o su columna— no. Revisá src/migrations.'
  );

  // El código de salida es lo que pone el paso de CI en rojo.
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`[esquema] ${motivo(err)}`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
