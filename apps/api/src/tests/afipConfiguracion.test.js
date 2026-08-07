// ════════════════════════════════════════════
//  AFIP · la configuración se escribe por un solo lugar, y nadie emite por afuera
//
//  Dos garantías, y las dos son sobre superficie que **produce hechos fiscales
//  irreversibles**.
//
//  ── 1. Escribir el ambiente sin invalidar el ticket WSAA ──
//
//  El ticket de acceso se cachea por empresa (`services/afipAuth.js:30`) y se
//  emitió contra un certificado y un ambiente concretos. Guardar credenciales o
//  ambiente nuevos y dejar el ticket viejo en memoria hace que AFIP siga
//  recibiendo firmas con el material anterior hasta que el ticket vence —doce
//  horas—, **con la pantalla diciendo que se guardó**. No falla al guardar:
//  falla al emitir, que es cuando hay alguien esperando su factura.
//
//  Hasta este corte `invalidarCache` era una línea suelta adentro del handler de
//  `POST /setup`: la garantía valía para ese handler y para ninguno más. Y ya
//  había un segundo camino —`PUT /api/settings/:key`— que escribía
//  `afip_environment` sin pasar por ahí. Ahora la escritura y la invalidación
//  viven en la misma función y la guardia de más abajo verifica que siga siendo
//  la única que toca esa clave.
//
//  ── 2. `POST /api/afip/invoice` ──
//
//  Emitía un comprobante fiscal real con `type`, `amount` y `pv` del cuerpo, sin
//  crear ninguna `Sale`, con `ventas.crear` —el permiso del rol `vendedor`—. Un
//  comprobante emitido consume numeración correlativa y para darlo de baja hace
//  falta una nota de crédito, que este sistema no emite. Se borró; lo que sigue
//  verifica que **no vuelva**, ni con ese nombre ni con otro: la guardia es sobre
//  quién puede llamar a `afipService.createVoucher`.
//
//  ── Por qué las dos guardias son estáticas ──
//
//  `src/tests/setup.js` enciende `BYPASS_AUTH`, así que dentro de esta suite un
//  endpoint con `checkPermission('ventas.crear')` y uno sin nada se comportan
//  igual: ningún test de ejecución puede afirmar que emitir esté restringido.
//  Lo que sí se puede afirmar leyendo el fuente es que **no haya** un segundo
//  emisor. Es el mismo razonamiento que abre `permisosDeRutas.test.js`.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const EMPRESA = 4;

// ── Dobles locales ──
//
// `helpers/modelosFalsos.js` no tiene `upsert` y es un archivo compartido: se
// arma acá el mínimo que este handler necesita, con las filas observables desde
// el test.
// ⚠ El prefijo `mock` no es estilo: `jest.mock` se iza arriba de todo y jest
// solo deja que su fábrica mire variables que empiecen así.
const mockFilasDeSettings = [];

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
  },
  Empresa: {
    async findByPk() {
      return { name: 'Panadería del Centro', cuit: '30111111118' };
    },
  },
  // Desde el corte 9, `POST /setup` consulta si la empresa tiene alguna venta
  // con CAE antes de dejarla pasar a producción: un comprobante autorizado es
  // prueba de que el circuito funciona. Acá siempre devuelve `null` —esta
  // empresa nunca facturó— para que lo que decida el bloqueo sea la evidencia
  // sembrada y no un CAE de fondo.
  Sale: {
    async findOne() {
      return null;
    },
  },
  // La transacción real no aporta nada acá —lo que se afirma es la invalidación
  // del ticket, no el commit— y montarla exigiría una base.
  sequelize: {
    async transaction(callback) {
      return callback('TX');
    },
  },
}));

const afipRouter = require('../routes/afip');
const afipAuth = require('../services/afipAuth');

function levantarApi() {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = EMPRESA;
    req.userId = 'auth0|quien-configura';
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use('/api/afip', afipRouter);
  return api;
}

