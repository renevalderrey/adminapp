import React from 'react'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════
//  ADMINAPP · El marco de la tabla en grid
//
//  La maqueta no usa <table>: usa grid, con las mismas grid-template-columns
//  en el encabezado y en las filas. Es lo que permite que las columnas queden
//  alineadas y que la fila entera sea clickeable.
//
//  ── Qué aporta este archivo y qué NO ──
//
//  Aporta SOLO el marco: el contenedor con su scroll, el encabezado, la fila y
//  el botón de ícono. Con eso quedan fijadas las medidas literales que las seis
//  pantallas del rediseño tienen que compartir —11px 20px en el encabezado,
//  15px 20px en las filas, 16px de separación entre columnas, botones de 29px—
//  y que copiadas a mano seis veces terminan con alguna en `py-3.5` sin que
//  nada lo detecte: no hay test visual.
//
//  NO aporta configuración de columnas, ni renderers, ni objetos de
//  definición. Cada pantalla escribe sus celdas como JSX y pasa sus
//  `gridTemplateColumns` como string.
//
//  Por qué el corte está acá: con una sola pantalla construida no hay
//  evidencia de qué necesitan las otras cinco, y esta ya pide fila entera
//  clickeable, opacidad al 55% en dos de los cinco estados, una celda de dos
//  líneas, otra alineada a la derecha y botones que frenan la propagación.
//  Cada una de esas se vuelve un prop, y para la sexta pantalla el componente
//  tiene dieciocho props y nadie se anima a tocarlo. Lo que cambia por
//  pantalla se escribe en la pantalla.
//
//  Reglas: docs/REGLAS-DISENO.md, sección «Tabla».
// ════════════════════════════════════════════

/**
 * El contenedor de la tabla.
 *
 * El scroll horizontal vive ACÁ, no en la página: con una ventana angosta la
 * tabla se desplaza dentro de su tarjeta y el cuerpo de la página queda
 * quieto. Al revés, el usuario pierde de vista la barra lateral y el
 * encabezado cada vez que mira la última columna.
 *
 * @param {number} anchoMinimo  Ancho en píxeles por debajo del cual el
 *   contenido deja de comprimirse y empieza a scrollear. Depende de las
 *   columnas de cada pantalla, así que lo decide cada pantalla.
 */
export function TablaGrid({ anchoMinimo = 960, children }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${anchoMinimo}px` }}>{children}</div>
    </div>
  )
}

/**
 * La fila de etiquetas de columna.
 *
 * @param {string} columnas  El valor de `grid-template-columns`, tal cual.
 *   Tiene que ser EXACTAMENTE el mismo que el de las filas: si difieren, las
 *   etiquetas dejan de estar sobre sus datos y se lee un importe bajo
 *   «Estado».
 */
export function Encabezado({ columnas, className, children, ...props }) {
  return (
    <div
      className={cn(
        'eyebrow grid items-center gap-x-4 border-b border-border bg-surface-2 px-5 py-[11px]',
        className
      )}
      style={{ gridTemplateColumns: columnas }}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Una fila.
 *
 * `className` es la escotilla de escape deliberada: es por donde cada pantalla
 * mete lo suyo —la opacidad de una fila anulada, por ejemplo— sin que el marco
 * tenga que conocer los estados de ninguna. Un prop `atenuada` acá sería el
 * primero de los dieciocho.
 */
export function Fila({ columnas, className, children, ...props }) {
  return (
    <div
      className={cn(
        'grid cursor-pointer items-center gap-x-4 border-b border-border px-5 py-[15px]',
        'transition-colors hover:bg-surface-2',
        className
      )}
      style={{ gridTemplateColumns: columnas }}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Un botón de ícono de los del final de la fila.
 *
 * Frena la propagación del clic siempre, y no cuando la pantalla se acuerda:
 * la fila entera abre el panel de detalle, así que sin esto tocar «Imprimir»
 * imprimiría Y abriría el panel. Es idéntico en las seis pantallas y no hay
 * ningún caso en que se quiera lo contrario, así que va en el marco.
 *
 * El tamaño del ícono lo fija el botón (15px) en vez de dejarlo en cada
 * llamada: es lo que hace que los botones de dos pantallas distintas se vean
 * iguales.
 */
export function BotonDeFila({ onClick, className, children, ...props }) {
  return (
    <button
      type="button"
      onClick={(evento) => {
        evento.stopPropagation()
        onClick?.(evento)
      }}
      className={cn(
        'grid h-[29px] w-[29px] place-items-center rounded-lg text-fg-3',
        'transition-colors hover:bg-surface-3 hover:text-foreground',
        // ⚠ `disabled:cursor-not-allowed` y NO `disabled:pointer-events-none`.
        //
        // `pointer-events-none` saca al elemento del hit-testing, y con eso el
        // navegador **nunca muestra el `title`**. Este repositorio pone en el
        // `title` justamente el MOTIVO por el que la acción está apagada — «No
        // se puede anular: el comprobante tiene CAE y sigue vigente ante ARCA»,
        // «Necesitás el permiso proveedores.editar»—, así que la mitad de esas
        // explicaciones eran inalcanzables, en seis pantallas.
        //
        // O sea: el comentario de acá arriba pedía deshabilitar CON el motivo
        // en vez de esconder, y una clase lo derrotaba en silencio.
        //
        // Y era redundante: el atributo `disabled` ya bloquea el clic. Lo único
        // que agregaba `pointer-events-none` era romper el tooltip.
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&_svg]:h-[15px] [&_svg]:w-[15px]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
