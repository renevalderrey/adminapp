import { defineConfig, devices } from '@playwright/test'

// ════════════════════════════════════════════
//  FAVALIO · apps/tienda · Pruebas de navegador
//
//  El tercer nivel de verificación de la tienda, y el ÚLTIMO recurso. Vale la
//  misma tabla de `docs/specs/CONVENCIONES.md` que en `apps/web`: las reglas van
//  en funciones puras, el dibujo en tests de render con jsdom, y acá abajo queda
//  **sólo** lo que exige un motor de maquetado de verdad. Que un botón «Sin
//  stock» sea inerte, que la casilla arranque desmarcada o qué dice cada estado
//  son tests de render —`src/tests/`, 134 casos— y no bajan acá aunque esta app
//  sea nueva: en el navegador cuestan cincuenta veces más por caso.
//
//  Hay una sola afirmación: **el `<body>` no desborda a lo ancho a 390px**, en
//  las seis pantallas del recorrido —catálogo, ficha, carrito y los tres pasos
//  del checkout—.
//
//  ════════════════════════════════════════════
//  ── Por qué un config PROPIO y no un segundo `project` en el de apps/web ──
//
//  Porque aquel arnés existe **alrededor del bypass de sesión**, y la tienda no
//  tiene sesión que falsear. Son tres piezas que van juntas:
//
//   · el alias de `apps/web/vite.config.js`, que sólo existe con
//     `command === 'serve'` y reemplaza el proveedor de sesión;
//   · `pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx`, la sesión falsa;
//   · las tres guardias que verifican que eso **no exista** en un bundle
//     (`src/tests/guardiaDeSesionDePrueba.test.js` y `npm run verificar:bundle`).
//
//  Meter la tienda ahí adentro sería arrastrarle una pieza que su propia guardia
//  —`src/tests/guardiaDeLaTienda.test.js`— tiene que prohibir: ese archivo falla
//  si en `apps/tienda/src` aparece Auth0, una cabecera de sesión o el cliente
//  HTTP de la app privada. Un arnés que instala lo que la guardia prohíbe es un
//  arnés que obliga a elegir cuál de los dos se apaga.
//
//  Y hay una segunda razón, más chica y más concreta: `baseURL`, `viewport` y
//  `webServer` de aquel config son de otra aplicación. `apps/web` declara mínimo
//  1280px y mide a 1920; esto se abre escaneando un QR desde un teléfono.
//
//  ── Lo que NO se copió de aquel config, y por qué ──
//
//  `workers: 1` y `fullyParallel: false` están allá porque sus dos archivos
//  comparten el catálogo sembrado **y el carrito del navegador**: dos ficheros a
//  la vez sobre el mismo estado producen fallos que no se reproducen.
//
//  Acá esas líneas siguen sin ir, y el motivo cambió cuando entraron el carrito
//  y el checkout: ahora **sí** hay casos que agregan al carrito, pero eso vive en
//  el `localStorage` del contexto, y Playwright le da uno nuevo a cada caso. Lo
//  que ninguno hace es **confirmar el pedido**: el último paso se mide con el
//  formulario lleno y sin apretar «Confirmar», así que la base sembrada no cambia
//  entre casos y no hay estado compartido que serializar.
//
//  El `timeout: 90_000` tampoco: allá lo pide un recorrido de diecisiete
//  pantallas a dos anchos. Acá son dos `goto` y los 30 s de fábrica sobran.
//
//  ════════════════════════════════════════════
//  ── Cómo se corre a mano ──
//
//    1. Una base descartable y la API contra ella, con el bypass de la API:
//
//       docker run -d --name favalio-tienda-e2e \
//         -e POSTGRES_USER=favalio -e POSTGRES_PASSWORD=favalio \
//         -e POSTGRES_DB=favalio_tienda_e2e -p 55436:5432 postgres:16-alpine
//
//       cd apps/api && DATABASE_URL=postgres://favalio:favalio@localhost:55436/favalio_tienda_e2e \
//         DB_SSL=false NODE_ENV=development BYPASS_AUTH=true PORT=5098 \
//         node src/server.js
//
//       Los números son propios a propósito —5098 y 55436, contra el 5099 y el
//       55432 del arnés de `apps/web`—: así las dos suites de navegador pueden
//       estar arriba a la vez y nadie tiene que acordarse de bajar una para
//       correr la otra.
//
//       ⚠ Acá **no hace falta `ALLOWED_ORIGINS`**, y es la diferencia más útil
//       con el encabezado de `apps/web/playwright.config.js`, donde faltaba y
//       costó cuatro intentos. El motivo no es que se haya simplificado: es que
//       **en esta app no hay CORS**. `src/api.js` pide rutas relativas contra su
//       propio origen y el servidor de desarrollo hace de Caddy con el `proxy`
//       de `vite.config.js`, así que el navegador nunca manda un `Origin` y la
//       lista blanca de `server.js` no se consulta nunca. Tampoco hace falta el
//       superadmin: ninguna pantalla de la tienda está detrás de un módulo.
//
//    2. `npm --prefix apps/tienda run test:navegador`
//
//  ── Por qué el servidor de desarrollo y no `vite preview` ──
//
//  No es por el mismo motivo que en `apps/web` —allá el bypass de sesión no se
//  puede compilar—: acá no hay nada que ocultarle a un bundle. Es por el proxy.
//  `vite preview` sirve `dist/` y **no lee `server.proxy`**, así que `/api/publico`
//  quedaría sin destino y las dos pruebas medirían la pantalla de «no
//  disponible» con la API arriba. El maquetado no cambia entre las dos ramas:
//  son los mismos estilos en línea y la misma `tienda.css` sobre las mismas
//  fuentes. Que el `dist/` se construye lo verifica `npm run build -w apps/tienda`,
//  que es un paso propio del mismo job del CI.
// ════════════════════════════════════════════

