'use strict';

/**
 * ════════════════════════════════════════════
 *  recipe_items: un insumo aparece UNA vez por receta
 *  Migración 20 — corre después de `20260809-tipos-enum-y-indices-de-productos`,
 *  con la que comparte fecha: sequelize-cli las ordena por nombre.
 * ════════════════════════════════════════════
 *
 * ── El problema ──
 *
 * `recipe_items` no tenía índice único por `(recipe_id, ingredient_product_id)`,
 * así que una receta podía listar el mismo insumo dos veces.
 * `costService.calculateProductCost` recorre TODOS los ítems sumando
 * `cantidad × costo`: cuando eso pasa, **el mismo insumo se suma dos veces** y el
 * elaborado queda costeado de más. En silencio, que es lo peor: de ese costo
 * salen el margen que muestra el POS y el precio que recomienda el Comparador,
 * o sea que el número que el usuario cree está mal y no falla nada.
 *
 * No es hipotético. Es la razón por la que uno de los dos defectos de diamante
 * del hito 6 era **determinístico** en vez de depender del orden de las filas:
 * con el insumo repetido, la segunda vuelta del bucle encontraba el elaborado ya
 * marcado siempre.
 *
 * ── Qué se hace con los duplicados que ya existen, y por qué ──
 *
 * **Se suman las cantidades en una sola fila.** No se conserva una y se tira la
 * otra. El motivo no es que sumar sea más fácil —conservar una es más fácil—,
 * sino que es lo único que **no cambia ningún número de plata**:
 *
 *  - el costo que el sistema calcula HOY para ese elaborado ya es el de la suma,
 *    porque `calculateProductCost` recorre las dos filas. Fusionar sumando deja
 *    ese costo idéntico: esta migración cambia el esquema y no mueve un peso;
 *  - conservar una sola fila **bajaría** el costo del elaborado la próxima vez
 *    que algo lo recostee —una compra, una orden de producción, una edición del
 *    insumo—, días después del deploy, sin que nadie lo haya pedido y sin que
 *    nada avise. Eso es exactamente la clase de defecto que este hito persigue:
 *    un número de plata que cambia solo.
 *
 * Y al revés: si la fila repetida era un error de carga, **el costo ya estaba
 * inflado antes de esta migración**. La migración no lo causó y no tiene con qué
 * distinguirlo: en la base, «200 g de harina para la masa y 50 g para
 * espolvorear» y «la misma línea cargada dos veces» se ven igual. Lo que sí
 * puede hacer, y hace, es **dejar la evidencia**: cada fila que desaparece se
 * copia entera a `recipe_items_duplicados`, y las que parecen carga doble quedan
 * marcadas `revisar` para que una persona abra esa receta.
 *
 * ── La única señal que sirve para marcar, y las que NO sirven ──
 *
 * Se marca `revisar` cuando **todas las filas del grupo tienen exactamente la
 * misma cantidad**. Dos momentos legítimos de una receta rara vez llevan la
 * cantidad idéntica; un INSERT repetido de la misma línea siempre.
 *
 * ⚠ `created_at` **no sirve** acá, y conviene que quede escrito para que nadie
 * lo intente de nuevo: `PUT /api/products/:id/recipe` borra TODOS los ítems y
 * los vuelve a crear en cada guardado, así que las filas de una receta comparten
 * `created_at` siempre, vengan de donde vengan. La señal de «se escribieron con
 * segundos de diferencia» —que sí sirve en `stock`— acá dispara en el 100 % de
 * los casos y no distingue nada.
 *
 * ── Por qué informa por consola ──
 *
 * Es la primera migración del repositorio que escribe algo en la salida, y es a
 * propósito: **modifica datos de un cliente**. Una limpieza silenciosa sobre la
 * receta de alguien no es aceptable, y el `stdio: 'inherit'` de
 * `scripts/migrar.js` hace que estas líneas queden en el log del contenedor
 * junto al resto del arranque. El detalle completo, fila por fila, queda en
 * `recipe_items_duplicados`.
 *
 * El informe sale **siempre**, incluso con cero duplicados: «leí 1.240 filas y no
 * había ninguno» es distinto de no decir nada, que se lee igual que «no miré».
 *
 * ── Reversible ──
 *
 * El `down` devuelve la cantidad original a la fila que sobrevivió y reinserta
 * las que se borraron con su id original, desde el archivo. Igual que el `down`
 * de `20260804`, **pisa lo que haya pasado después**: si entre el deploy y el
 * rollback alguien editó esa receta, la edición se pierde. Es para volver atrás
 * minutos después de un deploy.
 */

