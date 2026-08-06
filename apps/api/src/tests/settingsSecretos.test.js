// ════════════════════════════════════════════
//  La clave privada de AFIP no sale por la API
//
//  `GET /api/settings` devolvía la tabla `settings` entera. Entre esas filas
//  viajaban **la clave privada de AFIP en claro**, su certificado y el token de
//  TiendaNube — a cualquiera con `config.ver`, que incluye al rol `gerente`. Y
//  la pantalla las pide al montar y las mete en el store global, así que además
//  quedaban en memoria del navegador.
//
//  La clave privada es lo que firma los comprobantes fiscales de la empresa:
//  quien la tenga puede facturar en su nombre.
//
//  **La lista de exclusión ya estaba escrita** en `scripts/backup.js`, porque
//  ahí alguien pensó «esto no va en un respaldo». El endpoint que se lo mandaba
//  al navegador no la usaba. Ahora vive en `utils/settingsSecretos.js` y la
//  importan los dos.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { crearModelo } = require('./helpers/modelosFalsos');

const EMPRESA = 4;

const mockSettingModelo = crearModelo([]);
const mockStockModelo = crearModelo([]);
const mockProductModelo = crearModelo([]);
const mockPuntoDeVentaModelo = crearModelo([]);
const mockBrandModelo = crearModelo([]);
const mockFixedExpenseModelo = crearModelo([]);
const mockSupplierModelo = crearModelo([]);

jest.mock('../models', () => ({
  Setting: mockSettingModelo,
  Stock: mockStockModelo,
  Product: mockProductModelo,
  PuntoDeVenta: mockPuntoDeVentaModelo,
  Brand: mockBrandModelo,
  FixedExpense: mockFixedExpenseModelo,
  Supplier: mockSupplierModelo,
}));

const general = require('../routes/general');

function levantarApi() {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = EMPRESA;
    req.userId = 'auth0|quien-mira';
    req.id = 'req-de-prueba';
    // `GET /settings` mezcla las filas con `empresa.settings`. Sin esto el
    // handler lee de undefined y el caso pasaría por el motivo equivocado.
    req.empresa = { settings: {} };
    siguiente();
  });
  api.use('/api', general);
  return api;
}

const CLAVE_PRIVADA = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----';

describe('La clave privada de AFIP no sale por GET /api/settings', () => {
  beforeEach(() => {
    mockSettingModelo.filas = [
      { key: 'afip_cuit', value: '20304050607', empresa_id: EMPRESA },
      { key: 'afip_key', value: CLAVE_PRIVADA, empresa_id: EMPRESA },
      { key: 'afip_cert', value: '-----BEGIN CERTIFICATE-----\nMIID...', empresa_id: EMPRESA },
      { key: 'tiendanube_access_token', value: 'tn_secreto_de_la_tienda', empresa_id: EMPRESA },
    ];
  });

  it('el listado NO trae la clave privada, ni el certificado, ni el token de la tienda', async () => {
    const res = await request(levantarApi()).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('afip_key');
    expect(res.body.data).not.toHaveProperty('afip_cert');
    expect(res.body.data).not.toHaveProperty('tiendanube_access_token');

    // Y la mitad que un `not.toHaveProperty` no cubre: que el valor no aparezca
    // por ningún otro camino —anidado, renombrado, adentro de otro campo—.
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(res.body)).not.toContain('tn_secreto_de_la_tienda');
  });

  it('sigue trayendo lo que NO es secreto', async () => {
    // Sin este caso, un handler que devolviera un objeto vacío pasaría el
    // anterior — y dejaría la pantalla de Ajustes sin ningún dato.
    const res = await request(levantarApi()).get('/api/settings');

    expect(res.body.data.afip_cuit).toBe('20304050607');
  });

  it('dice si hay algo cargado, sin decir qué', async () => {
    // La pantalla necesita distinguir «todavía no subiste el certificado» de «ya
    // está subido». Sin la bandera, la única salida sería pedir que lo suban de
    // nuevo cada vez, o dibujar «cargado» sin saberlo.
    const res = await request(levantarApi()).get('/api/settings');

    expect(res.body.data.afip_key_cargado).toBe(true);
    expect(res.body.data.afip_cert_cargado).toBe(true);
    expect(res.body.data.tiendanube_access_token_cargado).toBe(true);
  });

  it('la bandera dice false cuando NO hay nada cargado', async () => {
    mockSettingModelo.filas = [{ key: 'afip_cuit', value: '20304050607', empresa_id: EMPRESA }];

    const res = await request(levantarApi()).get('/api/settings');

    expect(res.body.data.afip_key_cargado).toBe(false);
  });
});

