import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import api from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { pesos } from '@/utils/formato'
import { usePermission } from '@/hooks/usePermission'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { faltaElPermiso } from '@/utils/permisos'
import {
  numeroDePedido, etiquetaDeEstadoDePedido, tonoDeEstadoDePedido,
  etiquetaDeEntrega, etiquetaDePago, verboDeTransicion, direccionDelPedido,
} from '@/utils/pedidos'

// ════════════════════════════════════════════
//  FAVALIO · Panel del pedido
//
//  ── Panel lateral y no modal (FR-039) ──
//
//  Mismo motivo que el panel del gasto y el del producto: quien decide si marca
//  un pedido como listo lo hace **mirando el resto de la bandeja**, que es lo que
//  le dice si le conviene preparar ese o los tres que entraron después. Un modal
//  tapa exactamente eso.
//
//  ── Los botones los decide el SERVIDOR ──
//
//  `transiciones` llega en la respuesta del detalle y de cada cambio. Acá sólo se
//  les pone verbo. Si esta pantalla decidiera cuáles ofrecer, serían dos reglas
//  para lo mismo, y la de acá ofrecería lo que la otra rechaza: el comercio
//  apretaría un botón que devuelve 409 y no entendería por qué.
//
//  Es lo mismo que hace que **marcar cobrado dos veces sea inofensivo**: la
//  segunda no está en la tabla de transiciones, así que ni se dibuja ni se
//  acepta.
//
//  ── Los importes son los CONGELADOS ──
//
//  Los precios de las líneas salen de `pedido_items` y no del catálogo (FR-171).
//  Un pedido de hace tres semanas tiene que seguir diciendo lo que costó: si acá
//  se recalculara contra las reglas de hoy, el comercio vería un total distinto
//  del que el comprador tiene en su WhatsApp — y el que discute es el WhatsApp.
// ════════════════════════════════════════════

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold '
  + 'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark '
  + 'disabled:cursor-not-allowed disabled:opacity-60'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 '
  + 'text-[13px] font-medium transition-colors hover:bg-surface-3 '
  + 'disabled:cursor-not-allowed disabled:opacity-60'

/** Un dato del pedido, con su etiqueta arriba. */
function Dato({ etiqueta, children }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{etiqueta}</p>
      <p className="mt-0.5 text-[13px]">{children}</p>
    </div>
  )
}

/**
 * @param {object} props
 * @param {string|null} props.pedidoId El pedido abierto, o `null`.
 * @param {Function} props.alCerrar
 * @param {Function} props.alCambiarEstado Recibe el pedido actualizado.
 * @param {Function} props.alFallar Recibe el mensaje de error.
 */
