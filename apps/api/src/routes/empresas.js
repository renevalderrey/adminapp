const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Empresa, PuntoDeVenta, Usuario, UsuarioEmpresa, Suscripcion, Invitacion, Rol, RolPermiso, UsuarioPermiso, Permiso, sequelize } = require('../models');
const { sendEmail, welcomeEmail, invitationEmail } = require('../services/email');
const checkPermission = require('../middleware/checkPermission');
const { requireEmpresa } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');
const { findScoped } = require('../utils/tenantScope');
const { fallo } = require('../utils/errores');

// ── Logo de empresa ──
// El logo se guarda como data URI en la columna Empresa.logo (TEXT), no en
// disco. Razon: en Render/Vercel/Railway el filesystem es efimero — todo lo
// escrito se pierde en cada deploy — y el free tier no tiene disco persistente.
// Guardarlo en Postgres lo hace portable entre plataformas sin cambios.
//
// El limite es 300KB (no 5MB) porque la empresa entera viaja en la respuesta
// de /mi-contexto, que el frontend pide en cada arranque de la app: un blob
// grande se transferiria en cada login.
const MAX_LOGO_BYTES = 300 * 1024;

const ALLOWED_LOGO_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES },
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowedExt.includes(ext) && ALLOWED_LOGO_MIME.includes(file.mimetype));
  },
});

