const crypto = require('crypto');
const { Op } = require('sequelize');
const { Setting, Sale } = require('../models');
const afipAuth = require('./afipAuth');
const afipService = require('./afipService');
const { ErrorDeNegocio } = require('../utils/errores');
const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  AFIP · verificar el circuito SIN emitir nada, y guardar la evidencia
//
//  ── Por qué existe ──
//
//  El circuito de facturación **nunca se probó** (`AUDITORIA-AFIP.md:223-233`,
//  `PROXIMOS-PROYECTOS.md:124`). Sin algo así, el primer comprobante fiscal real
//  de un cliente sería también la primera prueba del circuito: si algo está mal
//  —la delegación del servicio, el punto de venta, la pareja cert-clave— se
//  descubre con alguien esperando su factura del otro lado del mostrador.
//
//  ── Qué se ejecuta, y por qué esos dos pasos y no otros ──
//
//  1. `afipAuth.getAccessTicket` → WSAA. Prueba el certificado, la clave privada
//     y que el servicio de facturación esté delegado al alias del certificado.
//     Es lo que falla cuando alguien saltea el paso 3 de la guía.
//  2. `afipService.getLastVoucher(pv, 6)` → `FECompUltimoAutorizado`. Prueba que
//     **el punto de venta exista y sea de Web Services**, que es la otra mitad de
//     las llamadas «no puedo facturar». El ticket solo no la contesta.
//
//  Ninguno de los dos consume numeración ni emite un comprobante. Emitir un CAE
//  de prueba —la otra opción que se evaluó— consumiría numeración correlativa y
//  exigiría un endpoint que emita, que es justo la superficie que el corte 3
//  borró (`POST /api/afip/invoice`).
//
//  ── Por qué la evidencia la escribe el servidor ──
//
//  `afip_verificacion` está en `SETTINGS_DE_SOLO_LECTURA`
//  (`utils/settingsSecretos.js`), así que `PUT /api/settings/:key` **no la puede
//  escribir**. La única mano que la escribe es esta, después de que AFIP
//  contestó. Un paso de checklist que el cliente puede marcar solo no es un paso
//  de checklist, y este paso bloquea el pase a producción.
//
//  ── Y se guarda también cuando falla ──
//
//  «Probé y no anduvo» es un estado del checklist, no la ausencia de uno. Si solo
//  se guardara el `ok`, la pantalla no podría distinguir «nunca lo intentaste» de
//  «lo intentaste y AFIP rechazó el punto de venta», que piden acciones
//  distintas.
// ════════════════════════════════════════════

/** La clave de `settings` donde vive la evidencia. Una fila por empresa. */
const CLAVE_EVIDENCIA = 'afip_verificacion';

/**
 * El tipo de comprobante con el que se pregunta el último autorizado.
 *
 * 6 es Factura B. La consulta `FECompUltimoAutorizado` **no emite**: devuelve el
 * número del último comprobante que AFIP autorizó para ese punto de venta y ese
 * tipo, y devuelve `0` cuando no hay ninguno — que es el caso normal de una
 * empresa que todavía no facturó, y es una respuesta válida, no un error.
 */
const TIPO_PARA_CONSULTAR = 6;

/** Los dos pasos, con el nombre que sale en la evidencia y en el mensaje. */
const PASO_TICKET = 'ticket_wsaa';
const PASO_PUNTO_DE_VENTA = 'punto_de_venta';

/**
 * La huella del **certificado**, que es público.
 *
 * ⚠ Nunca de la clave privada. La huella se guarda en `settings`, y `settings`
 * sale por `GET /api/settings` para todo el que tenga `config.ver`: un hash de
 * la clave privada ahí sería material derivado de la clave viajando por el mismo
 * cable que este hito viene de cerrar.
 *
 * Sirve para decir «esto se verificó con OTRO certificado» cuando alguien cambia
 * el material fiscal. **No bloquea**: el pase a producción implica cambiar el
 * certificado, así que invalidar la evidencia al cambiarlo dejaría el paso 4
 * imposible de cumplir justo cuando hace falta.
 */
function huellaDelCertificado(pem) {
  if (!pem) return null;

  return 'sha256:' + crypto.createHash('sha256').update(String(pem)).digest('hex');
}

