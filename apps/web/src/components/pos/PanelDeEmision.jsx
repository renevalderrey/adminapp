import { Info, TriangleAlert } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { pesos } from '@/utils/formato'
import { ATRIBUTO_CAMPO } from '@/utils/atajosDelPos'
import {
  datosDelComprador,
  nombreDeComprobante,
  UMBRAL_DE_IDENTIFICACION,
} from '@/utils/comprobantes'
import { etiquetaDePago } from '@/utils/mediosDePago'

// ════════════════════════════════════════════
//  FAVALIO · El panel de emisión
//
//  ── Qué problema resuelve ──
//
//  El pie de cobro pedía la condición frente al IVA, el CUIT y el nombre del
//  cliente SIEMPRE, ocupando alto en la pantalla que se usa ocho horas por día,
//  y no decía cuál de los tres hacía falta para el comprobante elegido. Lo
//  descubría el servidor: `CUIT_REQUERIDO` llegaba DESPUÉS de registrar la
//  venta, con la operación ya asentada y el cliente enfrente.
//
//  Y lo que se iba a facturar no se veía nunca. «Confirmar venta» mandaba a
//  ARCA un comprobante que consume un número correlativo —para darlo de baja
//  hace falta una nota de crédito, que el sistema todavía no emite— sin mostrar
//  antes qué líneas llevaba ni con qué IVA.
//
//  Acá se ven las dos cosas juntas, una sola vez, justo antes del acto
//  irreversible: los datos que ESE comprobante pide, y el detalle producto por
//  producto.
//
//  ── Por qué el rechazo de ARCA se queda ACÁ ──
//
//  Cuando ARCA rechaza, la venta YA quedó registrada y lo único que falta es el
//  comprobante. El panel no se cierra: muestra el motivo que devolvió el
//  organismo —tal cual, sin traducir, porque el código de ARCA es lo que se
//  busca cuando hay que llamar por teléfono— y el reintento queda a un clic,
//  con los mismos campos que hay que corregir a la vista. Cerrarlo deja el
//  aviso fijo en el ticket, que es de donde se puede volver.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta, igual que
//  el catálogo y el ticket. Hay una guardia estática que lo verifica.
// ════════════════════════════════════════════

const CAMPO =
  'h-10 w-full rounded-[9px] border border-border bg-surface px-3 text-[13.5px] outline-none '
  + 'transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/40'

/** Las columnas del detalle. Un solo string para el encabezado y las filas. */
const COLUMNAS_CON_IVA = 'minmax(0,1fr) 44px 96px 84px 100px'
const COLUMNAS_SIN_IVA = 'minmax(0,1fr) 44px 96px 100px'