/**
 * La empresa con el circuito ya verificado contra AFIP.
 *
 * ⚠ **Hace falta desde el corte 9 y no es preparación de más.** Pasar a
 * producción sin haber verificado responde `400 CIRCUITO_NO_VERIFICADO`
 * (decisión 2 del usuario), así que los casos de este archivo —que son sobre la
 * invalidación del ticket, no sobre el bloqueo— tienen que partir de una empresa
 * que ya lo cumplió. El bloqueo tiene sus propios casos, en
 * `afipVerificacion.test.js` y en `afip.integracion.test.js`.
 *
 * El CUIT y el punto de venta de la evidencia son los mismos que los de las
 * filas: `estadoDelCircuito` compara los tres, y una evidencia de otro punto de
 * venta NO cumple el paso.
 */
function sembrarCircuitoVerificado(empresaId) {
  mockFilasDeSettings.push(
    { key: 'afip_cuit', empresa_id: empresaId, value: '30111111118' },
    { key: 'afip_pv', empresa_id: empresaId, value: '5' },
    {
      key: 'afip_verificacion',
      empresa_id: empresaId,
      value: {
        resultado: 'ok',
        cuit: '30111111118',
        pv: 5,
        ambiente: 'homologation',
        verificado_en: '2026-08-06T14:20:11.000Z',
      },
    }
  );
}

/** Un ticket WSAA cacheado, con una hora de vida por delante. */
function cachearTicket(empresaId) {
  afipAuth.taCache.set(empresaId, {
    token: 'token-viejo',
    sign: 'firma-vieja',
    expirationDate: new Date(Date.now() + 60 * 60 * 1000),
  });
}

beforeEach(() => {
  mockFilasDeSettings.length = 0;
  afipAuth.taCache.clear();
});

describe('Cambiar el ambiente invalida el ticket WSAA cacheado', () => {
  it('pasar a producción deja el ticket de homologación SIN efecto', async () => {
    // El caso completo: la empresa venía facturando contra homologación y su
    // ticket está en memoria. Si sobrevive al cambio, los comprobantes de las
    // próximas horas se firman contra el servidor de pruebas mientras la
    // pantalla dice «producción» — o sea, no tienen validez fiscal y nadie se
    // entera hasta que alguien pide su factura.
    sembrarCircuitoVerificado(EMPRESA);
    cachearTicket(EMPRESA);
    expect(afipAuth.taCache.has(EMPRESA)).toBe(true);

    const res = await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production' });

    expect(res.status).toBe(200);
    expect(afipAuth.taCache.has(EMPRESA)).toBe(false);
  });

  it('el ticket de OTRA empresa no se toca', async () => {
    // El cache es por empresa desde que una reutilizaba el ticket de otra.
    // Invalidar de más acá significaría que cada cambio de configuración de un
    // cliente le cuesta un viaje a WSAA a todos los demás.
    cachearTicket(EMPRESA);
    cachearTicket(99);

    await request(levantarApi()).post('/api/afip/setup').send({ environment: 'homologation' });

    expect(afipAuth.taCache.has(EMPRESA)).toBe(false);
    expect(afipAuth.taCache.has(99)).toBe(true);
  });

  it('el ambiente se guarda de verdad, no solo se invalida el cache', async () => {
    // Sin este caso, una implementación que invalidara el ticket y no escribiera
    // nada pasaría los dos de arriba.
    sembrarCircuitoVerificado(EMPRESA);

    await request(levantarApi()).post('/api/afip/setup').send({ environment: 'production' });

    const guardado = mockFilasDeSettings.find((f) => f.key === 'afip_environment');
    expect(guardado.value).toBe('production');
    expect(guardado.empresa_id).toBe(EMPRESA);
  });

  it('la cadena vacía se sigue salteando: guardar el ambiente NO borra el certificado', async () => {
    // FR-075 dice que esta guarda no se toca, y el refactor de este corte la
    // movió de lugar. El formulario de Ajustes arranca con `cert:''` y `key:''`
    // y postea el objeto entero: con solo cambiar el desplegable de ambiente se
    // ejecutaba `upsert({ value: '' })` sobre el certificado y la clave. Como la
    // clave del CSR no se guarda del lado del servidor, no había copia y había
    // que rehacer el trámite entero en ARCA.
    sembrarCircuitoVerificado(EMPRESA);
    mockFilasDeSettings.push({ key: 'afip_cert', empresa_id: EMPRESA, value: '-----BEGIN CERTIFICATE-----' });
    mockFilasDeSettings.push({ key: 'afip_key', empresa_id: EMPRESA, value: '-----BEGIN PRIVATE KEY-----' });

    await request(levantarApi())
      .post('/api/afip/setup')
      .send({ environment: 'production', cert: '', key: '' });

    expect(mockFilasDeSettings.find((f) => f.key === 'afip_cert').value).toBe('-----BEGIN CERTIFICATE-----');
    expect(mockFilasDeSettings.find((f) => f.key === 'afip_key').value).toBe('-----BEGIN PRIVATE KEY-----');
  });
});

