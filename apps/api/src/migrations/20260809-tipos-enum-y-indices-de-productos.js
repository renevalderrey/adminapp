'use strict';

/**
 * ════════════════════════════════════════════
 *  Los ocho ENUM que las migraciones creaban VARCHAR, y tres índices
 *  Migración 19
 * ════════════════════════════════════════════
 *
 * ── El síntoma ──
 *
 * Una base creada SOLO con migraciones no puede levantar el servidor con
 * `NODE_ENV=development`. Muere en el arranque, antes de escuchar el puerto:
 *
 *     default for column "unit_type" cannot be cast automatically
 *     to type enum_products_unit_type
 *
 * `server.js:412` corre `sequelize.sync({ alter: true })` en todo entorno que no
 * sea producción. Sequelize ve que el modelo declara `DataTypes.ENUM` y la
 * columna es `character varying`, e intenta convertirla — con el `DEFAULT`
 * puesto, que es lo que Postgres se niega a castear solo. Es la otra mitad del
 * proyecto 0 de `docs/PROXIMOS-PROYECTOS.md`.
 *
 * Son ocho columnas, todas creadas `STRING(n)` por `20260531-initial-schema.js`
 * y declaradas `ENUM` en su modelo. Y no lo ve `scripts/verificar-esquema.js`:
 * un `SELECT` sobre un `VARCHAR` donde el modelo espera un ENUM anda perfecto.
 * Esta migración viene con la red que sí lo ve —la comparación de tipos contra
 * `information_schema` que se agregó a ese script— para que la próxima
 * divergencia se caiga en CI y no en el arranque de alguien.
 *
 * ── De qué lado se unifica, y por qué ──
 *
 * Se crean los tipos ENUM. La alternativa era bajar los modelos a `STRING` con
 * validación, y se descartó por una razón concreta: **en producción esas ocho
 * columnas YA son ENUM**. Esa base se creó con `sequelize.sync()` antes de que
 * existieran las migraciones, así que tiene la forma de los modelos. Crear los
 * tipos hace converger la base migrada hacia lo que producción ya tiene y **no
 * toca producción en absoluto**; bajar los modelos a `STRING` obligaría a
 * convertir producción en el sentido contrario, sobre datos reales, para que las
 * dos bases se parezcan a un tercer estado que hoy no existe en ningún lado.
 *
 * Es el mismo criterio de `20260806-esquema-de-permisos.js`: reproducir la forma
 * real, no inventar una nueva. Los nombres de los tipos y sus valores no salen
 * de la cabeza de nadie — son los que dejó un `sequelize.sync()` sobre una base
 * limpia, verificados contra `pg_enum` y contra las declaraciones de
 * `src/models/`, y `src/tests/tiposEnumDelEsquema.test.js` compara los dos
 * archivos para que no se separen.
 *
 * ── Los dos estados posibles, y por qué la migración los mira ──
 *
 * | Base                      | `udt_name` de la columna   | Qué hace esta migración |
 * |---|---|---|
 * | Producción (creada `sync`)| `enum_products_unit_type`  | Nada: el tipo ya está y la columna ya es de ese tipo |
 * | Recreada por migraciones  | `varchar`                  | Crea el tipo y convierte la columna |
 *
 * `information_schema.columns` lo contesta con `data_type` y `udt_name`, así que
 * la decisión se toma por columna y no por suposición sobre en qué entorno
 * corre. Eso es lo que la hace idempotente: correrla dos veces sobre la misma
 * base es un `SELECT` y ocho `IF NOT EXISTS`.
 *
 * ── El `DEFAULT` es la parte que rompe ──
 *
 * Es lo que nombra el mensaje de error. `ALTER TABLE … ALTER COLUMN … TYPE` no
 * castea el default solo: `'unidad'::character varying` no se convierte a
 * `'unidad'::enum_products_unit_type` sin que alguien lo pida. Por eso el orden
 * es DROP DEFAULT → ALTER TYPE → SET DEFAULT casteado, y el valor repuesto es el
 * que declara el modelo. Las dos columnas sin default —`cashflow_entries.type` y
 * `supplier_movements.type`— no reponen nada.
 *
 * ── Qué pasa si una fila tiene un valor que el tipo no contempla ──
 *
 * El `USING … ::text::<tipo>` falla, la transacción vuelve atrás y la migración
 * sale con error nombrando el valor. Es lo que se quiere: convertir esa fila a
 * ENUM significaría inventarle un valor válido, y quedarse en VARCHAR
 * significaría dejar el arranque roto. Producción no puede caer en este caso
 * —sus columnas ya son ENUM, así que nunca se ejecuta el cast— y una base
 * recreada tampoco, porque el código solo escribe los valores del modelo.
 *
 * ── Los tres índices ──
 *
 * `products.barcode`, `products.category` y `products.supplier_id` los declara
 * `models/Product.js` y ninguna migración los creaba. Los nombres son los que
 * pone Sequelize —`products_barcode`, no `idx_…`— por lo mismo que explica
 * `20260808-indices-de-empresa-en-proveedores.js`: con otro nombre, un
 * `sync({ alter: true })` crearía un segundo índice sobre la misma columna.
 */

