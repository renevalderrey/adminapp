// ════════════════════════════════════════════
//  ADMINAPP · Registrar la sesión de este dispositivo, y cortarla si la cerraron
//
//  ⚠ **Esto corre en TODOS los requests.** Es el único cambio del hito 8 que
//  puede dejar la aplicación entera sin funcionar, y por eso se monta con **una
//  sola línea** en `server.js`: sacarla revierte el corte completo sin tocar nada
//  más. La tabla se puede quedar.
//
//  ── Las cinco reglas, en este orden ──
//
//   1. Sin `Authorization` → **sigue sin tocar nada**. El cron de tareas se
//      autentica con `CRON_SECRET`, el webhook de TiendaNube con la firma HMAC
//      del cuerpo crudo, y los 1400 tests de la suite corren con `BYPASS_AUTH` y
//      sin cabecera. Ninguno de los tres tiene por qué enterarse de que esto
//      existe, y esta regla es lo que lo compra.
//   2. Con token y sin `X-Sesion-Id` → `401 SESION_REQUERIDA` (con el período de
//      gracia de más abajo, que es la respuesta a «¿y las sesiones abiertas el
//      día del deploy?»).
//   3. La fila existe y tiene `cerrada_en` → `401 SESION_CERRADA`.
//   4. No existe → se crea, con su user-agent y su IP.
//   5. Existe y está abierta → se refresca `vista_en`, y **solo si pasaron más de
//      cinco minutos** (FR-124): un `UPDATE` por request convertiría cada lectura
//      del sistema en una escritura.
//
//  ── Qué cuesta, y por qué está medido ──
//
//  Un `SELECT` sobre `uq_sesion_dispositivo`. `loadEmpresaContext` ya hace cuatro
//  o cinco, así que es un 20 % más. Está anclado con `capturarConsultas` en
//  `tests/integracion/sesiones.integracion.test.js` porque un 20 % que nadie mide
//  se convierte en un 60 % sin que nadie se entere: alcanza con que alguien
//  agregue un `include` acá.
//
//  ── ⚠ Falla ABIERTO, y es una decisión ──
//
//  Si la consulta falla —la tabla todavía no migrada en el minuto que va entre el
//  deploy del código y el de la migración, un pool agotado, una base que
//  parpadea— se loguea con `logger.error` y el request **sigue**.
//
//  Fallar cerrado significaría que un parpadeo de Postgres devuelve 401 a todo el
//  mundo y la aplicación entera queda sin funcionar por una funcionalidad de
//  comodidad. Lo que se pierde fallando abierto está acotado: durante ese rato,
//  una sesión cerrada podría seguir entrando. Y el corte de verdad —
//  `usuario_empresas.is_active = false`— lo aplica `loadEmpresaContext`, que es
//  otra consulta y otro camino: éste no es el que autentica a nadie.
//
//  ── ⚠ El techo, y va escrito también en la pantalla ──
//
//  Sin la Management API de Auth0 **no se puede revocar un token**. Esto cierra la
//  sesión del cliente que **coopera**: el navegador recibe 401, borra su
//  identificador y sale. Un token usado desde otra herramienta —que puede mandar
//  un `X-Sesion-Id` nuevo en cada request— se puede seguir usando hasta que vence.
//  El botón dice «cerrar sesión en ese dispositivo» y no «revocar el acceso»
//  justamente por esto.
// ════════════════════════════════════════════

const sesionesService = require('../services/sesionesService');
const logger = require('../utils/logger');

/** La cabecera con el UUID que el navegador genera una vez y guarda. */
const CABECERA = 'x-sesion-id';

