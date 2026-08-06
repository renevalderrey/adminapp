'use strict';

/**
 * ════════════════════════════════════════════
 *  TiendaNube · la instantánea del catálogo, los pedidos y las corridas
 *  Migración 22, aditiva pura — no mueve ni una fila
 * ════════════════════════════════════════════
 *
 * ── Por qué va en un archivo aparte de `20260810` ──
 *
 * Porque aquélla mueve datos y ésta no. Un `down` que tiene que restaurar filas
 * de `settings` y un `down` que hace tres `DROP TABLE` son dos riesgos
 * distintos, y `scripts/verificar-reversibilidad.js` los prueba de a uno:
 * mezclarlos significa que un fallo del `up` de una tabla nueva se lee como un
 * fallo de la migración de datos, y al revés.
 *
 * ── Las tres tablas ──
 *
 * **`tiendanube_variantes`** es la instantánea del catálogo **y** la cola de
 * empujones, en una sola tabla. Son la misma pregunta —«¿cómo está esta
 * variante?»— y la cola necesita **exactamente** una fila por variante: es lo
 * que agrupa cien movimientos del mismo producto en un solo PUT, sin ningún
 * temporizador que se muera con el proceso. Por eso `uq_tn_variante` no es un
 * índice de consulta: es el mecanismo.
 *
 * No es una segunda fuente de verdad. El catálogo de TiendaNube no es un dato de
 * AdminApp —es la respuesta de un tercero, con la fecha en que se pidió a la
 * vista— y `stock_publicado` es el registro de **lo que se mandó**, que es un
 * hecho histórico. La fuente del stock sigue siendo `stock.available` de la
 * sucursal designada, leída en el momento de empujar.
 *
 * **`tiendanube_pedidos`** es la idempotencia del webhook, y su `uq_tn_pedido`
 * es lo único que la sostiene: la fila se inserta PRIMERO y DENTRO de la
 * transacción que descuenta, y el `SequelizeUniqueConstraintError` es la mitad
 * que un test secuencial no toca —la lección del CAE y la de `POST /api/sales`—.
 * `items` en JSONB es además donde quedan escritos los ítems que **no**
 * descontaron, con su motivo: hoy se saltean con un `continue` y lo único que
 * queda es que el inventario está mal.
 *
 * **`tiendanube_corridas`** registra solo las corridas **explícitas** —el botón
 * y la reconciliación—. El empujón por movimiento de stock **no escribe acá**:
 * su estado vive en la fila de la variante, que dice qué está desfasado ahora en
 * vez de qué pasó en un lote, y está acotado a una fila por variante. Registrar
 * los dos en la misma tabla produciría cientos de filas diarias que nadie lee.
 *
 * ── ⚠ El índice único de FR-026 tampoco se crea acá ──
 *
 * `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements` rompería toda
 * venta de más de una línea: `routes/sales.js:557` escribe una fila POR LÍNEA
 * con el mismo `sale.id`. La idempotencia del pedido vive en `uq_tn_pedido`, que
 * es una fila por pedido —la unidad de idempotencia de verdad—. Decisión 6 del
 * plan, riesgo 1, y hay una guardia que verifica que ninguna de estas dos
 * migraciones nombre `stock_movements`.
 *
 * ── `VARCHAR(20)` con `CHECK` y no `ENUM`, deliberadamente ──
 *
 * El proyecto 0 de `PROXIMOS-PROYECTOS.md` dejó ocho columnas declaradas `ENUM`
 * en el modelo y creadas `VARCHAR` por las migraciones, y ese desajuste todavía
 * está abierto: `sync({ alter: true })` en desarrollo muere en
 * `products.unit_type` antes de llegar a cualquier otra cosa. Agregar un `ENUM`
 * nuevo es agregarle una novena columna a ese problema. El modelo declara
 * `DataTypes.STRING(20)` y acá se crea `VARCHAR(20)` con un `CHECK`: **los dos
 * archivos dicen lo mismo**, que es lo que ese proyecto pide.
 */

