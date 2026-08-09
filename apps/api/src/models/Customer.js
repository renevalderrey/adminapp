const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Customer = sequelize.define('Customer', {
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
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  tax_id: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  phone: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  tax_condition: {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'consumidor_final',
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'customers',
  indexes: [
    // Con `name` explícito, e idéntico al de la migración 20260814: si los dos
    // no coinciden, `verificar-esquema.js` reporta este índice como faltante.
    //
    // Es la columna por la que filtra cada consulta del sistema y no tenía
    // índice. Se creó en la etapa 0 del hito 10 —antes de que el checkout
    // empiece a crear un `Customer` por comprador— porque sobre una tabla chica
    // es gratis y sobre una tabla que ya creció, no.
    { name: 'idx_customer_empresa', fields: ['empresa_id'] },
    { fields: ['name'] },
    { fields: ['tax_id'] },
  ],
});

module.exports = Customer;
