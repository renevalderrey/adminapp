const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Empresa, PuntoDeVenta, Usuario, UsuarioEmpresa, Suscripcion, Invitacion, Rol, RolPermiso, UsuarioPermiso } = require('../models');
const { sendEmail, welcomeEmail, invitationEmail } = require('../services/email');
const checkPermission = require('../middleware/checkPermission');
const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');

const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'uploads', 'empresas');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `logo_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── ONBOARDING ──

// POST /api/empresas/onboarding — Crea empresa + PV + suscripción después del signup
router.post('/onboarding', (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.single('logo')(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario) return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });

    const { name, cuit, phone, address, city, state, rubro, pv_name } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'Completá el nombre de la empresa' });
    if (!phone) return res.status(400).json({ ok: false, error: 'Completá el teléfono de contacto' });

    const logoUrl = req.file ? `/uploads/empresas/${req.file.filename}` : null;

    const empresa = await Empresa.create({
      name,
      cuit: cuit || null,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      rubro: rubro || null,
      logo: logoUrl,
      onboarding_completed: true,
      settings: {
        margin_efectivo: 50,
        recargo_tarjeta: 20,
        descuento_alianza: 10,
        fixed_expenses_total: 0,
        afip_cuit: '',
        afip_pv: '',
        afip_environment: 'homologation',
        tax_condition: 'Monotributo',
      },
    });

    const defaultPv = await PuntoDeVenta.create({
      empresa_id: empresa.id,
      name: pv_name || 'Sucursal Principal',
      code: 'principal',
      address: address || null,
    });

    await UsuarioEmpresa.create({
      usuario_id: usuario.id,
      empresa_id: empresa.id,
      role: 'admin',
      is_default: true,
      accepted_at: new Date(),
    });

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 15);
    const graceEnd = new Date(trialEnd);
    graceEnd.setDate(graceEnd.getDate() + 3);

    await Suscripcion.create({
      empresa_id: empresa.id,
      plan: 'free',
      status: 'trialing',
      trial_starts_at: new Date(),
      trial_ends_at: trialEnd,
      grace_period_ends: graceEnd,
    });

    await sendEmail({
      to: usuario.email,
      subject: `Bienvenido a Admin App — ${name}`,
      html: welcomeEmail(usuario.nombre || usuario.email, name),
    });

    res.status(201).json({
      ok: true,
      data: {
        empresa: {
          id: empresa.id,
          name: empresa.name,
          cuit: empresa.cuit,
          phone: empresa.phone,
          address: empresa.address,
          city: empresa.city,
          state: empresa.state,
          logo: empresa.logo,
          settings: empresa.settings,
        },
        puntoDeVenta: { id: defaultPv.id, name: defaultPv.name, code: defaultPv.code },
        suscripcion: { status: 'trialing', trial_ends_at: trialEnd.toISOString() },
      },
    });
  } catch (err) {
    logger.error({ err }, 'Onboarding error');
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, error: 'El logo no puede superar los 5MB' });
    }
    if (err?.message?.includes('multer')) {
      return res.status(400).json({ ok: false, error: 'Error al subir el logo. Verificá que sea una imagen válida.' });
    }
    res.status(500).json({ ok: false, error: 'Error al crear la empresa. Intentalo de nuevo.' });
  }
});

// ── CONTEXTO ──

// GET /api/empresas/mi-contexto — Devuelve el contexto del usuario autenticado
router.get('/mi-contexto', async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario) return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });

    const ueList = await UsuarioEmpresa.findAll({
      where: { usuario_id: usuario.id, is_active: true },
      include: [
        {
          model: Empresa, as: 'empresa',
          include: [
            { model: PuntoDeVenta, as: 'puntosDeVenta', where: { is_active: true }, required: false },
            { model: Suscripcion, as: 'suscripcion' },
          ],
        },
        { model: Rol, as: 'rol' },
      ],
    });

    const empresas = ueList.map(ue => ({
      id: ue.empresa.id,
      name: ue.empresa.name,
      cuit: ue.empresa.cuit,
      rubro: ue.empresa.rubro,
      logo: ue.empresa.logo,
      phone: ue.empresa.phone,
      address: ue.empresa.address,
      city: ue.empresa.city,
      state: ue.empresa.state,
      settings: ue.empresa.settings,
      onboarding_completed: ue.empresa.onboarding_completed,
      role: ue.role,
      rol_id: ue.rol_id,
      is_default: ue.is_default,
      puntosDeVenta: ue.empresa.puntosDeVenta.map(pv => ({
        id: pv.id, name: pv.name, code: pv.code, address: pv.address,
      })),
      suscripcion: ue.empresa.suscripcion ? {
        status: ue.empresa.suscripcion.status,
        plan: ue.empresa.suscripcion.plan,
        trial_ends_at: ue.empresa.suscripcion.trial_ends_at,
        trial_starts_at: ue.empresa.suscripcion.trial_starts_at,
      } : null,
    }));

    const active = empresas.find(e => e.id === req.empresaId) || empresas[0] || null;

    res.json({
      ok: true,
      data: {
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      permisos: req.usuarioPermisos || [],
      empresaActiva: active,
        empresas,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/empresas/cambiar-empresa/:id — Cambiar empresa activa
router.put('/cambiar-empresa/:id', async (req, res) => {
  try {
    const usuario = req.usuario;
    const empresaId = parseInt(req.params.id, 10);

    const ue = await UsuarioEmpresa.findOne({
      where: { usuario_id: usuario.id, empresa_id: empresaId, is_active: true },
    });

    if (!ue) return res.status(403).json({ ok: false, error: 'No tienes acceso a esta empresa' });

    req.empresaId = empresaId;
    req.userRole = ue.role;

    // Reload permissions for the new empresa context
    try {
      const permisos = new Set();
      if (ue.rol_id) {
        const rp = await RolPermiso.findAll({
          where: { rol_id: ue.rol_id },
          attributes: ['permiso_codigo'],
        });
        for (const p of rp) permisos.add(p.permiso_codigo);
      }
      const overrides = await UsuarioPermiso.findAll({
        where: { usuario_empresa_id: ue.id },
        attributes: ['permiso_codigo', 'granted'],
      });
      for (const o of overrides) {
        if (o.granted) permisos.add(o.permiso_codigo);
        else permisos.delete(o.permiso_codigo);
      }
      req.usuarioPermisos = [...permisos];
    } catch (permErr) {
      logger.warn({ err: permErr, userId: req.userId }, 'Error reloading permissions on empresa switch');
      req.usuarioPermisos = [];
    }

    const empresa = await Empresa.findByPk(empresaId, {
      include: [
        { model: PuntoDeVenta, as: 'puntosDeVenta', where: { is_active: true }, required: false },
        { model: Suscripcion, as: 'suscripcion' },
      ],
    });

    res.json({
      ok: true,
      data: {
        id: empresa.id,
        name: empresa.name,
        cuit: empresa.cuit,
        rubro: empresa.rubro,
        logo: empresa.logo,
        phone: empresa.phone,
        address: empresa.address,
        city: empresa.city,
        state: empresa.state,
        settings: empresa.settings,
        onboarding_completed: empresa.onboarding_completed,
        role: ue.role,
        rol_id: ue.rol_id,
        permisos: req.usuarioPermisos || [],
        puntosDeVenta: empresa.puntosDeVenta.map(pv => ({
          id: pv.id, name: pv.name, code: pv.code, address: pv.address,
        })),
        suscripcion: empresa.suscripcion ? {
          status: empresa.suscripcion.status,
          plan: empresa.suscripcion.plan,
          trial_ends_at: empresa.suscripcion.trial_ends_at,
          trial_starts_at: empresa.suscripcion.trial_starts_at,
        } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CRUD Empresa ──

router.get('/', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresas = await Empresa.findAll({
      where: { is_active: true },
      include: [{ model: PuntoDeVenta, as: 'puntosDeVenta' }],
    });
    res.json({ ok: true, data: empresas });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:id', checkPermission('config.ver'), async (req, res) => {
  try {
    const empresa = await Empresa.findByPk(req.params.id, {
      include: [
        { model: PuntoDeVenta, as: 'puntosDeVenta' },
        { model: Suscripcion, as: 'suscripcion' },
      ],
    });
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    res.json({ ok: true, data: empresa });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/', checkPermission('config.editar'), async (req, res) => {
  try {
    const { name, cuit, rubro, settings } = req.body;
    const empresa = await Empresa.create({ name, cuit, rubro, settings: settings || {} });

    if (req.usuario) {
      await UsuarioEmpresa.create({
        usuario_id: req.usuario.id,
        empresa_id: empresa.id,
        role: 'admin',
        is_default: true,
      });
    }

    res.status(201).json({ ok: true, data: empresa });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:id', checkPermission('config.editar'), async (req, res) => {
  try {
    const { name, cuit, rubro, logo, phone, address, city, state, timezone, currency, settings } = req.body;
    const empresa = await Empresa.findByPk(req.params.id);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    await empresa.update({ name, cuit, rubro, logo, phone, address, city, state, timezone, currency, settings });
    res.json({ ok: true, data: empresa });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/:id', checkPermission('config.editar'), async (req, res) => {
  try {
    const empresa = await Empresa.findByPk(req.params.id);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    await empresa.update({ is_active: false });
    res.json({ ok: true, message: 'Empresa desactivada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── SUSCRIPCIÓN ──

router.get('/:id/suscripcion', async (req, res) => {
  try {
    const suscripcion = await Suscripcion.findOne({ where: { empresa_id: req.params.id } });
    if (!suscripcion) return res.status(404).json({ ok: false, error: 'Suscripción no encontrada' });
    res.json({ ok: true, data: suscripcion });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CRUD PuntoDeVenta ──

router.get('/:empresaId/puntos-de-venta', checkPermission('sucursales.ver'), async (req, res) => {
  try {
    const pvs = await PuntoDeVenta.findAll({
      where: { empresa_id: req.params.empresaId, is_active: true },
    });
    res.json({ ok: true, data: pvs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:empresaId/puntos-de-venta', checkPermission('sucursales.crear'), async (req, res) => {
  try {
    const { name, code, address } = req.body;
    const pv = await PuntoDeVenta.create({
      empresa_id: req.params.empresaId,
      name, code, address,
    });
    res.status(201).json({ ok: true, data: pv });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/puntos-de-venta/:id', checkPermission('sucursales.editar'), async (req, res) => {
  try {
    const { name, code, address } = req.body;
    const pv = await PuntoDeVenta.findByPk(req.params.id);
    if (!pv) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });
    await pv.update({ name, code, address });
    res.json({ ok: true, data: pv });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/puntos-de-venta/:id', checkPermission('sucursales.eliminar'), async (req, res) => {
  try {
    const pv = await PuntoDeVenta.findByPk(req.params.id);
    if (!pv) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });
    await pv.update({ is_active: false });
    res.json({ ok: true, message: 'Punto de venta desactivado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── INVITACIONES ──

router.get('/:empresaId/invitaciones', checkPermission('equipo.ver'), async (req, res) => {
  try {
    const invitaciones = await Invitacion.findAll({
      where: { empresa_id: req.params.empresaId },
      include: [{ model: Usuario, as: 'invitador', attributes: ['id', 'nombre', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ ok: true, data: invitaciones });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/empresas/:empresaId/invitar — Invitar empleado
router.post('/:empresaId/invitar', checkPermission('equipo.invitar'), async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'Email requerido' });

    const empresa = await Empresa.findByPk(req.params.empresaId);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

    const existing = await Invitacion.findOne({
      where: { empresa_id: req.params.empresaId, email, status: 'pending' },
    });
    if (existing) {
      return res.status(400).json({ ok: false, error: 'Ya hay una invitación pendiente para este email' });
    }

    const invitacion = await Invitacion.create({
      empresa_id: parseInt(req.params.empresaId),
      email,
      role: role || 'vendedor',
      invited_by: req.usuario?.id || null,
    });

    const invitador = req.usuario;
    await sendEmail({
      to: email,
      subject: `${invitador?.nombre || 'Alguien'} te invitó a unirte a ${empresa.name}`,
      html: invitationEmail(invitador?.nombre || 'Un administrador', empresa.name, invitacion.token),
    });

    res.status(201).json({ ok: true, data: invitacion });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/empresas/invitaciones/:token/re-enviar — Re-enviar invitación
router.post('/invitaciones/:token/re-enviar', checkPermission('equipo.invitar'), async (req, res) => {
  try {
    const invitacion = await Invitacion.findOne({
      where: { token: req.params.token, status: 'pending' },
      include: [{ model: Empresa, as: 'empresa' }],
    });
    if (!invitacion) return res.status(404).json({ ok: false, error: 'Invitación no encontrada o ya expiró' });

    await sendEmail({
      to: invitacion.email,
      subject: `Recordatorio: te invitamos a unirte a ${invitacion.empresa.name}`,
      html: invitationEmail('Un administrador', invitacion.empresa.name, invitacion.token),
    });

    res.json({ ok: true, message: 'Invitación re-enviada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/empresas/invitaciones/:id — Revocar invitación pendiente
router.delete('/invitaciones/:id', checkPermission('equipo.eliminar'), async (req, res) => {
  try {
    const invitacion = await Invitacion.findByPk(req.params.id);
    if (!invitacion) return res.status(404).json({ ok: false, error: 'Invitación no encontrada' });
    await invitacion.update({ status: 'revoked' });
    res.json({ ok: true, message: 'Invitación revocada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── USUARIOS (miembros del equipo) ──

router.get('/:empresaId/usuarios', checkPermission('equipo.ver'), async (req, res) => {
  try {
    const users = await UsuarioEmpresa.findAll({
      where: { empresa_id: req.params.empresaId, is_active: true },
      include: [{ model: Usuario, as: 'usuario' }],
    });
    res.json({ ok: true, data: users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:empresaId/usuarios', checkPermission('equipo.invitar'), async (req, res) => {
  try {
    const { auth0_sub, email, nombre, role } = req.body;

    let usuario = await Usuario.findOne({ where: { auth0_sub } });
    if (!usuario) {
      usuario = await Usuario.create({ auth0_sub, email, nombre });
    }

    const [ue] = await UsuarioEmpresa.findOrCreate({
      where: { usuario_id: usuario.id, empresa_id: req.params.empresaId },
      defaults: { role: role || 'vendedor' },
    });

    if (role) await ue.update({ role, is_active: true });

    res.status(201).json({ ok: true, data: { ...ue.toJSON(), usuario } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/usuarios/:id', checkPermission('config.editar'), async (req, res) => {
  try {
    const { role, is_active } = req.body;
    const ue = await UsuarioEmpresa.findByPk(req.params.id);
    if (!ue) return res.status(404).json({ ok: false, error: 'Relación no encontrada' });
    await ue.update({ role, is_active });
    res.json({ ok: true, data: ue });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
