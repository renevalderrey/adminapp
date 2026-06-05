const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UsuarioEmpresa = sequelize.define('UsuarioEmpresa', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('admin', 'vendedor', 'produccion', 'compras'),
    allowNull: false,
    defaultValue: 'vendedor',
  },
  rol_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  is_default: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'usuario_empresas',
  hooks: {
    beforeCreate: async (ue) => {
      if (ue.role && !ue.rol_id) {
        const Rol = sequelize.models.Rol;
        const rol = await Rol.findOne({ where: { nombre: ue.role, empresa_id: null } });
        if (rol) ue.rol_id = rol.id;
      }
    },
    beforeUpdate: async (ue) => {
      if (ue.changed('role') && ue.role) {
        if (!ue.changed('rol_id')) {
          const Rol = sequelize.models.Rol;
          const rol = await Rol.findOne({ where: { nombre: ue.role, empresa_id: null } });
          if (rol) ue.rol_id = rol.id;
        }
      }
    },
  },
  indexes: [
    { unique: true, fields: ['usuario_id', 'empresa_id'] },
    { fields: ['usuario_id'] },
    { fields: ['empresa_id'] },
  ],
});

module.exports = UsuarioEmpresa;