/** El único que nace acá. El mismo nombre está en `models/RecipeItem.js`. */
const INDICE = 'idx_recipe_items_recipe_ingredient';

/** Dónde queda lo que desaparece. */
const ARCHIVO = 'recipe_items_duplicados';

/** Cuántos grupos se listan por consola antes de mandar a leer el archivo. */
const MAXIMO_A_LISTAR = 50;

/**
 * `quantity` sale de Postgres como **string**: es un NUMERIC, y el driver no lo
 * convierte a number para no perder precisión en columnas grandes.
 *
 * De ahí el `Number()` explícito. Sumar los valores tal como vienen con `+` los
 * **concatena** —`'0.2000' + '0.0500'` da `'0.20000.0500'`— y esa es una
 * equivocación que ya mordió en este repositorio, con la diferencia de que acá
 * no rompería nada visible: la cantidad quedaría en `NaN` y el costo del
 * elaborado con ella.
 *
 * El `toFixed(4)` es la precisión de la columna, DECIMAL(12,4). Comprobado que
 * en el rango que la columna admite —ocho dígitos enteros— el redondeo a cuatro
 * decimales absorbe cualquier error de punto flotante de la suma, así que
 * escribir esto en enteros escalados no cambiaría un solo resultado. Se deja
 * como está para no dejar maquinaria que ningún caso puede distinguir.
 */
const aNumero = (v) => Number(v);
const aCantidad = (n) => n.toFixed(4);

/**
 * Qué filas se fusionan con cuáles, sin tocar la base.
 *
 * Está separada de `up` —y exportada— por el mismo motivo que
 * `utils/consolidacionDeStock`: la decisión de qué pasa con los datos de un
 * cliente tiene que poder testearse sin levantar Postgres. La prueba está en
 * `src/tests/unicoDeInsumoPorReceta.test.js`.
 *
 * @param {Array<{id:number, recipe_id:number, ingredient_product_id:number,
 *   quantity:string|number, empresa_id:number, product_id:number}>} filas
 *   Todas las filas de `recipe_items`, con la empresa y el elaborado de su
 *   receta. **El orden en que lleguen no cambia el resultado**: cada grupo se
 *   ordena por `id` acá adentro. El `ORDER BY` de la consulta está igual, para
 *   que dos corridas de la migración sobre la misma base lean lo mismo, pero la
 *   decisión de cuál sobrevive no depende de que el planificador lo respete.
 * @returns {{fusiones: Array<object>, resumen: object}}
 */
function planificarFusiones(filas = []) {
  const grupos = new Map();

  for (const fila of filas) {
    const clave = `${fila.recipe_id}·${fila.ingredient_product_id}`;

    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila);
  }

  const fusiones = [];

  for (const integrantes of grupos.values()) {
    if (integrantes.length < 2) continue;

    // La de menor id sobrevive. No es una preferencia estética: es la única
    // elección que no depende de datos que pueden empatar —las cantidades
    // empatan justo en el caso sospechoso, y `created_at` empata siempre—.
    const ordenadas = [...integrantes].sort((a, b) => a.id - b.id);
    const sobreviviente = ordenadas[0];

    const cantidades = ordenadas.map((f) => aNumero(f.quantity));
    const total = cantidades.reduce((acc, n) => acc + n, 0);

    // Ver el encabezado: la cantidad idéntica es la única señal que queda en
    // pie una vez que `created_at` está descartado.
    const revisar = cantidades.every((n) => n === cantidades[0]);

    fusiones.push({
      recipe_id: sobreviviente.recipe_id,
      ingredient_product_id: sobreviviente.ingredient_product_id,
      empresa_id: sobreviviente.empresa_id,
      product_id: sobreviviente.product_id,
      sobreviviente_id: sobreviviente.id,
      cantidad_final: aCantidad(total),
      filas: ordenadas.map((f) => ({
        id: f.id,
        quantity: aCantidad(aNumero(f.quantity)),
        sobrevive: f.id === sobreviviente.id,
      })),
      revisar,
      nota: revisar
        ? 'Las filas tenían la MISMA cantidad, que es como se ve una línea cargada '
          + 'dos veces. Se sumaron igual —bajar el costo del elaborado sin que nadie '
          + 'lo pida sería peor—, pero conviene abrir esta receta y confirmarlo.'
        : 'Las filas tenían cantidades distintas: se ve como dos momentos de la '
          + 'misma receta. Se sumaron, que es lo que el costo del elaborado ya '
          + 'venía reflejando.',
    });
  }

  return {
    fusiones,
    resumen: {
      filasLeidas: filas.length,
      recetasConDuplicados: new Set(fusiones.map((f) => f.recipe_id)).size,
      gruposFusionados: fusiones.length,
      filasAbsorbidas: fusiones.reduce((acc, f) => acc + f.filas.length - 1, 0),
      marcadas: fusiones.filter((f) => f.revisar).length,
    },
  };
}

