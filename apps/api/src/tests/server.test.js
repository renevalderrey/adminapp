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

  // ── Por qué se prueba el preflight y no el PATCH ──
  //
  // Un método que falta en `methods` no rompe ninguna prueba de la ruta: ni
  // supertest ni curl hacen preflight, así que `PATCH /api/products/publicables`
  // contesta perfecto en verde mientras el navegador ni siquiera lo manda. El
  // único lugar donde el agujero se ve es la respuesta al OPTIONS.
  //
  // Se recorren los métodos que el router usa de verdad: agregar un
  // `router.patch` nuevo con la lista corta vuelve a romper la pantalla igual.
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'el preflight permite %s',
    async (metodo) => {
      const res = await request(app)
        .options('/api/products/publicables')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', metodo);

      expect(res.headers['access-control-allow-methods']).toContain(metodo);
    }
  );
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

describe('GET /api/health', () => {
  // /api/ping solo dice que el proceso responde. Render lo usaba como
  // healthcheck, con lo cual el servicio figuraba sano aunque Postgres
  // estuviera caido y cada request devolviera 500.
  it('responde con el estado de la base de datos', async () => {
    const res = await request(app).get('/api/health');

    // Sin base disponible en el entorno de test, se espera 503; con base, 200.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('base_de_datos');
    expect(res.body).toHaveProperty('latencia_ms');
  });

  it('devuelve 503 y ok:false cuando la base no responde', async () => {
    const res = await request(app).get('/api/health');

    if (res.status === 503) {
      expect(res.body.ok).toBe(false);
      expect(res.body.base_de_datos).toBe('error');
    } else {
      expect(res.body.ok).toBe(true);
      expect(res.body.base_de_datos).toBe('ok');
    }
  });

  // El healthcheck lo consulta la plataforma sin sesion.
  it('no exige autenticacion', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