describe('GET /api/settings/:key tampoco la devuelve', () => {
  beforeEach(() => {
    mockSettingModelo.filas = [
      { key: 'afip_key', value: CLAVE_PRIVADA, empresa_id: EMPRESA },
      { key: 'afip_cuit', value: '20304050607', empresa_id: EMPRESA },
    ];
  });

  it('pedirla por su nombre NO la trae', async () => {
    // Era la puerta más cómoda: devolvía la clave sola, sin nada alrededor.
    const res = await request(levantarApi()).get('/api/settings/afip_key');

    expect(res.body.data).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
  });

  it('pero sí dice que está cargada: que exista no es el secreto', async () => {
    const res = await request(levantarApi()).get('/api/settings/afip_key');

    expect(res.body.cargado).toBe(true);
  });

  it('una clave que no es secreta se sigue leyendo igual', async () => {
    const res = await request(levantarApi()).get('/api/settings/afip_cuit');

    expect(res.body.data).toBe('20304050607');
  });
});

describe('PUT /api/settings/:key no escribe material fiscal', () => {
  beforeEach(() => {
    mockSettingModelo.filas = [];
  });

  it('escribir la clave por el endpoint generico responde 400 y NO guarda nada', async () => {
    // `POST /api/afip/setup` valida el certificado, comprueba que se
    // corresponda con la clave e **invalida el ticket WSAA en curso**. Sin lo
    // último, AFIP sigue firmando con el ticket viejo y el certificado nuevo no
    // tiene efecto, con la pantalla diciendo que se guardó.
    const res = await request(levantarApi())
      .put('/api/settings/afip_key')
      .send({ value: CLAVE_PRIVADA });

    expect(res.status).toBe(400);
    expect(mockSettingModelo.filas).toEqual([]);
  });

  it('el mensaje dice adónde ir, no solo que no se puede', async () => {
    const res = await request(levantarApi())
      .put('/api/settings/afip_key')
      .send({ value: CLAVE_PRIVADA });

    expect(res.body.error).toMatch(/Ajustes/i);
  });

  it('una clave que no es secreta se sigue escribiendo', async () => {
    const res = await request(levantarApi())
      .put('/api/settings/margin_efectivo')
      .send({ value: '45' });

    expect(res.status).toBe(200);
    expect(mockSettingModelo.filas).toHaveLength(1);
  });
});

// ════════════════════════════════════════════
//  El ambiente y el punto de venta tampoco se escriben por acá
//
//  `01fc77d` cerró la fuga de la clave y de paso bloqueó su escritura, pero el
//  hallazgo tenía dos mitades y esta quedó abierta: `afip_environment` y
//  `afip_pv` **no son secretas** —la pantalla las lee para dibujarse— así que la
//  lista de secretos no las tapa, y `PUT /api/settings/afip_environment` con
//  `"production"` seguía funcionando.
//
//  Lo que eso compraba: pasar una empresa a producción —comprobantes fiscales
//  reales, numeración correlativa consumida— salteando todas las validaciones de
//  `POST /api/afip/setup`, y **sin invalidar el ticket WSAA cacheado**, que se
//  había emitido contra homologación.
// ════════════════════════════════════════════

