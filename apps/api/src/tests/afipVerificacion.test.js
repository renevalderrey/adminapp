// ════════════════════════════════════════════
//  AFIP · verificar el circuito, y no dejar pasar a producción sin haberlo hecho
//
//  ── Cómo se prueba una fase que depende de un servicio de terceros ──
//
//  Ningún test puede pegarle a ARCA. `services/afipAuth` y `services/afipService`
//  se doblan con `jest.mock` —el precedente es `afipNumeracion.test.js:13`— y lo
//  que se afirma acá es **lo que pasa de este lado**: qué se guarda, qué NO se
//  guarda, qué status sale y qué dice el mensaje. El doble devuelve un ticket y
//  un `FECompUltimoAutorizado` de mentira, y **también** los errores que ARCA
//  devuelve de verdad, copiados del texto real.
//
//  Lo que necesita Postgres —que un `setup` rechazado no deje ninguna fila
//  escrita, que la evidencia con `resultado: "error"` quede guardada, y que la
//  rama del CAE previo lea `sales` de verdad— está en
//  `integracion/afip.integracion.test.js`.
//
//  Lo que ningún nivel contesta —que el circuito de verdad funcione contra
//  ARCA— es el paso manual M1 de `tasks.md`, y es el único de esta fase.
//
//  ── Los cuatro defectos que este archivo existe para que no vuelvan ──
//
//   1. **El circuito nunca se probó, y no había forma de probarlo sin emitir.**
//      Lo único que la pantalla podía hacer era `FEDummy`, que **no lleva
//      `Auth`**: contesta OK con el certificado vencido, con la clave equivocada
//      y sin ningún certificado cargado.
//   2. **El certificado y la clave se validaban por separado.** Cada uno tenía
//      que ser un PEM legible y nada más: subir el `.crt` de ARCA con el `.key`
//      de un CSR viejo pasaba, se guardaba, y el error aparecía recién al
//      facturar como «Error al firmar el ticket de acceso».
//   3. **Nadie comparaba el CUIT del certificado** contra el configurado, aunque
//      el dato ya salía por `GET /afip/cert-info` y la pantalla ya lo mostraba.
//   4. **Se podía pasar a producción sin haber probado nada.** El primer
//      comprobante fiscal real habría sido también la primera prueba del
//      circuito.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const forge = require('node-forge');

const EMPRESA = 7;

// ⚠ El prefijo `mock` no es estilo: `jest.mock` se iza arriba de todo y jest
// solo deja que su fábrica mire variables que empiecen así.
const mockFilasDeSettings = [];
let mockVentaConCae = null;

jest.mock('../models', () => ({
  Setting: {
    async upsert(datos) {
      const i = mockFilasDeSettings.findIndex(
        (f) => f.key === datos.key && f.empresa_id === datos.empresa_id
      );
      if (i >= 0) mockFilasDeSettings[i] = { ...mockFilasDeSettings[i], ...datos };
      else mockFilasDeSettings.push({ ...datos });
      return [datos, i < 0];
    },
    async findOne({ where }) {
      return mockFilasDeSettings.find(
        (f) => f.key === where.key && f.empresa_id === where.empresa_id
      ) || null;
    },
    async destroy() {
      return 0;
    },
  },
  Sale: {
    async findOne() {
      return mockVentaConCae;
    },
  },
  Empresa: {
    async findByPk() {
      return { name: 'Panadería del Centro', cuit: '30111111118' };
    },
  },
  sequelize: {
    async transaction(callback) {
      return callback('TX');
    },
  },
}));

jest.mock('../services/afipAuth', () => ({
  getAccessTicket: jest.fn(),
  isProduction: jest.fn(),
  invalidarCache: jest.fn(),
}));

jest.mock('../services/afipService', () => ({
  getStatus: jest.fn(),
  getLastVoucher: jest.fn(),
}));

const afipAuth = require('../services/afipAuth');
const afipService = require('../services/afipService');
const afipRouter = require('../routes/afip');

function levantarApi() {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = EMPRESA;
    req.userId = 'auth0|quien-configura';
    req.usuario = { id: 42 };
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use('/api/afip', afipRouter);
  return api;
}