/** Convierte el archivo en memoria a data URI, o null si no vino archivo. */
function fileToDataUri(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

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

    const logoDataUri = fileToDataUri(req.file);

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 15);
    const graceEnd = new Date(trialEnd);
    graceEnd.setDate(graceEnd.getDate() + 3);

    // ── Las cuatro creaciones van en UNA transaccion ──
    //
    // Antes eran cuatro create() sueltos. Si fallaba el tercero —por ejemplo
    // por una restriccion de la tabla de suscripciones— quedaba una empresa y
    // un punto de venta creados, sin membresia y sin suscripcion: el usuario
    // no podia entrar (no hay UsuarioEmpresa) ni volver a hacer el onboarding
    // (la empresa ya existe). Una cuenta zombi que solo se arregla a mano en
    // la base.
    //
    // El email queda FUERA a proposito: mandarlo no es reversible, y que el
    // proveedor de correo este caido no es razon para deshacer una empresa que
    // se creo bien.
    const { empresa, defaultPv } = await sequelize.transaction(async (t) => {
      const empresa = await Empresa.create({
        name,
        cuit: cuit || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        rubro: rubro || null,
        logo: logoDataUri,
        onboarding_completed: true,
        settings: {
          margin_efectivo: 50,
          recargo_tarjeta: 20,
          descuento_alianza: 10,
          fixed_expenses_total: 0,
          // Las claves afip_* NO van aca. La configuracion de AFIP vive en la
          // tabla settings, y sembrarlas vacias en este JSON hacia que taparan a
          // las reales en GET /api/settings.
          tax_condition: 'Monotributo',
        },
      }, { transaction: t });

      const defaultPv = await PuntoDeVenta.create({
        empresa_id: empresa.id,
        name: pv_name || 'Sucursal Principal',
        code: 'principal',
        address: address || null,
      }, { transaction: t });

      await UsuarioEmpresa.create({
        usuario_id: usuario.id,
        empresa_id: empresa.id,
        role: 'admin',
        is_default: true,
        accepted_at: new Date(),
      }, { transaction: t });

      await Suscripcion.create({
        empresa_id: empresa.id,
        plan: 'free',
        status: 'trialing',
        trial_starts_at: new Date(),
        trial_ends_at: trialEnd,
        grace_period_ends: graceEnd,
      }, { transaction: t });

      return { empresa, defaultPv };
    });

    // Si el correo no sale, la empresa igual quedo creada y el usuario ya esta
    // adentro: se registra y se sigue.
    const envio = await sendEmail({
      to: usuario.email,
      subject: `Bienvenido a Admin App — ${name}`,
      html: welcomeEmail(usuario.nombre || usuario.email, name),
    });

    if (!envio.ok) {
      logger.warn(
        { requestId: req.id, empresaId: empresa.id, motivo: envio.error },
        'No se pudo enviar el email de bienvenida'
      );
    }

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
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, error: 'El logo no puede superar los 300KB' });
    }
    if (err?.message?.includes('multer')) {
      return res.status(400).json({ ok: false, error: 'Error al subir el logo. Verificá que sea una imagen válida.' });
    }
    fallo(req, res, err, 'Error al crear la empresa. Intentalo de nuevo.');
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

    // ── Empresas del operador de la plataforma ──
    //
    // A un superadmin se le suman TODAS las empresas, no solo aquellas donde
    // tiene membresia: es lo que le permite entrar a dar soporte sin que
    // alguien tenga que invitarlo primero.
    //
    // Se marcan con `ajena: true` para que el selector pueda distinguirlas de
    // las propias. Ver una empresa de un cliente tiene que verse distinto de
    // estar en la tuya, o es cuestion de tiempo hasta que alguien cargue una
    // venta en la empresa equivocada.
    const idsPropias = new Set(ueList.map((ue) => ue.empresa_id));
    let ajenas = [];

    if (usuario.es_superadmin) {
      ajenas = await Empresa.findAll({
        where: { is_active: true, id: { [Op.notIn]: [...idsPropias, 0] } },
        include: [
          { model: PuntoDeVenta, as: 'puntosDeVenta', where: { is_active: true }, required: false },
          { model: Suscripcion, as: 'suscripcion' },
        ],
        order: [['name', 'ASC']],
      });
    }

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

    for (const e of ajenas) {
      empresas.push({
        id: e.id,
        name: e.name,
        cuit: e.cuit,
        rubro: e.rubro,
        logo: e.logo,
        phone: e.phone,
        address: e.address,
        city: e.city,
        state: e.state,
        settings: e.settings,
        onboarding_completed: e.onboarding_completed,
        role: 'admin',
        rol_id: null,
        is_default: false,
        // La marca que el frontend usa para avisar que estas en la empresa de
        // otro.
        ajena: true,
        puntosDeVenta: (e.puntosDeVenta || []).map(pv => ({
          id: pv.id, name: pv.name, code: pv.code, address: pv.address,
        })),
        suscripcion: e.suscripcion ? {
          status: e.suscripcion.status,
          plan: e.suscripcion.plan,
          trial_ends_at: e.suscripcion.trial_ends_at,
          trial_starts_at: e.suscripcion.trial_starts_at,
        } : null,
      });
    }

    const active = empresas.find(e => e.id === req.empresaId) || empresas[0] || null;

    res.json({
      ok: true,
      data: {
        usuario: {
          id: usuario.id,
          email: usuario.email,
          nombre: usuario.nombre,
          es_superadmin: usuario.es_superadmin === true,
        },
        permisos: req.usuarioPermisos || [],
        empresaActiva: active,
        empresas,
      },
    });
  } catch (err) {
    fallo(req, res, err, 'Error al cargar tu contexto de usuario');
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

    // Un operador de la plataforma puede cambiarse a cualquier empresa sin ser
    // miembro. Es el mismo ensanchamiento que hace loadEmpresaContext y por el
    // mismo motivo: poder dar soporte sin que lo tengan que invitar.
    const comoSuperadmin = !ue && usuario.es_superadmin === true;

    if (!ue && !comoSuperadmin) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esta empresa' });
    }

    req.empresaId = empresaId;
    req.userRole = ue ? ue.role : 'admin';

    // Reload permissions for the new empresa context
    try {
      const permisos = new Set();

      if (comoSuperadmin) {
        // Sin membresia no hay rol del que heredar. Se cargan los permisos del
        // catalogo para que el chequeo siga siendo el mismo para todos.
        const todos = await Permiso.findAll({ attributes: ['codigo'] });
        for (const p of todos) permisos.add(p.codigo);

        logger.info(
          { requestId: req.id, superadmin: true, usuario: req.userId, empresaId },
          'Superadmin cambio a una empresa ajena'
        );
      }

      if (ue?.rol_id) {
        const rp = await RolPermiso.findAll({
          where: { rol_id: ue.rol_id },
          attributes: ['permiso_codigo'],
        });
        for (const p of rp) permisos.add(p.permiso_codigo);
      }

      const overrides = ue
        ? await UsuarioPermiso.findAll({
            where: { usuario_empresa_id: ue.id },
            attributes: ['permiso_codigo', 'granted'],
          })
        : [];

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
        role: ue ? ue.role : 'admin',
        rol_id: ue ? ue.rol_id : null,
        ajena: comoSuperadmin,
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
    fallo(req, res, err, 'Error al cambiar de empresa');
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
    fallo(req, res, err, 'Error al listar las empresas');
  }
});

