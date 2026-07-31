const soap = require('soap');
const { Setting, Empresa } = require('../models');
const afipAuth = require('./afipAuth');
const forge = require('node-forge');
const { fechaParaAfip } = require('../utils/fechas');

// ════════════════════════════════════════════
//  AFIP · Facturacion electronica WSFE, por empresa
//
//  Cada metodo recibe empresaId. La identidad fiscal (CUIT, certificado,
//  entorno homologacion/produccion) es de la empresa que factura, nunca
//  compartida.
//
//  Lo que estaba mal antes:
//   - getAuthParam leia Setting.findOne({ key: 'afip_cuit' }) sin empresa_id,
//     con lo cual todas las empresas facturaban con el mismo CUIT.
//   - createVoucher hacia Setting.findAll() sin filtro y reducia a un mapa:
//     tax_condition salia de la fila de cualquier empresa.
//   - this.wsfeClient cacheaba un unico cliente SOAP. Como la URL del WSDL
//     depende de si la empresa esta en homologacion o produccion, la primera
//     empresa en facturar fijaba el entorno para todas las demas.
// ════════════════════════════════════════════

class AfipService {
  constructor() {
    // Map<'homologation'|'production', clienteSoap>. El cliente se puede
    // compartir entre empresas del MISMO entorno: no lleva credenciales, esas
    // viajan en el parametro Auth de cada llamada.
    this.wsfeClients = new Map();
  }

  async getWsdlUrl(empresaId) {
    const isProd = await afipAuth.isProduction(empresaId);
    return isProd
      ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL'
      : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL';
  }

  async getClient(empresaId) {
    const isProd = await afipAuth.isProduction(empresaId);
    const entorno = isProd ? 'production' : 'homologation';

    const cacheado = this.wsfeClients.get(entorno);
    if (cacheado) return cacheado;

    const wsdlUrl = await this.getWsdlUrl(empresaId);

    return new Promise((resolve, reject) => {
      soap.createClient(wsdlUrl, (err, client) => {
        if (err) return reject(new Error('Error creating WSFE client: ' + err.message));
        this.wsfeClients.set(entorno, client);
        resolve(client);
      });
    });
  }

  async getAuthParam(empresaId) {
    const { token, sign } = await afipAuth.getAccessTicket(empresaId);

    const cuitSetting = await Setting.findOne({
      where: { key: 'afip_cuit', empresa_id: empresaId },
    });
    if (!cuitSetting || !cuitSetting.value) {
      throw new Error('CUIT de AFIP no configurado para esta empresa');
    }

    return {
      Auth: { Token: token, Sign: sign, Cuit: cuitSetting.value },
    };
  }

  async getStatus(empresaId) {
    const client = await this.getClient(empresaId);
    return new Promise((resolve, reject) => {
      client.FEDummy((err, result) => {
        if (err) return reject(err);
        resolve(result.FEDummyResult);
      });
    });
  }

  async getLastVoucher(pv, cbteTipo, empresaId) {
    const client = await this.getClient(empresaId);
    const auth = await this.getAuthParam(empresaId);
    
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

  async getVoucherInfo(pv, cbteTipo, cbteNro, empresaId) {
    const client = await this.getClient(empresaId);
    const auth = await this.getAuthParam(empresaId);
    
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

  async createVoucher({ type, pv, customerCuit, amount, concept = 1, customerVatCondition = 5, empresaId }) {
    if (!Number.isInteger(empresaId)) {
      throw new Error('AFIP: falta empresaId al emitir el comprobante.');
    }

    const client = await this.getClient(empresaId);
    const auth = await this.getAuthParam(empresaId);

    // Antes era Setting.findAll() sin filtro: la condicion fiscal podia salir
    // de la fila de otra empresa y cambiar como se discrimina el IVA.
    const taxSetting = await Setting.findOne({
      where: { key: 'tax_condition', empresa_id: empresaId },
    });
    const taxCondition = taxSetting?.value || 'Monotributo';

    const lastVoucher = await this.getLastVoucher(pv, type, empresaId);
    const nextVoucher = lastVoucher + 1;

    // La fecha se toma en la zona horaria del negocio, no en UTC. Argentina
    // es UTC-3: despues de las 21:00 local, toISOString() ya devuelve el dia
    // siguiente, y el comprobante salia fechado un dia despues de la venta.
    const empresa = await Empresa.findByPk(empresaId, { attributes: ['timezone'] });
    const date = fechaParaAfip(empresa && empresa.timezone);

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
  /**
   * Genera el pedido de certificado (CSR) para tramitar en ARCA.
   *
   * AFIP exige que el subject del CSR incluya el CUIT en el campo
   * serialNumber, con el formato exacto "CUIT 20123456789". El equivalente en
   * linea de comandos es:
   *
   *   openssl req -new -key privada.key    *     -subj "/C=AR/O=<razon social>/CN=<alias>/serialNumber=CUIT <cuit>"
   *
   * La version anterior no incluia serialNumber y ponia organizationName fijo
   * en "Empresa": ARCA rechazaba el pedido, con lo cual el primer paso del
   * setup —el boton "Generar Pedido de Certificado"— producia un archivo
   * inservible.
   *
   * @param {string} alias    Alias del certificado, el mismo que se carga en ARCA.
   * @param {string} cuit     CUIT sin guiones, 11 digitos.
   * @param {string} razonSocial
   */
  async createCSR(alias, cuit, razonSocial) {
    const cuitLimpio = String(cuit || '').replace(/\D/g, '');

    if (cuitLimpio.length !== 11) {
      const err = new Error('El CUIT debe tener 11 dígitos para generar el pedido de certificado.');
      err.status = 400;
      throw err;
    }

    if (!alias || !String(alias).trim()) {
      const err = new Error('Falta el alias del certificado.');
      err.status = 400;
      throw err;
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;

    csr.setSubject([
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: String(razonSocial || alias).trim() },
      { name: 'commonName', value: String(alias).trim() },
      // node-forge no tiene un shortName para serialNumber: se pasa el OID.
      { type: '2.5.4.5', value: `CUIT ${cuitLimpio}` },
    ]);

    csr.sign(keys.privateKey, forge.md.sha256.create());

    return {
      csr: forge.pki.certificationRequestToPem(csr),
      key: forge.pki.privateKeyToPem(keys.privateKey),
      // Se devuelve para que la UI pueda advertir que esta clave no se guarda
      // en el servidor y hay que resguardarla.
      advertencia: 'Guardá la clave privada: no queda almacenada en el servidor y sin ella el certificado no sirve.',
    };
  }
}

module.exports = new AfipService();
