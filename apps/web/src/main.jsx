import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
// La sesión entra por acá y por ningún otro lado. El archivo se lee entero
// —tiene treinta líneas— y explica por qué es un módulo aparte: es la única
// costura que las pruebas de navegador reemplazan, y ese reemplazo lo declara
// `vite.config.js` SOLO para `command === 'serve'`.
import ProveedorDeSesion from '@/sesion/ProveedorDeSesion'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ProveedorDeSesion>
      <BrowserRouter>
        <ThemeProvider defaultTheme="dark" storageKey="system-ui-theme">
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ProveedorDeSesion>
  </StrictMode>
)
