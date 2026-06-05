// ════════════════════════════════════════════
//  COMPRAFIT · Database Configuration
//  Sequelize + PostgreSQL
// ════════════════════════════════════════════

const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      // Agrega automáticamente createdAt y updatedAt a todos los modelos
      timestamps: true,
      underscored: true, // Usa snake_case en la BD (standard PostgreSQL)
    },
  }
);

module.exports = sequelize;
