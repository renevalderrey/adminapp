const { Suscripcion } = require('../models');
const logger = require('../utils/logger');
const { evaluarSuscripcion, ESTADOS_CONOCIDOS } = require('../utils/estadoDeSuscripcion');

// ── Lo que no pasa por el paywall ──
//
// TiendaNube estaba con el prefijo entero y eso eximia tambien a las once
// rutas privadas de la integracion: una empresa con la suscripcion vencida
// seguia mapeando productos y sincronizando su stock con la tienda online.
// Es la misma forma del paywall eludible que CONVENCIONES.md cita entre los
// tres errores mas caros del proyecto — la puerta no estaba abierta, estaba en
// otra pared. Ahora se nombran los dos caminos exactos.
//
// isExempt compara con startsWith sobre req.originalUrl, asi que el callback
// que vuelve con ?code=…&state=… sigue entrando.
//
// ⚠ Esas dos lineas de TiendaNube son defensivas y NINGUN test las ejercita, a
// proposito. /callback y /webhook viven en el router `publico`, que server.js
// monta SIN la cadena authEmpresa —o sea, sin este middleware—, y Express
// atiende con el primer montaje que matchee: no llegan hasta aca nunca. Un
// test que afirmara «el webhook funciona con la suscripcion vencida» pasaria
// igual con esta lista vacia, no probaria nada, y seria uno mas de los veinte
// que este repositorio ya junto. Lo que si esta probado es lo contrario —que
// las once privadas queden cortadas— en tests/paywallDeTiendanube.test.js,
// junto con la guardia que fija que el montaje del router publico siga sin
// authEmpresa, que es de donde sale de verdad la exencion.
//
// Se dejan igual porque no cuestan nada y porque el dia que ese montaje se
// mueva, un 402 repetido hace que TiendaNube deshabilite el webhook del lado
// de ellos y la integracion se apague sola.
const EXEMPT_PREFIXES = [
  '/api/empresas',
  '/api/auth',
  '/api/ping',
  '/api/tiendanube/callback',
  '/api/tiendanube/webhook',
];

function isExempt(path) {
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function checkSubscription(req, res, next) {
  if (isExempt(req.originalUrl)) {
    return next();
  }

  if (!req.empresaId) {
    return next();
  }

  try {
    const sub = await Suscripcion.findOne({
      where: { empresa_id: req.empresaId },
      attributes: ['id', 'status', 'trial_ends_at', 'grace_period_ends'],
    });

    // Una empresa sin fila de suscripcion daba acceso ilimitado y gratis.
    // No es un estado transitorio: es un agujero permanente. Toda empresa se
    // crea con suscripcion en el onboarding, asi que si falta es un dato
    // inconsistente y hay que bloquear, no dejar pasar.
    if (!sub) {
      logger.error(
        { empresaId: req.empresaId },
        'Empresa sin fila de suscripcion: se bloquea el acceso'
      );
      return res.status(402).json({
        ok: false,
        error: 'SIN_SUSCRIPCION',
        message: 'No encontramos la suscripción de tu empresa. Escribinos para regularizarla.',
      });
    }

    // La lista de los cinco estados NO esta aca: vive en
    // `utils/estadoDeSuscripcion.js` y es la misma que mira el catalogo
    // publico (FR-110). Este middleware sigue decidiendo lo mismo que antes
    // —los mismos 402 con los mismos mensajes—, pero ya no es el dueño de la
    // regla.
    const { bloqueado, motivo } = evaluarSuscripcion(sub, new Date());

    // El log del estado fuera del enum se queda de este lado y no adentro de
    // la funcion pura: el contexto que sirve para investigarlo es distinto en
    // cada camino —aca la empresa de la sesion, en el publico el slug y la
    // empresa (FR-112a)—. La condicion se compara contra `ESTADOS_CONOCIDOS`,
    // que sale del mismo archivo que el `switch`: no es una segunda lista.
    if (!ESTADOS_CONOCIDOS.includes(sub.status)) {
      logger.error({ empresaId: req.empresaId, status: sub.status }, 'Estado de suscripcion desconocido');
    }

    if (bloqueado) {
      return res.status(402).json({
        ok: false,
        error: 'SUBSCRIPTION_EXPIRED',
        message: `${motivo} Tus datos siguen guardados. Escribinos para reactivar la cuenta.`,
        status_suscripcion: sub.status,
      });
    }

    next();
  } catch (err) {
    // ── ⚠ Este catch DEJA PASAR, y el camino publico hace lo contrario ──
    //
    // No es un descuido ni una inconsistencia pendiente de unificar: es la
    // asimetria deliberada de FR-112a, y las dos mitades estan escritas, cada
    // una nombrando a la otra (la gemela esta en el encabezado de
    // `utils/estadoDeSuscripcion.js`).
    //
    //  · Aca, cadena privada: se loguea y se llama a `next()`. Del otro lado
    //    del middleware hay un comercio que ya pago, con la sesion iniciada y
    //    un cliente esperando en el mostrador. Un hipo de la base no puede
    //    tumbarle la caja.
    //
    //  · `routes/catalogoPublico.js`, camino publico: **cierra con 503**. Es
    //    una superficie sin login, y dejar pasar ahi significa vender en
    //    nombre de una empresa que quiza esta vencida. Responde **503 y no
    //    402** porque el 402 afirmaria que la suscripcion vencio, y lo que
    //    paso es que no se pudo saber.
    //
    // Lo que si comparten los dos caminos es la lista de estados, arriba.
    logger.error({ err, empresaId: req.empresaId }, 'Error checking subscription');
    next();
  }
}

module.exports = checkSubscription;
