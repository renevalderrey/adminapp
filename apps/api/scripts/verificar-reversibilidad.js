#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  El `down` de cada migración, CORRIDO — el paso manual P5
 *
 *  Requisito del proyecto 0 de `docs/PROXIMOS-PROYECTOS.md`, textual: **una
 *  migración que no se puede revertir no se puede probar**. El paso manual P5 de
 *  `docs/specs/012-proveedores-y-ordenes-de-compra/tasks.md` pedía correr
 *  `db:migrate:undo` a mano y mirar el esquema con `\di`.
 *
 *  ── Por qué leer el `down` no alcanza, y por eso existe este script ──
 *
 *  El `IF EXISTS` puede estar perfecto y el `down` fallar igual: por el orden
 *  dentro de la transacción, por un nombre de índice que no coincide con el del
 *  `up`, porque un `DROP TYPE` encuentra el tipo todavía en uso. Y eso **no se
 *  descubre cuando se agrega la migración**: se descubre el día que hay que
 *  revertir un deploy, que es el peor momento posible para enterarse de que la
 *  vuelta atrás no existe.
 *
 *  ── Por qué un script y no un test de integración ──
 *
 *  Porque necesita una base **propia y descartable**, y crearla y destruirla es
 *  la mitad del procedimiento. El arnés de `src/tests/integracion/` corre contra
 *  una base compartida ya migrada, que trunca entre test y test: aplicar y
 *  revertir migraciones ahí le movería el esquema abajo de los pies a cualquier
 *  otra corrida. Lo que sí va en la suite rápida es la guardia estática
 *  `src/tests/reversibilidadDeMigraciones.test.js`, que verifica lo que se puede
 *  verificar sin Postgres —que toda migración exporte un `down`, y que las que
 *  se niegan lo hagan con un mensaje que explique qué hacer—.
 *
 *  ── Qué verifica, migración por migración ──
 *
 *  Para cada migración posterior a `--desde`, en orden ascendente:
 *
 *    1. foto del esquema **antes** de aplicarla;
 *    2. `db:migrate --to <migración>` — su `up`;
 *    3. foto **después del up**;
 *    4. `db:migrate:undo --name <migración>` — su `down`;
 *    5. foto **después del down**, y se COMPARA contra la 1. No se supone que
 *       quedó igual: se compara columna por columna, índice por índice, tipo por
 *       tipo y default por default;
 *    6. el `up` otra vez, y se compara contra la 3.
 *
 *  Las que se niegan a revertirse a propósito —`20260806-esquema-de-permisos`—
 *  se verifican al revés: que el `down` **falle**, que el mensaje diga qué pasa
 *  y qué hacer, y que el esquema quede **intacto** (la 5 igual a la 3). Un
 *  `down` que se niega a medio camino sería peor que uno que revierte mal.
 *
 *  ── Por qué hay datos sembrados y no una base vacía ──
 *
 *  Porque sobre una base vacía casi todo `down` pasa. El `USING …::text::<tipo>`
 *  de los ENUM no convierte una sola fila, la fusión de `recipe_items` no
 *  encuentra ningún duplicado que fusionar, y el `down` que tendría que
 *  restaurarlos no restaura nada. La semilla de `sembrar()` está armada para que
 *  cada una de esas ramas se ejecute: valores de ENUM que **no** son el default,
 *  y dos insumos repetidos —uno con cantidades distintas y otro con la misma,
 *  que son los dos casos que `planificarFusiones` distingue—.
 *
 *  ── Uso ──
 *
 *    node scripts/verificar-reversibilidad.js
 *    node scripts/verificar-reversibilidad.js --conservar       deja la base viva
 *    node scripts/verificar-reversibilidad.js --url postgres://…  usa una propia
 *    node scripts/verificar-reversibilidad.js --desde 20260803-intentos-de-facturacion.js
 *
 *  Sale con código 0 solo si TODAS las migraciones del rango se comportaron como
 *  corresponde. Cualquier diferencia de esquema se imprime como una lista de
 *  líneas «sobra» / «falta», que es lo que hay que arreglar.
 *
 *  ⚠ La base la crea y la borra este script (`favalio-pg-reversibilidad`, puerto
 *  55433). **No usa `favalio-pg-integracion`**: esa es de los tests de
 *  integración y revertirle migraciones la dejaría con el esquema movido.
 * ════════════════════════════════════════════
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

/** La foto de los ENUM sale de la migración misma, no de una copia. */
const { COLUMNAS: COLUMNAS_ENUM } = require('../src/migrations/20260809-tipos-enum-y-indices-de-productos');

const RAIZ_API = path.resolve(__dirname, '..');
const RUTA_MIGRACIONES = path.join(RAIZ_API, 'src', 'migrations');

/** Nombre propio y puerto propio: no se pisa con ninguna otra base del árbol. */
const CONTENEDOR = 'favalio-pg-reversibilidad';
const PUERTO = 55433;
const IMAGEN = 'postgres:16-alpine';
const URL_POR_DEFECTO = `postgres://postgres:postgres@localhost:${PUERTO}/favalio_reversibilidad`;

/**
 * La última migración que NO se verifica.
 *
 * Por defecto, la del hito 5: lo que este script mira es lo que agregaron el
 * hito 6 (proveedores) y el proyecto 0 (las migraciones que no podían recrear la
 * base). Se mueve con `--desde` para verificar más atrás.
 */
const DESDE_POR_DEFECTO = '20260805-historial-de-costos-con-autor.js';

/**
 * Las que se niegan a revertirse **a propósito**, y qué tiene que decir.
 *
 * No alcanza con que falle: el mensaje es la mitad del comportamiento correcto.
 * Alguien que corre un `undo` reflejo después de un deploy raro tiene que leer
 * por qué no se puede y qué hacer si igual hace falta. Las palabras que se
 * exigen acá son las que contestan esas dos preguntas.
 */
const SE_NIEGAN = {
  '20260806-esquema-de-permisos.js': ['no es reversible', 'permisos', 'a mano'],
};

function log(mensaje) {
  console.log(`[reversibilidad] ${mensaje}`);
}

// ════════════════════════════════════════════
//  Procesos
// ════════════════════════════════════════════

