const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TaxConfig = sequelize.define('TaxConfig', {
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
  tax_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  config: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
}, {
  tableName: 'tax_configs',
  indexes: [
    { unique: true, fields: ['empresa_id', 'tax_type'] },
  ],
});

module.exports = TaxConfig;
