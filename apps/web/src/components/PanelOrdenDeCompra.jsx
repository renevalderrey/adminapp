import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Loader2,
  MessageCircle,
  Truck,
  XCircle,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { usePermission } from '@/hooks/usePermission'
import useStore from '@/store/useStore'
import { receivePurchaseOrder } from '@/services/api'
import { ESTADOS, esRecibible, esAnulable, porcentajeRecibido } from '@/utils/ordenDeCompra'
import { pesos, fechaCorta } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { enviarPedidoPorWhatsapp } from '@/utils/pedidoWhatsapp'
import { faltaElPermiso } from '@/utils/permisos'

// ════════════════════════════════════════════
//  ADMINAPP · El panel lateral de una orden de compra
//
//  ⚠ **Es UN SOLO componente para las dos pantallas** (FR-034), y esa es la
//  razón de que exista. `Orders.jsx` y `PurchaseOrders.jsx` tenían cada una su
//  formulario de recepción, y el de `Orders.jsx` resolvía qué orden recibir con
//
//      selectedSupplier?.orders?.find(o => o.status === 'pending' || …)
//
//  o sea **la primera pendiente del proveedor**, que no tiene por qué ser la que
//  el usuario abrió: recibir la #118 cargaba la mercadería, la deuda —con el
//  precio de la otra orden— y el cambio de estado en la #112, mostrando
//  «Mercadería recibida». Eso no se repara después: hay que deshacer a mano el
//  stock, el movimiento de deuda y el estado de dos órdenes, contra un registro
//  que dice que todo salió bien.
//
//  Acá la orden que se recibe es, **por construcción**, la que se abrió: el
//  `PUT` lo manda este componente con el `id` del objeto que está dibujando. No
//  hay forma de que difieran porque no hay dos lugares de donde sacarla.
//
//  ── Los dos modos, y por qué no son dos componentes ──
//
//  `detalle` muestra la orden; `recepcion`, el formulario de cantidades. Son el
//  mismo panel porque necesitan la misma orden, las mismas líneas y los mismos
//  permisos, y porque quien abre una orden para mirarla y decide cargarla no
//  tiene que cerrar un panel y abrir otro. Un `PanelDeRecepcion.jsx` aparte es
//  la alternativa descartada en T1238.
//
//  ── La identidad de una línea es su POSICIÓN, no su producto ──
//
//  El estado de las cantidades se indexa por `item.linea` —el campo que
//  `GET /suppliers/orders/:id` devuelve explícito desde T1208— y **nunca** por
//  `product_id`. Con `product_id`, una orden con dos líneas del mismo producto
//  tiene un solo campo y dos `key` de React repetidos; una orden con dos líneas
//  sin producto, lo mismo con `undefined` de clave. `detail` es un JSONB sin
//  tabla de líneas: no hay id que usar y la posición es lo único que distingue
//  dos líneas idénticas.
//
//  ── Qué decide el servidor y qué dibuja este archivo ──
//
//  El umbral del cambio de costo lo decide el servidor: `propone_costo` viene
//  calculado en el detalle (T1208). Poner acá una copia de
//  `esCambioSignificativo` crearía una cuarta implementación de la comparación
//  de importes, y una que puede discrepar: una casilla dibujada que al confirmar
//  no hace nada, o una línea sin casilla que sí habría cambiado el costo.
//
//  Y los avisos del servidor **no se parsean**: todo lo que la pantalla necesita
//  por producto está en `recibido[]` y `costos[]`, indexado por `linea`. Es la
//  lección del campo `stock` de `POST /api/sales`.
//
//  ── Qué recibe por props y qué lee por su cuenta ──
//
//  La orden, el teléfono del proveedor y los handlers llegan por props: dos
//  dueños del mismo dato terminan dibujando una línea y recibiendo otra, que es
//  la misma regla de los tres componentes de `components/pos/`.
//
//  Del estado global salen dos cosas, y las dos por el mismo motivo: no son
//  datos de la orden sino del contexto en el que se está trabajando, iguales
//  para las dos pantallas.
//
//   1. Los permisos, que es de donde los lee `usePermission` en todo el
//      repositorio.
//   2. **Las sucursales y cuál está vigente** (T1249). Pasarlas por props
//      obligaría a las DOS pantallas a leer el mismo par del store y a pasarlo
//      igual: dos copias de una lista que ya tiene un solo dueño, y la primera
//      que se olvide deja el panel sin selector en una empresa que sí tiene dos
//      locales —sin que falle nada, y con la mercadería entrando en la sucursal
//      equivocada—.
//
//  ── Dos desviaciones declaradas de la maqueta ──
//
//  `sdd-verify` compara contra el dibujo, así que van escritas:
//
//   1. El bloque de seguimiento tiene **cuatro** filas —Estado, Recibido, Fecha
//      y Notas— y no las de la maqueta (`:1136-1137`), que dibuja «Entrega
//      estimada» y «Condición de pago». `supplier_orders` **no tiene** esas dos
//      columnas y [PENDIENTE 7] resolvió no inventarlas.
//   2. El pie **no** lleva «Descargar PDF» ni «Duplicar orden» (maqueta
//      `:1146-1147`): las dos están explícitamente Fuera de alcance.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Del `tono` que declara `utils/ordenDeCompra.js` a los tokens del sistema.
 *
 * ⚠ **Vive acá y se exporta**, aunque quien más lo use sea la tabla de
 * `pages/PurchaseOrders.jsx`. La traducción tiene que estar en UN solo lugar: es
 * exactamente el defecto que `VARIANTE_POR_TONO` vino a cerrar —dos pantallas
 * traduciendo el mismo estado a colores distintos— y con el panel compartido por
 * las dos pantallas, dejarla en una de ellas obligaría a la otra a importar de
 * una `page`, o a escribir su copia.
 *
 * Los tres tonos van SIEMPRE juntos —línea, fondo y texto—: un color de estado
 * suelto se lee como un error de estilo.
 */
