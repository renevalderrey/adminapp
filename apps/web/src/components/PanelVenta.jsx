import React from 'react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { presentacionDeEstado } from '@/utils/estadoVenta'
import { AlertTriangle, Loader2, Printer } from 'lucide-react'

// ════════════════════════════════════════════
//  ADMINAPP · Panel de detalle de un comprobante
//
//  Lo que la fila no entra a mostrar: ítems, CUIT, condición de IVA, medio de
//  pago, sucursal, vencimiento del CAE. Es un panel lateral y no un modal
//  porque el usuario tiene que poder mirar el detalle SIN perder la lista: al
//  cerrarlo, la página, los filtros, el orden y el scroll quedan donde
//  estaban.
//
//  Se apoya en `Sheet` (components/ui/sheet.jsx), que ya resuelve Esc, el clic
//  en el overlay, la trampa de foco, el bloqueo del scroll del body y el
//  retorno del foco a la fila. Escrito a mano ese trabajo de accesibilidad
//  queda a medias. Lo nuestro es la medida, la sombra y la animación.
// ════════════════════════════════════════════

/**
 * Etiquetas de medio de pago.
 *
 * Son las mismas que escribe el archivo exportado (`routes/sales.js`), que a
 * su vez son las del sistema anterior: es lo que el usuario leyó durante años
 * en sus planillas.
 */
const ETIQUETAS_DE_PAGO = {
  ef: 'Efectivo',
  tr: 'Transferencia',
  qr: 'QR',
  td: 'T. Débito',
  tc1: 'Créd. 1 pago',
  tc3v: 'Visa 3c',
  tc3m: 'Master 3c',
  tc3n: 'Naranja 3c',
  al: 'Alianza',
  tc: 'T. Crédito',
}

const ETIQUETAS_DE_TIPO = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' }

const ETIQUETAS_DE_CONDICION = {
  consumidor_final: 'Consumidor final',
  monotributo: 'Monotributo',
  ri: 'Responsable inscripto',
  exento: 'Exento',
}

