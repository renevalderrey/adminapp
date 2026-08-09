'use strict';

/**
 * ════════════════════════════════════════════
 *  products.publicable, y el índice que customers nunca tuvo
 *  Migración 24 — corte F0.2 de `docs/specs/015-catalogo-de-ventas-online`.
 * ════════════════════════════════════════════
 *
 * ── Por qué una columna nueva y no `is_active` ──
 *
 * `is_active` es el flag del ABM interno: dice si el producto se puede vender en
 * el mostrador. Publicar el catálogo usando ese flag publicaría **todo lo que
 * hoy está activo en el punto de venta**, que son 431 productos de los cuales
 * 376 están a costo $0 y ninguno tiene foto. Un producto sin foto y a $0 en una
 * página pública es peor que no tener página.
 *
 * `publicable` contesta otra pregunta —«¿este producto **podría** salir a una
 * página pública?»— y por eso es una columna propia.
 *
 * ── El default es `false`, y es lo único que esta migración promete ──
 *
 * `NOT NULL DEFAULT false`: después de correrla, **ningún producto de ninguna
 * empresa quedó marcado**. Es la diferencia entre «agregué una columna» y «no
 * publiqué nada de nadie», y se verifica acá adentro, en la misma transacción,
 * con un `COUNT(*)`. Si diera distinto de cero la migración corta y no queda
 * nada aplicado.
 *
 * Nadie puede haber marcado nada todavía: la columna nace en este archivo. La
 * verificación existe igual porque el día que alguien le ponga `defaultValue:
 * true` al `addColumn` —por copiar otra migración, o por creer que «publicable»
 * es lo mismo que «activo»— **el error no se ve en ninguna pantalla**: se ve el
 * día que se publica el primer catálogo, con productos que nadie eligió.
 *
 * ── Por qué el índice de `customers` viene en este mismo archivo ──
 *
 * `models/Customer.js` declara índices por `name` y por `tax_id`, y **ninguno
 * por `empresa_id`** (`:50-53`), que es la columna por la que filtra cada
 * consulta del sistema. Es una línea y no cambia ningún comportamiento.
 *
 * Entra en la etapa 0 aunque quien lo pide sea la etapa 2 —el checkout busca o
 * crea un `Customer` por comprador— por una razón de oportunidad: **llegar tarde
 * significa crear el índice sobre una tabla que ya creció**, con un `Customer`
 * por cada persona que compró. Crearlo hoy, sobre una tabla chica, es gratis.
 *
 * ── El `down` pierde un dato, y hay que decirlo ──
 *
 * ⚠ `down` hace `removeColumn` + `removeIndex`: **se pierde qué productos eran
 * publicables**. Revertir esta migración después de que alguien marcó sesenta
 * productos a mano significa volver a marcarlos uno por uno.
 *
 * No hay tabla de archivo, a diferencia de `20260813`, y es deliberado: acá el
 * dato es **un booleano por fila, reconstruible en cinco minutos** desde la
 * pantalla de Inventario. Archivarlo costaría una tabla, su migración y su
 * limpieza para recuperar algo que se rehace a mano. Lo que `20260813` archiva
 * es distinto: allá se **mueven** gastos de un cliente entre sucursales, y sin
 * el archivo no hay forma de distinguir lo que movió la migración de lo que
 * asignó el usuario.
 */

const INDICE_CUSTOMERS = 'idx_customer_empresa';

module.exports = {
  // Exportado para el test. `sequelize-cli` solo mira `up` y `down`.
  INDICE_CUSTOMERS,

  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });
      const filasDe = async (sql) => (await q(sql))[0];

      // ════════ 1 · La columna ════════
      await q(`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS publicable BOOLEAN NOT NULL DEFAULT false
      `);

      // ════════ 2 · El índice que faltaba ════════
      //
      // Con `name` explícito e idéntico al que declara `models/Customer.js`: si
      // los dos nombres no coinciden, `verificar-esquema.js` reporta el índice
      // del modelo como faltante y el job del contenedor se cae.
      await q(`
        CREATE INDEX IF NOT EXISTS ${INDICE_CUSTOMERS}
        ON customers (empresa_id)
      `);

      // ════════ 3 · Lo que esta migración promete ════════
      //
      // Adentro de la transacción: comprobarlo después, con la migración ya
      // asentada, sería tarde para no aplicarla.
      const [marcados] = await filasDe(`
        SELECT COUNT(*)::int AS n FROM products WHERE publicable = true
      `);

      if (marcados.n !== 0) {
        throw new Error(
          `[products.publicable] La migración terminó con ${marcados.n} productos marcados como `
          + 'publicables, y tiene que terminar con cero: la columna nace apagada para todos.\n\n'
          + 'Si alguien cambió el `defaultValue` del `ADD COLUMN` a `true`, ese es el motivo. '
          + 'No se aplicó nada.'
        );
      }

      console.log('[products.publicable] Columna creada, apagada para los productos que ya existían.');
      console.log(`[customers] Índice ${INDICE_CUSTOMERS} sobre (empresa_id) creado.`);
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ⚠ Acá se pierde el dato: qué productos eran publicables. Ver el
      // encabezado. Se avisa antes de borrarlo, porque el que corre un `undo`
      // reflejo después de un deploy raro merece leerlo en el log.
      const [filas] = await sequelize.query(
        'SELECT COUNT(*)::int AS n FROM products WHERE publicable = true',
        { transaction }
      );
      const marcados = filas[0]?.n ?? 0;

      if (marcados > 0) {
        console.log(
          `[products.publicable] Se van a perder ${marcados} productos marcados como publicables. `
          + 'No hay tabla de archivo: se remarcan a mano desde Inventario.'
        );
      }

      await q('ALTER TABLE products DROP COLUMN IF EXISTS publicable');
      await q(`DROP INDEX IF EXISTS ${INDICE_CUSTOMERS}`);
    });
  },
};
