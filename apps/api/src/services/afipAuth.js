const forge = require('node-forge');
const soap = require('soap');
const xml2js = require('xml2js');
const { Setting } = require('../models');
const logger = require('../utils/logger');

// ════════════════════════════════════════════
//  AFIP · Autenticacion WSAA, por empresa
//
//  Cada empresa cliente factura con SU PROPIA identidad fiscal: su CUIT, su
//  certificado y su clave privada. Nada de lo que hay aca puede compartirse
//  entre empresas.
//
//  La version anterior leia la configuracion de AFIP con
//  Setting.findOne({ where: { key: 'afip_cert' } }), sin empresa_id, y la
//  tabla settings tenia  como unica clave primaria: habia una sola fila
//  por clave en toda la base. La segunda empresa que cargaba su certificado
//  pisaba el de la primera, y a partir de ahi las facturas de la primera
//  salian firmadas con el certificado y el CUIT de la segunda.
//
//  Ademas el ticket de acceso se guardaba en this.taCache sobre una instancia
//  singleton: una empresa reutilizaba el ticket WSAA emitido para otra.
//
//  Ahora todo recibe empresaId y las caches van por empresa.
// ════════════════════════════════════════════

class AfipAuth {
  constructor() {
    // Map<empresaId, { token, sign, expirationDate }>
    this.taCache = new Map();
  }

  /** Lee una clave de configuracion de AFIP de UNA empresa. */
  async _getSetting(key, empresaId) {
    if (!Number.isInteger(empresaId)) {
      throw new Error('AFIP: falta empresaId. La configuracion fiscal es por empresa.');
    }
    return Setting.findOne({ where: { key, empresa_id: empresaId } });
  }

  async getWsdlUrl(empresaId) {
    const isProd = await this.isProduction(empresaId);
    return isProd
      ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl'
      : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl';
  }

  async isProduction(empresaId) {
    const setting = await this._getSetting('afip_environment', empresaId);
    const valor = setting && setting.value;

    if (valor === 'production') return true;
    if (valor === 'homologation') return false;

    // Sin entorno configurado se asume homologacion, que es lo seguro: emitir
    // contra produccion por accidente genera comprobantes fiscales reales.
    // Pero se avisa, porque antes esto pasaba en silencio y el comercio podia
    // estar facturando contra el servidor de pruebas creyendo que facturaba de
    // verdad: los comprobantes de homologacion no tienen validez fiscal.
    logger.warn(
      { empresaId, valor },
      'AFIP: entorno no configurado o desconocido, se usa homologacion (los comprobantes NO tienen validez fiscal)'
    );
    return false;
  }

  async getCertAndKey(empresaId) {
    const certSetting = await this._getSetting('afip_cert', empresaId);
    const keySetting = await this._getSetting('afip_key', empresaId);

    if (!certSetting || !keySetting) {
      throw new Error('Certificado o Clave Privada de AFIP no configurados para esta empresa.');
    }

    return { cert: certSetting.value, key: keySetting.value };
  }

  /** Invalida el ticket cacheado de una empresa (al cambiar su certificado). */
  invalidarCache(empresaId) {
    this.taCache.delete(empresaId);
  }

  generateTRA() {
    const date = new Date();
    const uniqueId = Math.floor(date.getTime() / 1000);
    // AFIP Requires generationTime to be a bit in the past to avoid timezone issues, and expirationTime in the future.
    const generationTime = new Date(date.getTime() - 10 * 60 * 1000).toISOString();
    const expirationTime = new Date(date.getTime() + 10 * 60 * 1000).toISOString();

    return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
  }

  signTRA(traXml, certPem, keyPem) {
    try {
      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(traXml, 'utf8');

      const cert = forge.pki.certificateFromPem(certPem);
      p7.addCertificate(cert);

      const privateKey = forge.pki.privateKeyFromPem(keyPem);
      
      p7.addSigner({
        key: privateKey,
        certificate: cert,
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
          {
            type: forge.pki.oids.contentType,
            value: forge.pki.oids.data,
          },
          {
            type: forge.pki.oids.messageDigest,
            // Automatically computed by forge
          },
          {
            type: forge.pki.oids.signingTime,
            // Automatically computed by forge
          }
        ]
      });

      p7.sign();
      const pem = forge.pkcs7.messageToPem(p7);
      
      // Extract base64 block
      const lines = pem.split('\n');
      let base64Data = '';
      let isData = false;
      for (const line of lines) {
        if (line.includes('-----BEGIN PKCS7-----')) {
          isData = true;
          continue;
        }
        if (line.includes('-----END PKCS7-----')) {
          break;
        }
        if (isData) {
          base64Data += line.trim();
        }
      }

      return base64Data;
    } catch (err) {
      logger.error({ err }, 'AFIP: error al firmar el TRA');
      throw new Error('Error al firmar el ticket de acceso: ' + err.message);
    }
  }

  async getAccessTicket(empresaId) {
    if (!Number.isInteger(empresaId)) {
      throw new Error('AFIP: falta empresaId al pedir el ticket de acceso.');
    }

    // Cache por empresa. Antes era una sola entrada compartida, con lo cual
    // una empresa podia terminar usando el ticket WSAA emitido para otra.
    const cacheado = this.taCache.get(empresaId);
    if (cacheado && cacheado.expirationDate > new Date()) {
      return { token: cacheado.token, sign: cacheado.sign };
    }

    logger.info({ empresaId }, 'AFIP: generando nuevo Ticket de Acceso (WSAA)');

    const { cert, key } = await this.getCertAndKey(empresaId);
    const traXml = this.generateTRA();
    const cmsBase64 = this.signTRA(traXml, cert, key);

    const wsdlUrl = await this.getWsdlUrl(empresaId);

    return new Promise((resolve, reject) => {
      soap.createClient(wsdlUrl, (err, client) => {
        if (err) return reject(new Error('Error creating SOAP client for WSAA: ' + err.message));

        client.loginCms({ in0: cmsBase64 }, (err, result) => {
          if (err) return reject(new Error('Error calling loginCms: ' + err.message));

          if (!result || !result.loginCmsReturn) {
            return reject(new Error('Respuesta inválida del servidor WSAA de AFIP.'));
          }

          const loginCmsReturn = result.loginCmsReturn;

          // result is an XML string embedded in the SOAP response
          xml2js.parseString(loginCmsReturn, { explicitArray: false }, (err, parsed) => {
            if (err) return reject(new Error('Error parsing WSAA response: ' + err.message));

            try {
              const token = parsed.loginTicketResponse.credentials.token;
              const sign = parsed.loginTicketResponse.credentials.sign;
              const expirationTime = parsed.loginTicketResponse.header.expirationTime;

              this.taCache.set(empresaId, {
                token,
                sign,
                expirationDate: new Date(expirationTime),
              });

              logger.info({ empresaId }, 'AFIP: ticket de acceso obtenido');
              resolve({ token, sign });
            } catch (e) {
              reject(new Error('Error extrayendo Token y Sign de la respuesta de WSAA: ' + e.message));
            }
          });
        });
      });
    });
  }
}

module.exports = new AfipAuth();
