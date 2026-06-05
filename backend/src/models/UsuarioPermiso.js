const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UsuarioPermiso = sequelize.define('UsuarioPermiso', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  punto_de_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  permiso_codigo: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  granted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'usuario_permisos',
  indexes: [
    { unique: true, fields: ['usuario_empresa_id', 'punto_de_venta_id', 'permiso_codigo'], name: 'uq_usuario_permisos' },
    { fields: ['usuario_empresa_id'] },
  ],
});

module.exports = UsuarioPermiso;
