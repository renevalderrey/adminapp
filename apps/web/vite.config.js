import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// ════════════════════════════════════════════
//  La costura por la que entran las pruebas de navegador
//
//  `App.jsx:172` corta en `!isAuthenticated`: sin una sesión de Auth0 real no
//  se llega a ninguna pantalla, y por eso los cinco pasos de maquetado de
//  `docs/specs/011-punto-de-venta/tasks.md` no los pudo correr nadie. Las
//  pruebas de navegador entran reemplazando `@/sesion/ProveedorDeSesion` por
//  uno que devuelve una sesión falsa.
//
//  ⚠ Lo importante de esta función es lo que NO hace: no mira `mode`, no mira
//  `NODE_ENV` y no envuelve nada en un `if` que después queda compilado. Exige
//  `command === 'serve'`, o sea el servidor de desarrollo. `vite build` llama a
//  esta config con `command === 'build'` **siempre**, así que el alias no se
//  declara, el archivo del bypass no se resuelve, y no hay `dist/` en el que
//  pueda aparecer. No es un interruptor apagado: es una pieza que no está.
//
//  El contraste con la API es deliberado y está explicado en el encabezado de
//  `pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx`: allá el bypass existe
//  en producción y se niega a correr, porque el código vive en un servidor
//  propio; acá el bundle se le sirve a cualquiera, así que la única defensa que
//  vale es que el código no exista.
//
//  `src/tests/guardiaDeSesionDePrueba.test.js` verifica las tres cosas: que
//  esta rama exija `command === 'serve'`, que nadie importe el archivo del
//  bypass desde `src/`, y que su marca no aparezca en `dist/`.
// ════════════════════════════════════════════
function aliasDeLaSesionDePrueba(command) {
  if (command !== 'serve') return {}
  if (process.env.FAVALIO_SESION_DE_PRUEBA !== '1') return {}

  // Va PRIMERO en el objeto: `resolve.alias` se resuelve en orden y `'@'`
  // matchea todo lo que empiece con `@/`, incluido este especificador.
  return {
    '@/sesion/ProveedorDeSesion': path.resolve(
      __dirname,
      './pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx'
    ),
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      ...aliasDeLaSesionDePrueba(command),
      '@': path.resolve(__dirname, './src'),
    },
  },
  // ════════════════════════════════════════════
  //  El entorno de tests
  //
  //  `environment: 'jsdom'` para TODA la suite, y no solo para los tests de
  //  render. El motivo es que la próxima pantalla que se rediseñe no tenga que
  //  acordarse de nada: un archivo `.test.jsx` nuevo en `src/tests/` renderiza
  //  y punto. La alternativa —declarar el entorno archivo por archivo con un
  //  `@vitest-environment`— es exactamente la clase de ceremonia que hace que
  //  el test de render no se escriba.
  //
  //  El costo es ~1 s de arranque por archivo de test. La contrapartida es que
  //  cuatro incumplimientos de la spec de Inventario pasaron 274 tests sin
  //  ponerse en rojo porque no había forma de renderizar nada.
  //
  //  La única excepción es `utils/impresionInventario.test.js`, que declara
  //  `@vitest-environment node` porque su caso es precisamente «no hay
  //  navegador»: bajo jsdom `window` existe y ese test dejaría de probar lo que
  //  dice su nombre.
  //
  //  `globals: true` para que `describe`/`it`/`expect` estén disponibles sin
  //  importarlos — es lo que esperan los matchers de `@testing-library/jest-dom`
  //  y lo que hace que un test de render se lea como el resto de la industria.
  //  Los tests que ya los importan explícitamente siguen funcionando igual.
  // ════════════════════════════════════════════
  // ── Por qué hace falta declarar el JSX acá ──
  //
  //  Vite 8 transforma el JSX con oxc, y `@vitejs/plugin-react` le pasa el
  //  runtime automático por `oxc.jsx`. Vitest 3 tiene su propia canalización y
  //  no lee esa opción: sin esto compila con el runtime **clásico** y todo
  //  componente que no importe `React` —`ui/tooltip.jsx`, `ImportWizard.jsx` y
  //  varios más, que en la aplicación funcionan perfectamente— falla al
  //  renderizar con «React is not defined».
  //
  //  No cambia el `build`: ahí manda oxc, que ya estaba en automático.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/preparacion.js',
    // `include` explícito, y no el patrón por defecto de vitest.
    //
    // Sin esto, vitest levanta también los archivos de `pruebas-de-navegador/`
    // —que son de Playwright, corren contra un Chromium de verdad y necesitan
    // la API arriba— y la suite de la web se pone en rojo con «test is not
    // defined» o, peor, se queda esperando un servidor que nadie levantó. Los
    // dos entornos se llaman «test» y no son lo mismo: lo que los separa es
    // esta línea.
    include: ['src/**/*.test.{js,jsx}'],

    // ── Por qué 20 s y no los 5 s por defecto ──
    //
    // Los 5 s de vitest están calibrados para pruebas de función pura. Acá hay
    // pruebas que montan una pantalla entera con cincuenta filas, esperan el
    // rebote del buscador y vuelven a dibujar. Solas tardan menos de un segundo;
    // con los cincuenta y cuatro archivos corriendo en paralelo en una máquina
    // ocupada, las mismas pruebas tardan tres o cuatro veces más y se pasaban.
    //
    // ⚠ Lo que fallaba NO era el sistema, era el reloj: la misma suite daba
    // verde o cuarenta rojos según cuán ocupada estuviera la máquina, sin
    // cambiar una línea. Una suite así se termina ignorando, y el día que el
    // rojo es de verdad nadie lo mira.
    //
    // 20 s NO es «desactivar el límite». Una prueba que de verdad se cuelga
    // —una promesa que nadie resuelve, un `waitFor` que nunca se cumple— sigue
    // fallando; falla más tarde. Lo que deja de fallar es la que estaba a punto
    // de terminar bien.
    testTimeout: 20000,
    hookTimeout: 20000,

    // ── La zona horaria de la suite ──
    //
    // Este sistema es para un comercio argentino: **todo lo que dice una fecha
    // la dice en hora de Argentina**, y hay funciones que usan los métodos
    // LOCALES del `Date` justamente por eso —`fechaDeHoy`, `fechaCortaDeMomento`,
    // `diasHastaVencer`—.
    //
    // ⚠ Sin fijarla, la suite mide una cosa en la máquina de acá y otra en CI,
    // que corre en UTC. Pasó: un caso de `diasHastaVencer` quedó verde en ocho
    // corridas locales y **rojo en CI durante ocho commits seguidos**, y el
    // motivo era ése y nada más. Un test que cambia de color según dónde corre
    // no está midiendo el sistema: está midiendo la máquina.
    //
    // Que el defecto se vea igual acá y allá es más importante que cuál de las
    // dos zonas sea «la correcta» — pero además ésta es la correcta: es la del
    // negocio.
    env: {
      TZ: 'America/Argentina/Buenos_Aires',
    },
  },
}))
