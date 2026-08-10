'use strict';

/**
 * ════════════════════════════════════════════
 *  El CHECK de las reglas impedía borrar una marca
 *  Migración 28 — corrección de `20260816-catalogo-productos-y-reglas.js`.
 * ════════════════════════════════════════════
 *
 * ── El defecto ──
 *
 * `catalogo_reglas_precio.brand_id` se creó con `ON DELETE SET NULL`, a
 * propósito: el diseño dice que borrar una marca **no borra** la regla que la
 * apuntaba, sino que la deja huérfana —cobertura «0 de 0», dibujada atenuada—
 * para que alguien la vea y decida qué hacer con ella.
 *
 * Pero el CHECK `ck_regla_ambito` exigía, para el ámbito `marca`,
 * `brand_id IS NOT NULL`. O sea que **la fila que el `SET NULL` intenta escribir
 * es exactamente la que el CHECK prohíbe**: el `DELETE FROM brands` aborta con
 * `23514 / ck_regla_ambito`.
 *
 * Medido contra Postgres antes de escribir esta migración. El resultado es que
 * hoy **el CHECK protege a la marca**: no se puede borrar mientras exista una
 * regla que la nombre. Es lo contrario de lo diseñado, y el mensaje que recibe
 * quien intenta borrarla no menciona ninguna regla de precio.
 *
 * ── La corrección, y por qué ésta y no la otra ──
 *
 * Se **relaja el CHECK** para el ámbito `marca`: `brand_id` puede ser `NULL`.
 *
 * La alternativa era cambiar la FK a `ON DELETE CASCADE`, o sea que borrar la
 * marca se lleve la regla. Se descartó porque **pierde configuración en
 * silencio**: alguien negoció un descuento por marca, borra la marca por otro
 * motivo, y la regla desaparece sin que nadie lo note. Con la huérfana, la
 * pantalla la muestra en «0 de 0» y quien la ve decide.
 *
 * Lo que el CHECK deja de exigir lo sigue exigiendo `utils/reglasDePrecio.js`
 * en `validarRegla`, que es donde corresponde: **al escribir**. El CHECK es una
 * red contra filas imposibles, no el lugar donde se valida un formulario — y
 * una red que impide una operación legítima es peor que no tenerla.
 *
 * Los otros tres ámbitos no cambian: `categoria` y `producto` siguen exigiendo
 * su columna, porque sus FK no son `SET NULL` (la de producto es `CASCADE`, y
 * la categoría es texto sin FK).
 */

const NOMBRE = 'ck_regla_ambito';

/** El CHECK viejo, para poder volver exactamente a él. */
const VIEJO = `
  (ambito = 'catalogo'  AND categoria IS NULL     AND brand_id IS NULL     AND product_id IS NULL) OR
  (ambito = 'categoria' AND categoria IS NOT NULL AND brand_id IS NULL     AND product_id IS NULL) OR
  (ambito = 'marca'     AND categoria IS NULL     AND brand_id IS NOT NULL AND product_id IS NULL) OR
  (ambito = 'producto'  AND categoria IS NULL     AND brand_id IS NULL     AND product_id IS NOT NULL)
`;

/** El nuevo: igual, salvo que la regla de marca admite la marca borrada. */
const NUEVO = `
  (ambito = 'catalogo'  AND categoria IS NULL     AND brand_id IS NULL AND product_id IS NULL) OR
  (ambito = 'categoria' AND categoria IS NOT NULL AND brand_id IS NULL AND product_id IS NULL) OR
  (ambito = 'marca'     AND categoria IS NULL                          AND product_id IS NULL) OR
  (ambito = 'producto'  AND categoria IS NULL     AND brand_id IS NULL AND product_id IS NOT NULL)
`;

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      await q(`ALTER TABLE catalogo_reglas_precio DROP CONSTRAINT IF EXISTS ${NOMBRE}`);
      await q(`ALTER TABLE catalogo_reglas_precio ADD CONSTRAINT ${NOMBRE} CHECK (${NUEVO})`);

      console.log('[reglas] El CHECK ya no impide borrar una marca: la regla queda huérfana, como corresponde.');
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ⚠ Volver al CHECK estricto falla si ya hay alguna regla huérfana, y está
      // bien que falle: revertir esta migración sobre una base que las tiene
      // significaría borrar configuración que alguien todavía no miró. El
      // mensaje de Postgres nombra la constraint; el motivo está acá.
      await q(`ALTER TABLE catalogo_reglas_precio DROP CONSTRAINT IF EXISTS ${NOMBRE}`);
      await q(`ALTER TABLE catalogo_reglas_precio ADD CONSTRAINT ${NOMBRE} CHECK (${VIEJO})`);
    });
  },
};
