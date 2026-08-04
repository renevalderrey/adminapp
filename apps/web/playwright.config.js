import { defineConfig, devices } from '@playwright/test'

// ════════════════════════════════════════════
//  ADMINAPP · Pruebas de navegador
//
//  El tercer nivel de verificación de la web, y el ÚLTIMO recurso. Las reglas
//  van en funciones puras, el dibujo en tests de render con jsdom, y acá abajo
//  queda solamente lo que exige un motor de maquetado de verdad: qué scrollea,
//  cuánto mide algo, y si un texto entra o se recorta. La tabla completa de
//  «qué va dónde» está en `docs/specs/CONVENCIONES.md`.
//
//  Existe porque `docs/specs/011-punto-de-venta/tasks.md` terminó con cinco
//  pasos de maquetado que nadie podía correr —jsdom devuelve cero en
//  `scrollWidth`, `clientWidth` y `getBoundingClientRect`— y con una pregunta
//  abierta: el contenedor de scroll de las diecisiete pantallas cambió de lugar
//  cuando se introdujo `MarcoDePantalla` y nadie lo había mirado.
//
//  ── Cómo se corre ──
//
//    1. Una base descartable y la API contra ella, con el bypass de la API:
//
//       docker run -d --name adminapp-e2e-pg \
//         -e POSTGRES_USER=adminapp -e POSTGRES_PASSWORD=adminapp \
//         -e POSTGRES_DB=adminapp_e2e -p 55432:5432 postgres:16-alpine
//
//       cd apps/api && DATABASE_URL=postgres://adminapp:adminapp@localhost:55432/adminapp_e2e \
//         DB_SSL=false NODE_ENV=development BYPASS_AUTH=true PORT=5099 node src/server.js
//
//       El arranque en desarrollo crea el esquema con `sequelize.sync`, siembra
//       los permisos, la empresa 1, sus tres sucursales y el usuario
//       `test-user-id`. El catálogo lo siembra `preparacion.js` de esta carpeta.
//
//       ⚠ La base tiene que estar VACÍA. Con las migraciones ya aplicadas, el
//       `sequelize.sync({ alter: true })` del arranque en desarrollo se cae
//       —`products.unit_type` es `STRING(20)` en la migración y `ENUM` en el
//       modelo, y Postgres no castea un default de texto a un enum—. Está
//       anotado en el informe; el camino migrado lo verifica el job
//       `contenedor` del CI, que corre con `NODE_ENV=production` y sin sync.
//
//    2. `npm --prefix apps/web run test:navegador`
//
//       Levanta el servidor de desarrollo con `ADMINAPP_SESION_DE_PRUEBA=1`, que
//       es lo único que hace existir el alias de la sesión falsa (ver
//       `vite.config.js`). Sin esa variable, la aplicación pide Auth0 como
//       siempre.
//
//  ── Por qué el servidor de desarrollo y no `vite preview` ──
//
//  Porque el bypass de la sesión NO se puede compilar: el alias solo existe
//  para `command === 'serve'`. Un `vite build` no lo declara, así que no hay
//  ningún `dist/` con el que servir estas pruebas — que es exactamente la
//  propiedad que se quería. El maquetado no cambia entre dev y build: las dos
//  ramas usan el mismo Tailwind sobre las mismas fuentes.
// ════════════════════════════════════════════

const PUERTO_WEB = Number(process.env.ADMINAPP_PUERTO_WEB_DE_PRUEBAS || 5199)
const API = process.env.ADMINAPP_API_DE_PRUEBAS || 'http://localhost:5099/api'

export default defineConfig({
  testDir: './pruebas-de-navegador',
  // El sufijo no es `.spec.js` ni `.test.js` a propósito: los dos entornos se
  // llaman «test» y comparten carpeta raíz. `vite.config.js` restringe vitest a
  // `src/**/*.test.{js,jsx}` y acá se pide el sufijo propio, así que ninguno de
  // los dos puede levantar los archivos del otro por accidente.
  testMatch: '**/*.navegador.js',

  // Un solo worker y sin paralelismo entre archivos: los dos archivos comparten
  // el mismo catálogo sembrado y el mismo carrito del navegador. Dos ficheros a
  // la vez sobre el mismo estado producen fallos que no se reproducen, que es
  // la peor clase de prueba de navegador.
  workers: 1,
  fullyParallel: false,

  // 90 s por caso, contra los 30 de fábrica. No es holgura por las dudas: el
  // recorrido de las diecisiete pantallas a dos anchos son treinta y cuatro
  // `goto` con su `networkidle`, y con 30 s se corta a mitad de camino y falla
  // por tiempo en vez de por lo que mide. El resto de los casos tarda menos de
  // tres segundos, así que este número solo lo usa ese recorrido.
  timeout: 90_000,

  // Sin reintentos, ni siquiera en CI. Una prueba de maquetado que pasa al
  // segundo intento no está midiendo el maquetado: está midiendo el tiempo de
  // carga, y esconderlo con un reintento es cómo una suite deja de significar
  // algo.
  retries: 0,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${PUERTO_WEB}`,
    // 1920×1080 es el monitor del mostrador y es el ancho en el que se ve el
    // problema del contenedor de scroll: a 1320px de ancho de ventana no hay
    // diferencia entre scrollear el marco y scrollear la página.
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // El `viewport` va DESPUÉS del spread: `devices['Desktop Chrome']` trae el
    // suyo —1280×720— y pisaría el de `use` de arriba. Con 1280 de ancho la
    // prueba del marco no ve nada: la diferencia entre scrollear el marco de
    // 1320px y scrollear la página solo existe cuando la ventana es más ancha
    // que el marco.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
  ],

  globalSetup: './pruebas-de-navegador/preparacion.js',

  webServer: {
    command: `npx vite --port ${PUERTO_WEB} --strictPort`,
    url: `http://localhost:${PUERTO_WEB}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Lo único que enciende la sesión falsa. `vite.config.js` además exige
      // `command === 'serve'`, así que esta variable no puede afectar a un build.
      ADMINAPP_SESION_DE_PRUEBA: '1',
      // Las variables que ya existen en el entorno le ganan a `.env` en Vite,
      // así que esto redirige la aplicación a la API descartable y no a la que
      // el desarrollador tenga levantada en el 5000 con su propia base.
      VITE_API_URL: API,
    },
  },
})