/** La fila de configuración de esta empresa, o `undefined`. */
const fila = (clave) =>
  mockFilasDeSettings.find((f) => f.key === clave && f.empresa_id === EMPRESA);

const evidencia = () => {
  const f = fila('afip_verificacion');
  return f ? f.value : null;
};

function sembrar(clave, valor) {
  mockFilasDeSettings.push({ key: clave, empresa_id: EMPRESA, value: valor });
}

// ── El par certificado-clave, generado en el test ──
//
// Se generan DOS pares y no uno: la afirmación que importa —«esta clave no firma
// este certificado»— necesita una clave que de verdad no corresponda. Copiar un
// PEM cualquiera como «clave equivocada» probaría otra cosa (que el PEM no
// parsea), que es lo que la validación vieja ya hacía.
//
// 1024 bits y no 2048: acá no se protege nada, se ejercita la comparación, y
// generar dos pares de 2048 cuesta segundos en cada corrida.
function generarPar(cuit) {
  const par = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();

  cert.publicKey = par.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  // `serialNumber` en el subject es donde ARCA escribe el CUIT, con la forma
  // `CUIT 30111111118`. Es de ahí que `GET /afip/cert-info` lo saca.
  cert.setSubject([
    { name: 'commonName', value: 'AdminApp' },
    { name: 'serialNumber', value: `CUIT ${cuit}` },
  ]);
  cert.setIssuer([{ name: 'commonName', value: 'Computadores' }]);
  cert.sign(par.privateKey, forge.md.sha256.create());

  return {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(par.privateKey),
  };
}

let PANADERIA;
let OTRA_EMPRESA;

beforeAll(() => {
  PANADERIA = generarPar('30111111118');
  OTRA_EMPRESA = generarPar('20999999997');
});

beforeEach(() => {
  mockFilasDeSettings.length = 0;
  mockVentaConCae = null;

  afipAuth.getAccessTicket.mockReset();
  afipAuth.isProduction.mockReset();
  afipAuth.invalidarCache.mockReset();
  afipService.getStatus.mockReset();
  afipService.getLastVoucher.mockReset();

  afipAuth.getAccessTicket.mockResolvedValue({ token: 'tok', sign: 'firma' });
  afipAuth.isProduction.mockResolvedValue(false);
  afipService.getLastVoucher.mockResolvedValue(0);
  afipService.getStatus.mockResolvedValue({ AppServer: 'OK', DbServer: 'OK', AuthServer: 'OK' });
});

/** La configuración mínima para que la verificación tenga qué ejercitar. */
function sembrarConfiguracionCompleta() {
  sembrar('afip_cuit', '30111111118');
  sembrar('afip_pv', '5');
  sembrar('afip_cert', PANADERIA.cert);
  sembrar('afip_key', PANADERIA.key);
}

// ════════════════════════════════════════════
//  T1401 · POST /api/afip/verificar
// ════════════════════════════════════════════

