'use strict';

/**
 * ════════════════════════════════════════════
 *  cashflow_entries.punto_de_venta_id
 *  Migración 17, aditiva
 * ════════════════════════════════════════════
 *
 * ── Cómo apareció ──
 *
 * Escribiendo el chequeo de esquema de CI (`scripts/verificar-esquema.js`), que
 * hace un `findOne` por modelo. Contra una base creada solo con migraciones,
 * `CashFlowEntry` falla con `column "punto_de_venta_id" does not exist`.
 *
 * Es el mismo agujero que las cuatro tablas de permisos —modelo sin migración—
 * pero en una columna: `20260604-add-pv-to-fixed-expenses.js` agregó
 * `punto_de_venta_id` a `fixed_expenses` y no a `cashflow_entries`, aunque
 * `models/CashFlowEntry.js:40` la declara y le pone índice.
 *
 * ── Qué rompe ──
 *
 * Sequelize enumera todas las columnas del modelo en cada `SELECT`, así que en
 * una base recreada **cualquier** consulta a `cashflow_entries` revienta: la
 * pantalla de Caja entera devuelve 500. A diferencia de los permisos, esto no
 * falla en silencio; falla ruidosamente. Pero falla igual, y por la misma razón.
 *
 * ── Por qué va en un archivo aparte del esquema de permisos ──
 *
 * No tienen nada que ver una con otra, y ésta **sí es reversible sin perder
 * nada**: la columna está vacía en producción —la creó `sequelize.sync()` y
 * nadie la escribe todavía— y en una base recreada ni existe. Atarla a una
 * migración irreversible sería regalarle esa propiedad.
 *
 * ── Forma ──
 *
 * La de `sequelize.sync()`, que es la que tiene producción: `integer` nullable,
 * FK a `puntos_de_venta` con `ON DELETE SET NULL` —dar de baja una sucursal no
 * puede borrar los movimientos de caja que se hicieron ahí— e índice
 * `cashflow_entries_punto_de_venta_id`.
 */

const TABLA = 'cashflow_entries';
const INDICE = 'cashflow_entries_punto_de_venta_id';

/** Si la tabla ya tiene una foreign key sobre `punto_de_venta_id`. */
async function existeFk(queryInterface, transaction) {
  const [filas] = await queryInterface.sequelize.query(`
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND t.relname = '${TABLA}'
       AND a.attname = 'punto_de_venta_id'
  `, { transaction });

  return filas.length > 0;
}

module.exports = {
  async up(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    await queryInterface.sequelize.transaction(async (transaction) => {
      // `IF NOT EXISTS` porque en producción la columna ya está: la puso el
      // `sequelize.sync()` con el que se creó esa base.
      await q(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS punto_de_venta_id integer`, transaction);

      if (!await existeFk(queryInterface, transaction)) {
        await q(`
          ALTER TABLE ${TABLA}
            ADD CONSTRAINT ${TABLA}_punto_de_venta_id_fkey
            FOREIGN KEY (punto_de_venta_id) REFERENCES puntos_de_venta(id)
            ON UPDATE CASCADE ON DELETE SET NULL
        `, transaction);
      }

      await q(`CREATE INDEX IF NOT EXISTS ${INDICE} ON ${TABLA} (punto_de_venta_id)`, transaction);
    });
  },

  async down(queryInterface) {
    // Reversible de verdad: la columna no tiene datos que perder. Se saca el
    // índice explícito aunque el DROP COLUMN se lo lleve puesto, para que el
    // `down` diga lo que hace en vez de depender de un comportamiento de
    // Postgres.
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await q(`DROP INDEX IF EXISTS ${INDICE}`);
      await q(`ALTER TABLE ${TABLA} DROP COLUMN IF EXISTS punto_de_venta_id`);
    });
  },
};
