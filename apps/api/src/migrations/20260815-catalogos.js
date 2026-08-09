'use strict';

/**
 * ════════════════════════════════════════════
 *  catalogos — la cara pública de una empresa y su configuración
 *  Migración 25 — corte F1.2 de `docs/specs/015-catalogo-de-ventas-online`.
 * ════════════════════════════════════════════
 *
 * ── Las dos decisiones de esta tabla ──
 *
 * **1 · `slug` es UNIQUE GLOBAL, y la garantía es este índice.**
 *
 * No un `findOne` previo en el handler: dos empresas pidiendo el mismo slug al
 * mismo tiempo pasan **las dos** por ese `findOne` y las dos escriben. El índice
 * es lo único que no tiene esa ventana. Global y no por empresa porque la URL es
 * global: `tienda.favalio.com/c/<slug>` tiene que resolver a un solo catálogo.
 *
 * Y es `VARCHAR(60)`, no `TEXT`: un slug de doscientos caracteres no se copia a
 * mano de un cartel pegado en la recepción de un gimnasio.
 *
 * **2 · `punto_de_venta_id` con `ON DELETE RESTRICT`, no `SET NULL`.**
 *
 * De esa sucursal sale el stock que el catálogo publica. Un catálogo sin punto
 * de venta no sabe de dónde leer, y `NULL` obligaría a un ternario en cada
 * consulta de disponibilidad — que es exactamente lo que `utils/sucursalDeStock.js`
 * existe para que no pase.
 *
 * Ojo: **desactivar** una sucursal es otra cosa y la base no lo puede impedir.
 * Ese rechazo vive en el handler, y por eso está el índice
 * `idx_catalogo_punto_de_venta`: lo consulta en cada intento.
 *
 * ── Lo que NO se crea ──
 *
 * **`incluye_todos` no existe.** El dueño del producto eligió selección
 * explícita: un producto publicable nuevo **no** aparece solo en ninguna página
 * pública. La lista vive en `catalogo_productos` y es de inclusión.
 *
 * ── El `down` ──
 *
 * Borra la tabla entera. Es reversible sin pérdida mientras no haya pedidos
 * —que llegan en otra migración, con su FK `RESTRICT` hacia acá— y no hay nada
 * que archivar: un catálogo es configuración, no un dato del negocio.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ⚠ El tipo ENUM se crea de verdad, y con el nombre que Sequelize genera
      // (`enum_<tabla>_<columna>`).
      //
      // No es cosmético: el job `navegador` del CI corre las migraciones y
      // **después** el arranque en desarrollo, que hace `sync({ alter: true })`.
      // Si la columna fuera VARCHAR acá y `DataTypes.ENUM` en el modelo, el sync
      // intentaría convertirla, Postgres no castea el default de texto a enum y
      // el job se cae. Es el defecto que dejó ocho columnas divergentes hasta el
      // proyecto 0, y está escrito en `20260809-tipos-enum-y-indices-de-productos.js`.
      //
      // `CREATE TYPE` no admite `IF NOT EXISTS`, de ahí el bloque.
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_catalogos_estado') THEN
            CREATE TYPE enum_catalogos_estado AS ENUM ('borrador', 'publicado', 'pausado');
          END IF;
        END
        $$
      `);

      await q(`
        CREATE TABLE IF NOT EXISTS catalogos (
          id                     SERIAL PRIMARY KEY,
          empresa_id             INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          punto_de_venta_id      INTEGER NOT NULL REFERENCES puntos_de_venta(id) ON DELETE RESTRICT,

          slug                   VARCHAR(60)  NOT NULL,
          nombre_visible         VARCHAR(120) NOT NULL,
          descripcion            TEXT,
          logo_url               TEXT,
          portada_url            TEXT,
          color_marca            VARCHAR(7)   NOT NULL DEFAULT '#00B4B6',

          whatsapp_destino       VARCHAR(20),
          email_avisos           VARCHAR(255),
          datos_transferencia    JSONB        NOT NULL DEFAULT '{}'::jsonb,

          retiro_socio           BOOLEAN      NOT NULL DEFAULT false,
          retiro_socio_direccion TEXT,
          retiro_local           BOOLEAN      NOT NULL DEFAULT false,
          envio                  BOOLEAN      NOT NULL DEFAULT false,
          envio_costo            DECIMAL(12,2) NOT NULL DEFAULT 0,
          -- NULL o 0 significa «no hay envío gratis», nunca «todo gratis».
          envio_gratis_desde     DECIMAL(12,2),
          coordinar_whatsapp     BOOLEAN      NOT NULL DEFAULT false,

          pide_nro_socio         BOOLEAN      NOT NULL DEFAULT false,
          -- Se crea y queda apagada, sin exponerse, hasta que existan los
          -- Términos y la Política de Privacidad.
          pide_dni               BOOLEAN      NOT NULL DEFAULT false,

          -- El default seguro es NO publicar el margen: el precio tachado le
          -- muestra a cualquiera con el enlace cuánto se descontó.
          mostrar_precio_lista   BOOLEAN      NOT NULL DEFAULT false,
          -- Se conserva y queda siempre en false: la pasarela es la etapa 3.
          mp_habilitado          BOOLEAN      NOT NULL DEFAULT false,

          estado                 enum_catalogos_estado NOT NULL DEFAULT 'borrador',
          publicado_en           TIMESTAMP WITH TIME ZONE,

          created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_slug ON catalogos (slug)');
      await q('CREATE INDEX IF NOT EXISTS idx_catalogo_empresa ON catalogos (empresa_id)');
      await q('CREATE INDEX IF NOT EXISTS idx_catalogo_punto_de_venta ON catalogos (punto_de_venta_id)');

      console.log('[catalogos] Tabla creada, con el slug único global.');
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      await sequelize.query('DROP TABLE IF EXISTS catalogos', { transaction });
      // El tipo se va con la tabla: dejarlo colgado hace que una segunda corrida
      // del `up` encuentre un tipo que ya existe y no lo recree, lo cual está
      // bien, pero un `undo` seguido de un cambio de valores dejaría el viejo.
      await sequelize.query('DROP TYPE IF EXISTS enum_catalogos_estado', { transaction });
    });
  },
};