describe('POST /api/afip/verificar ejercita el circuito sin emitir nada', () => {
  it('llama al WSAA y al último autorizado, y NO emite ningún comprobante', async () => {
    sembrarConfiguracionCompleta();

    const res = await request(levantarApi()).post('/api/afip/verificar');

    expect(res.status).toBe(200);
    expect(afipAuth.getAccessTicket).toHaveBeenCalledWith(EMPRESA);

    // El tipo 6 y el punto de venta configurado. `FECompUltimoAutorizado`
    // **consulta**: no consume numeración y no genera ningún CAE. Es la
    // diferencia con `POST /afip/invoice`, que este hito borró.
    expect(afipService.getLastVoucher).toHaveBeenCalledWith(5, 6, EMPRESA);
  });

  it('un fallo del WSAA y un fallo del punto de venta dan mensajes distintos', async () => {
    // **El caso que separa dos trámites distintos de ARCA.** Un solo «no se pudo
    // conectar con AFIP» manda a revisar el certificado cuando lo que falta es
    // declarar el punto de venta, que se hace en otra pantalla del sitio de AFIP
    // y no tiene nada que ver con el certificado.
    sembrarConfiguracionCompleta();

    afipAuth.getAccessTicket.mockRejectedValueOnce(
      new Error('Error calling loginCms: CMS no es valido')
    );

    const wsaa = await request(levantarApi()).post('/api/afip/verificar');

    // Con el ticket caído, el punto de venta NI SE CONSULTA: el orden importa
    // porque el segundo paso necesita el ticket del primero.
    expect(wsaa.status).toBe(400);
    expect(afipService.getLastVoucher).not.toHaveBeenCalled();

    mockFilasDeSettings.length = 0;
    sembrarConfiguracionCompleta();

    afipService.getLastVoucher.mockRejectedValueOnce(
      new Error('Error al obtener último comprobante: [{"Code":602,"Msg":"Sin Resultados"}]')
    );

    const pv = await request(levantarApi()).post('/api/afip/verificar');

    expect(pv.status).toBe(400);
    expect(wsaa.body.error).not.toBe(pv.body.error);
    expect(wsaa.body.error).toMatch(/ticket de acceso/i);
    expect(pv.body.error).toMatch(/punto de venta 5/);
  });

  it('la evidencia se guarda también cuando el resultado es error', async () => {
    // «Probé y no anduvo» es un estado del checklist, no la ausencia de uno.
    // Guardando solo el `ok`, la pantalla no puede distinguir «nunca lo
    // intentaste» de «AFIP rechazó tu punto de venta», y las dos piden cosas
    // distintas.
    sembrarConfiguracionCompleta();

    afipService.getLastVoucher.mockRejectedValueOnce(new Error('Sin Resultados'));

    const res = await request(levantarApi()).post('/api/afip/verificar');

    expect(res.status).toBe(400);
    expect(evidencia()).toMatchObject({
      resultado: 'error',
      paso: 'punto_de_venta',
      cuit: '30111111118',
      pv: 5,
    });
  });

  it('la huella guardada es la del CERTIFICADO y nunca la de la clave privada', async () => {
    // `settings` sale por `GET /api/settings` para cualquiera con `config.ver`:
    // un hash de la clave privada ahí sería material derivado de la clave
    // viajando por el mismo cable que este hito viene de cerrar. El certificado
    // es público; la clave, no.
    const { huellaDelCertificado } = require('../services/afipVerificacion');

    sembrarConfiguracionCompleta();

    await request(levantarApi()).post('/api/afip/verificar');

    expect(evidencia().certificado).toBe(huellaDelCertificado(PANADERIA.cert));
    expect(evidencia().certificado).not.toBe(huellaDelCertificado(PANADERIA.key));

    // Y el PEM entero tampoco viaja adentro de la evidencia.
    expect(JSON.stringify(evidencia())).not.toContain('-----BEGIN');
  });

  it('el cero del último autorizado se guarda como cero, no como «no hay dato»', async () => {
    // Es la respuesta normal de una empresa que todavía no facturó, y es un
    // resultado VÁLIDO: el punto de venta existe. Un `|| null` la convertiría en
    // «no se pudo leer» y el checklist diría que falta verificar.
    sembrarConfiguracionCompleta();
    afipService.getLastVoucher.mockResolvedValueOnce(0);

    await request(levantarApi()).post('/api/afip/verificar');

    expect(evidencia().resultado).toBe('ok');
    expect(evidencia().ultimo_comprobante).toBe(0);
  });

  it('sin punto de venta cargado no llama a AFIP: dice qué falta', async () => {
    // Sin este caso, la falta de configuración se vería como un fallo de AFIP y
    // dejaría una evidencia de error que no corresponde a ningún intento real.
    sembrar('afip_cuit', '30111111118');
    sembrar('afip_cert', PANADERIA.cert);

    const res = await request(levantarApi()).post('/api/afip/verificar');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/punto de venta/i);
    expect(afipAuth.getAccessTicket).not.toHaveBeenCalled();
    expect(evidencia()).toBeNull();
  });
});

