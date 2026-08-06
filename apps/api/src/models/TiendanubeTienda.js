// ════════════════════════════════════════════
//  ADMINAPP · Modelo: TiendanubeTienda — la vinculación de UNA empresa
//
//  Reemplaza a las dos filas de `settings` donde vivía la vinculación, menos el
//  token: `settings.tiendanube_access_token` **se queda donde está**. Esta
//  funcionalidad no lo cifra y no puede agregar ningún lugar nuevo donde quede
//  en claro (FR-077); el cifrado es el proyecto 6 de `PROXIMOS-PROYECTOS.md` y
//  se hace para la clave de AFIP y este token juntos, sobre `settings`. Una
//  columna `access_token` acá sería un segundo lugar que ese proyecto tendría
//  que descubrir.
//
//  ── Sin una sola asociación declarada, y es deliberado ──
//
//  Declarar `Empresa.hasOne(TiendanubeTienda)` haría que el detector
//  `analizarIncludes` de `tests/aislamientoEmpresas.test.js` clasificara
//  cualquier `include` de esta tabla como «hijo con empresa_id» y subiría su
//  ancla de `toBe(4)`. Ninguna consulta de este hito usa `include`: se traen las
//  filas planas y se unen en JS. La asociación no aportaría nada y movería un
//  ancla que existe para no moverse.
//
//  Se registra igual en `models/index.js` porque `scripts/verificar-esquema.js`
//  hace un `findOne` **por modelo de src/models**: una tabla cuyo modelo no esté
//  registrado no se compara contra `information_schema`, y una columna que la
//  migración se olvide pasa desapercibida. Ése es el único motivo, y alcanza.
//
//  ⚠ `tiendanube_user_id` es BIGINT y el driver de Postgres devuelve `int8`
//  como **string**. Comparar con `===` contra un número da `false` siempre.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TiendanubeTienda = sequelize.define('TiendanubeTienda', {
  // La PK es `empresa_id`: una empresa opera una sola tienda (supuesto 14). Una
  // PK autoincremental que admitiera dos filas obligaría a que CADA consulta de
  // esta integración decidiera cuál de las dos.
  empresa_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
  },
  // El `UNIQUE` es de la base y es FR-036: dos empresas no pueden vincular la
  // misma tienda. Hoy `settings` lo permite —su PK es `(key, empresa_id)`— y el
  // webhook resuelve la empresa con el primer match que devuelva Postgres, en un
  // orden que nadie definió.
  tiendanube_user_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    unique: true,
  },
  // Lo dice TiendaNube y puede no venir.
  nombre: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  // La sucursal designada: de acá sale el stock que se publica **y** acá se
  // descuenta el pedido. `NOT NULL` a propósito — una columna que admite null
  // tiene una rama de omisión, y esa rama es el defecto de hoy.
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  vinculada_en: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  ultima_comunicacion_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // El cuarto estado de la conexión: «vinculada con error». `null` = todavía no
  // hablamos con la tienda desde que se vinculó.
  ultima_comunicacion_ok: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
  },
  // Clasificado, **nunca** `err.message` crudo: esta columna la lee la pantalla.
  ultimo_error: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  catalogo_refrescado_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Cuándo corrió la última reconciliación. No es decorativo: el cron externo
  // que la dispara hoy falla todos los días (faltan `API_URL` y `CRON_SECRET`),
  // y la pantalla muestra esta fecha en vez de dar por hecho que la red existe.
  reconciliada_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // El arriendo que impide dos sincronizaciones a la vez. Es una fila y no una
  // bandera en memoria porque una bandera no sobrevive un reinicio, y los diez
  // minutos de vencimiento son lo que hace que una caída no bloquee la
  // sincronización hasta que alguien entre a la base.
  sincronizando_desde: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'tiendanube_tiendas',
});

module.exports = TiendanubeTienda;
