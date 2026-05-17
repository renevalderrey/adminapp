const express = require('express');
const router = express.Router();
const afipService = require('../services/afipService');
const { Setting } = require('../models');

// GET /api/afip/status — Verificar conexión
router.get('/status', async (req, res) => {
  try {
    const status = await afipService.getStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/afip/cert-info — Obtener info del certificado cargado
router.get('/cert-info', async (req, res) => {
  try {
    const forge = require('node-forge');
    const certSetting = await Setting.findOne({ where: { key: 'afip_cert' } });
    
    if (!certSetting || !certSetting.value) {
      return res.json({ ok: false, error: 'No hay certificado cargado' });
    }
    
    const cert = forge.pki.certificateFromPem(certSetting.value);
    const issuer = cert.issuer.attributes.find(a => a.name === 'commonName')?.value || 'Desconocido';
    const isProduction = issuer === 'Computadores' || issuer === 'AFIP';
    
    res.json({
      ok: true,
      data: {
        issuer,
        isProduction,
        subject: cert.subject.attributes.find(a => a.name === 'commonName')?.value || 'Desconocido',
        cuit: cert.subject.attributes.find(a => a.name === 'serialNumber')?.value || 'Desconocido',
        validFrom: cert.validity.notBefore,
        validTo: cert.validity.notAfter
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/afip/setup — Guardar configuración del usuario
router.post('/setup', async (req, res) => {
  try {
    const { cuit, cert, key, environment, pv } = req.body;
    
    // Almacenar en la tabla settings
    const configs = [
      { key: 'afip_cuit', value: cuit },
      { key: 'afip_cert', value: cert },
      { key: 'afip_key', value: key },
      { key: 'afip_environment', value: environment },
      { key: 'afip_pv', value: pv }
    ];

    for (const config of configs) {
      await Setting.upsert(config);
    }

    res.json({ ok: true, message: 'Configuración de AFIP guardada correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/afip/generate-csr — Generar CSR y Key para el usuario
router.post('/generate-csr', async (req, res) => {
  try {
    const { alias } = req.body;
    const result = await afipService.createCSR(alias);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/afip/invoice — Emitir comprobante electrónico
router.post('/invoice', async (req, res) => {
  try {
    const { type, amount, customerCuit, pv, customerVatCondition } = req.body;
    
    const result = await afipService.createVoucher({
      type: parseInt(type) || 6,
      pv: parseInt(pv),
      customerCuit,
      amount: parseFloat(amount),
      customerVatCondition: parseInt(customerVatCondition) || 5
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/afip/invoice/:type/:pv/:number/data — Obtener datos para imprimir en frontend
router.get('/invoice/:type/:pv/:number/data', async (req, res) => {
  try {
    const { type, pv, number } = req.params;
    
    const voucherInfo = await afipService.getVoucherInfo(pv, type, number);
    
    res.json({
      ok: true,
      data: {
        PtoVta: pv,
        CbteTipo: type,
        CbteDesde: number,
        CbteHasta: number,
        ...voucherInfo
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
