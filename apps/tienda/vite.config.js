import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ════════════════════════════════════════════
//  apps/tienda — la config más corta del repositorio, y eso es el punto
//
//  No hay alias `@`, no hay tailwind, no hay `optimizeDeps`, no hay un plugin
//  que reemplace el proveedor de sesión. `apps/web/vite.config.js` tiene las
//  cuatro cosas porque las necesita; acá cada una que se copiara sería una
//  pieza que la tienda no usa y que la próxima persona interpretaría como
//  «esto se comparte con la app».
//
//  Lo que la tienda **no** comparte con `apps/web` no es una omisión: es lo que
//  la define. `apps/web` declara mínimo 1280px y esto se abre escaneando un QR
//  desde un teléfono; `apps/web` vive detrás de Auth0 y acá no hay con qué
//  identificarse; `apps/web` habla con la API por URL absoluta y con CORS de
//  por medio, y acá se habla contra el propio origen. Tres sistemas distintos,
//  no tres configuraciones del mismo.
// ════════════════════════════════════════════
export default defineConfig({
  plugins: [react()],

  server: {
    // 5173 lo ocupa `apps/web`, 5174 `apps/landing`. `strictPort` para que la
    // tienda **no** caiga en el primer puerto libre: `playwright.config.js`
    // (T1447) apunta a esta URL y el `webServer` la levanta con
    // `--port 5175 --strictPort`. Un puerto que se corre solo es una suite de
    // navegador que falla con «connection refused» y manda a mirar la app.
    port: 5175,
    strictPort: true,
  },

  // ── Por qué hace falta declarar el JSX acá ──
  //
  //  Copiado de `apps/web/vite.config.js:104-107`, y por el mismo motivo: Vite
  //  transforma el JSX con oxc y `@vitejs/plugin-react` le pasa el runtime
  //  automático por `oxc.jsx`, pero vitest tiene su propia canalización y no lee
  //  esa opción. Sin esto, todo componente que no importe `React` explícitamente
  //  falla en los tests con «React is not defined» — y anda perfecto en el
  //  navegador, que es la peor combinación.
  //
  //  ⚠ `vite build` avisa «Both esbuild and oxc options were set» y sigue de
  //  largo con oxc, que ya estaba en automático. El aviso es correcto y este
  //  bloque igual hace falta: el que lo lee es vitest, no el build. Borrarlo
  //  para callar el aviso pone en rojo el primer test de render que se escriba.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },

  test: {
    // `jsdom` para toda la suite y no archivo por archivo. Es la decisión de
    // `apps/web` y vale por lo mismo: que el próximo test de render sea un
    // archivo nuevo en `src/tests/` y nada más. Acá pesa incluso más, porque las
    // pantallas de esta app se dibujan a 390px y el test de render es la única
    // verificación barata que existe.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],

    // `pruebas-de-navegador/` (T1447) son de Playwright: corren contra un
    // Chromium de verdad y necesitan la API arriba. `include` explícito para que
    // vitest no las levante — los dos entornos se llaman «test» y no son lo
    // mismo. Es la misma línea de `apps/web/vite.config.js:120` y está acá antes
    // de que exista la carpeta, no después del primer rojo.
    testTimeout: 20000,
    hookTimeout: 20000,

    // La zona del negocio, igual que en `apps/web`: un test que cambia de color
    // según dónde corre no mide el sistema, mide la máquina.
    env: {
      TZ: 'America/Argentina/Buenos_Aires',
    },
  },
})
