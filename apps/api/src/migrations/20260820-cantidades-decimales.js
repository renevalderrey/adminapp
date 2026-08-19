'use strict';

/**
 * ════════════════════════════════════════════
 *  Las cantidades dejan de ser enteras: nueve columnas a NUMERIC(14,4)
 *  Migración 31 — Fase 3 de `docs/specs/016-cantidades-decimales`.
 * ════════════════════════════════════════════
 *
 * ── El problema ──
 *
 * `recipe_items.quantity` y `production_orders.quantity_produced` ya son
 * `DECIMAL(12,4)`, y son las que se **restan** de `stock`. Como `stock.quantity`
 * es `INTEGER`, una producción que consume 0,4 sobre un stock de 10 deja **10**
 * en la base y no 9,6: Postgres redondea al asignar y nadie se entera. Es el
 * hallazgo `auditoria-frente2-hallazgos.json:335`, y el mismo redondeo se come
 * las líneas de venta, los movimientos y las líneas de pedido.
 *
 * ── Por qué cuatro decimales y no tres ──
 *
 * Porque las dos columnas que se restan de `stock` ya tienen cuatro. Con tres,
 * una producción de 1,2345 se redondearía al descontar: **el mismo defecto que
 * esta migración vino a eliminar, en espejo**. Cuántos decimales admite una
 * línea de venta es otra pregunta y la contesta un validador
 * (`utils/cantidades.js:DECIMALES_DE_UNA_LINEA_DE_VENTA`), no la columna.
 *
 * Catorce dígitos dejan diez enteros: 9.999.999.999,9999. Por encima de eso
 * rechaza el validador con un mensaje legible, y no Postgres con un 500.
 *
 * ── Por qué un `ALTER TYPE` directo y no una columna nueva con copia en lotes ──
 *
 * Porque se midió (PENDIENTE 3 de la spec, confirmado por el dueño del producto
 * el 17/8/2026 contra la base de producción): `sale_items` 4 filas, `stock` 42,
 * `stock_movements` 5, `pedido_items` 2. El `ACCESS EXCLUSIVE LOCK` de cada
 * `ALTER` sobre eso es instantáneo. Una columna nueva, un período de doble
 * escritura y una reconciliación para ahorrar un lock de milisegundos sobre
 * cuatro filas es un plan que cuesta más que el problema.
 *
 * ⚠ Si alguna vez estas tablas crecen a cientos de miles de filas, **este plan
 * se reabre**: el procedimiento de `docs/OPERACION.md` empieza por volver a
 * medirlas.
 *
 * ── Por qué se saltean las columnas que ya están, y no es solo velocidad ──
 *
 * FR-005 promete que después de convertir **ninguna fila quedó fraccionaria**:
 * antes eran todas enteras, así que después tienen que seguir siéndolo. Esa
 * promesa solo es cierta sobre las columnas que **esta corrida** convirtió. En
 * una base que ya migró, y donde después hubo una producción con consumo
 * fraccionario, exigirla sobre todas abortaría la migración **por hacer bien su
 * trabajo**. Por eso se lee `information_schema` primero y se verifica solo lo
 * convertido; de paso, correrla dos veces no reescribe ninguna tabla.
 *
 * ── El `down` se niega, pero solo cuando corresponde ──
 *
 * Bajar a `INTEGER` con filas fraccionarias las redondearía sin avisar, que es
 * el defecto de arriba en espejo. Sin fracciones, revertir es limpio y negarse
 * obligaría a la próxima persona a editar este archivo. Así que cuenta y decide.
 *
 * ⚠ **No va en el mapa `SE_NIEGAN` de `scripts/verificar-reversibilidad.js`**
 * (FR-012): ese mapa es de las que se niegan *siempre*, y su test corre el
 * `down` **esperando que falle**. Una negativa condicional metida ahí pasaría en
 * verde sobre una base limpia por la razón equivocada. El precedente correcto es
 * `20260804-identidad-de-sucursal-en-stock.js`, que se niega por una condición
 * de los datos y tiene su propio caso.
 */

/** La escala nueva. Se exporta porque los tests de modelo atan el modelo a esto. */
const PRECISION = 14;
const ESCALA = 4;

/**
 * Las nueve columnas, en el orden en que se convierten.
 *
 * Se exporta para que `tests/modeloStock.test.js` y sus tres gemelos puedan
 * afirmar que el modelo declara la MISMA escala que escribe la migración:
 * `scripts/verificar-esquema.js` compara `udt_name` y nada más (`:204`), así que
 * para él `numeric(14,4)` y `numeric(12,4)` son la misma columna.
 */
const COLUMNAS = [
  { tabla: 'sale_items', columna: 'quantity' },
  { tabla: 'stock', columna: 'quantity' },
  { tabla: 'stock', columna: 'available' },
  { tabla: 'stock', columna: 'min_stock' },
  { tabla: 'stock_movements', columna: 'cantidad_anterior' },
  { tabla: 'stock_movements', columna: 'cantidad_nueva' },
  { tabla: 'stock_movements', columna: 'disponible_anterior' },
  { tabla: 'stock_movements', columna: 'disponible_nuevo' },
  { tabla: 'pedido_items', columna: 'cantidad' },
];

