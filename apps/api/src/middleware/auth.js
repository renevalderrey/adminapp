const { auth } = require('express-oauth2-jwt-bearer');
const { Usuario, UsuarioEmpresa, Empresa, PuntoDeVenta, Rol, RolPermiso, UsuarioPermiso } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
require('dotenv').config();

const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
});

const extractUser = (req, res, next) => {
  if (req.auth && req.auth.payload) {
    req.userId = req.auth.payload.sub;
    req.userEmail = req.auth.payload.email || null;
    req.userName = req.auth.payload.name || req.auth.payload.nickname || null;
  }
  next();
};

async function enrichUserFromAuth0(req) {
  if (req.userName && req.userEmail) return;

  const authHeader = req.headers.authorization;
  if (!authHeader) return;

  try {
    const token = authHeader.replace('Bearer ', '');
    const domain = process.env.AUTH0_DOMAIN;
    const res = await fetch(`https://${domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const profile = await res.json();
    if (!req.userName) req.userName = profile.name || profile.nickname || null;
    if (!req.userEmail) req.userEmail = profile.email || null;
  } catch {
    // userinfo fallback no crítico
  }
}

const loadEmpresaContext = async (req, res, next) => {
  try {
    if (!req.userId) return next();

    await enrichUserFromAuth0(req);

    let usuario = await Usuario.findOne({ where: { auth0_sub: req.userId } });

    if (!usuario) {
      usuario = await Usuario.create({
        auth0_sub: req.userId,
        email: req.userEmail || `user@${req.userId?.split('|')[1] || 'unknown'}.placeholder`,
        nombre: req.userName || req.userId,
      });
    } else {
      const updates = {};
      if (req.userEmail && req.userEmail !== usuario.email) updates.email = req.userEmail;
      if (req.userName && req.userName !== usuario.nombre) updates.nombre = req.userName;
      if (!usuario.nombre && !updates.nombre) updates.nombre = req.userId;
      if (!usuario.email && !updates.email) updates.email = `user@${req.userId?.split('|')[1] || 'unknown'}.placeholder`;
      if (Object.keys(updates).length) await usuario.update(updates);
    }

    req.usuario = usuario;

    const ue = await UsuarioEmpresa.findOne({
      where: { usuario_id: usuario.id, is_active: true },
      include: [
        { model: Empresa, as: 'empresa' },
      ],
      order: [['is_default', 'DESC']],
    });

    if (ue) {
      req.empresaId = ue.empresa_id;
      req.userRole = ue.role;
      req.empresa = ue.empresa;

      if (ue.empresa && ue.empresa.settings) {
        req.empresaSettings = ue.empresa.settings;
      }

      // ── Cargar permisos del usuario ──
      try {
        const permisos = new Set();

        if (ue.rol_id) {
          const rp = await RolPermiso.findAll({
            where: { rol_id: ue.rol_id },
            attributes: ['permiso_codigo'],
          });
          for (const p of rp) {
            permisos.add(p.permiso_codigo);
          }
        }

        const overrides = await UsuarioPermiso.findAll({
          where: { usuario_empresa_id: ue.id },
          attributes: ['permiso_codigo', 'granted'],
        });
        for (const o of overrides) {
          if (o.granted) {
            permisos.add(o.permiso_codigo);
          } else {
            permisos.delete(o.permiso_codigo);
          }
        }

        req.usuarioPermisos = [...permisos];
      } catch (permErr) {
        logger.warn({ err: permErr, userId: req.userId }, 'Error loading permissions, defaulting to empty');
        req.usuarioPermisos = [];
      }
    }

    const pvHeader = req.headers['x-punto-de-venta-id'];
    if (pvHeader) {
      req.puntoDeVentaId = parseInt(pvHeader, 10);
    }

    next();
  } catch (err) {
    logger.error({ err, userId: req.userId }, 'Error loading empresa context');
    next();
  }
};

const empresaScope = (req, res, next) => {
  if (req.method === 'GET' && req.empresaId) {
    const originalJson = res.json.bind(res);
    res.json = function (body) { return originalJson(body); };
  }
  next();
};

module.exports = { checkJwt, extractUser, loadEmpresaContext };
