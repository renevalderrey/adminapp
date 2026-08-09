import { defineConfig } from 'vitest/config';

// El paquete no toca el DOM: es aritmética. `node` arranca en milisegundos y
// jsdom tarda segundos por archivo — la diferencia se nota en un job de CI que
// existe para dar una respuesta rápida sobre la fórmula del precio.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
