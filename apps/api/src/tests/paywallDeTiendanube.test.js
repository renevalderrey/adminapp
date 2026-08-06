// ════════════════════════════════════════════
//  El paywall no se elude entrando por TiendaNube
//
//  `checkSubscription` tenía `/api/tiendanube` entero en `EXEMPT_PREFIXES`, y
//  con `startsWith` eso eximía a las ONCE rutas privadas de la integración:
//  una empresa con la suscripción vencida seguía listando su catálogo, creando
//  mapeos y empujando stock a su tienda online. Es la tercera aparición de la
//  misma forma —el paywall que se rodea por una puerta lateral— que
//  `CONVENCIONES.md` cita entre los tres errores más caros del proyecto.
//
//  ⚠ **Acá NO hay un test de «el webhook sigue funcionando con la suscripción
//  vencida», y la ausencia es deliberada.** `/callback` y `/webhook` viven en
//  el router `publico`, que `server.js` monta **sin** la cadena `authEmpresa`;
//  Express atiende con el primer montaje que matchee, así que esas dos rutas
//  **nunca llegan a este middleware**. Un test que las afirmara pasaría igual
//  con `EXEMPT_PREFIXES` vacío: no probaría lo que dice probar, que es
//  exactamente la clase de test que este repositorio ya juntó veinte veces.
//
//  Lo que sí se verifica es lo contrario —las once privadas cortadas— y, de la
//  exención de las dos públicas, el mecanismo real: que el montaje del router
//  `publico` siga sin `authEmpresa`.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { crearModelo } = require('./helpers/modelosFalsos');

const mockSuscripcion = crearModelo([]);

jest.mock('../models', () => ({ Suscripcion: mockSuscripcion }));

const checkSubscription = require('../middleware/checkSubscription');

const EMPRESA = 7;

// Las rutas privadas del contrato (`docs/specs/013-tiendanube/contracts/
// api-endpoints.md`, «Las catorce rutas»): catorce menos `/callback` y
// `/webhook`, que son las dos públicas.
//
// Son **once caminos** y doce combinaciones de método+camino, porque `/mapeos`
// se atiende con GET y con POST. Se prueban las doce: `isExempt` mira el
// camino, pero un cambio futuro que mirara también el método tiene que
// romperse acá y no en producción.
//
// ⚠ Los que aceptan filtros van **con** su query string, y `/mapeos/:id` con
// un id de verdad. `isExempt` compara con `startsWith` sobre `req.originalUrl`,
// que incluye el `?…`: probarlas todas peladas es la trampa de «endpoints con
// filtros opcionales probados siempre sin filtros» que ya dejó pasar defectos
// en este repositorio.
const RUTAS_PRIVADAS = [
  ['get', '/api/tiendanube/auth'],
  ['get', '/api/tiendanube/status'],
  ['put', '/api/tiendanube/sucursal'],
  ['delete', '/api/tiendanube/vinculacion'],
  ['get', '/api/tiendanube/variantes?q=colageno&sin_mapear=true&page=2&limit=50'],
  ['post', '/api/tiendanube/variantes/refrescar'],
  ['get', '/api/tiendanube/mapeos?page=3&limit=25'],
  ['post', '/api/tiendanube/mapeos'],
  ['delete', '/api/tiendanube/mapeos/12'],
  ['post', '/api/tiendanube/sincronizar'],
  ['get', '/api/tiendanube/corridas/ultima'],
  ['get', '/api/tiendanube/pedidos?solo_con_problemas=true&page=2'],
];

/** El camino sin la query string, que es lo que cuenta como «ruta». */
function camino(url) {
  return url.split('?')[0];
}

/**
 * La cadena `authEmpresa` de `server.js:325-327`, en el orden real: primero se
 * resuelve la empresa y recién después corre `checkSubscription`.
 *
 * Debajo hay un handler que contesta **200 a cualquier cosa**. Es lo que hace
 * que este test pueda distinguir: 402 significa «el middleware la cortó» y 200
 * «la dejó pasar». Sin ese 200 posible, un test que espera 402 pasaría también
 * si la ruta no existiera, si el handler tirara, o si el router ni estuviera
 * montado — y las once rutas de TiendaNube todavía se están escribiendo en
 * otras fases de este mismo hito.
 */