/**
 * Los seis índices, en un solo lugar.
 *
 * Los nombres son los mismos que declaran los modelos, con `name` explícito allá
 * y acá. No es prolijidad: Sequelize nombraría los suyos `<tabla>_<col>_<col>`,
 * y sobre una base creada por migraciones un `sync({ alter: true })` en
 * desarrollo crearía un **segundo** índice con su propio nombre sobre las mismas
 * columnas. Es el mismo cuidado que documenta
 * `20260808-indices-de-empresa-en-proveedores.js`, y hay un test que compara las
 * dos listas (`src/tests/esquemaDeTiendanube.test.js`).
 *
 * Los dos parciales lo son porque las filas que sirven son una fracción diminuta
 * de la tabla: la cola frente al catálogo entero, y los pedidos con algo sin
 * descontar frente a todos los pedidos que se recibieron alguna vez.
 */
const INDICES = [
  {
    nombre: 'uq_tn_variante',
    tabla: 'tiendanube_variantes',
    columnas: 'empresa_id, tiendanube_variant_id',
    unico: true,
  },
  {
    nombre: 'idx_tn_variantes_cola',
    tabla: 'tiendanube_variantes',
    columnas: 'empresa_id, proximo_intento_en',
    donde: 'pendiente_desde IS NOT NULL',
  },
  {
    nombre: 'idx_tn_variantes_producto',
    tabla: 'tiendanube_variantes',
    columnas: 'empresa_id, tiendanube_product_id',
  },
  {
    nombre: 'uq_tn_pedido',
    tabla: 'tiendanube_pedidos',
    columnas: 'empresa_id, tiendanube_order_id',
    unico: true,
  },
  {
    nombre: 'idx_tn_pedidos_pendientes',
    tabla: 'tiendanube_pedidos',
    columnas: 'empresa_id, recibido_en DESC',
    donde: 'items_sin_descontar > 0',
  },
  {
    nombre: 'idx_tn_corridas_empresa',
    tabla: 'tiendanube_corridas',
    columnas: 'empresa_id, empezada_en DESC',
  },
];