const PUERTO = Number(process.env.FAVALIO_PUERTO_DE_LA_TIENDA || 5175)

/** El origen de la API descartable. Sin `/api`: es el destino del proxy. */
const ORIGEN_DE_LA_API = process.env.FAVALIO_ORIGEN_DE_LA_API || 'http://localhost:5098'

export default defineConfig({
  testDir: './pruebas-de-navegador',
  // El sufijo no es `.spec.js` ni `.test.js` a propósito: los dos entornos se
  // llaman «test» y comparten carpeta raíz. `vite.config.js` restringe vitest a
  // `src/**/*.test.{js,jsx}` y acá se pide el sufijo propio, así que ninguno de
  // los dos puede levantar los archivos del otro por accidente.
  testMatch: '**/*.navegador.js',

  // Sin reintentos, ni siquiera en CI. Una prueba de maquetado que pasa al
  // segundo intento no está midiendo el maquetado: está midiendo el tiempo de
  // carga, y esconderlo con un reintento es cómo una suite deja de significar
  // algo. Es la misma línea de `apps/web` y vale por lo mismo.
  retries: 0,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'telefono',
      use: {
        // El `viewport` va DESPUÉS del spread: el descriptor trae el suyo
        // —1280×720— y pisaría cualquier cosa declarada arriba.
        ...devices['Desktop Chrome'],

        // 390×844 es un teléfono de gama media parado en la puerta de un
        // gimnasio, que es el único dispositivo desde el que esta app se abre.
        // No es «el ancho más chico soportado»: es el ancho normal.
        viewport: { width: 390, height: 844 },

        // `isMobile` enciende la emulación móvil de Chromium, que es lo que hace
        // que el `<meta name="viewport" content="width=device-width">` de
        // `index.html` signifique algo. Sin ella el navegador ignora esa etiqueta
        // y la página se maqueta contra la ventana: mediría 390px igual, pero
        // por un camino que ningún teléfono recorre, y el día que alguien toque
        // esa etiqueta la prueba no lo vería.
        //
        // ⚠ Con `initial-scale=1` la emulación **no encoge la página para que
        // entre**: lo que desborda produce scroll horizontal, y por eso
        // `scrollWidth` lo sigue reportando. Verificado con la mutación de
        // `min-width: 420px` sobre `.t-grilla`, que es el motivo por el que esto
        // está escrito acá y no supuesto.
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],

  globalSetup: './pruebas-de-navegador/preparacion.js',

  webServer: {
    command: `npx vite --port ${PUERTO} --strictPort`,
    url: `http://localhost:${PUERTO}`,

    // ⚠ **En `false`, al revés que `apps/web`**, y no es descuido.
    //
    // Allá el servidor de pruebas vive en el 5199, que no es el puerto de
    // `npm run dev`: reusar el que esté arriba no puede agarrar otra cosa. Acá
    // el 5175 **es** el puerto de `npm run dev -w apps/tienda`, y ese servidor
    // proxea a la API que tenga el desarrollador —normalmente la del 5000, con
    // su propia base—. Con `reuseExistingServer: true`, tener la tienda abierta
    // en otra terminal haría que las pruebas midan un catálogo que no es el
    // sembrado, en verde y sin decir nada.
    //
    // Con `false` y `--strictPort`, ese caso falla en el arranque diciendo que
    // el puerto está ocupado, que se lee y se arregla en diez segundos.
    reuseExistingServer: false,

    timeout: 120_000,
    env: {
      // A dónde manda el proxy de `vite.config.js`. Las variables que ya existen
      // en el entorno le ganan a `.env` en Vite, así que esto redirige la tienda
      // a la API descartable y no a la que el desarrollador tenga en el 5000.
      FAVALIO_ORIGEN_DE_LA_API: ORIGEN_DE_LA_API,
    },
  },
})
