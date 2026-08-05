#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  ¿El esquema migrado es el que los modelos declaran?
 *
 *  Dos comprobaciones, y hacen falta las dos:
 *
 *  1. **¿Se puede leer?** Un `findOne` REAL por cada modelo de `src/models`.
 *  2. **¿Es del tipo que corresponde?** El tipo declarado por cada atributo del
 *     modelo contra `information_schema.columns`.
 *
 *  ── Por qué existe la primera ──
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
 *  Un `findOne` es más estricto que preguntar si la tabla existe: Sequelize
 *  enumera TODAS las columnas del modelo en el SELECT, así que una columna
 *  declarada en el modelo y ausente en la migración también rompe. Eso es lo que
 *  descubrió `cashflow_entries.punto_de_venta_id`. Y no hay lista que mantener a
 *  mano: los modelos ya están todos en `src/models/index.js`.
 *
 *  ── Por qué hizo falta la segunda ──
 *
 *  Porque la primera **no ve una divergencia de tipo**. Ocho columnas estaban
 *  declaradas `DataTypes.ENUM` en el modelo y creadas `VARCHAR` por las
 *  migraciones, y este script pasaba en verde: un `SELECT` sobre un `VARCHAR`
 *  donde el modelo espera un ENUM anda perfecto. Lo que no anda es el arranque
 *  en desarrollo, porque `sequelize.sync({ alter: true })` intenta convertir la
 *  columna y muere con
 *  «default for column "unit_type" cannot be cast automatically». O sea: el
 *  chequeo decía que sí y el servidor no levantaba.
 *
 *  Lo arregló `migrations/20260809-tipos-enum-y-indices-de-productos.js`. Esta
 *  segunda comprobación es para que la próxima divergencia se caiga en CI en vez
 *  de aparecer el día que alguien recrea la base.
 *
 *  Se comparan el tipo (`udt_name`) y, cuando es un ENUM, **los valores y su
 *  orden**: el orden de un ENUM de Postgres es el de comparación, así que dos
 *  bases con los mismos valores en distinto orden ordenan distinto.
 *
 *  ── Lo que sigue sin cubrir, y conviene saberlo ──
 *
 *  Índices, únicos, foreign keys, nulabilidad, defaults y el **largo** de los
 *  `varchar`.
 *
 *  El largo se dejó afuera por una razón y no por olvido: no es lo que rompe.
 *  Postgres convierte un `varchar(20)` en `varchar(30)` sin que nadie le
 *  explique cómo, así que una diferencia de largo no tumba el arranque —y
 *  medido sobre una base recién migrada, hoy no hay ninguna—. Agregarlo es
 *  comparar `character_maximum_length` y es media docena de líneas; se hace el
 *  día que una diferencia de largo cueste algo.
 *
 *  Los índices los cubre `tests/indicesDeProveedores.test.js` por comparación de
 *  texto, y el `EXPLAIN` del paso manual P6.
 *
 *  ── Uso ──
 *
 *    node scripts/verificar-esquema.js
 *
 *  Sale con 0 si todo cierra, con 1 si algo falla.
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const modelos = require('../src/models');

const sequelize = modelos.sequelize;

/**
 * El `udt_name` que Postgres tiene que tener para cada tipo de Sequelize.
 *
 * Los ocho primeros son los únicos que hoy usan los modelos de este repositorio
 * y están verificados contra una base real. El resto está anticipado: si alguno
 * resultara equivocado, se ve como una divergencia y se corrige acá.
 *
 * Un tipo que no esté en esta tabla **falla**, no se saltea. Saltearlo sería
 * dejar el mismo agujero que este chequeo vino a tapar: una columna que nadie
 * compara y un script que igual sale en verde.
 */
const UDT_POR_TIPO = {
  BOOLEAN: 'bool',
  DATE: 'timestamptz',
  DATEONLY: 'date',
  DECIMAL: 'numeric',
  INTEGER: 'int4',
  JSONB: 'jsonb',
  STRING: 'varchar',
  TEXT: 'text',

  BIGINT: 'int8',
  SMALLINT: 'int2',
  REAL: 'float4',
  FLOAT: 'float8',
  'DOUBLE PRECISION': 'float8',
  JSON: 'json',
  UUID: 'uuid',
  TIME: 'time',
  CHAR: 'bpchar',
  BLOB: 'bytea',
};