export default function PanelDeEmision({
  abierto = false,
  onCerrar,
  comprobantes = [],
  comprobante = '',
  onComprobante,
  condicionIva = '5',
  onCondicionIva,
  cuit = '',
  onCuit,
  nombreCliente = '',
  onNombreCliente,
  buscadorDeClientes = null,
  detalle = { filas: [], total: 0, unidades: 0, desglose: null },
  medio = 'ef',
  hayVuelto = false,
  vuelto = 0,
  falta = 0,
  ambiente = 'homologation',
  onEmitir,
  onCobrarSinFactura,
  procesando = false,
  textoDeEmision = '',
  motivoDeEmision = null,
  avisoDeEspera = null,
  rechazoDeArca = null,
}) {
  const pedido = datosDelComprador(comprobante)
  const nombre = nombreDeComprobante(comprobante)
  const { desglose } = detalle
  const columnas = desglose ? COLUMNAS_CON_IVA : COLUMNAS_SIN_IVA

  // ⚠ El valor guardado es `'production'`, en inglés. Estaba escrito
  // `'produccion'` en las dos pantallas que emiten, así que la comparación daba
  // `false` SIEMPRE: el ambiente de verdad —el único donde el comprobante tiene
  // validez fiscal y el número no se devuelve— se anunciaba como si fuera el de
  // pruebas. `afipAuth.js:52` es la fuente.
  const enProduccion = ambiente === 'production'

  return (
    <Sheet open={abierto} onOpenChange={(v) => { if (!v) onCerrar?.() }}>
      <SheetContent
        side="right"
        // El ancho va en `style` y no en clases: `SheetContent` trae
        // `data-[side=right]:sm:max-w-sm` y `w-3/4` propios, y esas reglas viven
        // en un media query que gana por orden de hoja. Es la misma salida que
        // usan los otros cuatro paneles.
        style={{ width: '620px', maxWidth: '95vw' }}
        className="anim-panel flex flex-col gap-0 bg-surface p-0 shadow-nivel-3"
      >
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-6 pb-4 pt-5">
          <div className="flex items-center gap-2.5">
            <SheetTitle className="text-lg font-semibold tracking-tight">
              Emitir {nombre}
            </SheetTitle>
            <span
              className={cn(
                'rounded-md border px-[7px] py-0.5 text-[11px] font-semibold',
                enProduccion
                  ? 'border-danger-line bg-danger-soft text-danger'
                  : 'border-info-line bg-info-soft text-info'
              )}
            >
              {enProduccion ? 'Producción' : 'Homologación'}
            </span>
          </div>
          <SheetDescription className="text-[12.5px] text-fg-2">
            Se registra la venta y se pide el CAE a ARCA.{' '}
            {enProduccion
              ? 'El comprobante tiene validez fiscal y consume un número correlativo: para '
                + 'darlo de baja hace falta una nota de crédito, que el sistema todavía no emite.'
              : 'En homologación el comprobante no tiene validez fiscal.'}
          </SheetDescription>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* ── Qué comprobante ──
              Los internos están en la misma lista y no en otro lugar: elegir
              «Remito» acá es la salida de quien abrió el panel y se dio cuenta
              de que esta venta no lleva factura. */}
          <div className="flex flex-col gap-2.5">
            <span className="eyebrow">Comprobante</span>
            <div className="grid grid-cols-3 gap-2">
              {comprobantes.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  onClick={() => onComprobante?.(c.valor)}
                  disabled={c.disponible === false || procesando}
                  title={c.disponible === false ? c.motivo : undefined}
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                    c.valor === comprobante
                      ? 'border-[1.5px] border-brand bg-brand-soft'
                      : 'border-border bg-surface hover:border-border-2',
                    'disabled:pointer-events-none disabled:opacity-45'
                  )}
                >
                  <span
                    className={cn(
                      'text-[13.5px] font-semibold',
                      c.valor === comprobante ? 'text-brand-dark' : 'text-foreground'
                    )}
                  >
                    {c.etiqueta}
                  </span>
                  <span
                    className={cn(
                      'text-[11.5px]',
                      c.valor === comprobante ? 'text-brand-dark' : 'text-fg-3'
                    )}
                  >
                    {c.fiscal ? 'fiscal · a ARCA' : 'interno · sin IVA'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Los datos que ESE comprobante pide ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="eyebrow">Datos del comprador</span>
              <span className="text-[11.5px] text-fg-3">lo que pide {nombre}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-fg-2" htmlFor="emision-condicion">
                  Condición frente al IVA
                </label>
                {/* Con Factura A la condición NO se elige: se emite a un
                    Responsable Inscripto y ARCA rechaza cualquier otra. Un
                    selector abierto acá ofrece una combinación inválida. */}
                <select
                  id="emision-condicion"
                  value={pedido.condicionFija || condicionIva}
                  disabled={Boolean(pedido.condicionFija) || !pedido.fiscal}
                  onChange={(e) => onCondicionIva?.(e.target.value)}
                  className={cn(CAMPO, 'disabled:bg-surface-2 disabled:text-fg-2')}
                >
                  <option value="5">Consumidor final</option>
                  <option value="1">Resp. inscripto</option>
                  <option value="6">Monotributo</option>
                  <option value="4">Exento</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  className="flex items-center gap-1.5 text-xs font-semibold text-fg-2"
                  htmlFor="emision-cuit"
                >
                  CUIT / DNI
                  <span className="rounded bg-surface-3 px-1.5 py-px text-[10.5px] font-semibold text-fg-2">
                    {pedido.cuitObligatorio ? 'obligatorio' : 'opcional'}
                  </span>
                </label>
                <input
                  id="emision-cuit"
                  {...{ [ATRIBUTO_CAMPO]: 'cuit' }}
                  type="number"
                  value={cuit}
                  onChange={(e) => onCuit?.(e.target.value)}
                  // ⚠ NO se deshabilita durante el cobro, y es a propósito: el
                  // caso que este panel viene a resolver es `CUIT_REQUERIDO`, y
                  // ahí el dato hay que cargarlo con la venta ya registrada. Un
                  // campo que se deshabilita pierde el foco, y perder el foco
                  // mientras alguien tipea es el defecto de los escenarios 3.3 y
                  // 3.7. Lo que no puede cambiar durante el cobro es el TICKET
                  // (FR-046), que es otra cosa.
                  disabled={!pedido.fiscal}
                  placeholder={pedido.cuitObligatorio ? '11 dígitos' : 'Sin dato: Consumidor final'}
                  className={cn(CAMPO, 'num disabled:bg-surface-2 disabled:text-fg-2')}
                />
              </div>

              <div className="col-span-2 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-fg-2" htmlFor="emision-nombre">
                  Nombre en el comprobante
                </label>
                {buscadorDeClientes}
                <input
                  id="emision-nombre"
                  {...{ [ATRIBUTO_CAMPO]: 'cliente' }}
                  value={nombreCliente}
                  onChange={(e) => onNombreCliente?.(e.target.value)}
                  placeholder="Consumidor final"
                  className={CAMPO}
                />
              </div>
            </div>

            <div className="flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft px-3 py-2.5">
              <Info className="h-[15px] w-[15px] shrink-0 text-info" />
              <p className="text-xs text-info">
                {pedido.nota}
                {/* El umbral se nombra solo cuando el ticket lo pasa: una nota
                    fija sobre un monto que esta venta no alcanza es ruido en
                    las otras cuarenta y nueve del día. */}
                {pedido.fiscal && !pedido.cuitObligatorio
                  && detalle.total >= UMBRAL_DE_IDENTIFICACION && (
                  <>
                    {' '}Arriba de ${pesos(UMBRAL_DE_IDENTIFICACION)} ARCA pide identificar al
                    comprador, y este ticket lo pasa.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* ── Lo que se factura, producto por producto ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="eyebrow">Detalle que se factura</span>
              <span className="num text-[11.5px] text-fg-3">
                {detalle.filas.length} ítems · {detalle.unidades} unidades
              </span>
            </div>

            <div className="overflow-hidden rounded-[11px] border border-border">
              <div
                className="eyebrow grid bg-surface-3 px-3.5 py-2.5"
                style={{ gridTemplateColumns: columnas, gap: '0 12px' }}
              >
                <span>Producto</span>
                <span className="text-right">Cant.</span>
                <span className="text-right">{desglose ? 'Neto u.' : 'Precio u.'}</span>
                {desglose && <span className="text-right">IVA {desglose.alicuota}%</span>}
                <span className="text-right">Subtotal</span>
              </div>

              {detalle.filas.map((fila) => (
                <div
                  key={fila.id}
                  className="grid items-center border-t border-border bg-surface px-3.5 py-2.5"
                  style={{ gridTemplateColumns: columnas, gap: '0 12px' }}
                >
                  <span className="truncate text-[13.5px]">{fila.nombre}</span>
                  <span className="num text-right text-[13px]">{fila.cantidad}</span>
                  <span className="num text-right text-[13px] text-fg-2">
                    ${pesos(desglose ? fila.neto : fila.unitario)}
                  </span>
                  {desglose && (
                    <span className="num text-right text-[13px] text-fg-2">${pesos(fila.iva)}</span>
                  )}
                  <span className="num text-right text-[13.5px] font-semibold">
                    ${pesos(fila.subtotal)}
                  </span>
                </div>
              ))}

              <div className="flex flex-col gap-1.5 border-t border-border bg-surface-2 px-3.5 py-3">
                {/* Las dos líneas de IVA existen SOLO cuando el comprobante
                    discrimina. Una Factura C no discrimina —el servidor le
                    manda `ImpIVA: 0`—, y dibujarle un IVA del 21 % al
                    monotributista es decirle que cobró algo que no cobró. */}
                {desglose ? (
                  <>
                    <div className="flex justify-between text-[13px] text-fg-2">
                      <span>Neto gravado</span>
                      <span className="num">${pesos(desglose.neto)}</span>
                    </div>
                    <div className="flex justify-between text-[13px] text-fg-2">
                      <span>IVA {desglose.alicuota}% incluido</span>
                      <span className="num">${pesos(desglose.iva)}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-[12.5px] text-fg-3">
                    {nombre} no discrimina IVA: el total es el importe del comprobante.
                  </p>
                )}
                <div className="flex items-baseline justify-between border-t border-dashed border-border-2 pt-2">
                  <span className="text-sm font-semibold">Total {pedido.fiscal ? 'de la factura' : 'del comprobante'}</span>
                  <span className="num text-[22px] font-semibold tracking-tight">
                    ${pesos(detalle.total)}
                  </span>
                </div>
              </div>
            </div>

            {pedido.fiscal && (
              <div className="flex gap-2.5 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2.5">
                <TriangleAlert className="h-[15px] w-[15px] shrink-0 text-warn" />
                <p className="text-xs text-warn">
                  Emitir consume un número correlativo de ARCA. Si ARCA rechaza, la venta queda
                  registrada igual y el reintento aparece acá mismo con el motivo que devolvió el
                  organismo.
                </p>
              </div>
            )}
          </div>

          {/* ── El rechazo, con el motivo tal cual lo devolvió ARCA ── */}
          {rechazoDeArca && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2.5">
              <p className="text-[12.5px] text-danger">{rechazoDeArca}</p>
              <p className="text-xs text-danger">
                La venta ya está registrada: reintentar pide SOLO el comprobante y no vuelve a
                descontar stock.
              </p>
            </div>
          )}

          {avisoDeEspera && (
            <p className="rounded-[10px] border border-info-line bg-info-soft px-3 py-2.5 text-[12.5px] text-info">
              {avisoDeEspera}
            </p>
          )}

          {motivoDeEmision && (
            <p className="rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn">
              {motivoDeEmision}
            </p>
          )}
        </div>

        {/* ── El pie: con qué cobra, y las dos salidas ── */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface-2 px-6 py-4">
          <div className="flex min-w-0 flex-col">
            <span className="text-[11.5px] text-fg-3">Cobra con</span>
            <span className="truncate text-[13.5px] font-semibold">
              {etiquetaDePago(medio)}
              {hayVuelto && falta <= 0 && vuelto > 0 && ` · vuelto $${pesos(vuelto)}`}
              {hayVuelto && falta > 0 && ` · faltan $${pesos(falta)}`}
            </span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCobrarSinFactura}
            disabled={procesando}
            className="h-[46px] rounded-[11px] border border-border bg-surface px-4 text-[13.5px] font-medium text-fg-2 transition-colors hover:border-border-2 disabled:pointer-events-none disabled:opacity-45"
          >
            Cobrar sin factura
          </button>
          <button
            type="button"
            onClick={onEmitir}
            disabled={procesando || Boolean(motivoDeEmision)}
            className={cn(
              'flex h-[46px] items-center gap-2.5 rounded-[11px] bg-brand px-5 text-[15px] font-semibold text-white',
              'transition-colors hover:bg-brand-dark',
              'disabled:pointer-events-none disabled:bg-surface-3 disabled:text-fg-3'
            )}
          >
            {textoDeEmision || `${rechazoDeArca ? 'Reintentar' : 'Emitir'} ${nombre} · $${pesos(detalle.total)}`}
            <kbd className="num rounded-[5px] bg-white/20 px-1.5 py-0.5 text-[11px] font-normal">
              Ctrl+Enter
            </kbd>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