export const CLASES_POR_TONO = {
  neutro: 'border-border bg-surface-3 text-fg-2',
  warn: 'border-warn-line bg-warn-soft text-warn',
  ok: 'border-ok-line bg-ok-soft text-ok',
}

/** El relleno de la barra de recepción, en el mismo tono que la etiqueta. */
export const BARRA_POR_TONO = {
  neutro: 'bg-fg-3',
  warn: 'bg-warn',
  ok: 'bg-ok',
}

/**
 * La etiqueta de estado, con sus tres tonos.
 *
 * Un `status` que no está en `ESTADOS` —el quinto valor del ENUM que alguien
 * agregue mañana— dibuja el código crudo en tono neutro en vez de romper la
 * fila: se ve raro, que es exactamente lo que se busca.
 */
export function EtiquetaDeEstado({ status }) {
  const estado = ESTADOS[status]

  return (
    <span
      className={`inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
        CLASES_POR_TONO[estado?.tono] || CLASES_POR_TONO.neutro
      }`}
    >
      {estado?.etiqueta || status}
    </span>
  )
}

/**
 * Las líneas de la orden, se llamen como se llamen, con su posición resuelta.
 *
 * ⚠ El modelo guarda la columna `detail` (JSONB) y **la API la serializa como
 * `items`**. Las dos formas circulan por la web al mismo tiempo, así que leer
 * una sola deja el panel sin ítems sin que nada falle.
 *
 * `linea` viene explícita de `GET /suppliers/orders/:id` (T1208) y el índice del
 * arreglo es solo el respaldo: si el panel se abriera con una orden del listado
 * —que no trae el campo—, contar posiciones acá sigue dando lo mismo mientras el
 * arreglo esté completo. Deducirla siempre del orden es lo que T1208 vino a
 * evitar, porque el detalle **puede** llegar filtrado.
 */
function lineasDe(orden) {
  const lista = orden?.detail || orden?.items || []

  return lista.map((linea, indice) => ({
    ...linea,
    linea: Number.isInteger(linea?.linea) ? linea.linea : indice,
  }))
}

/** Lo que falta recibir de una línea, nunca negativo. */
function pendienteDe(linea) {
  const pedido = Number(linea?.quantity) || 0
  const recibido = Number(linea?.quantity_received) || 0

  return Math.max(pedido - recibido, 0)
}

/**
 * Abre WhatsApp con la orden escrita, y avisa si no hay a quién mandársela.
 *
 * ⚠ **Se exporta desde acá y no se copia en cada pantalla.** La usa el pie del
 * panel y también el menú de la fila (T1238): dos copias del armado del texto
 * empiezan iguales y terminan distintas, que es cómo el sistema llegó a tener
 * siete funciones `pesos`.
 *
 * Nunca envía sola: abre el chat con el texto escrito y lo manda una persona.
 * Mandarle un pedido a un proveedor sin que nadie lo mire es el tipo de
 * automatismo que después hay que salir a corregir por teléfono.
 *
 * @param {object} orden La orden, con `items` o `detail`.
 * @param {string|null} telefono El del proveedor, tal como está cargado.
 * @param {boolean} conPrecios Si el texto lleva los costos acordados.
 */
