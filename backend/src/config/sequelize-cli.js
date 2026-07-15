require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// Support DATABASE_URL (Neon, Railway, etc.)
function parseDatabaseUrl(url) {
  if (!url) return null;
  const parsed = new URL(url);
  return {
    dialect: 'postgres',
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 5432,
    username: parsed.username,
    password: parsed.password,
    database: parsed.pathname.slice(1),
    dialectOptions: parsed.protocol === 'postgres:' ? {
      ssl: { require: true, rejectUnauthorized: false },
    } : {},
  };
}

const dbUrlConfig = parseDatabaseUrl(process.env.DATABASE_URL);

module.exports = {
  development: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'sistema_facturacion',
  },
  production: dbUrlConfig || {
    dialect: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  },
};
