import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import api, { getSales, getSale, exportSales } from '@/services/api'
import { printInvoice } from '@/utils/printInvoice'
import useStore from '@/store/useStore'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import PanelVenta from '@/components/PanelVenta'
import { presentacionDeEstado, estaAnulada } from '@/utils/estadoVenta'
import { descargarVentas } from '@/utils/exportarVentas'
import { pesos } from '@/utils/formato'
import {
  Calendar, Search, Printer, ShieldCheck, FileText, Store, Trash2,
  Receipt, FilterX, Download, Plus, Loader2, RefreshCw, FileCheck,
} from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import Pagination from '@/components/Pagination'

// ════════════════════════════════════════════
//  ADMINAPP · Historial de ventas
//
//  La pantalla que la maqueta dibuja completa, y por eso la que fija el patrón
//  de tabla que van a copiar Inventario, Órdenes de compra, Gastos y Equipo.
//  El marco de la tabla vive en components/TablaGrid.jsx; las columnas y las
//  celdas se escriben acá.
//
//  Reglas: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Las siete columnas, idénticas en el encabezado y en las filas.
 *
 * Que sean el MISMO string y no dos copias no es cosmético: cuando difieren,
 * las etiquetas dejan de estar sobre sus datos. Es el defecto 2 del
 * relevamiento —el encabezado declaraba «Estado, Total» y las celdas
 * renderizaban el total primero, así que se leía un importe bajo la etiqueta
 * «Estado»—.
 */
const COLUMNAS = '80px 116px 132px minmax(0,1fr) 116px 128px 128px'

/**
 * Por debajo de esto la tabla scrollea DENTRO de su tarjeta.
 *
 * 700px de columnas fijas + 96px de separaciones + 40px de padding = 836, y el
 * resto es lo mínimo que se le deja al nombre del cliente. El `min-width:1140px`
 * que la maqueta le pone al contenedor de la página NO se copia: haría
 * scrollear el body entero y el usuario perdería de vista la barra lateral cada
 * vez que mira la última columna.
 */
const ANCHO_MINIMO = 1020

const FILAS_POR_PAGINA = 25

/** Botón principal del sistema: 34px, marca, sombra de nivel 1. */
const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:pointer-events-none disabled:opacity-60'

/** Botón secundario del sistema: 34px, borde, hover en surface-3. */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:pointer-events-none disabled:opacity-60'

const ETIQUETAS_DE_TIPO = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' }

/** El valor del filtro de sucursal que significa «no filtres por sucursal».
 *  Es el mismo que entiende la API. */
const TODAS_LAS_SUCURSALES = 'todas'

/** Más de esto no se baja en un solo archivo. Es el mismo tope que aplica la
 *  API: acá se avisa antes de pedir nada, allá es la red de abajo. */
const LIMITE_EXPORT = 5000

/**
 * El identificador del comprobante fiscal: «0005-00014882».
 *
 * Los tres campos juntos —punto de venta, tipo y número— son lo que identifica
 * un comprobante ante ARCA. El número suelto no identifica nada, porque la
 * numeración es correlativa POR punto de venta.
 */
function numeroDeComprobante(venta) {
  const pv = String(venta.afip_pv || 0).padStart(4, '0')
  const nro = String(venta.afip_nro).padStart(8, '0')
  return `${pv}-${nro}`
}

/**
 * El identificador corto de la OPERACIÓN, que es otra cosa que el comprobante.
 *
 * Va como dato secundario debajo del «—» de una venta sin comprobante fiscal.
 * Antes se imprimía `sale.id.split('-')[0]` en el lugar del número: un pedazo
 * de UUID, que no es correlativo, no se dicta por teléfono y no sirve para
 * buscar. Se toma la cola y no la cabeza porque el prefijo es igual en todas
 * (`sale_1754…`) y lo que distingue está al final.
 */
function identificadorCorto(id) {
  const limpio = String(id || '').replace(/[^a-zA-Z0-9]/g, '')
  return limpio.slice(-6).toUpperCase()
}

/**
 * Qué tiene de malo el rango elegido, o `null` si está bien.
 *
 * Se comprueba ANTES de consultar. Los dos casos avisan y no consultan: pedir
 * un rango invertido devuelve siempre cero filas, y uno de más de un año hace
 * un scan de todas las ventas históricas de la empresa para terminar en un
 * error que ya se sabía de antemano.
 *
 * Un rango a medias —falta «desde» o falta «hasta»— NO es un problema: el
 * servidor completa el que falte con el otro.
 *
 * Las fechas se comparan como texto porque `YYYY-MM-DD` ordena igual
 * alfabéticamente que cronológicamente, y pasarlas por `new Date()` las
 * interpreta en UTC, que es justo el error que este rango vino a evitar.
 */
function problemaDelRango(desde, hasta) {
  if (!desde || !hasta) return null

  if (desde > hasta) {
    return `El rango está invertido: «desde» (${desde}) es posterior a «hasta» (${hasta}).`
  }

  const limite = new Date(`${desde}T00:00:00Z`)
  limite.setUTCFullYear(limite.getUTCFullYear() + 1)

  if (new Date(`${hasta}T00:00:00Z`) > limite) {
    return 'El rango no puede ser mayor a un año. Acotá las fechas y volvé a consultar.'
  }

  return null
}

