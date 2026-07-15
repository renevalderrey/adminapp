// ════════════════════════════════════════════
//  COMPRAFIT · Database Configuration
//  Sequelize + PostgreSQL
// ════════════════════════════════════════════

const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
require('dotenv').config();

// Support both DATABASE_URL (Neon, Railway, etc.) and individual env vars
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
      dialectOptions: {
        ssl: process.env.DB_SSL === 'false' ? false : {
          require: true,
          rejectUnauthorized: false,
        },
      },
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
      define: {
        timestamps: true,
        underscored: true,
      },
    })
  : new Sequelize(
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
          timestamps: true,
          underscored: true,
        },
      }
    );

module.exports = sequelize;