function levantarApi(suscripcion) {
  mockSuscripcion.filas = suscripcion ? [suscripcion] : [];

  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = EMPRESA;
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use(checkSubscription);
  api.use((req, res) => res.json({ ok: true, llego: req.originalUrl }));

  return api;
}

// Vencida hace un mes y con la gracia terminada hace tres semanas: las dos
// fechas en el pasado y **distintas entre sí**, para que un bug que confunda
// una con la otra no dé el mismo resultado por casualidad.
const VENCIDA = {
  id: 1,
  empresa_id: EMPRESA,
  status: 'expired',
  trial_ends_at: new Date('2026-07-05T00:00:00Z'),
  grace_period_ends: new Date('2026-07-15T00:00:00Z'),
};

// El control. La gracia termina en 2027: si alguna vez el 402 empezara a salir
// por la fecha y no por el estado, este caso lo delata.
const AL_DIA = {
  id: 2,
  empresa_id: EMPRESA,
  status: 'active',
  trial_ends_at: new Date('2026-01-10T00:00:00Z'),
  grace_period_ends: new Date('2027-03-20T00:00:00Z'),
};

describe('las once rutas privadas de TiendaNube quedan detrás del paywall', () => {
  // Ancla. Sin esto, alguien borra ocho entradas de la lista, las cuatro que
  // quedan siguen en verde y la guardia dice que todo está cubierto. Es «tres
  // números iguales en un contador» con otra forma.
  it('la lista cubre los once caminos privados del contrato, no un puñado', () => {
    const caminos = new Set(RUTAS_PRIVADAS.map(([, url]) => camino(url)));

    expect(caminos.size).toBe(11);
    expect(RUTAS_PRIVADAS).toHaveLength(12);
    // Y ninguna es una de las dos públicas, que son otra cosa.
    expect([...caminos]).not.toContain('/api/tiendanube/webhook');
    expect([...caminos]).not.toContain('/api/tiendanube/callback');
  });

  it.each(RUTAS_PRIVADAS)(
    '%s %s responde 402 con la suscripción vencida',
    async (metodo, url) => {
      const res = await request(levantarApi(VENCIDA))[metodo](url);

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('SUBSCRIPTION_EXPIRED');
      // Y no llegó al handler de abajo: si hubiera llegado, la respuesta
      // traería `llego`.
      expect(res.body.llego).toBeUndefined();
    }
  );

  // La otra mitad de la fixture. Un `EXEMPT_PREFIXES` mal escrito que cortara
  // TODO —o un middleware que respondiera 402 por cualquier motivo— dejaría el
  // caso de arriba en verde igual. Este dice que el 402 sale del estado de la
  // suscripción y de nada más.
  it.each(RUTAS_PRIVADAS)(
    '%s %s pasa cuando la suscripción está al día',
    async (metodo, url) => {
      const res = await request(levantarApi(AL_DIA))[metodo](url);

      expect(res.status).toBe(200);
      expect(res.body.llego).toBe(url);
    }
  );

  // Riesgo 6 del plan, hecho visible. `checkSubscription:34` trata «sin fila de
  // suscripción» como bloqueo, y desde este cambio eso también alcanza a
  // TiendaNube: una empresa cliente sin fila pierde la pantalla entera. Es un
  // dato inconsistente que el middleware ya bloquea en todo el resto de la API
  // —dejarlo pasar fue el agujero que se cerró—, pero queda escrito acá para
  // que nadie lo descubra como sorpresa el día del despliegue.
  it('una empresa sin fila de suscripción recibe 402 SIN_SUSCRIPCION, no acceso libre', async () => {
    const res = await request(levantarApi(null)).get('/api/tiendanube/status');

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('SIN_SUSCRIPCION');
  });
});

// ── Guardias estáticas ──

const RUTA_MIDDLEWARE = path.join(__dirname, '..', 'middleware', 'checkSubscription.js');
const MIDDLEWARE = fs.readFileSync(RUTA_MIDDLEWARE, 'utf8');

