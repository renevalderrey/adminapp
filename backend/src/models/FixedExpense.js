// ════════════════════════════════════════════
//  COMPRAFIT · Modelo: FixedExpense (Gasto Fijo)
//  Migra GF1[] y GF2[]
//  Campos originales: { n, v }
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FixedExpense = sequelize.define('FixedExpense', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  name: {
    type: DataTypes.STRING(150), // Campo "n" original
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2), // Campo "v" original
    allowNull: false,
    defaultValue: 0,
  },
  group: {
    type: DataTypes.STRING(10), // "gf1" o "gf2" (para separar los dos bloques)
    allowNull: false,
    defaultValue: 'gf1',
  },
}, {
  tableName: 'fixed_expenses',
});

module.exports = FixedExpense;
