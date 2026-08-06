const express = require('express');
const { Invitacion, UsuarioEmpresa, Empresa } = require('../models');
const { Op } = require('sequelize');
const { fallo } = require('../utils/errores');

// ════════════════════════════════════════════
//  Invitaciones · dos routers con exposicion distinta
//
//  ── Que pasaba, exactamente ──
//
//  Este archivo exportaba UN router y `server.js` lo montaba con
//  `app.get('/api/auth/invite/:token', require('./routes/auth'))` y
//  `app.post('/api/auth/accept-invite/:token', ...)`. Un `Router` de Express es
//  un middleware que resuelve la ruta **relativa a su punto de montaje**: con
//  `app.get` el punto de montaje es la URL entera, asi que adentro del router la
//  ruta que se buscaba era `/` y ninguna de las dos declaradas matcheaba. Las
//  dos respondian **404 siempre**. Ni una invitacion se pudo aceptar nunca.
//
//  ── Y por que cambiar `app.get` por `app.use` en el mismo lugar NO alcanzaba ──
//
//  Cuarenta lineas mas arriba `server.js` tiene
//  `app.use('/api', ...authEmpresa, require('./routes/general'))`, y los
//  middlewares de un `app.use('/api', …)` corren para **todo** lo que empiece
//  con `/api`, matchee o no el router de atras. O sea que `checkJwt` y
//  `requireEmpresa` ya habian corrido: el 404 se convertia en un 401 —para quien
//  abre el enlace del mail sin haber entrado nunca— o en un 403 `NO_EMPRESA`
//  —para el invitado, que por definicion todavia no tiene empresa—. Reproducido
//  contra el express instalado (5.2.1).
//
//  Por eso los dos montajes suben **arriba** de esa linea, y por eso el router se
//  parte en dos: el molde exacto es `routes/tiendanube.js`, que ya hace lo mismo
//  desde el hito 7 por el mismo motivo —que la exposicion de cada mitad se vea en
//  `server.js` y no haya que leer este archivo para saberla—.
//
//  ⚠ Lo que sostiene el orden es `src/tests/montajeDeRouters.test.js`, y **es la
//  unica red**: con `BYPASS_AUTH=true`, `server.js` clava `req.empresaId = 1` y
//  `requireEmpresa` no dispara nunca, asi que ningun test de integracion puede
//  distinguir el orden bueno del malo.
// ════════════════════════════════════════════

// ── Lo que se abre sin sesion ──
//
// Quien recibe la invitacion por mail todavia no tiene cuenta: tiene que poder
// ver de que empresa es y con que rol lo invitaron **antes** de registrarse.
const publico = express.Router();

// GET /api/auth/invite/:token — Obtener info de invitación (público, sin auth)
publico.get('/invite/:token', async (req, res) => {
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
    fallo(req, res, err, 'Error al leer la invitación');
  }
});

// ── Lo que pide sesion pero NO empresa ──
//
// `server.js` lo monta detras de `authSinEmpresa`: quien acepta una invitacion
// ya se registro —hace falta saber quien es— pero todavia no tiene fila en
// `usuario_empresas`, que es justo lo que este endpoint crea. Exigirle empresa
// seria pedirle lo que viene a conseguir.
const privado = express.Router();

/**
 * Por que la invitacion se busca SOLO por token, y los motivos se miran despues.
 *
 * Hasta este hito el `where` llevaba las cuatro condiciones juntas —token,
 * `status: 'pending'`, el email del usuario y `expires_at > NOW()`— y cualquiera
 * que fallara producia el mismo 404: «Invitación no encontrada, expirada o el
 * email no coincide». Los cuatro casos se arreglan de maneras distintas y quien
 * leia ese texto no sabia cual era el suyo: pedir otra invitacion, avisar que ya
 * la uso, o salir y entrar con la otra cuenta.
 *
 * Aca se busca por token —que es unico— y cada motivo se contesta por separado
 * (FR-102). No hay fuga: quien manda el token ya tiene la invitacion en la mano,
 * y `GET /invite/:token` ya devuelve el email invitado sin sesion.
 *
 * ⚠ Los codigos HTTP no son decorativos: `apps/web/src/utils/invitacion.js`
 * decide con ellos si **borra o conserva** el token pendiente. 404 y 409 son
 * definitivos —el token se descarta— y cualquier otra cosa (500, red, timeout)
 * lo conserva para reintentar. Un motivo permanente devuelto con un status que
 * no sea de esos dos deja al navegador reintentando para siempre.
 */
