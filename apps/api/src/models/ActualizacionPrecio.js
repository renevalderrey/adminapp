// ════════════════════════════════════════════
//  FAVALIO · Modelo: ActualizacionPrecio
//
//  Cada vez que se cambian precios en masa se guarda una foto de como estaban
//  antes. Es lo que permite deshacer.
//
//  El sistema anterior de Comprafit tenia esta funcion y era de las mas
//  usadas: cuando un proveedor manda una lista nueva se actualizan doscientos
//  productos de una, y si el porcentaje sale mal no hay forma de reconstruir
//  los precios viejos uno por uno.
//
//  `cambios` guarda, por producto, los tres campos que definen el precio antes
//  y despues. Se guarda el estado completo y no un delta a proposito: un delta
//  obliga a saber en que orden se aplicaron las actualizaciones para poder
//  revertir, y el estado anterior se puede escribir tal cual.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ActualizacionPrecio = sequelize.define('ActualizacionPrecio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  /** Que se toco: 'margen', 'precio' o 'costo'. */
  modo: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },

  /** El valor aplicado: el porcentaje o el importe, segun el modo. */
  valor: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },

  /** Texto para reconocerla en la lista. */
  descripcion: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },

  /** Quien la hizo (el sub de Auth0). */
  usuario: {
    type: DataTypes.STRING(120),
    allowNull: true,
  },

  cantidad_productos: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },

  /**
   * [{ product_id, nombre, antes: { cost, margin_override, price_override },
   *    despues: { ... } }]
   */
  cambios: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },

  revertida: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },

  revertida_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'actualizaciones_precios',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['empresa_id', 'created_at'] },
  ],
});

module.exports = ActualizacionPrecio;
