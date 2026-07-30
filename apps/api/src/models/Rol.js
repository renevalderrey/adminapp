const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Rol = sequelize.define('Rol', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  empresa_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  is_system: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'roles',
  indexes: [
    { fields: ['empresa_id'] },
  ],
});

module.exports = Rol;
