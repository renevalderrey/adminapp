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
