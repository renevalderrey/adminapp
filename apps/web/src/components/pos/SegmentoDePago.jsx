import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SEGMENTOS,
  MEDIOS,
  segmentoDe,
  mediosDelSegmento,
  medioPorDefecto,
} from '@/utils/mediosDePago'

// ════════════════════════════════════════════
//  ADMINAPP · El control segmentado del medio de pago
//
//  Tres segmentos —Efectivo · Tarjeta · Alianza— que se reparten el ancho y
//  comparten borde y estados (FR-020). Un clic elige el segmento y le pone su
//  medio por defecto (`ef`, `tc3v`, `al`); un SEGUNDO clic sobre el segmento ya
//  activo —o el chevron que aparece cuando el segmento tiene más de un medio—
//  abre la lista con el medio exacto.
//
//  Los segmentos son NIVELES DE PRECIO y no formas de pagar: por eso «Créd. 1
//  pago» vive adentro de «Efectivo». La lista y sus reglas están en
//  `utils/mediosDePago.js`, que es la única fuente del lado del navegador.
//
//  ── ⚠ El chevron NO está en la maqueta, y hay que decir por qué ──
//
//  La maqueta se dibujó cuando la pregunta 1 de la spec todavía no estaba
//  contestada: dibuja tres botones y nada más. La respuesta fue «tres segmentos
//  de precio + el medio exacto adentro», así que hace falta una forma de llegar
//  al medio exacto. Es el mismo argumento que FR-017 usa para el precio manual:
//  el dibujo es anterior a la decisión.
//
//  **Por qué no entra de otra forma.** La columna del ticket mide 400px y la
//  fila de controles ya lleva el stepper de cantidad. Nueve segmentos dan menos
//  de 40px cada uno, y el encabezado del catálogo fija TRES columnas de precio:
//  nueve controles sobre tres precios le dicen al operador que hay nueve
//  precios. Cinco opciones inline no entran sin apilar el control en dos filas,
//  y apilar duplica el alto de cada línea: con ocho productos el ticket deja de
//  entrar en la pantalla, que es justo lo que FR-002 viene a garantizar.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta. Hay una
//  guardia estática que lo verifica.
// ════════════════════════════════════════════

const NOMBRE_DEL_SEGMENTO = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  alianza: 'Alianza',
}

/**
 * @param {object} props
 * @param {string} props.valor Uno de los nueve códigos de `MEDIOS`.
 * @param {(codigo: string) => void} props.onCambio
 * @param {boolean} props.deshabilitado Durante el cobro (FR-046).
 * @param {string} props.etiqueta Nombre accesible del grupo.
 */
export default function SegmentoDePago({
  valor = 'ef',
  onCambio,
  deshabilitado = false,
  etiqueta = 'Medio de pago',
}) {
  const [abierto, setAbierto] = useState(null)
  const contenedor = useRef(null)

  const activo = segmentoDe(valor)
  const medio = MEDIOS.find((m) => m.codigo === valor)

  // Un clic afuera cierra la lista. Se escucha en `pointerdown` y no en `click`
  // para que cerrar no consuma el clic que el operador quiso dar en otra cosa.
  useEffect(() => {
    if (!abierto) return undefined

    const alTocarAfuera = (evento) => {
      if (!contenedor.current?.contains(evento.target)) setAbierto(null)
    }

    document.addEventListener('pointerdown', alTocarAfuera)
    return () => document.removeEventListener('pointerdown', alTocarAfuera)
  }, [abierto])

  const elegir = (codigo) => {
    setAbierto(null)
    onCambio?.(codigo)
  }

  const alTocarSegmento = (segmento) => {
    const opciones = mediosDelSegmento(segmento)

    // El segmento que no está activo se elige con su medio por defecto, que es
    // lo que pasa en el 95 % de las ventas: un clic, no dos.
    if (segmento !== activo) {
      elegir(medioPorDefecto(segmento))
      return
    }

    // Ya activo: el segundo clic abre el medio exacto, si hay más de uno.
    if (opciones.length > 1) setAbierto(abierto === segmento ? null : segmento)
  }

  return (
    <div
      ref={contenedor}
      role="group"
      aria-label={etiqueta}
      className="relative flex gap-1"
      onKeyDown={(evento) => {
        // El `Esc` que cierra esta lista NO puede además vaciar el ticket: el
        // atajo del POS mira `defaultPrevented` justamente para esto (FR-038).
        if (evento.key !== 'Escape' || !abierto) return
        evento.preventDefault()
        setAbierto(null)
      }}
    >
      {SEGMENTOS.map((segmento) => {
        const esActivo = segmento === activo
        const opciones = mediosDelSegmento(segmento)
        const hayVariantes = opciones.length > 1

        // Cuando el medio elegido NO es el por defecto del segmento, el botón
        // muestra su etiqueta corta: «Transf.» en vez de «Efectivo». Sin esto,
        // una transferencia y un pago en efectivo se ven idénticos en el ticket.
        const texto = esActivo && medio && medio.codigo !== medioPorDefecto(segmento)
          ? medio.etiquetaCorta
          : NOMBRE_DEL_SEGMENTO[segmento]

        return (
          <button
            key={segmento}
            type="button"
            disabled={deshabilitado}
            aria-pressed={esActivo}
            aria-haspopup={hayVariantes ? 'menu' : undefined}
            onClick={() => alTocarSegmento(segmento)}
            title={hayVariantes && esActivo ? 'Tocá de nuevo para elegir el medio exacto' : undefined}
            className={cn(
              'flex h-[26px] items-center gap-1 rounded-[7px] border px-[9px] text-[11.5px] font-semibold transition-colors',
              esActivo
                ? 'border-brand bg-brand text-white'
                : 'border-border bg-surface text-fg-2 hover:border-border-2',
              'disabled:pointer-events-none disabled:opacity-40'
            )}
          >
            {texto}
            {hayVariantes && <ChevronDown className="h-2.5 w-2.5" />}
          </button>
        )
      })}

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[150px] rounded-lg border border-border bg-popover p-1 shadow-nivel-2"
        >
          {mediosDelSegmento(abierto).map((opcion) => (
            <button
              key={opcion.codigo}
              type="button"
              role="menuitem"
              onClick={() => elegir(opcion.codigo)}
              className={cn(
                'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-3',
                opcion.codigo === valor ? 'font-semibold text-brand-dark' : 'text-fg-2'
              )}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