/** El valor de una clave de configuración de esta empresa, o `null`. */
async function valorDe(clave, empresaId) {
  const fila = await Setting.findOne({ where: { key: clave, empresa_id: empresaId } });
  return fila && fila.value !== undefined ? fila.value : null;
}

/** La evidencia guardada de esta empresa, o `null` si nunca se verificó. */
async function leerEvidencia(empresaId) {
  const guardada = await valorDe(CLAVE_EVIDENCIA, empresaId);

  // El JSONB puede volver como objeto (lo normal) o como texto si alguien la
  // escribió a mano en la base. Se acepta el texto para no romper la pantalla,
  // pero no se inventa nada: lo que no parsea vale como «no hay evidencia».
  if (typeof guardada === 'string') {
    try {
      return JSON.parse(guardada);
    } catch {
      return null;
    }
  }

  return guardada && typeof guardada === 'object' ? guardada : null;
}

/** Escribe la evidencia. Es el único lugar del repositorio que la escribe. */
async function guardarEvidencia(empresaId, evidencia) {
  await Setting.upsert({ key: CLAVE_EVIDENCIA, empresa_id: empresaId, value: evidencia });
  return evidencia;
}

/** Solo los dígitos, que es como se compara un CUIT venga como venga. */
function soloDigitos(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/\D/g, '');
}

/**
 * Ejecuta la verificación contra AFIP y deja la evidencia escrita.
 *
 * @param {number} empresaId
 * @param {number|string|null} [usuarioId] Quién la pidió. Va a la evidencia.
 * @returns {Promise<object>} La evidencia con `resultado: 'ok'`.
 * @throws {ErrorDeNegocio} Con el mensaje que dice **cuál de los dos pasos**
 *   falló. La evidencia ya quedó guardada con `resultado: 'error'`.
 */
async function verificarCircuito(empresaId, usuarioId = null) {
  const [cuit, pv, cert] = await Promise.all([
    valorDe('afip_cuit', empresaId),
    valorDe('afip_pv', empresaId),
    valorDe('afip_cert', empresaId),
  ]);

  // Estas tres no son fallas de AFIP sino configuración que falta, así que no
  // generan evidencia: no hubo circuito que ejercitar. La pantalla ya las
  // muestra como pasos pendientes del checklist; el mensaje repite cuál.
  if (!soloDigitos(cuit)) {
    throw new ErrorDeNegocio('Cargá el CUIT antes de verificar el circuito.');
  }
  if (!String(pv || '').trim()) {
    throw new ErrorDeNegocio('Cargá el punto de venta antes de verificar el circuito.');
  }
  if (!cert) {
    throw new ErrorDeNegocio(
      'Subí el certificado y la clave privada antes de verificar el circuito.'
    );
  }

  // El ambiente se lee por `afipAuth.isProduction`, que es el mismo que decide
  // contra qué servidor de AFIP se autentica: si se leyera la clave por separado
  // la evidencia podría decir un ambiente y la llamada haber ido al otro.
  const enProduccion = await afipAuth.isProduction(empresaId);

  const base = {
    verificado_en: new Date().toISOString(),
    ambiente: enProduccion ? 'production' : 'homologation',
    cuit: soloDigitos(cuit),
    pv: Number(pv),
    certificado: huellaDelCertificado(cert),
    usuario_id: usuarioId === undefined ? null : usuarioId,
  };

  // ── Paso 1: el ticket de acceso ──
  try {
    await afipAuth.getAccessTicket(empresaId);
  } catch (err) {
    logger.warn({ empresaId, err: err.message }, 'afip: la verificación falló en el WSAA');

    await guardarEvidencia(empresaId, {
      ...base,
      resultado: 'error',
      paso: PASO_TICKET,
      detalle: String(err.message || err).slice(0, 500),
    });

    throw new ErrorDeNegocio(
      'AFIP no aceptó el certificado: no se pudo obtener el ticket de acceso (WSAA). ' +
      'Revisá que el certificado y la clave sean el par que bajaste de ARCA y que el ' +
      'servicio «Facturación Electrónica» esté delegado a ese alias. ' +
      `Respuesta de AFIP: ${err.message}`
    );
  }

  // ── Paso 2: el punto de venta ──
  //
  // Va después y aparte a propósito: el mensaje tiene que decir cuál de los dos
  // falló. Un solo «no se pudo conectar con AFIP» manda a revisar el certificado
  // cuando lo que falta es declarar el punto de venta en ARCA, que es un trámite
  // distinto y en otra pantalla del sitio de AFIP.
  let ultimo;
  try {
    ultimo = await afipService.getLastVoucher(base.pv, TIPO_PARA_CONSULTAR, empresaId);
  } catch (err) {
    logger.warn({ empresaId, pv: base.pv, err: err.message }, 'afip: la verificación falló en el punto de venta');

    await guardarEvidencia(empresaId, {
      ...base,
      resultado: 'error',
      paso: PASO_PUNTO_DE_VENTA,
      detalle: String(err.message || err).slice(0, 500),
    });

    throw new ErrorDeNegocio(
      `El certificado funciona, pero AFIP rechazó el punto de venta ${base.pv}. ` +
      'Declaralo en ARCA como «Factura Electrónica - Web Services» y verificá de nuevo. ' +
      `Respuesta de AFIP: ${err.message}`
    );
  }

  logger.info({ empresaId, pv: base.pv, ambiente: base.ambiente }, 'afip: circuito verificado');

  return guardarEvidencia(empresaId, {
    ...base,
    resultado: 'ok',
    paso: null,
    // `0` es una respuesta válida y es la de una empresa que todavía no facturó.
    // `Number(...)` y no `|| 0`: el cero tiene que sobrevivir.
    ultimo_comprobante: Number.isFinite(Number(ultimo)) ? Number(ultimo) : null,
  });
}

