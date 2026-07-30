// ════════════════════════════════════════════
//  Smoke tests del arranque de la API
//
//  Ejercitan la capa HTTP sin tocar la base: verifican que el arbol de
//  middlewares y rutas se ensambla y responde. Requerir server.js no abre
//  conexion a Postgres — eso pasa recien en start(), que solo corre cuando
//  el archivo se ejecuta directo.
// ════════════════════════════════════════════

const request = require('supertest');
const { app } = require('../server');

describe('GET /api/ping', () => {
  it('responde 200 sin autenticacion', async () => {
    const res = await request(app).get('/api/ping');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('incluye un timestamp ISO valido', async () => {
    const res = await request(app).get('/api/ping');

    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });
});

describe('CORS', () => {
  it('acepta el origen de desarrollo del frontend', async () => {
    const res = await request(app)
      .get('/api/ping')
      .set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('no devuelve cabecera de allow-origin para un origen desconocido', async () => {
    const res = await request(app)
      .get('/api/ping')
      .set('Origin', 'https://sitio-no-autorizado.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Cabeceras de seguridad', () => {
  it('helmet agrega X-Content-Type-Options', async () => {
    const res = await request(app).get('/api/ping');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Rutas inexistentes', () => {
  it('devuelve 404 en una ruta que no existe', async () => {
    const res = await request(app).get('/api/no-existe-esta-ruta');

    expect(res.status).toBe(404);
  });
});
