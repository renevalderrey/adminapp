// ════════════════════════════════════════════
//  El esquema PaaS: lo que en el VPS hace Caddy, acá lo hacen tres archivos
//
//  `observabilidad.test.js` ya cuida el Caddyfile y el compose. Esta es la misma
//  guardia para el otro camino de despliegue (`docs/DESPLIEGUE-PAAS.md`): Neon +
//  Vercel + Render, que es el que se usa para probar en línea.
//
//  Existe porque **los tres fallos que cubre son silenciosos y ninguno aparece
//  en un log del servidor**:
//
//   · Si el `buildCommand` de `render.yaml` deja de instalar desde la raíz, npm
//     rechaza el `npm ci` —exige la raíz del workspace— y el build muere con un
//     mensaje que no menciona workspaces por ningún lado.
//   · Si se pierde `URL_DE_LA_TIENDA`, la API busca el `index.html` en
//     `http://tienda` —el nombre del servicio en el compose, que en Render no
//     resuelve— y cada enlace de catálogo compartido devuelve «Volvemos en un
//     rato» con el resto del sistema sano.
//   · Si el `rewrite` de fallback de `apps/tienda/vercel.json` sube de lugar,
//     se come a `/c/*` y `/api/publico/*`: Vercel resuelve **por orden, primer
//     match gana**, y el bundle empieza a contestar las URLs que tenía que
//     contestar la API. La tienda dibuja «no disponible» con la API arriba.
//
//  Los tres se ven recién en producción, y ninguno se distingue de «la
//  plataforma anda mal».
//
//  ⚠ Esto valida **archivos de configuración versionados**, no el estado real de
//  las cuentas de Vercel y Render. Que el test pase no dice que el dashboard
//  esté bien: dice que el repositorio no perdió lo que el dashboard necesita.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..', '..', '..');

const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const leerJson = (...partes) => JSON.parse(leer(...partes));

describe('render.yaml instala el monorepo desde la raíz', () => {
  const RENDER = leer('render.yaml');

  it('la guardia encuentra el servicio que dice mirar', () => {
    // El ancla: sin esto, las reglas de abajo pasarían por vacío.
    expect(RENDER).toMatch(/name: favalio-api/);
  });

  it('el install sale de apps/api antes de correr', () => {
    // `npm ci` exige la raíz del workspace: lanzado dentro de `apps/api` falla
    // sin mencionar workspaces. Y el lockfile es uno solo desde que el
    // monorepo los usa.
    expect(RENDER).toMatch(/buildCommand: cd \.\.\/\.\. && npm ci/);
    expect(RENDER).toMatch(/--include-workspace-root/);
  });

  it('las migraciones corren antes del servidor', () => {
    // Con `&&`: si migrar falla, el servidor no arranca. Arrancar con el
    // schema a medio migrar es peor que no arrancar.
    expect(RENDER).toMatch(/startCommand: npm run migrate && node src\/server\.js/);
  });

  it('la versión de Node está fijada y no la elige la plataforma', () => {
    // `engines: ">=22"` hizo que el primer deploy arrancara en Node 26.7.0,
    // un major que no probó nadie: el CI corre en 22 y el Dockerfile es
    // `node:22-alpine`. Render mira NODE_VERSION antes que engines.
    expect(RENDER).toMatch(/- key: NODE_VERSION\s*\n\s*value: "22"/);
  });

  it('el buildFilter incluye los paquetes compartidos y el lockfile', () => {
    // Un cambio en `@favalio/precios` que no redesplegara la API dejaría el
    // cálculo del navegador y el del servidor en versiones distintas.
    expect(RENDER).toMatch(/- packages\/\*\*/);
    expect(RENDER).toMatch(/- package-lock\.json/);
  });

  it('declara el origen de la tienda, de donde sale el HTML de /c/:slug', () => {
    expect(RENDER).toMatch(/- key: URL_DE_LA_TIENDA/);
  });

  it('enciende el servido de imágenes, que en el VPS hace Caddy', () => {
    // Sin esto no hay ningún proceso capaz de leer el directorio donde
    // `guardarImagen` escribió: cada miniatura del panel y cada foto de la
    // tienda son un 404 con el dato de la base perfecto.
    expect(RENDER).toMatch(/- key: SERVIR_IMAGENES\s*\n\s*value: "true"/);
  });

  it('las fotos van a un directorio escribible, y no al del volumen del VPS', () => {
    // `/var/favalio/imagenes` es la ruta del volumen del compose. En el
    // runtime nativo el proceso no es root y `/var` no se puede escribir: la
    // primera subida falla con EACCES, y recién ahí, no al desplegar.
    const linea = RENDER.split('\n')
      .find((l, i, todas) => todas[i - 1] && todas[i - 1].includes('RUTA_DE_IMAGENES'));

    expect(linea).toContain('/opt/render/project/src');
    expect(linea).not.toContain('/var/favalio');
  });
});