/**
 * Hasta cuándo se deja pasar un request con token y **sin** `X-Sesion-Id`.
 *
 * ── El problema que resuelve, que el plan no había mirado ──
 *
 * El día del deploy **nadie tiene UUID de dispositivo todavía**. El identificador
 * lo genera `services/api.js`, o sea el **bundle**, y una pestaña abierta sigue
 * corriendo el bundle viejo hasta que alguien la recarga. Con la regla 2 estricta
 * desde el minuto cero, el primer request de cada pestaña abierta del país
 * responde 401 y el interceptor manda al login: **el deploy echa a todos**, y a
 * quien estaba cobrando le vacía el ticket a medio armar.
 *
 * ── Por qué una fecha en el código y no una variable de entorno ──
 *
 * Porque un período de gracia **sin fecha es permanente**. Mientras dure, cerrar
 * una sesión no cierra nada: alcanza con no mandar la cabecera. Una variable de
 * entorno que hay que acordarse de apagar es exactamente la que nadie apaga —y
 * peor, la que no se ve en ningún diff—. Acá la fecha está en el código, se lee
 * en la revisión, vence sola y hay un test de los dos lados.
 *
 * Un mes alcanza de sobra: una pestaña sobrevive días, no semanas, y cualquier
 * recarga —o cualquier despliegue del frontend— trae el bundle que sí manda la
 * cabecera.
 *
 * ── Qué se pierde durante ese mes, dicho en voz alta ──
 *
 * Un cliente que no manda la cabecera entra y **no aparece en la lista de
 * sesiones**, así que tampoco se lo puede cerrar. Es el mismo techo que ya tiene
 * la funcionalidad —quien manda un UUID nuevo en cada request es invisible
 * igual— con fecha de vencimiento. El corte real sigue siendo desactivar al
 * miembro, que funciona desde siempre y no depende de nada de esto.
 */
const GRACIA_HASTA = new Date('2026-09-06T00:00:00.000Z');

/**
 * Qué hacer con un request que trae token y no trae `X-Sesion-Id`.
 *
 * Es una función pura para poder afirmar **los dos lados de la fecha** sin
 * esperar un mes ni tocar el reloj del proceso.
 *
 * @param {number|Date} ahora
 * @returns {'seguir'|'cortar'}
 */
function sinCabecera(ahora = Date.now()) {
  return new Date(ahora).getTime() < GRACIA_HASTA.getTime() ? 'seguir' : 'cortar';
}

async function registrarSesion(req, res, next) {
  // Regla 1. Va primero y es la que hace que este archivo sea invisible para todo
  // lo que no es un navegador con sesión.
  if (!req.headers.authorization) return next();

  // Sin usuario resuelto no hay de quién sea la sesión. Pasa cuando
  // `loadEmpresaContext` no pudo leer la base: ahí ya hay un problema más grande
  // y `requireEmpresa` corta el request unas líneas más adelante.
  if (!req.usuario || !req.usuario.id) return next();

  const dispositivo = String(req.headers[CABECERA] || '').trim();

  if (!dispositivo) {
    if (sinCabecera() === 'seguir') return next();

    return res.status(401).json({
      ok: false,
      error: 'SESION_REQUERIDA',
      message: 'Recargá la página para volver a entrar.',
    });
  }

  // El UUID lo elige el cliente y el servidor no lo interpreta, pero la columna
  // es VARCHAR(64): un valor más largo reventaría el INSERT con un error de la
  // base en el camino de todos los requests. Se recorta y se sigue.
  const identificador = dispositivo.slice(0, 64);

  try {
    const { cerrada } = await sesionesService.registrar({
      usuarioId: req.usuario.id,
      dispositivo: identificador,
      userAgent: req.headers['user-agent'] || null,
      ip: req.ip || null,
    });

    if (cerrada) {
      return res.status(401).json({
        ok: false,
        error: 'SESION_CERRADA',
        message: 'Cerraron la sesión de este dispositivo.',
      });
    }

    return next();
  } catch (err) {
    // Falla abierto: ver la decisión escrita en el encabezado. El `error` y no
    // un `warn` es deliberado —esto no debería pasar nunca— y sin él la única
    // pista sería que «cerrar sesión» dejó de tener efecto y nadie sabe desde
    // cuándo.
    logger.error(
      { err, requestId: req.id, usuarioId: req.usuario.id },
      'sesiones: no se pudo registrar la sesión; el request sigue sin validarla'
    );

    return next();
  }
}

module.exports = registrarSesion;
module.exports.CABECERA = CABECERA;
module.exports.GRACIA_HASTA = GRACIA_HASTA;
module.exports.sinCabecera = sinCabecera;
