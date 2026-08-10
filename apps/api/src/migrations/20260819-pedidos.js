'use strict';

/**
 * ════════════════════════════════════════════
 *  pedidos y pedido_items — lo que arma un visitante
 *  Migración 29 — corte F2.1 de `docs/specs/015-catalogo-de-ventas-online`.
 * ════════════════════════════════════════════
 *
 * ── Todo lo del precio va CONGELADO ──
 *
 * `pedido_items` guarda el nombre, el precio unitario, **el precio de lista** y
 * **qué regla ganó**. Los cuatro son copias, no referencias.
 *
 * El nombre, para que un pedido cuyo producto se borró se siga viendo. Los otros
 * tres, para poder contestar **«¿por qué este pedido salió a este precio?»** seis
 * meses después, cuando las reglas ya cambiaron tres veces. Sin `precio_lista` y
 * `regla_id` esa pregunta no tiene respuesta: el precio unitario sólo dice
 * cuánto, no por qué.
 *
 * ── El número de pedido y su red ──
 *
 * Correlativo **por empresa**, arranca en 1, sin letra ni prefijo, y no se
 * reinicia nunca. El mecanismo que lo emite es un advisory lock dentro de la
 * transacción que crea el pedido; **este índice único es la red**, y garantiza
 * que jamás se emitan dos iguales aunque el mecanismo falle.
 *
 * ── La idempotencia ──
 *
 * `idempotency_key` es UNIQUE **global** y no por empresa: la clave la genera el
 * navegador como UUID, así que dos empresas no la comparten. Es lo que hace que
 * tocar «enviar» dos veces —o que el teléfono reintente al recuperar señal— no
 * cree dos pedidos. Molde: `uq_tn_pedido` de TiendaNube.
 *
 * ── `medio_pago` NO tiene `mp` ──
 *
 * Mercado Pago es la etapa 3. Un valor de enum que nadie puede producir todavía
 * es un valor que nadie probó, y el día que se agregue va a hacer falta mirarlo
 * de nuevo igual. Se agrega cuando exista la pasarela.
 *
 * ── `origen`, un enum de un solo valor ──
 *
 * Parece decoración y no lo es: es lo que hace que el día que entre un segundo
 * canal —los pedidos de TiendaNube, cuando tengan comprador, total y estado— no
 * haya que migrar datos ni enseñarle una columna nueva a una pantalla que ya
 * está en producción.
 *
 * `idx_pedido_origen` se crea ahora aunque no discrimine nada. Con un solo valor
 * el planificador lo va a ignorar y cuesta unos kilobytes; crearlo después,
 * sobre una tabla con pedidos reales, es un CREATE INDEX que bloquea escrituras
 * —o un CONCURRENTLY que no se puede correr adentro de la transacción de una
 * migración de sequelize-cli—.
 *
 * ── Tres columnas que se crean y NO se escriben ──
 *
 * `comprador_dni`, `acepta_comunicaciones` y sus dos acompañantes de
 * consentimiento. Existen porque el esquema no cambia cuando se abra la puerta,
 * y quedan vacías hasta que existan los Términos y la Política de Privacidad.
 * El servidor **ignora** esos campos aunque vengan en el cuerpo.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pedidos_origen') THEN
            CREATE TYPE enum_pedidos_origen AS ENUM ('catalogo');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pedidos_estado') THEN
            CREATE TYPE enum_pedidos_estado AS ENUM
              ('pendiente_pago', 'pagado', 'en_preparacion', 'listo', 'entregado', 'cancelado');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pedidos_entrega') THEN
            CREATE TYPE enum_pedidos_entrega AS ENUM ('retiro_socio', 'retiro_local', 'envio', 'coordinar');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pedidos_medio_pago') THEN
            CREATE TYPE enum_pedidos_medio_pago AS ENUM ('transferencia', 'efectivo');
          END IF;
        END
        $$
      `);

      await q(`
        CREATE TABLE IF NOT EXISTS pedidos (
          id                    UUID PRIMARY KEY,
          empresa_id            INTEGER NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
          catalogo_id           INTEGER NOT NULL REFERENCES catalogos(id) ON DELETE RESTRICT,
          punto_de_venta_id     INTEGER NOT NULL REFERENCES puntos_de_venta(id) ON DELETE RESTRICT,

          origen                enum_pedidos_origen NOT NULL DEFAULT 'catalogo',
          numero                INTEGER NOT NULL,
          estado                enum_pedidos_estado NOT NULL DEFAULT 'pendiente_pago',

          comprador_nombre      VARCHAR(120) NOT NULL,
          comprador_telefono    VARCHAR(30)  NOT NULL,
          comprador_email       VARCHAR(255),
          comprador_dni         VARCHAR(20),
          comprador_nro_socio   VARCHAR(40),
          customer_id           INTEGER REFERENCES customers(id) ON DELETE SET NULL,

          acepta_comunicaciones BOOLEAN NOT NULL DEFAULT false,
          consentimiento_en     TIMESTAMP WITH TIME ZONE,
          consentimiento_texto  VARCHAR(60),

          entrega               enum_pedidos_entrega NOT NULL,
          envio_direccion       VARCHAR(255),
          envio_localidad       VARCHAR(120),
          envio_cp              VARCHAR(20),

          subtotal              DECIMAL(12,2) NOT NULL,
          envio_costo           DECIMAL(12,2) NOT NULL DEFAULT 0,
          total                 DECIMAL(12,2) NOT NULL,

          medio_pago            enum_pedidos_medio_pago NOT NULL,
          notas                 TEXT,
          idempotency_key       VARCHAR(64) NOT NULL,

          sale_id               VARCHAR(40) REFERENCES sales(id) ON DELETE SET NULL,

          created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_numero ON pedidos (empresa_id, numero)');
      await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_idempotencia ON pedidos (idempotency_key)');
      await q('CREATE INDEX IF NOT EXISTS idx_pedido_bandeja ON pedidos (empresa_id, estado, created_at DESC)');
      await q('CREATE INDEX IF NOT EXISTS idx_pedido_catalogo ON pedidos (catalogo_id, created_at DESC)');
      await q('CREATE INDEX IF NOT EXISTS idx_pedido_origen ON pedidos (empresa_id, origen, created_at DESC)');
      await q('CREATE INDEX IF NOT EXISTS idx_pedido_customer ON pedidos (customer_id)');

      await q(`
        CREATE TABLE IF NOT EXISTS pedido_items (
          id              SERIAL PRIMARY KEY,
          pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          -- SET NULL y no CASCADE: borrar un producto NO puede borrar la línea de
          -- un pedido histórico. La línea sigue con su nombre y su precio
          -- congelados, que es exactamente para lo que están congelados.
          product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,

          nombre          VARCHAR(200) NOT NULL,
          precio_unitario DECIMAL(12,2) NOT NULL,
          precio_lista    DECIMAL(12,2) NOT NULL,
          regla_id        INTEGER REFERENCES catalogo_reglas_precio(id) ON DELETE SET NULL,
          cantidad        INTEGER NOT NULL,
          subtotal        DECIMAL(12,2) NOT NULL,

          created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      await q('CREATE INDEX IF NOT EXISTS idx_pedido_item_pedido ON pedido_items (pedido_id)');

      console.log('[pedidos] Tablas creadas, con la numeración y la idempotencia garantizadas por índice.');
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ⚠ Esto borra pedidos. Si hay alguno, revertir esta migración pierde el
      // pedido de un cliente real: no hay tabla de archivo porque no hay forma
      // de reconstruir un pedido desde ningún otro lado.
      const [filas] = await sequelize.query('SELECT COUNT(*)::int AS n FROM pedidos', { transaction });
      const n = filas[0]?.n ?? 0;
      if (n > 0) {
        console.log(`[pedidos] ⚠ Se van a borrar ${n} pedidos. No hay de dónde recuperarlos.`);
      }

      await q('DROP TABLE IF EXISTS pedido_items');
      await q('DROP TABLE IF EXISTS pedidos');
      await q('DROP TYPE IF EXISTS enum_pedidos_origen');
      await q('DROP TYPE IF EXISTS enum_pedidos_estado');
      await q('DROP TYPE IF EXISTS enum_pedidos_entrega');
      await q('DROP TYPE IF EXISTS enum_pedidos_medio_pago');
    });
  },
};