describe('la API sirve /img sólo cuando se le pide explícitamente', () => {
  const SERVER = leer('apps', 'api', 'src', 'server.js');

  it('el montaje está detrás de SERVIR_IMAGENES', () => {
    // Detrás de una variable y NO por defecto: en el VPS las sirve Caddy desde
    // un volumen, y `utils/imagenes.js` explica por qué un proceso de Node
    // mandando archivos estáticos compite con las cajas del comercio.
    expect(SERVER).toMatch(/if \(process\.env\.SERVIR_IMAGENES === 'true'\) \{/);
    expect(SERVER).toMatch(/app\.use\('\/img', express\.static\(/);
  });

  it('no lista directorios ni redirige', () => {
    // El aislamiento de estas fotos entre empresas lo da que el nombre del
    // archivo sea imposible de adivinar. Un índice de directorio lo anula.
    const desde = SERVER.indexOf("app.use('/img', express.static(");
    const bloque = SERVER.slice(desde, desde + 600);

    expect(bloque).toMatch(/index: false/);
    expect(bloque).toMatch(/redirect: false/);
  });
});

describe('los vercel.json reponen lo que hacía Caddy', () => {
  const TIENDA = leerJson('apps', 'tienda', 'vercel.json');
  const WEB = leerJson('apps', 'web', 'vercel.json');
  const LANDING = leerJson('apps', 'landing', 'vercel.json');

  /** El destino de un rewrite, buscado por el prefijo de su `source`. */
  const destino = (config, prefijo) => (
    config.rewrites.find((r) => r.source.startsWith(prefijo)) || {}
  ).destination;

  it('las tres apps instalan el monorepo desde la raíz', () => {
    // Con el install corriendo dentro de `apps/web`, el build no ve el
    // lockfile de la raíz ni `packages/precios`, y falla con
    // `Cannot find module '@favalio/precios'` **sólo en Vercel**: el CI está
    // verde porque hace `npm ci` desde arriba.
    for (const config of [TIENDA, WEB, LANDING]) {
      expect(config.installCommand).toBe('cd ../.. && npm ci');
    }
  });

  it('la tienda manda /api/publico/*, /c/* y /img/* a la API', () => {
    // Las tres rutas que en el VPS son un `handle` del bloque `tienda.` del
    // Caddyfile. Sin ellas la tienda no tiene con qué hablar: pide con rutas
    // relativas a propósito (`apps/tienda/src/api.js`).
    expect(destino(TIENDA, '/api/publico')).toMatch(/^https:\/\/api\./);
    expect(destino(TIENDA, '/c/')).toMatch(/^https:\/\/api\./);
    expect(destino(TIENDA, '/img/')).toMatch(/^https:\/\/api\./);
  });

  it('el fallback de SPA de la tienda va ÚLTIMO', () => {
    // Vercel resuelve por orden y gana el primero. Un fallback que suba de
    // lugar se come `/c/*` y `/api/publico/*`, y entonces el bundle contesta
    // las URLs que tenía que contestar la API: la tienda dibuja
    // «no disponible» con todo el sistema arriba.
    const rewrites = TIENDA.rewrites;
    const fallback = rewrites.findIndex((r) => r.destination === '/index.html');

    expect(fallback).toBe(rewrites.length - 1);
  });

  it('el panel también resuelve /img/*, y antes de su propio fallback', () => {
    // Nació con el bloque sólo en la tienda —el mismo error que ya cometió el
    // Caddyfile—: `products.image_url` guarda la ruta RELATIVA y el panel la
    // dibuja tal cual, así que el administrador veía un 404 en cada miniatura
    // que el cliente veía perfecta, con el dato bien guardado.
    expect(destino(WEB, '/img/')).toMatch(/^https:\/\/api\./);

    const img = WEB.rewrites.findIndex((r) => r.source.startsWith('/img/'));
    const fallback = WEB.rewrites.findIndex((r) => r.destination === '/index.html');

    expect(img).toBeLessThan(fallback);
  });

  it('la tienda no se indexa, y por sitio y no por ruta', () => {
    // El precio que una empresa negoció con un socio se publica en una URL sin
    // login. Que no termine en un buscador es una decisión de producto, y
    // ponerlo por ruta deja la puerta abierta a que la próxima ruta nazca sin
    // él. Es el mismo criterio que el `X-Robots-Tag` del Caddyfile.
    const global = TIENDA.headers.find((h) => h.source === '/(.*)');

    expect(global.headers).toContainEqual({
      key: 'X-Robots-Tag',
      value: 'noindex, nofollow',
    });
  });
});