/**
 * Las ocho columnas, en el orden en que se convierten. El `down` va al revés.
 *
 * `valores` sale de la declaración del modelo y respeta su orden: el orden de un
 * ENUM de Postgres es el de comparación (`ORDER BY status` ordena por
 * `enumsortorder`, no alfabéticamente), así que dos bases con los mismos valores
 * en distinto orden no son la misma base.
 *
 * `anchoVarchar` es el de `20260531-initial-schema.js`, y solo lo usa el `down`.
 */
const COLUMNAS = [
  {
    tabla: 'products',
    columna: 'unit_type',
    tipo: 'enum_products_unit_type',
    valores: ['unidad', 'kg', 'gr', 'litro', 'ml'],
    porDefecto: 'unidad',
    anchoVarchar: 20,
  },
  {
    tabla: 'cashflow_entries',
    columna: 'type',
    tipo: 'enum_cashflow_entries_type',
    valores: ['inflow', 'outflow'],
    porDefecto: null,
    anchoVarchar: 10,
  },
  {
    tabla: 'invitaciones',
    columna: 'role',
    tipo: 'enum_invitaciones_role',
    valores: ['admin', 'vendedor', 'produccion', 'compras'],
    porDefecto: 'vendedor',
    anchoVarchar: 20,
  },
  {
    tabla: 'invitaciones',
    columna: 'status',
    tipo: 'enum_invitaciones_status',
    valores: ['pending', 'accepted', 'expired', 'revoked'],
    porDefecto: 'pending',
    anchoVarchar: 20,
  },
  {
    tabla: 'production_orders',
    columna: 'status',
    tipo: 'enum_production_orders_status',
    valores: ['completed', 'voided'],
    porDefecto: 'completed',
    anchoVarchar: 20,
  },
  {
    tabla: 'supplier_movements',
    columna: 'type',
    tipo: 'enum_supplier_movements_type',
    valores: ['deuda', 'pago'],
    porDefecto: null,
    anchoVarchar: 10,
  },
  {
    tabla: 'supplier_orders',
    columna: 'status',
    tipo: 'enum_supplier_orders_status',
    valores: ['pending', 'partial', 'received', 'cancelled'],
    porDefecto: 'pending',
    anchoVarchar: 20,
  },
  {
    tabla: 'suscripciones',
    columna: 'status',
    tipo: 'enum_suscripciones_status',
    valores: ['trialing', 'active', 'past_due', 'cancelled', 'expired'],
    porDefecto: 'trialing',
    anchoVarchar: 30,
  },
];

/**
 * Los tres que declara `models/Product.js` y ninguna migración creaba.
 * Los nombres son los que Sequelize le pone a un índice de una sola columna.
 */
const INDICES = [
  { nombre: 'products_barcode', tabla: 'products', columnas: 'barcode' },
  { nombre: 'products_category', tabla: 'products', columnas: 'category' },
  { nombre: 'products_supplier_id', tabla: 'products', columnas: 'supplier_id' },
];

/** `{ data_type, udt_name }` de la columna, o `null` si no existe. */
async function estadoDeLaColumna(queryInterface, transaction, tabla, columna) {
  const [filas] = await queryInterface.sequelize.query(`
    SELECT data_type, udt_name
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = '${tabla}'
       AND column_name = '${columna}'
  `, { transaction });

  return filas[0] || null;
}

/** Si el tipo enum existe en el esquema actual. */
async function existeElTipo(queryInterface, transaction, tipo) {
  const [filas] = await queryInterface.sequelize.query(`
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = '${tipo}'
       AND n.nspname = current_schema()
  `, { transaction });

  return filas.length > 0;
}

/** Cuántas columnas del esquema siguen usando el tipo. Lo usa el `down`. */
async function columnasQueUsanElTipo(queryInterface, transaction, tipo) {
  const [filas] = await queryInterface.sequelize.query(`
    SELECT count(*)::int AS cuantas
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND udt_name = '${tipo}'
  `, { transaction });

  return filas[0].cuantas;
}

