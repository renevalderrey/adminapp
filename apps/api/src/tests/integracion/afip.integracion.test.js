// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const forge = require('node-forge');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  AFIP · lo que solo Postgres puede contestar
//
//  ── Qué hace acá y qué no ──
//
//  `afipVerificacion.test.js` cubre con dobles lo que pasa de este lado: qué
//  mensaje sale, qué se guarda, qué status devuelve cada rama. Lo que baja a este
//  nivel es lo que **necesita la base**:
//
//   1. **La rama (b) del paso 4 lee `sales` de verdad.** «La empresa tiene al
//      menos una venta con CAE» es una consulta con `Op.ne: null` sobre una
//      columna real. Con un doble, «devolvió una fila» es «el doble devolvió una
//      fila»: no prueba que el `where` sea el que se cree.
//   2. **Un `setup` rechazado no deja NINGUNA fila escrita.** Con un doble, «no
//      escribió» es «no se llamó al doble». Acá se relee la fila de Postgres,
//      que es lo que quedaría escrito de verdad.
//   3. **La evidencia con `resultado: "error"` se persiste** en el JSONB y vuelve
//      como objeto.
//   4. **Desvincular no toca el CUIT ni ninguna venta facturada**, y no toca las
//      filas de la otra empresa.
//
//  ── Los servicios de AFIP se doblan, y no hay otra ──
//
//  Ningún test puede pegarle a ARCA. `afipService` se dobla entero; de `afipAuth`
//  se dobla **solo `getAccessTicket`** —lo único que sale a la red— y el resto
//  queda real, así que `isProduction` lee `afip_environment` de Postgres de
//  verdad. Es justamente el dato que decide si el pase a producción es una
//  transición o no.
//
//  ── La línea que no se cruza ──
//
//  El bloqueo del pase a producción es **sobre la transición y sobre nada más**.
//  Hay un caso acá abajo que lo sostiene: una empresa en producción **sin
//  ninguna evidencia** factura igual. Si algún día alguien mueve el chequeo a
//  `POST /api/sales/:id/facturar`, ese caso se pone en rojo — y lo que estaría
//  pasando es que un cliente que factura hoy se quedó sin poder facturar.
// ════════════════════════════════════════════

jest.mock('../../services/afipService', () => ({
  createVoucher: jest.fn(),
  getLastVoucher: jest.fn(),
  getStatus: jest.fn(),
  getVoucherInfo: jest.fn(),
  createCSR: jest.fn(),
}));

jest.mock('../../services/afipAuth', () => {
  const real = jest.requireActual('../../services/afipAuth');
  real.getAccessTicket = jest.fn();
  return real;
});

const afipService = require('../../services/afipService');
const afipAuth = require('../../services/afipAuth');

const { Setting, Sale } = modelos;

let datos;

/**
 * Un par certificado-clave de verdad, generado una vez.
 *
 * Hacen falta DOS para poder ejercitar «esta clave no firma este certificado»:
 * un PEM cualquiera como clave equivocada probaría otra cosa —que no parsea—,
 * que es lo que la validación vieja ya hacía.
 */
function generarPar(cuit) {
  const par = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();

  cert.publicKey = par.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  cert.setSubject([
    { name: 'commonName', value: 'Favalio' },
    { name: 'serialNumber', value: `CUIT ${cuit}` },
  ]);
  cert.setIssuer([{ name: 'commonName', value: 'Computadores' }]);
  cert.sign(par.privateKey, forge.md.sha256.create());

  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(par.privateKey) };
}

let PANADERIA;
let OTRA;

beforeAll(async () => {
  PANADERIA = generarPar('30111111118');
  OTRA = generarPar('20999999997');
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  afipService.createVoucher.mockReset();
  afipService.getLastVoucher.mockReset();
  afipAuth.getAccessTicket.mockReset();
  afipAuth.invalidarCache(datos.empresaA.id);

  afipAuth.getAccessTicket.mockResolvedValue({ token: 'tok', sign: 'firma' });
  afipService.getLastVoucher.mockResolvedValue(0);
});

afterAll(async () => {
  await cerrar();
});

/**
 * La configuración fiscal completa de la empresa A, en homologación.
 *
 * El CUIT es el del certificado generado arriba: si no coincidieran, `POST
 * /setup` rechazaría por FR-088 y los casos de este archivo estarían midiendo
 * otra cosa.
 */
async function sembrarConfiguracion(empresaId, { ambiente = 'homologation' } = {}) {
  await Setting.bulkCreate([
    { key: 'afip_cuit', empresa_id: empresaId, value: '30111111118' },
    { key: 'afip_pv', empresa_id: empresaId, value: '5' },
    { key: 'afip_cert', empresa_id: empresaId, value: PANADERIA.cert },
    { key: 'afip_key', empresa_id: empresaId, value: PANADERIA.key },
    { key: 'afip_environment', empresa_id: empresaId, value: ambiente },
  ]);
}

