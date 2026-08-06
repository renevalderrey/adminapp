const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ⚠ Los dos ids de TiendaNube son BIGINT desde la migración `20260810`, y eso es
// una DESVIACIÓN DECLARADA del supuesto 4 de la spec 013 («el modelo y su
// migración se conservan tal cual»). Lo que ese supuesto protege queda intacto:
// los dos índices únicos, las dos FK con `ON DELETE CASCADE` y el bug documentado
// de `addConstraint` con `key` en vez de `field`.
//
// El motivo: son identificadores de un tercero e `int4` topa en 2.147.483.647.
// El síntoma del desbordamiento sería un 500 al insertar un mapeo, sin ningún
// mensaje que diga qué pasó. Y dejarlos en INTEGER mientras
// `tiendanube_variantes` los declara BIGINT sería peor: dos columnas del mismo
// dato con anchos distintos, y el día del tope una tabla acepta la fila y la
// otra no, dejando un mapeo que apunta a una variante que existe.
//
// `products.tiendanube_variant_id` **no** se ensancha: es la columna muerta que
// deja de ser escribible (FR-070), y ensanchar una columna que nadie va a
// escribir es trabajo sin destino.
//
// ⚠ El driver de Postgres devuelve `int8` como **string**: `mapping.tiendanube_variant_id === 123`
// es `false` aunque el valor sea 123.
const TiendanubeMapping = sequelize.define('TiendanubeMapping', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  empresa_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  tiendanube_variant_id: { type: DataTypes.BIGINT, allowNull: false },
  tiendanube_product_id: { type: DataTypes.BIGINT, allowNull: false },
}, {
  tableName: 'tiendanube_mappings',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['empresa_id', 'product_id'] },
    { unique: true, fields: ['empresa_id', 'tiendanube_variant_id'] },
  ],
});

module.exports = TiendanubeMapping;
