const express = require('express');
const router = express.Router();
const forge = require('node-forge');
const afipService = require('../services/afipService');
const afipAuth = require('../services/afipAuth');
const { Setting, Empresa, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');
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
      for (const clave of CLAVES_AFIP) {
        const valor = valores[clave];

        // Se saltea tanto undefined como cadena vacia.
        //
        // La version anterior solo salteaba undefined, y el formulario de
        // Ajustes arranca con cert:'' y key:'' y postea el objeto entero. Con
        // solo cambiar el desplegable de ambiente y guardar, se ejecutaba
        // Setting.upsert({ value: '' }) sobre afip_cert y afip_key: el
        // certificado y la clave quedaban destruidos. Y como la clave privada
        // nunca se guarda del lado del servidor al generar el CSR, no habia
        // copia: habia que rehacer todo el tramite en ARCA.
        if (valor === undefined || valor === null || valor === '') continue;

        await Setting.upsert(
          { key: clave, empresa_id: req.empresaId, value: valor },
          { transaction }
        );
      }
    });

    // El ticket WSAA cacheado se emitio con el certificado anterior.
    afipAuth.invalidarCache(req.empresaId);

    logger.info({ empresaId: req.empresaId, environment }, 'afip: configuración actualizada');
    res.json({ ok: true, message: 'Configuración de AFIP guardada correctamente' });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:setup');
    res.status(500).json({ ok: false, error: 'Error al guardar la configuración de AFIP' });
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
    logger.error({ err, empresaId: req.empresaId }, 'afip:generate-csr');
    res.status(500).json({ ok: false, error: 'Error al generar el pedido de certificado' });
  }
});

// POST /api/afip/invoice — Emitir comprobante electrónico
router.post('/invoice', checkPermission('ventas.crear'), async (req, res) => {
  try {
    const { type, amount, customerCuit, pv, customerVatCondition } = req.body;

    const result = await afipService.createVoucher({
      type: parseInt(type, 10) || 6,
      pv: parseInt(pv, 10),
      customerCuit,
      amount: parseFloat(amount),
      customerVatCondition: parseInt(customerVatCondition, 10) || 5,
      empresaId: req.empresaId,
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:invoice');
    // El mensaje de AFIP se devuelve tal cual a proposito: el usuario necesita
    // saber por que rechazaron su comprobante para poder corregirlo.
    res.status(502).json({ ok: false, error: err.message });
  }
});

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