/**
 * El array literal de `EXEMPT_PREFIXES`, **sin sus comentarios**.
 *
 * El filtro de comentarios no es adorno: la explicación que está arriba de la
 * lista nombra el prefijo viejo para contar qué pasaba antes, y sin sacarla la
 * guardia se pondría en rojo por una explicación — el mismo falso positivo que
 * el JSDoc de `routes/suppliers.js:56` le produce a la guardia de
 * `console.error`.
 */
const LISTA_DE_EXENTOS = MIDDLEWARE
  .slice(MIDDLEWARE.indexOf('const EXEMPT_PREFIXES'), MIDDLEWARE.indexOf('function isExempt'))
  .split('\n')
  .filter((linea) => !linea.trim().startsWith('//'))
  .join('\n');

describe('la exención de TiendaNube nombra dos caminos y no el prefijo entero', () => {
  // Ancla del recorte. Si alguien renombra la constante, el `slice` devolvería
  // el archivo entero o una cadena vacía y las tres afirmaciones de abajo
  // dirían cualquier cosa.
  it('el recorte encontró la lista de verdad', () => {
    expect(LISTA_DE_EXENTOS).toContain("'/api/ping'");
    expect(LISTA_DE_EXENTOS).toContain("'/api/empresas'");
    expect(LISTA_DE_EXENTOS.length).toBeLessThan(MIDDLEWARE.length);
  });

  it('NO está el prefijo `/api/tiendanube` a secas, que es lo que eximía las once', () => {
    expect(LISTA_DE_EXENTOS).not.toMatch(/'\/api\/tiendanube'/);
  });

  it('están los dos caminos exactos que llama TiendaNube desde afuera', () => {
    expect(LISTA_DE_EXENTOS).toContain("'/api/tiendanube/callback'");
    expect(LISTA_DE_EXENTOS).toContain("'/api/tiendanube/webhook'");
  });
});

/**
 * De dónde sale de verdad la exención de `/callback` y `/webhook`.
 *
 * No sale de `EXEMPT_PREFIXES` —eso es defensivo—: sale de que el router
 * `publico` se monta sin la cadena `authEmpresa`, y por lo tanto sin
 * `checkSubscription`. Esto es lo único verificable de US8 escenario 5, y por
 * eso está acá y no en un test de comportamiento que pasaría solo.
 *
 * Se aísla en una función para poder correrla contra muestras sintéticas: una
 * guardia sin muestra es una guardia que nadie sabe si mira algo.
 */
function montajesDeTiendanube(fuente) {
  const lineas = fuente.split('\n');

  return {
    publico: lineas.find((l) => l.includes("require('./routes/tiendanube').publico")),
    privado: lineas.find((l) => l.includes("require('./routes/tiendanube').privado")),
  };
}

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const MUESTRA_BUENA = `
app.use('/api/tiendanube', require('./routes/tiendanube').publico);
app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').privado);
`;

const MUESTRA_MALA = `
app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').publico);
app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').privado);
`;

describe('el router público de TiendaNube se monta fuera de la cadena de empresa', () => {
  it('server.js monta `publico` SIN authEmpresa y `privado` CON authEmpresa', () => {
    const { publico, privado } = montajesDeTiendanube(SERVER);

    // Que los dos montajes existan es parte de la afirmación: si el nombre
    // cambiara, `find` devolvería undefined y un `not.toContain` sobre
    // undefined ni siquiera es una comprobación.
    expect(publico).toBeDefined();
    expect(privado).toBeDefined();

    expect(publico).not.toContain('authEmpresa');
    expect(privado).toContain('authEmpresa');
  });

  it('la guardia se pone en rojo si alguien mete el router público detrás de authEmpresa', () => {
    const { publico } = montajesDeTiendanube(MUESTRA_MALA);

    expect(publico).toContain('authEmpresa');
  });

  it('y sigue en verde con el montaje correcto', () => {
    const { publico, privado } = montajesDeTiendanube(MUESTRA_BUENA);

    expect(publico).not.toContain('authEmpresa');
    expect(privado).toContain('authEmpresa');
  });
});
