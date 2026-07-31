// ════════════════════════════════════════════
//  ADMINAPP · Server Entry Point
//  Express + PostgreSQL + Auth0
// ════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { sequelize, Usuario } = require('./models');
const { checkJwt, extractUser, loadEmpresaContext, requireEmpresa } = require('./middleware/auth');
const checkSubscription = require('./middleware/checkSubscription');
const subscriptionCron = require('./services/subscriptionCron');
const logger = require('./utils/logger');

// ── Validate required env vars ──
const REQUIRED_ENV = ['AUTH0_DOMAIN', 'AUTH0_AUDIENCE'];
if (process.env.BYPASS_AUTH !== 'true') {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      logger.fatal(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

// Referencia al servidor HTTP, para el cierre ordenado.
let servidor = null;

// ── Trust proxy ──
// Render, Railway, Vercel y cualquier PaaS ponen un reverse proxy delante.
// Sin esto, express-rate-limit ve la IP del proxy en vez de la del cliente
// (limita a todos los usuarios como si fueran uno) y avisa con
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. El valor 1 = confiar en un solo hop.
app.set('trust proxy', 1);

// ── Security Headers ──
app.use(helmet({
  // Los assets servidos por la API (logos de empresa) se embeben desde el
  // dominio del frontend, que es un origen distinto.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── Request Logging (morgan → pino) ──
const morganStream = { write: (msg) => logger.http(msg.trim()) };
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream: morganStream }));

// ── CORS ──
// Origenes permitidos. Ahora hay mas de uno (app + landing + previews de
// Vercel), asi que se acepta una lista separada por comas en ALLOWED_ORIGINS.
// FRONTEND_URL se mantiene por compatibilidad con la config existente.
const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()),
  process.env.FRONTEND_URL,
  process.env.LANDING_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
].filter(Boolean);

// Los deploy previews de Vercel usan subdominios efimeros. Se permiten solo
// si se define VERCEL_PREVIEW_PATTERN (ej: "adminapp-.*\.vercel\.app$").
const previewPattern = process.env.VERCEL_PREVIEW_PATTERN
  ? new RegExp(process.env.VERCEL_PREVIEW_PATTERN)
  : null;

function isOriginAllowed(origin) {
  if (allowedOrigins.includes(origin)) return true;
  if (previewPattern && previewPattern.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => {
    // Sin Origin = same-origin, curl, o health check del PaaS.
    if (!origin) return cb(null, true);
    if (isOriginAllowed(origin)) return cb(null, true);
    logger.warn({ origin }, 'CORS: origen rechazado');
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Empresa-Id', 'X-Punto-De-Venta-Id'],
  exposedHeaders: ['X-Empresa-Id', 'X-Punto-De-Venta-Id'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Health Check (público: sin auth y sin rate limit) ──
// Va DESPUES de cors y ANTES del rate limiter, a proposito.
// Antes estaba declarado arriba de app.use(cors(...)), con lo cual no recibia
// cabeceras CORS: un fetch desde el navegador para despertar la API (util con
// el cold start de ~50s del free tier de Render) quedaba bloqueado.
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, msg: 'AdminApp API OK', time: new Date().toISOString() });
});

// ── Health check profundo ──
//
// /api/ping solo dice que el proceso responde. Render lo usaba como
// healthCheckPath, con lo cual el servicio figuraba SANO aunque Postgres
// estuviera caido y cada request devolviera 500. Nadie se enteraba: ni una
// alerta, ni un reinicio, ni un aviso en el panel.
//
// Este endpoint verifica de verdad que se puede consultar la base. Es el que
// tiene que mirar la plataforma.
app.get('/api/health', async (req, res) => {
  const inicio = Date.now();

  try {
    await sequelize.query('SELECT 1');

    res.json({
      ok: true,
      base_de_datos: 'ok',
      // Con Neon free la base autosuspende: la primera consulta despues de la
      // suspension tarda. Exponer el tiempo permite distinguir "esta lenta"
      // de "esta caida" sin adivinar.
      latencia_ms: Date.now() - inicio,
      time: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'health: la base de datos no responde');

    res.status(503).json({
      ok: false,
      base_de_datos: 'error',
      latencia_ms: Date.now() - inicio,
      time: new Date().toISOString(),
    });
  }
});

// ── Rate Limiting (después de ping) ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 10000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas solicitudes. Intente de nuevo en 15 min.' },
});
app.use('/api/', limiter);

