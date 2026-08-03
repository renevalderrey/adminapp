'use strict';

/**
 * ════════════════════════════════════════════
 *  stock: la sucursal pasa a ser una identidad y deja de ser un texto
 *  Migración 14
 * ════════════════════════════════════════════
 *
 * ── El problema ──
 *
 * `stock.punto_de_venta_id` es nullable y `stock.location` es un `VARCHAR(30)`
 * que escribe quien carga. Diez lugares del código escriben filas de stock y
 * cada uno decide la sucursal a su manera: uno mira la cabecera, otro el
 * `location` del cuerpo, otro cae al string `'principal'` —que en una empresa
 * sembrada por `seedPuntosDeVenta`, cuyos códigos son general/ortiz/mayo, no
 * coincide con nada—.
 *
 * El resultado son dos cosas: filas con `punto_de_venta_id` en `NULL` que la
 * pantalla no sabe de qué sucursal son, y **filas duplicadas del mismo producto
 * en la misma sucursal** escritas por dos caminos distintos.
 *
 * ── Lo que hace ──
 *
 * Ocho pasos, **todos dentro de una sola transacción**: si cualquier chequeo
 * falla, no queda nada aplicado. Sin modelos de Sequelize —SQL crudo— porque un
 * modelo describe el esquema de HOY y una migración corre contra el de ayer.
 *
 * El paso 4, la consolidación, corre **la misma función que el informe**
 * (`utils/consolidacionDeStock`). Eso es lo que hace que
 * `npm --prefix apps/api run informe:stock` sea una vista previa de verdad y no
 * una segunda implementación que dice otra cosa. Se corre y se lee ANTES de
 * aplicar esto: `docs/OPERACION.md`, sección «Identidad de sucursal en stock».
 *
 * ── Lo que el `down` NO puede hacer ──
 *
 * Restaura **exactamente lo archivado** y **pisa cualquier movimiento de stock
 * posterior a la migración**: si después de migrar se vendió, se produjo o se
 * ajustó inventario, el `down` devuelve las cantidades que había antes y esos
 * movimientos se pierden. Es para volver atrás minutos después de un deploy, no
 * semanas después. Un `down` que intentara reconciliar movimientos posteriores
 * estaría adivinando, y adivinar sobre inventario es peor que fallar.
 *
 * Y hay un paso que **falla a propósito**: recrear el único
 * `(product_id, location)`. Si en el medio se crearon dos filas del mismo
 * producto con el mismo `location`, elegir cuál sobrevive es una decisión de
 * negocio, no de la migración.
 */

const { planificar, SUCURSAL_A_CREAR } = require('../utils/consolidacionDeStock');

/** El único que se elimina (decisión 6) y el que nace en su lugar (FR-042). */
const INDICE_VIEJO = 'stock_product_id_location';
const INDICE_NUEVO = 'stock_product_id_punto_de_venta_id';
const FK_NUEVA = 'stock_punto_de_venta_id_fkey';

