'use strict';

/**
 * ════════════════════════════════════════════
 *  TiendaNube · la vinculación, el `state` del OAuth y el ensanchado a BIGINT
 *  Migración 21 — es la ÚNICA de este hito que mueve datos
 * ════════════════════════════════════════════
 *
 * ── Qué hace, en cinco pasos ──
 *
 *  1. `tiendanube_tiendas`: la vinculación de una empresa con su tienda. Hoy eso
 *     vive en dos filas de `settings` y no puede sostener ninguna garantía: la PK
 *     de `settings` es `(key, empresa_id)`, así que **nada impide que dos
 *     empresas guarden el mismo `tiendanube_user_id`** y el pedido de una tienda
 *     le descuente stock a la empresa equivocada. Acá el `UNIQUE` es de la base.
 *  2. `tiendanube_estados_oauth`: el `state` del OAuth, token opaco de un solo
 *     uso. Decisión 2 del plan.
 *  3. Mudar `settings.tiendanube_user_id` a la tabla nueva, resolviendo la
 *     sucursal designada.
 *  4. Borrar de `settings` **solo** las filas que se mudaron.
 *     `tiendanube_access_token` **no se toca**: el token se queda en `settings`
 *     a propósito (FR-077 y decisión 3 del plan). Cifrarlo es el proyecto 6 de
 *     `PROXIMOS-PROYECTOS.md`, que se hace junto con la clave de AFIP y sobre
 *     `settings`; una columna `access_token` acá sería un segundo lugar en claro
 *     que ese proyecto tendría que descubrir.
 *  5. Ensanchar los dos ids de `tiendanube_mappings` de `INTEGER` a `BIGINT`.
 *
 * ── ⚠ El índice único de FR-026 NO se crea acá, y no es un olvido ──
 *
 * FR-026 pide `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements`.
 * `referencia_id` **no es único por diseño en ninguno de sus tres usos**:
 * `routes/sales.js:557` escribe **una fila por línea** de la venta con el mismo
 * `sale.id`, `routes/sales.js:726` escribe la anulación encima de esos mismos
 * valores, y `services/tiendanubeService.js:154` escribe una fila **por ítem**
 * del pedido. Con ese índice, el primer ticket de dos productos del día
 * siguiente al deploy revierte la transacción entera y `POST /api/sales`
 * responde error.
 *
 * La idempotencia del pedido va a `tiendanube_pedidos` con
 * `UNIQUE (empresa_id, tiendanube_order_id)` —una fila por pedido, que es la
 * unidad de idempotencia de verdad—, en la migración `20260811`. Decisión 6 del
 * plan y riesgo 1.
 *
 * ── ⚠ El ensanchado a BIGINT es una DESVIACIÓN DECLARADA del supuesto 4 ──
 *
 * El supuesto 4 de la spec dice que «el modelo `TiendanubeMapping` y su
 * migración se conservan tal cual». Lo que ese supuesto protege queda intacto:
 * los dos índices únicos `uq_tn_mapping_product` y `uq_tn_mapping_variant`, las
 * dos FK con `ON DELETE CASCADE`, y el bug documentado de `addConstraint` con
 * `key` en vez de `field` que impedía crear una base nueva. **Lo único que
 * cambia es el ancho de dos columnas.**
 *
 * El motivo es que son identificadores de un tercero: los decide TiendaNube y
 * `int4` topa en 2.147.483.647. El síntoma del desbordamiento sería un 500 al
 * insertar un mapeo, sin ningún mensaje que diga qué pasó. Y dejarlas en
 * `INTEGER` mientras `tiendanube_variantes` las declara `BIGINT` es peor que el
 * desbordamiento solo: serían dos columnas del mismo dato con anchos distintos,
 * y el día del tope una tabla acepta la fila y la otra no, dejando un mapeo que
 * apunta a una variante que existe.
 *
 * `products.tiendanube_variant_id` **NO se ensancha**: es la columna muerta que
 * deja de ser escribible (FR-070), y ensanchar una columna que nadie va a
 * escribir es trabajo sin destino.
 *
 * ── Por qué el `down` importa aunque en producción esto sea un no-op ──
 *
 * `getAuthUrl` nunca puso `state` en la URL y `handleCallback` rechaza el
 * callback que no lo traiga, así que `getAccessToken` —el único que escribe esas
 * dos filas de `settings`— **nunca se ejecutó**. En producción no hay ni una
 * fila que migrar, y eso es exactamente lo que hace peligrosa esta migración:
 * la hace **fácil de dar por buena**. Si el `down` estuviera mal, nadie se
 * enteraría hasta el día que haya que revertir un deploy con datos reales.
 *
 * Por eso la semilla de `scripts/verificar-reversibilidad.js` siembra las filas
 * de `settings`, las dos sucursales y el mapeo que estas ramas necesitan, y por
 * eso su foto de datos mira `settings`: sin las dos cosas, el `down` no
 * restauraría ninguna fila, el script compararía dos esquemas idénticos y
 * saldría con código 0 sin haber ejecutado nada de esto.
 *
 * ── SQL crudo y una sola transacción ──
 *
 * El molde es `20260808-indices-de-empresa-en-proveedores.js`. Sin modelos de
 * Sequelize: un modelo describe el esquema de HOY y una migración corre contra
 * el de ayer.
 */

