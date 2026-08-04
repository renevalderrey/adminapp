import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
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
  },
})