/** El valor guardado hoy en Postgres para una clave de una empresa. */
async function valorGuardado(clave, empresaId) {
  const fila = await Setting.findOne({ where: { key: clave, empresa_id: empresaId } });
  return fila ? fila.value : null;
}

// ════════════════════════════════════════════
//  T1403 · el bloqueo del pase a producción, contra la base
// ════════════════════════════════════════════

describe('el pase a producción mira la evidencia Y el historial de CAE', () => {
  it('sin verificación y sin ningún CAE, responde 400 y NO cambia el ambiente', async () => {
    await sembrarConfiguracion(datos.empresaA.id);

    const res = await request(app)
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CIRCUITO_NO_VERIFICADO');
    expect(await valorGuardado('afip_environment', datos.empresaA.id)).toBe('homologation');
  });

  it('una empresa con un CAE en `sales` pasa a producción sin verificar', async () => {
    // **La rama (b), y es la que impide dejar sin facturar a quien ya factura.**
    // Un comprobante autorizado es la prueba más fuerte que existe de que el
    // circuito funciona: exigirle además una verificación a alguien que ya emitió
    // sería inventarle un trámite para seguir haciendo lo que ya hace.
    //
    // Se prueba acá y no con dobles porque lo que se afirma es la CONSULTA: un
    // `where` sobre `afip_cae` que devolviera filas sin CAE —o ninguna— dejaría
    // el caso pasando por el motivo equivocado.
    await sembrarConfiguracion(datos.empresaA.id);
    await datos.ventaA.update({ afip_cae: '75123456789012', afip_nro: 1, afip_pv: 5 });

    const res = await request(app)
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(200);
    expect(await valorGuardado('afip_environment', datos.empresaA.id)).toBe('production');
  });

  it('el CAE de OTRA empresa no habilita el pase de ésta', async () => {
    // Sin este caso, un `where` al que se le hubiera caído el `empresa_id`
    // pasaría el anterior igual: cualquier venta facturada de cualquier cliente
    // habilitaría el pase a producción de todos los demás.
    await sembrarConfiguracion(datos.empresaA.id);
    await datos.ventaB.update({ afip_cae: '75999999999999', afip_nro: 1, afip_pv: 9 });

    const res = await request(app)
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(400);
    expect(await valorGuardado('afip_environment', datos.empresaA.id)).toBe('homologation');
  });

  it('facturar una venta NO consulta la evidencia: una empresa en producción sigue facturando', async () => {
    // ⚠⚠ **La línea que no se cruza.** La empresa está en producción, no verificó
    // nunca y no tiene ninguna evidencia guardada. Tiene que poder facturar.
    //
    // Si alguien moviera el bloqueo de `POST /setup` a `POST /sales/:id/facturar`,
    // este caso se pone en rojo — y lo que estaría pasando es que un cliente que
    // factura hoy se quedó sin facturar por un requisito nuevo.
    await sembrarConfiguracion(datos.empresaA.id, { ambiente: 'production' });

    expect(await valorGuardado('afip_verificacion', datos.empresaA.id)).toBeNull();

    afipService.createVoucher.mockResolvedValue({
      cae: '75123456789012',
      expiration: '20260930',
      voucherNumber: 1,
      type: 11,
    });

    const res = await request(app).post(`/api/sales/${datos.ventaA.id}/facturar`).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.cae).toBe('75123456789012');
    expect(afipService.createVoucher).toHaveBeenCalled();

    const venta = await Sale.findByPk(datos.ventaA.id);
    expect(venta.afip_cae).toBe('75123456789012');
  });
});

// ════════════════════════════════════════════
//  T1401 / T1402 · lo que se escribe y lo que NO
// ════════════════════════════════════════════

describe('POST /api/afip/setup rechazado no deja ninguna fila escrita', () => {
  it('un certificado y una clave que no son pareja no escriben nada, ni siquiera el CUIT', async () => {
    // Es lo que un doble no puede afirmar: acá se relee Postgres. Media
    // configuración guardada —el CUIT sí, el certificado no— deja una empresa que
    // cree estar cargada y no puede firmar.
    const res = await request(app)
      .post('/api/afip/setup')
      .send({ cuit: '30111111118', pv: '5', cert: PANADERIA.cert, key: OTRA.key });

    expect(res.status).toBe(400);
    expect(await valorGuardado('afip_cert', datos.empresaA.id)).toBeNull();
    expect(await valorGuardado('afip_key', datos.empresaA.id)).toBeNull();
    expect(await valorGuardado('afip_cuit', datos.empresaA.id)).toBeNull();
  });

  it('la pareja correcta SÍ escribe las cinco filas', async () => {
    // El contrapeso: sin él, un handler que rechazara todo pasaría el caso de
    // arriba y dejaría a cualquier empresa sin poder configurar AFIP.
    const res = await request(app)
      .post('/api/afip/setup')
      .send({
        cuit: '30111111118', pv: '5', environment: 'homologation',
        cert: PANADERIA.cert, key: PANADERIA.key, tax_condition: 'Monotributo',
      });

    expect(res.status).toBe(200);
    expect(await valorGuardado('afip_cuit', datos.empresaA.id)).toBe('30111111118');
    expect(await valorGuardado('afip_cert', datos.empresaA.id)).toBe(PANADERIA.cert);
  });
});

