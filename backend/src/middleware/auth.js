// ════════════════════════════════════════════
//  COMPRAFIT · Auth0 Middleware
//  Protege las rutas con JWT de Auth0
// ════════════════════════════════════════════

const { auth } = require('express-oauth2-jwt-bearer');
require('dotenv').config();

// Middleware que valida el JWT de Auth0
// Debe usarse en las rutas que requieran autenticación
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
});

// Middleware opcional: extrae info del usuario del token
const extractUser = (req, res, next) => {
  if (req.auth && req.auth.payload) {
    req.userId = req.auth.payload.sub; // Auth0 user ID (e.g. "auth0|abc123")
    req.userEmail = req.auth.payload.email || null;
  }
  next();
};

module.exports = { checkJwt, extractUser };
