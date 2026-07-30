import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // La app (apps/web) ocupa el 5173. Sin fijar este puerto, al correr las dos
    // juntas con "npm run dev" la landing caeria en el primero libre y la URL
    // dejaria de ser predecible.
    port: 5174,
    strictPort: true,
  },
})