const pesos = (n) => Number(n || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** AFIP devuelve el vencimiento del CAE como «20260811». */
function fechaDeAfip(vto) {
  const t = String(vto || '')
  if (!/^\d{8}$/.test(t)) return t || '—'
  return `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)}`
}

/** «2026-08-01» → «01/08/2026», sin pasar por Date: `new Date('2026-08-01')`
 *  se interpreta en UTC y en Argentina muestra el día anterior. */
function fechaCorta(iso) {
  const t = String(iso || '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t || '—'
  const [a, m, d] = t.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** Momento completo de un timestamp, para la fecha del último intento. */
function momento(valor) {
  if (!valor) return ''
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR')
}

function numeroDeComprobante(venta) {
  if (!venta.afip_cae || !venta.afip_nro) return null
  const pv = String(venta.afip_pv || 0).padStart(4, '0')
  const nro = String(venta.afip_nro).padStart(8, '0')
  return `${pv}-${nro}`
}

function nombreDelCliente(venta) {
  return (venta.customer && venta.customer.name) || venta.customer_name || 'Consumidor final'
}

/** Una línea de dato: etiqueta arriba, valor abajo. */
function Dato({ etiqueta, children, mono = false }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{etiqueta}</p>
      <p className={`mt-1 truncate text-[13.5px] ${mono ? 'num' : ''}`}>{children || '—'}</p>
    </div>
  )
}

/**
 * @param {object|null} venta  El detalle que devuelve GET /api/sales/:id.
 * @param {boolean} cargando   El detalle todavía viaja.
 * @param {React.ReactNode} acciones  El pie del panel, que lo arma la pantalla.
 */
export default function PanelVenta({ abierto, onOpenChange, venta, cargando, acciones, onImprimir, imprimiendo }) {
  const estado = (venta && venta.estado) || {}
  const presentacion = presentacionDeEstado(estado.codigo)
  const IconoDeEstado = presentacion.icono

  const numero = venta ? numeroDeComprobante(venta) : null
  const items = (venta && venta.items) || []

  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent
        // El ancho va en `style` y no en clases: `SheetContent` trae
        // `data-[side=right]:sm:max-w-sm` y `w-3/4` propios, y esas reglas
        // viven en un media query que gana por orden de hoja. Un estilo en
        // línea las supera sin pelearse con el orden del CSS.
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        {/* ── Encabezado ── */}
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Comprobante</p>

          <SheetTitle className="num mt-1 text-[19px] font-semibold">
            {numero || '—'}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            {venta ? (
              <>
                {venta.afip_cae ? (ETIQUETAS_DE_TIPO[venta.afip_type] || 'Comprobante fiscal') : 'Sin comprobante fiscal'}
                {' · '}
                <span className="num">{fechaCorta(venta.date)} {venta.time}</span>
                {' · '}
                {(venta.puntoDeVenta && venta.puntoDeVenta.name) || venta.location || 'Sin sucursal'}
              </>
            ) : 'Cargando…'}
          </SheetDescription>

          {venta && (
            <span
              className={`mt-3 inline-flex w-fit items-center gap-1 rounded-md border px-2 py-[3px]
                          text-xs font-semibold ${presentacion.fondo} ${presentacion.linea} ${presentacion.texto}`}
            >
              {IconoDeEstado && <IconoDeEstado className="h-3 w-3" />}
              {estado.etiqueta}
            </span>
          )}
        </div>

        {cargando && !venta ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-fg-2">
            <Loader2 className="h-4 w-4 animate-spin text-fg-3" />
            Cargando el comprobante…
          </div>
        ) : venta ? (
          <div className="flex flex-col gap-7 px-6 py-6">

            {/* ── El rechazo guardado ──
                Solo cuando el estado es «rechazada». Es lo que hoy se pierde
                al cerrar la pestaña: el error se logueaba y se devolvía en la
                respuesta HTTP, pero no se guardaba, y la venta quedaba
                indistinguible de una venta interna hecha a propósito. */}
            {estado.codigo === 'rechazada' && venta.afip_ultimo_error && (
              <div className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3.5">
                <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-danger">AFIP rechazó el último intento</p>
                  <p className="mt-1 break-words text-[12.5px] text-fg-2">{venta.afip_ultimo_error}</p>
                  {venta.afip_ultimo_intento && (
                    <p className="num mt-1.5 text-[11.5px] text-fg-3">{momento(venta.afip_ultimo_intento)}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── La anulada que sigue vigente ante ARCA ── */}
            {estado.codigo === 'anulada_con_cae' && (
              <div className="flex items-start gap-3 rounded-xl border border-warn-line bg-warn-soft px-4 py-3.5">
                <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-warn">El comprobante sigue vigente ante ARCA</p>
                  <p className="mt-1 text-[12.5px] text-fg-2">
                    La venta está anulada en el sistema, pero el comprobante quedó
                    emitido y sigue declarado. Para revertirlo hace falta una nota
                    de crédito, que el sistema todavía no emite.
                  </p>
                </div>
              </div>
            )}

            {/* ── Datos ── */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              <Dato etiqueta="Cliente">{nombreDelCliente(venta)}</Dato>
              <Dato etiqueta="CUIT / DNI" mono>{venta.customer?.tax_id}</Dato>
              <Dato etiqueta="Condición IVA">
                {ETIQUETAS_DE_CONDICION[venta.customer?.tax_condition] || (venta.customer_id ? venta.customer?.tax_condition : 'Consumidor final')}
              </Dato>
              <Dato etiqueta="Medio de pago">
                {ETIQUETAS_DE_PAGO[venta.payment_method] || venta.payment_method}
              </Dato>
              <Dato etiqueta="Sucursal">
                {(venta.puntoDeVenta && venta.puntoDeVenta.name) || venta.location}
              </Dato>
              <Dato etiqueta="Vendedor">{venta.seller}</Dato>
              <Dato etiqueta="CAE" mono>{venta.afip_cae}</Dato>
              <Dato etiqueta="Vence el CAE" mono>
                {venta.afip_cae ? fechaDeAfip(venta.afip_vto) : null}
              </Dato>
            </div>

            {/* ── Ítems ── */}
            <div>
              <h2 className="mb-2.5">Detalle</h2>

              {items.length === 0 ? (
                /* No se dibuja una tabla vacía: una tabla con encabezados y sin
                   filas parece un error de carga. */
                <div className="rounded-xl border border-dashed border-border-2 px-4 py-8 text-center">
                  <p className="text-[13px] font-semibold">Esta venta no tiene ítems cargados.</p>
                  <p className="mx-auto mt-1 max-w-[40ch] text-[12.5px] text-fg-2">
                    Se registró por su total, sin desglose de productos.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="eyebrow grid grid-cols-[minmax(0,1fr)_52px_84px_92px] gap-x-3 border-b border-border bg-surface-2 px-4 py-2">
                    <span>Detalle</span>
                    <span className="text-right">Cant.</span>
                    <span className="text-right">Unitario</span>
                    <span className="text-right">Subtotal</span>
                  </div>

                  {items.map((item, i) => (
                    <div
                      key={item.id || `${item.product_name}-${i}`}
                      className="grid grid-cols-[minmax(0,1fr)_52px_84px_92px] items-center gap-x-3 border-b border-border px-4 py-2.5"
                    >
                      {/* product_name sobrevive al borrado del producto: es el
                          nombre con el que se vendió, no el actual. */}
                      <span className="truncate text-[13px]" title={item.product_name}>
                        {item.product_name}
                      </span>
                      <span className="num text-right text-[13px]">{item.quantity}</span>
                      <span className="num text-right text-[13px] text-fg-2">${pesos(item.unit_price)}</span>
                      <span className="num text-right text-[13px] font-semibold">
                        ${pesos(Number(item.quantity) * Number(item.unit_price))}
                      </span>
                    </div>
                  ))}

                  <div className="flex items-baseline justify-between px-4 py-3">
                    <span className="text-[13px] font-semibold">Total</span>
                    <span className="num text-[18px] font-semibold">${pesos(venta.total)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* ── Pie ──
            Las acciones las arma la pantalla: son las que dependen del estado
            y de los permisos, y este componente no tiene por qué conocerlos. */}
        {venta && (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-6 py-4">
            <button
              onClick={() => onImprimir?.(venta)}
              disabled={imprimiendo}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface
                         px-3 text-[13px] font-medium transition-colors hover:bg-surface-3
                         disabled:pointer-events-none disabled:opacity-50"
            >
              {imprimiendo
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-3" />
                : <Printer className="h-3.5 w-3.5 text-fg-3" />}
              Imprimir
            </button>

            <div className="flex-1" />

            {acciones}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