/** La tabla de la foto de control. Temporal y `ON COMMIT DROP`. */
const FOTO = 'control_antes_cantidades';

/**
 * Cómo está declarada hoy cada una de las nueve, según la base.
 *
 * Si alguna no aparece, la migración corta: una columna que se renombró y quedó
 * en esta lista sería una conversión que nadie hace y nadie ve.
 */
async function tiposActuales(filasDe) {
  const tablas = [...new Set(COLUMNAS.map((c) => c.tabla))].map((t) => `'${t}'`).join(', ');
  const columnas = [...new Set(COLUMNAS.map((c) => c.columna))].map((c) => `'${c}'`).join(', ');

  const filas = await filasDe(`
    SELECT table_name  AS tabla,
           column_name AS columna,
           data_type   AS tipo,
           numeric_precision AS precision,
           numeric_scale     AS escala
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name  IN (${tablas})
       AND column_name IN (${columnas})
  `);

  const porClave = new Map(filas.map((f) => [`${f.tabla}.${f.columna}`, f]));

  const faltantes = COLUMNAS
    .filter(({ tabla, columna }) => !porClave.has(`${tabla}.${columna}`))
    .map(({ tabla, columna }) => `${tabla}.${columna}`);

  if (faltantes.length) {
    throw new Error(
      `[cantidades] Estas columnas no existen en la base: ${faltantes.join(', ')}. `
      + 'La migración no puede convertir lo que no está: revisá si se renombraron. '
      + 'No se aplicó nada.'
    );
  }

  return porClave;
}

/** La consulta que arma la foto: filas y suma de cada columna de la lista. */
function foto(lista) {
  return lista
    .map(({ tabla, columna }) => `
      SELECT '${tabla}'::text AS tabla,
             '${columna}'::text AS columna,
             COUNT(*)::bigint AS filas,
             COALESCE(SUM(${columna}), 0)::numeric AS suma
        FROM ${tabla}`)
    .join(' UNION ALL ');
}

/** Cuántas filas tienen un valor con parte decimal, columna por columna. */
function fraccionarias(lista) {
  return lista
    .map(({ tabla, columna }) => `
      SELECT '${tabla}'::text AS tabla,
             '${columna}'::text AS columna,
             COUNT(*)::int AS n
        FROM ${tabla}
       WHERE ${columna} <> ROUND(${columna})`)
    .join(' UNION ALL ');
}