describe('PUT /api/settings/:key no cambia el ambiente ni el punto de venta de AFIP', () => {
  beforeEach(() => {
    mockSettingModelo.filas = [];
  });

  it('pasar la empresa a producción por el endpoint genérico responde 400 y NO guarda nada', async () => {
    // Es el caso concreto: una empresa en homologación queda emitiendo
    // comprobantes fiscales de verdad, sin que nadie haya validado el punto de
    // venta y con el ticket WSAA de homologación todavía en memoria.
    const res = await request(levantarApi())
      .put('/api/settings/afip_environment')
      .send({ value: 'production' });

    expect(res.status).toBe(400);
    expect(mockSettingModelo.filas).toEqual([]);
  });

  it('el punto de venta tampoco: ARCA lo tiene que tener declarado', async () => {
    // Un `afip_pv` que ARCA no conoce no falla acá: falla al emitir, con el
    // cliente en el mostrador.
    const res = await request(levantarApi())
      .put('/api/settings/afip_pv')
      .send({ value: '9' });

    expect(res.status).toBe(400);
    expect(mockSettingModelo.filas).toEqual([]);
  });

  it('la evidencia de la verificación la escribe el servidor, no el cliente', async () => {
    // `afip_verificacion` es lo que va a cumplir el paso 4 del checklist de
    // puesta en marcha. Una evidencia que el cliente puede escribir a mano no es
    // evidencia de nada: alcanzaría un PUT para declararse verificado.
    const res = await request(levantarApi())
      .put('/api/settings/afip_verificacion')
      .send({ value: { resultado: 'ok' } });

    expect(res.status).toBe(400);
    expect(mockSettingModelo.filas).toEqual([]);
  });

  it('el mensaje nombra el camino y dice qué hace ese camino que éste no', async () => {
    // «No se puede» manda a alguien a buscar por qué. El mensaje tiene que
    // decir adónde ir y qué se gana yendo: la validación del punto de venta y la
    // renovación del ticket.
    const res = await request(levantarApi())
      .put('/api/settings/afip_environment')
      .send({ value: 'production' });

    expect(res.body.error).toMatch(/Ajustes/i);
    expect(res.body.error).toMatch(/ticket/i);
  });

  it('una clave de AFIP que NO es de solo lectura se sigue escribiendo', async () => {
    // Sin este caso, un `if` que rechazara todo lo que empiece con `afip_`
    // pasaría los cuatro de arriba y rompería el CUIT y la condición fiscal, que
    // sí se cargan desde el formulario genérico.
    const res = await request(levantarApi())
      .put('/api/settings/afip_cuit')
      .send({ value: '20304050607' });

    expect(res.status).toBe(200);
    expect(mockSettingModelo.filas).toHaveLength(1);
  });
});

describe('La lista de secretos vive en UN solo lugar', () => {
  const RAIZ = path.join(__dirname, '..', '..');

  // Ancla: si el archivo compartido desaparece o cambia de nombre, esto falla en
  // vez de pasar por vacío.
  it('el módulo compartido existe y nombra las tres claves', () => {
    const { SETTINGS_SECRETOS } = require('../utils/settingsSecretos');

    expect(SETTINGS_SECRETOS).toEqual(
      expect.arrayContaining(['afip_key', 'afip_cert', 'tiendanube_access_token'])
    );
  });

  it('las dos listas son distintas: lo de solo lectura SÍ sale por la API', () => {
    // Ancla contra la simplificación de juntarlas. Si `afip_environment` cayera
    // en `SETTINGS_SECRETOS`, `sinSecretos` lo convertiría en
    // `afip_environment_cargado: true` y la pantalla de Ajustes → Facturación se
    // quedaría sin saber contra qué ambiente factura la empresa.
    const {
      SETTINGS_SECRETOS,
      SETTINGS_DE_SOLO_LECTURA,
      esDeSoloLectura,
      sinSecretos,
    } = require('../utils/settingsSecretos');

    expect(SETTINGS_DE_SOLO_LECTURA).toEqual(['afip_environment', 'afip_pv', 'afip_verificacion']);

    for (const clave of SETTINGS_DE_SOLO_LECTURA) {
      expect(SETTINGS_SECRETOS).not.toContain(clave);
      expect(esDeSoloLectura(clave)).toBe(true);
    }

    expect(esDeSoloLectura('afip_cuit')).toBe(false);
    expect(sinSecretos({ afip_environment: 'production' }).afip_environment).toBe('production');
  });

  it('nadie más declara su propia lista', () => {
    // La lista estuvo escrita SOLO en scripts/backup.js durante meses, mientras
    // el endpoint que la mandaba al navegador no la tenía. Dos listas iguales en
    // dos archivos empiezan iguales y terminan distintas — y ésta ni siquiera
    // llegó a existir del otro lado.
    const archivos = [
      path.join(RAIZ, 'scripts', 'backup.js'),
      path.join(RAIZ, 'src', 'routes', 'general.js'),
    ];

    const culpables = [];

    for (const archivo of archivos) {
      const texto = fs.readFileSync(archivo, 'utf8');

      // Declarar el literal de nuevo, en vez de importarlo.
      if (/=\s*\[[^\]]*'afip_key'[^\]]*\]/.test(texto)) {
        culpables.push(path.relative(RAIZ, archivo));
      }

      expect(texto).toContain('settingsSecretos');
    }

    expect(culpables).toEqual([]);
  });
});
