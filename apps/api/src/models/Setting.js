// ════════════════════════════════════════════
//  ADMINAPP · Modelo: Setting (Configuración)
//  Key-Value para configuraciones globales
//  Migra: cf_permisos, cf_gv, y otros datos de cf_datos
// ════════════════════════════════════════════

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// La clave primaria es COMPUESTA: (key, empresa_id).
//
// Antes era solo `key`, lo que permitia una unica fila por clave en toda la
// base. La configuracion de AFIP (afip_cuit, afip_cert, afip_key,
// afip_environment) quedaba compartida entre todas las empresas cliente: la
// segunda empresa que guardaba su certificado pisaba el de la primera, y las
// facturas de esta ultima salian firmadas con la identidad fiscal ajena.
//
// El default 1 de empresa_id tambien se quito: era lo que permitia insertar
// sin declarar a que empresa pertenece la configuracion.
const Setting = sequelize.define('Setting', {
  key: {
    type: DataTypes.STRING(100),
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
  },
  value: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'settings',
});

module.exports = Setting;
