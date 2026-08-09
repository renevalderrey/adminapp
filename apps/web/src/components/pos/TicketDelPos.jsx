import { ShoppingCart, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import SegmentoDePago from '@/components/pos/SegmentoDePago'
import { ATRIBUTO_CAMPO, ATRIBUTO_LINEA } from '@/utils/atajosDelPos'

// ════════════════════════════════════════════
//  FAVALIO · Punto de venta, la columna derecha
//
//  400px fijos —no 380 como tenía la barra de carrito anterior—, con tres
//  zonas: el encabezado propio del ticket, la lista de líneas con SU PROPIO
//  scroll, y el pie de cobro fijo abajo. El pie no scrollea con las líneas: un
//  total que hay que ir a buscar con la rueda del mouse anula lo que los atajos
//  vienen a resolver.
//
//  ── El precio manual se conserva entero ──
//
//  La maqueta no lo dibuja porque se dibujó ANTES de que existiera. Una función
//  liberada no se pierde por seguir un dibujo (FR-017, mismo criterio que
//  FR-009 de la funcionalidad 010): en el mostrador se negocia, y sin el precio
//  a mano hay que cerrar la venta con el de lista y arreglarlo después.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta, igual que
//  el catálogo y por el mismo motivo. Hay una guardia estática que lo verifica.
// ════════════════════════════════════════════

/** Importes que se cobran: siempre con centavos, en formato argentino. */
const pesos = (n) => Number(n || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export default function TicketDelPos({
  lineas = [],
  onCantidad,
  onQuitar,
  onPrecio,
  onMedio,
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
  condicionIva = '5',
  onCondicionIva,
  cuit = '',
  onCuit,
  nombreCliente = '',
  onNombreCliente,
  buscadorDeClientes = null,
  onCobrar,
  textoDeCobro = 'Confirmar venta',
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
  const elegido = comprobantes.find((c) => c.valor === comprobante)
  const esFiscal = elegido?.fiscal === true

  // Todos los no disponibles comparten motivo —es siempre el mismo: falta
  // configurar AFIP—, así que se dice una vez y no una por botón.
  const motivoDelComprobante = comprobantes.find((c) => !c.disponible)?.motivo || null

  return (
    <aside className="flex min-h-0 w-[400px] shrink-0 flex-col bg-surface">
      {/* ── Encabezado propio del ticket (FR-014) ── */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 pb-3.5 pt-[18px]">
        <ShoppingCart className="h-[17px] w-[17px] text-fg-2" />
        <h2>Ticket</h2>
        <span className="num rounded-full bg-surface-3 px-[7px] py-px text-[11px] font-semibold text-fg-2">
          {lineas.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onVaciar}
          disabled={bloqueado}
          className="text-[12.5px] font-medium text-fg-3 transition-colors hover:text-danger disabled:pointer-events-none disabled:opacity-40"
        >
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

      {/* ── Los avisos de stock, agrupados y fijos (decisión 7, FR-065/066) ──
          Tres productos sin fila de stock eran cuatro `toast` compitiendo con
          el verde de éxito, y el que importa se iba solo a los segundos. Acá
          quedan hasta que empieza el ticket siguiente. */}
      {avisosDeStock.length > 0 && (
        <ul className="mx-4 mt-3 shrink-0 space-y-1 rounded-lg border border-warn-line bg-warn-soft px-3 py-2">
          {avisosDeStock.map((aviso) => (
            <li key={aviso} className="text-[12px] text-warn">{aviso}</li>
          ))}
        </ul>
      )}

      {/* ── Imprimir el comprobante de la venta anterior (FR-050) ──
          Arriba de la lista y NO en el pie de cobro: ahí era un botón de ancho
          completo pegado al de cobrar, en la pantalla donde apretar el botón de
          al lado cuesta una venta duplicada. Sigue disponible mientras el
          ticket nuevo está vacío y desaparece con la primera línea: a partir de
          ahí lo que importa es la venta que se está armando. */}
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
              className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-[11px]"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{linea.name}</p>
                  <p className="num mt-0.5 text-[11.5px] text-fg-3">${pesos(linea.price)} c/u</p>
                </div>
                <span className="num text-[14.5px] font-semibold">
                  ${pesos(linea.price * linea.qty)}
                </span>
                <button
                  type="button"
                  onClick={() => onQuitar?.(linea.id)}
                  disabled={bloqueado}
                  title="Quitar"
                  aria-label={`Quitar ${linea.name}`}
                  className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                >
                  <X className="h-[13px] w-[13px]" />
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface">
                  <button
                    type="button"
                    onClick={() => onCantidad?.(linea.id, linea.qty - 1)}
                    disabled={bloqueado}
                    aria-label={`Quitar una unidad de ${linea.name}`}
                    className="grid h-7 w-7 place-items-center text-fg-2 transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Minus className="h-[13px] w-[13px]" />
                  </button>
                  <span className="num w-[30px] text-center text-[13px] font-semibold">{linea.qty}</span>
                  <button
                    type="button"
                    onClick={() => onCantidad?.(linea.id, linea.qty + 1)}
                    disabled={bloqueado}
                    aria-label={`Agregar una unidad de ${linea.name}`}
                    className="grid h-7 w-7 place-items-center text-fg-2 transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Plus className="h-[13px] w-[13px]" />
                  </button>
                </div>

                <div className="flex-1" />

                {/* El medio de pago por línea, con el medio exacto adentro del
                    segmento. Antes eran tres botones que escribían `ef`, `tc3`
                    y `al`: `tc3` no existía en ninguna de las tres listas del
                    sistema, así que el historial y el archivo exportado lo
                    mostraban crudo. */}
                <SegmentoDePago
                  valor={linea.method}
                  onCambio={(codigo) => onMedio?.(linea.id, codigo)}
                  deshabilitado={bloqueado}
                  etiqueta={`Medio de pago de ${linea.name}`}
                />
              </div>

              {/* ── Precio a mano (FR-017) ── */}
              <div className="flex items-center gap-2">
                <label className="eyebrow shrink-0">Precio u.</label>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">$</span>
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
                      'num h-7 w-full rounded-lg border bg-surface pl-5 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                      linea.precio_manual ? 'border-warn' : 'border-border'
                    )}
                  />
                </div>
                {linea.precio_manual && (
                  <button
                    type="button"
                    onClick={() => onPrecio?.(linea.id, '')}
                    disabled={bloqueado}
                    title="Volver al precio de lista"
                    className="h-7 shrink-0 rounded-lg border border-warn-line bg-warn-soft px-2 text-[10px] font-semibold text-warn"
                  >
                    a mano
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── El pie de cobro, fijo abajo (FR-003) ── */}
      <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-surface-2 px-5 pb-[18px] pt-4">
        {/* ── El medio de pago del ticket (decisión 3 de la spec) ──
            Las líneas NUEVAS lo heredan. Antes cada línea nacía en efectivo, y
            un ticket de ocho productos pagado con tarjeta exigía ocho clics —y
            el precio de las que se olvidaran quedaba mal, porque cada nivel
            tiene otro precio. */}
        <div className="flex items-center gap-2">
          <label className="text-[11.5px] font-semibold text-fg-2">Medio de pago</label>
          <div className="flex-1" />
          <SegmentoDePago
            valor={medioDelTicket}
            onCambio={onMedioDelTicket}
            deshabilitado={bloqueado}
            etiqueta="Medio de pago del ticket"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] font-semibold text-fg-2">Comprobante</label>
          {/* FR-019: un CONTROL SEGMENTADO y no un `<select>`. Los botones se
              reparten el ancho y comparten borde y estados: con un desplegable
              hay que abrirlo para saber qué está elegido, y acá el operador
              emite el mismo comprobante cincuenta veces seguidas. */}
          <div className="flex gap-1.5">
            {comprobantes.map((c) => (
              <button
                key={c.valor}
                type="button"
                onClick={() => onComprobante?.(c.valor)}
                // Deshabilitado con su explicación, NO ausente (FR-055): un
                // comprobante que no está no se puede pedir; uno deshabilitado
                // que dice por qué, sí.
                disabled={c.disponible === false || bloqueado}
                title={c.disponible === false ? c.motivo : undefined}
                className={cn(
                  'h-8 flex-1 rounded-lg border text-[12.5px] transition-colors',
                  c.valor === comprobante
                    ? 'border-brand bg-brand-soft font-semibold text-brand-dark'
                    : 'border-border bg-surface font-medium text-fg-2 hover:border-border-2',
                  'disabled:pointer-events-none disabled:opacity-45'
                )}
              >
                {c.etiqueta}
              </button>
            ))}
          </div>
          {motivoDelComprobante && (
            <p className="text-[11.5px] text-warn">{motivoDelComprobante}</p>
          )}
        </div>

        {esFiscal ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-semibold text-fg-2" htmlFor="pos-condicion-iva">
                Condición IVA
              </label>
              <select
                id="pos-condicion-iva"
                value={condicionIva}
                onChange={(e) => onCondicionIva?.(e.target.value)}
                className="h-[34px] rounded-lg border border-border bg-surface px-2 text-[13px] outline-none"
              >
                <option value="5">Consumidor final</option>
                <option value="1">Resp. inscripto</option>
                <option value="6">Monotributo</option>
                <option value="4">Exento</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-semibold text-fg-2" htmlFor="pos-cuit">
                CUIT / DNI
              </label>
              <input
                id="pos-cuit"
                {...{ [ATRIBUTO_CAMPO]: 'cuit' }}
                type="number"
                value={cuit}
                onChange={(e) => onCuit?.(e.target.value)}
                placeholder="Opcional"
                className="num h-[34px] rounded-lg border border-border bg-surface px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-semibold text-fg-2" htmlFor="pos-cliente">
              Cliente <span className="font-normal text-fg-3">— opcional</span>
            </label>
            {buscadorDeClientes}
            <input
              id="pos-cliente"
              {...{ [ATRIBUTO_CAMPO]: 'cliente' }}
              value={nombreCliente}
              onChange={(e) => onNombreCliente?.(e.target.value)}
              placeholder="Consumidor final"
              className="h-[34px] rounded-lg border border-border bg-surface px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
        )}

        {/* ── Vuelto ──
            La cuenta se hace en la cabeza o en el celular veinte veces por día,
            y ahí es donde se entrega mal el cambio. */}
        {hayVuelto && lineas.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="eyebrow shrink-0" htmlFor="pos-paga-con">Paga con</label>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">$</span>
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
                  className="num h-8 w-full rounded-lg border border-border bg-surface pl-5 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
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

            {pagaCon !== '' && (
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="eyebrow">Vuelto</span>
                {/* «Faltan $3.200» y no «−$3.200»: interpretar un signo con la
                    mano en la caja es donde se entrega mal el cambio. */}
                <span className={cn('num text-lg font-bold', falta > 0 ? 'text-danger' : 'text-foreground')}>
                  {falta > 0 ? `Faltan $${pesos(falta)}` : `$${pesos(vuelto)}`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Total (FR-021) ──
            Separado por un borde punteado y en 24px: es el elemento de más peso
            del bloque, y ni el subtotal ni el IVA ni el botón le compiten. */}
        <div className="flex flex-col gap-[5px] border-t border-dashed border-border pt-3">
          {/* `desglose` viene en `null` para un monotributista, y entonces no se
              dibuja NADA: mostrarle una línea de IVA es decirle que cobró algo
              que no cobró (FR-022). */}
          {desglose && (
            <>
              <div className="flex justify-between text-[12.5px] text-fg-2">
                <span>Subtotal</span>
                <span className="num">${pesos(desglose.neto)}</span>
              </div>
              <div className="flex justify-between text-[12.5px] text-fg-2">
                <span>IVA {desglose.alicuota}% incluido</span>
                <span className="num">${pesos(desglose.iva)}</span>
              </div>
            </>
          )}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-sm font-semibold">Total</span>
            <span className="num text-2xl font-semibold tracking-tight">${pesos(total)}</span>
          </div>
        </div>

        {/* La espera del CAE, pasado el umbral. Va acá arriba del botón y no en
            un `toast`: lo que tiene que leer el operador es «no aprietes de
            nuevo», y un aviso que se va solo a los cinco segundos no alcanza
            para eso (FR-045). */}
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

        <button
          type="button"
          onClick={onCobrar}
          disabled={!cobroHabilitado}
          className={cn(
            'flex h-11 items-center justify-center gap-2.5 rounded-[10px] bg-brand text-[14.5px] font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark',
            'disabled:pointer-events-none disabled:bg-surface-3 disabled:text-fg-3 disabled:shadow-none'
          )}
        >
          {textoDeCobro}
          {/* FR-041: el atajo, adentro del botón que dispara (`maqueta:484`). */}
          <kbd className="num rounded-[5px] bg-surface-3/20 px-1.5 py-0.5 text-[11px] font-normal">
            Ctrl+Enter
          </kbd>
        </button>
      </div>
    </aside>
  )
}