// ── Rutas protegidas con Auth0 ──
// Ahora usamos Auth0 incluso en desarrollo. Si necesitas bypass, usa BYPASS_AUTH=true
const authMiddleware = process.env.BYPASS_AUTH === 'true'
  ? [(req, res, next) => {
      req.userId = 'test-user-id';
      req.empresaId = 1;
      req.userRole = 'admin';
      Usuario.findOne({ where: { auth0_sub: 'test-user-id' } })
        .then(async (u) => {
          req.usuario = u;
          // Cargar permisos en bypass mode (admin = todos)
          const { RolPermiso, UsuarioPermiso, UsuarioEmpresa, PuntoDeVenta } = require('./models');
          try {
            const ue = await UsuarioEmpresa.findOne({
              where: { usuario_id: u.id, empresa_id: 1, is_active: true },
            });
            if (ue && ue.rol_id) {
              const rp = await RolPermiso.findAll({
                where: { rol_id: ue.rol_id },
                attributes: ['permiso_codigo'],
              });
              const permisos = new Set(rp.map(p => p.permiso_codigo));
              const overrides = await UsuarioPermiso.findAll({
                where: { usuario_empresa_id: ue.id },
                attributes: ['permiso_codigo', 'granted'],
              });
              for (const o of overrides) {
                if (o.granted) permisos.add(o.permiso_codigo);
                else permisos.delete(o.permiso_codigo);
              }
              req.usuarioPermisos = [...permisos];
            } else {
              req.usuarioPermisos = [];
            }
            // Cargar punto de venta por defecto
            const pvHeader = req.headers['x-punto-de-venta-id'];
            if (pvHeader) {
              req.puntoDeVentaId = parseInt(pvHeader, 10);
            } else {
              const defaultPv = await PuntoDeVenta.findOne({
                where: { empresa_id: 1, is_active: true },
                order: [['id', 'ASC']],
              });
              if (defaultPv) req.puntoDeVentaId = defaultPv.id;
            }
          } catch {
            req.usuarioPermisos = [];
          }
          next();
        })
        .catch(() => { req.usuarioPermisos = []; next(); });
    }]
  : [checkJwt, extractUser, loadEmpresaContext];

// ── Cadena para rutas con datos de una empresa ──
// requireEmpresa va DESPUES de loadEmpresaContext y ANTES de
// checkSubscription: sin empresa activa no hay suscripcion que chequear, y
// sobre todo no hay empresa valida sobre la cual operar. Antes las rutas lo
// resolvian con `req.empresaId || 1`, que ante un contexto no resuelto caia
// sobre la empresa 1 — un cliente real en produccion.
// checkSubscription solo fuera de bypass, igual que antes: en desarrollo con
// BYPASS_AUTH no se quiere que un trial vencido en la empresa 1 local bloquee
// todos los endpoints.
const authEmpresa = process.env.BYPASS_AUTH === 'true'
  ? [...authMiddleware, requireEmpresa]
  : [...authMiddleware, requireEmpresa, checkSubscription];

// ── Cadena para rutas que un usuario SIN empresa todavia debe poder usar ──
// Un usuario recien registrado no tiene empresa hasta completar el onboarding,
// y quien acepta una invitacion tampoco la tiene antes de aceptarla. Estas
// rutas se autentican igual, pero no pueden exigir empresa activa: hacerlo
// dejaria al usuario nuevo sin forma de crear la primera.
// El scoping de las que SI operan sobre una empresa se aplica ruta por ruta
// dentro de routes/empresas.js.
const authSinEmpresa = [...authMiddleware];

app.use('/api/products', ...authEmpresa, require('./routes/products'));
app.use('/api/sales', ...authEmpresa, require('./routes/sales'));
app.use('/api/suppliers', ...authEmpresa, require('./routes/suppliers'));
app.use('/api/afip', ...authEmpresa, require('./routes/afip'));
app.use('/api', ...authEmpresa, require('./routes/general'));
// TiendaNube se monta en dos partes: lo que llama TiendaNube desde afuera va
// sin sesion (valida firma HMAC), y lo que llama la app va autenticado.
app.use('/api/tiendanube', require('./routes/tiendanube').publico);
app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').privado);
app.use('/api/production', ...authEmpresa, require('./routes/production'));
app.use('/api/customers', ...authEmpresa, require('./routes/customers'));
app.use('/api/stock', ...authEmpresa, require('./routes/stock'));
app.use('/api/reports', ...authEmpresa, require('./routes/reports'));
app.use('/api/dashboard', ...authEmpresa, require('./routes/dashboard'));
app.use('/api/cashflow', ...authEmpresa, require('./routes/cashflow'));
app.use('/api/taxes', ...authEmpresa, require('./routes/taxes'));
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));
app.use('/api/import', ...authEmpresa, require('./routes/import'));