describe('POST /api/afip/invoice ya no existe', () => {
  it('emitir un comprobante sin venta responde 404, no un CAE', async () => {
    // Lo que este endpoint producía no se deshace con un DELETE: consume
    // numeración correlativa y darlo de baja exige una nota de crédito, que este
    // sistema no emite.
    const res = await request(levantarApi())
      .post('/api/afip/invoice')
      .send({ type: 6, amount: 1, pv: 1 });

    expect(res.status).toBe(404);
  });

  it('leer un comprobante YA emitido sigue funcionando', async () => {
    // El contrapeso: `GET /invoice/:type/:pv/:number/data` comparte prefijo con
    // el que se borró y lo usa `pages/InvoicesList.jsx` para verificar una venta
    // contra AFIP. Borrar de más ahí rompería la verificación de comprobantes.
    const rutas = fs.readFileSync(path.join(__dirname, '..', 'routes', 'afip.js'), 'utf8');

    expect(rutas).toMatch(/router\.get\(\s*'\/invoice\/:type\/:pv\/:number\/data'/);
    expect(rutas).not.toMatch(/router\.post\(\s*'\/invoice'/);
  });
});

// ════════════════════════════════════════════
//  Guardias estáticas
// ════════════════════════════════════════════

const SRC = path.join(__dirname, '..');

function leerCarpeta(subdir) {
  const dir = path.join(SRC, subdir);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({
      nombre: `${subdir}/${f}`,
      contenido: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

/** true si la línea es un comentario. Los motivos de acá nombran lo que vigilan. */
const esComentario = (texto) => texto.startsWith('//') || texto.startsWith('*') || texto.startsWith('/*');

/** Las líneas que LLAMAN a createVoucher, con su número. */
function llamadasACreateVoucher(contenido) {
  return contenido
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => /createVoucher\s*\(/.test(texto) && !esComentario(texto))
    .map(({ n, texto }) => `L${n}: ${texto}`);
}

const MUESTRA_EMISORA_MALA = `
const express = require('express');
const router = express.Router();
const afipService = require('../services/afipService');

router.post('/invoice', checkPermission('ventas.crear'), async (req, res) => {
  const result = await afipService.createVoucher({
    type: parseInt(req.body.type, 10) || 6,
    empresaId: req.empresaId,
  });
  res.json({ ok: true, data: result });
});

module.exports = router;
`;

const MUESTRA_EMISORA_BUENA = `
const express = require('express');
const router = express.Router();

// Lo que este endpoint comprobaba lo comprueba POST /afip/verificar, que no
// llama a afipService.createVoucher( y por lo tanto no emite nada.
router.post('/verificar', checkPermission('config.editar'), async (req, res) => {
  const ultimo = await afipService.getLastVoucher(pv, tipo, req.empresaId);
  res.json({ ok: true, data: ultimo });
});

module.exports = router;
`;

describe('Ninguna ruta fuera de sales.js emite un comprobante', () => {
  const rutas = leerCarpeta('routes');

  it('el detector encuentra la llamada y la nombra con su línea', () => {
    // Sin esta muestra, un detector que dejara de reconocer la forma de la
    // llamada devolvería `[]` para todos los archivos y la guardia pasaría en
    // verde sin haber mirado nada.
    const hallazgos = llamadasACreateVoucher(MUESTRA_EMISORA_MALA);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain('L7:');
    expect(hallazgos[0]).toContain('afipService.createVoucher(');
  });

  it('nombrarla en un comentario no cuenta como llamarla', () => {
    // El motivo del borrado está escrito arriba del hueco que dejó, en
    // `routes/afip.js`, y nombra a `createVoucher`. Sin el filtro, la guardia
    // nacería en rojo por su propia explicación — y una guardia que empieza en
    // rojo por un comentario es una que alguien desactiva el mismo día.
    expect(llamadasACreateVoucher(MUESTRA_EMISORA_BUENA)).toEqual([]);
  });

  it('sales.js SÍ la llama, y por eso el detector no está mirando al vacío', () => {
    // **El ancla.** `POST /api/sales/:id/facturar` es el único emisor legítimo:
    // tiene la venta persistida, es idempotente y toma lock. Si esta prueba se
    // pone en rojo, el detector dejó de reconocer la forma y la de abajo pasó a
    // ser decorativa.
    const sales = rutas.find((a) => a.nombre === 'routes/sales.js');

    expect(llamadasACreateVoucher(sales.contenido).length).toBeGreaterThanOrEqual(1);
  });

  it.each(rutas.filter((a) => a.nombre !== 'routes/sales.js'))('$nombre', ({ contenido }) => {
    expect(llamadasACreateVoucher(contenido)).toEqual([]);
  });
});

// ════════════════════════════════════════════
//  El ambiente de AFIP se nombra en dos lugares, y los dos están declarados
//
//  La forma de reabrir el agujero no es escribir `invalidarCache` mal: es
//  escribir un segundo camino que guarde `afip_environment` y que nazca sin
//  ella. Por eso lo que se vigila es **cada mención de esa clave** en `routes/` y
//  `services/`, y no la presencia de una llamada.
//
//  Se afirma por igualdad exacta, como `ROUTERS_SIN_SESION` en
//  `permisosDeRutas.test.js`: una mención nueva pone esto en rojo con su archivo
//  y su línea, y quien la agregue tiene que escribir acá por qué es inocua —o
//  darse cuenta de que no lo es.
// ════════════════════════════════════════════

/** Las líneas que nombran una clave, fuera de comentarios. */
function mencionesDe(contenido, clave) {
  return contenido
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => texto.includes(`'${clave}'`) && !esComentario(texto))
    .map(({ n, texto }) => ({ n, texto }));
}

const MENCIONES_DECLARADAS = {
  'routes/afip.js':
    'Son DOS listas y ninguna es un escritor suelto. CLAVES_AFIP es la que recorre ' +
    'guardarConfiguracionAfip —el único lugar que escribe la configuración de AFIP, ' +
    'y el que invalida el ticket WSAA en la misma función—, y CLAVES_DE_LA_VINCULACION ' +
    'es lo que borra DELETE /vinculacion, que pasa por esa misma función para ' +
    'invalidar el ticket. Que la clave aparezca acá es el diseño, no la falla. Nótese ' +
    'que ni GET /status ni POST /verificar la nombran: leen el ambiente por ' +
    'afipAuth.isProduction, que es el mismo que decide contra qué servidor de AFIP se ' +
    'autentica, así que la evidencia no puede decir un ambiente y la llamada haber ' +
    'ido al otro.',
  'services/afipAuth.js':
    'Es una LECTURA: isProduction() consulta el ambiente para elegir contra qué ' +
    'WSDL de WSAA autenticarse. No escribe nada.',
};

const MUESTRA_ESCRITOR_NUEVO = `
const express = require('express');
const router = express.Router();

router.put('/ambiente', checkPermission('config.editar'), async (req, res) => {
  await Setting.upsert({ key: 'afip_environment', empresa_id: req.empresaId, value: req.body.value });
  res.json({ ok: true });
});
`;

describe('afip_environment solo se nombra donde está declarado', () => {
  const archivos = [...leerCarpeta('routes'), ...leerCarpeta('services')];

  it('leyó los dos directorios y ninguno vino vacío', () => {
    for (const subdir of ['routes', 'services']) {
      expect(archivos.filter((a) => a.nombre.startsWith(`${subdir}/`)).length).toBeGreaterThan(3);
    }
  });

  it('el detector ve un escritor nuevo y lo nombra con su línea', () => {
    const hallazgos = mencionesDe(MUESTRA_ESCRITOR_NUEVO, 'afip_environment');

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].n).toBe(6);
    expect(hallazgos[0].texto).toContain('Setting.upsert');
  });

  it('los archivos que la nombran son exactamente los dos declarados', () => {
    const conMencion = archivos
      .filter(({ contenido }) => mencionesDe(contenido, 'afip_environment').length > 0)
      .map(({ nombre }) => nombre)
      .sort();

    expect(conMencion).toEqual(Object.keys(MENCIONES_DECLARADAS).sort());

    for (const motivo of Object.values(MENCIONES_DECLARADAS)) {
      expect(motivo.length).toBeGreaterThan(40);
    }
  });

  it('en routes/general.js la clave solo vive en el `if` que la rechaza', () => {
    // `PUT /api/settings/:key` era el segundo camino, y el que este corte cerró.
    // Lo hace por la lista de `utils/settingsSecretos.js` y no por el literal, y
    // eso es lo que se afirma: si mañana alguien escribiera el literal acá, el
    // caso de arriba lo nombraría.
    const general = archivos.find((a) => a.nombre === 'routes/general.js');

    expect(general.contenido).toContain('esDeSoloLectura(req.params.key)');
    expect(mencionesDe(general.contenido, 'afip_environment')).toEqual([]);
  });
});

// ════════════════════════════════════════════
//  La escritura y la invalidación viven en la MISMA función
// ════════════════════════════════════════════

/** El cuerpo de una función declarada con `function nombre(`, por balanceo. */
function cuerpoDeFuncion(texto, nombre) {
  const declaracion = texto.indexOf(`function ${nombre}(`);
  if (declaracion === -1) return null;

  const abre = texto.indexOf('{', texto.indexOf(')', declaracion));
  if (abre === -1) return null;

  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}') {
      nivel--;
      if (nivel === 0) return texto.slice(abre, i + 1);
    }
  }
  return null;
}

