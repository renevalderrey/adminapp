const logger = require('./logger');
const { reportarError } = require('../config/sentry');

// ════════════════════════════════════════════
//  Respuesta 500
//
//  La auditoria de operabilidad encontro 65 bloques catch con esta forma:
//
//      } catch (err) {
//        res.status(500).json({ ok: false, error: err.message });
//      }
//
//  Dos problemas en dos lineas:
//
//   1. No se loguea NADA. El error se convierte en una respuesta HTTP y
//      desaparece. Incluia crear y anular venta: si fallaban, no quedaba
//      rastro de por que.
//   2. `err.message` va al cliente. Un error de Sequelize trae nombres de
//      tabla, de columna y de constraint; uno de AFIP puede traer el detalle
//      del certificado. Es informacion de la estructura interna que no aporta
//      nada al usuario y si le sirve a quien busca donde apretar.
//
//  `fallo` resuelve las dos: loguea con el contexto completo del request y
//  devuelve un mensaje en castellano, entendible, con el id para rastrearlo.
// ════════════════════════════════════════════

/**
 * Error que SI se le puede mostrar al usuario.
 *
 * Hace falta distinguirlo porque hay errores que se lanzan a proposito y cuyo
 * texto es la respuesta util: "Stock insuficiente en Deposito para Harina
 * (disponible: 2, requerido: 5)". Taparlo con un "Error interno del servidor"
 * generico deja al usuario sin saber que corregir.
 *
 * La regla es simple: si el mensaje lo escribio alguien pensando en quien lo
 * va a leer, es un ErrorDeNegocio. Si lo escribio Postgres, no.
 */
class ErrorDeNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = 'ErrorDeNegocio';
    this.status = status;
    this.publico = true;
  }
}

/**
 * Loguea un error de servidor y responde 500.
 *
 * Si el error es un ErrorDeNegocio, responde con SU status y SU mensaje: no es
 * una falla del servidor sino una condicion prevista, y se registra como aviso
 * en vez de como error para no ensuciar las alertas.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Error}  err      El error atrapado. Va al log, nunca al cliente.
 * @param {string} mensaje  Que estaba intentando hacer el usuario, en
 *                          castellano. Es lo unico que ve.
 */
function fallo(req, res, err, mensaje = 'Error interno del servidor') {
  if (err && err.publico) {
    logger.warn(
      { requestId: req.id, ruta: req.originalUrl, motivo: err.message },
      mensaje
    );

    if (res.headersSent) return;

    return res.status(err.status || 400).json({
      ok: false,
      error: err.message,
      requestId: req.id,
    });
  }

  const contexto = {
    requestId: req.id,
    ruta: req.originalUrl,
    metodo: req.method,
    empresaId: req.empresaId,
    usuario: req.userId,
  };

  logger.error({ err, ...contexto }, mensaje);

  // Un ErrorDeNegocio no llega hasta aca, asi que todo lo que se reporta es
  // un fallo real del servidor.
  reportarError(err, contexto);

  // Puede pasar que la respuesta ya se haya empezado a enviar (por ejemplo si
  // el error ocurre despues de un res.write). Volver a escribir tira
  // ERR_HTTP_HEADERS_SENT y tumba el handler.
  if (res.headersSent) return;

  res.status(500).json({
    ok: false,
    error: mensaje,
    // El id que el usuario nos pasa cuando reporta el problema.
    requestId: req.id,
  });
}

module.exports = { fallo, ErrorDeNegocio };
