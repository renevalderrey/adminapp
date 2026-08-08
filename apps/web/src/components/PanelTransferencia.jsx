import React, { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { transferStock } from '@/services/api'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ArrowRight, Loader2, Plus, Search, Trash2 } from 'lucide-react'

// ════════════════════════════════════════════
//  ADMINAPP · Transferir mercadería entre sucursales
//
//  Panel y no modal, y con **una lista de productos** en vez de uno solo. El
//  formulario que había antes movía un producto por vez: llevar diez cosas de un
//  local a otro eran diez operaciones y diez registros en `StockTransfer`, que
//  después nadie puede volver a leer como lo que realmente fueron —un solo
//  traslado—.
//
//  ── Las tres reglas que se aplican acá y también en la API ──
//
//   · **Un ítem en cantidad cero o negativa se rechaza.** La API los salteaba en
//     silencio, y una transferencia de un solo ítem en cantidad 0 quedaba
//     registrada **sin ningún ítem**: un registro que dice que se movió
//     mercadería cuando no se movió nada.
//   · **Origen y destino distintos**, comparados por id.
//   · **Al destino no se puede mandar a una sucursal inactiva; del origen sí se
//     puede sacar.** Si quedó mercadería en un local que cerró, sacarla de ahí
//     es exactamente lo que hay que poder hacer (FR-115).
//
//  La pantalla es la cortesía y no la barrera: sin `stock.transferir` el botón
//  no se ve, y la API lo rechaza igual.
// ════════════════════════════════════════════

/** Cuántos productos se ofrecen mientras se escribe. Más no entran sin
 *  scrollear, y scrollear un buscador es peor que afinar la búsqueda. */
const SUGERENCIAS = 8

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none'

const unidades = (n) => Number(n || 0).toLocaleString('es-AR')