/** Lo que el operador ve en el log del contenedor. Ver el encabezado. */
function informar(plan, escribir = console.log) {
  const { resumen, fusiones } = plan;
  const log = (linea) => escribir(`[recipe_items] ${linea}`);

  log(`${resumen.filasLeidas} fila(s) de receta leídas.`);

  if (!fusiones.length) {
    // «Las leí y no había» es distinto de no decir nada: sin esta línea, un log
    // mudo se lee igual que una migración que nunca miró.
    log('No hay ninguna receta con el mismo insumo repetido. No se tocó ningún dato.');
    return;
  }

  log(
    `${resumen.gruposFusionados} insumo(s) repetido(s) en ${resumen.recetasConDuplicados} `
    + `receta(s): ${resumen.filasAbsorbidas} fila(s) se fusionan sumando las cantidades.`
  );

  for (const f of fusiones.slice(0, MAXIMO_A_LISTAR)) {
    const detalle = f.filas.map((x) => x.quantity).join(' + ');

    log(
      `  empresa ${f.empresa_id} · elaborado ${f.product_id} · receta ${f.recipe_id} `
      + `· insumo ${f.ingredient_product_id}: ${detalle} = ${f.cantidad_final}`
      + `${f.revisar ? '  ⚠ REVISAR' : ''}`
    );
  }

  if (fusiones.length > MAXIMO_A_LISTAR) {
    log(`  … y ${fusiones.length - MAXIMO_A_LISTAR} más. La lista completa está en ${ARCHIVO}.`);
  }

  if (resumen.marcadas) {
    log(
      `⚠ ${resumen.marcadas} fusión(es) marcadas para revisar: las filas tenían la MISMA `
      + 'cantidad, que es como se ve una línea cargada dos veces. Se sumaron igual, y el '
      + `costo del elaborado no cambió; están en ${ARCHIVO} con revisar = TRUE.`
    );
  }

  log(`Todo lo que desapareció quedó entero en ${ARCHIVO}. El down lo restaura.`);
}

