const { auth } = require('express-oauth2-jwt-bearer');
const { Usuario, UsuarioEmpresa, Empresa, PuntoDeVenta, Rol, RolPermiso, UsuarioPermiso, Permiso } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { esErrorDeEsquema } = require('../utils/errores');
const { reportarError } = require('../config/sentry');
require('dotenv').config();

// Se reporta a Sentry una sola vez por proceso: ver el catch de permisos.
let yaSeReportoElFalloDePermisos = false;

// `auth()` valida su configuracion al construirse, no al primer request: sin
// AUTH0_AUDIENCE tira «An 'audience' is required to validate the 'aud' claim» y
// mata el proceso apenas se importa este archivo.
//
// Eso es lo que se quiere en produccion —una API que arranca sin poder validar
// tokens es peor que una que no arranca—, y por eso el constructor sigue siendo
// ansioso. Pero rompia una promesa que hace `server.js:28`: ahi la validacion de
// AUTH0_DOMAIN y AUTH0_AUDIENCE se saltea cuando BYPASS_AUTH esta activo, o sea
// que el servidor declara que con bypass esas variables no hacen falta. Este
// archivo las exigia igual, un nivel mas abajo y con un mensaje que no nombra
// ni a Auth0 ni al bypass.
//
// La primera vez que mordio fue en `server.test.js`, que se arreglo poniendo
// valores de mentira en `tests/setup.js`. La segunda fue el job de pruebas de
// navegador, que levanta la API con BYPASS_AUTH y sin .env: noventa segundos de
// espera y un ERR_ASSERTION. Dos sintomas del mismo hueco, arreglados por
// separado en el borde en vez de en el medio.
//
// Con bypass, `server.js:264` ni siquiera usa `checkJwt`: la cadena es otra. No
// construirlo no saltea ninguna verificacion, porque nadie lo iba a llamar.
//
// Y el reemplazo NIEGA en vez de dejar pasar, justamente porque nadie lo iba a
// llamar: si algun dia alguien lo mete en una cadena que corre con bypass, un
// `next()` autenticaria a cualquiera en silencio. Fallar ahi es ruidoso y no
// cuesta nada, porque hoy ese camino no existe.
const checkJwt = process.env.BYPASS_AUTH === 'true'
  ? (req, res, next) => {
      logger.error('checkJwt fue invocado con BYPASS_AUTH activo: la cadena de autenticacion esta mal armada.');
      return res.status(500).json({ error: 'CONFIG_ERROR', message: 'Error de configuracion del servidor' });
    }
  : auth({
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

// Cuanto se espera a Auth0 antes de seguir sin el perfil.
//
// Esta llamada esta en el camino de TODOS los requests que llegan con un token
// sin name o sin email. fetch() no tiene timeout por defecto: si Auth0 se
// pone lento o deja de responder, cada request de la aplicacion se queda
// colgado esperando —no falla, se cuelga— hasta el timeout del cliente. Con el
// pool de conexiones y los workers ocupados, un problema de Auth0 se convierte
// en una caida total de Favalio.
//
// 3 segundos es holgado para una llamada que normalmente tarda decenas de
// milisegundos, y es un limite duro para el peor caso. El perfil es opcional:
// si no llega, el usuario se crea con lo que tenga el token.
const TIMEOUT_USERINFO_MS = 3000;

async function enrichUserFromAuth0(req) {
  if (req.userName && req.userEmail) return;

  const authHeader = req.headers.authorization;
  if (!authHeader) return;

  try {
    const token = authHeader.replace('Bearer ', '');
    const domain = process.env.AUTH0_DOMAIN;
    const res = await fetch(`https://${domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_USERINFO_MS),
    });
    if (!res.ok) return;
    const profile = await res.json();
    if (!req.userName) req.userName = profile.name || profile.nickname || null;
    if (!req.userEmail) req.userEmail = profile.email || null;
  } catch (err) {
    // El perfil es opcional: se sigue con lo que traiga el token. Pero se
    // registra, porque si Auth0 empieza a tardar esto es lo primero que lo
    // muestra. Antes el catch estaba vacio y no quedaba ni rastro.
    logger.warn(
      { err, requestId: req.id, userId: req.userId },
      err?.name === 'TimeoutError'
        ? 'Auth0 /userinfo no respondio a tiempo'
        : 'Auth0 /userinfo fallo'
    );
  }
}

const loadEmpresaContext = async (req, res, next) => {
  try {
    if (!req.userId) return next();

    await enrichUserFromAuth0(req);

    // ⚠ `findOrCreate` y NO `findOne` + `create`.
    //
    // Este es el PRIMER ingreso de alguien nuevo, y el navegador no manda un
    // pedido: manda varios juntos —el contexto de la empresa, los permisos, la
    // suscripcion—. Con los dos pasos separados, dos de esos pedidos hacen los
    // dos el `findOne`, los dos no encuentran nada, y los dos crean: el segundo
    // choca con el UNIQUE de `auth0_sub` y este middleware responde **500**.
    //
    // O sea: la aplicacion no abre, y el momento en que pasa es el unico que no
    // se puede reintentar sin que la persona piense que el sistema no anda.
    //
    // Se encontro buscando el molde que ya habia roto `taxService.getConfig`:
    // un `findOne` seguido de un `create` bajo un `if (!...)`. De los cuatro
    // lugares que tenian esa forma, este y aquel eran carreras de verdad.
    const [usuario, creado] = await Usuario.findOrCreate({
      where: { auth0_sub: req.userId },
      defaults: {
        auth0_sub: req.userId,
        email: req.userEmail || `user@${req.userId?.split('|')[1] || 'unknown'}.placeholder`,
        nombre: req.userName || req.userId,
      },
    });

    if (!creado) {
      const updates = {};
      if (req.userEmail && req.userEmail !== usuario.email) updates.email = req.userEmail;
      if (req.userName && req.userName !== usuario.nombre) updates.nombre = req.userName;
      if (!usuario.nombre && !updates.nombre) updates.nombre = req.userId;
      if (!usuario.email && !updates.email) updates.email = `user@${req.userId?.split('|')[1] || 'unknown'}.placeholder`;
      if (Object.keys(updates).length) await usuario.update(updates);
    }

    req.usuario = usuario;

    // ── Seleccion de empresa activa ──
    // El frontend manda X-Empresa-Id para cambiar de empresa. Antes se
    // ignoraba por completo y siempre se usaba la empresa por defecto, con lo
    // cual el selector de empresa no tenia efecto del lado del servidor.
    //
    // El header se toma como una PREFERENCIA, nunca como una autorizacion: la
    // busqueda filtra por usuario_id, asi que pedir una empresa ajena no
    // devuelve nada y se cae al comportamiento por defecto.
    const empresaHeader = parseInt(req.headers['x-empresa-id'], 10);

    let ue = null;

    if (Number.isInteger(empresaHeader)) {
      ue = await UsuarioEmpresa.findOne({
        where: { usuario_id: usuario.id, empresa_id: empresaHeader, is_active: true },
        include: [{ model: Empresa, as: 'empresa' }],
      });

      // ── Operador de la plataforma ──
      //
      // Quien desarrolla y da soporte tiene que poder entrar a la empresa de
      // cualquier cliente sin ser miembro de ella. Es lo UNICO que se ensancha:
      // que empresa se puede seleccionar.
      //
      // Lo que NO cambia: a partir de aca todo el sistema sigue trabajando con
      // req.empresaId, una empresa por vez, y cada consulta sigue filtrando por
      // ella. No hay ninguna consulta que cruce empresas.
      //
      // Se arma un contexto equivalente al de una membresia, sin fila en
      // usuario_empresas: por eso el superadmin no aparece en la pantalla de
      // Equipo del cliente.
      if (!ue && usuario.es_superadmin) {
        const empresa = await Empresa.findByPk(empresaHeader);

        if (empresa) {
          ue = {
            empresa_id: empresa.id,
            empresa,
            role: 'admin',
            rol_id: null,
            id: null,
          };

          req.esSuperadminEnEmpresaAjena = true;

          // Queda el rastro de que un operador entro a datos de un cliente.
          // Con el requestId que ya existe se puede reconstruir todo lo que
          // toco en esa sesion.
          logger.info(
            {
              requestId: req.id,
              superadmin: true,
              usuario: req.userId,
              empresaId: empresa.id,
              ruta: req.originalUrl,
            },
            'Superadmin operando sobre una empresa ajena'
          );
        }
      }

      if (!ue) {
        logger.warn(
          { userId: req.userId, empresaSolicitada: empresaHeader },
          'X-Empresa-Id pedido sin membresia activa; se usa la empresa por defecto'
        );
      }
    }

    if (!ue) {
      ue = await UsuarioEmpresa.findOne({
        where: { usuario_id: usuario.id, is_active: true },
        include: [{ model: Empresa, as: 'empresa' }],
        order: [['is_default', 'DESC']],
      });
    }

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

        // El contexto sintetico de un superadmin en una empresa ajena no tiene
        // rol ni fila de membresia: sin esto se quedaria con cero permisos y
        // checkPermission le cortaria todo, que es lo contrario de lo que
        // significa ser operador de la plataforma.
        //
        // Se cargan los permisos REALES del catalogo en vez de saltear
        // checkPermission: asi el chequeo sigue siendo uno solo para todos, y
        // el frontend recibe la lista por el mismo camino que cualquier
        // usuario.
        if (req.esSuperadminEnEmpresaAjena) {
          const todos = await Permiso.findAll({ attributes: ['codigo'] });
          for (const p of todos) permisos.add(p.codigo);
        }

        if (ue.rol_id) {
          const rp = await RolPermiso.findAll({
            where: { rol_id: ue.rol_id },
            attributes: ['permiso_codigo'],
          });
          for (const p of rp) {
            permisos.add(p.permiso_codigo);
          }
        }

        // Sin membresia no hay overrides que buscar, y consultar con
        // usuario_empresa_id null trae basura.
        const overrides = ue.id
          ? await UsuarioPermiso.findAll({
              where: { usuario_empresa_id: ue.id },
              attributes: ['permiso_codigo', 'granted'],
            })
          : [];
        for (const o of overrides) {
          if (o.granted) {
            permisos.add(o.permiso_codigo);
          } else {
            permisos.delete(o.permiso_codigo);
          }
        }

        req.usuarioPermisos = [...permisos];
      } catch (permErr) {
        // ── Falla cerrado, pero ahora se nota ──
        //
        // Quedarse con la lista vacia es lo correcto y no se toca: ante la duda
        // sobre que puede hacer alguien, la respuesta es "nada". Lo que estaba
        // mal era el aviso.
        //
        // Esto era un `logger.warn` que decia "defaulting to empty". Cuando
        // faltaban las tablas de permisos, ese warn se repetia en CADA request
        // y describia el sintoma —la lista quedo vacia— sin nombrar la causa ni
        // su gravedad: la aplicacion deja entrar y despues no funciona ninguna
        // accion, para nadie.
        //
        // Sube a `error` y separa el caso de esquema, que no es transitorio.
        req.usuarioPermisos = [];

        if (esErrorDeEsquema(permErr)) {
          logger.error(
            { err: permErr, userId: req.userId, empresaId: req.empresaId },
            'No se pudieron leer los permisos porque el esquema no tiene las tablas. ' +
            'Este usuario queda sin NINGUN permiso: va a poder entrar y no va a poder ' +
            'hacer nada. Faltan migraciones.'
          );
        } else {
          logger.error(
            { err: permErr, userId: req.userId, empresaId: req.empresaId },
            'No se pudieron leer los permisos; el usuario queda sin ninguno'
          );
        }

        // Sentry, una sola vez por proceso.
        //
        // Esto corre en el camino de todos los requests: reportar cada uno
        // convertiria un problema en miles de eventos identicos y haria que
        // Sentry descarte el resto por cuota. Con uno alcanza para enterarse, y
        // el log tiene todas las repeticiones si hace falta contarlas.
        if (!yaSeReportoElFalloDePermisos) {
          yaSeReportoElFalloDePermisos = true;
          reportarError(permErr, {
            requestId: req.id,
            ruta: req.originalUrl,
            usuario: req.userId,
            empresaId: req.empresaId,
          });
        }
      }
    }

    // ── Punto de venta activo ──
    // Antes se hacia req.puntoDeVentaId = parseInt(header) sin ninguna
    // validacion. Ese valor se escribe en ventas, movimientos de caja y
    // ordenes de produccion, y se usa como filtro de lectura: un usuario podia
    // mandar el id de un punto de venta de otra empresa y operar sobre el.
    // Ahora se verifica que pertenezca a la empresa activa.
    const pvHeader = parseInt(req.headers['x-punto-de-venta-id'], 10);

    if (Number.isInteger(pvHeader) && req.empresaId) {
      const pv = await PuntoDeVenta.findOne({
        where: { id: pvHeader, empresa_id: req.empresaId, is_active: true },
        attributes: ['id'],
      });

      if (pv) {
        req.puntoDeVentaId = pv.id;
      } else {
        logger.warn(
          { userId: req.userId, empresaId: req.empresaId, pvSolicitado: pvHeader },
          'X-Punto-De-Venta-Id no pertenece a la empresa activa; se ignora'
        );
      }
    }

    next();
  } catch (err) {
    // No se llama next(err): el contexto es opcional para las rutas publicas.
    // Lo que si importa es que req.empresaId quede sin definir, para que
    // requireEmpresa corte los endpoints que necesitan una empresa en vez de
    // dejarlos operar sobre una empresa arbitraria.
    logger.error({ err, userId: req.userId }, 'Error loading empresa context');
    next();
  }
};

/**
 * Corta el request si no hay empresa activa en el contexto.
 *
 * loadEmpresaContext no falla el request cuando no puede resolver la empresa
 * (usuario sin membresia, error de base). Sin este guard, las rutas caian en
 * el patron `req.empresaId || 1` y terminaban leyendo y escribiendo sobre la
 * empresa 1 — que en produccion es un cliente real.
 *
 * Va despues de loadEmpresaContext y antes de las rutas que necesitan tenant.
 */
const requireEmpresa = (req, res, next) => {
  if (!req.empresaId) {
    logger.warn(
      { userId: req.userId, path: req.originalUrl },
      'Request sin empresa activa en el contexto'
    );
    return res.status(403).json({
      ok: false,
      error: 'NO_EMPRESA',
      message: 'No tenés una empresa activa. Completá el onboarding o pedí acceso a una empresa.',
    });
  }
  next();
};

module.exports = { checkJwt, extractUser, loadEmpresaContext, requireEmpresa };
