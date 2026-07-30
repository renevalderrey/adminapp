const forge = require('node-forge');
const soap = require('soap');
const xml2js = require('xml2js');
const { Setting } = require('../models');

class AfipAuth {
  constructor() {
    this.taCache = null; // { token, sign, expirationDate }
  }

  async getWsdlUrl() {
    const isProd = await this.isProduction();
    return isProd
      ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl'
      : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl';
  }

  async isProduction() {
    const setting = await Setting.findOne({ where: { key: 'afip_environment' } });
    return setting && setting.value === 'production';
  }

  async getCertAndKey() {
    const certSetting = await Setting.findOne({ where: { key: 'afip_cert' } });
    const keySetting = await Setting.findOne({ where: { key: 'afip_key' } });

    if (!certSetting || !keySetting) {
      throw new Error('Certificado o Clave Privada de AFIP no encontrados en la base de datos.');
    }

    return {
      cert: certSetting.value,
      key: keySetting.value
    };
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
      console.error('Error signing TRA:', err);
      throw new Error('Error al firmar el ticket de acceso: ' + err.message);
    }
  }

  async getAccessTicket() {
    // Check if we have a valid cache
    if (this.taCache && this.taCache.expirationDate > new Date()) {
      return { token: this.taCache.token, sign: this.taCache.sign };
    }

    console.log('Generando nuevo Ticket de Acceso (WSAA)...');
    
    const { cert, key } = await this.getCertAndKey();
    const traXml = this.generateTRA();
    const cmsBase64 = this.signTRA(traXml, cert, key);

    const wsdlUrl = await this.getWsdlUrl();

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

              this.taCache = {
                token,
                sign,
                expirationDate: new Date(expirationTime)
              };

              console.log('Ticket de Acceso obtenido exitosamente.');
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
