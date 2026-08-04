import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // ── Lo que NO corre en el navegador ──
  //
  // La configuración de arriba declara `globals.browser` para todo, así que
  // `process` y `__dirname` salían como `no-undef` en los archivos que corren
  // en Node: las dos configuraciones, la carpeta de pruebas de navegador —que
  // es Playwright, o sea Node manejando un Chromium desde afuera— y los scripts
  // de verificación. Eran errores reales de la configuración de eslint, no del
  // código: `vite.config.js` viene marcando `__dirname` desde antes.
  {
    files: [
      'vite.config.js',
      'playwright.config.js',
      'pruebas-de-navegador/**/*.{js,jsx}',
      'scripts/**/*.js',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
