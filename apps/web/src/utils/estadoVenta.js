import { Ban } from 'lucide-react'

// ════════════════════════════════════════════
//  ADMINAPP · El color de cada estado de venta
//
//  El SIGNIFICADO lo decide el servidor: `apps/api/src/utils/estadoVenta.js`
//  devuelve `{ codigo, etiqueta }` y esa misma etiqueta va al badge de la
//  fila, al panel y a la columna «Estado» del archivo exportado. Acá solo se
//  traduce el código a los tokens de color.
//
//  Por qué el color no viene de la API: es una decisión de diseño y su fuente
//  es docs/REGLAS-DISENO.md. Si la API devolviera un hexadecimal, el frontend
//  dejaría de poder cambiar la paleta sin tocar el backend y el archivo se
//  llenaría de hex.
//
//  ── Por qué «Anulada» lleva ícono ──
//
//  «Registrada» y «Anulada» comparten fondo (surface-3) y línea (border): se
//  diferencian solo por el tono del texto (fg-2 contra fg-3). En la fila
//  alcanza, porque la anulada va al 55% de opacidad; mirando el badge aislado
//  —en el panel, sin la fila alrededor— no se distinguen sin leer.
//
//  El ícono cambia la FORMA sin tocar la paleta, y toma el color del estado
//  como cualquier ícono que forma parte de un estado (REGLAS-DISENO, «Íconos»).
//  Es lo que hace que los cinco estados se distingan a simple vista también a
//  nivel de badge, y no solo a nivel de fila.
// ════════════════════════════════════════════

/**
 * Los cinco códigos con su trío de tokens.
 *
 * `texto`, `fondo` y `linea` se usan JUNTOS: un color de estado suelto —texto
 * de color sobre el fondo de la tarjeta, sin fondo suave ni línea— se lee como
 * un error de estilo.
 */
export const ESTADOS = {
  autorizada: {
    texto: 'text-ok',
    fondo: 'bg-ok-soft',
    linea: 'border-ok-line',
    icono: null,
  },
  registrada: {
    texto: 'text-fg-2',
    fondo: 'bg-surface-3',
    linea: 'border-border',
    icono: null,
  },
  rechazada: {
    texto: 'text-danger',
    fondo: 'bg-danger-soft',
    linea: 'border-danger-line',
    icono: null,
  },
  anulada: {
    texto: 'text-fg-3',
    fondo: 'bg-surface-3',
    linea: 'border-border',
    icono: Ban,
  },
  anulada_con_cae: {
    texto: 'text-warn',
    fondo: 'bg-warn-soft',
    linea: 'border-warn-line',
    icono: null,
  },
}

/** Los dos estados que van al 55% de opacidad en la fila (FR-010). */
export const ESTADOS_ANULADOS = ['anulada', 'anulada_con_cae']

/** true si la venta está anulada, con o sin CAE. */
export function estaAnulada(codigo) {
  return ESTADOS_ANULADOS.includes(codigo)
}

/**
 * Los tokens de un código de estado.
 *
 * Un código desconocido cae en la presentación neutra en vez de romper: una
 * fila sin badge es un bug visible, una pantalla en blanco es un bug caro.
 */
export function presentacionDeEstado(codigo) {
  return ESTADOS[codigo] || ESTADOS.registrada
}
