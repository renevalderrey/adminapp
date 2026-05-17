const soap = require('soap');
const { Setting } = require('../models');
const afipAuth = require('./afipAuth');

class AfipService {
  constructor() {
    this.wsfeClient = null;
  }

  async getWsdlUrl() {
    const isProd = await afipAuth.isProduction();
    return isProd
      ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL'
      : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL';
  }

  async getClient() {
    if (this.wsfeClient) return this.wsfeClient;
    const wsdlUrl = await this.getWsdlUrl();
    return new Promise((resolve, reject) => {
      soap.createClient(wsdlUrl, (err, client) => {
        if (err) return reject(new Error('Error creating WSFE client: ' + err.message));
        this.wsfeClient = client;
        resolve(client);
      });
    });
  }

  async getAuthParam() {
    const { token, sign } = await afipAuth.getAccessTicket();
    const cuitSetting = await Setting.findOne({ where: { key: 'afip_cuit' } });
    if (!cuitSetting) throw new Error('CUIT no configurado');
    
    return {
      Auth: {
        Token: token,
        Sign: sign,
        Cuit: cuitSetting.value
      }
    };
  }

  async getStatus() {
    const client = await this.getClient();
    return new Promise((resolve, reject) => {
      client.FEDummy((err, result) => {
        if (err) return reject(err);
        resolve(result.FEDummyResult);
      });
    });
  }

  async getLastVoucher(pv, cbteTipo) {
    const client = await this.getClient();
    const auth = await this.getAuthParam();
    
    const params = {
      Auth: auth.Auth,
      PtoVta: pv,
      CbteTipo: cbteTipo
    };

    return new Promise((resolve, reject) => {
      client.FECompUltimoAutorizado(params, (err, result) => {
        if (err) return reject(err);
        const res = result.FECompUltimoAutorizadoResult;
        if (res.Errors) {
          return reject(new Error('Error al obtener último comprobante: ' + JSON.stringify(res.Errors.Err)));
        }
        resolve(res.CbteNro);
      });
    });
  }

  async getVoucherInfo(pv, cbteTipo, cbteNro) {
    const client = await this.getClient();
    const auth = await this.getAuthParam();
    
    const params = {
      Auth: auth.Auth,
      FeCompConsReq: {
        PtoVta: pv,
        CbteTipo: cbteTipo,
        CbteNro: cbteNro
      }
    };

    return new Promise((resolve, reject) => {
      client.FECompConsultar(params, (err, result) => {
        if (err) return reject(err);
        const res = result.FECompConsultarResult;
        if (res.Errors) {
          return reject(new Error('Error al obtener info del comprobante: ' + JSON.stringify(res.Errors.Err)));
        }
        resolve(res.ResultGet);
      });
    });
  }

  async createVoucher({ type, pv, customerCuit, amount, concept = 1, customerVatCondition = 5 }) {
    const client = await this.getClient();
    const auth = await this.getAuthParam();
    
    const settingsRaw = await Setting.findAll();
    const settings = settingsRaw.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
    const taxCondition = settings['tax_condition'] || 'Monotributo';

    const lastVoucher = await this.getLastVoucher(pv, type);
    const nextVoucher = lastVoucher + 1;

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');

    const params = {
      Auth: auth.Auth,
      FeCAEReq: {
        FeCabReq: {
          CantReg: 1,
          PtoVta: pv,
          CbteTipo: type
        },
        FeDetReq: {
          FECAEDetRequest: [
            {
              Concepto: concept,
              DocTipo: customerCuit ? (customerCuit.length > 8 ? 80 : 96) : 99,
              DocNro: customerCuit || 0,
              CbteDesde: nextVoucher,
              CbteHasta: nextVoucher,
              CbteFch: date,
              ImpTotal: amount,
              ImpTotConc: 0,
              ImpNeto: amount,
              ImpOpEx: 0,
              ImpTrib: 0,
              ImpIVA: 0,
              MonId: 'PES',
              MonCotiz: 1,
              CondicionIVAReceptorId: parseInt(customerVatCondition) || 5
            }
          ]
        }
      }
    };

    // logic for Responsable Inscripto (Factura/NC A or B)
    // Types: 1=Factura A, 3=NC A, 6=Factura B, 8=NC B
    if (taxCondition === 'RI' && [1, 3, 6, 8].includes(type)) {
      const neto = parseFloat((amount / 1.21).toFixed(2));
      const iva = parseFloat((amount - neto).toFixed(2));
      
      params.FeCAEReq.FeDetReq.FECAEDetRequest[0].ImpNeto = neto;
      params.FeCAEReq.FeDetReq.FECAEDetRequest[0].ImpIVA = iva;
      params.FeCAEReq.FeDetReq.FECAEDetRequest[0].Iva = {
        AlicIva: [
          {
            Id: 5, // 21%
            BaseImp: neto,
            Importe: iva
          }
        ]
      };
    }

    return new Promise((resolve, reject) => {
      client.FECAESolicitar(params, (err, result) => {
        if (err) return reject(err);
        
        const res = result.FECAESolicitarResult;
        
        if (res.Errors) {
          return reject(new Error('Error de AFIP: ' + JSON.stringify(res.Errors.Err)));
        }

        const detResponse = res.FeDetResp.FECAEDetResponse[0];
        if (detResponse.Resultado !== 'A') {
          return reject(new Error('Factura rechazada u observada por AFIP: ' + JSON.stringify(detResponse.Observaciones?.Obs || detResponse)));
        }

        resolve({
          cae: detResponse.CAE,
          expiration: detResponse.CAEFchVto,
          voucherNumber: nextVoucher,
          pointOfSale: pv,
          type
        });
      });
    });
  }

  // Not used anymore as we generate PDF in the browser natively
  async getVoucherPDF(data) {
    throw new Error('La generación de PDF en servidor está deshabilitada. Generar PDF en el cliente.');
  }

  // Used only to get a fresh CSR for ARCA setup
  async createCSR(alias = 'Comprafit') {
    const forge = require('node-forge');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([{
      name: 'commonName',
      value: alias
    }, {
      name: 'organizationName',
      value: 'Empresa'
    }]);
    csr.sign(keys.privateKey, forge.md.sha256.create());
    
    return {
      csr: forge.pki.certificationRequestToPem(csr),
      key: forge.pki.privateKeyToPem(keys.privateKey)
    };
  }
}

module.exports = new AfipService();
