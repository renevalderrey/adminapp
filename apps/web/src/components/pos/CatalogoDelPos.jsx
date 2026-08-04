import { Search, Plus, Package, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════
//  ADMINAPP · Punto de venta, la columna izquierda
//
//  La barra de búsqueda con sus filtros queda FIJA arriba y la lista scrollea
//  debajo, en su propia zona. No es una preferencia estética: si la búsqueda
//  scrolleara con la lista, el operador tendría que volver arriba con la rueda
//  del mouse entre producto y producto, que es exactamente lo que los atajos
//  vienen a sacar.
//
//  ── Por qué las filas NO son `Fila` de `TablaGrid` ──
//
//  En un listado se escanea; acá se apunta con la mano y se toca. La maqueta
//  dibuja el catálogo como TARJETAS SEPARADAS —`border-radius:11px`, borde
//  propio y 8px de separación (`maqueta:364-366`)— y no como filas con
//  `border-b`. `Fila` fija `border-b border-border px-5 py-[15px]` y
//  `BotonDeFila` fija 29px cuando la maqueta pide 32px (`maqueta:378`), así que
//  forzar el marco acá exige agregarle props — que es exactamente lo que
//  `TablaGrid.jsx:20-30` dice que no se hace.
//
//  **Lo que sí se conserva del patrón es la disciplina del grid**: el encabezado
//  de columna y cada fila comparten el MISMO string de `grid-template-columns`,
//  que es lo que evita leer un precio bajo la etiqueta equivocada.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta. La pantalla
//  tiene un solo dueño del estado, y el primero que agregue una lectura acá crea
//  una segunda fuente para el mismo dato. No es una convención escrita al aire:
//  hay una guardia estática en `tests/guardiasDeDiseno.test.js` que falla si
//  este archivo la rompe.
// ════════════════════════════════════════════

/**
 * Las columnas del catálogo, tal cual la maqueta (`maqueta:361`).
 *
 * Es UN solo string y lo usan el encabezado y las filas. Escribirlo dos veces
 * es cómo dos declaraciones que empiezan iguales terminan distintas y un precio
 * de tarjeta aparece bajo la etiqueta «Alianza».
 */
export const COLUMNAS = 'minmax(0,1fr) 104px 104px 104px 44px'

/** La separación entre columnas, también compartida por encabezado y filas. */
const SEPARACION = '0 16px'

/**
 * Cuántos resultados se dibujan.
 *
 * La maqueta no tiene paginador: es una lista que scrollea (decisión 6 de la
 * spec). El tope existe porque el catálogo entero vive en el navegador
 * (proyecto 5e) y dibujar dos mil filas por cada tecla se siente. Con más
 * resultados que el tope, una línea dice cuántos hay y qué hacer.
 */
const TOPE_VISIBLE = 60

const pesos = (n) => Number(n || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Un dato que puede faltar se dibuja como «—» y no como un hueco. */
const oGuion = (valor) => (valor === null || valor === undefined || valor === '' ? '—' : valor)

export default function CatalogoDelPos({
  consulta = '',
  onConsulta,
  refBuscador,
  marcaDelBuscador = {},
  categorias = [],
  categoria = '',
  onCategoria,
  marcas = [],
  marca = '',
  onMarca,
  soloConStock = false,
  onSoloConStock,
  filas = [],
  onAgregar,
  bloqueado = false,
}) {
  const visibles = filas.slice(0, TOPE_VISIBLE)
  const hayMas = filas.length > visibles.length

  return (
    <div className="flex min-w-0 flex-1 flex-col border-r border-border">
      {/* ── La zona fija: búsqueda y filtros (FR-003) ── */}
      <div className="flex shrink-0 flex-col gap-3.5 border-b border-border bg-surface px-7 pb-3.5 pt-5">
        <div className="flex items-center gap-3.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-fg-3" />
            <input
              // La marca la exporta `utils/atajosDelPos.js`: si el campo dijera
              // una cosa y la regla leyera otra, `Enter` no agregaría nada y no
              // habría ningún error — simplemente no pasaría nada.
              {...marcaDelBuscador}
              ref={refBuscador}
              value={consulta}
              onChange={(e) => onConsulta?.(e.target.value)}
              placeholder="Escaneá un código o buscá por nombre, marca o SKU…"
              className="h-11 w-full rounded-[10px] border border-border bg-surface-2 pl-10 pr-3.5 text-[14.5px] outline-none focus-visible:border-brand-line focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          {/* FR-041: el atajo escrito al lado de lo que dispara. Uno que no
              está escrito en ningún lado no lo usa nadie. */}
          <span className="whitespace-nowrap text-xs text-fg-3">
            <kbd className="num rounded border border-border bg-surface-3 px-1 py-px text-[11px]">Enter</kbd>
            {' '}agrega el primer resultado
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {categorias.map((c) => (
            <button
              key={c.valor}
              type="button"
              onClick={() => onCategoria?.(c.valor)}
              className={cn(
                'h-[29px] rounded-full border px-3 text-[12.5px] transition-colors',
                c.valor === categoria
                  ? 'border-brand-line bg-brand-soft font-semibold text-brand-dark'
                  : 'border-border bg-surface font-medium text-fg-2 hover:border-border-2'
              )}
            >
              {c.etiqueta}
            </button>
          ))}

          <div className="flex-1" />

          {/* La maqueta no dibuja el filtro de marca —dibuja solo las
              categorías—, pero FR-049 obliga a CONSERVARLO entre una venta y la
              siguiente, así que existe. Va como `<select>` y no como doce chips
              más: las marcas son datos del cliente y pueden ser cuarenta. */}
          <select
            value={marca}
            onChange={(e) => onMarca?.(e.target.value)}
            aria-label="Marca"
            className="h-[29px] rounded-lg border border-border bg-surface px-2 text-[12.5px] font-medium text-fg-2 outline-none hover:border-border-2"
          >
            <option value="">Todas las marcas</option>
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onSoloConStock?.(!soloConStock)}
            className={cn(
              'flex h-[29px] items-center gap-[7px] rounded-lg border px-[11px] text-[12.5px] font-medium transition-colors',
              soloConStock
                ? 'border-brand-line bg-brand-soft text-brand-dark'
                : 'border-border bg-surface text-fg-2 hover:border-border-2'
            )}
          >
            <span
              className={cn(
                'grid h-3.5 w-3.5 place-items-center rounded border-[1.5px]',
                soloConStock ? 'border-brand bg-brand' : 'border-border-2 bg-surface'
              )}
            >
              {soloConStock && <Check className="h-2.5 w-2.5 text-white" />}
            </span>
            Solo con stock
          </button>
        </div>
      </div>

      {/* ── La zona que scrollea: el catálogo (FR-002) ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
        <div
          className="eyebrow sticky top-0 z-10 grid bg-background px-4 pb-2.5 pt-3.5"
          style={{ gridTemplateColumns: COLUMNAS, gap: SEPARACION }}
        >
          <span>Producto</span>
          <span className="text-right">Efectivo</span>
          <span className="text-right">Tarjeta</span>
          <span className="text-right">Alianza</span>
          <span />
        </div>

        <div className="flex flex-col gap-2">
          {visibles.map((fila) => (
            <div
              key={fila.id}
              className={cn(
                'grid items-center rounded-[11px] border border-border bg-surface px-4 py-3.5 transition-colors hover:border-brand-line',
                fila.agotado && 'opacity-50'
              )}
              style={{ gridTemplateColumns: COLUMNAS, gap: SEPARACION }}
            >
              <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="truncate text-sm font-medium">{fila.nombre}</span>
                <span className="flex items-center gap-2 text-xs text-fg-3">
                  <span className="truncate">{oGuion(fila.marca)}</span>
                  <span className="text-border-2">·</span>
                  <span className="num">{oGuion(fila.sku)}</span>
                  <span className="text-border-2">·</span>
                  <span className={cn('num font-medium', fila.agotado ? 'text-danger' : 'text-fg-2')}>
                    {fila.disponible} u.
                  </span>
                </span>
              </div>

              {/* `sinCosto` se marca en vez de dibujar «$0», que se lee como un
                  precio legítimo y deja vender el producto regalado. */}
              {fila.sinCosto ? (
                <span className="col-span-3 text-right text-xs font-medium text-warn">
                  Sin costo cargado
                </span>
              ) : (
                <>
                  <span className="num text-right text-sm font-medium">${pesos(fila.efectivo)}</span>
                  <span className="num text-right text-sm text-fg-2">${pesos(fila.tarjeta)}</span>
                  <span className="num text-right text-sm text-fg-2">${pesos(fila.alianza)}</span>
                </>
              )}

              <button
                type="button"
                onClick={() => onAgregar?.(fila.id)}
                disabled={fila.agotado || bloqueado}
                title="Agregar al ticket"
                aria-label={`Agregar ${fila.nombre} al ticket`}
                className={cn(
                  'grid h-8 w-8 place-items-center justify-self-end rounded-lg border transition-colors',
                  'border-brand bg-brand text-white hover:bg-brand-dark',
                  'disabled:pointer-events-none disabled:border-border disabled:bg-surface-3 disabled:text-fg-3'
                )}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {hayMas && (
          <p className="num pt-4 text-center text-xs text-fg-3">
            {visibles.length} de {filas.length} · afiná la búsqueda
          </p>
        )}

        {filas.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 py-16 text-center">
            <Package className="h-8 w-8 text-fg-3 opacity-50" />
            <p className="text-sm font-medium">Sin resultados</p>
            {/* La sugerencia de quitar el filtro de stock va SIEMPRE y no solo
                cuando está puesto (FR-013): el operador que no encuentra un
                producto no se acuerda de que dejó el conmutador activado hace
                dos horas, y eso es justo lo que hay que decirle. */}
            <p className="max-w-[38ch] text-[13px] text-fg-2">
              Probá con otro término, o quitá el filtro «Solo con stock» para ver
              productos agotados.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
