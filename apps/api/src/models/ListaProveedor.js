// ════════════════════════════════════════════
//  FAVALIO · Modelo: ListaProveedor
//
//  Una lista de precios tal como la mandó un proveedor. Se guarda entera y sin
//  tocar: los items van en JSONB, con el nombre exacto que usó el proveedor.
//
//  Por que no se normalizan los nombres al guardar: el nombre original es la
//  unica forma de volver a encontrar el producto en la lista del proveedor
//  cuando hay que reclamarle algo. La normalizacion es para comparar, y se
//  hace al comparar.
//
//  Por que no se crean productos: una lista de proveedor tiene cosas que el
//  negocio no vende. Importarlas todas ensuciaria el catalogo.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ListaProveedor = sequelize.define('ListaProveedor', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  /** Proveedor del sistema, si se pudo asociar. Puede no existir todavia. */
  supplier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },

  /** Como se muestra en el comparador. */
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },

  /** Fecha de la lista: los precios de un proveedor duran poco. */
  fecha: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },

  /** [{ nombre, precio, sku, marca }] */
  items: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },

  /**
   * Si entra en la comparacion.
   *
   * Sirve para guardar la lista del mes pasado sin que ensucie la comparacion
   * de hoy, en vez de tener que borrarla.
   */
  activa: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'listas_proveedores',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['empresa_id', 'activa'] },
  ],
});

module.exports = ListaProveedor;