router.get('/:id', checkPermission('config.ver'), requireEmpresa, requireEmpresaPropia(), async (req, res) => {
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
    fallo(req, res, err, 'Error al obtener la empresa');
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
    fallo(req, res, err, 'Error al crear la empresa');
  }
});

/**
 * Verifica que el id de empresa de la ruta sea la empresa activa del request.
 *
 * checkPermission solo valida que el usuario tenga el permiso EN SU EMPRESA
 * ACTIVA — no mira el id de la URL. Sin este chequeo, cualquier usuario con el
 * permiso en su propia empresa podia operar sobre la empresa de otro cliente
 * pasando un id distinto.
 *
 * @param {string} [param='id'] Nombre del parametro de ruta que trae el id.
 *   Las rutas de este router usan tanto :id como :empresaId.
 */
function requireEmpresaPropia(param = 'id') {
  return (req, res, next) => {
    const idSolicitado = parseInt(req.params[param], 10);

    if (!Number.isInteger(idSolicitado) || idSolicitado !== req.empresaId) {
      logger.warn(
        { userId: req.userId, empresaActiva: req.empresaId, empresaSolicitada: req.params[param] },
        'Intento de acceso a empresa ajena'
      );
      return res.status(403).json({ ok: false, error: 'No tenés acceso a esta empresa' });
    }

    next();
  };
}

/** Valida que el logo sea un data URI de imagen dentro del limite de tamaño. */
function validarLogo(logo) {
  if (logo == null || logo === '') return { ok: true, valor: null };

  const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,/.exec(logo);
  if (!match) {
    return { ok: false, error: 'El logo debe ser una imagen en formato data URI' };
  }
  // El largo del base64 sobreestima los bytes reales en ~33%; alcanza como cota.
  if (logo.length > MAX_LOGO_BYTES * 1.4) {
    return { ok: false, error: 'El logo no puede superar los 300KB' };
  }
  return { ok: true, valor: logo };
}

router.put('/:id', checkPermission('config.editar'), requireEmpresa, requireEmpresaPropia(), async (req, res) => {
  try {
    const { name, cuit, rubro, logo, phone, address, city, state, timezone, currency, settings } = req.body;

    const logoCheck = validarLogo(logo);
    if (!logoCheck.ok) return res.status(400).json({ ok: false, error: logoCheck.error });

    const empresa = await Empresa.findByPk(req.params.id);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

    const cambios = { name, cuit, rubro, phone, address, city, state, timezone, currency, settings };
    // Solo se pisa el logo si vino en el body; un PUT parcial no debe borrarlo.
    if (logo !== undefined) cambios.logo = logoCheck.valor;

    await empresa.update(cambios);
    res.json({ ok: true, data: empresa });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar la empresa');
  }
});

router.delete('/:id', checkPermission('config.editar'), requireEmpresa, requireEmpresaPropia(), async (req, res) => {
  try {
    const empresa = await Empresa.findByPk(req.params.id);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    await empresa.update({ is_active: false });
    res.json({ ok: true, message: 'Empresa desactivada' });
  } catch (err) {
    fallo(req, res, err, 'Error al desactivar la empresa');
  }
});

