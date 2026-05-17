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
  value: {
    type: DataTypes.JSONB, // Almacena cualquier estructura como JSON
    allowNull: true,
  },
}, {
  tableName: 'settings',
});

module.exports = Setting;