/**
 * Si el paso 4 del checklist —«circuito verificado»— está cumplido.
 *
 * Se cumple de **dos** formas, y la segunda es la que impide dejar sin facturar a
 * quien ya factura:
 *
 *  (a) hay una verificación `ok` para el CUIT y el punto de venta **actuales**;
 *  (b) la empresa tiene al menos una venta con `afip_cae`. Un comprobante
 *      autorizado es la prueba más fuerte que existe de que el circuito funciona.
 *
 * La evidencia de otro certificado **sigue valiendo**: se informa en
 * `otroCertificado` para que la pantalla pida verificar de nuevo, pero no
 * bloquea. Si invalidara, el paso 4 nunca se podría cumplir en el momento de
 * pasar a producción, porque el pase implica cambiar el certificado.
 *
 * @returns {Promise<{cumplido: boolean, via: string|null, otroCertificado: boolean, evidencia: object|null}>}
 */
async function estadoDelCircuito(empresaId) {
  const [evidencia, cuit, pv, cert] = await Promise.all([
    leerEvidencia(empresaId),
    valorDe('afip_cuit', empresaId),
    valorDe('afip_pv', empresaId),
    valorDe('afip_cert', empresaId),
  ]);

  const sirve = Boolean(
    evidencia &&
    evidencia.resultado === 'ok' &&
    soloDigitos(evidencia.cuit) === soloDigitos(cuit) &&
    String(evidencia.pv) === String(pv === null ? '' : pv)
  );

  const otroCertificado = Boolean(
    sirve && cert && evidencia.certificado && evidencia.certificado !== huellaDelCertificado(cert)
  );

  if (sirve) {
    return { cumplido: true, via: 'verificacion', otroCertificado, evidencia };
  }

  // La rama (b). Se pregunta por la existencia de UNA fila y no se cuentan
  // todas: con el índice de `empresa_id` alcanza, y contar sería recorrer el
  // historial entero de ventas de la empresa para contestar «¿hay alguna?».
  const conCae = await Sale.findOne({
    where: { empresa_id: empresaId, afip_cae: { [Op.ne]: null } },
    attributes: ['id'],
  });

  if (conCae) {
    return { cumplido: true, via: 'cae_previo', otroCertificado: false, evidencia };
  }

  return { cumplido: false, via: null, otroCertificado: false, evidencia };
}

module.exports = {
  CLAVE_EVIDENCIA,
  TIPO_PARA_CONSULTAR,
  PASO_TICKET,
  PASO_PUNTO_DE_VENTA,
  huellaDelCertificado,
  leerEvidencia,
  verificarCircuito,
  estadoDelCircuito,
};
