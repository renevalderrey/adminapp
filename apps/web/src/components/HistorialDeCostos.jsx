import React, { useState, useEffect, useCallback } from 'react'
import { getProductCostHistory } from '@/services/api'
import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { pesos } from '@/utils/formato'

// ════════════════════════════════════════════
//  ADMINAPP · Historial de costos de un producto
//
//  Contesta «quién movió este costo y desde cuándo», que es la pregunta que se
//  hace el dueño cuando el margen de un producto cambió y nadie sabe por qué.
//  Vive dentro del panel del producto: el costo se mira junto al producto, no
//  en otra pantalla.
//
//  ── Los dos detalles que hacen que sirva ──
//
//   · **El motivo distingue el origen.** Una edición manual, una actualización
//     masiva, una importación de lista de precios y un recosteo por cambio de un
//     insumo son cuatro cosas distintas, y hasta esta funcionalidad dos de ellas
//     —la importación y la carga masiva— no dejaban NINGUNA fila. Con el
//     historial vacío justo en el caso principal, la pantalla no servía para
//     nada.
//   · **El autor puede estar vacío, y eso es dato viejo y no un error.** Las
//     filas anteriores a la migración 15 no tienen `usuario_id` porque el dato
//     no existía y no se puede inferir. Se muestra «sin registrar» y no un
//     hueco, que se lee como que algo falló.
// ════════════════════════════════════════════

/** Cuántas filas trae cada pedido. Es el default del servidor (tope 100). */
const POR_PAGINA = 10

/**
 * «2026-08-03T14:20:00Z» → «03/08/2026».
 *
 * ⚠ **No es la `fechaCorta` de `utils/formato.js` y no se unificó a propósito.**
 * Aquella parte el string sin pasar por `Date` porque su entrada es un
 * `DATEONLY` —«2026-08-01», sin hora— y leerlo con `new Date()` lo interpreta
 * en UTC y lo corre un día. Acá la entrada es lo contrario: un timestamp con
 * hora, que es un instante real y se muestra en la hora del usuario. Un cambio
 * de costo hecho a las 21:30 del 2 de agosto pasó el 2 de agosto para quien lo
 * hizo, y en UTC figura como el 3.
 *
 * Aplanar las dos contra una sola movería un día una de las dos columnas.
 */