// ── SUSCRIPCIÓN ──

// No tenia ni checkPermission ni validacion del :id: cualquier usuario
// autenticado podia leer el estado de suscripcion, el plan y las fechas de
// vencimiento de cualquier otra empresa cliente enumerando ids.
router.get('/:id/suscripcion', requireEmpresa, requireEmpresaPropia(), async (req, res) => {
  try {
    const suscripcion = await Suscripcion.findOne({ where: { empresa_id: req.empresaId } });
    if (!suscripcion) return res.status(404).json({ ok: false, error: 'Suscripción no encontrada' });

    res.json({ ok: true, data: suscripcion });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener la suscripción');
  }
});

// ── CRUD PuntoDeVenta ──
//
// Las rutas con :empresaId toman el id de la URL, no del contexto. Sin
// requireEmpresaPropia, checkPermission solo verifica que el usuario tenga el
// permiso en SU empresa —no que la empresa de la URL sea la suya—, asi que
// alcanzaba con cambiar el numero en la URL para operar sobre otra empresa
// cliente. Estaba puesto solo en /:empresaId/invitar; las cinco rutas que
// faltaban quedaban abiertas.

router.get('/:empresaId/puntos-de-venta', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('sucursales.ver'), async (req, res) => {
  try {
    const pvs = await PuntoDeVenta.findAll({
      where: { empresa_id: req.params.empresaId, is_active: true },
    });
    res.json({ ok: true, data: pvs });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los puntos de venta');
  }
});

router.post('/:empresaId/puntos-de-venta', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('sucursales.crear'), async (req, res) => {
  try {
    const { name, code, address } = req.body;
    const pv = await PuntoDeVenta.create({
      empresa_id: req.params.empresaId,
      name, code, address,
    });
    res.status(201).json({ ok: true, data: pv });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el punto de venta');
  }
});

router.put('/puntos-de-venta/:id', requireEmpresa, checkPermission('sucursales.editar'), async (req, res) => {
  try {
    const { name, code, address } = req.body;
    const pv = await findScoped(PuntoDeVenta, req.params.id, req.empresaId);
    if (!pv) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });
    await pv.update({ name, code, address });
    res.json({ ok: true, data: pv });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el punto de venta');
  }
});

router.delete('/puntos-de-venta/:id', requireEmpresa, checkPermission('sucursales.eliminar'), async (req, res) => {
  try {
    const pv = await findScoped(PuntoDeVenta, req.params.id, req.empresaId);
    if (!pv) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });
    await pv.update({ is_active: false });
    res.json({ ok: true, message: 'Punto de venta desactivado' });
  } catch (err) {
    fallo(req, res, err, 'Error al desactivar el punto de venta');
  }
});

// ── INVITACIONES ──