export function enviarOrdenPorWhatsapp(orden, telefono, conPrecios) {
  const items = lineasDe(orden).map((i) => ({
    nombre: i.product_name,
    cantidad: i.quantity,
    costo: i.unit_price,
    marca: i.brand_name || null,
  }))

  if (items.length === 0) {
    toast.error('La orden no tiene ítems.')
    return null
  }

  const resultado = enviarPedidoPorWhatsapp({
    items,
    telefono,
    proveedor: orden?.supplier_name,
    conPrecios,
    nota: orden?.notes || '',
    titulo: `ORDEN DE COMPRA #${orden?.id}`,
  })

  // Sin destinatario WhatsApp abre igual, con el texto escrito y sin chat
  // elegido. Decirlo evita que alguien concluya que el envío falló.
  if (!resultado.conDestinatario) {
    toast.info('El proveedor no tiene teléfono cargado: elegí el contacto en WhatsApp.')
  }

  return resultado
}

/** Las cuatro columnas de la tabla de ítems, iguales arriba y abajo (FR-016). */
const COLUMNAS_DE_ITEMS = 'minmax(0,1fr) 64px 96px 100px'

/** Un dato del bloque de seguimiento: etiqueta arriba, valor abajo. */
function Dato({ etiqueta, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px] bg-surface px-[13px] py-[11px]">
      <span className="text-[11.5px] text-fg-3">{etiqueta}</span>
      <span className="text-[13.5px] font-medium">{children}</span>
    </div>
  )
}

/** Botón secundario del pie: 36px, borde, fondo de superficie. */
const SECUNDARIO =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** Botón principal del pie: turquesa, 36px. */
const PRINCIPAL =
  'inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** Campo de formulario: 36px de alto, el mismo de `PanelTransferencia.jsx`. */
const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-3'

/** Botón destructivo del pie: los tres tonos de `danger`, juntos. */
const DESTRUCTIVO =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger-line bg-danger-soft px-3 ' +
  'text-[13px] font-semibold text-danger transition-colors hover:bg-danger-soft ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/**
 * @param {boolean} abierto
 * @param {(abierto: boolean) => void} onOpenChange
 * @param {object|null} orden El detalle de `GET /api/suppliers/orders/:id`.
 * @param {boolean} cargando El detalle todavía viaja.
 * @param {'detalle'|'recepcion'} modo
 * @param {(modo: string) => void} onCambiarModo
 * @param {string|null} telefonoDelProveedor Para las dos acciones de WhatsApp.
 * @param {(orden: object) => void} onAnular La pantalla confirma y llama a la API.
 * @param {(respuesta: object, orden: object) => void} onRecibida Para recargar la lista.
 */
