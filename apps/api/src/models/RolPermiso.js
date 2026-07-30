const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RolPermiso = sequelize.define('RolPermiso', {
  rol_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    primaryKey: true,
  },
  permiso_codigo: {
    type: DataTypes.STRING(100),
    allowNull: false,
    primaryKey: true,
  },
}, {
  tableName: 'rol_permisos',
  timestamps: false,
});

module.exports = RolPermiso;