/**
 * Corre un comando y devuelve código y salida.
 *
 * `shell` en Windows porque `docker` y `npx` son `.cmd` y `spawn` sin shell no
 * los encuentra — el mismo motivo que `scripts/migrar.js`.
 *
 * La salida se captura además de imprimirse: el mensaje con el que una migración
 * se niega a revertirse es parte de lo que hay que verificar, y para eso hay que
 * tenerlo, no solo verlo pasar.
 */
function correr(comando, argumentos, opciones = {}) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, argumentos, {
      shell: process.platform === 'win32',
      ...opciones,
    });

    let salida = '';
    const juntar = (d) => { salida += d.toString(); };

    proceso.stdout.on('data', juntar);
    proceso.stderr.on('data', juntar);
    proceso.on('close', (codigo) => resolve({ codigo, salida }));
    proceso.on('error', reject);
  });
}

function sequelizeCli(url, argumentos) {
  return correr('npx', [
    'sequelize-cli', ...argumentos,
    '--config', 'src/config/sequelize-cli.js',
    '--migrations-path', 'src/migrations',
  ], {
    cwd: RAIZ_API,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DB_SSL: 'false',
      // Sin esto, `config/database.js` loguea cada consulta de las migraciones.
      NODE_ENV: 'test',
    },
  });
}

const migrarHasta = (url, archivo) => sequelizeCli(url, ['db:migrate', '--to', archivo]);

/**
 * El `down` de UNA migración.
 *
 * `--name` y no el `db:migrate:undo` pelado: como el recorrido es ascendente, la
 * migración bajo prueba siempre es la última aplicada y las dos formas hacen lo
 * mismo — pero nombrarla hace que el script no dependa del orden que el CLI
 * infiera, que es justo una de las cosas que puede fallar.
 */
const revertir = (url, archivo) => sequelizeCli(url, ['db:migrate:undo', '--name', archivo]);

// ════════════════════════════════════════════
//  La base descartable
// ════════════════════════════════════════════

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

