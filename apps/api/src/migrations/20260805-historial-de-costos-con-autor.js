'use strict';

/**
 * ════════════════════════════════════════════
 *  product_cost_history: quién cambió el costo y de qué empresa es la fila
 *  Migración 15, aditiva
 * ════════════════════════════════════════════
 *
 * ── El problema ──
 *
 * `product_cost_history` no tiene `empresa_id`. Cualquier consulta que no pase
 * por `products` para filtrar —«qué costos cambiaron esta semana», el conteo por
 * motivo, cualquier reporte global— es una consulta **sin scoping de empresa**.
 * Es la clase de agujero que este proyecto ya pagó tres veces: la auditoría
 * encontró veinte endpoints filtrando datos entre clientes y ocho más un mes
 * después.
 *
 * Y no tiene `usuario_id`: el historial dice qué pasó y cuándo, pero no quién.
 * Con cinco caminos distintos que mueven costos —edición manual, carga masiva,
 * actualización masiva, importación de listas y recosteo— «quién» es la mitad de
 * la pregunta.
 *
 * ── Por qué va en un archivo aparte de la 14 ──
 *
 * `data-model.md` metía estas dos columnas en la migración de `stock`. Se
 * separan a propósito: esto es aditivo, nullable y reversible sin riesgo,
 * mientras que la 14 es el punto sin retorno (aplica un `NOT NULL` y consolida
 * filas). Atarlas al mismo archivo significaría que el cambio inofensivo no
 * puede desplegarse sin el peligroso, y que el `down` del peligroso se lleva
 * puesto al inofensivo. **Esta se puede aplicar antes, después o sin la 14.**
 *
 * ── Por qué las dos columnas son NULLABLE ──
 *
 * `empresa_id` se backfillea desde `products`, pero queda en `NULL` para las
 * filas cuyo producto ya no existe. Obligar `NOT NULL` sería inventarles un
 * valor: adivinar de qué empresa era un producto borrado es exactamente el tipo
 * de dato falso que después nadie puede distinguir de uno real.
 *
 * `usuario_id` **no se backfillea**. Ese dato no existe en ningún lado y no se
 * puede inferir (supuesto 16): las filas viejas quedan sin autor y la pantalla
 * las muestra como dato viejo, no como error.
 *
 * ── Sin foreign keys, a propósito ──
 *
 * No hay `addConstraint` ni `references`. Una FK a `usuarios` con `RESTRICT`
 * impediría dar de baja a un usuario que alguna vez tocó un costo, y con
 * `SET NULL` borraría la respuesta a «quién» justo cuando hace falta. El
 * historial es un registro de auditoría: sobrevive a las filas que referencia.
 */

/** El índice que habilita «qué costos cambiaron esta semana» con scoping. */
const INDICE_EMPRESA_FECHA = 'product_cost_history_empresa_id_change_date';

const TABLA = 'product_cost_history';

/**
 * Si la columna ya existe.
 *
 * En desarrollo `server.js:412` corre `sequelize.sync({ alter: true })`, así que
 * el modelo de T1020 puede haber creado estas columnas antes de que la migración
 * llegue a correr. Sin este chequeo, `addColumn` tira y la base de desarrollo
 * queda sin poder migrar nada más.
 */
async function existeColumna(queryInterface, columna, transaction) {
  const [filas] = await queryInterface.sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    { bind: [TABLA, columna], transaction }
  );

  return filas.length > 0;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await existeColumna(queryInterface, 'usuario_id', transaction)) {
        await queryInterface.addColumn(TABLA, 'usuario_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
        }, { transaction });
      }

      if (!await existeColumna(queryInterface, 'empresa_id', transaction)) {
        await queryInterface.addColumn(TABLA, 'empresa_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
        }, { transaction });
      }

      // El backfill va ANTES del índice: crearlo primero obligaría a mantenerlo
      // durante un UPDATE que toca todas las filas de la tabla.
      //
      // `h.empresa_id IS NULL` no es defensivo de más: hace que correr esto dos
      // veces no reescriba las filas que ya tienen empresa, y que una fila
      // escrita por el código nuevo entre la aplicación y el backfill no se pise.
      await queryInterface.sequelize.query(`
        UPDATE product_cost_history h
           SET empresa_id = p.empresa_id
          FROM products p
         WHERE p.id = h.product_id
           AND h.empresa_id IS NULL
      `, { transaction });

      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS ${INDICE_EMPRESA_FECHA}
            ON ${TABLA} (empresa_id, change_date)
      `, { transaction });
    });
  },

  async down(queryInterface) {
    // Orden inverso. Borrar las columnas se lleva puesto el índice que las usa,
    // pero se saca explícito igual: dejarlo implícito hace que el `down` dependa
    // de un comportamiento de Postgres en vez de decir lo que hace.
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS ${INDICE_EMPRESA_FECHA}`,
        { transaction }
      );

      if (await existeColumna(queryInterface, 'empresa_id', transaction)) {
        await queryInterface.removeColumn(TABLA, 'empresa_id', { transaction });
      }

      if (await existeColumna(queryInterface, 'usuario_id', transaction)) {
        await queryInterface.removeColumn(TABLA, 'usuario_id', { transaction });
      }
    });
  },
};