module.exports = {
  // Exportados para los tests. `sequelize-cli` solo mira `up` y `down`.
  COLUMNAS,
  PRECISION,
  ESCALA,

  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });
      const filasDe = async (sql) => (await q(sql))[0];

      // ════════ 1 · Qué falta convertir ════════
      const actuales = await tiposActuales(filasDe);

      const pendientes = COLUMNAS.filter(({ tabla, columna }) => {
        const f = actuales.get(`${tabla}.${columna}`);
        return !(f.tipo === 'numeric'
          && Number(f.precision) === PRECISION
          && Number(f.escala) === ESCALA);
      });

      if (!pendientes.length) {
        console.log(
          `[cantidades] Las ${COLUMNAS.length} columnas ya son NUMERIC(${PRECISION},${ESCALA}): no se tocó nada.`
        );
        return;
      }

      // ════════ 2 · La foto de control ════════
      //
      // Temporal y `ON COMMIT DROP`: muere con la transacción, haya commit o
      // rollback, y no deja basura. Es contra esto que compara el paso 4, y es
      // más fuerte que el `COUNT(*)` de FR-005: detecta también una fila que
      // cambió de valor sin dejar de ser entera.
      await q(`CREATE TEMP TABLE ${FOTO} ON COMMIT DROP AS ${foto(pendientes)}`);

      // ════════ 3 · Los ALTER ════════
      //
      // Sin `USING`: `integer → numeric` es implícita y sin pérdida. El paso 4
      // lo verifica en vez de darlo por hecho.
      for (const { tabla, columna } of pendientes) {
        await q(`ALTER TABLE ${tabla} ALTER COLUMN ${columna} TYPE NUMERIC(${PRECISION}, ${ESCALA})`);
      }

      // ════════ 4 · Lo que esta migración promete ════════
      //
      // Adentro de la misma transacción: comprobarlo después, con la migración
      // ya asentada, sería tarde para no aplicarla.
      //
      // ⚠ Sobre una base VACÍA las dos comprobaciones pasan siempre y no
      // verifican nada. Por eso el test de esta migración siembra filas antes
      // de correrla (`integracion/reversionDeCantidades.integracion.test.js`).

      // 4.a · FR-005 · ninguna fila quedó fraccionaria.
      const conDecimales = (await filasDe(fraccionarias(pendientes))).filter((f) => f.n > 0);

      if (conDecimales.length) {
        throw new Error(
          '[cantidades] La conversión dejó filas con parte decimal donde antes había enteros: '
          + conDecimales.map((f) => `${f.tabla}.${f.columna} (${f.n} fila(s))`).join(', ')
          + '. Antes de convertir eran todas enteras, así que después tienen que seguir '
          + 'siéndolo. No se aplicó nada.'
        );
      }

      // 4.b · Ninguna suma se movió.
      const movidas = await filasDe(`
        SELECT a.tabla, a.columna,
               a.filas AS filas_antes,  d.filas AS filas_despues,
               a.suma  AS suma_antes,   d.suma  AS suma_despues
          FROM ${FOTO} a
          JOIN (${foto(pendientes)}) d
            ON d.tabla = a.tabla AND d.columna = a.columna
         WHERE a.suma  IS DISTINCT FROM d.suma
            OR a.filas IS DISTINCT FROM d.filas
      `);

      if (movidas.length) {
        throw new Error(
          '[cantidades] La conversión cambió el contenido de alguna columna: '
          + movidas
            .map((m) => `${m.tabla}.${m.columna} pasó de ${m.suma_antes} (${m.filas_antes} fila(s)) `
              + `a ${m.suma_despues} (${m.filas_despues} fila(s))`)
            .join('; ')
          + '. Un cambio de tipo no puede mover ningún valor. No se aplicó nada.'
        );
      }

      // ════════ 5 · El log ════════
      //
      // Es lo que se lee el día del despliegue para saber que hizo lo que dice.
      const antes = await filasDe(`SELECT tabla, columna, filas FROM ${FOTO} ORDER BY tabla, columna`);
      const porTabla = new Map(antes.map((f) => [f.tabla, f.filas]));

      console.log(
        `[cantidades] ${pendientes.length} columna(s) convertida(s) a NUMERIC(${PRECISION},${ESCALA}): `
        + pendientes.map(({ tabla, columna }) => `${tabla}.${columna}`).join(', ')
      );

      for (const [tabla, filas] of porTabla) {
        console.log(`[cantidades]   ${tabla}: ${filas} fila(s) al momento de convertir.`);
      }

      const yaEstaban = COLUMNAS.length - pendientes.length;
      if (yaEstaban > 0) {
        console.log(`[cantidades] Otras ${yaEstaban} columna(s) ya estaban convertidas y no se tocaron.`);
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });
      const filasDe = async (sql) => (await q(sql))[0];

      const actuales = await tiposActuales(filasDe);

      const aRevertir = COLUMNAS.filter(({ tabla, columna }) => (
        actuales.get(`${tabla}.${columna}`).tipo === 'numeric'
      ));

      if (!aRevertir.length) {
        console.log('[cantidades] Las nueve columnas ya son INTEGER: no hay nada que revertir.');
        return;
      }

      // ── Contar ANTES de tocar nada ──
      //
      // Por tabla, las filas con **al menos una** columna fraccionaria. Se cuenta
      // por fila y no por columna porque lo que se pierde al revertir es la fila:
      // un stock en 9,6 con su disponible en 9,6 es una sola cosa que se rompe.
      const porTabla = new Map();
      for (const { tabla, columna } of aRevertir) {
        if (!porTabla.has(tabla)) porTabla.set(tabla, []);
        porTabla.get(tabla).push(columna);
      }

      const conteo = await filasDe(
        [...porTabla.entries()]
          .map(([tabla, columnas]) => `
            SELECT '${tabla}'::text AS tabla, COUNT(*)::int AS n
              FROM ${tabla}
             WHERE ${columnas.map((c) => `${c} <> ROUND(${c})`).join(' OR ')}`)
          .join(' UNION ALL ')
      );

      const conFracciones = conteo.filter((f) => f.n > 0);

      if (conFracciones.length) {
        throw new Error(
          'No se puede revertir: '
          + conFracciones.map((f) => `${f.tabla} tiene ${f.n} fila(s) con cantidades fraccionarias`).join(', ')
          + ', y volver a INTEGER las redondearía sin avisar, que es exactamente el defecto '
          + 'que esta migración eliminó. Si hay que bajar igual, primero hay que decidir '
          + 'a mano qué pasa con esas filas: redondearlas es inventar inventario. '
          + 'No se aplicó nada.'
        );
      }

      // El `USING` va explícito aunque el cast de asignación exista: acá la
      // conversión **es** el punto del paso y tiene que leerse, no deducirse.
      for (const { tabla, columna } of aRevertir) {
        await q(`ALTER TABLE ${tabla} ALTER COLUMN ${columna} TYPE INTEGER USING ${columna}::integer`);
      }

      console.log(
        `[cantidades] ${aRevertir.length} columna(s) devuelta(s) a INTEGER: `
        + aRevertir.map(({ tabla, columna }) => `${tabla}.${columna}`).join(', ')
        + '. No había ninguna fila fraccionaria, así que no se perdió ningún valor; '
        + 'de acá en adelante una producción con consumo fraccionario vuelve a redondearse.'
      );
    });
  },
};
