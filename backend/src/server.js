// ════════════════════════════════════════════
//  COMPRAFIT · Server Entry Point
//  Express + PostgreSQL + Auth0
// ════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');
const { checkJwt, extractUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware Global ──
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Health Check (público) ──
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, msg: 'Comprafit API OK', time: new Date().toISOString() });
});

// ── Rutas protegidas con Auth0 ──
// Ahora usamos Auth0 incluso en desarrollo. Si necesitas bypass, usa BYPASS_AUTH=true
const authMiddleware = process.env.BYPASS_AUTH === 'true'
  ? [(req, res, next) => {
      req.userId = 'test-user-id';
      next();
    }]
  : [checkJwt, extractUser];

app.use('/api/products', ...authMiddleware, require('./routes/products'));
app.use('/api/sales', ...authMiddleware, require('./routes/sales'));
app.use('/api/suppliers', ...authMiddleware, require('./routes/suppliers'));
app.use('/api/afip', ...authMiddleware, require('./routes/afip'));
app.use('/api', ...authMiddleware, require('./routes/general'));
app.use('/api/tiendanube', require('./routes/tiendanube'));

// ── Error Handler Global ──
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);

  // Error de Auth0 (token inválido o expirado)
  if (err.status === 401) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }

  res.status(err.status || 500).json({
    ok: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno del servidor',
  });
});

// ── Iniciar servidor ──
async function start() {
  try {
    // Conectar a la base de datos
    await sequelize.authenticate();
    console.log('✅ Conexión a PostgreSQL establecida');

    // Sincronizar modelos (crear tablas si no existen)
    // En producción usar migraciones de Sequelize en vez de sync
    await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
    console.log('✅ Modelos sincronizados con la base de datos');

    app.listen(PORT, () => {
      console.log(`🚀 Comprafit API corriendo en http://localhost:${PORT}`);
      console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Auth0: ${process.env.AUTH0_DOMAIN || 'No configurado (modo abierto en dev)'}`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar:', err);
    process.exit(1);
  }
}

start();
