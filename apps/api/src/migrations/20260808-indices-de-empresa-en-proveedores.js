'use strict';

/**
 * ════════════════════════════════════════════
 *  Índices por empresa en las tres tablas de proveedores
 *  Migración 18, aditiva
 * ════════════════════════════════════════════
 *
 * ── Por qué recién ahora ──
 *
 * El saldo del proveedor pasa a calcularlo el servidor (spec 012, decisión 4).
 * Con eso, tres tablas que hasta hoy solo se consultaban por `supplier_id` pasan
 * a consultarse por `empresa_id` en **cada carga de pantalla**, y ninguna de las
 * tres tenía índice por esa columna: el listado de proveedores era un barrido
 * secuencial de los movimientos de TODAS las empresas cliente.
 *
 * ── Por qué compuestos, y en ese orden ──
 *
 * Las cuatro consultas filtran por empresa **y** agrupan, ordenan o filtran por
 * una segunda columna. Un índice de una sola columna deja la segunda para un
 * filtro sobre las filas ya leídas; el compuesto la resuelve adentro del índice.
 * `empresa_id` va primero porque es el único que está siempre.
 *
 * ── Por qué sin CONCURRENTLY ──
 *
 * `CREATE INDEX CONCURRENTLY` no puede correr dentro de una transacción, y las
 * migraciones de este repositorio corren con lock (`0264075`). Las tres tablas
 * son chicas —son las compras de un negocio, no sus ventas— así que el lock de
 * escritura dura lo que tarda el índice. Si alguna vez dejan de serlo, el cambio
 * es sacar la transacción y usar CONCURRENTLY en un archivo propio.
 *
 * ── Los nombres tienen que coincidir con los del modelo ──
 *
 * Sequelize nombra los índices que declara un modelo como `<tabla>_<col>_<col>`,
 * no como el `idx_…` de acá. Sobre una base creada por migraciones, un
 * `sync({ alter: true })` en desarrollo intentaría crear un **segundo** índice
 * con su propio nombre sobre las mismas columnas. Por eso las entradas de
 * `models/Supplier.js` llevan `name` explícito, idéntico a estos cuatro, y
 * `tests/indicesDeProveedores.test.js` compara los dos archivos.
 *
 * ⚠ `scripts/verificar-esquema.js` **no mira índices**: hace un `findOne` por
 * modelo, o sea que verifica que la tabla y las columnas existan. Si esta
 * migración se olvidara de uno, ese chequeo pasaría igual. Lo que lo detecta es
 * el `EXPLAIN` del paso manual P6.
 */

/** Los cuatro, en el orden en que se crean. El `down` los borra al revés. */
const INDICES = [
  { nombre: 'idx_supplier_movements_empresa_supplier', tabla: 'supplier_movements', columnas: 'empresa_id, supplier_id' },
  { nombre: 'idx_supplier_orders_empresa_status', tabla: 'supplier_orders', columnas: 'empresa_id, status' },
  { nombre: 'idx_supplier_orders_empresa_date', tabla: 'supplier_orders', columnas: 'empresa_id, date' },
  { nombre: 'idx_supplier_documents_empresa_supplier', tabla: 'supplier_documents', columnas: 'empresa_id, supplier_id' },
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const { nombre, tabla, columnas } of INDICES) {
        // `IF NOT EXISTS` porque una base creada con `sequelize.sync()` puede
        // tenerlos ya, con este mismo nombre, desde que el modelo los declara.
        await queryInterface.sequelize.query(
          `CREATE INDEX IF NOT EXISTS ${nombre} ON ${tabla} (${columnas});`,
          { transaction }
        );
      }
    });
  },

  async down(queryInterface) {
    // Reversible de verdad: un índice no guarda datos. El `down` deja el esquema
    // exactamente como estaba y el `up` puede volver a correr sin error, que es
    // lo que hace que esta migración pueda recrear la base desde cero.
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const { nombre } of [...INDICES].reverse()) {
        await queryInterface.sequelize.query(
          `DROP INDEX IF EXISTS ${nombre};`,
          { transaction }
        );
      }
    });
  },
};