// ── Auth routes (invitaciones públicas + protegidas) ──
app.get('/api/auth/invite/:token', require('./routes/auth'));
app.post('/api/auth/accept-invite/:token', ...authSinEmpresa, require('./routes/auth'));

// ── Error Handler Global ──
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  // Error de Auth0 (token inválido o expirado)
  if (err.status === 401) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }

  res.status(err.status || 500).json({
    ok: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno del servidor',
  });
});

// ── Setup inicial ──
const setupDefaultData = require('./setup');
const seedPermissions = require('./seedPermissions');
const seedPuntosDeVenta = require('./seedPuntosDeVenta');

// ── Iniciar servidor ──
async function start() {
  try {
    await sequelize.authenticate();
    logger.info('PostgreSQL connected');

    if (process.env.NODE_ENV === 'production') {
      logger.info('Production mode: skipping sequelize.sync() — use "npm run migrate" instead');
    } else {
      await sequelize.sync({ alter: true });
      logger.info('Models synchronized (development)');
    }

    await seedPermissions();
    await seedPuntosDeVenta();
    await setupDefaultData();

    subscriptionCron.start();

    // Se guarda la referencia para poder cerrarlo de forma ordenada: sin ella
    // el shutdown cortaba la base con requests todavia en vuelo.
    servidor = app.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server started');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Solo arranca si el archivo se ejecuta directo (node src/server.js).
// Cuando se importa desde un test, se exporta `app` sin abrir el puerto ni
// conectar a la base, para poder ejercitarlo con supertest.
if (require.main === module) {
  start();

  // ── Graceful Shutdown ──
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // ── Fallos no atrapados ──
  //
  // No habia handlers. En Node una promesa rechazada sin catch tumba el
  // proceso, y una excepcion no atrapada tambien: el contenedor se reiniciaba
  // sin dejar ningun rastro de por que. Con los logs yendo a un archivo
  // efimero, el motivo se perdia del todo.
  //
  // Se loguea y se sale con codigo distinto de cero para que la plataforma lo
  // registre como caida y no como reinicio normal. No se intenta seguir
  // operando: despues de una excepcion no atrapada el estado del proceso es
  // desconocido, y una API de facturacion en estado desconocido es peor que
  // una API caida.
  process.on('unhandledRejection', (motivo, promesa) => {
    logger.fatal({ err: motivo, promesa: String(promesa) }, 'Promesa rechazada sin catch');
    shutdown(1);
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Excepcion no atrapada');
    shutdown(1);
  });
}

/**
 * Cierre ordenado.
 *
 * El orden importa: primero se deja de aceptar requests nuevos y se esperan
 * los que estan en vuelo, y RECIEN despues se cierra la base. La version
 * anterior cerraba Postgres de una, con lo cual una venta a medio guardar
 * durante un deploy se cortaba en el medio.
 *
 * @param {number} codigo Codigo de salida. 0 para un cierre normal.
 */
function shutdown(codigo = 0) {
  logger.info({ codigo }, 'Cerrando el servidor');

  subscriptionCron.stop();

  // Si el cierre se traba, no se puede esperar indefinidamente: la plataforma
  // manda SIGKILL a los ~30s de todas formas.
  const plazo = setTimeout(() => {
    logger.error('El cierre ordenado tardo demasiado, se fuerza la salida');
    process.exit(codigo || 1);
  }, 10000);
  plazo.unref();

  const cerrarBase = () => {
    sequelize.close()
      .then(() => logger.info('Conexion a PostgreSQL cerrada'))
      .catch((err) => logger.error({ err }, 'Error cerrando PostgreSQL'))
      .finally(() => {
        clearTimeout(plazo);
        process.exit(codigo);
      });
  };

  if (servidor) {
    // close() deja de aceptar conexiones nuevas y espera a que terminen las
    // que estan en curso.
    servidor.close(cerrarBase);
  } else {
    cerrarBase();
  }
}

module.exports = { app, start, shutdown };