/**
 * La sucursal designada, con los MISMOS tres escalones que `elegirPorDefecto`
 * (`utils/sucursalDeStock.js:59-69`) y **en ese orden**:
 *
 *   1. la de `code = 'principal'`, que es la que crea `POST /api/empresas`;
 *   2. la **activa** de menor id;
 *   3. la de menor id, activa o no.
 *
 * El orden no es cosmético: es la diferencia entre publicar el stock de la casa
 * central y publicar el del depósito que alguien dio de baja. Se escribe en SQL
 * y no llamando a la función porque una migración no puede depender del código
 * de hoy, pero el orden tiene que ser el mismo y hay un test que lo compara.
 */
const SUCURSAL_DESIGNADA = `
  COALESCE(
    (SELECT p.id FROM puntos_de_venta p WHERE p.empresa_id = s.empresa_id AND p.code = 'principal' ORDER BY p.id LIMIT 1),
    (SELECT p.id FROM puntos_de_venta p WHERE p.empresa_id = s.empresa_id AND p.is_active            ORDER BY p.id LIMIT 1),
    (SELECT p.id FROM puntos_de_venta p WHERE p.empresa_id = s.empresa_id                            ORDER BY p.id LIMIT 1)
  )
`;

/** Las dos columnas que se ensanchan, en un solo lugar: el `down` las recorre al revés. */
const IDS_DE_TIENDANUBE = ['tiendanube_variant_id', 'tiendanube_product_id'];

/**
 * El único índice de esta migración, con el mismo `name` que declara el modelo.
 *
 * Sequelize lo nombraría `tiendanube_estados_oauth_expira_en`, y sobre una base
 * creada por migraciones un `sync({ alter: true })` en desarrollo crearía un
 * **segundo** índice sobre la misma columna. Es el cuidado que documenta
 * `20260808-indices-de-empresa-en-proveedores.js`, y `esquemaDeTiendanube.test.js`
 * compara esta lista —junto con la de `20260811`— contra la de los modelos.
 *
 * No hay más: la única lectura de esta tabla es por la PK. Éste es para el
 * barrido diario de vencidos, sin el cual una tabla de tokens crece para
 * siempre.
 */
