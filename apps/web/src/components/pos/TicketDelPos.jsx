import { useEffect, useRef, useState } from 'react'
import { ChevronDown, HandCoins, Minus, Pencil, Plus, ShoppingCart, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import MedioDePago, { ListaQueCotiza } from '@/components/pos/MedioDePago'
import { ATRIBUTO_CAMPO, ATRIBUTO_LINEA } from '@/utils/atajosDelPos'

// ════════════════════════════════════════════
//  FAVALIO · Punto de venta, la columna derecha
//
//  400px fijos, con tres zonas: el encabezado propio del ticket, la lista de
//  líneas con SU PROPIO scroll, y el pie de cobro fijo abajo. El pie no
//  scrollea con las líneas: un total que hay que ir a buscar con la rueda del
//  mouse anula lo que los atajos vienen a resolver.
//
//  ── Lo que cambió en el rediseño ──
//
//  **La línea pasó de tres filas a dos.** Tenía una fila entera para el control
//  «Efectivo · Tarjeta · Alianza» y otra para el precio unitario con su etiqueta
//  «Precio u.». Con ocho productos, el ticket dejaba de entrar en la pantalla —
//  que es justo lo que las tres zonas vienen a garantizar.
//
//   · El medio de pago por línea SE FUE. Se elige una vez, abajo: el segmento
//     decidía el precio y el medio decidía cómo entra la plata, y dibujar las
//     dos preguntas con el mismo control en cada línea era la duplicación que
//     el rediseño viene a sacar.
//   · El precio unitario se edita EN EL MISMO LUGAR donde se lee. El campo
//     sigue siendo un `input` de verdad —no un botón que abre otra cosa— para
//     que `Esc` lo pueda limpiar por su `data-campo-del-pos`, que es como se
//     vuelve al precio de lista.
//
//  **La excepción se marca, y dice cuál es.** Un precio puesto a mano ya no es
//  un borde ámbar y la palabra «a mano»: la línea entera queda en ámbar y una
//  franja al pie dice cuánto sería de lista y ofrece volver. Sin excepciones, la
//  línea no muestra ningún control de pago ni ninguna marca.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta, igual que
//  el catálogo. Hay una guardia estática que lo verifica.
// ════════════════════════════════════════════

/** Importes que se cobran: siempre con centavos, en formato argentino. */
const pesos = (n) => Number(n || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Precios de lista, que se leen de un vistazo y no se suman: sin centavos. */
const pesosCortos = (n) => Number(n || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * Los dos comprobantes internos, para el submenú de «Sin factura».
 *
 * Un Remito y un Recibo X no viajan a ARCA y son intercambiables desde el pie;
 * cuál de los dos se usa es una costumbre de cada negocio. El resto de las
 * combinaciones vive en el panel de emisión.
 */
const INTERNOS = ['remito', 'recibo_x']

export default function TicketDelPos({
  lineas = [],
  onCantidad,
  onQuitar,
  onPrecio,
  medioDelTicket = 'ef',
  onMedioDelTicket,
  onVaciar,
  comprobantes = [],
  comprobante = '',
  onComprobante,
  desglose = null,
  total = 0,
  hayVuelto = false,
  pagaCon = '',
  onPagaCon,
  sugerencias = [],
  vuelto = 0,
  falta = 0,
  onCobrar,
  onFacturarDespues,
  onAbrirDatos,
  textoDeCobro = '',
  cobroHabilitado = true,
  comprobanteParaImprimir = null,
  onImprimir,
  avisoDeEspera = null,
  bloqueado = false,
  avisosDeStock = [],
  avisoDeCobro = null,
  onReintentarFacturacion,
  onCerrarAviso,
  motivoDeCobro = null,
}) {
  const [internosAbiertos, setInternosAbiertos] = useState(false)
  const cajaDeInternos = useRef(null)

  const elegido = comprobantes.find((c) => c.valor === comprobante)
  const conFactura = elegido?.fiscal === true

  // El fiscal que ofrece esta empresa: uno solo para un monotributista, y el
  // primero de los dos para un responsable inscripto. Cuál exactamente se
  // termina de decidir en el panel de emisión.
  const fiscal = comprobantes.find((c) => c.fiscal)
  const interno = comprobantes.find((c) => c.valor === comprobante && !c.fiscal)
    || comprobantes.find((c) => c.valor === 'remito')

  // Todos los no disponibles comparten motivo —es siempre el mismo: falta
  // configurar AFIP—, así que se dice una vez y no una por botón.
  const motivoDelComprobante = comprobantes.find((c) => !c.disponible)?.motivo || null

  const unidades = lineas.reduce((suma, l) => suma + Number(l.qty || 0), 0)

  useEffect(() => {
    if (!internosAbiertos) return undefined

    const alTocarAfuera = (evento) => {
      if (!cajaDeInternos.current?.contains(evento.target)) setInternosAbiertos(false)
    }

    document.addEventListener('pointerdown', alTocarAfuera)
    return () => document.removeEventListener('pointerdown', alTocarAfuera)
  }, [internosAbiertos])

  return (
    <aside className="flex min-h-0 w-[400px] shrink-0 flex-col bg-surface">
      {/* ── Encabezado propio del ticket (FR-014) ── */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 pb-3.5 pt-[18px]">
        <ShoppingCart className="h-[17px] w-[17px] text-fg-2" />
        <h2>Ticket</h2>
        <span className="num rounded-full bg-surface-3 px-[7px] py-px text-[11px] font-semibold text-fg-2">
          {lineas.length} ítems · {unidades} u.
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onVaciar}
          disabled={bloqueado}
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-3 transition-colors hover:text-danger disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="h-[13px] w-[13px]" />
          Vaciar
        </button>
      </div>

      {/* ── La venta que quedó registrada y sin comprobante (FR-051) ──
          Es un bloque FIJO y no un `toast`: un aviso que se va solo a los cinco
          segundos no alcanza para «no se emitió la factura». Se cierra a mano,
          cuando el operador ya decidió qué hacer. */}
      {avisoDeCobro && (
        <div className="mx-4 mt-3 shrink-0 rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5">
          <p className="text-[12.5px] text-danger">{avisoDeCobro.mensaje}</p>
          {/* Las diferencias van renglón por renglón y con los números
              concretos: «se registraron 1 y el ticket lleva 2» es lo que el
              operador necesita para decidir, y no entra en una sola línea de
              texto corrido. */}
          {avisoDeCobro.detalles?.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {avisoDeCobro.detalles.map((detalle) => (
                <li key={detalle} className="text-[12px] text-danger">{detalle}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-2">
            {avisoDeCobro.reintentable && (
              <button
                type="button"
                onClick={onReintentarFacturacion}
                disabled={bloqueado}
                className="h-7 rounded-md border border-danger-line bg-surface px-2.5 text-[12px] font-semibold text-danger disabled:pointer-events-none disabled:opacity-40"
              >
                Reintentar la facturación
              </button>
            )}
            <button
              type="button"
              onClick={onCerrarAviso}
              className="h-7 px-1 text-[12px] font-medium text-fg-3 hover:text-foreground"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ── Los avisos de stock, agrupados y fijos (decisión 7, FR-065/066) ── */}
      {avisosDeStock.length > 0 && (
        <ul className="mx-4 mt-3 shrink-0 space-y-1 rounded-lg border border-warn-line bg-warn-soft px-3 py-2">
          {avisosDeStock.map((aviso) => (
            <li key={aviso} className="text-[12px] text-warn">{aviso}</li>
          ))}
        </ul>
      )}

      {/* ── Imprimir el comprobante de la venta anterior (FR-050) ── */}
      {comprobanteParaImprimir && lineas.length === 0 && (
        <button
          type="button"
          onClick={onImprimir}
          className="mx-4 mt-3 shrink-0 rounded-lg border border-ok-line bg-ok-soft px-3 py-2 text-[12.5px] font-medium text-ok transition-colors hover:border-ok"
        >
          Imprimir el comprobante {comprobanteParaImprimir.voucherNumber}
        </button>
      )}

      {/* ── La lista, con su propio scroll (FR-002) ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {lineas.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-12 text-center">
            <ShoppingCart className="h-7 w-7 text-fg-3 opacity-45" />
            <p className="text-[13.5px] font-medium">Ticket vacío</p>
            {/* FR-015: el atajo NOMBRADO donde se usa. Un atajo que no está
                escrito en ningún lado no lo usa nadie. */}
            <p className="max-w-[30ch] text-[12.5px] text-fg-3">
              Buscá un producto y presioná{' '}
              <kbd className="num rounded border border-border bg-surface-3 px-1 py-px text-[11px]">
                Enter
              </kbd>
            </p>
          </div>
        ) : (
          lineas.map((linea) => (
            <div
              key={linea.id}
              className={cn(
                'flex flex-col gap-2 rounded-[11px] border bg-surface px-[13px] py-3',
                // La excepción se ve en la línea entera y no en un borde de un
                // solo campo: lo que hay que notar al repasar el ticket es que
                // ESA línea no cotiza como las demás.
                linea.precio_manual ? 'border-warn-line' : 'border-border'
              )}
            >
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{linea.name}</p>
                  {linea.marca && <p className="mt-0.5 truncate text-xs text-fg-3">{linea.marca}</p>}
                </div>
                <span className="num text-[15px] font-semibold">
                  ${pesos(linea.price * linea.qty)}
                </span>
                <button
                  type="button"
                  onClick={() => onQuitar?.(linea.id)}
                  disabled={bloqueado}
                  title="Quitar"
                  aria-label={`Quitar ${linea.name}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex items-center overflow-hidden rounded-[9px] border border-border bg-surface">
                  <button
                    type="button"
                    onClick={() => onCantidad?.(linea.id, linea.qty - 1)}
                    disabled={bloqueado}
                    aria-label={`Quitar una unidad de ${linea.name}`}
                    className="grid h-[34px] w-9 place-items-center text-fg-2 transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="num w-[34px] text-center text-sm font-semibold">{linea.qty}</span>
                  <button
                    type="button"
                    onClick={() => onCantidad?.(linea.id, linea.qty + 1)}
                    disabled={bloqueado}
                    aria-label={`Agregar una unidad de ${linea.name}`}
                    className="grid h-[34px] w-9 place-items-center text-fg-2 transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex-1" />

                {/* ── El precio unitario, editable donde se lee (FR-017) ──
                    El borde punteado dice «esto se puede tocar» sin agregar un
                    botón aparte; el lápiz lo confirma. Con precio a mano pasa a
                    ámbar lleno, que es la misma marca que lleva la línea. */}
                <div
                  className={cn(
                    'flex h-[34px] items-center gap-1 rounded-[9px] border px-2.5 transition-colors',
                    'focus-within:border-brand focus-within:ring-2 focus-within:ring-ring/40',
                    linea.precio_manual
                      ? 'border-warn-line bg-warn-soft'
                      : 'border-dashed border-border-2 bg-surface hover:border-brand-line'
                  )}
                >
                  <span className={cn('num text-xs', linea.precio_manual ? 'text-warn' : 'text-fg-3')}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={linea.price}
                    onChange={(e) => onPrecio?.(linea.id, e.target.value)}
                    disabled={bloqueado}
                    {...{ [ATRIBUTO_CAMPO]: 'precioDeLinea', [ATRIBUTO_LINEA]: linea.id }}
                    aria-label={`Precio unitario de ${linea.name}`}
                    className={cn(
                      'num w-[68px] bg-transparent text-right text-[12.5px] outline-none',
                      linea.precio_manual ? 'font-semibold text-warn' : 'text-fg-2'
                    )}
                  />
                  <span className={cn('text-[12.5px]', linea.precio_manual ? 'text-warn' : 'text-fg-3')}>
                    c/u
                  </span>
                  <Pencil className={cn('h-3 w-3', linea.precio_manual ? 'text-warn' : 'text-fg-3')} />
                </div>
              </div>

              {/* ── La excepción, escrita ──
                  «a mano» a secas no decía de cuánto se venía: el operador que
                  repasa el ticket no puede juzgar si el precio negociado está
                  bien sin el de lista al lado. */}
              {linea.precio_manual && (
                <div className="flex items-center gap-2 border-t border-dashed border-warn-line pt-2">
                  <HandCoins className="h-3.5 w-3.5 shrink-0 text-warn" />
                  <span className="text-xs text-warn">
                    Precio puesto a mano
                    {Number.isFinite(linea.precioDeLista)
                      && ` · de lista serían $${pesosCortos(linea.precioDeLista)}`}
                  </span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onPrecio?.(linea.id, '')}
                    disabled={bloqueado}
                    className="text-xs font-semibold text-warn underline underline-offset-2 disabled:pointer-events-none disabled:opacity-40"
                  >
                    volver al de lista
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── El pie de cobro, fijo abajo (FR-003) ── */}
      <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-surface-2 px-5 pb-3.5 pt-3">
        {/* ── Cómo cobra ──
            Una sola pregunta, y el nivel de precio como consecuencia escrita.
            Antes había tres botones acá y otros tres en cada línea, y ninguno
            de los seis decía con qué lista cotizaba lo elegido. */}
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Cómo cobra</span>
            <ListaQueCotiza valor={medioDelTicket} />
          </div>
          <MedioDePago
            valor={medioDelTicket}
            onCambio={onMedioDelTicket}
            deshabilitado={bloqueado}
            etiqueta="Medio de pago del ticket"
          />
        </div>

        {/* ── Vuelto ──
            La cuenta se hace en la cabeza o en el celular veinte veces por día,
            y ahí es donde se entrega mal el cambio. */}
        {hayVuelto && lineas.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-2.5">
              <label className="shrink-0 text-xs font-semibold text-fg-2" htmlFor="pos-paga-con">
                Paga con
              </label>
              <div className="relative w-[110px] shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-fg-3">$</span>
                <input
                  id="pos-paga-con"
                  {...{ [ATRIBUTO_CAMPO]: 'pagaCon' }}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0"
                  value={pagaCon}
                  onChange={(e) => onPagaCon?.(e.target.value)}
                  className="num h-[34px] w-full rounded-lg border border-border bg-surface pl-6 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              <div className="flex-1" />
              {pagaCon !== '' && (
                <div className="flex shrink-0 flex-col items-end">
                  <span className="eyebrow">Vuelto</span>
                  {/* «Faltan $3.200» y no «−$3.200»: interpretar un signo con la
                      mano en la caja es donde se entrega mal el cambio. */}
                  <span className={cn('num text-[17px] font-bold', falta > 0 ? 'text-danger' : 'text-ok')}>
                    {falta > 0 ? `Faltan $${pesos(falta)}` : `$${pesos(vuelto)}`}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              {sugerencias.map((monto) => (
                <button
                  key={monto}
                  type="button"
                  onClick={() => onPagaCon?.(String(monto))}
                  className="num h-6 rounded-md border border-border bg-surface px-2 text-[10px] text-fg-2 transition-colors hover:border-border-2"
                >
                  ${monto.toLocaleString('es-AR')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Con factura o sin factura ──
            Dos opciones con su consecuencia escrita, y no tres botones iguales
            con el nombre de un formulario de AFIP. Cuál de los dos fiscales —o
            cuál de los dos internos— se termina de elegir donde importa: en el
            panel de emisión, con los datos y el detalle a la vista (FR-019). */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fiscal && onComprobante?.(fiscal.valor)}
              disabled={bloqueado || !fiscal || fiscal.disponible === false}
              title={fiscal?.disponible === false ? fiscal.motivo : undefined}
              aria-pressed={conFactura}
              className={cn(
                'flex h-[38px] flex-1 items-center gap-[7px] rounded-[10px] border px-[11px] text-left transition-colors',
                conFactura
                  ? 'border-[1.5px] border-brand bg-brand-soft'
                  : 'border-border bg-surface hover:border-border-2',
                'disabled:pointer-events-none disabled:opacity-45'
              )}
            >
              <span className={cn('text-[12.5px] font-semibold', conFactura ? 'text-brand-dark' : 'text-foreground')}>
                Con factura
              </span>
              <span className={cn('truncate text-[11.5px]', conFactura ? 'text-brand-dark' : 'text-fg-3')}>
                {fiscal?.etiqueta || 'sin AFIP'}
              </span>
            </button>

            <div className="relative flex flex-1" ref={cajaDeInternos}>
              <button
                type="button"
                onClick={() => {
                  if (!conFactura) { setInternosAbiertos((a) => !a); return }
                  onComprobante?.(interno?.valor || 'remito')
                }}
                disabled={bloqueado}
                aria-pressed={!conFactura}
                aria-haspopup={!conFactura ? 'menu' : undefined}
                className={cn(
                  'flex h-[38px] flex-1 items-center gap-[7px] rounded-[10px] border px-[11px] text-left transition-colors',
                  !conFactura
                    ? 'border-[1.5px] border-brand bg-brand-soft'
                    : 'border-border bg-surface hover:border-border-2',
                  'disabled:pointer-events-none disabled:opacity-45'
                )}
              >
                <span className={cn('text-[12.5px] font-semibold', !conFactura ? 'text-brand-dark' : 'text-foreground')}>
                  Sin factura
                </span>
                <span className={cn('truncate text-[11.5px]', !conFactura ? 'text-brand-dark' : 'text-fg-3')}>
                  {conFactura ? 'Remito · interno' : `${interno?.etiqueta || 'Remito'} · interno`}
                </span>
                {!conFactura && <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-brand-dark" />}
              </button>

              {internosAbiertos && !conFactura && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 z-50 mb-1 min-w-[150px] rounded-lg border border-border bg-popover p-1 shadow-nivel-2"
                >
                  {comprobantes.filter((c) => INTERNOS.includes(c.valor)).map((c) => (
                    <button
                      key={c.valor}
                      type="button"
                      role="menuitem"
                      onClick={() => { setInternosAbiertos(false); onComprobante?.(c.valor) }}
                      className={cn(
                        'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-3',
                        c.valor === comprobante ? 'font-semibold text-brand-dark' : 'text-fg-2'
                      )}
                    >
                      {c.etiqueta}
                    </button>
                  ))}
                  {/* El nombre del comprador vive en el panel de emisión, y un
                      comprobante interno no lo abre: un remito no consume
                      numeración de ARCA, así que el camino rápido no pasa por
                      ahí. Esta es la puerta para las veces que sí hace falta —el
                      remito que el cliente se lleva con su nombre—, y no un
                      campo más ocupando alto en las otras cuarenta ventas. */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setInternosAbiertos(false); onAbrirDatos?.() }}
                    className="mt-1 flex w-full items-center rounded-md border-t border-border px-2 pb-1.5 pt-2 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-surface-3"
                  >
                    Datos del comprador…
                  </button>
                </div>
              )}
            </div>
          </div>
          {motivoDelComprobante && (
            <p className="text-[11.5px] text-warn">{motivoDelComprobante}</p>
          )}
        </div>

        {/* ── Total (FR-021) ── */}
        <div className="flex items-baseline justify-between border-t border-dashed border-border-2 pt-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Total a cobrar</span>
            {/* `desglose` viene en `null` para un monotributista, y entonces no
                se nombra ningún IVA: mostrarle una línea de IVA es decirle que
                cobró algo que no cobró (FR-022). */}
            <span className="num text-[11.5px] text-fg-3">
              {desglose ? `IVA ${desglose.alicuota}% incluido · ` : ''}{unidades} u.
            </span>
          </div>
          <span className="num text-[28px] font-semibold tracking-tight">${pesos(total)}</span>
        </div>

        {avisoDeEspera && (
          <p className="rounded-lg border border-info-line bg-info-soft px-3 py-2 text-[12.5px] text-info">
            {avisoDeEspera}
          </p>
        )}

        {/* Un botón deshabilitado sin motivo es un botón roto: se dice por qué
            y no se lo esconde (FR-024). */}
        {motivoDeCobro && (
          <p className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            {motivoDeCobro}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onCobrar}
            disabled={!cobroHabilitado}
            className={cn(
              'flex h-[50px] items-center justify-center gap-2.5 rounded-xl bg-brand text-[15.5px] font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark',
              'disabled:pointer-events-none disabled:bg-surface-3 disabled:text-fg-3 disabled:shadow-none'
            )}
          >
            {textoDeCobro}
            {/* FR-041: el atajo, adentro del botón que dispara. */}
            <kbd className="num rounded-[5px] bg-white/20 px-1.5 py-0.5 text-[11px] font-normal">
              Ctrl+Enter
            </kbd>
          </button>

          {/* ── Cobrar ahora y facturar después ──
              Una salida EXPLÍCITA y no un accidente. Pasaba igual —la venta
              quedaba registrada y sin comprobante cuando ARCA rechazaba—, pero
              solo por error: no había forma de elegirlo a propósito cuando el
              cliente no espera o ARCA está caído. La venta queda pendiente y se
              factura desde el historial. */}
          {conFactura && (
            <button
              type="button"
              onClick={onFacturarDespues}
              disabled={!cobroHabilitado}
              className="text-[12.5px] font-medium text-fg-2 underline underline-offset-2 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              Cobrar ahora y facturar después
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
