const express = require('express');
const router = express.Router();
const { Invitacion, Usuario, UsuarioEmpresa, Empresa } = require('../models');
const { Op } = require('sequelize');

// POST /api/auth/accept-invite/:token — Aceptar invitación (usuario autenticado)
router.post('/accept-invite/:token', async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario) return res.status(401).json({ ok: false, error: 'Debes iniciar sesión para aceptar la invitación' });

    const invitacion = await Invitacion.findOne({
      where: {
        token: req.params.token,
        status: 'pending',
        email: usuario.email,
        expires_at: { [Op.gt]: new Date() },
      },
    });

    if (!invitacion) {
      return res.status(404).json({
        ok: false,
        error: 'Invitación no encontrada, expirada o el email no coincide',
      });
    }

    const [ue, created] = await UsuarioEmpresa.findOrCreate({
      where: { usuario_id: usuario.id, empresa_id: invitacion.empresa_id },
      defaults: {
        role: invitacion.role,
        invited_by: invitacion.invited_by,
        accepted_at: new Date(),
      },
    });

    if (!created) {
      await ue.update({ is_active: true, role: invitacion.role, accepted_at: new Date() });
    }

    await invitacion.update({ status: 'accepted', accepted_at: new Date() });

    const empresa = await Empresa.findByPk(invitacion.empresa_id);

    res.json({
      ok: true,
      data: {
        empresa: { id: empresa.id, name: empresa.name },
        role: invitacion.role,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/auth/invite/:token — Obtener info de invitación (público, sin auth)
router.get('/invite/:token', async (req, res) => {
  try {
    const invitacion = await Invitacion.findOne({
      where: {
        token: req.params.token,
        status: 'pending',
        expires_at: { [Op.gt]: new Date() },
      },
      include: [{ model: Empresa, as: 'empresa' }],
    });

    if (!invitacion) {
      return res.status(404).json({ ok: false, error: 'Invitación no válida o expirada' });
    }

    res.json({
      ok: true,
      data: {
        email: invitacion.email,
        empresa: { name: invitacion.empresa.name },
        role: invitacion.role,
        expires_at: invitacion.expires_at,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