function fechaCorta(valor) {
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * La variación porcentual entre dos costos.
 *
 * `Number()` en los dos, SIEMPRE. `old_cost` y `new_cost` son `DECIMAL(12,2)` y
 * el driver de Postgres los devuelve como **string**: `"1380.00" - "1200.00"`
 * funciona por coerción y da 180, pero `"1380.00" + "1200.00"` da
 * `"1380.001200.00"`. El día que alguien sume dos de estos valores —para un
 * promedio, para un total— el bug aparece sin que nada haya cambiado acá.
 *
 * @returns {number|null} `null` cuando el costo anterior era cero: pasar de 0 a
 *   $1.200 no es «un aumento del infinito por ciento», es cargar el costo por
 *   primera vez.
 */
export function variacionPorcentual(costoAnterior, costoNuevo) {
  const antes = Number(costoAnterior)
  const despues = Number(costoNuevo)

  if (!Number.isFinite(antes) || !Number.isFinite(despues) || antes === 0) return null

  return ((despues - antes) / antes) * 100
}

/**
 * @param {number} productoId El producto cuyo historial se muestra.
 */
export default function HistorialDeCostos({ productoId }) {
  const [filas, setFilas] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  const pedir = useCallback(async (offset) => {
    setCargando(true)
    setError(null)
    try {
      const res = await getProductCostHistory(productoId, { limit: POR_PAGINA, offset })
      const nuevas = res.data.data || []

      // Se APILA y no se reemplaza: «ver más» agrega, no navega. Reemplazando,
      // el usuario perdería de vista los cambios recientes justo cuando está
      // comparando el actual contra el de hace seis meses.
      setFilas((previas) => (offset === 0 ? nuevas : [...previas, ...nuevas]))
      setTotal(res.data.total || 0)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setCargando(false)
    }
  }, [productoId])

  useEffect(() => {
    if (!productoId) return

    // `pedir(0)` ya reemplaza las filas en vez de apilarlas, así que no hace
    // falta vaciarlas antes: hacerlo dejaría el panel un instante diciendo «el
    // costo nunca cambió» sobre un producto que sí tiene historial.
    pedir(0)
  }, [productoId, pedir])

  if (!productoId) return null

  return (
    <div className="flex flex-col gap-3">
      <h2>Historial de costos</h2>

      {error ? (
        <div className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3">
          <p className="text-[12.5px] text-danger">No se pudo cargar el historial: {error}</p>
          <button
            className="mt-2 text-[12.5px] font-medium text-fg-2 underline hover:text-foreground"
            onClick={() => pedir(0)}
          >
            Reintentar
          </button>
        </div>
      ) : cargando && filas.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-[12.5px] text-fg-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-3" />
          Cargando el historial…
        </div>
      ) : filas.length === 0 ? (
        // Una tabla con encabezados y sin filas parece un error de carga. Un
        // producto sin cambios de costo lo dice con palabras.
        <div className="rounded-xl border border-dashed border-border-2 px-4 py-6 text-center">
          <p className="text-[13px] font-semibold">El costo nunca cambió.</p>
          <p className="mx-auto mt-1 max-w-[40ch] text-[12.5px] text-fg-2">
            Los cambios que hagas acá, los de una actualización masiva y los de
            una importación de lista de precios van a aparecer en esta lista.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {filas.map((fila) => {
            const variacion = variacionPorcentual(fila.old_cost, fila.new_cost)
            const subio = Number(fila.new_cost) > Number(fila.old_cost)
            const Icono = subio ? TrendingUp : TrendingDown

            return (
              <div key={fila.id} className="border-b border-border px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num text-[12.5px] text-fg-2">{fechaCorta(fila.change_date)}</span>

                  <span className="num text-[13px] text-fg-3 line-through">${pesos(fila.old_cost)}</span>
                  <span className="text-fg-3">→</span>
                  <span className="num text-[13.5px] font-semibold">${pesos(fila.new_cost)}</span>

                  {/* El color y el SIGNO: el color solo no se lee en una
                      impresión ni con daltonismo, y «+12,5 %» dice lo mismo sin
                      depender de verlo. Una suba de costo es `danger` y una baja
                      es `ok` porque lo que mide es qué le pasa al margen. */}
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-[2px] text-[11.5px] font-semibold ${
                      subio
                        ? 'border-danger-line bg-danger-soft text-danger'
                        : 'border-ok-line bg-ok-soft text-ok'
                    }`}
                  >
                    <Icono className="h-3 w-3" />
                    <span className="num">
                      {variacion === null
                        ? (subio ? 'primer costo' : 'sin referencia')
                        : `${variacion > 0 ? '+' : ''}${variacion.toFixed(1).replace('.', ',')} %`}
                    </span>
                  </span>
                </div>

                <p className="mt-1 text-[12px] text-fg-2">
                  {fila.reason || 'Sin motivo registrado'}
                  {' · '}
                  {/* El autor vacío es dato viejo: las filas anteriores a esta
                      funcionalidad no lo tienen y no se puede inferir. */}
                  <span className={fila.usuario ? '' : 'text-fg-3'}>
                    {fila.usuario?.nombre || fila.usuario?.email || 'autor sin registrar'}
                  </span>
                </p>
              </div>
            )
          })}

          {filas.length < total && (
            <button
              className="w-full border-t border-border bg-surface-2 py-2 text-[12.5px] font-medium text-fg-2 transition-colors hover:text-foreground disabled:opacity-60"
              disabled={cargando}
              onClick={() => pedir(filas.length)}
            >
              {cargando
                ? 'Cargando…'
                : `Ver más (${total - filas.length} cambio${total - filas.length === 1 ? '' : 's'} más)`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
