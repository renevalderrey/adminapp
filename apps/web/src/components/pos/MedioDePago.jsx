import { useEffect, useRef, useState } from 'react'
import { Banknote, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  mediosALaVista,
  mediosAgrupados,
  nombreDeLista,
  segmentoDe,
} from '@/utils/mediosDePago'

// ════════════════════════════════════════════
//  FAVALIO · Cómo cobra este ticket
//
//  Reemplaza a `SegmentoDePago`, que dibujaba «Efectivo · Tarjeta · Alianza» en
//  CADA línea y otra vez en el pie. Eran dos preguntas distintas con el mismo
//  control:
//
//   · el SEGMENTO decide a qué precio se vende,
//   · el MEDIO decide cómo entra la plata.
//
//  El operador solo tiene la segunda: nadie elige «vender al precio de
//  tarjeta», eligen «me paga con tarjeta». Así que acá se pregunta el medio
//  real —una vez, en el pie— y el nivel de precio se DICE, no se pide.
//
//  ── Por qué los otros cinco van agrupados por lista ──
//
//  «Transferencia cobra el precio de efectivo» era la pregunta que el control
//  anterior no contestaba nunca: los medios estaban escondidos adentro del
//  segmento, así que para descubrir con qué lista cotizaba uno había que
//  abrirlo y deducirlo de dónde estaba. Acá el encabezado del grupo lo dice con
//  todas las letras — «Cotizan con Efectivo» — y deja de ser algo que hay que
//  saber de memoria.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta. Hay una
//  guardia estática que lo verifica.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {string} props.valor Uno de los nueve códigos de `MEDIOS`.
 * @param {(codigo: string) => void} props.onCambio
 * @param {boolean} props.deshabilitado Durante el cobro (FR-046).
 * @param {string} props.etiqueta Nombre accesible del grupo.
 */
export default function MedioDePago({
  valor = 'ef',
  onCambio,
  deshabilitado = false,
  etiqueta = 'Medio de pago',
}) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef(null)

  const aLaVista = mediosALaVista(valor)
  const grupos = mediosAgrupados(valor)
  const ocultos = grupos.reduce((suma, g) => suma + g.medios.length, 0)

  // Un clic afuera cierra la lista. Se escucha en `pointerdown` y no en `click`
  // para que cerrar no consuma el clic que el operador quiso dar en otra cosa.
  useEffect(() => {
    if (!abierto) return undefined

    const alTocarAfuera = (evento) => {
      if (!contenedor.current?.contains(evento.target)) setAbierto(false)
    }

    document.addEventListener('pointerdown', alTocarAfuera)
    return () => document.removeEventListener('pointerdown', alTocarAfuera)
  }, [abierto])

  const elegir = (codigo) => {
    setAbierto(false)
    onCambio?.(codigo)
  }

  return (
    <div
      ref={contenedor}
      role="group"
      aria-label={etiqueta}
      className="relative flex items-center gap-1.5"
      onKeyDown={(evento) => {
        // El `Esc` que cierra esta lista NO puede además vaciar el ticket: el
        // atajo del POS mira `defaultPrevented` justamente para esto (FR-038).
        if (evento.key !== 'Escape' || !abierto) return
        evento.preventDefault()
        setAbierto(false)
      }}
    >
      {aLaVista.map((medio) => {
        const esActivo = medio.codigo === valor

        return (
          <button
            key={medio.codigo}
            type="button"
            disabled={deshabilitado}
            aria-pressed={esActivo}
            onClick={() => elegir(medio.codigo)}
            className={cn(
              'flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border',
              'px-2.5 text-[12.5px] transition-colors',
              esActivo
                ? 'border-brand bg-brand font-semibold text-white'
                : 'border-border bg-surface font-medium text-fg-2 hover:border-border-2',
              'disabled:pointer-events-none disabled:opacity-40'
            )}
          >
            {/* El billete solo en efectivo, que es el único medio que además
                abre el bloque de vuelto. Un ícono en los cuatro no distingue
                nada y ocupa el ancho que necesitan las etiquetas. */}
            {medio.codigo === 'ef' && <Banknote className="h-3.5 w-3.5 shrink-0" />}
            {medio.etiquetaCorta}
          </button>
        )
      })}

      {ocultos > 0 && (
        <button
          type="button"
          disabled={deshabilitado}
          aria-haspopup="menu"
          aria-expanded={abierto}
          onClick={() => setAbierto((a) => !a)}
          className={cn(
            'flex h-[34px] shrink-0 items-center gap-1 rounded-lg border border-border bg-surface',
            'px-2.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:border-border-2',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
        >
          Otros {ocultos}
          <ChevronDown className="h-3 w-3 text-fg-3" />
        </button>
      )}

      {abierto && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-50 mb-1 min-w-[190px] rounded-lg border border-border bg-popover p-1 shadow-nivel-2"
        >
          {grupos.map((grupo) => (
            <div key={grupo.segmento} className="py-0.5">
              {/* El encabezado del grupo ES la explicación. Sin él, «Visa 3c» y
                  «Créd. 1 pago» se leen como dos tarjetas iguales que cobran
                  precios distintos por motivos que nadie escribió. */}
              <p className="eyebrow px-2 pb-1 pt-1">Cotizan con {grupo.lista}</p>
              {grupo.medios.map((opcion) => (
                <button
                  key={opcion.codigo}
                  type="button"
                  role="menuitem"
                  onClick={() => elegir(opcion.codigo)}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-surface-3"
                >
                  {opcion.etiqueta}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * La línea que dice con qué lista cotiza el medio elegido.
 *
 * Va al lado del título del bloque y no adentro del control: es una
 * consecuencia de lo elegido, no una opción más. Se exporta desde acá para que
 * el nombre de la lista salga del mismo lugar que los grupos del desplegable.
 */
export function ListaQueCotiza({ valor = 'ef' }) {
  const lista = nombreDeLista(segmentoDe(valor))

  return (
    <span className="text-[11.5px] text-fg-3">
      cotiza con la lista{' '}
      <strong className="font-semibold text-fg-2">{lista.toLowerCase()}</strong>
    </span>
  )
}