/** Un modelo de Sequelize, y no `sequelize` ni cualquier otra exportación. */
function esModelo(valor) {
  return Boolean(valor && typeof valor.findOne === 'function' && valor.getTableName);
}

/** El nombre de la tabla. `getTableName()` devuelve un objeto si hay esquema. */
function nombreDeTabla(Modelo) {
  const tabla = Modelo.getTableName();
  return typeof tabla === 'string' ? tabla : tabla.tableName;
}

/**
 * El modelo reducido a lo que hace falta comparar.
 *
 * Se devuelve como datos —y no se compara acá adentro— para que
 * `src/tests/tiposDelEsquema.test.js` pueda ejercitar la comparación con
 * modelos y columnas inventadas, sin una base.
 */
function describirModelo(Modelo) {
  const tabla = nombreDeTabla(Modelo);

  const columnas = Object.entries(Modelo.rawAttributes).map(([atributo, def]) => {
    const tipo = def.type;

    return {
      columna: def.field || atributo,
      // `key` es 'STRING', 'ENUM', 'DECIMAL'… El tipo en sí no sirve para
      // comparar: `STRING(20)` y `STRING(255)` son el mismo `varchar`.
      clave: tipo && tipo.key,
      // Solo los ENUM lo traen.
      valores: (tipo && tipo.values) || null,
    };
  });

  return { tabla, columnas };
}

/**
 * El `udt_name` que se espera para una columna.
 *
 * Los ENUM no están en la tabla: Sequelize le pone al tipo el nombre
 * `enum_<tabla>_<columna>`, así que se arma. Devuelve `null` si el tipo es uno
 * que este script no sabe comparar.
 */
function udtEsperado(clave, tabla, columna) {
  if (clave === 'ENUM') return `enum_${tabla}_${columna}`;
  return UDT_POR_TIPO[clave] || null;
}

/**
 * Compara los modelos descritos contra las columnas que tiene la base.
 *
 * `columnasDeLaBase` es un Map de `'tabla.columna'` a
 * `{ udt_name, etiquetas }`, donde `etiquetas` son los valores del ENUM en el
 * orden de Postgres, o `null` si la columna no es un ENUM.
 *
 * Devuelve `{ comparadas, divergencias }`. **Tira si no comparó ninguna
 * columna**: un chequeo que no comparó nada y sale en verde es exactamente la
 * clase de garantía falsa que este script existe para no dar.
 */
function compararTipos(descripciones, columnasDeLaBase) {
  const divergencias = [];
  let comparadas = 0;

  for (const { tabla, columnas } of descripciones) {
    for (const { columna, clave, valores } of columnas) {
      const donde = `${tabla}.${columna}`;
      const esperado = udtEsperado(clave, tabla, columna);

      if (!esperado) {
        divergencias.push({
          donde,
          motivo: `el script no sabe qué tipo de Postgres le corresponde a ${clave}. ` +
                  'Agregá su equivalente a UDT_POR_TIPO en scripts/verificar-esquema.js.',
        });
        continue;
      }

      const real = columnasDeLaBase.get(donde);

      if (!real) {
        divergencias.push({
          donde,
          motivo: 'el modelo la declara y la base no la tiene.',
        });
        continue;
      }

      // A partir de acá la columna se comparó de verdad: existe en los dos lados
      // y el script sabe contra qué compararla.
      comparadas += 1;

      if (real.udt_name !== esperado) {
        divergencias.push({
          donde,
          motivo: `el modelo la declara ${clave} (${esperado}) y la base la tiene ${real.udt_name}.`,
        });
        continue;
      }

      if (clave === 'ENUM') {
        const enLaBase = Array.isArray(real.etiquetas) ? real.etiquetas : [];

        // El orden cuenta: en Postgres es el orden de comparación del tipo, no
        // un detalle de presentación.
        if (enLaBase.join('|') !== valores.join('|')) {
          divergencias.push({
            donde,
            motivo: `los valores del ENUM no coinciden. Modelo: [${valores.join(', ')}]. ` +
                    `Base: [${enLaBase.join(', ')}].`,
          });
        }
      }
    }
  }

  if (comparadas === 0) {
    throw new Error(
      'La comparación de tipos no comparó ninguna columna. El chequeo no verificó nada.'
    );
  }

  return { comparadas, divergencias };
}

