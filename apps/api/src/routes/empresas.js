const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Empresa, PuntoDeVenta, Usuario, UsuarioEmpresa, Suscripcion, Invitacion, Rol, RolPermiso, UsuarioPermiso, Permiso, Sesion, sequelize, Catalogo } = require('../models');
const { sendEmail, welcomeEmail, invitationEmail, enlaceDeInvitacion } = require('../services/email');
const checkPermission = require('../middleware/checkPermission');
const { requireEmpresa } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');
const { findScoped } = require('../utils/tenantScope');
const { fallo } = require('../utils/errores');
const { puedeCambiarRol, esUltimoAdmin, esRolValido, ROLES_VALIDOS, MOTIVOS } = require('../utils/equipo');
const sesionesService = require('../services/sesionesService');
const { dispositivoDeUserAgent } = require('../utils/dispositivo');
const { CABECERA: CABECERA_DE_SESION } = require('../middleware/registrarSesion');

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

// ════════════════════════════════════════════
//  El onboarding es IDEMPOTENTE: dos llamadas no son dos empresas
//
//  `POST /onboarding` creaba una empresa cada vez que se lo llamaba, sin mirar
//  si el usuario ya tenia una. En produccion eso cuadruplico una empresa: la
//  pantalla no avanzaba —`loadEmpresaContext` salia sin recargar y el usuario
//  seguia viendo el formulario—, el boton se volvia a habilitar, y cada clic
//  era una empresa nueva con su punto de venta y su suscripcion.
//
//  El `disabled` del boton NO alcanza, y por eso la garantia esta aca. Vuelven
//  a llamar a esta ruta un reintento de la red, un F5, una segunda pestaña y
//  cualquier cliente futuro. Una garantia que vive en el navegador no es una
//  garantia.
//
//  ── Por que un lock y no solo el SELECT ──
//
//  Dos clics rapidos son dos requests en paralelo: los dos leen «no tiene
//  empresa» antes de que ninguno escriba, y los dos crean. `pg_advisory_xact_lock`
//  es por usuario y se libera solo al terminar la transaccion, asi que el
//  segundo espera al primero y despues ve la empresa que aquel creo.
//
//  El desplazamiento evita chocar con otros locks del sistema —`migrar.js` usa
//  947213— sin tener que coordinar numeros: el espacio es de 64 bits y los
//  ids de usuario empiezan en 1.
//
//  ⚠ Esta ruta es «crear MI PRIMERA empresa». La segunda empresa de un usuario
//  se crea por `POST /api/empresas`, que pide permiso `config.editar` y no pasa
//  por aca: no hay un unico global sobre `usuario_id` porque pertenecer a
//  varias empresas es una funcionalidad, no un accidente.
// ════════════════════════════════════════════
const LOCK_DE_ONBOARDING = 8800000;

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

    // ════════════════════════════════════════════
    //  Onboarding IDEMPOTENTE: dos llamadas no son dos empresas
    //
    //  Esta ruta creaba una empresa cada vez que se la llamaba, sin mirar si el
    //  usuario ya tenia una. En produccion eso cuadruplico una empresa: la
    //  pantalla no avanzaba —`loadEmpresaContext` salia sin recargar y el
    //  usuario seguia viendo el formulario—, el boton se volvia a habilitar, y
    //  cada clic era una empresa nueva con su punto de venta y su suscripcion.
    //
    //  El `disabled` del boton NO alcanza y por eso el arreglo esta ACA. Lo
    //  vuelven a llamar un reintento de la red, un F5, una segunda pestaña y
    //  cualquier cliente futuro. Una garantia que vive en el navegador no es
    //  una garantia.
    //
    //  ── Por que 200 con la empresa existente y no un 409 ──
    //
    //  Porque para el que llama el resultado es el mismo: «tu empresa esta
    //  creada, segui». Un 409 obligaria a cada cliente a distinguir «ya existe»
    //  de «fallo», y el que no lo hiciera mostraria un error sobre una cuenta
    //  que quedo perfecta. Idempotente significa que repetir no cambia nada,
    //  incluida la cara que pone el que repite.
    //
    //  ── Por que un lock y no solo el SELECT ──
    //
    //  Dos clics rapidos son dos requests en paralelo: los dos leen «no tiene
    //  empresa» antes de que ninguno escriba, y los dos crean. El advisory lock
    //  es por usuario y dura lo que dura la transaccion, asi que el segundo
    //  espera al primero y despues ve la empresa que aquel creo.
    //
    //  ⚠ Esta ruta es «crear MI PRIMERA empresa». La segunda empresa de un
    //  usuario se crea por `POST /api/empresas`, que pide permiso `config.editar`
    //  y no pasa por aca: no hay un unico global sobre `usuario_id` porque
    //  pertenecer a varias empresas es una funcionalidad, no un accidente.
    // ════════════════════════════════════════════
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
    const { empresa, defaultPv, yaExistia } = await sequelize.transaction(async (t) => {
      // El lock y la lectura, DENTRO de la transaccion y en este orden.
      await sequelize.query(
        'SELECT pg_advisory_xact_lock(:clave)',
        { replacements: { clave: LOCK_DE_ONBOARDING + Number(usuario.id) }, transaction: t }
      );

      const membresia = await UsuarioEmpresa.findOne({
        where: { usuario_id: usuario.id },
        include: [{ model: Empresa, as: 'empresa', include: [{ model: PuntoDeVenta, as: 'puntosDeVenta', required: false }] }],
        order: [['id', 'ASC']],
        transaction: t,
      });

      if (membresia && membresia.empresa) {
        return {
          empresa: membresia.empresa,
          defaultPv: (membresia.empresa.puntosDeVenta || [])[0] || null,
          yaExistia: true,
        };
      }

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

      return { empresa, defaultPv, yaExistia: false };
    });

    // ── El repetido sale por aca ──
    //
    // Mismo cuerpo que el alta, con 200 en vez de 201: para el que llama el
    // resultado es «tu empresa esta creada, segui», que es exactamente lo que
    // tiene que hacer. Y sin mail: el de bienvenida ya salio la primera vez.
    if (yaExistia) {
      logger.info(
        { requestId: req.id, usuarioId: usuario.id, empresaId: empresa.id },
        'onboarding: el usuario ya tenia empresa, no se crea otra'
      );

      return res.status(200).json({
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
          puntoDeVenta: defaultPv
            ? { id: defaultPv.id, name: defaultPv.name, code: defaultPv.code }
            : null,
        },
      });
    }

    // Si el correo no sale, la empresa igual quedo creada y el usuario ya esta
    // adentro: se registra y se sigue.
    const envio = await sendEmail({
      to: usuario.email,
      subject: `Bienvenido a Favalio — ${name}`,
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

// ════════════════════════════════════════════
//  SESIONES · desde qué dispositivos entró cada miembro, y cómo se cierra uno
//
//  ⚠ ── Por qué este bloque está ACÁ ARRIBA y no al final del archivo ──
//
//  Por `DELETE /sesiones`, que es **un solo segmento**: declarado más abajo, lo
//  atrapa primero `router.delete('/:id')` con `id = 'sesiones'`,
//  `requireEmpresaPropia` hace `parseInt('sesiones')` → `NaN` y el endpoint
//  responde **403 sin haber existido nunca**. Express resuelve por orden de
//  declaración. Los otros dos (`/:empresaId/sesiones`, `/sesiones/:id`) tienen dos
//  segmentos y no chocan con nada, pero se dejan juntos: partir el bloque para
//  que dos rutas queden acá y una allá es cómo alguien las vuelve a mover.
//
//  ── El aislamiento no sale de una columna ──
//
//  `sesiones` no tiene `empresa_id` a propósito (decisión 3): una sesión es de un
//  dispositivo de una persona, y esa persona cambia de empresa con el selector
//  sin cerrar nada. El filtro por membresía está encapsulado en
//  `services/sesionesService.js` y una sesión ajena da cero filas → **404**, que
//  es la misma respuesta que `findScoped` para un recurso de otra empresa: un 403
//  confirmaría que existe.
//
//  ── Y el techo, que la pantalla repite con estas palabras ──
//
//  Cerrar una sesión NO revoca el token: cierra al navegador que **coopera**. El
//  corte de verdad es desactivar al miembro (`PUT /usuarios/:id`), que funciona
//  desde siempre porque `loadEmpresaContext` relee la membresía en cada request.
// ════════════════════════════════════════════

/**
 * Hasta dónde se recorta el identificador de sesión antes de compararlo.
 *
 * ⚠ Es el MISMO recorte que hace `middleware/registrarSesion.js:134` antes de
 * escribir, y tiene que serlo: `sesiones.dispositivo` es un `VARCHAR(64)` y el
 * identificador lo elige el cliente, así que lo que quedó guardado son los
 * primeros 64 caracteres y nunca el valor crudo.
 *
 * Comparar el crudo era asimétrico y rompía las dos cosas que dependen de
 * «¿cuál de estas filas es la mía?»: con un identificador más largo, ninguna
 * fila coincidía, el badge «Este dispositivo» no aparecía en ninguna y
 * `DELETE /sesiones` —«todas menos ésta»— cerraba **también la propia**
 * mientras la respuesta decía «Ésta sigue abierta». El navegador se quedaba
 * afuera en el request siguiente, con un 401 que su propio pedido había
 * causado.
 *
 * El largo está escrito acá y allá porque `registrarSesion` no lo exporta; lo
 * que impide que deriven es el test de integración que manda un identificador
 * más largo y verifica las dos mitades.
 */
const LARGO_DEL_IDENTIFICADOR = 64;

/** El identificador de sesión de este request, recortado como la columna. */
function identificadorDeSesion(req) {
  return String(req.headers[CABECERA_DE_SESION] || '')
    .trim()
    .slice(0, LARGO_DEL_IDENTIFICADOR);
}

// GET /api/empresas/:empresaId/sesiones — las abiertas de los miembros activos
router.get('/:empresaId/sesiones', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('equipo.ver'), async (req, res) => {
  try {
    const sesiones = await sesionesService.sesionesDeLaEmpresa(req.empresaId);

    // El identificador del propio request, para el badge «Este dispositivo». Es
    // lo único que le permite a alguien saber cuál de las filas NO tiene que
    // cerrar. Sale de la cabecera y no de la base: es el dato del request.
    const mio = identificadorDeSesion(req);

    res.json({
      ok: true,
      data: sesiones.map((s) => ({
        id: s.id,
        usuario_id: s.usuario_id,
        nombre: s.usuario ? s.usuario.nombre : null,
        email: s.usuario ? s.usuario.email : null,
        // La etiqueta se DERIVA del user-agent crudo, que es lo que se guarda:
        // así se puede corregir el reconocimiento de un navegador nuevo sin
        // migrar un solo dato.
        dispositivo: dispositivoDeUserAgent(s.user_agent),
        user_agent: s.user_agent,
        ip: s.ip,
        iniciada_en: s.iniciada_en,
        vista_en: s.vista_en,
        es_este_dispositivo: Boolean(mio) && s.dispositivo === mio,
      })),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las sesiones del equipo');
  }
});

// DELETE /api/empresas/sesiones — «cerrar todas menos ésta», de las PROPIAS
//
// Pide `equipo.ver`, que es **menos** que `equipo.editar` —el de cerrarle la
// sesión a otro, que es el endpoint de abajo—, y ésa sigue siendo la asimetría
// correcta: esta acción no toca a nadie más que a uno mismo.
//
// ⚠ **Pero `equipo.ver` NO lo tienen los cinco roles.** Según
// `seedPermissions.js` lo tienen `admin` y `gerente`, y nadie más; el que
// tienen los cinco es `dashboard.ver`. Acá decía «cualquiera puede cerrar sus
// propias sesiones» y era falso: un vendedor, alguien de producción o de
// compras —justamente quienes dejan la sesión abierta en la computadora del
// local— hoy reciben 403.
//
// El texto se corrige y el alcance NO se mueve, y es una decisión, no un
// olvido: repartir un permiso cambia lo que puede hacer un rol que ya está en
// producción, y además **no alcanzaría con esta línea**. `Team.jsx:637` dibuja
// el bloque de sesiones solo con `equipo.ver`, así que un vendedor con el
// permiso nuevo seguiría sin tener el botón. Entregar la intención escrita acá
// son tres lados —catálogo, esta ruta y la pantalla— y se decide entero o no se
// decide. PENDIENTE: «cerrar mis propias sesiones» para los otros tres roles.
//
// ⚠ Va declarado ARRIBA de `DELETE /sesiones/:id` por claridad, y las dos ARRIBA
// de `DELETE /:id`, que es lo que de verdad importa: ver el bloque de arriba.
router.delete('/sesiones', requireEmpresa, checkPermission('equipo.ver'), async (req, res) => {
  try {
    const cerradas = await sesionesService.cerrarLasDemas({
      usuarioId: req.usuario ? req.usuario.id : null,
      // Recortado, como la columna: sin esto «todas menos ésta» cerraba ésta.
      dispositivoActual: identificadorDeSesion(req),
    });

    res.json({
      ok: true,
      cerradas,
      message: cerradas === 1
        ? 'Se cerró 1 sesión. Ésta sigue abierta.'
        : `Se cerraron ${cerradas} sesiones. Ésta sigue abierta.`,
    });
  } catch (err) {
    fallo(req, res, err, 'Error al cerrar las otras sesiones');
  }
});

// DELETE /api/empresas/sesiones/:id — cerrar la sesión de un miembro
//
// ⚠ La cierra en TODAS las empresas a las que esa persona tenga acceso, porque
// una sesión es de un dispositivo y no de una empresa. La confirmación de la
// pantalla lo dice con esas palabras.
router.delete('/sesiones/:id', requireEmpresa, checkPermission('equipo.editar'), async (req, res) => {
  try {
    const sesion = await sesionesService.cerrar({
      id: req.params.id,
      empresaId: req.empresaId,
      porUsuarioId: req.usuario ? req.usuario.id : null,
    });

    // 404 y no 403: un 403 confirmaría que la sesión existe y es de otra
    // empresa, que es justo lo que permite enumerar ids ajenos.
    if (!sesion) return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });

    res.json({
      ok: true,
      data: { id: sesion.id, cerrada_en: sesion.cerrada_en },
      message: 'Se cerró la sesión de ese dispositivo. No revoca el acceso: ' +
        'si esa persona vuelve a entrar, abre una sesión nueva.',
    });
  } catch (err) {
    fallo(req, res, err, 'Error al cerrar la sesión');
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
//
// ── Por que `config.ver`, y a quien deja afuera ──
//
// `requireEmpresaPropia()` cerro el cruce entre empresas, pero adentro de la
// empresa seguia abierto: cualquier miembro —un cajero— leia el plan, el estado
// y las fechas de vencimiento. Es el MISMO dato que devuelven
// `GET /api/empresas` y `GET /api/empresas/:id`, que ya piden `config.ver`
// (`:412`, `:424`): tres endpoints sobre la misma informacion no pueden pedir
// cosas distintas.
//
// Quien lo tiene hoy, segun `seedPermissions.js`: **admin** (que es el rol con
// el que `POST /onboarding` crea al dueño, `:120`) y **gerente**. Quedan afuera
// **vendedor**, **produccion** y **compras** —ninguno de los tres tiene por que
// saber cuando vence la suscripcion del cliente—. Un superadmin entra igual:
// sin membresia se le cargan todos los permisos del catalogo (`:334`).
//
// ⚠ **Faltan los otros dos lados.** El item de menu ya declara `config.ver`
// (`web/components/navegacion.js:51`), pero la ruta `/suscripcion` se monta sin
// `RouteGuard` (`web/App.jsx:292`) y el unico llamador
// —`web/pages/SubscriptionSettings.jsx:28`— tiene el `catch { }` vacio, asi que
// este 403 se va a ver como «No hay informacion de suscripcion» en vez de «no
// tenes permiso». Los dos archivos son de la web y quedan pendientes.
router.get('/:id/suscripcion', checkPermission('config.ver'), requireEmpresa, requireEmpresaPropia(), async (req, res) => {
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

// DELETE /puntos-de-venta/:id — desactivar (borrado blando)
//
// 📌 El plan pedía este rechazo en el `PUT`. Va acá porque **acá es donde se
// desactiva**: el `PUT` edita nombre, código y dirección, y no toca `is_active`.
//
// ── Por qué esto vive en el handler y no en la base ──
//
// `catalogos.punto_de_venta_id` tiene `ON DELETE RESTRICT`, así que la base
// impide **borrar** la sucursal. Pero esto no borra: pone `is_active` en false,
// que para Postgres es un UPDATE cualquiera.
//
// Y el efecto es peor que el de un borrado, porque es invisible: el catálogo
// sigue publicado, sigue recibiendo visitas y lee stock de una sucursal dada de
// baja. Nadie se entera hasta que alguien pregunta por qué todo figura agotado.
router.delete('/puntos-de-venta/:id', requireEmpresa, checkPermission('sucursales.eliminar'), async (req, res) => {
  try {
    const pv = await findScoped(PuntoDeVenta, req.params.id, req.empresaId);
    if (!pv) return res.status(404).json({ ok: false, error: 'Punto de venta no encontrado' });

    // El catálogo se nombra. «No se puede desactivar» sin decir por qué obliga a
    // adivinar cuál de los catálogos la está usando.
    const publicados = await Catalogo.findAll({
      where: { empresa_id: req.empresaId, punto_de_venta_id: pv.id, estado: 'publicado' },
      attributes: ['id', 'nombre_visible', 'slug'],
    });

    if (publicados.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'SUCURSAL_EN_USO',
        mensaje: publicados.length === 1
          ? `No se puede desactivar: el catálogo «${publicados[0].nombre_visible}» está publicado y lee su stock de esta sucursal.`
          : `No se puede desactivar: ${publicados.length} catálogos publicados leen su stock de esta sucursal.`,
        catalogos: publicados.map((c) => ({ id: c.id, nombre_visible: c.nombre_visible, slug: c.slug })),
      });
    }

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

    // ── ⚠ Invitar es la OTRA puerta por la que se cambia un rol ──
    //
    // Este `where` miraba si había otra invitación pendiente y nada más: nunca
    // si el email **ya es miembro activo**. Y aceptar una invitación le cambia
    // el rol a un miembro activo (`routes/auth.js`), así que invitar al único
    // administrador con rol `vendedor` es «degradar al único administrador»
    // escrito de otra forma — por este camino no pasaba ninguna de las dos
    // reglas de `utils/equipo.js` que `PUT /usuarios/:id` sí aplica. Invitar,
    // aceptar, y la empresa queda con CERO administradores activos: un request
    // de cada lado, sin carrera, y los dos alcanzables desde la pantalla. De ese
    // estado no se sale desde la aplicación.
    //
    // Acá se corta temprano para que quien invita lo lea ahora, en vez de mandar
    // un enlace que va a fallar. **La garantía está en `accept-invite`**: esta
    // invitación puede crearse hoy con dos admins y aceptarse dentro de un mes
    // con uno solo.
    const rolPedido = role || 'vendedor';

    const yaMiembro = await UsuarioEmpresa.findOne({
      where: { empresa_id: req.empresaId, is_active: true },
      include: [
        { model: Usuario, as: 'usuario', attributes: ['id', 'email'], where: { email }, required: true },
      ],
    });

    if (yaMiembro && rolPedido !== yaMiembro.role) {
      const miembros = await UsuarioEmpresa.findAll({
        where: { empresa_id: req.empresaId },
        attributes: ['id', 'usuario_id', 'role', 'is_active'],
      });

      if (esUltimoAdmin(yaMiembro, miembros)) {
        return res.status(400).json({
          ok: false,
          error: 'ULTIMO_ADMIN',
          message: MOTIVOS.ULTIMO_ADMIN,
        });
      }
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

    // ⚠ El `enlace` viaja SIEMPRE, no solo cuando el mail falla (FR-106).
    //
    // Si viajara solo en el caso de fallo, la pantalla no tendria nada que
    // mostrar cuando el mail salio pero no llegó —spam, dominio mal escrito,
    // buzon lleno—, que es el caso frecuente y el que hoy termina en un llamado.
    // Y se arma con `enlaceDeInvitacion`, la misma funcion que usa el mail: dos
    // copias de la URL derivan, y la que queda mal es justamente la del camino
    // que nadie ejercita hasta que hace falta.
    res.status(201).json({
      ok: true,
      data: invitacion,
      email_enviado: envio.ok,
      enlace: enlaceDeInvitacion(invitacion.token),
      message: envio.ok
        ? undefined
        : 'La invitación se creó pero no se pudo enviar el email. Pasale el enlace de invitación a mano.',
    });
  } catch (err) {
    fallo(req, res, err, 'Error al enviar la invitación');
  }
});

// POST /api/empresas/invitaciones/:token/re-enviar — Re-enviar invitación
//
// ⚠ `requireEmpresa` y el `empresa_id` del `where` NO son de adorno: hasta la
// 014 esta ruta buscaba el token **sin acotar a ninguna empresa**. El token es
// aleatorio de 32 bytes, asi que adivinarlo no es el riesgo; el riesgo es que
// cualquiera con `equipo.invitar` en SU empresa que consiguiera un token de otra
// —de un mail reenviado, de un log, de una captura— podia hacer que Favalio le
// mandara de nuevo la invitacion al invitado de un cliente ajeno, y ademas leia
// el nombre de esa empresa por el `include`. Con el `where` acotado, la
// invitacion de otra empresa da 404, igual que `findScoped`.
//
// ── ⚠ Re-enviar RENUEVA el vencimiento, y por eso existe este endpoint ──
//
// El `where` no filtra por `expires_at` **a propósito**: la fila que la pantalla
// pinta «Vencida» es una `pending` con la fecha pasada —nada pasa `status` a
// `expired`, ni un cron ni nadie— y es exactamente la que alguien quiere volver
// a mandar. Filtrarla daría 404 sobre el único botón que ofrece esa fila, y
// volver a invitar a ese email tampoco sale: `POST /:empresaId/invitar` la ve
// `pending` y responde «Ya hay una invitación pendiente». Sin salida.
//
// Lo que faltaba era renovar. Hasta acá se buscaba la vencida, se mandaba el
// mail **con el enlace muerto** —en producción ese mail sale de verdad— y la
// pantalla decía «Invitación reenviada» sobre una fila que ella misma pintaba
// «Vencida». Quien lo recibía abría el enlace y leía «Esa invitación venció».
//
// La fecha nueva se calcula igual que la del alta —siete días— y se toma del
// `defaultValue` del modelo para que las dos no puedan derivar: son la misma
// regla, no dos.
router.post('/invitaciones/:token/re-enviar', requireEmpresa, checkPermission('equipo.invitar'), async (req, res) => {
  try {
    const invitacion = await Invitacion.findOne({
      where: { token: req.params.token, status: 'pending', empresa_id: req.empresaId },
      include: [{ model: Empresa, as: 'empresa' }],
    });
    if (!invitacion) return res.status(404).json({ ok: false, error: 'Invitación no encontrada o ya expiró' });

    // Se renueva ANTES de mandar: el mail que sale tiene que ser el del enlace
    // que ya sirve. Si el envío después falla, la invitación quedó renovada y
    // el enlace vive — que es la dirección segura, porque el 502 de abajo le
    // dice a quien invitó que lo pase a mano.
    const vencimiento = Invitacion.getAttributes().expires_at.defaultValue;
    await invitacion.update({ expires_at: vencimiento() });

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

// El `include` lleva `attributes` a proposito, y es el mismo molde que
// `GET /:empresaId/invitaciones` usa cincuenta lineas mas arriba para el
// invitador. Sin ellos, Sequelize copia la fila ENTERA de `usuarios`: el
// `auth0_sub` —el identificador del usuario en Auth0— y `es_superadmin` salian
// por el cable a cualquiera con `equipo.ver`. Ninguno de los dos lo usa la
// pantalla, y `es_superadmin` ademas revela quien es operador de la plataforma.
//
// ⚠ `is_active: true` en el `where` se QUITA: la pantalla ahora dibuja la
// columna Estado leyendo `is_active` y necesita ver a los desactivados para
// poder reactivarlos. Filtrarlos aca los hacia invisibles y sin forma de volver.
router.get('/:empresaId/usuarios', requireEmpresa, requireEmpresaPropia('empresaId'), checkPermission('equipo.ver'), async (req, res) => {
  try {
    const users = await UsuarioEmpresa.findAll({
      where: { empresa_id: req.params.empresaId },
      include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'email'] }],
      order: [['id', 'ASC']],
    });

    // ── El último acceso y cuántos dispositivos tiene abiertos, en UNA consulta ──
    //
    // Agregada y no una por miembro: un equipo de veinte tiene que costar dos
    // consultas y no veintiuna. Es el mismo defecto que `_customerStats` tenía en
    // el Panel, y está anclado con `capturarConsultas` en
    // `tests/integracion/sesiones.integracion.test.js`.
    //
    // El `MAX` mira TODAS las sesiones, cerradas incluidas: una sesión que
    // alguien cerró igual registra cuándo esa persona estuvo por última vez, y
    // borrar ese dato al cerrarla haría que echar a alguien también borre la
    // prueba de cuándo entró.
    const idsDeUsuarios = users.map((u) => u.usuario_id).filter(Boolean);

    const resumen = idsDeUsuarios.length
      ? await Sesion.findAll({
          where: { usuario_id: { [Op.in]: idsDeUsuarios } },
          attributes: [
            'usuario_id',
            [sequelize.fn('MAX', sequelize.col('vista_en')), 'ultimo_acceso'],
            [
              sequelize.fn('COUNT', sequelize.literal('CASE WHEN cerrada_en IS NULL THEN 1 END')),
              'abiertas',
            ],
          ],
          group: ['usuario_id'],
          raw: true,
        })
      : [];

    const porUsuario = new Map(resumen.map((f) => [f.usuario_id, f]));

    res.json({
      ok: true,
      data: users.map((u) => {
        const fila = porUsuario.get(u.usuario_id);

        return {
          ...u.toJSON(),
          // ⚠ `null` explícito y no una cadena vacía ni un `0`: quien nunca entró
          // tiene que poder decir «nunca entró», y `fechaCorta('')` dibuja
          // «Invalid Date» (FR-122). La diferencia entre «no entró nunca» y «no
          // sabemos» no existe acá, pero la de «no entró» y «entró el 1/1/1970»
          // sí, y es la que produce un `0` mal tipado.
          ultimo_acceso: fila && fila.ultimo_acceso ? fila.ultimo_acceso : null,
          // `COUNT` vuelve como string desde el driver de Postgres (`int8`):
          // sin el `Number`, la pantalla compararía `'0' > 0` —que es `false`—
          // y `'2' + 1` daría `'21'`.
          sesiones_abiertas: fila ? Number(fila.abiertas) : 0,
        };
      }),
    });
  } catch (err) {
    fallo(req, res, err, 'Error al listar el equipo');
  }
});

// ⚠ `POST /:empresaId/usuarios` se BORRO en la 014 (E11, PENDIENTE N13).
//
// Incorporaba a alguien al equipo por su `auth0_sub` **sin invitacion y sin
// consentimiento**: creaba el `Usuario` si no existia, le armaba la membresia
// con el rol que viniera en el cuerpo —sin validarlo contra el catalogo, con lo
// cual un rol mal escrito creaba un miembro con cero permisos— y lo reactivaba
// si estaba desactivado, que es exactamente la puerta que
// `POST /accept-invite/:token` cerro.
//
// No lo llamaba nadie: ni la pantalla ni `services/api.js`. Si hace falta
// incorporar a alguien sin que le llegue el mail, el camino es el enlace de
// invitacion, que `POST /:empresaId/invitar` devuelve en `enlace` para copiarlo
// a mano.
//
// Se borra y no se restringe: un handler restringido es un `if` que alguien
// puede sacar. `git revert` lo trae de vuelta si hiciera falta.

/**
 * Un rechazo de `utils/equipo.js`, empaquetado para poder abortar la transaccion.
 *
 * La regla del ultimo administrador se evalua ADENTRO de la transaccion que
 * escribe —ver el comentario de `PUT /usuarios/:id`—, y lo unico que hace que
 * una transaccion de Sequelize no commitee es que el callback lance. No es un
 * `ErrorDeNegocio` porque `fallo` le arma un cuerpo distinto (`error` con el
 * texto y sin `message`), y la pantalla lee el codigo en `error`.
 */
class RechazoDeEquipo extends Error {
  constructor(veredicto) {
    super(veredicto.motivo);
    this.name = 'RechazoDeEquipo';
    this.veredicto = veredicto;
  }
}

// UsuarioEmpresa no tiene columna empresa_id sino empresa_id como FK propia:
// se filtra por ella igual. Sin el filtro, este endpoint permitia cambiarle el
// rol o desactivar a cualquier miembro de cualquier empresa cliente.
//
// ── Las dos reglas que hasta la 014 no aplicaba nadie ──
//
// Se podia degradar al UNICO administrador activo de la empresa —y quedarse sin
// nadie que pueda invitar, cambiar roles ni tocar la configuracion, de lo cual
// no se sale desde la aplicacion— y uno podia cambiarse el rol a si mismo.
// Salen de `utils/equipo.js`, que la pantalla ESPEJA para deshabilitar el
// selector con su explicacion: la pantalla explica, el servidor garantiza.
//
// ── Y la tercera, que es de tipo ──
//
// `usuario_empresas.role` es un STRING(20) libre: un rol mal escrito no falla,
// crea un miembro con CERO permisos y nadie se entera hasta que esa persona no
// puede hacer nada. Se valida contra el catalogo y el 400 dice cuales son los
// validos.
router.put('/usuarios/:id', requireEmpresa, checkPermission('equipo.editar'), async (req, res) => {
  try {
    const { role, is_active } = req.body;

    const ue = await UsuarioEmpresa.findOne({
      where: { id: req.params.id, empresa_id: req.empresaId },
      include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'email'] }],
    });
    if (!ue) return res.status(404).json({ ok: false, error: 'Relación no encontrada' });

    if (role !== undefined && !esRolValido(role)) {
      return res.status(400).json({
        ok: false,
        error: 'ROL_INVALIDO',
        message: `El rol «${role}» no existe. Los válidos son: ${ROLES_VALIDOS.join(', ')}.`,
      });
    }

    await sequelize.transaction(async (t) => {
      // ── ⚠ La regla se evalúa ADENTRO de la transacción, y CON lock ──
      //
      // Antes el equipo se leía acá afuera y la escritura pasaba unas líneas más
      // abajo, en otra transacción. Entre las dos hay una ventana, y la ventana
      // se puede ejercitar: una empresa con dos administradores y dos PUT
      // simultáneos —uno por cada admin— leían los dos «hay otro admin», los dos
      // pasaban la regla y la empresa quedaba con CERO administradores activos.
      // Los MISMOS dos requests en secuencia dan 200 y 400, que es lo correcto;
      // a la vez daban 200 y 200. Reproducido contra Postgres.
      //
      // `FOR UPDATE` sobre las filas de la empresa es lo que convierte «leí y
      // después escribí» en una decisión: el segundo espera al commit del
      // primero y vuelve a leer, y ahí ve que ya no queda otro admin. Por eso el
      // `role` y el `is_active` contra los que se compara salen de `actual` —la
      // fila releída bajo el lock— y no de `ue`, que se leyó antes de tomarlo.
      //
      // El `order` no es cosmético: dos transacciones que toman las mismas filas
      // en orden distinto se traban entre sí y una muere por deadlock.
      const miembros = await UsuarioEmpresa.findAll({
        where: { empresa_id: req.empresaId },
        attributes: ['id', 'usuario_id', 'role', 'is_active'],
        order: [['id', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const actual = miembros.find((m) => String(m.id) === String(ue.id)) || ue;

      // Solo dos cambios pueden dejar a la empresa sin administrador: mover el rol
      // y desactivar. Reactivar a alguien, o mandar el mismo rol que ya tiene, no
      // saca a nadie — y bloquearlos haria que la pantalla no pueda deshacer el
      // error que acaba de cometer.
      const cambiaElRol = role !== undefined && role !== actual.role;
      const desactiva = is_active === false && actual.is_active !== false;

      if (cambiaElRol || desactiva) {
        const veredicto = puedeCambiarRol({
          miembro: actual,
          yo: { usuario_id: req.usuario?.id },
          miembros,
        });

        // Lanzar es la única forma de que la transacción no commitee. El `catch`
        // de abajo lo traduce al mismo 400 de siempre, con su código y su motivo.
        if (!veredicto.puede) throw new RechazoDeEquipo(veredicto);
      }

      // El patch se arma campo por campo: `update({ role, is_active })` con el
      // cuerpo tal cual manda `undefined` para lo que no vino, y depender de que
      // Sequelize lo saltee es depender de un detalle de implementacion para no
      // pisar el rol de alguien al desactivarlo.
      const patch = {};
      if (role !== undefined) patch.role = role;
      if (is_active !== undefined) patch.is_active = is_active;

      await ue.update(patch, { transaction: t });

      // PENDIENTE N15: desactivar a alguien y dejarle las invitaciones
      // `pending` vivas es dejar abierta la puerta por la que salio. Un mail de
      // hace tres meses lo devuelve al equipo —y `POST /accept-invite` ya
      // rechaza reactivar a un miembro desactivado (T1350), pero la invitacion
      // seguia figurando como pendiente en la pantalla del equipo—.
      // Va en la MISMA transaccion: si la revocacion falla, la desactivacion no
      // se aplica, y no queda un estado intermedio donde alguien esta afuera
      // con su invitacion todavia buena.
      if (patch.is_active === false && ue.usuario?.email) {
        await Invitacion.update(
          { status: 'revoked' },
          {
            where: { empresa_id: req.empresaId, email: ue.usuario.email, status: 'pending' },
            transaction: t,
          }
        );
      }
    });

    res.json({ ok: true, data: ue });
  } catch (err) {
    // El rechazo de `utils/equipo.js` no es una falla del servidor: es la regla
    // haciendo lo suyo. Se responde con la MISMA forma que antes —`error` con el
    // código y `message` con el motivo— porque la pantalla los lee así.
    if (err instanceof RechazoDeEquipo) {
      return res.status(400).json({
        ok: false,
        error: err.veredicto.codigo,
        message: err.veredicto.motivo,
      });
    }

    fallo(req, res, err, 'Error al actualizar el usuario');
  }
});

module.exports = router;
