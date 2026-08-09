'use strict';

/**
 * ════════════════════════════════════════════
 *  catalogo_productos y catalogo_reglas_precio
 *  Migración 26 — corte F1.2 de `docs/specs/015-catalogo-de-ventas-online`.
 * ════════════════════════════════════════════
 *
 * ── `catalogo_productos` es una LISTA DE INCLUSIÓN ──
 *
 * Si un producto no está acá, no sale a ese catálogo. Un producto publicable
 * nuevo **no aparece solo** en ninguna página pública: hay que agregarlo.
 *
 * Por eso no existe `catalogos.incluye_todos` ni la columna `visible` que traía
 * el borrador del plan. Con inclusión explícita, «no está en la tabla» ya
 * significa «no se publica», y una segunda forma de decir lo mismo es una que
 * puede contradecir a la otra.
 *
 * **Sin `empresa_id`, a propósito.** La tabla se opera siempre como «las filas
 * del catálogo X», y X ya pasó por `findScoped`. La columna daría una segunda
 * fuente de verdad sobre a quién pertenece la fila, y dos fuentes es una que
 * puede estar mal.
 *
 * ── `catalogo_reglas_precio`: tres columnas anulables, no una polimórfica ──
 *
 * El borrador traía `ambito_valor STRING(100)` guardando «texto de categoría o
 * brand_id o product_id». El problema es de la base, no de estilo: **una columna
 * así no puede tener clave foránea**. Sin FK, borrar una marca deja una regla
 * apuntando a un número que ya no existe, y el «borrar el producto borra su
 * regla» no se puede escribir.
 *
 * Con tres columnas cada una tiene la suya y el motor las respeta:
 *
 *   - borrar el **producto** borra la regla — no hay nada que pueda significar;
 *   - borrar la **marca** deja `brand_id` en NULL, y el motor lo lee como «no
 *     alcanza a nadie»: la fila se dibuja atenuada, «0 de 0». No se borra sola.
 *
 * ── Los cuatro índices únicos PARCIALES ──
 *
 * Uno por ámbito. Un índice único ordinario sobre las cinco columnas **no
 * serviría**: en Postgres `NULL` no es igual a `NULL`, así que dos reglas de
 * ámbito `catalogo` —las dos con las tres columnas en NULL— no chocarían nunca.
 *
 * Y son los que hacen que el motor de reglas sea simple: con estos cuatro, un
 * producto tiene **como mucho cuatro candidatas, una por ámbito**, así que «gana
 * la más específica» es un máximo sobre cuatro elementos y no hay empate que
 * desempatar.
 *
 * ── El CHECK ──
 *
 * Exige exactamente la columna del ámbito y ninguna otra. Sin él, una regla de
 * ámbito `marca` con `product_id` cargado es una fila que el motor no sabe
 * interpretar y que ningún test va a producir por su cuenta.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ════════ catalogo_productos ════════
      await q(`
        CREATE TABLE IF NOT EXISTS catalogo_productos (
          id          SERIAL PRIMARY KEY,
          catalogo_id INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
          -- Si se borra el producto, su fila del catálogo se va con él: no hay
          -- nada que la fila pueda significar sin el producto.
          product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          orden       INTEGER NOT NULL DEFAULT 0,
          created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      // Agregar dos veces el mismo producto es un no-op, no una fila duplicada.
      await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_producto
        ON catalogo_productos (catalogo_id, product_id)
      `);
      // El orden en el que se dibuja la grilla.
      await q(`
        CREATE INDEX IF NOT EXISTS idx_catalogo_producto_catalogo
        ON catalogo_productos (catalogo_id, orden)
      `);

      // ════════ catalogo_reglas_precio ════════
      //
      // Los dos tipos ENUM, con el nombre que genera Sequelize. Ver el motivo
      // completo en `20260815-catalogos.js`: si acá fueran VARCHAR y en el
      // modelo ENUM, el `sync({ alter: true })` del arranque tumbaría el job
      // `navegador` del CI.
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_catalogo_reglas_precio_ambito') THEN
            CREATE TYPE enum_catalogo_reglas_precio_ambito AS ENUM ('catalogo', 'categoria', 'marca', 'producto');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_catalogo_reglas_precio_tipo') THEN
            CREATE TYPE enum_catalogo_reglas_precio_tipo AS ENUM ('porcentaje_descuento', 'monto_descuento', 'precio_fijo');
          END IF;
        END
        $$
      `);

      await q(`
        CREATE TABLE IF NOT EXISTS catalogo_reglas_precio (
          id          SERIAL PRIMARY KEY,
          -- Está para que findScoped(CatalogoReglaPrecio, id, empresaId)
          -- funcione directo en el ABM, sin pasar por el catálogo.
          empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          catalogo_id INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,

          ambito      enum_catalogo_reglas_precio_ambito NOT NULL,
          categoria   VARCHAR(50),
          -- SET NULL: la regla queda «no alcanza a nadie» y se dibuja atenuada.
          brand_id    INTEGER REFERENCES brands(id) ON DELETE SET NULL,
          -- CASCADE: sin el producto, la regla no significa nada.
          product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,

          tipo        enum_catalogo_reglas_precio_tipo NOT NULL,
          valor       DECIMAL(12,2) NOT NULL,
          -- Una regla desactivada se comporta como si no existiera.
          activo      BOOLEAN NOT NULL DEFAULT true,

          created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      await q(`
        ALTER TABLE catalogo_reglas_precio
        ADD CONSTRAINT ck_regla_ambito CHECK (
          (ambito = 'catalogo'  AND categoria IS NULL     AND brand_id IS NULL     AND product_id IS NULL) OR
          (ambito = 'categoria' AND categoria IS NOT NULL AND brand_id IS NULL     AND product_id IS NULL) OR
          (ambito = 'marca'     AND categoria IS NULL     AND brand_id IS NOT NULL AND product_id IS NULL) OR
          (ambito = 'producto'  AND categoria IS NULL     AND brand_id IS NULL     AND product_id IS NOT NULL)
        )
      `);

      // Uno por ámbito, y parciales. Ver el encabezado: un único índice sobre
      // las cinco columnas no chocaría nunca para el ámbito `catalogo`.
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_regla_catalogo  ON catalogo_reglas_precio (catalogo_id)             WHERE ambito = 'catalogo'`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_regla_categoria ON catalogo_reglas_precio (catalogo_id, categoria)  WHERE ambito = 'categoria'`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_regla_marca     ON catalogo_reglas_precio (catalogo_id, brand_id)   WHERE ambito = 'marca'`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_regla_producto  ON catalogo_reglas_precio (catalogo_id, product_id) WHERE ambito = 'producto'`);

      await q('CREATE INDEX IF NOT EXISTS idx_regla_empresa ON catalogo_reglas_precio (empresa_id)');

      console.log('[catalogo] Lista de inclusión y reglas de precio creadas.');
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      await q('DROP TABLE IF EXISTS catalogo_reglas_precio');
      await q('DROP TABLE IF EXISTS catalogo_productos');
      await q('DROP TYPE IF EXISTS enum_catalogo_reglas_precio_ambito');
      await q('DROP TYPE IF EXISTS enum_catalogo_reglas_precio_tipo');
    });
  },
};
