const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Usuario = sequelize.define('Usuario', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  auth0_sub: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  nombre: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },

  /**
   * Operador de la plataforma.
   *
   * No es un rol dentro de una empresa: los roles viven en UsuarioEmpresa y
   * son por empresa. Esto es un nivel arriba, y habilita dos cosas:
   *
   *  - Elegir cualquier empresa desde el selector, sin membresia.
   *  - Ver los modulos que todavia no se liberaron a los clientes.
   *
   * Lo que NO habilita: ver datos de dos empresas a la vez. El scoping por
   * empresa_id sigue aplicando igual en cada consulta; lo unico que cambia es
   * QUE empresa se puede seleccionar.
   *
   * Se activa unicamente con scripts/superadmin.js. No hay ningun endpoint que
   * escriba esta columna a proposito: un endpoint que otorga superadmin es una
   * escalada de privilegios esperando a que alguien encuentre el IDOR.
   */
  es_superadmin: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'usuarios',
  indexes: [
    { unique: true, fields: ['auth0_sub'] },
  ],
});

module.exports = Usuario;