module.exports = {
  async up(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const { tabla, columna, tipo, valores, porDefecto } of COLUMNAS) {
        const estado = await estadoDeLaColumna(queryInterface, transaction, tabla, columna);

        if (!estado) {
          // No es un caso esperado en ninguna de las dos bases: la columna
          // existe desde `20260531-initial-schema.js`. Se nombra en vez de
          // dejar que el ALTER falle con un mensaje que no dice cuál era.
          throw new Error(`No existe la columna ${tabla}.${columna}: el esquema no es el que esta migración espera.`);
        }

        // `CREATE TYPE` no admite `IF NOT EXISTS`, de ahí el bloque. En
        // producción el tipo ya está —lo creó `sequelize.sync()`— y esto no
        // hace nada.
        if (!await existeElTipo(queryInterface, transaction, tipo)) {
          const lista = valores.map((v) => `'${v}'`).join(', ');
          await q(`CREATE TYPE ${tipo} AS ENUM (${lista})`, transaction);
        }

        // Producción, y también una segunda corrida de esta misma migración.
        if (estado.udt_name === tipo) continue;

        if (estado.data_type !== 'character varying') {
          throw new Error(
            `${tabla}.${columna} no es ni ${tipo} ni character varying, es ${estado.data_type} ` +
            `(${estado.udt_name}). Esta migración no sabe convertirla.`
          );
        }

        // El orden es lo único que hace que esto funcione: con el DEFAULT
        // puesto, el ALTER TYPE es exactamente el error que rompía el arranque.
        await q(`ALTER TABLE ${tabla} ALTER COLUMN ${columna} DROP DEFAULT`, transaction);

        // Vía `text` a propósito: es el cast que Postgres tiene definido desde
        // una cadena hacia un enum. Un NULL sigue siendo NULL.
        await q(
          `ALTER TABLE ${tabla} ALTER COLUMN ${columna} TYPE ${tipo} USING ${columna}::text::${tipo}`,
          transaction
        );

        if (porDefecto !== null) {
          await q(
            `ALTER TABLE ${tabla} ALTER COLUMN ${columna} SET DEFAULT '${porDefecto}'::${tipo}`,
            transaction
          );
        }
      }

      for (const { nombre, tabla, columnas } of INDICES) {
        // `IF NOT EXISTS` porque producción ya los tiene con este mismo nombre:
        // los declara el modelo y los creó el `sync()`.
        await q(`CREATE INDEX IF NOT EXISTS ${nombre} ON ${tabla} (${columnas})`, transaction);
      }
    });
  },

  /**
   * ── Por qué ésta sí es reversible ──
   *
   * Al revés de `20260806-esquema-de-permisos.js`, acá volver atrás no borra
   * nada. De ENUM a VARCHAR se ensancha: todos los valores del tipo entran en el
   * `varchar(n)` original —el más largo es `produccion`, de 10, en una columna de
   * 20— así que ninguna fila se pierde ni se trunca. Lo que sí se pierde es la
   * garantía de que no entre un valor nuevo, que es la que el ENUM daba.
   *
   * ── Los tipos huérfanos ──
   *
   * Después de convertir las columnas, los ocho tipos quedan sin usar. Se
   * borran, pero **solo si ninguna columna del esquema los usa todavía**, y
   * **nunca con `CASCADE`**: `DROP TYPE … CASCADE` no borra el tipo, borra las
   * columnas que dependen de él. Un `down` que se lleva puesta una columna con
   * datos es peor que un `down` que deja un tipo de más.
   *
   * Dejarlos tampoco rompería nada —el `up` los encuentra y no los recrea— pero
   * entonces el `down` no dejaría la base como estaba, y una migración que no
   * revierte del todo es una que nadie puede usar para volver atrás un deploy.
   */
  async down(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const { nombre } of [...INDICES].reverse()) {
        await q(`DROP INDEX IF EXISTS ${nombre}`, transaction);
      }

      for (const { tabla, columna, tipo, porDefecto, anchoVarchar } of [...COLUMNAS].reverse()) {
        const estado = await estadoDeLaColumna(queryInterface, transaction, tabla, columna);

        if (!estado || estado.udt_name !== tipo) continue;

        await q(`ALTER TABLE ${tabla} ALTER COLUMN ${columna} DROP DEFAULT`, transaction);

        await q(
          `ALTER TABLE ${tabla} ALTER COLUMN ${columna} TYPE varchar(${anchoVarchar}) ` +
          `USING ${columna}::text`,
          transaction
        );

        if (porDefecto !== null) {
          await q(
            `ALTER TABLE ${tabla} ALTER COLUMN ${columna} SET DEFAULT '${porDefecto}'`,
            transaction
          );
        }
      }

      for (const { tipo } of [...COLUMNAS].reverse()) {
        if (await columnasQueUsanElTipo(queryInterface, transaction, tipo) === 0) {
          await q(`DROP TYPE IF EXISTS ${tipo}`, transaction);
        }
      }
    });
  },

  // Los lee `src/tests/tiposEnumDelEsquema.test.js` para compararlos contra
  // `src/models/`. Sin esto, el test tendría que leer este archivo con una
  // expresión regular y se rompería con cualquier cambio de formato.
  COLUMNAS,
  INDICES,
};
