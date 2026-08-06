import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import {
  getSuppliers,
  getSupplier,
  getSupplierMovements,
  getPurchaseOrders,
  getPurchaseOrder,
  getProducts,
  createSupplier,
  createSupplierOrder,
  createSupplierPayment,
  updateSupplier,
  deleteSupplier,
  updateMovement,
  deleteMovement,
  exportarCuenta,
  cancelPurchaseOrder,
} from '@/services/api'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import Pagination from '@/components/Pagination'
import PageHeader from '@/components/PageHeader'
import BloqueDeDocumentos from '@/components/BloqueDeDocumentos'
import PanelOrdenDeCompra, {
  EtiquetaDeEstado,
  BARRA_POR_TONO,
} from '@/components/PanelOrdenDeCompra'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ClipboardList,
  CreditCard,
  Download,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Truck,
  Users,
  XCircle,
} from 'lucide-react'
import { ESTADOS, esRecibible, porcentajeRecibido } from '@/utils/ordenDeCompra'
import { ETIQUETAS, estadoDeProveedor, tonoDeProveedor } from '@/utils/cuentaDeProveedor'
// `fechaDeHoy` estaba escrita al pie de este archivo y, palabra por palabra,
// también al pie de `PurchaseOrders.jsx` y de `BloqueDeDocumentos.jsx`: tres
// copias de la misma corrección del bug de UTC, que es tres lugares donde puede
// volver y uno solo donde se arregla.
import { pesos, fechaCorta, fechaDeHoy } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { armarHoja, nombreDelArchivo } from '@/utils/exportarProveedores'

// ════════════════════════════════════════════
//  ADMINAPP · Proveedores y su cuenta corriente
//
//  Dos columnas (FR-054): a la izquierda quién es y cuánto se le debe, a la
//  derecha la cuenta del que se eligió. La maqueta **no dibuja esta pantalla**
//  —`proveedores` cae en `isStub`—, así que el diseño sale del texto del plan,
//  de los primitivos que la maqueta sí fijó y de la referencia viva,
//  `pages/Comparador.jsx`.
//
//  ── Qué se fue de acá, y por qué no vuelve ──
//
//   · **El puente de T1219.** `GET /suppliers/:id` dejó de traer `movements` y
//     `orders` (T1216) y esta pantalla los rearmaba a mano con la forma vieja
//     para no mostrar $0 de saldo durante los cortes intermedios. Ahora los pide
//     donde viven: el historial pagina por `GET /suppliers/:id/movimientos` y las
//     órdenes salen de `GET /suppliers/orders?supplier_id=`.
//   · **La suma de plata en el navegador.** La función que calculaba el saldo
//     acumulaba `parseFloat` sobre DECIMAL que el driver devuelve como texto,
//     sobre todos los movimientos que le habían llegado —y su nombre no se
//     escribe acá porque hay una guardia estática que verifica que no vuelva a
//     aparecer en el archivo—. El saldo lo calcula el servidor en
//     centavos enteros (decisión 3, FR-050) y **la pantalla no vuelve a sumar
//     nada**: ni siquiera `deuda − pagado`, que sería la segunda suma que
//     FR-101 prohíbe.
//   · **Los cuatro `toast.error(err.message)`.** `err.message` de axios es
//     «Request failed with status code 400»: no dice qué falló, no dice qué
//     corregir y no se puede dictar por teléfono. Ahora todos pasan por
//     `mensajeDeError`, que devuelve el texto en castellano que mandó el
//     servidor (FR-095, criterio 14).
//   · **El ternario del `variant` del Badge de shadcn.** El estado se dibuja con
//     los tonos del sistema —los tres juntos, línea, fondo y texto— y el Badge
//     no participa. Los tonos del proveedor salen de `tonoDeProveedor` y los de
//     la orden, de `EtiquetaDeEstado`: la traducción de estado a color vive en
//     UN solo lugar por cosa.
//   · **Los `Table*` de shadcn y el `<table>` del detalle de la orden.** El
//     historial es un grid con las mismas `grid-template-columns` en el
//     encabezado y en las filas (FR-058).
//   · **Los DOS diálogos de recepción**, con su `find()` por estado adentro del
//     `onClick`: elegían **la primera orden pendiente del proveedor**, que no
//     tiene por qué ser la que el usuario abrió. Los reemplaza
//     `PanelOrdenDeCompra`, el MISMO componente que usa `/ordenes-compra`
//     (FR-034), donde la orden que se recibe es por construcción la que se
//     abrió.
//
//  ── Lo que llegó con los pagos, los movimientos y la exportación ──
//
//   · **El pago se valida ANTES de llamar** (FR-088). Mandaba
//     `parseFloat(payData.amount)` sin mirar nada: un formulario vacío escribía
//     **NaN en un DECIMAL(14,2)**, la fila entraba, y a partir de ahí el saldo,
//     el badge de la lista y el archivo del contador decían todos «NaN». Además
//     entró **cheque** —faltaba, y es como se le paga a un mayorista— y la
//     **fecha**, que el estado ya guardaba y no tenía campo: un pago de ayer se
//     registraba con la fecha de hoy.
//   · **Editar y eliminar un movimiento** (FR-093). Los dos endpoints existen
//     desde siempre, con `findScoped` y lista blanca, y **ningún botón los
//     llamaba**: un pago cargado por $10.000 en vez de $1.000 no se podía
//     corregir desde ninguna pantalla.
//   · **El borrado del proveedor dice qué se lleva** ([PENDIENTE 10]). La
//     confirmación era «¿Eliminar?» y detrás iba la cuenta corriente entera en
//     una transacción. Con saldo distinto de cero lo bloquea el servidor y acá
//     se muestra **su** mensaje, que es el único que sabe de qué cuenta habla.
//   · **La exportación para el contador** (US8), con el corte de ventas: el
//     servidor arma las filas y el navegador arma la hoja.
//
//  ── El panel de la orden se abre por UN solo camino ──
//
//  `abrirOrden(id, modo)`, igual que en `pages/PurchaseOrders.jsx`. El clic en la
//  fila y el botón «Recibir» terminan los dos ahí, así que no pueden apuntar a
//  órdenes distintas, y los dos piden el detalle ENRIQUECIDO de
//  `GET /suppliers/orders/:id` —el que trae `linea`, `costo_actual` y
//  `propone_costo`—: sin esos tres campos la recepción no sabe a qué línea va la
//  mercadería ni qué costo proponer.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Las dos columnas de una fila de la lista: quién es, y cuánto se le debe.
 *
 * Es el MISMO string en las filas y en el pie del recuento, que es lo que hace
 * que el saldo de todas las filas arranque en el mismo píxel. La lista no tiene
 * encabezado de columnas a propósito: son dos datos y sus etiquetas ocuparían
 * más alto que la primera fila.
 */
const COLUMNAS_DE_PROVEEDOR = 'minmax(0,1fr) 104px'

/**
 * Fecha · Operación · Notas · Debe · Haber · Acciones (FR-058, US5 escenario 7).
 *
 * La columna de acciones la agregó T1245: los dos endpoints de editar y eliminar
 * un movimiento existen desde siempre y **ningún botón los llamaba**, así que un
 * pago cargado por $10.000 en vez de $1.000 no había forma de corregirlo desde
 * la pantalla. Son 72px —dos botones de 29px y su separación— y el ancho mínimo
 * sube con ellos: sin eso la tabla se comprime en vez de scrollear.
 */
const COLUMNAS_DE_MOVIMIENTO = '96px 116px minmax(0,1fr) 116px 116px 72px'
const ANCHO_MINIMO_DE_MOVIMIENTOS = 800

/** Orden · Fecha · Estado y recepción · Total · Acciones. */
const COLUMNAS_DE_ORDEN = '84px 104px minmax(0,1fr) 116px 84px'
const ANCHO_MINIMO_DE_ORDENES = 660

/**
 * El tope que acepta `GET /suppliers`, explícito porque el por defecto es 50.
 *
 * La columna izquierda se dibuja entera: sin el límite, una empresa con 60
 * proveedores perdía 10 de la lista **y nada avisaba**.
 */
const LIMITE_DE_PROVEEDORES = 200

/** Cuántos movimientos trae cada página del historial. */
const MOVIMIENTOS_POR_PAGINA = 25

