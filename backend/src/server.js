// ════════════════════════════════════════════
//  COMPRAFIT · Server Entry Point
//  Express + PostgreSQL + Auth0
// ════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { sequelize, Usuario } = require('./models');
const { checkJwt, extractUser, loadEmpresaContext } = require('./middleware/auth');
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

// ── Security Headers ──
app.use(helmet());

// ── Request Logging (morgan → pino) ──
const morganStream = { write: (msg) => logger.http(msg.trim()) };
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream: morganStream }));

// ── Health Check (público, sin auth ni rate limit) ──
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, msg: 'Admin App API OK', time: new Date().toISOString() });
});

// ── CORS ──
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Empresa-Id', 'X-Punto-De-Venta-Id'],
  exposedHeaders: ['X-Empresa-Id', 'X-Punto-De-Venta-Id'],
}));
app.use(express.json({ limit: '10mb' }));

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
  : [checkJwt, extractUser, loadEmpresaContext, checkSubscription];

app.use('/api/products', ...authMiddleware, require('./routes/products'));
app.use('/api/sales', ...authMiddleware, require('./routes/sales'));
app.use('/api/suppliers', ...authMiddleware, require('./routes/suppliers'));
app.use('/api/afip', ...authMiddleware, require('./routes/afip'));
app.use('/api', ...authMiddleware, require('./routes/general'));
app.use('/api/tiendanube', require('./routes/tiendanube'));
app.use('/api/production', ...authMiddleware, require('./routes/production'));
app.use('/api/customers', ...authMiddleware, require('./routes/customers'));
app.use('/api/stock', ...authMiddleware, require('./routes/stock'));
app.use('/api/reports', ...authMiddleware, require('./routes/reports'));
app.use('/api/dashboard', ...authMiddleware, require('./routes/dashboard'));
app.use('/api/cashflow', ...authMiddleware, require('./routes/cashflow'));
app.use('/api/taxes', ...authMiddleware, require('./routes/taxes'));
app.use('/api/empresas', ...authMiddleware, require('./routes/empresas'));
app.use('/api/import', ...authMiddleware, require('./routes/import'));

// ── Auth routes (invitaciones públicas + protegidas) ──
app.get('/api/auth/invite/:token', require('./routes/auth'));
app.post('/api/auth/accept-invite/:token', ...authMiddleware, require('./routes/auth'));

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

    app.listen(PORT, () => {
      logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server started');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();

// ── Graceful Shutdown ──
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  logger.info('Shutting down gracefully...');
  subscriptionCron.stop();
  sequelize.close().then(() => {
    logger.info('PostgreSQL connection closed');
    process.exit(0);
  }).catch((err) => {
    logger.error({ err }, 'Error closing PostgreSQL');
    process.exit(1);
  });
}