export default function PanelOrdenDeCompra({
  abierto,
  onOpenChange,
  orden,
  cargando = false,
  modo = 'detalle',
  onCambiarModo,
  telefonoDelProveedor = null,
  onAnular,
  onRecibida,
}) {
  const { can } = usePermission()

  const puedeRecibir = can('ordenes_compra.recibir')
  const puedeAnular = can('ordenes_compra.anular')

  /**
   * Las sucursales de la empresa y cuál está vigente (FR-103).
   *
   * Salen de las MISMAS dos entradas del store que dibuja `app-topbar.jsx`, y
   * no de `/stock/sucursales`, por dos razones:
   *
   *  · `puntoDeVentaActivo` es lo que el cliente de axios manda en la cabecera
   *    `X-Punto-De-Venta-Id`, o sea la sucursal en la que el servidor ya iba a
   *    recibir. Preseleccionar otra cosa haría que el desplegable dijera una
   *    sucursal y el sistema usara otra mientras nadie lo toque.
   *  · `/stock/sucursales` incluye las INACTIVAS a propósito —para poder sacar
   *    mercadería de un local cerrado—, y exige `stock.ver`. Ninguna de las dos
   *    cosas sirve acá: en un local cerrado no entra mercadería nueva, y quien
   *    recibe órdenes no tiene por qué tener el permiso de stock. Además ninguna
   *    de las dos pantallas llama a `cargarSucursales()`, así que esa lista
   *    llegaría vacía y el selector no se dibujaría nunca.
   */
  const empresaActiva = useStore((s) => s.empresaActiva)
  const puntoDeVentaActivo = useStore((s) => s.puntoDeVentaActivo)

  const sucursales = empresaActiva?.puntosDeVenta || []

  // El mismo respaldo que usa el encabezado (`app-topbar.jsx:128`): el store
  // arranca `puntoDeVentaActivo` en `puntosDeVenta[0]`, pero hay un instante
  // entre que llega la empresa y que se fija el punto de venta.
  const vigente = puntoDeVentaActivo || sucursales[0] || null

  // ⚠ Las cantidades y las casillas de costo se indexan por `linea`, NUNCA por
  // `product_id`: ver el encabezado. El `key` de React también.
  const [cantidades, setCantidades] = useState({})
  const [costos, setCostos] = useState({})

  /**
   * La sucursal elegida a mano, o `null` si nadie tocó el desplegable.
   *
   * Es `null` y no el id de la vigente para que **la preselección se derive**:
   * guardar el id en el estado obliga a un efecto que lo sincronice, y ese
   * efecto o se olvida de correr cuando la empresa termina de cargar —el
   * desplegable queda en la sucursal equivocada— o corre de más y borra las
   * cantidades ya escritas. Derivarlo no puede desincronizarse.
   */
  const [sucursalElegida, setSucursalElegida] = useState(null)
  const [error, setError] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [enviando, setEnviando] = useState(false)

  /**
   * El candado del doble envío (FR-036).
   *
   * Es un `ref` y no el estado `enviando` a propósito: React agrupa las
   * actualizaciones, así que dos clics en el mismo tick leen los dos
   * `enviando === false` y salen dos `PUT` —dos recepciones de la misma
   * mercadería, dos movimientos de deuda—. El `ref` cambia en el acto.
   */
  const enviandoRef = useRef(false)

  const lineas = useMemo(() => lineasDe(orden), [orden])

  const recibible = esRecibible(orden)
  const anulable = esAnulable(orden)
  const recibido = porcentajeRecibido(orden)

  /**
   * Todo lo escrito se descarta al cambiar de orden o al reabrir el panel.
   *
   * Sin esto, abrir la orden #118, escribir 5 en Colágeno, cerrar y abrir la
   * #112 —que también tiene Colágeno— deja el 5 puesto en la orden equivocada.
   * Las casillas de costo arrancan **marcadas** en las líneas que el servidor
   * propone (decisión 2 del plan): hoy no pasa nada, así que el costo de
   * olvidarse es que el margen del POS siga calculado con un costo viejo. La
   * casilla marcada con el número a la vista deja el rechazo a un clic; la
   * casilla vacía deja el olvido a cero clics.
   */
  useEffect(() => {
    setCantidades({})
    setCostos(
      Object.fromEntries(
        lineasDe(orden)
          .filter((l) => l.propone_costo)
          .map((l) => [l.linea, true])
      )
    )
    setError(null)
    setResultado(null)
    // La sucursal elegida a mano también: dejarla puesta haría que la orden
    // siguiente entre en el depósito que se eligió para la anterior.
    setSucursalElegida(null)
  }, [abierto, orden?.id])

  /**
   * A qué sucursal entra la mercadería, como texto para el `<select>`.
   *
   * Con una sola sucursal no hay desplegable (US10 escenario 2) y esto no se
   * usa: el cuerpo sale sin el campo y el servidor cae a la cabecera y después
   * a la sucursal por defecto, que es el camino de siempre.
   */
  const sucursalDestino = sucursalElegida ?? (vigente ? String(vigente.id) : '')

  const confirmar = async () => {
    if (enviandoRef.current || !orden) return

    const items = lineas
      .map((l) => ({
        linea: l.linea,
        // El `product_id` viaja como red contra un detalle viejo: el servidor
        // responde LINEA_INCONSISTENTE si la posición no es de ese producto, en
        // vez de cargar la mercadería en la línea equivocada. NO decide nada:
        // quien decide es `linea`.
        product_id: l.product_id ?? null,
        cantidad: parseFloat(cantidades[l.linea]),
        actualizar_costo: costos[l.linea] === true,
      }))
      .filter((i) => i.cantidad > 0)

    if (items.length === 0) {
      setError('Escribí cuánto llegó de al menos un ítem antes de confirmar.')
      return
    }

    enviandoRef.current = true
    setEnviando(true)
    setError(null)

    try {
      // ⚠ El `:id` es el de la orden que está abierta en este panel. No hay
      // ninguna búsqueda por estado: es el defecto 4 y es lo que no puede volver.
      //
      // La sucursal viaja SOLO cuando hay más de una (FR-103): con una sola no
      // hay nada que elegir, así que el cuerpo sale igual que siempre y el
      // servidor la resuelve por la cabecera o por la sucursal por defecto.
      // Mandarla igual «por las dudas» agregaría un id que nadie eligió a un
      // camino que ya funcionaba.
      const res = await receivePurchaseOrder(
        orden.id,
        items,
        sucursales.length > 1 ? sucursalDestino : null
      )

      setResultado(res.data.data)
      onRecibida?.(res.data.data, orden)
    } catch (err) {
      // FR-035: el panel queda abierto y las cantidades escritas, intactas.
      // Cerrarlo obliga a escribir todo de nuevo justo cuando algo salió mal.
      setError(mensajeDeError(err, `No se pudo registrar la recepción de la orden #${orden.id}.`))
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  const enRecepcion = modo === 'recepcion'

  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent
        // El ancho va en `style` y no en clases: `SheetContent` trae
        // `data-[side=right]:sm:max-w-sm` y `w-3/4` propios, y esas reglas viven
        // en un media query que gana por orden de hoja. Un estilo en línea las
        // supera sin pelearse con el orden del CSS (FR-014).
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        {/* ── Encabezado ── */}
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Orden de compra</p>

          <SheetTitle className="mt-1 text-[18px] font-semibold">
            {orden ? (
              <>
                <span className="num">#{orden.id}</span>
                {` · ${orden.supplier_name || 'Proveedor sin nombre'}`}
              </>
            ) : (
              '—'
            )}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            {orden
              ? `Emitida el ${fechaCorta(orden.date)} · ${lineas.length} ${lineas.length === 1 ? 'ítem' : 'ítems'}`
              : 'Cargando…'}
          </SheetDescription>
        </div>

        {cargando && !orden ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-fg-2">
            <Loader2 className="h-4 w-4 animate-spin text-fg-3" />
            Cargando la orden…
          </div>
        ) : orden ? (
          <div className="flex flex-col gap-7 px-6 py-6">
            {enRecepcion ? (
              <FormularioDeRecepcion
                orden={orden}
                lineas={lineas}
                cantidades={cantidades}
                setCantidades={setCantidades}
                costos={costos}
                setCostos={setCostos}
                error={error}
                resultado={resultado}
                puedeRecibir={puedeRecibir}
                sucursales={sucursales}
                sucursalDestino={sucursalDestino}
                setSucursalElegida={setSucursalElegida}
              />
            ) : (
              <>
                {/* ── Seguimiento ──
                    Grilla de dos columnas con la separación hecha de borde: es
                    el patrón de la maqueta y evita cuatro `border` sueltos que
                    después no coinciden. */}
                <div className="flex flex-col gap-2.5">
                  <h3 className="eyebrow">Seguimiento</h3>

                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border bg-border">
                    <Dato etiqueta="Estado">
                      <EtiquetaDeEstado status={orden.status} />
                    </Dato>
                    <Dato etiqueta="Recibido">
                      {/* De UNIDADES y no de importe: es lo único que el modelo
                          guarda por línea, y la etiqueta lo dice para que nadie
                          lo lea como plata. */}
                      <span className="num">{recibido} %</span>
                      <span className="ml-1 text-[12px] text-fg-3">de las unidades</span>
                    </Dato>
                    <Dato etiqueta="Fecha">
                      <span className="num">{fechaCorta(orden.date)}</span>
                    </Dato>
                    <Dato etiqueta="Notas">{orden.notes || '—'}</Dato>
                  </div>
                </div>

                {/* ── Ítems ── */}
                <div className="flex flex-col gap-2.5">
                  <h3 className="eyebrow">Ítems · recibido / pedido</h3>

                  {lineas.length === 0 ? (
                    /* Una tabla con encabezados y sin filas parece un error de
                       carga, así que no se dibuja. */
                    <div className="rounded-[10px] border border-dashed border-border-2 px-4 py-8 text-center">
                      <p className="text-[13px] font-semibold">Esta orden no tiene ítems cargados.</p>
                      <p className="mx-auto mt-1 max-w-[40ch] text-[12.5px] text-fg-2">
                        Se registró por su total, sin desglose de productos.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[10px] border border-border">
                      <div
                        className="eyebrow grid gap-x-2.5 border-b border-border bg-surface-2 px-[13px] py-2.5"
                        style={{ gridTemplateColumns: COLUMNAS_DE_ITEMS }}
                      >
                        <span>Detalle</span>
                        <span className="text-center">Cant.</span>
                        <span className="text-right">Unitario</span>
                        <span className="text-right">Subtotal</span>
                      </div>

                      {lineas.map((item) => (
                        <div
                          key={item.linea}
                          className="grid items-center gap-x-2.5 border-b border-border px-[13px] py-[11px]"
                          style={{ gridTemplateColumns: COLUMNAS_DE_ITEMS }}
                        >
                          <span className="truncate text-[13px]" title={item.product_name}>
                            {item.product_name || 'Ítem sin nombre'}
                          </span>
                          {/* `recibido / pedido` en UNA sola celda (FR-016):
                              dos columnas para dos números que solo se leen
                              juntos gastan el ancho que necesita el nombre. */}
                          <span className="num text-center text-[12.5px] text-fg-2">
                            {Number(item.quantity_received) || 0} / {Number(item.quantity) || 0}
                          </span>
                          <span className="num text-right text-[12.5px] text-fg-2">
                            ${pesos(item.unit_price)}
                          </span>
                          <span className="num text-right text-[13px] font-semibold">
                            ${pesos((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                          </span>
                        </div>
                      ))}

                      <div className="flex items-baseline justify-between bg-surface-2 px-[13px] py-3">
                        <span className="text-[13px] font-semibold">Total</span>
                        <span className="num text-[19px] font-semibold">${pesos(orden.total)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── La nota de stock ──
                    Solo si la orden es recibible (FR-017): decirle a alguien que
                    el stock se va a actualizar sobre una orden ya recibida o
                    anulada describe algo que no va a pasar. */}
                {recibible && (
                  <div className="flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft px-3.5 py-3">
                    <Info className="mt-0.5 h-[15px] w-[15px] shrink-0 text-info" />
                    <p className="text-[12.5px] leading-relaxed text-fg-2">
                      Cargá lo que llegó y confirmá: el stock se actualiza en el mismo paso y la
                      orden queda en «Recibida parcial» hasta completarse. No hace falta abrir
                      Inventario.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {/* ── Pie ──
            Las acciones dependen del estado y de los permisos, y las dos cosas
            se resuelven acá: la pantalla solo dice qué hacer cuando se aprietan. */}
        {orden && (
          <div className="mt-auto border-t border-border bg-surface-2 px-6 py-4">
            {/* FR-019: lo que falta queda DESHABILITADO con su explicación a la
                vista, no ausente. Un botón que no está no se distingue de una
                función que no existe, y el usuario llama para preguntar por qué
                el sistema «ya no deja recibir». */}
            {((recibible && !puedeRecibir) || (anulable && !puedeAnular)) && (
              <p className="mb-2.5 text-[12.5px] text-fg-2">
                {recibible && !puedeRecibir && `${faltaElPermiso('ordenes_compra.recibir')} para registrar la recepción. `}
                {anulable && !puedeAnular && `${faltaElPermiso('ordenes_compra.anular')} para anular la orden.`}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {enRecepcion ? (
                <>
                  <button
                    type="button"
                    onClick={() => onCambiarModo?.('detalle')}
                    className={SECUNDARIO}
                  >
                    <ArrowLeft className="h-3.5 w-3.5 text-fg-3" />
                    Ver el detalle
                  </button>

                  <div className="flex-1" />

                  {resultado ? (
                    <button type="button" onClick={() => onOpenChange?.(false)} className={PRINCIPAL}>
                      Cerrar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={confirmar}
                      disabled={!puedeRecibir || enviando}
                      title={
                        puedeRecibir
                          ? 'Registrar la recepción de esta orden'
                          : faltaElPermiso('ordenes_compra.recibir')
                      }
                      className={PRINCIPAL}
                    >
                      {enviando ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Truck className="h-3.5 w-3.5" />
                      )}
                      Confirmar recepción
                    </button>
                  )}
                </>
              ) : (
                <>
                  {anulable && (
                    <button
                      type="button"
                      onClick={() => onAnular?.(orden)}
                      disabled={!puedeAnular}
                      title={
                        puedeAnular
                          ? 'Anular esta orden de compra'
                          : faltaElPermiso('ordenes_compra.anular')
                      }
                      className={DESTRUCTIVO}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Anular orden
                    </button>
                  )}

                  <div className="flex-1" />

                  {/* Las DOS de WhatsApp se conservan (FR-018): es la función
                      que más se usaba del sistema anterior, y una función
                      liberada no se pierde por seguir un dibujo. */}
                  <button
                    type="button"
                    onClick={() => enviarOrdenPorWhatsapp(orden, telefonoDelProveedor, false)}
                    className={SECUNDARIO}
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-fg-3" />
                    WhatsApp
                  </button>

                  <button
                    type="button"
                    onClick={() => enviarOrdenPorWhatsapp(orden, telefonoDelProveedor, true)}
                    title="Incluye los precios acordados"
                    className={SECUNDARIO}
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-fg-3" />
                    Con precios
                  </button>

                  {/* Una orden no recibible NO tiene acción principal (FR-017,
                      US2 escenario 8): un botón que la API va a rechazar es una
                      promesa que la pantalla no puede cumplir. */}
                  {recibible && (
                    <button
                      type="button"
                      onClick={() => onCambiarModo?.('recepcion')}
                      disabled={!puedeRecibir}
                      title={
                        puedeRecibir
                          ? 'Cargar lo que llegó'
                          : faltaElPermiso('ordenes_compra.recibir')
                      }
                      className={PRINCIPAL}
                    >
                      <Truck className="h-3.5 w-3.5" />
                      Registrar recepción
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * El formulario de cantidades, y el resumen de lo que entró de verdad.
 *
 * Va en el mismo archivo y no en uno aparte porque comparte la orden, las
 * líneas y los permisos con el detalle: son el mismo panel en otro momento.
 */
function FormularioDeRecepcion({
  orden,
  lineas,
  cantidades,
  setCantidades,
  costos,
  setCostos,
  error,
  resultado,
  puedeRecibir,
  sucursales = [],
  sucursalDestino = '',
  setSucursalElegida,
}) {
  // Terminada la recepción, el formulario deja lugar al resumen: lo que sigue
  // no es «cargar más», es leer qué entró.
  if (resultado) return <ResumenDeRecepcion resultado={resultado} orden={orden} />

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft px-3.5 py-3">
        <Info className="mt-0.5 h-[15px] w-[15px] shrink-0 text-info" />
        <p className="text-[12.5px] leading-relaxed text-fg-2">
          Escribí cuánto llegó de cada ítem. Lo que dejes vacío no se carga, y el stock se
          actualiza con lo que llegó de verdad, no con lo que se pidió.
        </p>
      </div>

      {/* `role="alert"`: este aviso es el que dice que la RECEPCIÓN falló, o
          sea que la mercadería no quedó registrada. Que no se anuncie deja a
          alguien creyendo que descargó el remito. */}
      {error && (
        <div
          role="alert"
          className="flex gap-2.5 rounded-[10px] border border-danger-line bg-danger-soft px-3.5 py-3"
        >
          <AlertTriangle className="mt-0.5 h-[15px] w-[15px] shrink-0 text-danger" />
          <p className="text-[12.5px] leading-relaxed text-danger">{error}</p>
        </div>
      )}

      {/* ── Dónde entra la mercadería ──
          FR-103 y US10 escenario 2: el desplegable aparece SOLO con más de una
          sucursal. Con una sola es un control con una única opción, que no
          decide nada y hace dudar de si hay algo que elegir; y el cuerpo sale
          sin el campo, así que el servidor resuelve como siempre.

          La vigente viene preseleccionada porque es la que el servidor iba a
          usar de todas formas —viaja en la cabecera `X-Punto-De-Venta-Id`—:
          arrancar en blanco obligaría a elegir en el 90 % de las recepciones,
          que son a la sucursal en la que la persona ya está parada. */}
      {sucursales.length > 1 && (
        <div className="flex flex-col gap-1.5">
          {/* La aclaración va FUERA del `<label>` a propósito: adentro, el
              nombre accesible del desplegable pasa a ser las dos frases pegadas
              —lo que lee un lector de pantalla antes de cada opción— y encima
              deja de poder buscarse por su etiqueta. */}
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Sucursal de destino</span>
            <select
              className={CAMPO}
              value={sucursalDestino}
              disabled={!puedeRecibir}
              onChange={(e) => setSucursalElegida(e.target.value)}
            >
              {sucursales.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </label>

          <span className="text-[11.5px] text-fg-3">
            El stock de esta recepción entra acá. La deuda con el proveedor es de la empresa
            y no cambia con la sucursal.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {lineas.map((linea) => {
          const nombre = linea.product_name || 'Ítem sin nombre'
          const pedido = Number(linea.quantity) || 0
          const yaRecibido = Number(linea.quantity_received) || 0
          const pendiente = pendienteDe(linea)
          const costoActual = linea.costo_actual

          // La casilla se explica con el número a la vista: «$900,00 → $1.200,00».
          // Un «actualizar costo» a secas no dice cuánto sube ni de qué.
          const desde = Number(costoActual) > 0 ? `$${pesos(costoActual)}` : 'sin costo cargado'
          const explicacionDelCosto = `${nombre}: ${desde} → $${pesos(linea.unit_price)}`

          return (
            /* ⚠ El `key` es la LÍNEA. Con `product_id`, dos líneas del mismo
               producto comparten clave y React dibuja una sola. */
            <div key={linea.linea} className="rounded-[10px] border border-border px-3.5 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium" title={nombre}>
                    {nombre}
                  </p>
                  <p className="mt-0.5 text-[12px] text-fg-2">
                    {/* FR-032: pedido y ya recibido, a la vista. Sin los dos
                        números, «cuánto falta» hay que calcularlo de memoria. */}
                    Pedido: <span className="num">{pedido}</span> · Recibido:{' '}
                    <span className="num">{yaRecibido}</span>
                  </p>
                </div>

                <input
                  type="number"
                  min="0"
                  max={pendiente}
                  /* `step="any"` y no `step="1"`: las cantidades son DECIMAL y
                     una recepción de 2,5 kg es normal. Con el paso entero el
                     navegador marca el campo como inválido y no se puede cargar. */
                  step="any"
                  /* La etiqueta lleva el número de línea porque dos líneas del
                     mismo producto tienen el mismo nombre: sin él, ni el usuario
                     con lector de pantalla ni el test pueden distinguirlas. */
                  aria-label={`Cantidad recibida de ${nombre} (línea ${linea.linea})`}
                  placeholder={pendiente > 0 ? `Máx ${pendiente}` : 'Completa'}
                  disabled={pendiente <= 0 || !puedeRecibir}
                  value={cantidades[linea.linea] ?? ''}
                  onChange={(e) =>
                    setCantidades((previas) => ({ ...previas, [linea.linea]: e.target.value }))
                  }
                  className="num h-9 w-[104px] shrink-0 rounded-lg border border-border bg-surface px-2
                             text-right text-[13px] transition-colors focus-visible:border-brand
                             focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-3"
                />
              </div>

              {/* El umbral lo decidió el servidor: `propone_costo` viene hecho.
                  Acá no se compara nada. */}
              {linea.propone_costo && (
                <label className="mt-2.5 flex items-start gap-2 text-[12.5px] text-fg-2">
                  <input
                    type="checkbox"
                    aria-label={`Actualizar el costo · ${explicacionDelCosto}`}
                    checked={costos[linea.linea] === true}
                    disabled={!puedeRecibir}
                    onChange={(e) =>
                      setCostos((previos) => ({ ...previos, [linea.linea]: e.target.checked }))
                    }
                    className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-brand"
                  />
                  <span>
                    Actualizar el costo · {nombre}:{' '}
                    <span className="num">{desde}</span>
                    {' → '}
                    <span className="num">${pesos(linea.unit_price)}</span>
                  </span>
                </label>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Qué entró de verdad, después de confirmar.
 *
 * ⚠ **FR-033.** Hasta este hito la pantalla decía «Mercadería recibida» y nada
 * más: alguien escribía 9 sobre una línea con 4 pendientes, el servidor cargaba
 * 4, y el sistema respondía que todo salió bien. Los números salen de
 * `recibido[]`, indexado por `linea`; los avisos se muestran como frases y **no
 * se parsean** —lo que la pantalla necesita por producto ya viene estructurado—.
 */
function ResumenDeRecepcion({ resultado, orden }) {
  const recibido = resultado?.recibido || []
  const avisos = resultado?.avisos || []
  const costos = resultado?.costos || []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2.5 rounded-[10px] border border-ok-line bg-ok-soft px-3.5 py-3">
        <CheckCircle2 className="mt-0.5 h-[15px] w-[15px] shrink-0 text-ok" />
        <p className="text-[12.5px] leading-relaxed text-ok">
          Se registró la recepción de la orden <span className="num">#{orden.id}</span>.
        </p>
      </div>

      {recibido.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-border">
          {recibido.map((r) => (
            <div
              key={r.linea}
              className="flex items-baseline justify-between gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {r.product_name || 'Ítem sin nombre'}
              </span>
              <span className="num shrink-0 text-[13px] font-semibold">
                Entraron {r.recibido_ahora}
              </span>
              {r.pendiente > 0 && (
                <span className="num shrink-0 text-[12px] text-fg-2">
                  quedan {r.pendiente}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {costos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="eyebrow">Costos actualizados</h3>
          {costos.map((c) => (
            <p key={c.linea} className="text-[12.5px] text-fg-2">
              <span className="num">${pesos(c.costo_anterior)}</span>
              {' → '}
              <span className="num">${pesos(c.costo_nuevo)}</span>
              {c.recosteos > 0 && ` · se recostearon ${c.recosteos} elaborados`}
            </p>
          ))}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-warn-line bg-warn-soft px-3.5 py-3">
          {avisos.map((aviso) => (
            <p key={aviso} className="text-[12.5px] leading-relaxed text-fg-2">
              {aviso}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
