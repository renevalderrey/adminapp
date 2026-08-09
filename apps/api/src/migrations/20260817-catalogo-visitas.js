'use strict';

/**
 * ════════════════════════════════════════════
 *  catalogo_visitas — el contador agregado del QR
 *  Migración 27 — corte F1.2 de `docs/specs/015-catalogo-de-ventas-online`.
 * ════════════════════════════════════════════
 *
 * ── Una fila por día, no una por visita ──
 *
 * El índice único `uq_visita` es lo que hace posible el
 * `INSERT … ON CONFLICT DO UPDATE SET cantidad = cantidad + 1`. Sin él, el
 * endpoint **más leído del sistema** —el que abre cada persona que escanea el
 * QR— sería también el que más escribe, y una tienda con tráfico dejaría una
 * fila por visitante en la misma base donde el comercio factura.
 *
 * ── `estado_catalogo` es parte de la clave, y por qué ──
 *
 * El borrador proponía `(catalogo_id, fecha, origen)`. Con esa clave, la
 * pestaña del QR **no puede** separar las visitas que ocurrieron con el catálogo
 * pausado, y esa separación es el punto: sin ella, una conversión en cero
 * durante una semana de pausa se lee como «la tienda no funciona» en vez de
 * «estaba pausada».
 *
 * A lo sumo triplica las filas, y en la práctica ni eso: un catálogo no cambia
 * de estado todos los días.
 *
 * ── Lo que esta tabla NO puede guardar ──
 *
 * **No hay IP, ni cookie, ni identificador de dispositivo.** Contar no es
 * rastrear, y la tabla no tiene dónde poner un dato del visitante aunque alguien
 * quisiera ponerlo. Es una decisión de diseño y no una omisión: agregar la
 * columna sería la parte fácil.
 *
 * ── La fecha es la del negocio ──
 *
 * `DATEONLY` calculada con `fechaDelNegocio(zona)` de `utils/fechas.js`, no con
 * `toISOString()`: en Argentina una visita de las 21:30 se contaría al día
 * siguiente, y el comercio compararía sus escaneos contra sus ventas y no
 * cerrarían.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_catalogo_visitas_estado_catalogo') THEN
            CREATE TYPE enum_catalogo_visitas_estado_catalogo AS ENUM ('publicado', 'pausado', 'no_disponible');
          END IF;
        END
        $$
      `);

      await q(`
        CREATE TABLE IF NOT EXISTS catalogo_visitas (
          id              SERIAL PRIMARY KEY,
          catalogo_id     INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
          fecha           DATE NOT NULL,
          -- Del parámetro ?f= del QR, acotado a un conjunto conocido: lo que
          -- no esté en ese conjunto cae en 'otro', porque es texto que manda
          -- cualquiera.
          origen          VARCHAR(20) NOT NULL DEFAULT 'directo',
          estado_catalogo enum_catalogo_visitas_estado_catalogo NOT NULL,
          cantidad        INTEGER NOT NULL DEFAULT 0,
          created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_visita
        ON catalogo_visitas (catalogo_id, fecha, origen, estado_catalogo)
      `);

      console.log('[catalogo_visitas] Contador agregado creado: una fila por día, no una por visita.');
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // Se pierde el conteo histórico de escaneos. No se archiva: es una
      // métrica agregada, no un dato del negocio, y ninguna decisión reversible
      // depende de ella.
      await q('DROP TABLE IF EXISTS catalogo_visitas');
      await q('DROP TYPE IF EXISTS enum_catalogo_visitas_estado_catalogo');
    });
  },
};