export default function PanelDePedido({ pedidoId, alCerrar, alCambiarEstado, alFallar }) {
  const { can } = usePermission()
  const puedeGestionar = can('pedidos.gestionar')
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [moviendo, setMoviendo] = useState(null)

  useEffect(() => {
    if (!pedidoId) {
      setDatos(null)
      return undefined
    }

    let vivo = true
    setCargando(true)

    api.get(`/pedidos/${pedidoId}`)
      .then((res) => { if (vivo) setDatos(res.data?.data || null) })
      .catch((err) => {
        if (!vivo) return
        setDatos(null)
        alFallar?.(mensajeDeError(err, 'No se pudo abrir el pedido.'))
      })
      .finally(() => { if (vivo) setCargando(false) })

    // El corte evita que la respuesta de un pedido lento pise la del que se
    // abrió después: la bandeja se recorre haciendo clic en varias filas
    // seguidas, así que no es un caso raro.
    return () => { vivo = false }
  }, [pedidoId, alFallar])

  /**
   * ⚠ El texto de la confirmación de «Marcar cobrado» dice lo que el sistema
   * **no** hace, y es lo contrario de lo que decía la maqueta.
   *
   * Es la única acción de la pantalla cuyo nombre promete más de lo que hace:
   * quien la aprieta cree que acaba de registrar una venta. Si el aviso llegara
   * después —o no llegara—, el comercio marcaría veinte pedidos cobrados y
   * descubriría el desfasaje cuando el inventario no cierre, sin saber de dónde
   * salió.
   *
   * Las otras transiciones no preguntan: cambiar a «en preparación» no promete
   * nada que no cumpla, y una confirmación en cada botón es una confirmación que
   * se aprieta sin leer.
   */
  const confirmarSiHaceFalta = async (estado) => {
    if (estado !== 'pagado') return true

    return confirm(
      `Marcar cobrado el pedido ${numeroDePedido(pedido.numero)} solo cambia su estado. `
      + 'El stock no baja y no se registra ninguna venta: si ya lo entregaste, cargalo en el '
      + 'punto de venta.',
      { verbo: 'Marcar cobrado' }
    )
  }

  const mover = async (estado) => {
    if (!(await confirmarSiHaceFalta(estado))) return

    setMoviendo(estado)
    try {
      const res = await api.patch(`/pedidos/${pedidoId}/estado`, { estado })
      const actualizado = res.data?.data?.pedido

      setDatos((d) => (d ? { ...d, pedido: actualizado, transiciones: res.data?.data?.transiciones || [] } : d))
      alCambiarEstado?.(actualizado)
    } catch (err) {
      const cuerpo = err?.response?.data

      // El 409 trae el estado real: alguien más lo movió mientras esta pantalla
      // tenía el viejo cargado. Se dice qué pasó y se refresca, en vez de
      // repetir «no se pudo».
      if (err?.response?.status === 409 && cuerpo?.estado_actual) {
        setDatos((d) => (d ? {
          ...d,
          pedido: { ...d.pedido, estado: cuerpo.estado_actual },
          transiciones: cuerpo.transiciones || [],
        } : d))
        alFallar?.(`${cuerpo.mensaje} Ahora está en «${etiquetaDeEstadoDePedido(cuerpo.estado_actual)}».`)
      } else {
        alFallar?.(mensajeDeError(err, 'No se pudo cambiar el estado del pedido.'))
      }
    } finally {
      setMoviendo(null)
    }
  }

  const pedido = datos?.pedido
  const lineas = datos?.lineas || []
  const transiciones = datos?.transiciones || []
  const direccion = pedido ? direccionDelPedido(pedido) : null

  return (
    <Sheet open={Boolean(pedidoId)} onOpenChange={(abierto) => { if (!abierto) alCerrar?.() }}>
      <SheetContent
        // El ancho va en `style` y no en clases, por el mismo motivo que en
        // `PanelDeGasto`: `SheetContent` trae reglas propias en un media query.
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Pedido</p>

          <SheetTitle className="mt-1 flex items-center gap-2 text-[19px] font-semibold">
            {pedido ? numeroDePedido(pedido.numero) : '—'}
            {pedido && (
              <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium ${tonoDeEstadoDePedido(pedido.estado)}`}>
                {etiquetaDeEstadoDePedido(pedido.estado)}
              </span>
            )}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            {datos?.catalogo?.nombre_visible || 'Entró por un catálogo público.'}
          </SheetDescription>
        </div>

        {cargando && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        )}

        {!cargando && pedido && (
          <div className="flex flex-col gap-6 px-6 py-6">

            <div className="grid grid-cols-2 gap-4">
              <Dato etiqueta="Comprador">{pedido.comprador_nombre}</Dato>
              <Dato etiqueta="Teléfono">{pedido.comprador_telefono}</Dato>
              {pedido.comprador_email && <Dato etiqueta="Email">{pedido.comprador_email}</Dato>}
              {/* El número de socio es **declarativo**: nadie lo verifica contra
                  un padrón. Se muestra tal como lo escribió el comprador. */}
              {pedido.comprador_nro_socio && <Dato etiqueta="N° de socio">{pedido.comprador_nro_socio}</Dato>}
              <Dato etiqueta="Entrega">{etiquetaDeEntrega(pedido.entrega)}</Dato>
              <Dato etiqueta="Pago">{etiquetaDePago(pedido.medio_pago)}</Dato>
              {direccion && <Dato etiqueta="Dirección">{direccion}</Dato>}
            </div>

            {pedido.notas && (
              <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3">
                <p className="eyebrow">Nota del comprador</p>
                <p className="mt-1 text-[13px] text-fg-2">{pedido.notas}</p>
              </div>
            )}

            <div>
              <p className="eyebrow mb-2">Detalle</p>

              <div className="rounded-xl border border-border">
                {lineas.map((l) => (
                  <div
                    key={l.id}
                    data-linea={l.id}
                    className="flex items-baseline justify-between gap-3 border-b border-border px-3.5 py-2.5 text-[13px] last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="text-fg-3">{l.cantidad}× </span>
                      {l.nombre}
                    </span>
                    <span className="flex-none tabular-nums">{`$${pesos(l.subtotal)}`}</span>
                  </div>
                ))}

                {Number(pedido.envio_costo) > 0 && (
                  <div className="flex items-baseline justify-between gap-3 border-t border-border px-3.5 py-2.5 text-[13px]">
                    <span>Envío</span>
                    <span className="tabular-nums">{`$${pesos(pedido.envio_costo)}`}</span>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-3 border-t border-border px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold">Total</span>
                  <span className="text-[15px] font-semibold tabular-nums">{`$${pesos(pedido.total)}`}</span>
                </div>
              </div>
            </div>

            {!puedeGestionar && (
              <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
                <p className="text-[12.5px] text-warn">
                  No podés cambiar el estado de un pedido: {faltaElPermiso('pedidos.gestionar').toLowerCase()}.
                </p>
              </div>
            )}

            {puedeGestionar && transiciones.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {transiciones.map((estado, i) => (
                  <button
                    key={estado}
                    type="button"
                    data-transicion={estado}
                    disabled={Boolean(moviendo)}
                    onClick={() => mover(estado)}
                    // El primero es el paso natural del pedido; los otros son
                    // salidas. «Cancelar» nunca es el principal, aunque quede
                    // primero en la lista de un estado.
                    className={i === 0 && estado !== 'cancelado' ? BOTON_PRINCIPAL : BOTON_SECUNDARIO}
                  >
                    {moviendo === estado && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {verboDeTransicion(estado)}
                  </button>
                ))}
              </div>
            )}

            {puedeGestionar && transiciones.length === 0 && (
              <p className="text-[12.5px] text-fg-3">
                Este pedido ya está {etiquetaDeEstadoDePedido(pedido.estado).toLowerCase()}: no cambia más de estado.
              </p>
            )}
          </div>
        )}
      </SheetContent>

      <ConfirmDialog />
    </Sheet>
  )
}