function motivoDeRechazo(invitacion, usuario) {
  if (!invitacion) {
    return {
      status: 404,
      error: 'INVITACION_INEXISTENTE',
      message: 'Esa invitación no existe. Pedile a quien te invitó que te mande una nueva.',
    };
  }

  if (invitacion.status === 'accepted') {
    return {
      status: 409,
      error: 'INVITACION_YA_USADA',
      message: 'Esa invitación ya se usó. Si ya sos parte del equipo, entrá normalmente; si no, pedí una nueva.',
    };
  }

  if (invitacion.status === 'revoked') {
    return {
      status: 404,
      error: 'INVITACION_REVOCADA',
      message: 'Esa invitación fue cancelada por la empresa. Pedile a un administrador que te invite de nuevo.',
    };
  }

  if (invitacion.status === 'expired' || invitacion.expires_at <= new Date()) {
    return {
      status: 404,
      error: 'INVITACION_VENCIDA',
      message: 'Esa invitación venció. Pedile a quien te invitó que te la reenvíe.',
    };
  }

  // El email se compara al final para que el mensaje pueda nombrar las dos
  // direcciones: sin eso, quien se registro con otra cuenta lee «no encontrada»
  // y no tiene forma de darse cuenta de que el problema es con cual entro.
  if (invitacion.email !== usuario.email) {
    return {
      status: 404,
      error: 'INVITACION_DE_OTRO_EMAIL',
      message:
        `Esa invitación es para ${invitacion.email} y entraste con ${usuario.email}. ` +
        'Volvé a abrir el enlace entrando con esa cuenta, o pedí que te la manden a esta dirección.',
    };
  }

  return null;
}

// POST /api/auth/accept-invite/:token — Aceptar invitación (usuario autenticado)
privado.post('/accept-invite/:token', async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario) return res.status(401).json({ ok: false, error: 'Debes iniciar sesión para aceptar la invitación' });

    const invitacion = await Invitacion.findOne({ where: { token: req.params.token } });

    const rechazo = motivoDeRechazo(invitacion, usuario);
    if (rechazo) {
      return res.status(rechazo.status).json({
        ok: false,
        error: rechazo.error,
        message: rechazo.message,
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
      // ⚠ Un miembro desactivado NO se reactiva por aceptar una invitacion, y
      // menos con el rol que la invitacion traiga (FR-120, PENDIENTE N15).
      //
      // Aca habia `ue.update({ is_active: true, role: invitacion.role, … })`, y
      // nada invalida las invitaciones `pending` al desactivar a alguien: un mail
      // de hace tres meses le devolvia el acceso —a veces con MAS rol que el que
      // tenia— a una persona a la que se desactivo a proposito. Desactivar es una
      // decision de la empresa y solo la empresa la puede deshacer.
      //
      // La invitacion no se consume: no paso nada, y si manana lo reactivan, el
      // mismo enlace tiene que seguir sirviendo.
      if (ue.is_active === false) {
        return res.status(409).json({
          ok: false,
          error: 'MIEMBRO_DESACTIVADO',
          message:
            'Tu acceso a esta empresa está desactivado. Pedile a un administrador que te ' +
            'vuelva a activar: aceptar la invitación no lo reactiva.',
        });
      }

      // Miembro activo: es una invitacion nueva de un administrador, con el rol
      // que decidio ahora. Ese si se aplica.
      await ue.update({ role: invitacion.role, accepted_at: new Date() });
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
    fallo(req, res, err, 'Error al aceptar la invitación');
  }
});

module.exports = { publico, privado };
