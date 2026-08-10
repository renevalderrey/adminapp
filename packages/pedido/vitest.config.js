import { defineConfig } from 'vitest/config';

// Aritmética y texto: nada de DOM. `node` arranca en milisegundos.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