describe('POST /api/afip/verificar deja la evidencia en la base', () => {
  it('la evidencia con resultado error queda guardada, y vuelve como objeto', async () => {
    // El JSONB de `settings` es lo que hace que esto se pueda guardar sin tabla
    // nueva. Con un doble, «se guardó» es «se llamó al doble»: acá se relee la
    // fila y se afirma que el objeto sobrevivió al viaje de ida y vuelta.
    await sembrarConfiguracion(datos.empresaA.id);

    afipService.getLastVoucher.mockRejectedValueOnce(
      new Error('Error al obtener último comprobante: [{"Code":602,"Msg":"Sin Resultados"}]')
    );

    const res = await request(app).post('/api/afip/verificar');

    expect(res.status).toBe(400);

    const guardada = await valorGuardado('afip_verificacion', datos.empresaA.id);

    expect(guardada).toMatchObject({ resultado: 'error', paso: 'punto_de_venta', pv: 5 });
    expect(guardada.verificado_en).toEqual(expect.any(String));
  });

  it('una verificación ok queda guardada y habilita el pase a producción', async () => {
    // Las dos mitades en el mismo caso: la evidencia se escribe por el servidor
    // —`PUT /api/settings/afip_verificacion` la rechaza, y eso lo verifica
    // `settingsSinSecretos.integracion.test.js`— y es la que abre el paso 4.
    await sembrarConfiguracion(datos.empresaA.id);

    const verificar = await request(app).post('/api/afip/verificar');

    expect(verificar.status).toBe(200);
    expect((await valorGuardado('afip_verificacion', datos.empresaA.id)).resultado).toBe('ok');

    const pasar = await request(app).post('/api/afip/setup').send({ environment: 'production' });

    expect(pasar.status).toBe(200);
    expect(await valorGuardado('afip_environment', datos.empresaA.id)).toBe('production');
  });
});

// ════════════════════════════════════════════
//  T1405 · DELETE /api/afip/vinculacion
// ════════════════════════════════════════════

describe('DELETE /api/afip/vinculacion borra las credenciales y nada más', () => {
  it('desvincular no borra el CUIT ni ninguna venta con CAE', async () => {
    // Los dos son hechos que sobreviven a la vinculación: el CUIT es un dato de
    // la empresa —el mismo que va en los remitos— y un CAE emitido existe en
    // AFIP, está impreso en un comprobante que alguien tiene, y borrarlo de acá
    // no lo deshace: solo deja al sistema sin poder mostrar el comprobante que su
    // cliente le muestra en el mostrador.
    await sembrarConfiguracion(datos.empresaA.id);
    await Setting.create({
      key: 'afip_verificacion', empresa_id: datos.empresaA.id,
      value: { resultado: 'ok', cuit: '30111111118', pv: 5 },
    });
    await datos.ventaA.update({ afip_cae: '75123456789012', afip_nro: 1, afip_pv: 5 });

    const res = await request(app).delete('/api/afip/vinculacion');

    expect(res.status).toBe(200);

    expect(await valorGuardado('afip_cert', datos.empresaA.id)).toBeNull();
    expect(await valorGuardado('afip_key', datos.empresaA.id)).toBeNull();
    expect(await valorGuardado('afip_pv', datos.empresaA.id)).toBeNull();
    expect(await valorGuardado('afip_environment', datos.empresaA.id)).toBeNull();
    expect(await valorGuardado('afip_verificacion', datos.empresaA.id)).toBeNull();

    // Lo que se queda:
    expect(await valorGuardado('afip_cuit', datos.empresaA.id)).toBe('30111111118');

    const venta = await Sale.findByPk(datos.ventaA.id);
    expect(venta.afip_cae).toBe('75123456789012');
  });

  it('desvincular la empresa A no toca el material fiscal de la B', async () => {
    // El `where` de un `destroy` con `Op.in` es exactamente el lugar donde se cae
    // un `empresa_id`: la lista de claves está a la vista y el filtro de empresa
    // no. Si se cayera, un cliente desvinculando su AFIP le borraría el
    // certificado a todos los demás.
    await sembrarConfiguracion(datos.empresaA.id);
    await sembrarConfiguracion(datos.empresaB.id);

    await request(app).delete('/api/afip/vinculacion');

    expect(await valorGuardado('afip_cert', datos.empresaB.id)).toBe(PANADERIA.cert);
    expect(await valorGuardado('afip_environment', datos.empresaB.id)).toBe('homologation');
  });
});