describe('guardarConfiguracionAfip es el único escritor, y invalida el ticket', () => {
  const afip = fs.readFileSync(path.join(SRC, 'routes', 'afip.js'), 'utf8');

  it('el extractor sabe leer un cuerpo de función, y no devuelve el archivo entero', () => {
    // El ancla: sin esto, un `cuerpoDeFuncion` que devolviera todo el texto
    // dejaría las dos pruebas de abajo en verde para siempre —el archivo entero
    // contiene el upsert y la invalidación, estén donde estén—.
    const muestra = 'async function otra(a) {\n  return 1;\n}\nawait Setting.upsert({});';

    expect(cuerpoDeFuncion(muestra, 'otra')).toBe('{\n  return 1;\n}');
    expect(cuerpoDeFuncion(muestra, 'otra')).not.toContain('Setting.upsert');
  });

  it('el cuerpo de la función tiene el upsert Y la invalidación del ticket', () => {
    const cuerpo = cuerpoDeFuncion(afip, 'guardarConfiguracionAfip');

    expect(cuerpo).not.toBeNull();
    expect(cuerpo).toContain('Setting.upsert(');
    expect(cuerpo).toContain('afipAuth.invalidarCache(');
  });

  it('no hay ningún otro Setting.upsert en routes/afip.js', () => {
    // La forma real de reabrirlo: un handler nuevo que guarde «solo el punto de
    // venta» o «solo el CUIT» con su propio upsert, sin pasar por la función. El
    // ticket sobreviviría al cambio y la falla aparecería al emitir.
    const upserts = afip
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) => /Setting\.upsert\s*\(/.test(texto) && !esComentario(texto));

    expect(upserts).toHaveLength(1);

    const cuerpo = cuerpoDeFuncion(afip, 'guardarConfiguracionAfip');
    expect(cuerpo.split('\n').map((l) => l.trim())).toContain(upserts[0].texto);
  });
});