/** Las columnas de `stock` que se archivan y se restauran, en un solo lugar. */
const COLUMNAS_DE_STOCK = [
  'id', 'empresa_id', 'product_id', 'punto_de_venta_id', 'location',
  'quantity', 'available', 'min_stock', 'current_batch',
  'expiration_date', 'purchase_date', 'created_at', 'updated_at',
];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });
      const filasDe = async (sql, bind) => (await q(sql, bind))[0];

      // ════════ Paso 0 · La foto de control ════════
      //
      // Contra esto compara el paso 8. Es temporal y `ON COMMIT DROP`: muere
      // con la transacción, así se haya hecho commit o rollback, y no deja
      // basura en la base.
      await q(`
        CREATE TEMP TABLE control_antes ON COMMIT DROP AS
          SELECT empresa_id,
                 product_id,
                 SUM(quantity)::numeric  AS q,
                 SUM(available)::numeric AS d
            FROM stock
           GROUP BY 1, 2
      `);

      // ════════ Paso 1 · El archivo, y una sucursal donde no hay ninguna ════════

      // Sin FK a `stock`: la gracia de esta tabla es sobrevivir a las filas que
      // se borran. Una FK las borraría en cascada justo cuando sirven.
      await q(`
        CREATE TABLE IF NOT EXISTS stock_migracion_sucursal (
          id                          SERIAL PRIMARY KEY,
          empresa_id                  INTEGER      NOT NULL,
          motivo                      VARCHAR(20)  NOT NULL,
          stock_id                    INTEGER,
          stock_id_sobreviviente      INTEGER,
          product_id                  INTEGER,
          punto_de_venta_id_anterior  INTEGER,
          punto_de_venta_id_nuevo     INTEGER,
          location_anterior           VARCHAR(30),
          fila                        JSONB,
          revisar                     BOOLEAN      NOT NULL DEFAULT FALSE,
          nota                        TEXT,
          created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);

      await q('CREATE INDEX IF NOT EXISTS stock_migracion_sucursal_empresa_id ON stock_migracion_sucursal (empresa_id)');
      await q('CREATE INDEX IF NOT EXISTS stock_migracion_sucursal_motivo ON stock_migracion_sucursal (motivo)');
      await q('CREATE INDEX IF NOT EXISTS stock_migracion_sucursal_stock_id ON stock_migracion_sucursal (stock_id)');

      /** Una fila del archivo. Todo lo que desaparece pasa por acá. */
      const archivar = (registro) => q(`
        INSERT INTO stock_migracion_sucursal
          (empresa_id, motivo, stock_id, stock_id_sobreviviente, product_id,
           punto_de_venta_id_anterior, punto_de_venta_id_nuevo, location_anterior,
           fila, revisar, nota, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, NOW(), NOW())
      `, [
        registro.empresa_id,
        registro.motivo,
        registro.stock_id ?? null,
        registro.stock_id_sobreviviente ?? null,
        registro.product_id ?? null,
        registro.punto_de_venta_id_anterior ?? null,
        registro.punto_de_venta_id_nuevo ?? null,
        registro.location_anterior ?? null,
        registro.fila ? JSON.stringify(registro.fila) : null,
        registro.revisar === true,
        registro.nota ?? null,
      ]);

      // **Crear la sucursal va ANTES de agrupar, y el orden no es negociable.**
      //
      // Si se agrupara primero, las filas de una empresa sin sucursal caerían
      // todas en un destino sin id —«la que se va a crear»— y la clave de
      // agrupación tendría que inventarse. La prueba de mutación de la fase
      // anterior encontró exactamente ese agujero: sin el `empresa_id` en la
      // clave, las filas de dos empresas cliente distintas terminaban sumadas
      // en una sola. Creando la sucursal primero, cuando `planificar()` corre
      // **toda empresa con stock ya tiene un id real** y el caso no existe.
      const sinSucursal = await filasDe(`
        SELECT DISTINCT s.empresa_id
          FROM stock s
         WHERE NOT EXISTS (
                 SELECT 1 FROM puntos_de_venta pv WHERE pv.empresa_id = s.empresa_id
               )
         ORDER BY 1
      `);

      for (const { empresa_id: empresaId } of sinSucursal) {
        const [creada] = await filasDe(`
          INSERT INTO puntos_de_venta (empresa_id, name, code, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, TRUE, NOW(), NOW())
          RETURNING id
        `, [empresaId, SUCURSAL_A_CREAR.name, SUCURSAL_A_CREAR.code]);

        await archivar({
          empresa_id: empresaId,
          motivo: 'pv_creado',
          punto_de_venta_id_nuevo: creada.id,
          nota:
            `La empresa tenía stock y ninguna sucursal. Se creó `
            + `"${SUCURSAL_A_CREAR.name}" (code ${SUCURSAL_A_CREAR.code}) para poder `
            + 'aplicar el NOT NULL. El down la borra.',
        });
      }

      // ════════ Pasos 2 a 5 · El plan, y su aplicación ════════

      // `updated_at` no es decoración: es la entrada de la señal «se
      // escribieron con menos de 24 horas de diferencia», que es una de las
      // cinco con las que se distingue «dos pilas» de «una pila anotada dos
      // veces». Sin esa columna en el SELECT la señal no dispara nunca y se
      // apaga en silencio justo donde importa — y la fusión se haría igual,
      // pero sin la marca que pide el recuento.
      const filas = await filasDe(`
        SELECT ${COLUMNAS_DE_STOCK.join(', ')}
          FROM stock
         ORDER BY empresa_id, product_id, id
      `);

      const puntosDeVenta = await filasDe(`
        SELECT id, empresa_id, name, code, is_active
          FROM puntos_de_venta
         ORDER BY empresa_id, id
      `);

      const plan = planificar({ filas, puntosDeVenta });

      // Después del paso 1 ninguna empresa con stock puede quedar sin sucursal.
      // Si esto salta, el paso 1 no hizo lo que dice y seguir escribiría datos
      // sobre una suposición falsa.
      const aCrearTodavia = plan.asignaciones.filter((a) => a.destino_a_crear);
      if (aCrearTodavia.length) {
        throw new Error(
          `El paso 1 dejó ${aCrearTodavia.length} fila(s) de stock apuntando a una sucursal `
          + 'que todavía no existe. La migración se aborta sin aplicar nada.'
        );
      }

      // El único `(product_id, punto_de_venta_id)` se cae acá y se recrea en el
      // paso 7. Dos motivos: en el estado intermedio los duplicados que el
      // paso 4 viene a resolver todavía existen, y en alguna base el índice ya
      // está creado —el modelo lo declara desde siempre y `sync()` lo aplicó en
      // desarrollo—, con lo cual el UPDATE de acá abajo fallaría antes de que
      // la consolidación llegue a correr.
      await q(`DROP INDEX IF EXISTS ${INDICE_NUEVO}`);

      const porId = new Map(filas.map((f) => [f.id, f]));

      /** Los que ya tienen su `location_anterior` guardado. */
      const yaArchivadas = new Set();

      // ── Pasos 2 y 3: a qué sucursal va cada fila ──
      //
      // Solo se escribe `punto_de_venta_id`. El espejo `location` se reescribe
      // en el paso 5, DESPUÉS de consolidar: hacerlo antes chocaría contra el
      // único `(product_id, location)`, que hasta el paso 7 sigue vivo.
      for (const asignacion of plan.asignaciones) {
        const cambiaSucursal =
          asignacion.punto_de_venta_id_nuevo !== asignacion.punto_de_venta_id_anterior;
        const cambiaEspejo = asignacion.location_nueva !== asignacion.location_anterior;

        if (!cambiaSucursal && !cambiaEspejo) continue;

        await archivar({
          empresa_id: asignacion.empresa_id,
          motivo: 'reasignada',
          stock_id: asignacion.stock_id,
          product_id: asignacion.product_id,
          punto_de_venta_id_anterior: asignacion.punto_de_venta_id_anterior,
          punto_de_venta_id_nuevo: asignacion.punto_de_venta_id_nuevo,
          location_anterior: asignacion.location_anterior,
          nota: `Resuelta por: ${asignacion.motivo}.`,
        });

        yaArchivadas.add(asignacion.stock_id);

        if (cambiaSucursal && asignacion.punto_de_venta_id_nuevo !== null) {
          await q(
            'UPDATE stock SET punto_de_venta_id = $1 WHERE id = $2',
            [asignacion.punto_de_venta_id_nuevo, asignacion.stock_id]
          );
        }
      }

      // ── Paso 4: consolidar los duplicados ──
      //
      // Cada fila que desaparece se copia ENTERA al archivo antes de borrarse.
      // La sobreviviente también se archiva, con `stock_id` igual a
      // `stock_id_sobreviviente`: es la forma de que el `down` sepa cuáles
      // reinsertar (los distintos) y cuál restaurar en su lugar (el igual).
      // Sin eso, revertir devolvería las filas borradas pero dejaría a la
      // sobreviviente con la cantidad sumada: el inventario quedaría al doble.
      for (const fusion of plan.fusiones) {
        for (const f of fusion.filas) {
          const original = porId.get(f.id);

          await archivar({
            empresa_id: fusion.empresa_id,
            motivo: 'fusionada',
            stock_id: f.id,
            stock_id_sobreviviente: fusion.sobreviviente_id,
            product_id: fusion.product_id,
            punto_de_venta_id_anterior: original.punto_de_venta_id,
            punto_de_venta_id_nuevo: fusion.punto_de_venta_id,
            location_anterior: original.location,
            fila: original,
            revisar: fusion.revisar,
            nota: fusion.nota,
          });
        }

        const r = fusion.resultado;

        await q(`
          UPDATE stock
             SET quantity = $1, available = $2, min_stock = $3,
                 expiration_date = $4, purchase_date = $5, current_batch = $6
           WHERE id = $7
        `, [
          r.quantity, r.available, r.min_stock,
          r.expiration_date ?? null, r.purchase_date ?? null, r.current_batch ?? null,
          fusion.sobreviviente_id,
        ]);

        const absorbidas = fusion.filas.filter((f) => !f.sobrevive).map((f) => f.id);

        if (absorbidas.length) {
          await q(
            `DELETE FROM stock WHERE id IN (${absorbidas.map((_, i) => `$${i + 1}`).join(', ')})`,
            absorbidas
          );
        }
      }

      // ── Paso 5: el espejo ──
      //
      // El único `(product_id, location)` se cae acá y no en el paso 7 porque
      // este UPDATE es exactamente lo que colisionaría con él: dos sucursales
      // sin `code` y con el mismo `name` producirían el mismo espejo para dos
      // filas del mismo producto.
      await q(`DROP INDEX IF EXISTS ${INDICE_VIEJO}`);

      // Se archiva lo que este paso pisa y todavía no está guardado. Sin esto
      // el `down` no podría devolver el texto que había escrito el operador,
      // que es lo único que se pierde al reescribir el espejo.
      const pisadas = await filasDe(`
        SELECT s.id, s.empresa_id, s.product_id, s.punto_de_venta_id, s.location
          FROM stock s
          JOIN puntos_de_venta pv ON pv.id = s.punto_de_venta_id
         WHERE s.location IS DISTINCT FROM LEFT(COALESCE(pv.code, pv.name), 30)
      `);

      for (const fila of pisadas) {
        if (yaArchivadas.has(fila.id)) continue;

        await archivar({
          empresa_id: fila.empresa_id,
          motivo: 'reasignada',
          stock_id: fila.id,
          product_id: fila.product_id,
          punto_de_venta_id_anterior: fila.punto_de_venta_id,
          punto_de_venta_id_nuevo: fila.punto_de_venta_id,
          location_anterior: fila.location,
          nota: 'Solo se reescribió el espejo `location`; la sucursal no cambió.',
        });
      }

      // `updated_at` NO se toca a propósito: es la entrada de la señal de
      // «misma sesión». Moverlo en todas las filas dejaría esa señal marcando
      // todo si alguna vez hubiera que volver a planificar.
      await q(`
        UPDATE stock s
           SET location = LEFT(COALESCE(pv.code, pv.name), 30)
          FROM puntos_de_venta pv
         WHERE pv.id = s.punto_de_venta_id
           AND s.location IS DISTINCT FROM LEFT(COALESCE(pv.code, pv.name), 30)
      `);

      // ════════ Paso 6 · NOT NULL, con la guarda antes ════════
      //
      // El ALTER sin esta guarda falla con el error de Postgres, que dice que
      // una columna tiene nulos y nada más. El mensaje es parte del paso: sin
      // saber cuántas filas y de qué empresas quedaron sin sucursal, no hay por
      // dónde empezar a arreglarlo.
      const nulas = await filasDe(`
        SELECT empresa_id, count(*)::int AS n
          FROM stock
         WHERE punto_de_venta_id IS NULL
         GROUP BY 1
         ORDER BY 1
      `);

      if (nulas.length) {
        const total = nulas.reduce((acc, e) => acc + e.n, 0);
        const detalle = nulas.map((e) => `empresa ${e.empresa_id}: ${e.n}`).join(', ');

        throw new Error(
          `Quedan ${total} fila(s) de stock sin punto de venta (${detalle}). `
          + 'No se puede aplicar NOT NULL. La migración se revierte entera. '
          + 'Correr `npm --prefix apps/api run informe:stock` para ver por qué esas filas '
          + 'no encontraron sucursal.'
        );
      }

      const [columna] = await filasDe(`
        SELECT is_nullable
          FROM information_schema.columns
         WHERE table_name = 'stock' AND column_name = 'punto_de_venta_id'
      `);

      if (columna && columna.is_nullable === 'YES') {
        await q('ALTER TABLE stock ALTER COLUMN punto_de_venta_id SET NOT NULL');
      }

      // ════════ Paso 7 · Los índices y la FK ════════
      //
      // Los dos `DROP` ya pasaron más arriba, cada uno justo antes del paso que
      // colisionaba con él. Acá queda el alta del único que reemplaza a los
      // dos: si la consolidación hubiera dejado un duplicado, este CREATE falla
      // y la transacción entera se revierte. Es la última red.
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDICE_NUEVO} ON stock (product_id, punto_de_venta_id)`);

      // Con `punto_de_venta_id NOT NULL`, un `ON DELETE SET NULL` es imposible
      // de cumplir: borrar una sucursal dejaría la fila en un estado que la
      // columna prohíbe. Pasa a RESTRICT, que además es lo correcto: la
      // mercadería no se evapora al cerrar un local.
      // `DELETE /api/empresas/puntos-de-venta/:id` es un borrado blando y sigue
      // funcionando.
      const fks = await filasDe(`
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'stock'::regclass
           AND contype = 'f'
           AND confrelid = 'puntos_de_venta'::regclass
      `);

      for (const { conname } of fks) {
        await q(`ALTER TABLE stock DROP CONSTRAINT "${conname}"`);
      }

      await q(`
        ALTER TABLE stock
          ADD CONSTRAINT ${FK_NUEVA}
          FOREIGN KEY (punto_de_venta_id) REFERENCES puntos_de_venta(id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      `);

      // ════════ Paso 8 · La verificación, adentro de la transacción ════════
      //
      // Es el criterio de éxito 5 de la spec, ejecutado por la migración en vez
      // de comprobado a mano después. Si la suma de un producto se movió, no
      // hay commit: revisarlo con los datos ya cambiados sería tarde.
      const [descuadre] = await filasDe(`
        SELECT count(*)::int AS n
          FROM control_antes a
          JOIN (
                 SELECT empresa_id, product_id,
                        SUM(quantity)::numeric  AS q,
                        SUM(available)::numeric AS d
                   FROM stock
                  GROUP BY 1, 2
               ) b
            ON b.empresa_id = a.empresa_id AND b.product_id = a.product_id
         WHERE b.q <> a.q OR b.d <> a.d
      `);

      if (descuadre.n > 0) {
        throw new Error(
          `La consolidación cambió la cantidad o el disponible de ${descuadre.n} producto(s). `
          + 'Fusionar solo puede sumar: si el total se movió, el plan está mal. '
          + 'No se aplicó nada.'
        );
      }

      const [perdidos] = await filasDe(`
        SELECT count(*)::int AS n
          FROM control_antes a
         WHERE NOT EXISTS (
                 SELECT 1 FROM stock s
                  WHERE s.empresa_id = a.empresa_id AND s.product_id = a.product_id
               )
      `);

      if (perdidos.n > 0) {
        throw new Error(
          `${perdidos.n} producto(s) tenían fila de stock antes y no la tienen después. `
          + 'No se aplicó nada.'
        );
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });
      const filasDe = async (sql, bind) => (await q(sql, bind))[0];

      const [existe] = await filasDe(`
        SELECT to_regclass('public.stock_migracion_sucursal') IS NOT NULL AS hay
      `);

      if (!existe.hay) {
        throw new Error(
          'No existe stock_migracion_sucursal: no hay nada archivado con qué revertir. '
          + 'Si la tabla se borró a mano, esta migración ya no es reversible.'
        );
      }

      // ── 1. La FK y el índice nuevo ──
      const fks = await filasDe(`
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'stock'::regclass
           AND contype = 'f'
           AND confrelid = 'puntos_de_venta'::regclass
      `);

      for (const { conname } of fks) {
        await q(`ALTER TABLE stock DROP CONSTRAINT "${conname}"`);
      }

      await q(`
        ALTER TABLE stock
          ADD CONSTRAINT ${FK_NUEVA}
          FOREIGN KEY (punto_de_venta_id) REFERENCES puntos_de_venta(id)
          ON UPDATE CASCADE ON DELETE SET NULL
      `);

      await q(`DROP INDEX IF EXISTS ${INDICE_NUEVO}`);

      // ── 2. La columna vuelve a admitir nulos ──
      await q('ALTER TABLE stock ALTER COLUMN punto_de_venta_id DROP NOT NULL');

      // ── 3. Las fusionadas ──
      //
      // Primero la sobreviviente vuelve a sus valores de antes de sumar, y
      // después se reinsertan las que desaparecieron con su id original. El
      // orden importa poco acá porque el único ya se cayó, pero restaurar la
      // sobreviviente es lo que evita que el inventario quede al doble.
      const archivadas = await filasDe(`
        SELECT stock_id, stock_id_sobreviviente, fila
          FROM stock_migracion_sucursal
         WHERE motivo = 'fusionada' AND fila IS NOT NULL
         ORDER BY id
      `);

      const columnas = COLUMNAS_DE_STOCK.join(', ');
      const marcadores = COLUMNAS_DE_STOCK.map((_, i) => `$${i + 1}`).join(', ');

      for (const { stock_id: stockId, stock_id_sobreviviente: sobreviviente, fila } of archivadas) {
        const datos = typeof fila === 'string' ? JSON.parse(fila) : fila;
        const valores = COLUMNAS_DE_STOCK.map((c) => datos[c] ?? null);

        if (stockId === sobreviviente) {
          await q(`
            UPDATE stock
               SET quantity = $1, available = $2, min_stock = $3, current_batch = $4,
                   expiration_date = $5, purchase_date = $6,
                   punto_de_venta_id = $7, location = $8
             WHERE id = $9
          `, [
            datos.quantity, datos.available, datos.min_stock, datos.current_batch ?? null,
            datos.expiration_date ?? null, datos.purchase_date ?? null,
            datos.punto_de_venta_id ?? null, datos.location,
            stockId,
          ]);
          continue;
        }

        await q(
          `INSERT INTO stock (${columnas}) VALUES (${marcadores}) ON CONFLICT (id) DO NOTHING`,
          valores
        );
      }

      // Reinsertar con id explícito no mueve la secuencia: sin esto, el próximo
      // INSERT de stock choca contra un id que ya existe.
      await q(`
        SELECT setval(
          pg_get_serial_sequence('stock', 'id'),
          GREATEST((SELECT COALESCE(MAX(id), 1) FROM stock), 1)
        )
      `);

      // ── 4. Las reasignadas ──
      await q(`
        UPDATE stock s
           SET punto_de_venta_id = m.punto_de_venta_id_anterior,
               location = COALESCE(m.location_anterior, s.location)
          FROM stock_migracion_sucursal m
         WHERE m.stock_id = s.id AND m.motivo = 'reasignada'
      `);

      // ── 5. Las sucursales que creó el paso 1 ──
      //
      // Va después de devolver el stock a su sucursal anterior: al revés, la FK
      // lo impediría (y con razón).
      await q(`
        DELETE FROM puntos_de_venta pv
         USING stock_migracion_sucursal m
         WHERE m.motivo = 'pv_creado' AND m.punto_de_venta_id_nuevo = pv.id
      `);

      // ── 6. El único de (product_id, location) ──
      //
      // **Falla a propósito** si en el medio se crearon dos filas del mismo
      // producto con el mismo `location`: elegir cuál sobrevive es una decisión
      // de negocio. Es el mismo criterio que
      // `20260730-settings-pk-por-empresa.js:66-68`.
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDICE_VIEJO} ON stock (product_id, location)`);

      // ── 7. El archivo ──
      await q('DROP TABLE IF EXISTS stock_migracion_sucursal');
    });
  },
};