/** Las órdenes del proveedor elegido. Son pocas y se dibujan enteras. */
const LIMITE_DE_ORDENES = 50

/**
 * Cuánto se espera después de la última tecla antes de preguntarle al servidor.
 *
 * La búsqueda por nombre la resuelve `GET /suppliers?q=` (FR-059), que compara
 * **sin acentos y sin distinguir mayúsculas** con un `translate` en SQL. Filtrar
 * en el navegador obligaría a escribir esa normalización por segunda vez —y a
 * buscar solo dentro de la página cargada—: escribir «almacen» dejaría de
 * encontrar «Almacén Central» el día que la lista pase de 200.
 */
const ESPERA_DE_BUSQUEDA = 250

/** Botón secundario del sistema: 34px, borde, fondo de superficie. */
const SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:border-border-2 hover:bg-surface-3 ' +
  'disabled:pointer-events-none disabled:opacity-50'

/** Campo del sistema: 36px, borde, foco en `brand`. */
const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-2'

/**
 * Los cuatro métodos de pago del legacy (FR-091, US9 escenario 4).
 *
 * ⚠ **Faltaba cheque**: el formulario tenía efectivo, transferencia y QR, así
 * que un pago con cheque —que es la forma habitual de pagarle a un mayorista— se
 * registraba como cualquier otra cosa y el historial mentía sobre con qué se
 * pagó. El código es el que ya guarda la columna `payment_method`.
 *
 * La lista vive en UN solo lugar y la usan el formulario, la edición de un
 * movimiento y la etiqueta del historial: tres copias del mismo par
 * código/etiqueta es cómo el historial termina diciendo «ch» en una pantalla y
 * «Cheque» en otra.
 */
const METODOS_DE_PAGO = [
  { codigo: 'ef', etiqueta: 'Efectivo' },
  { codigo: 'tr', etiqueta: 'Transferencia' },
  { codigo: 'ch', etiqueta: 'Cheque' },
  { codigo: 'qr', etiqueta: 'QR / Billetera' },
]

/**
 * Cómo se escribe un método de pago.
 *
 * Un código que no está en la lista se muestra **tal cual** en vez de
 * traducirse a «Otro»: la columna es un `STRING` sin validación en el servidor y
 * puede traer lo que haya cargado el sistema viejo, así que verlo es lo único
 * que permite corregirlo. Y el `find` va acá y no en la fila: un `.etiqueta`
 * sobre `undefined` se lleva puesta la fila entera.
 */
function etiquetaDeMetodo(codigo) {
  const conocido = METODOS_DE_PAGO.find((m) => m.codigo === codigo)
  if (conocido) return conocido.etiqueta

  return typeof codigo === 'string' && codigo.trim() !== '' ? codigo : ''
}

/**
 * El importe de un pago tal como lo escribió la persona, o `null` si no sirve.
 *
 * ⚠ **Es lo que faltaba entero** (FR-088, US9 escenarios 1 y 2, criterio 13):
 * el formulario mandaba `parseFloat(payData.amount)` sin mirar nada, así que un
 * envío vacío escribía **NaN en una columna DECIMAL(14,2)**. Nada fallaba —la
 * fila entraba— y a partir de ahí el saldo del proveedor, el badge de la lista,
 * el saldo grande de la cuenta y el archivo del contador decían todos «NaN».
 *
 * `Number('')`, `Number('   ')` y `Number(null)` son **0**, no `NaN`: los tres
 * caen por el `> 0` y no por el `isFinite`, y por eso alcanza con una sola
 * comparación en vez de tres casos especiales.
 *
 * La validación va en los dos lados —acá y en `routes/suppliers.js`— porque el
 * requisito lo pide y porque el navegador no es una barrera.
 */
function importeDePago(valor) {
  const monto = Number(valor)

  return Number.isFinite(monto) && monto > 0 ? monto : null
}

/**
 * Un número del resumen de la cuenta, con su etiqueta.
 *
 * `pista` es la línea que explica qué significa el número cuando el nombre no
 * alcanza: «pedido pendiente de recibir» necesita decir que todavía no llegó, o
 * se lee como una segunda deuda.
 */
function Indicador({ etiqueta, valor, pista }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-4 py-3.5">
      <p className="eyebrow">{etiqueta}</p>
      <p className="num mt-1 text-[19px] font-semibold">${pesos(valor)}</p>
      {pista && <p className="mt-0.5 text-[11.5px] text-fg-3">{pista}</p>}
    </div>
  )
}

/**
 * El badge de estado de una cuenta (FR-055, FR-056).
 *
 * ⚠ Recibe **la cuenta entera**, no dos de sus tres números:
 * `estadoDeProveedor` no recalcula `saldo = deuda − pagado` a propósito —sería
 * una segunda suma en punto flotante— así que una fila que le pase `deuda` y
 * `pagado` sin `saldo` deja a **todo proveedor con deuda pintado de verde**,
 * diciendo «Saldado», sin que nada falle.
 */
function EtiquetaDeCuenta({ cuenta }) {
  const estado = estadoDeProveedor(cuenta)

  return (
    <span
      className={`inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tonoDeProveedor(estado)}`}
    >
      {ETIQUETAS[estado]}
    </span>
  )
}