/** Las columnas del esquema actual, con los valores de su ENUM si lo es. */
async function columnasDeLaBase() {
  const [filas] = await sequelize.query(`
    SELECT c.table_name,
           c.column_name,
           c.udt_name,
           -- El ::text no es cosmético: enumlabel es de tipo "name", y un
           -- name[] vuelve del driver como la cadena '{a,b}' en vez de un
           -- arreglo. Con eso la comparación tiraba "join is not a function".
           (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
              FROM pg_enum e
              JOIN pg_type t ON t.oid = e.enumtypid
              JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = c.udt_name
               AND n.nspname = current_schema()) AS etiquetas
      FROM information_schema.columns c
     WHERE c.table_schema = current_schema()
  `);

  return new Map(filas.map((f) => [
    `${f.table_name}.${f.column_name}`,
    { udt_name: f.udt_name, etiquetas: f.etiquetas },
  ]));
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

/** Primera comprobación: cada modelo puede consultar su tabla. */
async function verificarLectura(nombres) {
  console.log(`[esquema] Verificando ${nombres.length} modelos contra la base.\n`);

  const fallados = [];

  for (const nombre of nombres) {
    const Modelo = modelos[nombre];
    const tabla = nombreDeTabla(Modelo);

    try {
      await Modelo.findOne();
      console.log(`  ok    ${nombre.padEnd(22)} → ${tabla}`);
    } catch (err) {
      fallados.push({ nombre, tabla, motivo: motivo(err) });
      console.log(`  FALLA ${nombre.padEnd(22)} → ${tabla}`);
    }
  }

  if (fallados.length === 0) {
    console.log(`\n[esquema] Los ${nombres.length} modelos consultan bien.`);
    return true;
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

  return false;
}

/** Segunda comprobación: cada columna es del tipo que el modelo declara. */
async function verificarTipos(nombres) {
  const descripciones = nombres.map((n) => describirModelo(modelos[n]));
  const { comparadas, divergencias } = compararTipos(descripciones, await columnasDeLaBase());

  // El número va SIEMPRE, pase o falle. Es la única forma de notar que el
  // chequeo se quedó comparando cuatro columnas en vez de trescientas.
  console.log(`\n[esquema] Tipos comparados contra information_schema: ${comparadas} columnas.`);

  if (divergencias.length === 0) {
    console.log('[esquema] Ninguna columna difiere del tipo que declara su modelo.');
    return true;
  }

  console.error(`\n[esquema] ${divergencias.length} columnas no tienen el tipo que su modelo declara:\n`);

  for (const d of divergencias) {
    console.error(`  · ${d.donde}`);
    console.error(`    ${d.motivo}`);
  }

  console.error(
    '\n  Una divergencia de tipo no rompe ningún SELECT: la base contesta igual.\n' +
    '  Lo que rompe es el arranque en desarrollo, donde sequelize.sync({ alter: true })\n' +
    '  intenta convertir la columna. Se arregla con una migración, no con el modelo.'
  );

  return false;
}

async function main() {
  await sequelize.authenticate();

  const nombres = Object.keys(modelos).filter((n) => esModelo(modelos[n])).sort();

  if (nombres.length === 0) {
    // Si esto pasa, el script se está mintiendo a sí mismo: pasaría en verde
    // sin haber verificado nada.
    throw new Error('No se encontró ningún modelo en src/models. El chequeo no verificó nada.');
  }

  const lee = await verificarLectura(nombres);
  const tipa = await verificarTipos(nombres);

  if (lee && tipa) {
    console.log('\n[esquema] El esquema sirve y es el que los modelos declaran.');
    return;
  }

  // El código de salida es lo que pone el paso de CI en rojo.
  process.exitCode = 1;
}

// Solo corre si se ejecuta directo. Cuando lo importa un test, se exportan las
// funciones puras sin abrir una conexión: la comparación se ejercita con
// modelos y columnas inventadas, que es la única forma de probar que detecta
// una divergencia sin fabricar una base rota.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`[esquema] ${motivo(err)}`);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}

module.exports = { compararTipos, describirModelo, udtEsperado, UDT_POR_TIPO };