// ════════════════════════════════════════════
//  T1402 · las tres validaciones nuevas de POST /setup
// ════════════════════════════════════════════

describe('POST /api/afip/setup valida el material antes de guardarlo', () => {
  it('un certificado y una clave que no son pareja se rechazan en el guardado, no al facturar', async () => {
    // Los dos PEM son válidos por separado —es exactamente el caso que la
    // validación vieja dejaba pasar— y no corresponden entre sí.
    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ cert: PANADERIA.cert, key: OTRA_EMPRESA.key, cuit: '30111111118' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no son pareja/i);

    // Y no se escribió nada: media configuración guardada es una empresa que
    // cree estar lista y no puede firmar.
    expect(fila('afip_cert')).toBeUndefined();
    expect(fila('afip_key')).toBeUndefined();
  });

  it('la pareja correcta SÍ se guarda', async () => {
    // El contrapeso. Sin este caso, una validación que rechazara todo dejaría a
    // cualquier empresa sin poder cargar su certificado y el caso de arriba
    // seguiría en verde.
    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ cert: PANADERIA.cert, key: PANADERIA.key, cuit: '30111111118' });

    expect(res.status).toBe(200);
    expect(fila('afip_cert').value).toBe(PANADERIA.cert);
  });

  it('un certificado de otro CUIT avisa cuál es cuál', async () => {
    // El mensaje nombra los dos números a propósito: «el certificado no
    // corresponde» deja a quien lo lee sin saber si el que está mal es el CUIT
    // que tipeó o el archivo que subió.
    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ cert: OTRA_EMPRESA.cert, key: OTRA_EMPRESA.key, cuit: '30111111118' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('20999999997');
    expect(res.body.error).toContain('30111111118');
    expect(fila('afip_cert')).toBeUndefined();
  });

  it('el CUIT ya guardado también se compara, aunque el request no lo mande', async () => {
    // La pantalla postea el formulario entero, pero un cliente que mande solo el
    // certificado esquivaría la comparación si esta solo mirara el cuerpo.
    sembrar('afip_cuit', '30111111118');

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ cert: OTRA_EMPRESA.cert, key: OTRA_EMPRESA.key });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('20999999997');
  });

  it('cambiar el punto de venta lo consulta contra AFIP antes de guardarlo', async () => {
    // Un punto de venta que ARCA no tiene declarado como Web Services no falla
    // al guardarlo: falla al emitir, con alguien esperando su comprobante.
    sembrarConfiguracionCompleta();

    afipService.getLastVoucher.mockRejectedValueOnce(
      new Error('Error al obtener último comprobante: [{"Code":602,"Msg":"Sin Resultados"}]')
    );

    const res = await request(levantarApi()).post('/api/afip/setup').send({ pv: '9' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/punto de venta 9/);
    // Y el punto de venta viejo sigue siendo el viejo.
    expect(fila('afip_pv').value).toBe('5');
  });
});

// ════════════════════════════════════════════
//  T1403 · el bloqueo del pase a producción
// ════════════════════════════════════════════