const Orders = () => {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  // El permiso se mira ANTES de llamar: `GET /suppliers/orders` exige
  // `ordenes_compra.ver` desde T1216, así que sin él la llamada vuelve 403 y lo
  // único honesto es decir que falta el permiso (riesgo 12 del plan).
  const puedeVerOrdenes = can('ordenes_compra.ver')

  // FR-087 y FR-093. Los botones que no se pueden usar quedan **deshabilitados
  // con su explicación** y no escondidos: un botón que desaparece deja a quien
  // lo busca sin entender por qué, y termina en un pedido de soporte que dice
  // «no me anda».
  const puedeEditar = can('proveedores.editar')
  const puedeEliminar = can('proveedores.eliminar')

  // ── La lista ──
  const [proveedores, setProveedores] = useState([])
  const [totalDeProveedores, setTotalDeProveedores] = useState(0)
  const [cargandoLista, setCargandoLista] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('')

  // ── La cuenta del elegido ──
  const [proveedorId, setProveedorId] = useState(null)
  const [proveedor, setProveedor] = useState(null)

  // ── El historial ──
  const [movimientos, setMovimientos] = useState([])
  const [totalDeMovimientos, setTotalDeMovimientos] = useState(0)
  const [paginaDeMovimientos, setPaginaDeMovimientos] = useState(1)
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false)

  // ── Las órdenes del elegido ──
  const [ordenes, setOrdenes] = useState([])
  // El `total` del endpoint y NO `ordenes.length`: la lista se pide con un tope
  // de 50, así que un proveedor con 60 órdenes tendría 50 en el arreglo. La
  // confirmación del borrado dice cuántas se van y ese número tiene que ser el
  // verdadero (T1246).
  const [totalDeOrdenes, setTotalDeOrdenes] = useState(0)
  const [cargandoOrdenes, setCargandoOrdenes] = useState(false)

  /**
   * La orden abierta en el panel, y en qué modo.
   *
   * ⚠ **Es UNA sola pieza de estado para los dos caminos** —el clic en la fila y
   * el botón «Recibir»—, y ahí está la corrección del defecto 4 del lado de esta
   * pantalla: la orden que se recibe es la que está acá y no hay ninguna otra de
   * donde sacarla.
   */
  const [ordenAbierta, setOrdenAbierta] = useState(null)
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [modoDelPanel, setModoDelPanel] = useState('detalle')
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  /**
   * Cuál fue el último detalle que se pidió.
   *
   * ⚠ Sin esto, un `GET /suppliers/orders/:id` en vuelo se apoderaba del panel:
   * abrir la A, cerrarla y abrir la B dejaba la B dibujada hasta que llegaba la
   * respuesta de la A —tarde— y el panel se rehacía como A. Se pierde lo tipeado
   * —el reseteo del panel borra las cantidades en el mismo commit— y se queda
   * mirando una orden que nadie pidió. Es el mismo arreglo, y por el mismo
   * motivo, que en `pages/PurchaseOrders.jsx`.
   */
  const pedidoDeDetalle = useRef(0)

  // ── Los formularios ──
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [edicionAbierta, setEdicionAbierta] = useState(false)
  const [pagoAbierto, setPagoAbierto] = useState(false)
  const [pedidoAbierto, setPedidoAbierto] = useState(false)

  const [formAlta, setFormAlta] = useState({ name: '' })
  const [formEdicion, setFormEdicion] = useState({ name: '', phone: '', email: '', address: '', cuit: '' })
  const [formPago, setFormPago] = useState({ amount: '', method: 'ef', date: fechaDeHoy(), notes: '' })
  const [lineasDelPedido, setLineasDelPedido] = useState([lineaVacia()])
  const [notasDelPedido, setNotasDelPedido] = useState('')
  const [fechaDelPedido, setFechaDelPedido] = useState(fechaDeHoy())
  const [productos, setProductos] = useState([])

  /**
   * El movimiento que se está corrigiendo, y sus campos (T1245, FR-093).
   *
   * Guarda el movimiento entero y no solo su id: la confirmación y el título del
   * diálogo necesitan el importe y el tipo, y volver a buscarlo en `movimientos`
   * por id lo perdería justo después de recargar el historial.
   */
  const [movimientoEnEdicion, setMovimientoEnEdicion] = useState(null)
  const [formMovimiento, setFormMovimiento] = useState({ date: '', amount: '', method: '', notes: '' })

  // ── La exportación de la cuenta (T1247, US8) ──
  const [exportAbierto, setExportAbierto] = useState(false)
  const [rangoDeExport, setRangoDeExport] = useState({ desde: '', hasta: '' })
  const [exportando, setExportando] = useState(false)

  /** Lo que la pantalla pide para la lista: el límite explícito y, si hay, `q`. */
  const cargarProveedores = useCallback(async () => {
    setCargandoLista(true)

    try {
      // `q` viaja por PRESENCIA y no como cadena vacía: es la misma regla que
      // cerró el `?supplier_id=%20` del listado de órdenes (FR-020).
      const res = await getSuppliers({ limit: LIMITE_DE_PROVEEDORES, ...(filtro ? { q: filtro } : {}) })

      setProveedores(res.data.data || [])
      setTotalDeProveedores(res.data.total || 0)
    } catch (err) {
      // Era un `console.error` mudo: la lista quedaba vacía y se leía como «esta
      // empresa no tiene proveedores».
      toast.error(mensajeDeError(err, 'No se pudo cargar la lista de proveedores.'))
    } finally {
      setCargandoLista(false)
    }
  }, [filtro])

  const cargarCuenta = useCallback(async (id) => {
    try {
      const res = await getSupplier(id)
      setProveedor(res.data.data)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cargar la cuenta del proveedor.'))
    }
  }, [])

  const cargarMovimientos = useCallback(async (id, pagina) => {
    setCargandoMovimientos(true)

    try {
      // El endpoint es 1-indexado y recibe `page`, igual que `Pagination`. El
      // saldo acumulado de cada fila viene calculado por el servidor: la
      // pantalla no lo acumula (FR-101).
      const res = await getSupplierMovements(id, { limit: MOVIMIENTOS_POR_PAGINA, page: pagina })

      setMovimientos(res.data.data || [])
      setTotalDeMovimientos(res.data.total || 0)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cargar el historial de la cuenta.'))
    } finally {
      setCargandoMovimientos(false)
    }
  }, [])

  const cargarOrdenes = useCallback(async (id) => {
    if (!puedeVerOrdenes) {
      setOrdenes([])
      setTotalDeOrdenes(0)
      return
    }

    setCargandoOrdenes(true)

    try {
      const res = await getPurchaseOrders({ supplier_id: id, limit: LIMITE_DE_ORDENES })
      setOrdenes(res.data.data || [])
      setTotalDeOrdenes(res.data.total || 0)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron cargar las órdenes del proveedor.'))
      setOrdenes([])
      setTotalDeOrdenes(0)
    } finally {
      setCargandoOrdenes(false)
    }
  }, [puedeVerOrdenes])

  // Escribir en el buscador no dispara una consulta por tecla: se espera a que
  // la persona termine. Sin esto, «Distribuidora» son trece llamadas y la
  // respuesta que llega última no tiene por qué ser la de la última tecla.
  useEffect(() => {
    const reloj = setTimeout(() => setFiltro(busqueda.trim()), ESPERA_DE_BUSQUEDA)

    return () => clearTimeout(reloj)
  }, [busqueda])

  useEffect(() => { cargarProveedores() }, [cargarProveedores])

  useEffect(() => {
    if (!proveedorId) {
      setProveedor(null)
      setMovimientos([])
      setOrdenes([])
      return
    }

    cargarCuenta(proveedorId)
    cargarOrdenes(proveedorId)
  }, [proveedorId, cargarCuenta, cargarOrdenes])

  useEffect(() => {
    if (!proveedorId) return

    cargarMovimientos(proveedorId, paginaDeMovimientos)
  }, [proveedorId, paginaDeMovimientos, cargarMovimientos])

  /**
   * Todo lo que cambia cuando se toca la plata del proveedor.
   *
   * Son cuatro cosas y hay que pedirlas juntas: el saldo de la ficha, el
   * historial, las órdenes y **la fila de la izquierda**, cuyo saldo sale del
   * listado. Sin la última, registrar un pago dejaba la columna de la lista
   * mostrando el saldo de antes y las dos mitades de la pantalla decían números
   * distintos.
   */
  const recargarCuenta = useCallback(async () => {
    if (!proveedorId) return

    setPaginaDeMovimientos(1)

    await Promise.all([
      cargarCuenta(proveedorId),
      cargarMovimientos(proveedorId, 1),
      cargarOrdenes(proveedorId),
    ])

    cargarProveedores()
  }, [proveedorId, cargarCuenta, cargarMovimientos, cargarOrdenes, cargarProveedores])

  const cargarProductos = async () => {
    try {
      const res = await getProducts({ limit: 500 })
      setProductos(res.data.data || [])
    } catch (err) {
      // El catálogo solo completa el nombre y el costo sugerido del alta de un
      // pedido: sin él se puede escribir igual, así que no se interrumpe.
      toast.error(mensajeDeError(err, 'No se pudo cargar el catálogo para sugerir productos.'))
    }
  }

  const elegirProveedor = (s) => {
    setProveedorId(s.id)
    setPaginaDeMovimientos(1)
    cargarProductos()
  }

  /**
   * Abre el panel con UNA orden, en el modo que se pida (FR-034).
   *
   * Copia el molde de `pages/PurchaseOrders.jsx`: el panel se abre ANTES de que
   * llegue la respuesta, con su estado de carga, porque abrirlo después deja un
   * clic sin efecto visible y el usuario vuelve a apretar.
   */
  const abrirOrden = async (id, modo = 'detalle') => {
    // El número de ESTE pedido. Todo lo que llegue después de que el contador
    // haya avanzado es la respuesta de una orden que ya no está abierta.
    const miPedido = ++pedidoDeDetalle.current

    setOrdenAbierta(null)
    setModoDelPanel(modo)
    setPanelAbierto(true)
    setCargandoDetalle(true)

    try {
      const res = await getPurchaseOrder(id)

      if (pedidoDeDetalle.current !== miPedido) return

      setOrdenAbierta(res.data.data)
    } catch (err) {
      // El error de una orden que ya no está abierta tampoco se muestra: el
      // usuario leería «No se pudo abrir la orden #112» mirando la #118.
      if (pedidoDeDetalle.current !== miPedido) return

      toast.error(mensajeDeError(err, `No se pudo abrir la orden #${id}.`))
      setPanelAbierto(false)
    } finally {
      if (pedidoDeDetalle.current === miPedido) setCargandoDetalle(false)
    }
  }

  /**
   * Abrir y cerrar el panel.
   *
   * Cerrar INVALIDA el detalle en vuelo: si no, la respuesta de la orden que se
   * acaba de cerrar llega después y vuelve a llenar `ordenAbierta`, que es el
   * estado con el que se reabre el panel la próxima vez.
   */
  const cambiarPanel = (abierto) => {
    if (!abierto) pedidoDeDetalle.current += 1
    setPanelAbierto(abierto)
  }

  const anularOrden = async (orden) => {
    const ok = await confirm(`¿Anular la orden #${orden.id}? Lo que ya se recibió sigue debiéndose.`)
    if (!ok) return

    try {
      await cancelPurchaseOrder(orden.id)
      setPanelAbierto(false)
      await recargarCuenta()
      toast.success('Orden anulada.')
    } catch (err) {
      // «La orden ya fue recibida completa» llega como 409 con su mensaje, y es
      // el único que sabe de qué orden habla.
      toast.error(mensajeDeError(err, `No se pudo anular la orden #${orden.id}.`))
    }
  }

  const crearProveedor = async (e) => {
    e.preventDefault()

    try {
      await createSupplier(formAlta)
      setAltaAbierta(false)
      setFormAlta({ name: '' })
      cargarProveedores()
      toast.success('Proveedor creado.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo crear el proveedor.'))
    }
  }

  const guardarProveedor = async (e) => {
    e.preventDefault()

    try {
      await updateSupplier(proveedor.id, formEdicion)
      setEdicionAbierta(false)
      await cargarCuenta(proveedor.id)
      cargarProveedores()
      toast.success('Proveedor actualizado.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron guardar los datos del proveedor.'))
    }
  }

  const registrarPago = async (e) => {
    e.preventDefault()

    // ⚠ Se valida ANTES de llamar (FR-088, US9 escenarios 1 y 2). No alcanza con
    // que el servidor lo rechace: un ida y vuelta para decir «poné un número»
    // es un error que la persona ve tres segundos después de haberlo cometido, y
    // el `required` del campo no corre cuando el formulario se manda con Enter
    // desde otro control ni cuando el valor es «0».
    const monto = importeDePago(formPago.amount)

    if (monto === null) {
      toast.error('Poné cuánto se pagó: tiene que ser un número mayor que cero.')
      return
    }

    // FR-089 y US9 escenario 3. **Pagar por adelantado es legítimo** —deja el
    // saldo negativo, que es la forma correcta de decir «el proveedor me debe a
    // mí»—, así que esto pregunta y no bloquea. Los DOS números van a la vista:
    // «el pago supera el saldo» sin decir cuánto es cada uno obliga a cerrar el
    // formulario para ir a mirarlo, y ahí se pierde lo tipeado.
    //
    // La resta no aparece por ningún lado: comparar dos números que mandó el
    // servidor no es volver a sumar la cuenta (FR-101).
    const saldo = Number(proveedor.saldo) || 0

    if (monto > saldo) {
      const ok = await confirm(
        `El saldo de ${proveedor.name} es $${pesos(saldo)} y estás registrando un pago de $${pesos(monto)}. `
        + 'Queda un saldo a favor tuyo. ¿Registrarlo igual?'
      )
      if (!ok) return
    }

    try {
      await createSupplierPayment(proveedor.id, {
        date: formPago.date,
        amount: monto,
        payment_method: formPago.method,
        notes: formPago.notes,
      })

      setPagoAbierto(false)
      setFormPago({ amount: '', method: 'ef', date: fechaDeHoy(), notes: '' })
      await recargarCuenta()
      toast.success('Pago registrado.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar el pago.'))
    }
  }

  /**
   * Abre la corrección de un movimiento del historial (T1245, FR-093).
   *
   * `PUT /api/suppliers/movements/:id` existe desde siempre —con `findScoped` y
   * lista blanca— y **ningún botón lo llamaba**: un pago cargado por $10.000 en
   * vez de $1.000 no había forma de corregirlo desde la pantalla, y la única
   * salida era borrarlo y volver a cargarlo con otra fecha.
   */
  const abrirEdicionDeMovimiento = (movimiento) => {
    setMovimientoEnEdicion(movimiento)
    setFormMovimiento({
      date: movimiento.date || '',
      // El importe se edita como lo devolvió el servidor: un `pesos()` acá
      // metería el punto de miles adentro de un campo numérico y el valor no
      // volvería a parsearse.
      amount: movimiento.amount ?? '',
      method: movimiento.payment_method || '',
      notes: movimiento.notes || '',
    })
  }

  const guardarMovimiento = async (e) => {
    e.preventDefault()

    // El mismo control que el alta de un pago: la corrección puede dejar el
    // importe vacío igual de fácil, y el endpoint escribe lo que le manden.
    const monto = importeDePago(formMovimiento.amount)

    if (monto === null) {
      toast.error('El importe del movimiento tiene que ser un número mayor que cero.')
      return
    }

    try {
      await updateMovement(movimientoEnEdicion.id, {
        date: formMovimiento.date,
        amount: monto,
        // Solo los pagos tienen medio de pago. Mandarlo vacío en una deuda
        // escribiría `''` en la columna y el historial diría «()».
        ...(movimientoEnEdicion.type === 'pago' ? { payment_method: formMovimiento.method } : {}),
        notes: formMovimiento.notes,
      })

      setMovimientoEnEdicion(null)
      await recargarCuenta()
      toast.success('Movimiento corregido.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo corregir el movimiento.'))
    }
  }

  const eliminarMovimiento = async (movimiento) => {
    const importe = Number(movimiento.amount) || 0
    const saldo = Number(proveedor.saldo) || 0

    // FR-094 y US9 escenario 7. La confirmación dice **cuánto** se borra y **en
    // qué queda el saldo**: «¿Eliminar?» a secas sobre una fila de plata no
    // alcanza para decidir, y el número que importa —el saldo después— no está
    // en ninguna parte de la pantalla.
    //
    // ⚠ Es la ÚNICA cuenta que esta pantalla hace sobre el saldo, y es una
    // resta sobre dos números que ya mandó el servidor, para un texto de
    // confirmación. **No es el saldo que se muestra**: apenas se borra,
    // `recargarCuenta()` trae el de `resumenDeCuenta` y ese es el que queda
    // dibujado (FR-101). El requisito pide el número resultante y no hay forma
    // de tenerlo sin restar: el servidor no lo devuelve antes de borrar.
    const resultante = movimiento.type === 'pago' ? saldo + importe : saldo - importe

    const ok = await confirm(
      `¿Eliminar este ${movimiento.type === 'pago' ? 'pago' : 'movimiento de deuda'} `
      + `de $${pesos(importe)} del ${fechaCorta(movimiento.date)}? `
      + `El saldo de ${proveedor.name} queda en $${pesos(resultante)}.`
    )
    if (!ok) return

    try {
      await deleteMovement(movimiento.id)
      await recargarCuenta()
      toast.success('Movimiento eliminado.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo eliminar el movimiento.'))
    }
  }

  /**
   * Elimina el proveedor entero (T1246, [PENDIENTE 10]).
   *
   * ⚠ La confirmación dice **cuántas órdenes, movimientos y documentos** se van
   * con él. La que había decía «¿Eliminar?» y detrás se llevaba la cuenta
   * corriente completa en una transacción: es borrar el respaldo de todo lo que
   * se le compró, y no se repara.
   *
   * Con saldo distinto de cero el servidor lo bloquea (T1221) y acá se muestra
   * **su** mensaje tal cual —lleva el nombre y el importe adentro—, que es lo
   * único que sabe de qué cuenta habla.
   */
  const eliminarProveedor = async () => {
    const ok = await confirm(
      `¿Eliminar a ${proveedor.name}? Se borran también ${queSeLleva()}. No se puede deshacer.`
    )
    if (!ok) return

    try {
      await deleteSupplier(proveedor.id)
      setProveedorId(null)
      cargarProveedores()
      toast.success('Proveedor eliminado.')
    } catch (err) {
      toast.error(mensajeDeError(err, `No se pudo eliminar a ${proveedor.name}.`))
    }
  }

  /**
   * Qué se lleva puesto el borrado, contado.
   *
   * Los tres números salen de lo que ya está en pantalla: el `total` del
   * historial, el `total` del listado de órdenes y los documentos de la ficha
   * —que vienen completos, sin paginar—.
   *
   * ⚠ **No se inventa un cero.** Sin `ordenes_compra.ver` no se pidieron las
   * órdenes, y mientras la consulta viaja el contador todavía es el del
   * proveedor anterior: en los dos casos se las nombra sin número. Decir «0
   * órdenes de compra» sobre un proveedor que tiene doce es peor que no decir
   * nada, porque suena a dato.
   */
  function queSeLleva() {
    const documentos = proveedor?.documents?.length || 0
    const seSabenLasOrdenes = puedeVerOrdenes && !cargandoOrdenes

    const partes = [
      `${totalDeMovimientos} ${totalDeMovimientos === 1 ? 'movimiento' : 'movimientos'}`,
      seSabenLasOrdenes
        ? `${totalDeOrdenes} ${totalDeOrdenes === 1 ? 'orden de compra' : 'órdenes de compra'}`
        : 'sus órdenes de compra',
      `${documentos} ${documentos === 1 ? 'documento' : 'documentos'}`,
    ]

    return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
  }

  /**
   * Baja la cuenta corriente en un `.xlsx` (T1247, US8).
   *
   * El corte es el de ventas: **el servidor arma las filas y el navegador arma
   * la hoja** (FR-097). `armarHoja` fuerza el tipo celda por celda —los importes
   * como número, el CUIT como texto— y de eso depende que la columna sume y que
   * los once dígitos del CUIT no se pierdan en notación científica.
   *
   * `book_new` + `book_append_sheet` + `writeFile` son la parte impura y viven
   * acá: `utils/exportarProveedores.js` es todo testeable a propósito.
   *
   * ⚠ **De la respuesta se usan DOS campos, no uno.** Acá se leía solo `data` y
   * se tiraba el resto: con un rango de fechas, el archivo abría la cuenta en un
   * número que sus propias columnas no explicaban —la primera fila mostraba un
   * saldo acumulado que no sale de su debe ni de su haber— y el contador no
   * tenía de dónde sacar por qué. `saldo_inicial` es lo que la API calcula con
   * los movimientos anteriores al rango, y sin pasarlo la corrección del
   * servidor no llegaba a la planilla.
   */
  const exportar = async (e) => {
    e.preventDefault()
    if (exportando) return

    setExportando(true)

    try {
      // Los dos extremos viajan por PRESENCIA y no como cadena vacía, igual que
      // el `q` del buscador: un `desde=` vacío es un filtro de fecha que el
      // servidor tiene que validar para descartar.
      const res = await exportarCuenta(proveedor.id, rangoDeExport)
      const filas = res.data.data || []
      const saldoInicial = res.data.saldo_inicial

      const libro = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        libro,
        armarHoja(filas, { saldoInicial }),
        'Cuenta corriente'
      )
      XLSX.writeFile(
        libro,
        nombreDelArchivo({ proveedor: proveedor.name, desde: rangoDeExport.desde, hasta: rangoDeExport.hasta })
      )

      setExportAbierto(false)
      toast.success('Cuenta exportada.')
    } catch (err) {
      // ⚠ El `400 LIMITE_EXPORT_SUPERADO` llega con los dos números y con qué
      // hacer adentro del mensaje del servidor, así que lo único que hay que
      // hacer acá es **no taparlo**: un texto fijo en el catch los pierde y deja
      // a alguien reintentando la misma exportación que no puede salir.
      toast.error(avisoDeExport(err, proveedor.name))
    } finally {
      setExportando(false)
    }
  }

  const registrarPedido = async (e) => {
    e.preventDefault()

    const lineas = lineasDelPedido.filter((l) => l.product_name && parseFloat(l.quantity) > 0)
    if (lineas.length === 0) {
      toast.error('Agregá al menos un producto con cantidad.')
      return
    }

    try {
      await createSupplierOrder(proveedor.id, {
        date: fechaDelPedido,
        notes: notasDelPedido,
        items: lineas.map((l) => ({
          product_id: l.product_id ? parseInt(l.product_id, 10) : null,
          product_name: l.product_name,
          quantity: parseFloat(l.quantity),
          unit_price: parseFloat(l.unit_price),
        })),
      })

      setPedidoAbierto(false)
      setLineasDelPedido([lineaVacia()])
      setNotasDelPedido('')
      await recargarCuenta()
      toast.success('Pedido registrado.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo registrar el pedido.'))
    }
  }

  const cambiarLinea = (indice, campo, valor) => {
    setLineasDelPedido((previas) => {
      const copia = previas.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l))

      if (campo === 'product_name') {
        // El costo cargado se propone como precio unitario, que es el número que
        // el usuario ya tenía y el que más veces es el correcto.
        const producto = productos.find((p) => p.name === valor)
        if (producto) {
          copia[indice].product_id = producto.id
          copia[indice].unit_price = producto.cost || ''
        }
      }

      return copia
    })
  }

  const totalDelPedido = lineasDelPedido.reduce(
    (suma, l) => suma + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0),
    0
  )

  const paginasDeMovimientos = Math.max(1, Math.ceil(totalDeMovimientos / MOVIMIENTOS_POR_PAGINA))

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Proveedores"
        descripcion="A quién le debés y cuánto, con la cuenta corriente de cada uno: lo comprado, lo pagado y lo que pediste y todavía no llegó."
      >
        <button
          type="button"
          onClick={() => setAltaAbierta(true)}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[13px]
                     font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark"
        >
          <Plus className="h-4 w-4" />
          Nuevo proveedor
        </button>
      </PageHeader>

      {/* Dos columnas (FR-054). En pantalla angosta se apilan: la lista arriba y
          la cuenta abajo, que es el orden en que se usan. */}
      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        {/* ══ La lista ══
            El `aria-label` no es decorativo: el nombre del proveedor elegido se
            dibuja DOS veces —en su fila y en el encabezado de la cuenta—, así que
            sin una región con nombre no hay forma de decir «la fila» ni para un
            lector de pantalla ni para un test. */}
        <section
          aria-label="Lista de proveedores"
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
            <h2>Proveedores</h2>
            <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
              {totalDeProveedores}
            </span>
            <div className="flex-1" />
            {cargandoLista && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
          </div>

          <div className="border-b border-border px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
              <input
                aria-label="Buscar proveedores"
                placeholder="Buscar por nombre…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13.5px]
                           transition-colors focus-visible:border-brand focus-visible:outline-none"
              />
            </div>
          </div>

          {proveedores.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Users className="mx-auto h-7 w-7 text-fg-3" />
              <p className="mt-3 font-semibold">
                {filtro ? 'Ningún proveedor coincide con la búsqueda.' : 'Todavía no hay proveedores.'}
              </p>
              <p className="mx-auto mt-1 max-w-[36ch] text-sm text-fg-2">
                {filtro
                  ? 'Probá con parte del nombre, o borrá la búsqueda para ver la lista completa.'
                  : 'Cargá el primero con «Nuevo proveedor» y desde ahí se le registran pedidos y pagos.'}
              </p>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {proveedores.map((s) => {
                const elegido = s.id === proveedorId
                // FR-086. Un proveedor con actividad y sin un solo documento no
                // tiene respaldo de nada de lo que se le compró. ⚠ El listado no
                // devuelve un conteo de órdenes, así que «con órdenes» se lee de
                // lo que sí devuelve: movimientos registrados o mercadería
                // pedida y todavía no recibida.
                const sinFactura = s.documentos === 0
                  && (s.movimientos > 0 || Number(s.pendiente_de_recibir) > 0)

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => elegirProveedor(s)}
                    aria-current={elegido ? 'true' : undefined}
                    style={{ gridTemplateColumns: COLUMNAS_DE_PROVEEDOR }}
                    className={`grid w-full items-center gap-x-3 border-b border-l-2 border-border px-4 py-3
                                text-left transition-colors ${
                                  elegido
                                    ? 'border-l-brand bg-surface-2'
                                    : 'border-l-transparent hover:bg-surface-2'
                                }`}
                  >
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="truncate text-[13.5px] font-medium">{s.name}</span>

                      <span className="flex flex-wrap items-center gap-1.5">
                        {/* ⚠ La cuenta ENTERA, no dos de sus tres números: ver
                            `EtiquetaDeCuenta`. */}
                        <EtiquetaDeCuenta cuenta={s} />

                        {sinFactura && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-warn-line
                                           bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warn">
                            <Receipt className="h-3 w-3" />
                            Sin factura
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="flex flex-col items-end gap-1.5">
                      <span className="num text-[13.5px] font-semibold">${pesos(s.saldo)}</span>
                      <span className="text-[11px] text-fg-3">
                        {s.movimientos || 0} {s.movimientos === 1 ? 'movimiento' : 'movimientos'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* ══ La cuenta del elegido ══ */}
        {proveedor ? (
          <div className="min-w-0 space-y-6">
            {/* ── Quién es, y las dos acciones ── */}
            <section className="rounded-xl border border-border bg-surface p-5 shadow-nivel-1">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate text-[17px]">{proveedor.name}</h2>
                    <BotonDeFila
                      title="Editar los datos del proveedor"
                      onClick={() => {
                        setFormEdicion({
                          name: proveedor.name || '',
                          phone: proveedor.phone || '',
                          email: proveedor.email || '',
                          address: proveedor.address || '',
                          cuit: proveedor.cuit || '',
                        })
                        setEdicionAbierta(true)
                      }}
                    >
                      <Pencil />
                    </BotonDeFila>

                    {/* T1246. Va acá y no entre las acciones de la derecha: es
                        destructivo y no compite con «Registrar pedido» ni con
                        «Registrar pago», que son lo que se hace todos los días. */}
                    <BotonDeFila
                      title={
                        puedeEliminar
                          ? 'Eliminar el proveedor'
                          : 'Necesitás el permiso «proveedores.eliminar»'
                      }
                      disabled={!puedeEliminar}
                      onClick={eliminarProveedor}
                      className="hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 />
                    </BotonDeFila>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-2">
                    {proveedor.cuit && <span className="num">CUIT {proveedor.cuit}</span>}
                    {proveedor.phone && <span className="num">Tel. {proveedor.phone}</span>}
                    {proveedor.email && <span>{proveedor.email}</span>}
                    {proveedor.address && <span>{proveedor.address}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setPedidoAbierto(true)} className={SECUNDARIO}>
                    <Truck className="h-3.5 w-3.5 text-fg-3" />
                    Registrar pedido
                  </button>
                  <button type="button" onClick={() => setPagoAbierto(true)} className={SECUNDARIO}>
                    <CreditCard className="h-3.5 w-3.5 text-fg-3" />
                    Registrar pago
                  </button>
                  {/* FR-096. La API ya exige `proveedores.ver` (FR-102), que es
                      el mismo permiso que hace falta para estar viendo esta
                      pantalla: acá no hay un segundo gateo que pueda separarse
                      del del servidor. */}
                  <button type="button" onClick={() => setExportAbierto(true)} className={SECUNDARIO}>
                    <Download className="h-3.5 w-3.5 text-fg-3" />
                    Exportar cuenta
                  </button>
                </div>
              </div>
            </section>

            {/* ── El resumen (FR-057) ──
                El saldo es el elemento de más peso visual del bloque y su tono
                sale del estado de la cuenta, que es el signo del saldo con
                «Sin movimientos» aparte. Los tres tonos van JUNTOS —línea,
                fondo y texto—: un color de estado suelto sobre el fondo de la
                tarjeta se lee como un error de estilo.

                Comprado y pagado van al lado porque un saldo de $0 no distingue
                «nunca le compré» de «le compré y le pagué todo», que es lo que
                mostraba el sistema viejo. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={`min-w-0 rounded-xl border px-4 py-3.5 ${tonoDeProveedor(estadoDeProveedor(proveedor))}`}>
                <p className="eyebrow">Saldo pendiente</p>
                <p className="num mt-1 text-[26px] font-semibold tracking-[-0.03em]">
                  ${pesos(proveedor.saldo)}
                </p>
                <p className="mt-0.5 text-[11.5px] font-semibold">
                  {ETIQUETAS[estadoDeProveedor(proveedor)]}
                </p>
              </div>

              <Indicador etiqueta="Total comprado" valor={proveedor.deuda} pista="Mercadería recibida" />
              <Indicador etiqueta="Total pagado" valor={proveedor.pagado} pista="Pagos registrados" />
              {/* La decisión 2 de la spec hecha número: la deuda es la mercadería
                  recibida, así que lo pedido y no entregado va APARTE y con su
                  etiqueta. Es el número que Comprafit leía del sistema viejo. */}
              <Indicador
                etiqueta="Pedido pendiente"
                valor={proveedor.pendiente_de_recibir}
                pista="Pedido y todavía no recibido"
              />
            </div>

            {/* ── Las órdenes del proveedor (T1242) ── */}
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
              <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
                <h2>Órdenes de compra</h2>
                {puedeVerOrdenes && (
                  <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
                    {ordenes.length}
                  </span>
                )}
                <div className="flex-1" />
                {cargandoOrdenes && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
              </div>

              {!puedeVerOrdenes ? (
                /* ⚠ Riesgo 12. «No tenés permiso» y «no hay órdenes» son cosas
                   distintas: el segundo texto sobre el primer caso hace concluir
                   que las órdenes del proveedor se perdieron. */
                <div className="py-12 text-center">
                  <Lock className="mx-auto h-7 w-7 text-fg-3" />
                  <p className="mt-3 font-semibold">No tenés permiso para ver las órdenes de compra.</p>
                  <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                    La cuenta corriente se ve igual. Para ver los pedidos hace falta el permiso
                    «ordenes_compra.ver».
                  </p>
                </div>
              ) : ordenes.length === 0 ? (
                <div className="py-12 text-center">
                  <ClipboardList className="mx-auto h-7 w-7 text-fg-3" />
                  <p className="mt-3 font-semibold">Este proveedor no tiene órdenes de compra.</p>
                  <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                    Con «Registrar pedido» se carga lo que le pediste, y al recibirlo se actualiza el stock.
                  </p>
                </div>
              ) : (
                <TablaGrid anchoMinimo={ANCHO_MINIMO_DE_ORDENES}>
                  <Encabezado columnas={COLUMNAS_DE_ORDEN}>
                    <span>Orden</span>
                    <span>Fecha</span>
                    <span>Recepción</span>
                    <span className="text-right">Total</span>
                    <span className="text-right">Acciones</span>
                  </Encabezado>

                  {ordenes.map((o) => {
                    const recibido = porcentajeRecibido(o)
                    // Una anulada sigue estando —si desapareciera, nadie podría
                    // comprobar que la anuló— pero deja de competir por la
                    // atención.
                    const anulada = o.status === 'cancelled'

                    return (
                      <Fila
                        key={o.id}
                        columnas={COLUMNAS_DE_ORDEN}
                        onClick={() => abrirOrden(o.id, 'detalle')}
                        className={anulada ? 'opacity-55' : undefined}
                      >
                        <span className="num text-[13px] font-medium">#{o.id}</span>

                        <span className="num text-[13px] text-fg-2">{fechaCorta(o.date)}</span>

                        <span className="flex flex-col gap-1.5">
                          <EtiquetaDeEstado status={o.status} />
                          <span
                            role="progressbar"
                            aria-valuenow={recibido}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Recibido: ${recibido}% de las unidades`}
                            className="block h-[4px] w-full overflow-hidden rounded-full bg-surface-3"
                          >
                            <span
                              className={`block h-full rounded-full ${BARRA_POR_TONO[ESTADOS[o.status]?.tono] || BARRA_POR_TONO.neutro}`}
                              style={{ width: `${recibido}%` }}
                            />
                          </span>
                        </span>

                        <span className="num text-right text-sm font-semibold">${pesos(o.total)}</span>

                        <span className="flex justify-end gap-0.5">
                          {/* ⚠ «Recibir» abre EL MISMO panel que la fila, en modo
                              recepción, y pasa por `abrirOrden` igual que ella:
                              es lo que hace que la orden que se recibe sea, por
                              construcción, la que se abrió. Acá vivía el
                              `find()` por estado que recibía contra la primera
                              orden pendiente del proveedor. */}
                          {esRecibible(o) && (
                            <BotonDeFila
                              title="Recibir mercadería"
                              onClick={() => abrirOrden(o.id, 'recepcion')}
                            >
                              <Truck />
                            </BotonDeFila>
                          )}
                        </span>
                      </Fila>
                    )
                  })}
                </TablaGrid>
              )}
            </section>

            {/* ── Los documentos (FR-080 a FR-087) ──
                El bloque hace sus propias llamadas y consulta los permisos por su
                cuenta: acá solo se le dice a quién pertenecen y qué hacer cuando
                algo cambió. **No va envuelto en `<Can>`**: le escondería el
                bloque entero a quien solo tiene `proveedores.ver`, que es justo
                el caso que FR-087 pide que se pueda leer. */}
            <BloqueDeDocumentos
              proveedorId={proveedor.id}
              documentos={proveedor.documents}
              onCambio={() => {
                cargarCuenta(proveedor.id)
                cargarProveedores()
              }}
            />

            {/* ── El historial de cuenta (FR-058) ── */}
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
              <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
                <h2>Historial de cuenta</h2>
                <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
                  {totalDeMovimientos}
                </span>
                <div className="flex-1" />
                {cargandoMovimientos && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
              </div>

              {movimientos.length === 0 ? (
                /* Una tabla con encabezados y sin filas parece un error de carga:
                   se dice qué pasa y qué hacer (US5 escenario 9). */
                <div className="py-12 text-center">
                  <ClipboardList className="mx-auto h-7 w-7 text-fg-3" />
                  <p className="mt-3 font-semibold">Todavía no hay movimientos en esta cuenta.</p>
                  <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                    Recibir un pedido carga la deuda y registrar un pago la descuenta. Los dos aparecen acá.
                  </p>
                </div>
              ) : (
                <TablaGrid anchoMinimo={ANCHO_MINIMO_DE_MOVIMIENTOS}>
                  <Encabezado columnas={COLUMNAS_DE_MOVIMIENTO}>
                    <span>Fecha</span>
                    <span>Operación</span>
                    <span>Notas</span>
                    <span className="text-right">Debe</span>
                    <span className="text-right">Haber</span>
                    <span className="text-right">Acciones</span>
                  </Encabezado>

                  {/* ⚠ **Acá no hay ningún `.sort()`.** El orden lo decide el
                      servidor —descendente por fecha y desempatando por id— y el
                      historial pagina, así que un orden decidido en el navegador
                      sería un orden sobre un subconjunto (FR-053). La línea que
                      había hacía `selectedSupplier.movements?.sort(...)` sobre el
                      arreglo del estado de React: una mutación en medio de un
                      render, que además deja el arreglo reordenado para siempre. */}
                  {movimientos.map((m) => {
                    const esPago = m.type === 'pago'

                    return (
                      <Fila key={m.id} columnas={COLUMNAS_DE_MOVIMIENTO} className="cursor-default">
                        {/* `fechaCorta` y NO `new Date(iso)`: un DATEONLY viaja
                            como «2026-08-01» y `new Date` lo lee en UTC, así que
                            en Argentina el movimiento del primero de agosto se
                            muestra el 31 de julio (FR-052). */}
                        <span className="num text-[13px] text-fg-2">{fechaCorta(m.date)}</span>

                        <span>
                          <span
                            className={`inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                              esPago
                                ? 'border-ok-line bg-ok-soft text-ok'
                                : 'border-danger-line bg-danger-soft text-danger'
                            }`}
                          >
                            {esPago ? 'Pago' : 'Pedido'}
                          </span>
                        </span>

                        {/* El método se escribe con la etiqueta compartida y no
                            con el código crudo: la celda decía «(tr)», que no
                            significa nada para quien lee la cuenta. */}
                        <span className="truncate text-[13px] text-fg-2" title={m.notes || ''}>
                          {m.notes || '—'}
                          {etiquetaDeMetodo(m.payment_method) && ` (${etiquetaDeMetodo(m.payment_method)})`}
                        </span>

                        <span className="num text-right text-[13px] font-semibold text-danger">
                          {esPago ? '' : `$${pesos(m.amount)}`}
                        </span>

                        <span className="num text-right text-[13px] font-semibold text-ok">
                          {esPago ? `$${pesos(m.amount)}` : ''}
                        </span>

                        {/* T1245 y FR-093. Los dos endpoints existen desde
                            siempre y no los llamaba nadie: hasta acá, un pago
                            cargado por $10.000 en vez de $1.000 no se podía
                            corregir desde ninguna pantalla. */}
                        <span className="flex justify-end gap-0.5">
                          <BotonDeFila
                            title={
                              puedeEditar
                                ? 'Corregir el movimiento'
                                : 'Necesitás el permiso «proveedores.editar»'
                            }
                            disabled={!puedeEditar}
                            onClick={() => abrirEdicionDeMovimiento(m)}
                          >
                            <Pencil />
                          </BotonDeFila>
                          <BotonDeFila
                            title={
                              puedeEliminar
                                ? 'Eliminar el movimiento'
                                : 'Necesitás el permiso «proveedores.eliminar»'
                            }
                            disabled={!puedeEliminar}
                            onClick={() => eliminarMovimiento(m)}
                            className="hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 />
                          </BotonDeFila>
                        </span>
                      </Fila>
                    )
                  })}
                </TablaGrid>
              )}

              {/* Va DENTRO de la tarjeta y debajo de la tabla. El componente se
                  esconde solo cuando hay una página sola. Es 1-indexado, igual
                  que el `page` que pide el endpoint. */}
              <Pagination
                page={paginaDeMovimientos}
                totalPages={paginasDeMovimientos}
                onPageChange={setPaginaDeMovimientos}
              />
            </section>
          </div>
        ) : (
          /* US5 escenario 10: sin proveedor elegido se dice qué hacer, no una
             mitad de pantalla en blanco. */
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed
                          border-border-2 px-6 py-24 text-center">
            <Users className="h-8 w-8 text-fg-3" />
            <p className="mt-3 font-semibold">Elegí un proveedor de la lista.</p>
            <p className="mt-1 max-w-[46ch] text-[13.5px] text-fg-2">
              A la derecha vas a ver su saldo, lo comprado, lo pagado, sus órdenes de compra y el
              historial de la cuenta.
            </p>
          </div>
        )}
      </div>

      {/* ── El panel de la orden ──
          UN solo componente para el detalle y para la recepción, y el MISMO que
          usa `/ordenes-compra` (FR-034). Reemplaza a los dos diálogos que había
          acá. `ordenAbierta` es la única fuente de qué orden se está mirando, así
          que el `PUT` de la recepción no puede salir contra otra.

          **No va envuelto en `<Can>`**: el panel consulta `ordenes_compra.recibir`
          y `ordenes_compra.anular` por su cuenta y deshabilita con la explicación
          a la vista (FR-019). Un `<Can>` acá le sacaría el panel entero a quien
          solo tiene `ordenes_compra.ver`. */}
      <PanelOrdenDeCompra
        abierto={panelAbierto}
        onOpenChange={cambiarPanel}
        orden={ordenAbierta}
        cargando={cargandoDetalle}
        modo={modoDelPanel}
        onCambiarModo={setModoDelPanel}
        telefonoDelProveedor={proveedor?.phone || null}
        onAnular={anularOrden}
        onRecibida={recargarCuenta}
      />

      {/* ── Alta de proveedor ── */}
      <Dialog open={altaAbierta} onOpenChange={setAltaAbierta}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle></DialogHeader>
          <form onSubmit={crearProveedor} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del proveedor</Label>
              <Input
                required
                value={formAlta.name}
                onChange={(e) => setFormAlta({ name: e.target.value })}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setAltaAbierta(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit">Crear</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edición de proveedor ── */}
      <Dialog open={edicionAbierta} onOpenChange={setEdicionAbierta}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Editar proveedor</DialogTitle></DialogHeader>
          <form onSubmit={guardarProveedor} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                required
                value={formEdicion.name}
                onChange={(e) => setFormEdicion({ ...formEdicion, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input
                  value={formEdicion.phone}
                  onChange={(e) => setFormEdicion({ ...formEdicion, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formEdicion.email}
                  onChange={(e) => setFormEdicion({ ...formEdicion, email: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input
                value={formEdicion.address}
                onChange={(e) => setFormEdicion({ ...formEdicion, address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>CUIT</Label>
              <Input
                value={formEdicion.cuit}
                onChange={(e) => setFormEdicion({ ...formEdicion, cuit: e.target.value })}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setEdicionAbierta(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit">Guardar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Registrar pedido ── */}
      <Dialog open={pedidoAbierto} onOpenChange={setPedidoAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar pedido — {proveedor?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={registrarPedido} className="space-y-4">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input
                type="date"
                className="num"
                value={fechaDelPedido}
                onChange={(e) => setFechaDelPedido(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Productos</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLineasDelPedido((previas) => [...previas, lineaVacia()])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Agregar
                </Button>
              </div>

              <div className="max-h-60 space-y-2 overflow-y-auto">
                {lineasDelPedido.map((linea, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="Nombre del producto"
                        aria-label={`Producto de la línea ${i + 1}`}
                        value={linea.product_name}
                        onChange={(e) => cambiarLinea(i, 'product_name', e.target.value)}
                        list={`catalogo-${i}`}
                      />
                      <datalist id={`catalogo-${i}`}>
                        {productos.map((p) => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className="num text-right"
                        placeholder="Cant."
                        aria-label={`Cantidad de la línea ${i + 1}`}
                        value={linea.quantity}
                        onChange={(e) => cambiarLinea(i, 'quantity', e.target.value)}
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="num text-right"
                        placeholder="P/U"
                        aria-label={`Precio unitario de la línea ${i + 1}`}
                        value={linea.unit_price}
                        onChange={(e) => cambiarLinea(i, 'unit_price', e.target.value)}
                      />
                    </div>
                    {lineasDelPedido.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-danger"
                        title={`Quitar la línea ${i + 1}`}
                        onClick={() => setLineasDelPedido((previas) => previas.filter((_, j) => j !== i))}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[13px] text-fg-2">
                {lineasDelPedido.filter((l) => l.product_name).length} productos
              </span>
              <span className="num text-[19px] font-semibold">Total ${pesos(totalDelPedido)}</span>
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Input
                value={notasDelPedido}
                onChange={(e) => setNotasDelPedido(e.target.value)}
                placeholder="Ej: pedido mensual"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setPedidoAbierto(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit">Registrar pedido</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Registrar pago ── */}
      <Dialog open={pagoAbierto} onOpenChange={setPagoAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
          <form onSubmit={registrarPago} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pago-monto">Monto pagado</Label>
                <Input
                  id="pago-monto"
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  value={formPago.amount}
                  onChange={(e) => setFormPago({ ...formPago, amount: e.target.value })}
                />
              </div>
              {/* FR-092 y US9 escenario 5. El estado ya guardaba la fecha y **no
                  había ningún campo**: un pago de ayer se registraba con la
                  fecha de hoy, y en la cuenta corriente eso mueve el movimiento
                  de mes sin que nada avise. */}
              <div className="space-y-2">
                <Label htmlFor="pago-fecha">Fecha del pago</Label>
                <Input
                  id="pago-fecha"
                  type="date"
                  className="num"
                  value={formPago.date}
                  onChange={(e) => setFormPago({ ...formPago, date: e.target.value })}
                />
              </div>
            </div>
            {/* Un `<select>` nativo y no el de shadcn: los cuatro métodos son una
                lista fija y corta, el nativo ya se opera con teclado, y es el
                mismo criterio que siguieron `BloqueDeDocumentos` y el selector de
                sucursal del panel de la orden. */}
            <div className="space-y-2">
              <Label htmlFor="pago-metodo">Método de pago</Label>
              <select
                id="pago-metodo"
                className={CAMPO}
                value={formPago.method}
                onChange={(e) => setFormPago({ ...formPago, method: e.target.value })}
              >
                {METODOS_DE_PAGO.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pago-notas">Notas</Label>
              <Input
                id="pago-notas"
                value={formPago.notes}
                onChange={(e) => setFormPago({ ...formPago, notes: e.target.value })}
                placeholder="Ej: pago a cuenta"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setPagoAbierto(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit">Confirmar pago</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Corregir un movimiento (T1245, FR-093) ──
          `PUT /api/suppliers/movements/:id` existe desde siempre, con
          `findScoped` y lista blanca, y no lo llamaba nadie. */}
      <Dialog open={Boolean(movimientoEnEdicion)} onOpenChange={(abierto) => { if (!abierto) setMovimientoEnEdicion(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Corregir {movimientoEnEdicion?.type === 'pago' ? 'el pago' : 'el movimiento de deuda'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={guardarMovimiento} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="movimiento-monto">Importe</Label>
                <Input
                  id="movimiento-monto"
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  value={formMovimiento.amount}
                  onChange={(e) => setFormMovimiento({ ...formMovimiento, amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="movimiento-fecha">Fecha</Label>
                <Input
                  id="movimiento-fecha"
                  type="date"
                  className="num"
                  value={formMovimiento.date}
                  onChange={(e) => setFormMovimiento({ ...formMovimiento, date: e.target.value })}
                />
              </div>
            </div>

            {/* Solo los pagos tienen medio de pago: una deuda con «Efectivo»
                adentro es un dato inventado que después nadie sabe leer. */}
            {movimientoEnEdicion?.type === 'pago' && (
              <div className="space-y-2">
                <Label htmlFor="movimiento-metodo">Método de pago</Label>
                <select
                  id="movimiento-metodo"
                  className={CAMPO}
                  value={formMovimiento.method}
                  onChange={(e) => setFormMovimiento({ ...formMovimiento, method: e.target.value })}
                >
                  {/* La opción vacía existe porque el movimiento puede venir sin
                      método —los que cargó el sistema viejo— y forzar uno sería
                      inventar con qué se pagó. */}
                  <option value="">Sin especificar</option>
                  {METODOS_DE_PAGO.map((m) => (
                    <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="movimiento-notas">Notas</Label>
              <Input
                id="movimiento-notas"
                value={formMovimiento.notes}
                onChange={(e) => setFormMovimiento({ ...formMovimiento, notes: e.target.value })}
                placeholder="Ej: se había cargado con el importe de otra factura"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setMovimientoEnEdicion(null)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit">Guardar cambios</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Exportar la cuenta (T1247, US8) ──
          El rango existe por dos motivos: el nombre del archivo lleva el período
          adentro (FR-100) para que dos exportaciones no se pisen en la carpeta
          de descargas, y es el único lugar donde acotar cuando el servidor
          responde que la cuenta tiene más movimientos que el máximo. */}
      <Dialog open={exportAbierto} onOpenChange={setExportAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Exportar la cuenta de {proveedor?.name}</DialogTitle></DialogHeader>
          <form onSubmit={exportar} className="space-y-4">
            <p className="text-[13px] text-fg-2">
              Sale un archivo de planilla con fecha, tipo, descripción, debe, haber y saldo. Sin
              fechas se exporta la cuenta completa.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="export-desde">Desde</Label>
                <Input
                  id="export-desde"
                  type="date"
                  className="num"
                  value={rangoDeExport.desde}
                  onChange={(e) => setRangoDeExport({ ...rangoDeExport, desde: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="export-hasta">Hasta</Label>
                <Input
                  id="export-hasta"
                  type="date"
                  className="num"
                  value={rangoDeExport.hasta}
                  onChange={(e) => setRangoDeExport({ ...rangoDeExport, hasta: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setExportAbierto(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" type="submit" disabled={exportando}>
                {exportando ? 'Preparando…' : 'Descargar planilla'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  )
}

/** Una línea vacía del alta de un pedido. */
function lineaVacia() {
  return { product_id: '', product_name: '', quantity: 1, unit_price: '' }
}

/**
 * Qué se le dice al usuario cuando la exportación no sale (T1247).
 *
 * ⚠⚠ **Acá NO hay una tabla de códigos.** La tarea pedía que el aviso del
 * `400 LIMITE_EXPORT_SUPERADO` se armara en la pantalla con el `total` y el
 * `limite` que vienen en el cuerpo, y eso se escribió y se descartó por dos
 * motivos que se descubrieron al comprobar la mutación:
 *
 *  1. **El test no se ponía en rojo.** El servidor ya manda la frase entera en
 *     `message` —«La cuenta tiene 6200 movimientos y el máximo por archivo es
 *     5000. Acotá el rango de fechas.»— y `mensajeDeError` la devuelve, porque
 *     descarta `error` cuando es un código de máquina. Las dos versiones decían
 *     lo mismo, así que el caso pasaba con y sin la traducción: un test que no
 *     puede fallar no prueba nada.
 *  2. **Sería la segunda fuente de la misma oración**, que es exactamente lo que
 *     el encabezado de `utils/erroresDeApi.js` descarta: una tabla de códigos en
 *     el navegador se separa del servidor el día que alguien agrega un caso, y
 *     nadie se entera hasta que un usuario ve un código.
 *
 * Lo que sí hace falta y no estaba: **un genérico específico**. Sin él, la red
 * caída o un 500 salen como «No se pudo completar la operación», que no dice
 * ni qué se estaba haciendo ni de qué cuenta.
 */
function avisoDeExport(err, nombreDelProveedor) {
  return mensajeDeError(err, `No se pudo exportar la cuenta de ${nombreDelProveedor}.`)
}

export default Orders