function comparable(texto) {
  return String(texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Lo que hay de un producto en una sucursal. Por `punto_de_venta_id`, nunca
 *  por el texto `location`. */
function stockEnSucursal(producto, sucursalId) {
  const fila = (producto?.stock || [])
    .find((s) => String(s.punto_de_venta_id) === String(sucursalId))

  return Number(fila?.quantity) || 0
}

/**
 * @param {Array} sucursales Todas, incluidas las inactivas.
 * @param {Array} productos El catálogo que ya está en memoria.
 * @param {object|null} precarga `{ productoId, origen, destino }` cuando se abre
 *   desde una fila de la comparación.
 * @param {Function} onTransferido Recibe `{ origen, destino, items }` para que
 *   la pantalla actualice las dos columnas sin recargar.
 */
export default function PanelTransferencia({
  abierto,
  onOpenChange,
  sucursales = [],
  productos = [],
  precarga = null,
  onTransferido,
}) {
  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [items, setItems] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [enviando, setEnviando] = useState(false)

  /** Al destino no se ofrecen las inactivas; al origen sí (FR-115). */
  const destinos = useMemo(() => sucursales.filter((s) => s.is_active !== false), [sucursales])

  useEffect(() => {
    if (!abierto) return

    const primeraActiva = sucursales.find((s) => s.is_active !== false)
    const origenInicial = precarga?.origen ? String(precarga.origen) : (primeraActiva ? String(primeraActiva.id) : '')
    const otra = sucursales.find((s) => String(s.id) !== origenInicial && s.is_active !== false)

    setOrigen(origenInicial)
    setDestino(precarga?.destino ? String(precarga.destino) : (otra ? String(otra.id) : ''))
    setBusqueda('')
    setEnviando(false)

    // El producto de la fila desde donde se abrió entra ya cargado, en cantidad
    // vacía: la cantidad la decide quien transfiere, y ponerle un número por
    // defecto invita a confirmarlo sin mirarlo.
    const producto = precarga?.productoId
      ? productos.find((p) => String(p.id) === String(precarga.productoId))
      : null

    setItems(producto ? [{ product_id: producto.id, name: producto.name, quantity: '' }] : [])
  }, [abierto, precarga, productos, sucursales])

  const sugerencias = useMemo(() => {
    const texto = comparable(busqueda).trim()
    if (!texto) return []

    const yaPuestos = new Set(items.map((i) => String(i.product_id)))

    return productos
      .filter((p) => !yaPuestos.has(String(p.id)))
      .filter((p) => comparable(`${p.name} ${p.sku || ''}`).includes(texto))
      .slice(0, SUGERENCIAS)
  }, [busqueda, productos, items])

  const agregar = (producto) => {
    setItems((actuales) => [...actuales, { product_id: producto.id, name: producto.name, quantity: '' }])
    setBusqueda('')
  }

  const quitar = (productId) => {
    setItems((actuales) => actuales.filter((i) => i.product_id !== productId))
  }

  const cambiarCantidad = (productId, valor) => {
    setItems((actuales) => actuales.map((i) => (i.product_id === productId ? { ...i, quantity: valor } : i)))
  }

  /** Lo que impide transferir, o `null`. */
  const problema = useMemo(() => {
    if (!origen || !destino) return 'Elegí el origen y el destino.'
    // Por id y no por el nombre: mandar el código de una sucursal en un campo y
    // su id en el otro pasaba la validación y movía mercadería de una sucursal a
    // sí misma.
    if (String(origen) === String(destino)) return 'El origen y el destino tienen que ser distintos.'
    if (items.length === 0) return 'Agregá al menos un producto.'

    const sinCantidad = items.find((i) => !(Number(i.quantity) > 0))
    if (sinCantidad) return `«${sinCantidad.name}» necesita una cantidad mayor a cero.`

    const sinStock = items.find((i) => {
      const producto = productos.find((p) => String(p.id) === String(i.product_id))
      return Number(i.quantity) > stockEnSucursal(producto, origen)
    })

    if (sinStock) {
      return `No hay tanto stock de «${sinStock.name}» en el origen. `
        + 'Si la operación entera falla, no se mueve ninguna fila.'
    }

    return null
  }, [origen, destino, items, productos])

  const confirmar = async () => {
    // Un segundo clic mientras el pedido está en vuelo no puede disparar una
    // segunda transferencia: serían dos traslados de la misma mercadería.
    if (enviando) return

    if (problema) {
      toast.error(problema)
      return
    }

    setEnviando(true)
    try {
      // UNA sola llamada con todos los ítems. La API es transaccional: si un
      // ítem no tiene stock suficiente falla la operación entera y **ninguna**
      // fila queda movida.
      await transferStock({
        from_punto_de_venta_id: Number(origen),
        to_punto_de_venta_id: Number(destino),
        items: items.map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) })),
      })

      toast.success(
        items.length === 1
          ? 'Transferencia registrada'
          : `Transferencia registrada con ${items.length} productos`
      )

      onTransferido?.({
        origen: Number(origen),
        destino: Number(destino),
        items: items.map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) })),
      })

      onOpenChange(false)
    } catch (err) {
      // El mensaje de negocio de la API va TAL CUAL: «Stock insuficiente en
      // "Depósito" para "Colágeno"» es lo que le dice al usuario qué corregir.
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setEnviando(false)
    }
  }

  const nombreDe = (id) => sucursales.find((s) => String(s.id) === String(id))?.name || '—'

  return (
    <Sheet open={abierto} onOpenChange={(siguiente) => { if (!siguiente && !enviando) onOpenChange(false) }}>
      <SheetContent
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Movimiento de stock</p>
          <SheetTitle className="mt-1 text-[19px] font-semibold">Transferir mercadería</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            Todos los productos de esta lista se mueven en una sola operación.
          </SheetDescription>
        </div>

        <div className="flex flex-col gap-7 px-6 py-6">

          {/* ── Origen y destino ── */}
          <div className="flex flex-col gap-3">
            <h2>De dónde y a dónde</h2>

            <div className="flex items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="eyebrow">Origen</span>
                <select className={CAMPO} value={origen} onChange={(e) => setOrigen(e.target.value)}>
                  <option value="">Elegí una sucursal</option>
                  {/* Las inactivas SÍ: sacar mercadería de un local cerrado es
                      justamente para lo que hace falta esto. */}
                  {sucursales.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.is_active === false ? `${s.name} (inactiva)` : s.name}
                    </option>
                  ))}
                </select>
              </label>

              <ArrowRight className="mb-2.5 h-4 w-4 shrink-0 text-fg-3" />

              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="eyebrow">Destino</span>
                <select className={CAMPO} value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Elegí una sucursal</option>
                  {destinos.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {sucursales.length > destinos.length && (
              <p className="text-[11.5px] text-fg-3">
                Las sucursales dadas de baja se pueden elegir como origen pero no
                como destino: mandar mercadería a un local que ya no opera es
                perderla de vista.
              </p>
            )}
          </div>

          {/* ── Qué se mueve ── */}
          <div className="flex flex-col gap-3">
            <h2>Qué se mueve</h2>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
              <input
                className={`${CAMPO} pl-9`}
                placeholder="Buscar un producto por nombre o SKU…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />

              {sugerencias.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-2">
                  {sugerencias.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => agregar(p)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-3"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {/* El stock EN EL ORIGEN al lado del nombre: sin eso hay
                          que memorizarlo de la tabla y volver. */}
                      <span className="num shrink-0 text-[12px] text-fg-2">
                        {unidades(stockEnSucursal(p, origen))} en {nombreDe(origen)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-2 px-4 py-6 text-center">
                <p className="text-[13px] font-semibold">Todavía no agregaste ningún producto.</p>
                <p className="mx-auto mt-1 max-w-[40ch] text-[12.5px] text-fg-2">
                  Buscalos arriba. Todos los que agregues se mueven juntos, en
                  una sola transferencia.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="eyebrow grid grid-cols-[minmax(0,1fr)_72px_84px_36px] gap-x-3 border-b border-border bg-surface-2 px-4 py-2">
                  <span>Producto</span>
                  <span className="text-right">En origen</span>
                  <span className="text-right">A mover</span>
                  <span />
                </div>

                {items.map((item) => {
                  const producto = productos.find((p) => String(p.id) === String(item.product_id))
                  const disponible = stockEnSucursal(producto, origen)
                  const excede = Number(item.quantity) > disponible

                  return (
                    <div
                      key={item.product_id}
                      className="grid grid-cols-[minmax(0,1fr)_72px_84px_36px] items-center gap-x-3 border-b border-border px-4 py-2.5 last:border-b-0"
                    >
                      <span className="truncate text-[13px]" title={item.name}>{item.name}</span>

                      <span className={`num text-right text-[13px] ${excede ? 'text-danger' : 'text-fg-2'}`}>
                        {unidades(disponible)}
                      </span>

                      <input
                        type="number" min="1" step="1"
                        className={`${CAMPO} num h-8 text-right ${excede ? 'border-danger-line' : ''}`}
                        value={item.quantity}
                        onChange={(e) => cambiarCantidad(item.product_id, e.target.value)}
                      />

                      <button
                        title="Quitar de la lista"
                        onClick={() => quitar(item.product_id)}
                        className="grid h-[29px] w-[29px] place-items-center rounded-lg text-fg-3 transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-[15px] w-[15px]" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-6 py-4">
          {/* El motivo por el que no se puede confirmar, escrito. Un botón gris
              sin explicación deja al usuario adivinando cuál de los cuatro
              campos está mal. */}
          {problema && items.length > 0 && (
            <p className="w-full text-[12px] text-fg-2">{problema}</p>
          )}

          <div className="flex-1" />

          <button className={BOTON_SECUNDARIO} disabled={enviando} onClick={() => onOpenChange(false)}>
            Cancelar
          </button>

          <button className={BOTON_PRINCIPAL} disabled={!!problema || enviando} onClick={confirmar}>
            {enviando
              ? <><Loader2 className="h-4 w-4 animate-spin" />Transfiriendo…</>
              : `Transferir ${items.length || ''}`.trim()}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