router.get('/:empresaId/invitaciones', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('equipo.ver'), async (req, res) => {
  try {
    const invitaciones = await Invitacion.findAll({
      where: { empresa_id: req.params.empresaId },
      include: [{ model: Usuario, as: 'invitador', attributes: ['id', 'nombre', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ ok: true, data: invitaciones });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las invitaciones');
  }
});

// POST /api/empresas/:empresaId/invitar — Invitar empleado
// El :empresaId de la URL debe ser la empresa activa. Sin ese chequeo,
// checkPermission solo validaba que el usuario pudiera invitar EN SU PROPIA
// empresa, y despues se invitaba al email indicado a la empresa del :empresaId:
// alcanzaba con poner el id de otra empresa y el mail propio para conseguir
// acceso a un tenant ajeno.
router.post('/:empresaId/invitar', checkPermission('equipo.invitar'), requireEmpresa, requireEmpresaPropia('empresaId'), async (req, res) => {
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
    const envio = await sendEmail({
      to: email,
      subject: `${invitador?.nombre || 'Alguien'} te invitó a unirte a ${empresa.name}`,
      html: invitationEmail(invitador?.nombre || 'Un administrador', empresa.name, invitacion.token),
    });

    // La invitacion queda creada y el enlace sirve igual, asi que no es un
    // error: es un 201 que dice la verdad. Antes se respondia siempre "ok" y
    // quien invitaba se quedaba esperando a alguien que nunca recibio nada.
    if (!envio.ok) {
      logger.warn(
        { requestId: req.id, empresaId: empresa.id, invitacionId: invitacion.id },
        'Invitación creada pero el email no salió'
      );
    }

    res.status(201).json({
      ok: true,
      data: invitacion,
      email_enviado: envio.ok,
      message: envio.ok
        ? undefined
        : 'La invitación se creó pero no se pudo enviar el email. Pasale el enlace de invitación a mano.',
    });
  } catch (err) {
    fallo(req, res, err, 'Error al enviar la invitación');
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

    const envio = await sendEmail({
      to: invitacion.email,
      subject: `Recordatorio: te invitamos a unirte a ${invitacion.empresa.name}`,
      html: invitationEmail('Un administrador', invitacion.empresa.name, invitacion.token),
    });

    // Acá sí es un fallo: la unica accion que pedia el usuario era enviar.
    if (!envio.ok) {
      logger.warn(
        { requestId: req.id, invitacionId: invitacion.id },
        'No se pudo re-enviar la invitación'
      );

      return res.status(502).json({
        ok: false,
        error: 'No se pudo enviar el email. Pasale el enlace de invitación a mano.',
        requestId: req.id,
      });
    }

    res.json({ ok: true, message: 'Invitación re-enviada' });
  } catch (err) {
    fallo(req, res, err, 'Error al re-enviar la invitación');
  }
});

// DELETE /api/empresas/invitaciones/:id — Revocar invitación pendiente
router.delete('/invitaciones/:id', requireEmpresa, checkPermission('equipo.eliminar'), async (req, res) => {
  try {
    const invitacion = await findScoped(Invitacion, req.params.id, req.empresaId);
    if (!invitacion) return res.status(404).json({ ok: false, error: 'Invitación no encontrada' });
    await invitacion.update({ status: 'revoked' });
    res.json({ ok: true, message: 'Invitación revocada' });
  } catch (err) {
    fallo(req, res, err, 'Error al revocar la invitación');
  }
});

// ── USUARIOS (miembros del equipo) ──

router.get('/:empresaId/usuarios', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('equipo.ver'), async (req, res) => {
  try {
    const users = await UsuarioEmpresa.findAll({
      where: { empresa_id: req.params.empresaId, is_active: true },
      include: [{ model: Usuario, as: 'usuario' }],
    });
    res.json({ ok: true, data: users });
  } catch (err) {
    fallo(req, res, err, 'Error al listar el equipo');
  }
});

// La peor de las cinco: permitia agregar un usuario —incluido uno mismo— al
// equipo de otra empresa cliente, con el rol que se pidiera.
router.post('/:empresaId/usuarios', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('equipo.invitar'), async (req, res) => {
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
    fallo(req, res, err, 'Error al agregar el usuario a la empresa');
  }
});

// UsuarioEmpresa no tiene columna empresa_id sino empresa_id como FK propia:
// se filtra por ella igual. Sin el filtro, este endpoint permitia cambiarle el
// rol o desactivar a cualquier miembro de cualquier empresa cliente.
router.put('/usuarios/:id', requireEmpresa, checkPermission('config.editar'), async (req, res) => {
  try {
    const { role, is_active } = req.body;

    const ue = await UsuarioEmpresa.findOne({
      where: { id: req.params.id, empresa_id: req.empresaId },
    });
    if (!ue) return res.status(404).json({ ok: false, error: 'Relación no encontrada' });

    await ue.update({ role, is_active });
    res.json({ ok: true, data: ue });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el usuario');
  }
});

module.exports = router;