module.exports = {
  // Exportadas para el test. `sequelize-cli` solo mira `up` y `down`.
  planificarFusiones,
  informar,
  INDICE,
  ARCHIVO,

  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });
      const filasDe = async (sql, bind) => (await q(sql, bind))[0];

      // ════════ Paso 0 · La foto de control ════════
      //
      // Lo que esta migración promete es que NINGÚN costo se mueve. Eso es
      // exactamente esto: la cantidad total de cada insumo en cada receta tiene
      // que ser la misma antes y después. Se verifica adentro de la transacción
      // en el paso 4; comprobarlo después, con los datos ya cambiados, sería
      // tarde. `ON COMMIT DROP`: muere con la transacción y no deja basura.
      await q(`
        CREATE TEMP TABLE control_insumos ON COMMIT DROP AS
          SELECT recipe_id,
                 ingredient_product_id,
                 SUM(quantity)::numeric AS q
            FROM recipe_items
           GROUP BY 1, 2
      `);

      // ════════ Paso 1 · El archivo ════════
      //
      // Se crea SIEMPRE, aunque no haya un solo duplicado: así el `down` es uno
      // solo y no dos según lo que hubiera, y quien pregunte «¿esta migración me
      // tocó las recetas?» encuentra una tabla vacía en vez de un error.
      //
      // Sin FK a `recipe_items`: la gracia de esta tabla es sobrevivir a las
      // filas que se borran, y una FK las borraría en cascada justo cuando
      // sirven.
      await q(`
        CREATE TABLE IF NOT EXISTS ${ARCHIVO} (
          id                       SERIAL PRIMARY KEY,
          empresa_id               INTEGER      NOT NULL,
          recipe_item_id           INTEGER      NOT NULL,
          recipe_item_id_sobreviviente INTEGER  NOT NULL,
          recipe_id                INTEGER      NOT NULL,
          product_id               INTEGER,
          ingredient_product_id    INTEGER      NOT NULL,
          cantidad_anterior        NUMERIC(12,4) NOT NULL,
          cantidad_final           NUMERIC(12,4) NOT NULL,
          fila                     JSONB        NOT NULL,
          revisar                  BOOLEAN      NOT NULL DEFAULT FALSE,
          nota                     TEXT,
          created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);

      await q(`CREATE INDEX IF NOT EXISTS ${ARCHIVO}_empresa_id ON ${ARCHIVO} (empresa_id)`);
      await q(`CREATE INDEX IF NOT EXISTS ${ARCHIVO}_revisar ON ${ARCHIVO} (revisar)`);

      // ════════ Paso 2 · El plan ════════
      //
      // El `ORDER BY … , ri.id` no es decoración: de ahí sale cuál fila
      // sobrevive. Sin él lo elegiría el planificador y dos corridas de la misma
      // migración sobre la misma base podrían conservar filas distintas.
      //
      // ⚠ Las dos fechas salen como TEXTO, y no es un capricho de estilo.
      //
      // La fila archivada se guarda con `JSON.stringify`, y para eso el driver
      // ya convirtió el `timestamptz` en un `Date` de JavaScript, que solo llega
      // al milisegundo. Los microsegundos que Postgres sí guarda se pierden ahí,
      // antes del JSON: `…:58.621389+00` se archiva como `…:58.621Z` y el `down`
      // reinserta la fila con una fecha que no es la que tenía. Lo encontró
      // `scripts/verificar-reversibilidad.js` comparando la base antes del `up`
      // con la base después del `down` — leyendo el `down` no se ve.
      //
      // Con `::text` el valor llega entero hasta el JSON, y el
      // `(d.fila->>'created_at')::timestamptz` del `down` lo devuelve idéntico.
      // `planificarFusiones` no mira ninguna de las dos columnas, así que el
      // cambio de tipo no le llega.
      const filas = await filasDe(`
        SELECT ri.id,
               ri.recipe_id,
               ri.ingredient_product_id,
               ri.quantity,
               ri.created_at::text AS created_at,
               ri.updated_at::text AS updated_at,
               r.empresa_id,
               r.product_id
          FROM recipe_items ri
          JOIN recipes r ON r.id = ri.recipe_id
         ORDER BY ri.recipe_id, ri.ingredient_product_id, ri.id
      `);

      const plan = planificarFusiones(filas);

      // ════════ Paso 3 · Fusionar ════════
      const porId = new Map(filas.map((f) => [f.id, f]));

      for (const fusion of plan.fusiones) {
        for (const f of fusion.filas) {
          const original = porId.get(f.id);

          await q(`
            INSERT INTO ${ARCHIVO}
              (empresa_id, recipe_item_id, recipe_item_id_sobreviviente, recipe_id,
               product_id, ingredient_product_id, cantidad_anterior, cantidad_final,
               fila, revisar, nota, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, NOW(), NOW())
          `, [
            fusion.empresa_id,
            f.id,
            fusion.sobreviviente_id,
            fusion.recipe_id,
            fusion.product_id ?? null,
            fusion.ingredient_product_id,
            f.quantity,
            fusion.cantidad_final,
            JSON.stringify(original),
            fusion.revisar,
            fusion.nota,
          ]);
        }

        await q(
          'UPDATE recipe_items SET quantity = $1, updated_at = NOW() WHERE id = $2',
          [fusion.cantidad_final, fusion.sobreviviente_id]
        );

        const absorbidas = fusion.filas.filter((f) => !f.sobrevive).map((f) => f.id);

        if (absorbidas.length) {
          await q(
            `DELETE FROM recipe_items WHERE id IN (${absorbidas.map((_, i) => `$${i + 1}`).join(', ')})`,
            absorbidas
          );
        }
      }

      // ════════ Paso 4 · La verificación, adentro de la transacción ════════
      //
      // «Ningún costo se movió», ejecutado en vez de prometido. Si la cantidad
      // total de un insumo en una receta cambió, no hay commit.
      const [descuadre] = await filasDe(`
        SELECT count(*)::int AS n
          FROM control_insumos a
          FULL OUTER JOIN (
                 SELECT recipe_id, ingredient_product_id, SUM(quantity)::numeric AS q
                   FROM recipe_items
                  GROUP BY 1, 2
               ) b
            ON b.recipe_id = a.recipe_id
           AND b.ingredient_product_id = a.ingredient_product_id
         WHERE a.recipe_id IS NULL OR b.recipe_id IS NULL OR a.q <> b.q
      `);

      if (descuadre.n > 0) {
        throw new Error(
          `La fusión cambió la cantidad de ${descuadre.n} insumo(s) de receta, o hizo `
          + 'desaparecer alguno. Fusionar solo puede sumar: si el total se movió, el plan '
          + 'está mal. No se aplicó nada.'
        );
      }

      // ════════ Paso 5 · El índice ════════
      //
      // Va último a propósito: si el paso 3 hubiera dejado un duplicado, este
      // CREATE falla y la transacción entera se revierte. Es la última red, y la
      // única que no depende de que el código de arriba esté bien.
      //
      // `IF NOT EXISTS` porque una base creada con `sequelize.sync()` puede
      // tenerlo ya, con este mismo nombre, desde que el modelo lo declara.
      //
      // Sin `CONCURRENTLY`: no puede correr dentro de una transacción, y las
      // migraciones de este repositorio corren con lock (`0264075`).
      // `recipe_items` son las líneas de las recetas de un negocio, no sus
      // ventas: el lock dura lo que tarda el índice.
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDICE} ON recipe_items (recipe_id, ingredient_product_id)`);

      // ════════ Paso 6 · El informe ════════
      //
      // Va al final y no al principio: si cualquier paso de arriba falla, no se
      // aplica nada, y un informe que dice «fusioné 4 filas» arriba del error que
      // revirtió todo es peor que no decir nada. Acá solo se imprime lo que ya
      // está escrito, a un commit de distancia.
      informar(plan);
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });
      const filasDe = async (sql, bind) => (await q(sql, bind))[0];

      // ── 1. El índice, primero ──
      //
      // Reinsertar las filas absorbidas vuelve a crear los duplicados: con el
      // único todavía puesto, el INSERT fallaría.
      await q(`DROP INDEX IF EXISTS ${INDICE}`);

      const [existe] = await filasDe(`SELECT to_regclass('public.${ARCHIVO}') IS NOT NULL AS hay`);

      if (!existe.hay) {
        // El `up` la crea siempre, así que llegar acá significa que alguien la
        // borró a mano. Se avisa y se sigue: el índice ya se cayó, que es la
        // parte del `up` que sí se puede revertir sin el archivo.
        console.log(
          `[recipe_items] No existe ${ARCHIVO}: se quitó el índice único pero no hay nada `
          + 'archivado con qué restaurar las filas fusionadas.'
        );
        return;
      }

      // ── 2. La cantidad de la sobreviviente ──
      //
      // Va ANTES de reinsertar: es lo que evita que la receta quede con la
      // cantidad sumada más las filas originales, o sea al doble.
      await q(`
        UPDATE recipe_items ri
           SET quantity = (d.fila->>'quantity')::numeric,
               updated_at = NOW()
          FROM ${ARCHIVO} d
         WHERE d.recipe_item_id = ri.id
           AND d.recipe_item_id = d.recipe_item_id_sobreviviente
      `);

      // ── 3. Las filas absorbidas, con su id original ──
      await q(`
        INSERT INTO recipe_items (id, recipe_id, ingredient_product_id, quantity, created_at, updated_at)
        SELECT (d.fila->>'id')::int,
               (d.fila->>'recipe_id')::int,
               (d.fila->>'ingredient_product_id')::int,
               (d.fila->>'quantity')::numeric,
               (d.fila->>'created_at')::timestamptz,
               (d.fila->>'updated_at')::timestamptz
          FROM ${ARCHIVO} d
         WHERE d.recipe_item_id <> d.recipe_item_id_sobreviviente
         ORDER BY (d.fila->>'id')::int
        ON CONFLICT (id) DO NOTHING
      `);

      // Reinsertar con id explícito no mueve la secuencia: sin esto, el próximo
      // INSERT de recipe_items choca contra un id que ya existe.
      await q(`
        SELECT setval(
          pg_get_serial_sequence('recipe_items', 'id'),
          GREATEST((SELECT COALESCE(MAX(id), 1) FROM recipe_items), 1)
        )
      `);

      // ── 4. El archivo ──
      await q(`DROP TABLE IF EXISTS ${ARCHIVO}`);
    });
  },
};
