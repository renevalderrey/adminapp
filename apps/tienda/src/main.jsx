import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MARCA_POR_DEFECTO, aplicarTema } from './tema.js'

// ⚠ El tema se aplica **antes** del primer render, con el color por defecto.
//
// El color real llega con la respuesta del catálogo, unos cientos de
// milisegundos después. En el medio, cualquier componente que use `var(--marca)`
// se dibujaría sin valor: los botones saldrían transparentes y el texto encima,
// invisible. La alternativa sería que cada componente escribiera un color de
// respaldo —`var(--marca, #…)`, como hace la maqueta— y eso es exactamente lo
// que rompe la propiedad que sostiene todo esto: que el hexadecimal viva en
// `tema.js` y en ningún otro archivo.
//
// Así, `--marca` y `--marca-texto` tienen valor desde la primera pintura y el
// único cambio posterior es reemplazarlo por el del comercio.
aplicarTema(MARCA_POR_DEFECTO)

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