async function esperar(url, segundos) {
  for (let i = 0; i < segundos; i += 1) {
    if (await contesta(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function levantar(url) {
  // Se borra antes de crear: una corrida anterior que murió a la mitad deja el
  // contenedor con el esquema a medio revertir, y arrancar sobre eso daría un
  // resultado que no significa nada.
  await correr('docker', ['rm', '-f', CONTENEDOR]);

  const { port, pathname, username, password } = new URL(url);

  log(`Creando la base descartable ${CONTENEDOR} (${IMAGEN}) en el puerto ${port}.`);

  const { codigo, salida } = await correr('docker', [
    'run', '-d', '--name', CONTENEDOR,
    '-e', `POSTGRES_USER=${username}`,
    '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', `POSTGRES_DB=${pathname.replace(/^\//, '')}`,
    '-p', `${port}:5432`,
    IMAGEN,
  ]);

  if (codigo !== 0) {
    throw new Error(
      `No se pudo crear el contenedor:\n${salida}\n\n` +
      'Si no tenés Docker, levantá un Postgres vacío como quieras y pasalo con --url.'
    );
  }
}

const bajar = () => correr('docker', ['rm', '-f', CONTENEDOR]);

// ════════════════════════════════════════════
//  Las fotos
// ════════════════════════════════════════════

/**
 * Cada consulta devuelve una lista de líneas comparables.
 *
 * Son líneas de texto y no objetos a propósito: la comparación tiene que poder
 * decir «sobra esto» y «falta esto otro» con algo que se lea en una terminal, y
 * un diff de objetos anidados no se lee.
 */
const CONSULTAS_DE_ESQUEMA = {
  tablas: `
    SELECT table_name AS linea
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY 1
  `,

  // `column_default` y `udt_name` están acá porque son exactamente los dos que
  // un `down` mal escrito pierde: el default que el `ALTER TYPE` obligó a soltar
  // y no repuso, y la columna que volvió a `varchar` pero con otro tipo abajo.
  //
  // ⚠ `ordinal_position` NO entra, y conviene que quede escrito para que nadie
  // lo agregue de nuevo. `information_schema` lo saca del `attnum` de Postgres, y
  // Postgres **no reutiliza el attnum de una columna borrada**: después de un
  // `DROP COLUMN` + `ADD COLUMN` —que es literalmente lo que hacen el `down` y el
  // `up` de `20260807-punto-de-venta-en-cashflow`— la columna vuelve al final de
  // la tabla y con otro número. Medido: 13 la primera vez, 14 después de revertir
  // y volver a aplicar. Ninguna migración puede evitarlo, así que exigirlo pondría
  // en rojo un `down` correcto — y una verificación que ningún código puede
  // satisfacer no verifica nada, solo enseña a ignorar el rojo.
  //
  // La consecuencia real es que una base revertida-y-vuelta-a-migrar no tiene las
  // columnas en el mismo orden que una migrada de una sola vez. No rompe nada acá
  // porque Sequelize enumera las columnas en cada `INSERT` y en cada `SELECT`;
  // rompería un `INSERT INTO … VALUES (…)` sin lista de columnas, que este
  // repositorio no tiene.
  columnas: `
    SELECT table_name || '.' || column_name
           || ' ' || data_type || '(' || udt_name || ')'
           || coalesce(' len=' || character_maximum_length, '')
           || coalesce(' prec=' || numeric_precision || ',' || numeric_scale, '')
           || ' null=' || is_nullable
           || coalesce(' default=' || column_default, ' default=∅') AS linea
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY 1
  `,

  indices: `
    SELECT indexdef AS linea
      FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY 1
  `,

  restricciones: `
    SELECT c.conrelid::regclass::text || ' · ' || c.conname || ' · '
           || pg_get_constraintdef(c.oid) AS linea
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public'
     ORDER BY 1
  `,

  // El ORDEN de los valores va adentro de la línea: en Postgres el orden de un
  // ENUM es el de comparación (`ORDER BY status` ordena por `enumsortorder`), así
  // que dos bases con los mismos valores en distinto orden NO son la misma base.
  //
  // Y los tipos huérfanos se ven acá: un `down` que convierte las columnas pero
  // se olvida de borrar el tipo deja una línea de más.
  tiposEnum: `
    SELECT t.typname || ' = ' || e.enumsortorder || ':' || e.enumlabel AS linea
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     ORDER BY 1
  `,

  secuencias: `
    SELECT sequence_name || ' ' || data_type AS linea
      FROM information_schema.sequences
     WHERE sequence_schema = 'public'
     ORDER BY 1
  `,
};

async function lineas(cliente, sql) {
  const { rows } = await cliente.query(sql);
  return rows.map((r) => r.linea);
}

/**
 * Las filas de una tabla que puede **no existir todavía**.
 *
 * `tiendanube_tiendas` la crea justamente una de las migraciones bajo prueba: la
 * foto de «antes» se toma cuando la tabla no está, y una consulta a secas
 * cortaría el script con «relation does not exist» en vez de verificar nada.
 * Devolver la lista vacía es lo correcto —antes de la migración no había ninguna
 * fila— y hace que la comparación siga significando lo mismo.
 */
async function lineasSiExiste(cliente, tabla, sql) {
  const { rows } = await cliente.query(`SELECT to_regclass('public.${tabla}') IS NOT NULL AS hay`);

  return rows[0].hay ? lineas(cliente, sql) : [];
}

async function fotoDelEsquema(cliente) {
  const foto = {};

  for (const [seccion, sql] of Object.entries(CONSULTAS_DE_ESQUEMA)) {
    foto[seccion] = await lineas(cliente, sql);
  }

  return foto;
}

/**
 * Los datos que las migraciones del rango tocan.
 *
 * No es la base entera: es lo que una de estas migraciones puede romper. Las
 * filas de `recipe_items` porque `20260809-unico-de-insumo-por-receta` las
 * fusiona y su `down` las tiene que reponer con su id original, y el valor de
 * cada columna ENUM porque el `USING …::text::<tipo>` de ida y el `USING …::text`
 * de vuelta son dos casts que pueden no ser inversos.
 *
 * Y las filas de `settings` porque `20260810-tiendanube-vinculacion-y-estado`
 * **muda** una de ellas a una tabla nueva y su `down` la tiene que devolver. Sin
 * esta sección, ese `down` podría no reinsertar nada y el script saldría en
 * verde igual: el esquema queda idéntico de las dos maneras —la tabla `settings`
 * no cambia de forma—, así que lo único que distingue un `down` correcto de uno
 * roto es **la fila**. Es literalmente el punto ciego que el encabezado de este
 * archivo advierte, con otro nombre.
 *
 * ⚠ `updated_at` queda AFUERA a propósito y no es un descuido: el `down` de la
 * fusión repone la cantidad con `updated_at = NOW()`, así que compararlo daría
 * una diferencia en cada corrida que no dice nada sobre si la reversión sirvió.
 * `created_at` sí entra donde el `down` lo restaura desde el archivo, y si lo
 * perdiera, la fila reinsertada no sería la misma fila. En `settings` **las dos
 * fechas quedan afuera**: la fila que el `down` de `20260810` reinserta nace con
 * `NOW()` —la tabla nueva no guarda la fecha original de la fila de `settings`—
 * y compararlas pondría en rojo un `down` que hizo exactamente lo que tenía que
 * hacer. Lo que sí se compara es la clave, la empresa y el valor, que es el dato.
 */
async function fotoDeLosDatos(cliente) {
  const foto = {
    recipe_items: await lineas(cliente, `
      SELECT id || ' receta=' || recipe_id || ' insumo=' || ingredient_product_id
             || ' cantidad=' || quantity::text
             || ' alta=' || created_at::text AS linea
        FROM recipe_items
       ORDER BY id
    `),

    settings: await lineas(cliente, `
      SELECT key || ' empresa=' || empresa_id || ' = ' || coalesce(value::text, '∅') AS linea
        FROM settings
       ORDER BY key, empresa_id
    `),

    // El `ALTER TYPE` de ida y el de vuelta son dos casts que pueden no ser
    // inversos. Sobre una tabla vacía los dos pasan sin tocar nada, así que sin
    // una fila acá el ensanchado a BIGINT y su reversa se verifican solos.
    tiendanube_mappings: await lineasSiExiste(cliente, 'tiendanube_mappings', `
      SELECT id || ' empresa=' || empresa_id || ' producto=' || product_id
             || ' variante=' || tiendanube_variant_id
             || ' productoTN=' || tiendanube_product_id AS linea
        FROM tiendanube_mappings
       ORDER BY id
    `),

    // Sin las fechas: `vinculada_en` es `NOW()` y la segunda aplicación de la
    // migración cae en otro instante, así que compararlas pondría en rojo un
    // `up` idéntico. Lo que importa es cuál sucursal quedó designada, que es el
    // número que decide qué stock se publica y de dónde se descuenta.
    tiendanube_tiendas: await lineasSiExiste(cliente, 'tiendanube_tiendas', `
      SELECT 'empresa=' || empresa_id || ' tienda=' || tiendanube_user_id
             || ' sucursal=' || punto_de_venta_id AS linea
        FROM tiendanube_tiendas
       ORDER BY empresa_id
    `),

    // `20260813-gastos-fijos-a-su-sucursal` **mueve datos sin cambiarle la forma
    // a esta tabla**: con un `down` que no restaure nada el esquema queda
    // idéntico y el script saldría en verde igual. Lo único que distingue los dos
    // casos es el `punto_de_venta_id` de cada fila, y solo se compara si está
    // acá. Es el mismo punto ciego que la fila de `settings`, con otra tabla.
    //
    // ⚠ `updated_at` queda AFUERA a propósito, igual que en `recipe_items`: el
    // `up` lo pone en `NOW()`, así que la segunda aplicación cae en otro instante
    // y compararlo pondría en rojo un `up` idéntico. `created_at` sí entra: la
    // migración no lo toca, y una fila que vuelve con otra fecha de alta no es la
    // misma fila. `"group"` va entre comillas porque GROUP es palabra reservada.
    fixed_expenses: await lineas(cliente, `
      SELECT id || ' empresa=' || empresa_id
             || ' sucursal=' || coalesce(punto_de_venta_id::text, '∅')
             || ' importe=' || amount::text
             || ' grupo=' || "group"
             || ' alta=' || created_at::text AS linea
        FROM fixed_expenses
       ORDER BY id
    `),

    // Lo que el `up` archivó. Antes de la migración la tabla no existe y después
    // del `down` tampoco, así que esas dos fotos dan la lista vacía y el viaje de
    // ida y vuelta se verifica arriba. Lo que agrega esta sección es la
    // comparación entre la PRIMERA aplicación y la segunda: un `up` cuyo plan
    // dependiera del estado que él mismo dejó archivaría distinto la segunda vez,
    // y sin esto las dos corridas se verían iguales.
    fixed_expenses_sin_sucursal: await lineasSiExiste(cliente, 'fixed_expenses_sin_sucursal', `
      SELECT 'empresa=' || empresa_id || ' gasto=' || fixed_expense_id
             || ' → sucursal=' || punto_de_venta_id_asignado AS linea
        FROM fixed_expenses_sin_sucursal
       ORDER BY fixed_expense_id
    `),
  };

  for (const { tabla, columna } of COLUMNAS_ENUM) {
    foto[`${tabla}.${columna}`] = await lineas(cliente, `
      SELECT id || ' = ' || coalesce(${columna}::text, '∅') AS linea
        FROM ${tabla}
       ORDER BY id
    `);
  }

  return foto;
}

const fotoCompleta = async (cliente) => ({
  ...await fotoDelEsquema(cliente),
  datos: await fotoDeLosDatos(cliente),
});

/**
 * Las diferencias entre dos fotos, como líneas legibles.
 *
 * Se comparan como MULTICONJUNTOS y no como conjuntos: dos filas idénticas
 * cuentan dos veces, porque «quedó una de más» es un resultado posible.
 */
function diferencias(esperada, obtenida, prefijo = '') {
  const salida = [];

  for (const seccion of Object.keys(esperada)) {
    const a = esperada[seccion];
    const b = obtenida[seccion];

    if (!Array.isArray(a)) {
      salida.push(...diferencias(a, b || {}, `${prefijo}${seccion}/`));
      continue;
    }

    const cuenta = new Map();

    for (const linea of a) cuenta.set(linea, (cuenta.get(linea) || 0) + 1);
    for (const linea of b) cuenta.set(linea, (cuenta.get(linea) || 0) - 1);

    for (const [linea, n] of cuenta) {
      if (n > 0) salida.push(`  FALTA  ${prefijo}${seccion}: ${linea}`);
      if (n < 0) salida.push(`  SOBRA  ${prefijo}${seccion}: ${linea}`);
    }
  }

  return salida;
}

// ════════════════════════════════════════════
//  La semilla
// ════════════════════════════════════════════

/**
 * Datos mínimos para que los `down` tengan algo que revertir.
 *
 * Cada valor está elegido: los ENUM van con valores que **no** son el default
 * —`compras`, `revoked`, `voided`, `partial`, `past_due`— porque una conversión
 * que perdiera el valor y lo dejara en el default pasaría desapercibida con
 * datos por defecto. Y los `recipe_items` traen los dos casos que
 * `planificarFusiones` distingue: cantidades distintas (dos momentos de la misma
 * receta) e idénticas (una línea cargada dos veces, que se marca `revisar`).
 *
 * ── Lo que se agregó para `20260810-tiendanube-vinculacion-y-estado` ──
 *
 * Esa migración **mueve datos**: pasa `settings.tiendanube_user_id` a
 * `tiendanube_tiendas` y su `down` lo tiene que devolver. Hasta acá esta semilla
 * no tocaba `settings`, `puntos_de_venta`, `stock` ni `tiendanube_mappings`, así
 * que **la única migración con datos del hito habría pasado en verde sin
 * ejecutar su rama**: el `down` no habría restaurado ninguna fila y el script
 * habría comparado dos esquemas idénticos. Es exactamente lo que el encabezado
 * de este archivo advierte —«sobre una base vacía casi todo `down` pasa»— con un
 * caso nuevo.
 *
 * Cada cosa que se agrega tiene su motivo escrito al lado, en el SQL.
 */
async function sembrar(cliente) {
  const sql = `
    INSERT INTO empresas (id, name, created_at, updated_at) VALUES
      (1, 'Empresa de prueba', NOW(), NOW()),
      -- La segunda existe SOLO para la rama de la migración de TiendaNube que
      -- deja una fila sin mudar: no tiene ninguna sucursal, así que no puede
      -- tener una sucursal designada, que es NOT NULL. Sin esta empresa esa rama
      -- no se ejecuta nunca, y una rama que no se ejecuta es una rama que nadie
      -- sabe si funciona.
      (2, 'Empresa sin sucursales', NOW(), NOW());
    SELECT setval(pg_get_serial_sequence('empresas', 'id'), 2);

    -- Dos sucursales de la empresa 1, y la de \`code = 'principal'\` NO es la de
    -- menor id. La migración resuelve la sucursal designada con un COALESCE de
    -- tres escalones —principal, después la activa de menor id, después la de
    -- menor id— y con UNA sola sucursal los tres devuelven lo mismo: el orden no
    -- se probaría. Acá el primer escalón devuelve la 2 y los otros dos la 1, así
    -- que equivocarse de orden cambia el número que la foto de datos compara.
    INSERT INTO puntos_de_venta (id, empresa_id, name, code, is_active, created_at, updated_at) VALUES
      (1, 1, 'Depósito',     'deposito',  true, NOW(), NOW()),
      (2, 1, 'Casa central', 'principal', true, NOW(), NOW());
    SELECT setval(pg_get_serial_sequence('puntos_de_venta', 'id'), 2);

    INSERT INTO products (id, empresa_id, name, cost, unit_type, category, created_at, updated_at) VALUES
      (1, 1, 'Torta',   0, 'unidad', 'elaborado', NOW(), NOW()),
      (2, 1, 'Harina',  0, 'kg',     'insumo',    NOW(), NOW()),
      (3, 1, 'Azúcar',  0, 'gr',     'insumo',    NOW(), NOW());
    SELECT setval(pg_get_serial_sequence('products', 'id'), 3);

    INSERT INTO recipes (id, empresa_id, product_id, created_at, updated_at)
      VALUES (1, 1, 1, NOW(), NOW());

    -- ⚠ Las cuatro filas de abajo son DOS PARES DUPLICADOS a propósito, porque
    -- son lo que \`20260809-unico-de-insumo-por-receta\` tiene que fusionar. Pero
    -- esa misma migración crea el índice único que los prohíbe.
    --
    -- Y esta siembra corre DESPUÉS de aplicar todas las migraciones anteriores a
    -- la que se está verificando. O sea: verificar cualquier migración posterior
    -- a la 20260809 sembraba contra un esquema que ya tenía el índice, y el
    -- script moría con «duplicate key value violates unique constraint
    -- idx_recipe_items_recipe_ingredient» **antes de verificar nada**.
    --
    -- Es un defecto que nació dormido: mientras la 20260809 fue la última, el
    -- índice todavía no existía al sembrar. Desde la 20260810 el script no pudo
    -- verificar una sola migración más, y no se notó porque lo que reporta es un
    -- error de siembra y no un rojo de reversibilidad.
    --
    -- La siembra pasa a mirar el esquema que le tocó: con el índice puesto
    -- siembra las filas sin duplicar —los pares fusionados, que es exactamente
    -- lo que ese índice garantiza que hay—, y sin el índice siembra los cuatro,
    -- que es lo que la 20260809 necesita para ejercitar \`planificarFusiones\`.
    DO $\$
    BEGIN
      IF to_regclass('public.idx_recipe_items_recipe_ingredient') IS NULL THEN
        INSERT INTO recipe_items (id, recipe_id, ingredient_product_id, quantity, created_at, updated_at) VALUES
          (1, 1, 2, 0.2000, NOW(), NOW()),
          (2, 1, 2, 0.0500, NOW(), NOW()),
          (3, 1, 3, 1.0000, NOW(), NOW()),
          (4, 1, 3, 1.0000, NOW(), NOW());
      ELSE
        INSERT INTO recipe_items (id, recipe_id, ingredient_product_id, quantity, created_at, updated_at) VALUES
          (1, 1, 2, 0.2500, NOW(), NOW()),
          (3, 1, 3, 2.0000, NOW(), NOW());
      END IF;
    END
    $\$;
    SELECT setval(pg_get_serial_sequence('recipe_items', 'id'), (SELECT MAX(id) FROM recipe_items));

    INSERT INTO cashflow_entries (empresa_id, type, category, amount, entry_date, created_at, updated_at) VALUES
      (1, 'inflow',  'ventas', 1500.55, CURRENT_DATE, NOW(), NOW()),
      (1, 'outflow', 'otro',    300.25, CURRENT_DATE, NOW(), NOW());

    INSERT INTO invitaciones (empresa_id, email, role, token, status, expires_at, created_at, updated_at)
      VALUES (1, 'alguien@ejemplo.com', 'compras', 'token-de-prueba', 'revoked', NOW() + interval '7 days', NOW(), NOW());

    INSERT INTO production_orders
      (empresa_id, product_id, quantity_produced, batch_code, production_date,
       unit_cost_calculated, total_cost, status, created_at, updated_at)
      VALUES (1, 1, 10.0000, 'LOTE-1', CURRENT_DATE, 12.3400, 123.40, 'voided', NOW(), NOW());

    INSERT INTO suppliers (id, empresa_id, name, cuit, created_at, updated_at)
      VALUES (1, 1, 'Distribuidora Sur', '30123456789', NOW(), NOW());

    INSERT INTO supplier_orders (empresa_id, supplier_id, date, total, status, created_at, updated_at)
      VALUES (1, 1, CURRENT_DATE, 72000.55, 'partial', NOW(), NOW());

    INSERT INTO supplier_movements (empresa_id, supplier_id, type, date, amount, created_at, updated_at) VALUES
      (1, 1, 'deuda', CURRENT_DATE, 72000.55, NOW(), NOW()),
      (1, 1, 'pago',  CURRENT_DATE, 50000.25, NOW(), NOW());

    INSERT INTO suscripciones (empresa_id, plan, status, trial_starts_at, trial_ends_at, created_at, updated_at)
      VALUES (1, 'free', 'past_due', NOW(), NOW() + interval '14 days', NOW(), NOW());

    -- ════════ Lo que la migración de datos de TiendaNube necesita ════════

    -- Una fila de stock en la sucursal que la migración va a designar. La
    -- sucursal designada es de donde sale el stock que se publica y a la que se
    -- le descuenta el pedido: sembrarla vacía haría que «eligió la correcta» y
    -- «eligió cualquiera» se vean igual el día que alguien mire los datos. Es
    -- además lo que le da sentido al ON DELETE RESTRICT de la FK a
    -- \`puntos_de_venta\`: hay mercadería colgando de esa sucursal.
    INSERT INTO stock (empresa_id, product_id, punto_de_venta_id, location, quantity, available, created_at, updated_at)
      VALUES (1, 1, 2, 'principal', 12, 9, NOW(), NOW());

    -- Tres filas de \`settings\`, y las tres tienen que terminar distinto:
    --
    --   · la de la empresa 1 se MUDA a tiendanube_tiendas y se borra de acá;
    --   · el token de la MISMA empresa NO se toca —el token se queda en
    --     settings a propósito (FR-077), y un \`DELETE ... WHERE empresa_id = ...\`
    --     mal escrito se lo llevaría puesto—;
    --   · la de la empresa 2 no se muda, porque esa empresa no tiene sucursales.
    --
    -- El valor va como NÚMERO y no como texto porque es lo que \`Setting.upsert\`
    -- producía con el user_id de la respuesta del OAuth, y es la forma a la que
    -- el \`down\` lo devuelve (\`to_jsonb(bigint)\`). Con un string acá, el viaje de
    -- ida y vuelta cambiaría el tipo del JSON y la comparación reportaría una
    -- diferencia que no es un defecto.
    INSERT INTO settings (key, empresa_id, value, created_at, updated_at) VALUES
      ('tiendanube_user_id',      1, to_jsonb(1234567890::bigint),        NOW(), NOW()),
      ('tiendanube_access_token', 1, to_jsonb('token-que-no-se-toca'::text), NOW(), NOW()),
      ('tiendanube_user_id',      2, to_jsonb(987654321::bigint),         NOW(), NOW());

    -- Un mapeo con un id de variante grande pero DENTRO de int4. Es lo que le da
    -- al \`ALTER TYPE ... BIGINT\` de ida y al \`... INTEGER\` de vuelta una fila que
    -- convertir: sobre una tabla vacía los dos ALTER pasan sin tocar nada y el
    -- \`down\` parecería correcto aunque perdiera el valor. 2147483647 es
    -- exactamente el tope de int4, que es el caso que más cerca está de romperse.
    INSERT INTO tiendanube_mappings (empresa_id, product_id, tiendanube_variant_id, tiendanube_product_id, created_at, updated_at)
      VALUES (1, 1, 2147483647, 2147483646, NOW(), NOW());

    -- ════════ Lo que la migración de gastos fijos necesita ════════
    --
    -- \`20260813-gastos-fijos-a-su-sucursal\` asigna los gastos sin sucursal a la
    -- sucursal por defecto de su empresa. **Sin filas acá su \`up\` no movería
    -- ninguna, su \`down\` no restauraría ninguna, y las dos fotos darían iguales
    -- por la razón equivocada**: el mismo verde vacío que el encabezado de este
    -- archivo advierte para los ENUM y para la fusión de recetas, y que la
    -- migración de TiendaNube ya pagó una vez.
    --
    -- Las cuatro filas son las cuatro ramas, y ninguna es decorativa:
    --
    --   · id 1 · empresa 1, SIN sucursal: se mueve, y tiene que terminar en la 2
    --     ('principal'), no en la 1. Es lo que distingue \`elegirPorDefecto\` de un
    --     \`ORDER BY id LIMIT 1\`.
    --   · id 2 · empresa 1, SIN sucursal y con \`group = 'gf2'\`: se mueve IGUAL.
    --     El \`group\` no se mira —'gf2' solo significa una sucursal concreta para
    --     Comprafit— y sin esta fila un \`up\` que lo interpretara pasaría en verde.
    --   · id 3 · empresa 1, CON sucursal: la migración NO la toca. Es lo que
    --     detecta un \`UPDATE\` sin \`WHERE punto_de_venta_id IS NULL\`, y un \`down\`
    --     que ponga todo en NULL a lo bruto en vez de leer el archivo.
    --   · id 4 · empresa 2, que no tiene ninguna sucursal cargada: se queda como
    --     está y se informa aparte. Es la rama que no se ejecuta nunca si todas
    --     las empresas de la semilla tienen sucursal.
    --
    -- Los importes llevan centavos que NO cierran en punto flotante —180000.10 +
    -- 42500.20 acumulado con parseFloat da 222500.59999999998—: el informe de la
    -- migración suma el total movido, y con importes redondos las dos sumas dan
    -- lo mismo.
    INSERT INTO fixed_expenses (id, empresa_id, name, amount, "group", punto_de_venta_id, created_at, updated_at) VALUES
      (1, 1, 'Alquiler',         180000.10, 'gf1', NULL, NOW(), NOW()),
      (2, 1, 'Contador',          42500.20, 'gf2', NULL, NOW(), NOW()),
      (3, 1, 'Luz del depósito',  12345.67, 'gf1', 1,    NOW(), NOW()),
      (4, 2, 'Monotributo',           0.30, 'gf1', NULL, NOW(), NOW());
    SELECT setval(pg_get_serial_sequence('fixed_expenses', 'id'), 4);

  `;

  await cliente.query(sql);
}

// ════════════════════════════════════════════
//  La verificación
// ════════════════════════════════════════════

/**
 * Las migraciones posteriores a `desde`, en el orden en que las corre el CLI.
 *
 * `desde` puede ser el nombre completo del archivo o un **prefijo**, que es como
 * se escribe a mano: `--desde 20260809`. Con prefijo se toma la ÚLTIMA que
 * empieza así —«todo lo posterior al 9 de agosto»—, porque hay días con más de
 * una migración y quedarse con la primera dejaría a la segunda dentro del rango
 * sin que nadie lo pidiera.
 */
function migracionesDelRango(desde) {
  const todas = fs.readdirSync(RUTA_MIGRACIONES).filter((f) => f.endsWith('.js')).sort();

  return todas.slice(todas.indexOf(resolverMigracion(desde)) + 1);
}

/**
 * El nombre de archivo completo de una migración, a partir de un prefijo.
 *
 * Hace falta en dos lugares y por eso está aparte: el rango que se recorre y el
 * `db:migrate --to` con el que se arranca. La primera versión resolvía el
 * prefijo solo en el rango, y el `--to` recibía `20260809` tal cual: el CLI no
 * migraba nada, la semilla corría contra una base vacía y el script cortaba con
 * «relation "empresas" does not exist». Un prefijo que se entiende a medias es
 * peor que uno que no se entiende.
 */
function resolverMigracion(desde) {
  const todas = fs.readdirSync(RUTA_MIGRACIONES).filter((f) => f.endsWith('.js')).sort();

  if (todas.includes(desde)) return desde;

  // La ÚLTIMA que empieza así —«todo lo posterior al 9 de agosto»—, porque hay
  // días con más de una migración y quedarse con la primera dejaría a la segunda
  // dentro del rango sin que nadie lo pidiera.
  const indice = todas.findLastIndex((f) => f.startsWith(desde));

  if (indice === -1) {
    throw new Error(`--desde ${desde} no existe en src/migrations. Las que hay:\n  ${todas.join('\n  ')}`);
  }

  return todas[indice];
}

/**
 * Filas para las tablas que la migración que se está verificando acaba de crear.
 *
 * Es idempotente y silenciosa: si la tabla no existe todavía —porque se está
 * verificando una migración anterior— no hace nada. Corre entre el `up` y el
 * `down`, que es el único momento en que estas tablas existen y siguen vacías.
 */
async function sembrarLoQueAcabaDeNacer(cliente) {
  await cliente.query(`
    -- ════════ Lo que necesita la etapa 1 del hito 10 ════════
    --
    -- Sin estas filas las tres migraciones del catálogo revierten bien sobre
    -- tablas vacías, las dos fotos del esquema dan iguales, y el informe dice
    -- «BIEN» sin haber ejecutado una sola rama. Es exactamente lo que advierte
    -- el encabezado de este archivo: sobre una base vacía casi todo down pasa.
    --
    -- Va condicionado a que las tablas existan, porque este mismo sembrado
    -- corre también para verificar migraciones ANTERIORES a las que las crean.
    DO $BLOQUE$
    BEGIN
      IF to_regclass('public.catalogos') IS NULL THEN RETURN; END IF;

      -- Un catálogo PUBLICADO y colgado del punto de venta 2, que es el que ya
      -- tiene stock sembrado: así el ON DELETE RESTRICT de
      -- catalogos.punto_de_venta_id tiene algo que restringir de verdad.
      INSERT INTO catalogos (id, empresa_id, punto_de_venta_id, slug, nombre_visible,
                             descripcion, color_marca, estado, publicado_en,
                             envio, envio_costo, envio_gratis_desde,
                             created_at, updated_at)
        VALUES (1, 1, 2, 'comprafit-fitnet', 'Comprafit / Fitnet',
                'Suplementos con precio de socio.', '#00B4B6', 'publicado', NOW(),
                true, 2500.50, 50000.00, NOW(), NOW())
        ON CONFLICT DO NOTHING;
      PERFORM setval(pg_get_serial_sequence('catalogos', 'id'), 1);

      -- La lista de inclusión con dos de los tres productos: uno adentro y otro
      -- afuera hace que «publica lo elegido» y «publica todo» den distinto.
      -- Cada grupo con su propio guardia: el recorrido es ascendente, así que
      -- cuando se verifica 20260815 existe catalogos y todavía no existen estas
      -- dos. Un solo guardia arriba dejaría el INSERT contra una tabla que no
      -- está y el script moriría diciendo «relation does not exist», que se lee
      -- como un problema de la migración y no de la siembra.
      IF to_regclass('public.catalogo_productos') IS NULL THEN RETURN; END IF;

      INSERT INTO catalogo_productos (catalogo_id, product_id, orden, created_at, updated_at) VALUES
        (1, 1, 0, NOW(), NOW()),
        (1, 2, 1, NOW(), NOW())
      ON CONFLICT DO NOTHING;

      -- UNA REGLA DE CADA ÁMBITO. Es lo que ejercita el CHECK ck_regla_ambito y
      -- los cuatro índices únicos parciales: con reglas de un solo ámbito, tres
      -- de los cuatro índices no se tocan nunca.
      INSERT INTO catalogo_reglas_precio
        (empresa_id, catalogo_id, ambito, categoria, brand_id, product_id, tipo, valor, activo, created_at, updated_at) VALUES
        (1, 1, 'catalogo',  NULL,      NULL, NULL, 'porcentaje_descuento', 10.00, true,  NOW(), NOW()),
        (1, 1, 'categoria', 'insumo',  NULL, NULL, 'porcentaje_descuento', 12.50, true,  NOW(), NOW()),
        (1, 1, 'producto',  NULL,      NULL, 1,    'precio_fijo',          999.99, false, NOW(), NOW())
      ON CONFLICT DO NOTHING;

      -- La de ámbito 'marca' sólo si hay una marca sembrada, porque brand_id es
      -- NOT NULL para ese ámbito por el CHECK.
      IF EXISTS (SELECT 1 FROM brands LIMIT 1) THEN
        INSERT INTO catalogo_reglas_precio
          (empresa_id, catalogo_id, ambito, categoria, brand_id, product_id, tipo, valor, activo, created_at, updated_at)
          SELECT 1, 1, 'marca', NULL, id, NULL, 'monto_descuento', 300.75, true, NOW(), NOW()
          FROM brands ORDER BY id LIMIT 1
        ON CONFLICT DO NOTHING;
      END IF;

      IF to_regclass('public.catalogo_visitas') IS NULL THEN RETURN; END IF;

      -- DOS filas del mismo día y el mismo origen, con estados distintos. Es el
      -- caso que justifica que estado_catalogo esté en la clave única: con una
      -- sola fila, la clave de tres columnas y la de cuatro se comportan igual.
      INSERT INTO catalogo_visitas (catalogo_id, fecha, origen, estado_catalogo, cantidad, created_at, updated_at) VALUES
        (1, CURRENT_DATE, 'qr', 'publicado', 37, NOW(), NOW()),
        (1, CURRENT_DATE, 'qr', 'pausado',    4, NOW(), NOW())
      ON CONFLICT DO NOTHING;
    END
    $BLOQUE$;
  `);
}

/**
 * Una migración, de ida y de vuelta.
 *
 * @returns {{archivo: string, ok: boolean, notas: string[]}}
 */
async function verificarUna(url, cliente, archivo) {
  const notas = [];
  const seNiega = SE_NIEGAN[archivo];

  const antes = await fotoCompleta(cliente);

  const up = await migrarHasta(url, archivo);
  if (up.codigo !== 0) {
    return { archivo, ok: false, notas: [`El \`up\` falló:\n${up.salida}`] };
  }

  const despuesDelUp = await fotoCompleta(cliente);

  // ⚠ Sembrar DESPUÉS del `up` y antes del `down`.
  //
  // `sembrar()` corre una sola vez, antes de aplicar el rango: para una
  // migración que **crea** una tabla, esa siembra no puede poner nada adentro
  // —la tabla todavía no existe— y el `down` termina corriendo sobre una tabla
  // vacía. El informe dice BIEN sin haber ejecutado ninguna rama, que es
  // exactamente lo que el encabezado de este archivo advierte.
  //
  // La foto ya se tomó arriba, así que estas filas no ensucian la comparación:
  // el `down` se las lleva junto con la tabla, y `antes` nunca las vio.
  await sembrarLoQueAcabaDeNacer(cliente);

  const sinCambios = diferencias(antes, despuesDelUp);
  if (!sinCambios.length) {
    // No es un error, pero sí algo que hay que saber: si el `up` no movió el
    // esquema ni los datos, revertirlo tampoco prueba nada, y este resultado en
    // verde es un verde vacío.
    notas.push('⚠ El `up` no cambió NADA del esquema ni de los datos observados: revertirlo no prueba mucho.');
  }

  const down = await revertir(url, archivo);

  // ── Las que se niegan a propósito ──
  if (seNiega) {
    if (down.codigo === 0) {
      return { archivo, ok: false, notas: [...notas, 'El `down` NO se negó: se esperaba que fallara y terminó bien.'] };
    }

    const texto = down.salida.toLowerCase();
    const faltantes = seNiega.filter((palabra) => !texto.includes(palabra.toLowerCase()));

    if (faltantes.length) {
      notas.push(
        `El mensaje del rechazo no dice: ${faltantes.join(', ')}. Un "no se puede" sin ` +
        `explicación deja a alguien sin saber qué hacer.\n${down.salida}`
      );
    }

    // Que se niegue A TIEMPO: un `down` que revienta después de haber borrado
    // media tabla es peor que uno que revierte mal.
    const despuesDelRechazo = await fotoCompleta(cliente);
    const dano = diferencias(despuesDelUp, despuesDelRechazo);

    if (dano.length) {
      notas.push(`El \`down\` falló PERO dejó el esquema tocado:\n${dano.join('\n')}`);
    }

    return { archivo, ok: !faltantes.length && !dano.length, notas };
  }

  // ── Las reversibles ──
  if (down.codigo !== 0) {
    return { archivo, ok: false, notas: [...notas, `El \`down\` falló:\n${down.salida}`] };
  }

  const despuesDelDown = await fotoCompleta(cliente);
  const vuelta = diferencias(antes, despuesDelDown);

  if (vuelta.length) {
    notas.push(`El \`down\` corrió sin error pero el esquema NO quedó como estaba:\n${vuelta.join('\n')}`);
  }

  // El `up` de nuevo: una migración que solo se puede aplicar una vez no sirve
  // para volver adelante después de un rollback.
  const reUp = await migrarHasta(url, archivo);

  if (reUp.codigo !== 0) {
    notas.push(`El \`up\` posterior al \`down\` falló:\n${reUp.salida}`);
    return { archivo, ok: false, notas };
  }

  const despuesDelReUp = await fotoCompleta(cliente);
  const ida = diferencias(despuesDelUp, despuesDelReUp);

  if (ida.length) {
    notas.push(`El \`up\` volvió a correr pero dejó la base distinta de la primera vez:\n${ida.join('\n')}`);
  }

  return { archivo, ok: !vuelta.length && !ida.length, notas };
}

async function main() {
  // `dotenv` va acá adentro y no arriba de todo: `src/tests/reversibilidadDeMigraciones.test.js`
  // importa este archivo para revisar sus constantes, y un `.config()` al
  // importar le metería el `.env` de desarrollo al proceso de jest —incluida
  // `DATABASE_URL`— para todos los archivos que compartan ese worker.
  require('dotenv').config();

  const argumentos = process.argv.slice(2);
  const valorDe = (bandera) => {
    const i = argumentos.indexOf(bandera);
    return i === -1 ? null : argumentos[i + 1];
  };

  const urlPropia = valorDe('--url');
  const url = urlPropia || URL_POR_DEFECTO;
  const conservar = argumentos.includes('--conservar');
  // Se resuelve UNA vez y se usa para las dos cosas: el rango que se recorre y
  // el `--to` con el que se arranca. Si las dos no hablan del mismo archivo, la
  // semilla corre contra una base que no tiene las tablas.
  const desde = resolverMigracion(valorDe('--desde') || DESDE_POR_DEFECTO);

  const rango = migracionesDelRango(desde);

  if (!rango.length) {
    throw new Error(`No hay ninguna migración posterior a ${desde}: no hay nada que verificar.`);
  }

  log(`Se van a verificar ${rango.length} migración(es), de ${rango[0]} a ${rango[rango.length - 1]}.`);

  if (!urlPropia) await levantar(url);

  if (!(await esperar(url, 60))) {
    throw new Error(`No hay Postgres escuchando en ${url.replace(/:[^:@/]*@/, ':***@')}.`);
  }

  const cliente = new Client({ connectionString: url, ssl: false });
  await cliente.connect();

  const resultados = [];

  try {
    log(`Aplicando todo hasta ${desde} para partir del esquema que estas migraciones encuentran.`);
    const base = await migrarHasta(url, desde);

    if (base.codigo !== 0) {
      throw new Error(`Las migraciones previas fallaron, así que no hay de dónde partir:\n${base.salida}`);
    }

    log('Sembrando los datos que los `down` tienen que saber revertir.');
    await sembrar(cliente);

    for (const archivo of rango) {
      log(`── ${archivo}`);
      const resultado = await verificarUna(url, cliente, archivo);
      resultados.push(resultado);

      console.log(`   ${resultado.ok ? 'BIEN' : 'MAL '} · ${archivo}`);
      for (const nota of resultado.notas) console.log(`        ${nota.replace(/\n/g, '\n        ')}`);
    }
  } finally {
    await cliente.end().catch(() => {});

    if (!urlPropia && !conservar) {
      log(`Borrando ${CONTENEDOR}.`);
      await bajar();
    } else if (conservar) {
      log(`Se conserva ${CONTENEDOR}. Para borrarlo: docker rm -f ${CONTENEDOR}`);
    }
  }

  const mal = resultados.filter((r) => !r.ok);

  console.log('');
  log(`${resultados.length - mal.length} de ${resultados.length} migración(es) revierten como corresponde.`);

  if (mal.length) {
    log(`Hay que arreglar: ${mal.map((r) => r.archivo).join(', ')}`);
    process.exit(1);
  }
}

// El `require.main` no es ceremonia: sin él, importar este archivo desde un test
// levantaría un contenedor de Postgres y le aplicaría migraciones a una base.
if (require.main === module) {
  main().catch((err) => {
    console.error(`\n[reversibilidad] ${err.message}\n`);
    process.exit(1);
  });
}

// Lo que revisa la guardia estática de `src/tests/reversibilidadDeMigraciones.test.js`.
// `diferencias` se exporta porque es la pieza de la que depende TODO el
// resultado: un comparador que devolviera siempre la lista vacía dejaría este
// script en verde para siempre, y eso no lo nota nadie mirando la salida.
module.exports = {
  SE_NIEGAN,
  DESDE_POR_DEFECTO,
  CONTENEDOR,
  migracionesDelRango,
  diferencias,
};
