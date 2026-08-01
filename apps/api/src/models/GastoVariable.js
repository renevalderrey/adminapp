// ════════════════════════════════════════════
//  ADMINAPP · Modelo: GastoVariable
//
//  Gastos que cambian mes a mes y se atribuyen a una persona: viaticos,
//  combustible, adelantos, compras sueltas.
//
//  Es distinto de FixedExpense, que es el alquiler o el sueldo: mismo importe
//  todos los meses y sin dueño. Mezclarlos en una sola tabla obligaria a
//  filtrar por mes en cada calculo de punto de equilibrio, que usa solo los
//  fijos.
//
//  El mes se guarda como texto 'YYYY-MM' y no como fecha porque es un periodo,
//  no un dia: guardar el 1 de cada mes invita a que alguien lo interprete como
//  la fecha del gasto y arme reportes por dia sobre datos que no la tienen.
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GastoVariable = sequelize.define('GastoVariable', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  /** A quien se le atribuye. Texto libre: no toda persona es usuario del sistema. */
  persona: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },

  /** Periodo 'YYYY-MM'. */
  mes: {
    type: DataTypes.STRING(7),
    allowNull: false,
    validate: {
      is: {
        args: /^\d{4}-(0[1-9]|1[0-2])$/,
        msg: 'El mes tiene que tener el formato YYYY-MM',
      },
    },
  },

  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },

  monto: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },

  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'puntos_de_venta', key: 'id' },
  },
}, {
  tableName: 'gastos_variables',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['empresa_id', 'mes'] },
  ],
});

module.exports = GastoVariable;
