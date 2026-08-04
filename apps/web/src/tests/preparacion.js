import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// ════════════════════════════════════════════
//  ADMINAPP · Preparación del entorno de tests de la web
//
//  Se carga antes de CADA archivo de test (`setupFiles` en `vite.config.js`).
//  Hace tres cosas y ninguna más:
//
//   1. Los matchers de `jest-dom` —`toBeInTheDocument`, `toBeDisabled`,
//      `toHaveClass`—. Sin ellos habría que escribir `expect(el !== null)`, que
//      cuando falla dice «expected false to be true» y no qué elemento faltaba.
//   2. `cleanup()` entre pruebas. Testing Library monta en un `<div>` colgado
//      del `<body>` y NO lo saca solo: sin esto, la segunda prueba de un archivo
//      encuentra los elementos de la primera y `getByText` falla con «found
//      multiple elements» — o peor, pasa mirando el render viejo.
//   3. Los cuatro huecos de jsdom que usan los componentes de `@base-ui/react`
//      (el panel lateral y el tooltip).
//
//  No se agrega `restoreMocks` ni `clearMocks` global: hay tests que arman su
//  doble una vez por archivo, y limpiarlos entre pruebas los rompería sin que
//  el motivo sea evidente desde el archivo que falla.
// ════════════════════════════════════════════

afterEach(() => {
  cleanup()
})

// ── Lo que jsdom no implementa ──
//
// jsdom no tiene motor de maquetado, así que todo lo que mide o observa el
// layout no existe. `@base-ui/react` los usa para posicionar el popup del
// tooltip y para el panel lateral, y sin ellos el render explota con
// «X is not a function» — un error que no dice nada sobre el test que falló.
//
// Son polyfills de prueba, no implementaciones: devuelven lo mínimo para que el
// componente termine de montar. Un test NO puede afirmar nada sobre posiciones
// ni sobre tamaños; para eso no alcanza jsdom y hace falta un navegador.

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

if (typeof Element !== 'undefined') {
  // El puntero: jsdom no lo captura. `user-event` dispara `pointerdown` sobre
  // botones que llaman a estos tres, y sin ellos cualquier clic falla.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}