describe('pasar a producción exige haber verificado el circuito', () => {
  it('sin verificar responde 400 CIRCUITO_NO_VERIFICADO y NO cambia el ambiente', async () => {
    // El caso completo: la empresa está en homologación, nunca verificó y nunca
    // facturó. Si el pase se colara, el primer comprobante fiscal real sería
    // también la primera prueba del circuito.
    sembrarConfiguracionCompleta();
    sembrar('afip_environment', 'homologation');

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CIRCUITO_NO_VERIFICADO');
    expect(fila('afip_environment').value).toBe('homologation');
  });

  it('con una verificación ok del MISMO punto de venta, pasa', async () => {
    sembrarConfiguracionCompleta();
    sembrar('afip_environment', 'homologation');
    sembrar('afip_verificacion', {
      resultado: 'ok', cuit: '30111111118', pv: 5, ambiente: 'homologation',
    });

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(200);
    expect(fila('afip_environment').value).toBe('production');
  });

  it('una verificación de OTRO punto de venta no cumple el paso', async () => {
    // Sin este caso, una comparación que solo mirara `resultado === 'ok'`
    // dejaría pasar a producción con el punto de venta cambiado después de
    // verificar — que es justamente la mitad del circuito que el paso 2 prueba.
    sembrarConfiguracionCompleta();
    sembrar('afip_environment', 'homologation');
    sembrar('afip_verificacion', {
      resultado: 'ok', cuit: '30111111118', pv: 3, ambiente: 'homologation',
    });

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CIRCUITO_NO_VERIFICADO');
  });

  it('una verificación con resultado error tampoco cumple el paso', async () => {
    sembrarConfiguracionCompleta();
    sembrar('afip_environment', 'homologation');
    sembrar('afip_verificacion', {
      resultado: 'error', cuit: '30111111118', pv: 5, paso: 'punto_de_venta',
    });

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(400);
  });

  it('una empresa que YA está en producción sigue guardando sin verificar nada', async () => {
    // ⚠⚠ **La línea que no se cruza.** El bloqueo es sobre la TRANSICIÓN. Quien
    // ya factura hoy no puede quedarse sin poder guardar su configuración —ni sin
    // facturar— por un requisito nuevo.
    sembrarConfiguracionCompleta();
    sembrar('afip_environment', 'production');
    afipAuth.isProduction.mockResolvedValue(true);

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production', tax_condition: 'RI' });

    expect(res.status).toBe(200);
    expect(fila('tax_condition').value).toBe('RI');
  });

  it('volver a homologación nunca se bloquea', async () => {
    // Es la salida de emergencia: si algo salió mal en producción, el camino de
    // vuelta no puede depender de una verificación.
    sembrarConfiguracionCompleta();
    sembrar('afip_environment', 'production');
    afipAuth.isProduction.mockResolvedValue(true);

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'homologation' });

    expect(res.status).toBe(200);
    expect(fila('afip_environment').value).toBe('homologation');
  });
});

// ════════════════════════════════════════════
//  T1404 · GET /status deja de ser «probar la conexión»
// ════════════════════════════════════════════

describe('GET /api/afip/status separa los servidores de ARCA de la verificación', () => {
  it('con FEDummy en OK y sin ninguna verificación, la respuesta NO dice que la facturación de esta empresa esté lista', async () => {
    // **El defecto A5.** `FEDummy` no lleva `Auth`: no firma con el certificado
    // de nadie. Responde OK con el certificado vencido, con la clave equivocada y
    // sin ningún certificado cargado — y la pantalla dibujaba «Conectado: API
    // operativa» encima.
    const res = await request(levantarApi()).get('/api/afip/status');

    expect(res.status).toBe(200);
    expect(res.body.data.servidores_afip).toEqual({
      AppServer: 'OK', DbServer: 'OK', AuthServer: 'OK',
    });

    // Y lo que decide el banner verde:
    expect(res.body.data.verificacion).toBeNull();

    // La forma también importa: un solo booleano `conectado` no permitiría
    // distinguir las dos cosas, y es la mutación que pone esto en rojo.
    expect(res.body.data).not.toHaveProperty('conectado');
  });

  it('devuelve el ambiente, que es lo que decide el aviso de validez fiscal', async () => {
    afipAuth.isProduction.mockResolvedValue(false);

    const res = await request(levantarApi()).get('/api/afip/status');

    expect(res.body.data.ambiente).toBe('homologation');
  });

  it('si los servidores de ARCA no contestan, la evidencia sale igual', async () => {
    // El estado de la empresa no depende de que AFIP esté arriba: es un dato
    // guardado. Un 502 acá dejaría la pantalla sin checklist justo el día que
    // AFIP se cae, que es cuando más se la mira.
    sembrar('afip_verificacion', { resultado: 'ok', cuit: '30111111118', pv: 5 });
    afipService.getStatus.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const res = await request(levantarApi()).get('/api/afip/status');

    expect(res.status).toBe(200);
    expect(res.body.data.servidores_afip).toBeNull();
    expect(res.body.data.error_servidores).toMatch(/servidores de ARCA/i);
    expect(res.body.data.verificacion.resultado).toBe('ok');
  });
});
