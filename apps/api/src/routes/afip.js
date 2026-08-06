const express = require('express');
const router = express.Router();
const forge = require('node-forge');
const afipService = require('../services/afipService');
const afipAuth = require('../services/afipAuth');
const { Setting, Empresa, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');
const logger = require('../utils/logger');

// Toda la configuracion de AFIP es POR EMPRESA: cada empresa cliente factura
// con su propio CUIT, su certificado y su clave privada.
//
// Antes las lecturas y escrituras de Setting no pasaban empresa_id, y la tabla
// settings tenia `key` como unica clave primaria: existia una sola fila por
// clave en toda la base. La segunda empresa que guardaba su certificado pisaba
// el de la primera, y las facturas de esta ultima salian emitidas con la
// identidad fiscal de la otra.

// tax_condition faltaba en esta lista. El formulario de Ajustes la manda, el
// backend respondia "guardada correctamente" y la descartaba. Del otro lado,
// createVoucher lee esa clave y caia siempre al default 'Monotributo': la rama
// que discrimina IVA para Responsable Inscripto era codigo muerto, y todo RI
// emitia Factura A sin discriminar. AFIP rechaza eso, y si lo autorizara el
// comprador se quedaria sin credito fiscal.
const CLAVES_AFIP = ['afip_cuit', 'afip_cert', 'afip_key', 'afip_environment', 'afip_pv', 'tax_condition'];

const CONDICIONES_FISCALES = ['Monotributo', 'RI', 'Exento'];

/**
 * El ÚNICO lugar que escribe la configuración de AFIP de una empresa.
 *
 * ── Por qué es una función y no el cuerpo del handler ──
 *
 * Guardar el ambiente o las credenciales y **no invalidar el ticket WSAA
 * cacheado** deja a la empresa firmando con el ticket viejo hasta que vence, con
 * la pantalla diciendo que se guardó. Es una falla que no aparece en el momento:
 * aparece cuando hay que emitir.
 *
 * Hasta este corte la llamada a `invalidarCache` vivía suelta en `POST /setup`,
 * o sea que la garantía valía para **ese** handler y para ninguno más. El
 * segundo camino que escribiera `afip_environment` —y ya había uno,
 * `PUT /api/settings/:key`, que ahora lo rechaza— nacía sin ella. Con la
 * escritura y la invalidación en la misma función no hay forma de hacer una sin
 * la otra.
 *
 * ── La cadena vacía se saltea, y eso NO se toca ──
 *
 * El formulario de Ajustes arranca con `cert:''` y `key:''` y postea el objeto
 * entero. Antes esto solo salteaba `undefined`: con solo cambiar el desplegable
 * de ambiente y guardar, el bucle de abajo guardaba `value: ''` sobre
 * `afip_cert` y `afip_key`, y el certificado y la clave quedaban destruidos. Y
 * como la clave privada del CSR nunca se guarda del lado del servidor, no había
 * copia: había que rehacer el trámite entero en ARCA.
 *
 * @param {number} empresaId
 * @param {object} cambios Claves de `CLAVES_AFIP`. Lo que no venga, no se toca.
 * @param {object} [opciones]
 * @param {import('sequelize').Transaction} [opciones.transaction]
 */
async function guardarConfiguracionAfip(empresaId, cambios, { transaction } = {}) {
  for (const clave of CLAVES_AFIP) {
    const valor = cambios[clave];

    if (valor === undefined || valor === null || valor === '') continue;

    await Setting.upsert(
      { key: clave, empresa_id: empresaId, value: valor },
      { transaction }
    );
  }

  // El ticket cacheado se emitió con el certificado y contra el ambiente
  // anteriores. Se invalida acá adentro y no después del commit a propósito: si
  // la transacción se revierte, lo que cuesta es pedir un ticket de más —una
  // llamada a WSAA—, mientras que invalidar de menos cuesta comprobantes
  // firmados con material que ya no es el de la empresa.
  afipAuth.invalidarCache(empresaId);
}

// GET /api/afip/status — Verificar conexión
router.get('/status', checkPermission('config.ver'), async (req, res) => {
  try {
    const status = await afipService.getStatus(req.empresaId);
    res.json({ ok: true, data: status });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:status');
    res.status(502).json({ ok: false, error: 'No se pudo consultar el estado de AFIP' });
  }
});

// GET /api/afip/cert-info — Info del certificado cargado por esta empresa
router.get('/cert-info', checkPermission('config.ver'), async (req, res) => {
  try {
    const certSetting = await Setting.findOne({
      where: { key: 'afip_cert', empresa_id: req.empresaId },
    });

    if (!certSetting || !certSetting.value) {
      return res.json({ ok: false, error: 'No hay certificado cargado' });
    }

    const cert = forge.pki.certificateFromPem(certSetting.value);
    const issuer = cert.issuer.attributes.find((a) => a.name === 'commonName')?.value || 'Desconocido';
    const isProduction = issuer === 'Computadores' || issuer === 'AFIP';

    res.json({
      ok: true,
      data: {
        issuer,
        isProduction,
        subject: cert.subject.attributes.find((a) => a.name === 'commonName')?.value || 'Desconocido',
        cuit: cert.subject.attributes.find((a) => a.name === 'serialNumber')?.value || 'Desconocido',
        validFrom: cert.validity.notBefore,
        validTo: cert.validity.notAfter,
      },
    });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:cert-info');
    res.status(400).json({ ok: false, error: 'El certificado cargado no es válido' });
  }
});

// POST /api/afip/setup — Guardar la configuración de AFIP de ESTA empresa
router.post('/setup', checkPermission('config.editar'), async (req, res) => {
  try {
    const { cuit, cert, key, environment, pv, tax_condition } = req.body;

    if (environment && !['homologation', 'production'].includes(environment)) {
      return res.status(400).json({
        ok: false,
        error: 'El entorno debe ser "homologation" o "production"',
      });
    }

    // El certificado y la clave se validan antes de guardarlos: un PEM
    // corrupto guardado sin chequear recien fallaba al momento de facturar.
    if (cert) {
      try {
        forge.pki.certificateFromPem(cert);
      } catch {
        return res.status(400).json({ ok: false, error: 'El certificado no es un PEM válido' });
      }
    }

    if (key) {
      try {
        forge.pki.privateKeyFromPem(key);
      } catch {
        return res.status(400).json({ ok: false, error: 'La clave privada no es un PEM válido' });
      }
    }

    if (tax_condition && !CONDICIONES_FISCALES.includes(tax_condition)) {
      return res.status(400).json({
        ok: false,
        error: `La condición fiscal debe ser una de: ${CONDICIONES_FISCALES.join(', ')}`,
      });
    }

    const valores = {
      afip_cuit: cuit,
      afip_cert: cert,
      afip_key: key,
      afip_environment: environment,
      afip_pv: pv,
      tax_condition,
    };

    // El certificado y la clave se guardan juntos o no se guardan: subir uno
    // solo deja una configuracion que no puede firmar.
    if ((cert && !key) || (key && !cert)) {
      return res.status(400).json({
        ok: false,
        error: 'El certificado y la clave privada se cargan juntos.',
      });
    }

    await sequelize.transaction(async (transaction) => {
      await guardarConfiguracionAfip(req.empresaId, valores, { transaction });
    });

    logger.info({ empresaId: req.empresaId, environment }, 'afip: configuración actualizada');
    res.json({ ok: true, message: 'Configuración de AFIP guardada correctamente' });
  } catch (err) {
    fallo(req, res, err, 'Error al guardar la configuración de AFIP');
  }
});

// POST /api/afip/generate-csr — Generar CSR y clave para el trámite en ARCA
//
// ARCA exige el CUIT dentro del subject del pedido. Antes no se enviaba, y el
// archivo resultante era rechazado en la ventanilla: el primer paso del setup
// no funcionaba.
router.post('/generate-csr', checkPermission('config.editar'), async (req, res) => {
  try {
    const { alias } = req.body;

    // El CUIT y la razón social salen de la empresa, no del body: son datos
    // que ya están cargados y no tiene sentido pedirlos de nuevo.
    const empresa = await Empresa.findByPk(req.empresaId, {
      attributes: ['name', 'cuit'],
    });

    const cuit = (req.body.cuit || (empresa && empresa.cuit) || '').replace(/\D/g, '');

    if (cuit.length !== 11) {
      return res.status(400).json({
        ok: false,
        error: 'Cargá el CUIT de la empresa antes de generar el pedido de certificado.',
      });
    }

    const result = await afipService.createCSR(
      alias || (empresa && empresa.name) || 'AdminApp',
      cuit,
      (empresa && empresa.name) || alias
    );

    res.json({ ok: true, data: result });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    fallo(req, res, err, 'Error al generar el pedido de certificado');
  }
});

// ════════════════════════════════════════════
//  Acá vivía `POST /api/afip/invoice`, y se borró
//
//  Emitía un comprobante fiscal REAL con `type`, `amount` y `pv` sacados del
//  cuerpo, **sin crear ninguna `Sale`**. El permiso que pedía era `ventas.crear`,
//  que tiene el rol `vendedor`: un cajero, a un request de distancia, generaba un
//  CAE que no cuelga de ninguna venta.
//
//  Lo que eso cuesta no se deshace con un `DELETE`: un comprobante emitido
//  consume numeración correlativa, y darlo de baja exige una nota de crédito —que
//  este sistema no emite—. Es exactamente el «CAE huérfano» que
//  `POST /api/sales/:id/facturar` existe para que no pueda pasar: ese sí tiene la
//  venta persistida, es idempotente y toma lock.
//
//  Es la misma familia que el botón «Emitir Factura de Prueba (1 ARS)» que el
//  hito 5 sacó del punto de venta: una acción a un clic de un hecho fiscal
//  irreversible.
//
//  **No lo llamaba nadie**: se buscó en `apps/web` y en los tests antes de
//  borrarlo, y el único uso de `/afip/invoice` que queda es el `GET
//  /invoice/:type/:pv/:number/data` de acá abajo —que solo lee un comprobante ya
//  emitido— desde `pages/InvoicesList.jsx`.
//
//  Lo que ese endpoint servía para comprobar —«¿mi configuración de AFIP
//  funciona?»— lo va a contestar `POST /api/afip/verificar` (corte 9), que pide
//  el ticket WSAA y consulta el último comprobante autorizado: no emite nada y no
//  consume numeración.
//
//  Que no vuelva lo sostiene una guardia estática en `tests/observabilidad.test.js`:
//  ninguna ruta fuera de `routes/sales.js` puede llamar a
//  `afipService.createVoucher`.
// ════════════════════════════════════════════

// GET /api/afip/invoice/:type/:pv/:number/data — Datos para imprimir
router.get('/invoice/:type/:pv/:number/data', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const { type, pv, number } = req.params;

    const voucherInfo = await afipService.getVoucherInfo(pv, type, number, req.empresaId);

    res.json({
      ok: true,
      data: {
        PtoVta: pv,
        CbteTipo: type,
        CbteDesde: number,
        CbteHasta: number,
        ...voucherInfo,
      },
    });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:voucher-data');
    res.status(502).json({ ok: false, error: 'No se pudo obtener el comprobante de AFIP' });
  }
});

module.exports = router;
