require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// ════════════════════════════════════════════
//  Configuración de sequelize-cli (migraciones)
//
//  Tiene que resolver el SSL igual que src/config/database.js. Si difieren,
//  las migraciones se conectan de una forma y la aplicación de otra, y el
//  desajuste aparece recién en el deploy.
// ════════════════════════════════════════════

/**
 * Decide si la conexión usa SSL.
 *
 * Neon, Render y Railway lo exigen. Un Postgres local normalmente no lo tiene
 * configurado, y por eso existe DB_SSL=false.
 *
 * rejectUnauthorized queda en false porque estos proveedores usan certificados
 * que Node no valida contra su almacén por defecto.
 */
function opcionesSsl() {
  if (process.env.DB_SSL === 'false') return {};

  return { ssl: { require: true, rejectUnauthorized: false } };
}

function parseDatabaseUrl(url) {
  if (!url) return null;

  const parsed = new URL(url);

  return {
    dialect: 'postgres',
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 5432,
    username: decodeURIComponent(parsed.username),
    // La contraseña puede traer caracteres escapados en la URL: sin decodificar,
    // una que contenga por ejemplo un "@" o un "#" se manda mal y la conexión
    // falla con "authentication failed", que despista.
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),

    // El SSL NO depende del protocolo de la URL.
    //
    // Antes era `parsed.protocol === 'postgres:'`. Los connection strings de
    // Neon empiezan con "postgresql://", y "postgresql:" no es igual a
    // "postgres:": la condición daba falso y las migraciones se conectaban SIN
    // SSL. Neon exige SSL, así que rechazaba la conexión y el contenedor no
    // arrancaba.
    dialectOptions: opcionesSsl(),
  };
}

const dbUrlConfig = parseDatabaseUrl(process.env.DATABASE_URL);

const porPartes = {
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'sistema_facturacion',
};

module.exports = {
  // En desarrollo el default es un Postgres local sin SSL, pero DATABASE_URL
  // tiene prioridad si está definida: es habitual desarrollar contra Neon.
  development: dbUrlConfig || porPartes,

  test: dbUrlConfig || porPartes,

  production: dbUrlConfig || { ...porPartes, dialectOptions: opcionesSsl() },
};