const INDICES = [
  { nombre: 'idx_tn_estados_expira', tabla: 'tiendanube_estados_oauth', columnas: 'expira_en' },
];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });

      // ════════ 1 · tiendanube_tiendas ════════
      //
      // `empresa_id` es la PK: una empresa opera una sola tienda (supuesto 14).
      // Una PK autoincremental que admitiera dos filas obligaría a que CADA
      // consulta de esta integración decidiera cuál de las dos.
      //
      // `punto_de_venta_id` es NOT NULL a propósito. Una columna que admite null
      // tiene una rama de omisión, y esa rama es literalmente el defecto de hoy:
      // el webhook pasa `null`, cae al punto de venta por defecto, y la
      // sincronización elige otro por el orden de las filas.
      //
      // La FK a `puntos_de_venta` va con `ON DELETE RESTRICT` y no `CASCADE`:
      // borrar una sucursal no puede llevarse la vinculación de la tienda por
      // delante. Lo que tiene que pasar es que la operación falle y alguien
      // elija otra sucursal.
      await q(`
        CREATE TABLE IF NOT EXISTS tiendanube_tiendas (
          empresa_id             INTEGER     NOT NULL PRIMARY KEY
                                             REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE,
          tiendanube_user_id     BIGINT      NOT NULL UNIQUE,
          nombre                 VARCHAR(200),
          punto_de_venta_id      INTEGER     NOT NULL
                                             REFERENCES puntos_de_venta(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          vinculada_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ultima_comunicacion_en TIMESTAMPTZ,
          ultima_comunicacion_ok BOOLEAN,
          ultimo_error           VARCHAR(200),
          catalogo_refrescado_en TIMESTAMPTZ,
          reconciliada_en        TIMESTAMPTZ,
          sincronizando_desde    TIMESTAMPTZ,
          created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // ════════ 2 · tiendanube_estados_oauth ════════
      //
      // El `state` es un token opaco de un solo uso y se consume con un
      // `UPDATE … RETURNING` (decisión 2 del plan): la unicidad la sostiene la
      // PK y el «una sola vez» lo sostiene el `WHERE consumido_en IS NULL` de
      // ese UPDATE, no un `findOne` previo.
      //
      // Sin `updated_at`: la fila se escribe una vez y se consume una vez, y
      // `consumido_en` ya dice cuándo fue eso. El modelo lo declara con
      // `updatedAt: false` para que digan lo mismo.
      await q(`
        CREATE TABLE IF NOT EXISTS tiendanube_estados_oauth (
          token        VARCHAR(64) NOT NULL PRIMARY KEY,
          empresa_id   INTEGER     NOT NULL
                                   REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE,
          usuario_id   VARCHAR(255),
          expira_en    TIMESTAMPTZ NOT NULL,
          consumido_en TIMESTAMPTZ,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      for (const { nombre, tabla, columnas } of INDICES) {
        await q(`CREATE INDEX IF NOT EXISTS ${nombre} ON ${tabla} (${columnas})`);
      }

      // ════════ 3 y 4 · mudar el user_id y borrar SOLO lo que se mudó ════════
      //
      // Se leen las candidatas y se insertan de a una en vez de un
      // `INSERT … SELECT` de un tiro. El motivo es el `console.log`: las dos
      // filas que pueden quedar afuera —empresa sin ninguna sucursal, y tienda
      // ya vinculada a otra empresa— tienen que quedar NOMBRADAS en la salida de
      // la migración. Un `INSERT … SELECT` con `ON CONFLICT DO NOTHING` las
      // dejaría afuera en silencio, que es la mitad del problema que esta
      // migración viene a cerrar.
      const [candidatas] = await q(`
        SELECT s.empresa_id,
               s.value #>> '{}' AS user_id,
               ${SUCURSAL_DESIGNADA} AS punto_de_venta_id
          FROM settings s
         WHERE s.key = 'tiendanube_user_id'
         ORDER BY s.empresa_id
      `);

      for (const fila of candidatas) {
        const userId = fila.user_id === null || fila.user_id === undefined ? '' : String(fila.user_id);

        // El valor está guardado como JSONB y `Setting.upsert` lo escribía como
        // número, pero el comentario del código viejo advierte que «puede estar
        // guardado como number o como string». `#>> '{}'` devuelve el texto en
        // los dos casos; lo que no aguanta un cast es cualquier otra cosa, y una
        // migración que revienta por un dato raro de una base de desarrollo es
        // una migración que nadie corre.
        if (!/^\d+$/.test(userId)) {
          console.log(
            `[20260810] La empresa ${fila.empresa_id} tiene un tiendanube_user_id que no es un número ` +
            `(${JSON.stringify(fila.user_id)}): la fila se deja en settings y hay que volver a vincular la tienda.`
          );
          continue;
        }

        // Una empresa sin ninguna sucursal no se muda, y no falla: sin
        // sucursales no puede tener stock, así que tampoco una tienda que
        // sincronizar. Se vuelve a vincular a mano cuando tenga una.
        if (fila.punto_de_venta_id === null || fila.punto_de_venta_id === undefined) {
          console.log(
            `[20260810] La empresa ${fila.empresa_id} no tiene ninguna sucursal, así que su tienda ` +
            'no se puede migrar (la sucursal designada es obligatoria). La fila queda en settings ' +
            'y hay que volver a vincular la tienda cuando la empresa tenga una sucursal.'
          );
          continue;
        }

        // El choque se pregunta ANTES de insertar, y no se deduce de un
        // `RETURNING` vacío: lo que hace falta es el mensaje, y para escribirlo
        // hay que saber a qué empresa le quedó la tienda.
        const [ocupada] = await q(
          'SELECT empresa_id FROM tiendanube_tiendas WHERE tiendanube_user_id = $1',
          [userId]
        );

        if (ocupada.length) {
          // Es el hallazgo 4 de la spec hecho dato: dos empresas con el mismo
          // `tiendanube_user_id`. Entra una —la de menor id, porque el recorrido
          // va ordenado— y la otra queda nombrada acá. A partir de ahora el
          // `UNIQUE` de la base impide que vuelva a pasar.
          console.log(
            `[20260810] La tienda ${userId} ya quedó vinculada a la empresa ${ocupada[0].empresa_id}, ` +
            `así que la empresa ${fila.empresa_id} queda SIN vincular y su fila de settings no se borra. ` +
            'Es el caso que el índice único de tiendanube_user_id existe para impedir de ahora en más.'
          );
          continue;
        }

        // `ON CONFLICT DO NOTHING` además del chequeo de arriba: es lo que hace
        // que el `up` se pueda volver a correr sobre una base a medio migrar sin
        // reventar, que es la propiedad que `verificar-reversibilidad.js` prueba
        // aplicando la migración dos veces.
        await q(`
          INSERT INTO tiendanube_tiendas (empresa_id, tiendanube_user_id, punto_de_venta_id, vinculada_en, created_at, updated_at)
               VALUES ($1, $2, $3, NOW(), NOW(), NOW())
          ON CONFLICT DO NOTHING
        `, [fila.empresa_id, userId, fila.punto_de_venta_id]);

        // Solo las que entraron. `tiendanube_access_token` no se toca nunca.
        await q(
          "DELETE FROM settings WHERE key = 'tiendanube_user_id' AND empresa_id = $1",
          [fila.empresa_id]
        );
      }

      // ════════ 5 · los dos ids de tiendanube_mappings a BIGINT ════════
      for (const columna of IDS_DE_TIENDANUBE) {
        await q(`ALTER TABLE tiendanube_mappings ALTER COLUMN ${columna} TYPE BIGINT USING ${columna}::bigint`);
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ── 1 · las dos columnas vuelven a INTEGER ──
      //
      // En la práctica no puede fallar por datos: ningún valor que estuviera
      // guardado bajo `int4` antes del `up` puede exceder `int4`. Lo único que
      // lo haría fallar es un mapeo creado DESPUÉS del `up` con un id que no
      // entra en `int4`, y ahí fallar es lo correcto: truncarlo dejaría el mapeo
      // apuntando a otra variante de la tienda, que es peor que no poder
      // revertir. Eso es lo que hace que `verificar-reversibilidad.js` pueda
      // probar esta migración de verdad.
      for (const columna of [...IDS_DE_TIENDANUBE].reverse()) {
        await q(`ALTER TABLE tiendanube_mappings ALTER COLUMN ${columna} TYPE INTEGER USING ${columna}::integer`);
      }

      // ── 2 · el paso que DEVUELVE el dato ──
      //
      // Es el único de este `down` que restaura algo, y es el que una base vacía
      // no ejercita: sobre una base sin filas de `settings` corre, no repone
      // nada, y el esquema queda idéntico igual. Por eso la semilla del script
      // de reversibilidad tiene que traer esa fila y su foto de datos tiene que
      // mirar `settings`.
      //
      // El `value` vuelve como NÚMERO (`to_jsonb(bigint)`), que es lo que
      // `Setting.upsert` producía con el `user_id` de la respuesta del OAuth. El
      // código viejo lo comparaba con `String(s.value) === String(storeId)`, que
      // aguanta las dos formas.
      await q(`
        INSERT INTO settings (key, empresa_id, value, created_at, updated_at)
        SELECT 'tiendanube_user_id', t.empresa_id, to_jsonb(t.tiendanube_user_id), NOW(), NOW()
          FROM tiendanube_tiendas t
        ON CONFLICT (key, empresa_id) DO NOTHING
      `);

      // ── 3 y 4 · las dos tablas, al revés de como se crearon ──
      await q('DROP TABLE IF EXISTS tiendanube_estados_oauth');
      await q('DROP TABLE IF EXISTS tiendanube_tiendas');
    });
  },

  // Lo que leen `src/tests/esquemaDeTiendanube.test.js` y el script de
  // reversibilidad. `SUCURSAL_DESIGNADA` se exporta porque el ORDEN de sus tres
  // escalones es la única parte de esta migración que decide un número que el
  // cliente ve —qué stock se publica— y no se puede verificar leyendo el `down`.
  SUCURSAL_DESIGNADA,
  IDS_DE_TIENDANUBE,
  INDICES,
};