/** Las tres tablas, en orden de creación. El `down` las borra al revés. */
const TABLAS = ['tiendanube_variantes', 'tiendanube_pedidos', 'tiendanube_corridas'];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      // ════════ tiendanube_variantes ════════
      //
      // Los ids de TiendaNube van en BIGINT: son de un tercero e `int4` topa en
      // 2.147.483.647 (decisión 12 del plan). `20260810` ensancha por eso mismo
      // los dos de `tiendanube_mappings`, que es la tabla contra la que ésta se
      // une: dos columnas del mismo dato con anchos distintos significan que el
      // día del tope una acepta la fila y la otra no.
      //
      // No hay FK a `tiendanube_mappings` a propósito: una variante existe en la
      // tienda con mapeo o sin él, y un mapeo puede apuntar a una variante que ya
      // no está en el catálogo. Las dos tablas se unen en JS por
      // `(empresa_id, tiendanube_variant_id)`, que además es lo que evita subir
      // el ancla de `analizarIncludes`.
      //
      // `vista_en` es cuándo se la vio por última vez en el catálogo: anterior al
      // último refresco significa «esta variante ya no está en tu tienda».
      await q(`
        CREATE TABLE IF NOT EXISTS tiendanube_variantes (
          id                    SERIAL      PRIMARY KEY,
          empresa_id            INTEGER     NOT NULL
                                            REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE,
          tiendanube_variant_id BIGINT      NOT NULL,
          tiendanube_product_id BIGINT      NOT NULL,
          nombre_producto       VARCHAR(300),
          nombre_variante       VARCHAR(300),
          sku                   VARCHAR(100),
          stock_en_tienda       INTEGER,
          vista_en              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          stock_publicado       INTEGER,
          publicado_en          TIMESTAMPTZ,
          pendiente_desde       TIMESTAMPTZ,
          proximo_intento_en    TIMESTAMPTZ,
          intentos              SMALLINT    NOT NULL DEFAULT 0,
          ultimo_error          VARCHAR(200),
          motivo_no_publicado   VARCHAR(40),
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // ════════ tiendanube_pedidos ════════
      //
      // `punto_de_venta_id` guarda la sucursal designada AL MOMENTO del pedido, y
      // no se lee de `tiendanube_tiendas` cada vez: si alguien cambia la sucursal
      // designada la semana que viene, el pedido de hoy tiene que seguir diciendo
      // de dónde salió la mercadería. Va con `ON DELETE RESTRICT` por lo mismo
      // que la de `tiendanube_tiendas`: borrar una sucursal no puede borrar el
      // registro de lo que se despachó desde ahí.
      //
      // `items` es JSONB y no una tabla hija porque nadie va a consultar por un
      // ítem: se leen todos juntos, con su pedido, para dibujar una fila. Es el
      // mismo criterio que `supplier_orders.detail`. Y una tabla hija más sería
      // un `include` más que la guardia de `analizarIncludes` tendría que contar.
      //
      // Sin `updated_at`: una fila se escribe una vez. El modelo lo declara con
      // `updatedAt: false` para que digan lo mismo.
      await q(`
        CREATE TABLE IF NOT EXISTS tiendanube_pedidos (
          id                  SERIAL      PRIMARY KEY,
          empresa_id          INTEGER     NOT NULL
                                          REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE,
          tiendanube_order_id BIGINT      NOT NULL,
          numero              VARCHAR(40),
          recibido_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          punto_de_venta_id   INTEGER     NOT NULL
                                          REFERENCES puntos_de_venta(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          items               JSONB       NOT NULL,
          items_descontados   SMALLINT    NOT NULL DEFAULT 0,
          items_sin_descontar SMALLINT    NOT NULL DEFAULT 0,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // ════════ tiendanube_corridas ════════
      //
      // `fallas` guarda SOLO las que fallaron: con un catálogo grande, las que
      // salieron bien son cientos de entradas que nadie lee.
      await q(`
        CREATE TABLE IF NOT EXISTS tiendanube_corridas (
          id           SERIAL      PRIMARY KEY,
          empresa_id   INTEGER     NOT NULL
                                   REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE CASCADE,
          empezada_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          terminada_en TIMESTAMPTZ,
          disparador   VARCHAR(20) NOT NULL
                                   CONSTRAINT tiendanube_corridas_disparador_check
                                   CHECK (disparador IN ('manual', 'reconciliacion')),
          usuario_id   VARCHAR(255),
          mandadas     INTEGER     NOT NULL DEFAULT 0,
          fallidas     INTEGER     NOT NULL DEFAULT 0,
          fallas       JSONB,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      for (const { nombre, tabla, columnas, unico, donde } of INDICES) {
        await q(
          `CREATE ${unico ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${nombre} ` +
          `ON ${tabla} (${columnas})${donde ? ` WHERE ${donde}` : ''}`
        );
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    // ⚠ Esto NO es gratis con una tienda vinculada en producción.
    //
    // Las tres tablas se pueden volver a construir salvo una: perder
    // `tiendanube_pedidos` es perder la idempotencia del webhook, y TiendaNube
    // **reintenta webhooks viejos**. Un pedido que ya descontó y cuya fila se
    // borró vuelve a descontar la próxima vez que lo reintente, y el inventario
    // queda mal sin que nada lo diga. Por eso esas filas no se borran nunca
    // (riesgo 9 del plan) y por eso revertir esta migración con una tienda
    // vinculada es una decisión, no un reflejo.
    //
    // La instantánea del catálogo sí se vuelve a traer de TiendaNube, y las
    // corridas son un registro de lo que pasó, no un dato del que dependa nada.
    await sequelize.transaction(async (transaction) => {
      for (const tabla of [...TABLAS].reverse()) {
        // Los índices se van con la tabla; no hace falta borrarlos aparte.
        await sequelize.query(`DROP TABLE IF EXISTS ${tabla}`, { transaction });
      }
    });
  },

  // Lo que compara `src/tests/esquemaDeTiendanube.test.js` contra los modelos.
  INDICES,
  TABLAS,
};
