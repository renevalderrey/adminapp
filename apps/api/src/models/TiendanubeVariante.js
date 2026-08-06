// ════════════════════════════════════════════
//  ADMINAPP · Modelo: TiendanubeVariante
//  La instantánea del catálogo de la tienda **y** la cola de empujones
//
//  Son la misma pregunta —«¿cómo está esta variante?»— y por eso es una tabla y
//  no dos. La cola necesita **exactamente** una fila por variante: es lo que
//  agrupa cien movimientos del mismo producto en un solo PUT, sin ningún
//  temporizador en memoria que se muera con el proceso. `uq_tn_variante` no es
//  un índice de consulta: es el mecanismo del agrupado.
//
//  ── Por qué la instantánea no es una segunda fuente de verdad ──
//
//  El catálogo de TiendaNube no es un dato de AdminApp: es la respuesta de un
//  tercero, con la fecha en que se pidió a la vista (`vista_en`, y
//  `tiendanube_tiendas.catalogo_refrescado_en`). Y `stock_publicado` es el
//  registro de **lo que se mandó**, que es un hecho histórico, no una copia del
//  stock. La fuente del stock sigue siendo `stock.available` de la sucursal
//  designada, y se lee en el momento de empujar.
//
//  Existe porque los tres requisitos del catálogo —traer todas las páginas,
//  contar cuántas variantes hay y cuántas están mapeadas, y buscar y filtrar—
//  **no se pueden contestar sobre una página que todavía no se pidió**, y
//  pedirle las ~20 páginas a una API con cuota en cada carga de pantalla no es
//  una opción.
//
//  ── No hay FK a `tiendanube_mappings`, y es a propósito ──
//
//  Una variante existe en la tienda con mapeo o sin él, y un mapeo puede apuntar
//  a una variante que ya no está en el catálogo. Las dos tablas se unen en JS
//  por `(empresa_id, tiendanube_variant_id)`.
//
//  Sin asociaciones, por el motivo escrito en `TiendanubeTienda.js`.
// ════════════════════════════════════════════

const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

const TiendanubeVariante = sequelize.define('TiendanubeVariante', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // BIGINT y no INTEGER: los decide TiendaNube e `int4` topa en 2.147.483.647.
  // `tiendanube_mappings` se ensanchó por lo mismo (migración 20260810): unir
  // dos columnas del mismo dato con anchos distintos significa que el día del
  // tope una tabla acepta la fila y la otra no.
  //
  // ⚠ El driver devuelve `int8` como **string**. Comparar con `===` contra un
  // número da `false` siempre.
  tiendanube_variant_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  tiendanube_product_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  nombre_producto: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  // Talle, color, o la variante por defecto de un producto sin variantes.
  nombre_variante: {
    type: DataTypes.STRING(300),
    allowNull: true,
  },
  // **Puede venir vacío**, y la sugerencia por SKU tiene que aguantarlo: un SKU
  // vacío que coincida con otro SKU vacío mapearía dos productos al azar.
  sku: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // Lo que la tienda dice que tiene, del último refresco. Es uno de los tres
  // números que la reconciliación compara: lo que tenemos, lo que mandamos y lo
  // que la tienda dice.
  stock_en_tienda: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Cuándo se la vio por última vez en el catálogo. Anterior al último refresco
  // significa «esta variante ya no está en tu tienda».
  vista_en: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  stock_publicado: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  publicado_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // `NOT NULL` = está en la cola.
  pendiente_desde: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  proximo_intento_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // A los 8 la fila deja de reintentarse sola y solo la mueve una corrida manual
  // o la reconciliación. Una fila que reintenta para siempre contra un token
  // revocado es un ataque a la cuota de la tienda.
  intentos: {
    type: DataTypes.SMALLINT,
    allowNull: false,
    defaultValue: 0,
  },
  // Clasificado, nunca `err.message` crudo: lo lee la pantalla.
  ultimo_error: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  // `sin_stock_en_sucursal` / `sin_mapeo` / `producto_inactivo`. Es la diferencia
  // entre «no se publicó» y «no se publicó porque…», que es lo único que le
  // permite a alguien arreglarlo.
  motivo_no_publicado: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
}, {
  tableName: 'tiendanube_variantes',
  // Los tres con `name` explícito e idéntico al de
  // `migrations/20260811-tiendanube-catalogo-pedidos-y-corridas.js`: sin el
  // `name`, Sequelize los llamaría `<tabla>_<col>_<col>` y un
  // `sync({ alter: true })` en desarrollo crearía índices duplicados.
  indexes: [
    { unique: true, name: 'uq_tn_variante', fields: ['empresa_id', 'tiendanube_variant_id'] },
    // Parcial en la base: la cola es una fracción diminuta del catálogo y el
    // índice no tiene por qué cargarlo entero. Sequelize no aplica esta lista
    // —este proyecto no usa `sync()`—, así que el `where` está acá para que el
    // modelo diga lo mismo que la migración y no menos.
    {
      name: 'idx_tn_variantes_cola',
      fields: ['empresa_id', 'proximo_intento_en'],
      where: { pendiente_desde: { [Op.not]: null } },
    },
    { name: 'idx_tn_variantes_producto', fields: ['empresa_id', 'tiendanube_product_id'] },
  ],
});

module.exports = TiendanubeVariante;