/** Ficha del cliente → nombre libre escrito en la venta → consumidor final. */
function nombreDelCliente(venta) {
  return (venta.customer && venta.customer.name) || venta.customer_name || 'Consumidor final'
}

const InvoicesList = () => {
  const navigate = useNavigate()
  const { settings } = useStore()
  const empresaActiva = useStore(s => s.empresaActiva)

  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)

  /**
   * Las sucursales que ya aparecieron en algún resultado de esta sesión.
   *
   * Se acumulan y no se reemplazan: filtrando por una sucursal, la respuesta
   * solo trae esa, y sin acumular las demás desaparecerían del selector —con
   * lo cual no habría forma de volver a cambiarlas—.
   */
  const [sucursalesVistas, setSucursalesVistas] = useState([])

  /**
   * Las opciones del filtro: las sucursales activas más las que aparezcan en
   * el resultado aunque estén dadas de baja.
   *
   * `empresaActiva.puntosDeVenta` solo trae las ACTIVAS: la API las filtra por
   * `is_active` en los cuatro lugares donde arma esa lista. Sin las del
   * resultado, una venta de un local cerrado llegaría con un
   * `punto_de_venta_id` que la pantalla no puede nombrar, y sus ventas
   * quedarían inalcanzables. Una sucursal cerrada no puede hacer desaparecer
   * sus ventas.
   */
  const opcionesDeSucursal = useMemo(() => {
    const porId = new Map()

    for (const pv of empresaActiva?.puntosDeVenta || []) {
      porId.set(String(pv.id), { id: pv.id, name: pv.name, is_active: true })
    }

    for (const s of sucursalesVistas) {
      if (!porId.has(String(s.id))) porId.set(String(s.id), s)
    }

    return [...porId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
  }, [empresaActiva?.puntosDeVenta, sucursalesVistas])

  // ── El rango ──
  //
  // Arranca VACÍO a propósito. El «hoy» lo calcula el servidor con la zona
  // horaria de la empresa y lo devuelve en `rango`; la pantalla inicializa sus
  // campos con eso. Calcularlo acá con `new Date().toISOString()` devuelve UTC:
  // en Argentina (UTC−3), después de las 21:00 «hoy» pasa a ser mañana y una
  // venta recién cobrada no aparece en su propio listado.
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  // Lo que efectivamente se le pidió a la API. Los filtros de arriba se copian
  // acá solo cuando son válidos: un rango invertido avisa y NO consulta.
  const [consulta, setConsulta] = useState({ page: 1 })

  const [sales, setSales] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPeriodo, setTotalPeriodo] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [voiding, setVoiding] = useState(null)
  const [imprimiendo, setImprimiendo] = useState(null)
  const [exportando, setExportando] = useState(false)
  // El panel guarda el id de la fila abierta y el detalle que trajo la API. El
  // listado NO se toca mientras tanto: cerrar el panel tiene que dejar la
  // página, los filtros, el orden y el scroll donde estaban.
  const [ventaAbierta, setVentaAbierta] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [facturando, setFacturando] = useState(false)
  // Una Factura A necesita el CUIT del comprador. Cuando la API lo pide, el
  // panel muestra un campo en vez de un error.
  const [pidiendoCuit, setPidiendoCuit] = useState(false)
  const [cuit, setCuit] = useState('')
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const { can } = usePermission()

  /**
   * La sucursal que decide la cabecera `X-Punto-De-Venta-Id`, o `null` cuando
   * no decide nada.
   *
   * Existe para que cambiar la sucursal en el encabezado VUELVA A CONSULTAR.
   * La sucursal del encabezado viaja como cabecera y no como parámetro, así
   * que `consulta` no cambia y el listado se quedaba mostrando la sucursal
   * anterior — mientras el `<select>` de la pantalla ya mostraba la nueva y
   * «Exportar» ya mandaba la cabecera nueva. La tabla, el total de arriba y el
   * `.xlsx` podían estar hablando de sucursales distintas, y ninguna de las
   * tres decía cuál.
   *
   * Vale `null` en cuanto el usuario elige una sucursal explícita en el filtro
   * de la pantalla —«Todas» incluido—: ahí manda el filtro (FR-072), el
   * parámetro viaja en la query y la cabecera ya no cambia el resultado.
   * Volver a consultar por un cambio que la API va a ignorar sería un pedido
   * al pedo.
   */
  const sucursalDeLaCabecera = consulta.punto_de_venta_id === undefined
    ? (puntoDeVentaActivo?.id ?? null)
    : null

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getSales({ ...consulta, limit: FILAS_POR_PAGINA })

      if (res.data.ok) {
        setSales(res.data.data)
        setTotal(res.data.total || 0)
        // El total del período llega como NÚMERO: el DECIMAL vuelve como
        // string del driver de Postgres y la API le hace parseFloat.
        setTotalPeriodo(res.data.total_periodo || 0)
        setTotalPages(res.data.totalPages || 1)

        // Las sucursales presentes en el resultado, para que el filtro pueda
        // nombrar también las que están dadas de baja.
        if (Array.isArray(res.data.sucursales) && res.data.sucursales.length) {
          setSucursalesVistas((vistas) => {
            const porId = new Map(vistas.map((s) => [String(s.id), s]))
            for (const s of res.data.sucursales) porId.set(String(s.id), s)
            return [...porId.values()]
          })
        }

        // Primera carga: los campos de fecha se inicializan con el rango que
        // aplicó el servidor, que es el «hoy» del negocio en la zona horaria
        // de la empresa.
        //
        // Solo se tocan los CAMPOS y no `consulta`: la consulta que acabamos
        // de hacer ya es esa, y volver a armarla con las mismas fechas pediría
        // el listado dos veces en cada carga de la pantalla.
        const rango = res.data.rango
        if (rango && !consulta.desde && !consulta.hasta) {
          setDesde(rango.desde)
          setHasta(rango.hasta)
        }
      }
    } catch (err) {
      toast.error('Error al cargar los comprobantes: ' + (err.response?.data?.message || err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
    // `sucursalDeLaCabecera` no se usa en el cuerpo a propósito: la manda el
    // interceptor de axios como cabecera. Está acá para que un cambio de
    // sucursal en el encabezado rearme `fetchSales` y vuelva a consultar; sin
    // esta dependencia, la tabla y el total se quedan en la sucursal anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, sucursalDeLaCabecera])

  useEffect(() => { fetchSales() }, [fetchSales])

  /**
   * Aplica un cambio de filtro.
   *
   * Cambiar cualquier filtro vuelve a la página 1: si no, estando en la 5 y
   * aplicando un filtro cuyo resultado tiene 2 páginas, la pantalla queda en
   * una página que no existe y se ve vacía sin motivo.
   */
  const aplicarFiltro = (cambios) => {
    setConsulta((actual) => {
      const nueva = { ...actual, ...cambios, page: 1 }

      // Devolver la MISMA referencia cuando nada cambió hace que React no
      // re-renderice y que la consulta no se repita. Sin esto, el rebote de la
      // búsqueda dispararía un pedido igual al inicial en cada carga de la
      // pantalla. (`JSON.stringify` ignora las claves en `undefined`, que es
      // justo como se representa «este filtro no está puesto».)
      return JSON.stringify(actual) === JSON.stringify(nueva) ? actual : nueva
    })
  }

  // ── La búsqueda corre en el SERVIDOR ──
  //
  // Antes se filtraban en memoria las filas de la página cargada, así que un
  // CAE que estaba en la página 4 no aparecía y la pantalla decía «no hay
  // ventas». Ahora `q` viaja a la API, que busca sobre todo el resultado del
  // rango: número de comprobante, CAE, el nombre libre de la venta y el de la
  // ficha del cliente.
  //
  // Con un rebote de 350 ms: sin él, escribir «vega» son cuatro consultas y
  // cada una es un iLike '%…%' que no usa índice.
  useEffect(() => {
    const rebote = setTimeout(() => {
      aplicarFiltro({ q: searchQuery.trim() || undefined })
    }, 350)

    return () => clearTimeout(rebote)
  }, [searchQuery])

  /**
   * Cambia el rango de fechas.
   *
   * Valida ANTES de consultar: un rango invertido o de más de un año avisa y
   * NO consulta. Pedirlo igual es un scan de todas las ventas históricas de la
   * empresa para terminar en un error que ya se sabía de antemano. La API
   * valida lo mismo, pero eso es la red de abajo y no el camino normal.
   *
   * Los campos se actualizan siempre, aunque el rango no sirva todavía: si no,
   * elegir un «desde» posterior al «hasta» actual dejaría el campo sin
   * cambiar y el usuario no podría corregirlo.
   */
  const cambiarRango = (nuevoDesde, nuevoHasta) => {
    setDesde(nuevoDesde)
    setHasta(nuevoHasta)

    const problema = problemaDelRango(nuevoDesde, nuevoHasta)

    if (problema) {
      // Un id fijo para que tocar dos veces el campo no apile dos avisos.
      toast.error(problema, { id: 'rango-invalido' })
      return
    }

    aplicarFiltro({ desde: nuevoDesde || undefined, hasta: nuevoHasta || undefined })
  }

  /**
   * Abre el panel de detalle de una fila.
   *
   * El detalle se pide aparte porque el listado no trae ítems ni el texto del
   * rechazo de AFIP: es texto largo que solo se muestra acá.
   */
  const abrirPanel = async (venta) => {
    setVentaAbierta(venta.id)
    setDetalle(null)
    // El pedido de CUIT es de la venta anterior: arrastrarlo a la siguiente
    // haría que el panel abriera pidiendo un dato que nadie pidió.
    setPidiendoCuit(false)
    setCuit('')
    setCargandoDetalle(true)
    try {
      const res = await getSale(venta.id)
      setDetalle(res.data.data)
    } catch (err) {
      toast.error('No se pudo abrir el comprobante: ' + (err.response?.data?.error || err.message))
      setVentaAbierta(null)
    } finally {
      setCargandoDetalle(false)
    }
  }

  const cerrarPanel = (abierto) => {
    if (abierto) return
    setVentaAbierta(null)
    setDetalle(null)
    // A propósito NO se recarga el listado: el panel solo lee.
  }

  /**
   * Relee una venta de la base y actualiza con eso el panel y su fila.
   *
   * El estado nuevo se relee del servidor y no se deduce acá: la derivación de
   * los cinco estados vive en un solo lugar, y ese lugar es la API. Deducirlo
   * en la pantalla es como el badge y la columna «Estado» del archivo
   * exportado terminan diciendo cosas distintas.
   *
   * La FILA se parcha en el lugar, sin volver a pedir el listado: recargar
   * perdería la página, el orden y el scroll, que es justo lo que esta
   * pantalla tiene que conservar.
   */
  const sincronizarVenta = async (id) => {
    try {
      const res = await getSale(id)
      const actualizada = res.data.data

      setDetalle((actual) => (actual && actual.id === id ? actualizada : actual))

      setSales((filas) => filas.map((f) => (f.id === id ? {
        ...f,
        afip_cae: actualizada.afip_cae,
        afip_nro: actualizada.afip_nro,
        afip_pv: actualizada.afip_pv,
        afip_type: actualizada.afip_type,
        afip_vto: actualizada.afip_vto,
        status: actualizada.status,
        estado: actualizada.estado,
      } : f)))

      return actualizada
    } catch {
      // Que falle el refresco no puede tapar el resultado de la operación que
      // lo disparó: el usuario ya vio si se emitió o si lo rechazaron.
      return null
    }
  }

  /**
   * Reintenta la facturación de una venta que quedó sin CAE.
   *
   * El body va VACÍO: el servidor resuelve el tipo de comprobante desde la
   * condición fiscal de la empresa, el CUIT desde la ficha del cliente de la
   * venta y el punto de venta desde la venta o la configuración. Reconstruir
   * esas reglas fiscales acá serían dos implementaciones de lo mismo, y la del
   * navegador es la que se puede editar desde la consola.
   *
   * El único caso en que la pantalla manda algo es el CUIT que el usuario
   * acaba de tipear después de un CUIT_REQUERIDO.
   */
  const reintentarFacturacion = async (venta, extra = {}) => {
    // Un segundo clic mientras el pedido está en vuelo no puede disparar un
    // segundo pedido: serían dos comprobantes para la misma venta si la API no
    // fuera idempotente, y aun siéndolo es un viaje al pedo a ARCA.
    if (facturando) return

    setFacturando(true)
    try {
      await api.post(`/sales/${venta.id}/facturar`, extra)

      const actualizada = await sincronizarVenta(venta.id)

      setPidiendoCuit(false)
      setCuit('')
      toast.success('Comprobante emitido: CAE ' + ((actualizada && actualizada.afip_cae) || ''))
    } catch (err) {
      const status = err.response?.status
      const codigo = err.response?.data?.error

      // ── CUIT faltante: no es un error, es un dato que falta ──
      //
      // Mostrarlo como error crudo deja al usuario con un mensaje y sin
      // salida. Se pide el CUIT ahí mismo y se reintenta en el mismo paso.
      if (status === 400 && codigo === 'CUIT_REQUERIDO') {
        setPidiendoCuit(true)
        return
      }

      // ── AFIP rechazó (502) ──
      //
      // El mensaje va TAL CUAL: el usuario necesita el motivo del rechazo para
      // poder corregirlo, y traducirlo a «hubo un error» lo deja sin nada. La
      // venta queda Rechazada con el error guardado —eso ya lo hizo la API— y
      // el botón vuelve a estar disponible.
      toast.error(codigo || err.message)

      // Lo que se muestra sale de la BASE y nunca de lo que quedó en el
      // navegador: si AFIP contesta después del timeout del cliente, el estado
      // local diría una cosa y la base otra.
      await sincronizarVenta(venta.id)
    } finally {
      setFacturando(false)
    }
  }

  /** Imprime a partir de un detalle YA cargado (el que muestra el panel). */
  const imprimirDetalle = (sale) => {
    const isAfip = !!sale.afip_cae
    const formattedItems = (sale.items || []).map(item => ({
      qty: item.quantity, name: item.product_name, price: item.unit_price,
    }))

    // El nombre del cliente sale de la ficha o del nombre libre guardado en la
    // venta. Antes se parseaba `notes` buscando "Cliente:", que es donde el POS
    // lo metía por no tener dónde: ahora va en customer_name.
    //
    // Las ventas YA REGISTRADAS conservan el "… - Cliente: X" viejo y no se
    // migran: van a imprimir «Consumidor Final». Reconstruirlo exigiría parsear
    // texto libre y adivinar, que es peor que no hacerlo.
    const customerStr = nombreDelCliente(sale)

    printInvoice({
      isInternal: !isAfip,
      typeStr: isAfip ? 'FACTURA' : (sale.notes?.split('-')[0]?.trim() || 'COMPROBANTE'),
      type: sale.afip_type,
      // El punto de venta estaba fijo en 1: si el comercio factura con otro,
      // el numero impreso y el QR salian con un PV que no es el suyo.
      pointOfSale: isAfip ? (settings.afip_pv || 1) : 0,
      voucherNumber: sale.afip_nro || identificadorCorto(sale.id),
      date: new Date(sale.date + 'T' + sale.time).toLocaleString('es-AR'),
      // El QR necesita la fecha en formato ISO, no la version legible.
      fechaIso: sale.date,
      customer: customerStr, items: formattedItems, total: sale.total,
      cae: sale.afip_cae, expiration: sale.afip_vto,
      // Datos fiscales del emisor. Antes se mandaba empresaActiva?.nombre, pero
      // la API devuelve el campo como `name`: el nombre del comercio nunca se
      // llego a imprimir.
      empresa: empresaActiva,
      empresaNombre: empresaActiva?.name,
    })
  }

  /**
   * Imprime desde una fila del listado.
   *
   * Pide el detalle antes de imprimir: el listado ya NO trae los ítems —
   * ninguna de las siete columnas los muestra y ese include costaba una
   * subconsulta por página—, así que sin este viaje `sale.items` sería
   * undefined y el comprobante saldría vacío. Es una impresión por vez, así
   * que el viaje extra no se nota.
   */
  const handlePrint = async (venta) => {
    setImprimiendo(venta.id)
    try {
      const res = await getSale(venta.id)
      imprimirDetalle(res.data.data)
    } catch (err) {
      toast.error('No se pudo abrir el comprobante: ' + (err.response?.data?.error || err.message))
    } finally {
      setImprimiendo(null)
    }
  }

  /**
   * Consulta el comprobante contra AFIP.
   *
   * El punto de venta sale de la VENTA y no de la configuración. La numeración
   * de AFIP es correlativa por punto de venta: consultando con otro pv, o no
   * aparece nada, o —peor— aparece el comprobante de otro número. Antes se
   * usaba siempre `settings.afip_pv`, así que una venta emitida con otro punto
   * de venta se verificaba contra el equivocado.
   *
   * Se cae a `settings.afip_pv` solo si la venta no lo tiene guardado: son los
   * comprobantes anteriores a la migración que agregó `sales.afip_pv`.
   */
  const handleVerifyAfip = async (sale) => {
    if (!sale.afip_cae) return
    try {
      const pv = sale.afip_pv || settings.afip_pv || 1
      const res = await api.get(`/afip/invoice/${sale.afip_type}/${pv}/${sale.afip_nro}/data`)
      const d = res.data.data
      toast.success(
        `Comprobante validado - CAE: ${d.CodAutorizacion} - Vto: ${d.FchVto}`
      )
    } catch (err) {
      toast.error('Error al consultar AFIP: ' + (err.response?.data?.error || err.message))
    }
  }

  const handleVoid = async (sale) => {
    const confirmed = await confirm(
      `¿Anular la venta ${sale.afip_nro ? `Nro ${sale.afip_nro}` : identificadorCorto(sale.id)}? Se restaurará el stock.`
    )
    if (!confirmed) return

    setVoiding(sale.id)
    try {
      await api.put(`/sales/${sale.id}/void`)
      toast.success('Venta anulada y stock restaurado')
      fetchSales()

      // Si la venta anulada es la que está abierta, el panel tiene que mostrar
      // el estado nuevo: si no, sigue ofreciendo anular algo ya anulado.
      if (ventaAbierta === sale.id) {
        const res = await getSale(sale.id)
        setDetalle(res.data.data)
      }
    } catch (err) {
      // Un 400 es una condición prevista y su mensaje está escrito para que lo
      // lea el usuario —«esta venta tiene un CAE y sigue vigente ante ARCA»—.
      // Prefijarlo con «Error al anular» lo convierte en un problema técnico.
      const mensaje = err.response?.data?.error || err.message
      if (err.response?.status === 400) toast.error(mensaje)
      else toast.error('Error al anular: ' + mensaje)
    } finally {
      setVoiding(null)
    }
  }

  /**
   * La sucursal que está mostrando el filtro.
   *
   * Mientras el usuario no lo toque, el valor sale del selector del encabezado
   * y NO se manda como parámetro: la API respeta la cabecera cuando el
   * parámetro no viene. Apenas el usuario elige algo —incluido «Todas»— el
   * parámetro viaja y manda sobre la cabecera. Antes la cabecera pisaba el
   * parámetro en silencio, así que con una sucursal activa en el encabezado
   * no había forma de ver el total de todas.
   */
  const sucursalElegida = consulta.punto_de_venta_id !== undefined
    ? String(consulta.punto_de_venta_id)
    : (puntoDeVentaActivo?.id ? String(puntoDeVentaActivo.id) : TODAS_LAS_SUCURSALES)

  // Los dos vacíos son distintos y dicen cosas distintas: «no hubo ventas en el
  // período» es una situación normal de un martes tranquilo; «ninguna coincide
  // con los filtros» es algo que el usuario puede deshacer.
  const hayFiltros = searchQuery.trim() !== ''
    || sucursalElegida !== TODAS_LAS_SUCURSALES
    || !!consulta.tipo

  /** El nombre de la sucursal filtrada, para el nombre del archivo. */
  const nombreDeLaSucursal = sucursalElegida === TODAS_LAS_SUCURSALES
    ? null
    : (opcionesDeSucursal.find(s => String(s.id) === sucursalElegida)?.name || null)

  /**
   * Baja el listado filtrado como `.xlsx`.
   *
   * Los dos avisos se dan ANTES de pedir nada, comparando contra el `total`
   * que ya trajo el listado: pedir 6.000 comprobantes para descartarlos es un
   * viaje al pedo, y descargar un archivo con solo los encabezados es peor que
   * decir que no hay nada.
   *
   * El archivo trae TODO el resultado del filtro y no las 25 filas visibles:
   * por eso sale por un endpoint propio y no paginando el listado.
   */
  const exportar = async () => {
    if (total === 0) {
      toast.error('No hay comprobantes para exportar con estos filtros.')
      return
    }

    if (total > LIMITE_EXPORT) {
      toast.error(
        `El filtro devuelve ${total} comprobantes y el máximo por archivo es ` +
        `${LIMITE_EXPORT}. Acotá el rango de fechas o elegí una sucursal.`
      )
      return
    }

    setExportando(true)
    try {
      // `page` y `limit` no aplican: el export no pagina.
      const { page, limit, ...filtros } = consulta // eslint-disable-line no-unused-vars
      const res = await exportSales(filtros)

      descargarVentas(res.data.data || [], {
        desde: consulta.desde || desde,
        hasta: consulta.hasta || hasta,
        sucursal: nombreDeLaSucursal,
      })
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.error || err.message)
    } finally {
      setExportando(false)
    }
  }

  const limpiarFiltros = () => {
    setSearchQuery('')
    aplicarFiltro({ punto_de_venta_id: TODAS_LAS_SUCURSALES, tipo: undefined, q: undefined })
  }

  /**
   * El pie del panel.
   *
   * Lo arma la pantalla y no el panel: qué acción corresponde depende del
   * estado de la venta y de los permisos del usuario, y el panel no tiene por
   * qué conocer ninguna de las dos cosas.
   */
  const accionesDelPanel = detalle ? (
    <>
      {/* Sobre una venta ya anulada no hay nada que ofrecer: ni anulación ni
          reintento. */}
      {detalle.status !== 'voided' && can('ventas.anular') && (
        <div className="flex flex-col items-end gap-1">
          <button
            className={`${BOTON_SECUNDARIO} text-danger hover:bg-danger-soft`}
            // DESHABILITADA con la explicación, no ausente: ausente deja al
            // usuario sin entender por qué en unas ventas está y en otras no.
            // El bloqueo real está en la API —sin él un curl sigue pudiendo
            // anular—; esto es la cortesía, no la barrera.
            disabled={!!detalle.afip_cae || voiding === detalle.id}
            onClick={() => handleVoid(detalle)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Anular venta
          </button>

          {detalle.afip_cae && (
            <p className="max-w-[42ch] text-right text-[11.5px] text-fg-3">
              No se puede anular: el comprobante tiene CAE y sigue vigente ante
              ARCA. Hace falta una nota de crédito, que el sistema todavía no
              emite.
            </p>
          )}
        </div>
      )}

      {detalle.afip_cae ? (
        <button className={BOTON_PRINCIPAL} onClick={() => handleVerifyAfip(detalle)}>
          <ShieldCheck className="h-4 w-4" />
          Verificar en AFIP
        </button>
      ) : (
        // Se ofrece sobre cualquier venta activa sin CAE, no solo sobre las
        // rechazadas: una venta interna también se puede facturar después.
        // Sobre una venta que YA tiene CAE no se ofrece — la respuesta
        // idempotente de la API es la red de seguridad, no el camino normal.
        detalle.status === 'active' && can('ventas.crear') && (
          pidiendoCuit ? (
            /* El CUIT que faltaba se pide acá y se reintenta en el mismo paso.
               Es el único caso en que la pantalla manda algo en el body. */
            <div className="flex w-full flex-col gap-2">
              <p className="text-[12.5px] text-fg-2">
                Una Factura A necesita el CUIT del comprador (11 dígitos).
              </p>
              <div className="flex gap-2">
                <input
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value)}
                  inputMode="numeric"
                  placeholder="20123456789"
                  className="num h-[34px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-3
                             text-[13px] transition-colors focus-visible:border-brand focus-visible:outline-none"
                />
                <button
                  className={BOTON_PRINCIPAL}
                  disabled={facturando || cuit.replace(/\D/g, '').length !== 11}
                  onClick={() => reintentarFacturacion(detalle, { customerCuit: cuit.replace(/\D/g, '') })}
                >
                  {facturando
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Facturando…</>
                    : 'Facturar'}
                </button>
              </div>
            </div>
          ) : (
            <button
              className={BOTON_PRINCIPAL}
              disabled={facturando}
              onClick={() => reintentarFacturacion(detalle)}
            >
              {facturando
                ? <><Loader2 className="h-4 w-4 animate-spin" />Facturando…</>
                : <><RefreshCw className="h-4 w-4" />Reintentar facturación</>}
            </button>
          )
        )
      )}
    </>
  ) : null

  return (
    <>
      <div className="anim-subida flex flex-col gap-6">

        {/* ── Encabezado de pantalla ── */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1>Historial de ventas</h1>
            <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">
              Consultá, verificá contra AFIP y reimprimí comprobantes. Hacé clic
              en una fila para ver el detalle completo.
            </p>
          </div>

          {/* Un solo botón principal. «Exportar» es secundario: se usa una vez
              por mes y no es lo que la pantalla invita a hacer. */}
          <div className="flex gap-2">
            {can('ventas.ver') && (
              <button className={BOTON_SECUNDARIO} disabled={exportando} onClick={exportar}>
                {exportando
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-3" />
                  : <Download className="h-3.5 w-3.5 text-fg-3" />}
                Exportar
              </button>
            )}

            <button className={BOTON_PRINCIPAL} onClick={() => navigate('/pos')}>
              <Plus className="h-4 w-4" />
              Nueva venta
            </button>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
            <input
              placeholder="Buscar por número, CAE o cliente…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13.5px]
                         transition-colors focus-visible:border-brand focus-visible:outline-none"
            />
          </div>

          <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px]">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-fg-3" />
            <input
              type="date"
              aria-label="Desde"
              value={desde}
              onChange={e => cambiarRango(e.target.value, hasta)}
              className="num border-none bg-transparent text-[13px] outline-none"
            />
            <span className="text-fg-3">–</span>
            <input
              type="date"
              aria-label="Hasta"
              value={hasta}
              onChange={e => cambiarRango(desde, e.target.value)}
              className="num border-none bg-transparent text-[13px] outline-none"
            />
          </div>

          <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px]">
            <Store className="h-3.5 w-3.5 text-fg-3" />
            <select
              aria-label="Sucursal"
              value={sucursalElegida}
              onChange={e => aplicarFiltro({ punto_de_venta_id: e.target.value })}
              className="border-none bg-transparent text-[13px] outline-none"
            >
              <option value={TODAS_LAS_SUCURSALES}>Todas las sucursales</option>
              {opcionesDeSucursal.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.is_active === false ? `${s.name} (inactiva)` : s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px]">
            <FileCheck className="h-3.5 w-3.5 text-fg-3" />
            <select
              aria-label="Tipo de comprobante"
              value={consulta.tipo || ''}
              onChange={e => aplicarFiltro({ tipo: e.target.value || undefined })}
              className="border-none bg-transparent text-[13px] outline-none"
            >
              <option value="">Todos los tipos</option>
              <option value="1">Factura A</option>
              <option value="6">Factura B</option>
              <option value="11">Factura C</option>
              {/* Las ventas internas: remitos, recibos X y todo lo que se
                  registró sin pedirle un CAE a ARCA. */}
              <option value="sin_cae">Sin comprobante fiscal</option>
            </select>
          </label>
        </div>

        {/* ── El listado ── */}
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
            <h2>Comprobantes</h2>
            <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
              {total}
            </span>
            <div className="flex-1" />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
            <div className="text-right">
              <p className="num text-[15px] font-semibold leading-none">${pesos(totalPeriodo)}</p>
              {/* La etiqueta no es un detalle: el total incluye las anuladas a
                  propósito, porque el archivo exportado las lleva y su columna
                  Total tiene que sumar lo mismo que muestra la pantalla. Sin
                  decirlo, el número se lee mal. */}
              <p className="mt-1 text-[11.5px] text-fg-3">Total del período (incluye anuladas)</p>
            </div>
          </div>

          {loading && sales.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-fg-2">Cargando comprobantes…</p>
            </div>
          ) : sales.length === 0 ? (
            hayFiltros ? (
              <div className="py-12 text-center">
                <FilterX className="mx-auto h-7 w-7 text-fg-3" />
                <p className="mt-3 font-semibold">No hay resultados con esos filtros.</p>
                <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                  Probá con otro texto, otro tipo de comprobante o todas las
                  sucursales. La búsqueda distingue acentos: «Perez» no
                  encuentra «Pérez».
                </p>
                <button onClick={limpiarFiltros} className={`${BOTON_SECUNDARIO} mt-4`}>
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <div className="py-12 text-center">
                <Receipt className="mx-auto h-7 w-7 text-fg-3" />
                <p className="mt-3 font-semibold">No hubo ventas en el período.</p>
                <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                  Elegí otra fecha, o registrá una venta desde el punto de venta.
                </p>
              </div>
            )
          ) : (
            <>
              <TablaGrid anchoMinimo={ANCHO_MINIMO}>
                <Encabezado columnas={COLUMNAS}>
                  <span>Hora</span>
                  <span>Tipo</span>
                  <span>Comprobante</span>
                  <span>Cliente</span>
                  <span>Estado</span>
                  <span className="text-right">Total</span>
                  <span className="text-right">Acciones</span>
                </Encabezado>

                {sales.map(sale => {
                  const esFiscal = !!sale.afip_cae
                  const estado = sale.estado || {}
                  const presentacion = presentacionDeEstado(estado.codigo)
                  const IconoDeEstado = presentacion.icono
                  const anulada = estaAnulada(estado.codigo)

                  return (
                    <Fila
                      key={sale.id}
                      columnas={COLUMNAS}
                      onClick={() => abrirPanel(sale)}
                      // Una venta anulada sigue estando, pero deja de competir
                      // por la atención con las que valen.
                      className={anulada ? 'opacity-55' : undefined}
                    >
                      <span className="num text-[13px] text-fg-2">{sale.time}</span>

                      {/* Tipo */}
                      <span
                        className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-[3px]
                                    text-xs font-semibold ${
                          esFiscal
                            ? 'border-brand-line bg-brand-soft text-brand'
                            : 'border-border bg-surface-3 text-fg-2'
                        }`}
                        title={esFiscal ? ETIQUETAS_DE_TIPO[sale.afip_type] : 'Sin comprobante fiscal'}
                      >
                        {esFiscal
                          ? <ShieldCheck className="h-3 w-3" />
                          : <FileText className="h-3 w-3" />}
                        {esFiscal ? (ETIQUETAS_DE_TIPO[sale.afip_type] || 'Fiscal') : 'Interno'}
                      </span>

                      {/* Comprobante: número arriba, CAE abajo. Sin comprobante
                          fiscal no hay número —va «—»— y debajo el
                          identificador corto de la operación, como dato
                          secundario y no como si fuera el número. */}
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="num text-[13px] font-semibold">
                          {esFiscal ? numeroDeComprobante(sale) : '—'}
                        </span>
                        <span className="num truncate text-[11px] text-fg-3">
                          {esFiscal ? sale.afip_cae : `op. ${identificadorCorto(sale.id)}`}
                        </span>
                      </span>

                      <span className="truncate text-[13.5px]" title={nombreDelCliente(sale)}>
                        {nombreDelCliente(sale)}
                      </span>

                      {/* Estado: acá va el BADGE y no el importe. Es el defecto
                          2 del relevamiento. */}
                      <span
                        className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-[3px]
                                    text-xs font-semibold ${presentacion.fondo} ${presentacion.linea} ${presentacion.texto}`}
                        title={estado.etiqueta}
                      >
                        {IconoDeEstado && <IconoDeEstado className="h-3 w-3" />}
                        <span className="truncate">{estado.etiqueta}</span>
                      </span>

                      <span className="num text-right text-sm font-semibold">
                        ${pesos(sale.total)}
                      </span>

                      <span className="flex justify-end gap-0.5">
                        <BotonDeFila
                          title="Imprimir"
                          disabled={imprimiendo === sale.id}
                          onClick={() => handlePrint(sale)}
                        >
                          {imprimiendo === sale.id ? <Loader2 className="animate-spin" /> : <Printer />}
                        </BotonDeFila>

                        {esFiscal && !anulada && (
                          <BotonDeFila title="Verificar en AFIP" onClick={() => handleVerifyAfip(sale)}>
                            <ShieldCheck />
                          </BotonDeFila>
                        )}

                        {sale.status !== 'voided' && can('ventas.anular') && (
                          <BotonDeFila
                            // Deshabilitada con el motivo, no ausente: si
                            // desapareciera, el usuario no entendería por qué
                            // en unas filas está y en otras no.
                            title={sale.afip_cae
                              ? 'No se puede anular: el comprobante tiene CAE y sigue vigente ante ARCA'
                              : 'Anular venta'}
                            disabled={voiding === sale.id || !!sale.afip_cae}
                            onClick={() => handleVoid(sale)}
                            className="hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 />
                          </BotonDeFila>
                        )}
                      </span>
                    </Fila>
                  )
                })}
              </TablaGrid>

              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-[12.5px] text-fg-2">
                <span>
                  Mostrando <span className="num">{sales.length}</span> de{' '}
                  <span className="num">{total}</span> comprobantes
                </span>
                <Pagination
                  page={consulta.page}
                  totalPages={totalPages}
                  onPageChange={(n) => setConsulta(c => ({ ...c, page: n }))}
                />
              </div>
            </>
          )}
        </section>
      </div>

      <PanelVenta
        abierto={!!ventaAbierta}
        onOpenChange={cerrarPanel}
        venta={detalle}
        cargando={cargandoDetalle}
        onImprimir={imprimirDetalle}
        acciones={accionesDelPanel}
      />

      <ConfirmDialog />
    </>
  )
}

export default InvoicesList
