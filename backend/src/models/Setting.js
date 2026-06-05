// ════════════════════════════════════════════
//  COMPRAFIT · Modelo: Setting (Configuración)
//  Key-Value para configuraciones globales
//  Migra: cf_permisos, cf_gv, y otros datos de cf_datos
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Setting = sequelize.define('Setting', {
  key: {
    type: DataTypes.STRING(100),
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  value: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'settings',
});

module.exports = Setting;
