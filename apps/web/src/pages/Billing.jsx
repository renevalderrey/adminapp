import React, { useState, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import useStore from '@/store/useStore'
import Fuse from 'fuse.js'
import api, { getCustomers, nuevoIdDeVenta } from '@/services/api'
import { printInvoice } from '@/utils/printInvoice'
import { fechaDeComprobante } from '@/utils/formato'
import { useAtajosDelPos } from '@/hooks/useAtajosDelPos'
import { ATRIBUTO_BUSCADOR, ATRIBUTO_CAMPO, campoLimpiable } from '@/utils/atajosDelPos'
import { buscarEnCatalogo } from '@/utils/busquedaDelPos'
import { calcularVuelto, sugerenciasDeVuelto } from '@/utils/vuelto'
import { llevaVuelto } from '@/utils/mediosDePago'
import { comparacionDelReintento } from '@/utils/reintentoDeVenta'
import { comprobantesDisponibles, comprobanteInicial, desglosarIva } from '@/utils/comprobantes'
import { filaDeStock } from '@/utils/inventario'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import CatalogoDelPos from '@/components/pos/CatalogoDelPos'
import TicketDelPos from '@/components/pos/TicketDelPos'
import { nombreDeRuta } from '@/components/navegacion'

// ════════════════════════════════════════════
//  ADMINAPP · Punto de venta
//
//  Dos columnas: el catálogo a la izquierda ocupando el ancho restante y el
//  ticket a la derecha con 400px fijos. Cada una administra SU PROPIO scroll y
//  el cuerpo de la página no scrollea (FR-002).
//
//  ── Por qué esta pantalla no tiene `h1` ni descripción ──
//
//  Es la ÚNICA del sistema sin encabezado de pantalla, y es a propósito
//  (FR-004): la maqueta los reemplaza por la barra de búsqueda
//  (`maqueta:339-358`) y la miga de pan del `AppTopbar` ya dice «Punto de
//  venta». Sesenta píxeles de alto en la pantalla que se usa ocho horas por día
//  valen más que un título que no informa nada. La excepción está escrita en
//  `docs/REGLAS-DISENO.md`, junto con la del marco de 1320px.
//
//  ── Por qué es la única ruta fuera de `MarcoDePantalla` ──
//
//  Un ticket que scrollea con la página deja de estar visible justo cuando
//  tiene ocho ítems, que es cuando hace falta mirarlo; y un pie de cobro que
//  hay que ir a buscar con la rueda del mouse anula lo que los atajos vienen a
//  resolver. `App.jsx` le da `h-full` a secas y el marco lo aplican las otras
//  diecisiete rutas.
// ════════════════════════════════════════════

const CATEGORIES = [
  'proteina', 'pre', 'amino', 'creatina', 'colageno', 'vitamina',
  'accesorio', 'indumentaria', 'alimento', 'pack', 'otro',
]

const CATEGORIAS = [
  { valor: '', etiqueta: 'Todas' },
  ...CATEGORIES.map((c) => ({ valor: c, etiqueta: c.charAt(0).toUpperCase() + c.slice(1) })),
]

/**
 * El aviso fijo de una venta que quedó registrada y sin comprobante.
 *
 * Se arma desde el error de `POST /sales/:id/facturar` y se distingue
 * `CUIT_REQUERIDO` **por el código y no por el texto** (`sales.js:887-893`):
 * el texto es para el operador y puede cambiar mañana; el código es el
 * contrato. Ese caso es el único reintentable desde acá, porque lo único que
 * falta es un dato del pie de cobro.
 *
 * El mensaje de AFIP va **tal cual** (FR-051): traducirlo pierde el código de
 * ARCA, que es lo que se busca cuando hay que llamar por teléfono.
 */
function avisoDeRechazoDeAfip(error, pendiente) {
  const respuesta = error?.response?.data || {}
  const cuitRequerido = respuesta.error === 'CUIT_REQUERIDO'
  const deAfip = respuesta.message || respuesta.error || error?.message || 'Error desconocido'

  return {
    ...pendiente,
    reintentable: cuitRequerido,
    mensaje: cuitRequerido
      ? `${deAfip} La venta ya quedó registrada: cargá el CUIT acá abajo y reintentá solo la facturación.`
      : `La venta quedó REGISTRADA pero sin comprobante. AFIP respondió: «${deAfip}». `
        + 'Reintentá la facturación desde el historial de ventas.',
  }
}

/**
 * El código de comprobante de AFIP → el nombre que lee el operador.
 *
 * Los mismos tres que ofrece el selector del ticket, indexados por el número
 * que viaja a la API: lo que se confirma tiene que ser lo que se manda, y lo
 * que se manda es `pendiente.tipo`.
 */
const NOMBRE_DEL_COMPROBANTE = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' }

/**
 * Lo que dice la confirmación antes de emitir un comprobante fiscal.
 *
 * ── Por qué no alcanza con «¿Confirmar?» ──
 *
 * Un comprobante emitido consume numeración correlativa y para darlo de baja
 * hace falta una nota de crédito, que el sistema todavía no emite. Preguntar
 * sin decir QUÉ se emite y CONTRA QUÉ ambiente no le da a nadie con qué
 * decidir: es el mismo criterio con el que el hito 5 sacó «Emitir Factura de
 * Prueba» del pie de cobro.
 *
 * La diferencia entre los dos ambientes es lo que decide si el clic va o no
 * va: en producción el comprobante tiene validez fiscal y el número no se
 * devuelve; en homologación no vale nada.
 *
 * ⚠ Hay un texto gemelo en `pages/InvoicesList.jsx`, para el reintento desde
 * el historial. Están separados porque cada pantalla nombra distinto la venta
 * —acá es «la que quedó registrada», allá es un número de comprobante—; lo que
 * NO puede diferir son los dos datos que se dicen.
 */
function textoDeConfirmacionDeEmision({ comprobante, ambiente }) {
  const enProduccion = ambiente === 'production'

  return `Se va a emitir ${comprobante} ante ARCA para la venta que quedó registrada, en `
    + (enProduccion
      ? 'el ambiente de PRODUCCIÓN. El comprobante tiene validez fiscal y consume un '
        + 'número correlativo: para darlo de baja hace falta una nota de crédito, que el '
        + 'sistema todavía no emite.'
      : 'el ambiente de HOMOLOGACIÓN. El comprobante NO tiene validez fiscal.')
}

/**
 * A partir de cuándo la espera del CAE deja de ser «un momento».
 *
 * Cuatro segundos: por debajo, el aviso parpadea en cada venta normal y deja de
 * significar algo; por encima, el operador ya empezó a dudar. El timeout de
 * ARCA es de 30 s (`afipService.js:26`) y el del navegador de 60
 * (`services/api.js:14`), así que hay margen de sobra.
 */
const UMBRAL_DE_ESPERA_DE_ARCA = 4000

const Billing = () => {
  const {
    products, cart, addToCart, removeFromCart,
    updateCartQty, updateCartMethod, updateCartPrice, clearCart,
    getCartTotal, calculatePrices, initialize,
  } = useStore()
  const brands = useStore(s => s.brands)
  const actualizarProducto = useStore(s => s.actualizarProducto)

  // La pantalla no consultaba el permiso: lo exigían los dos endpoints y el
  // operador sin `ventas.crear` se enteraba recién al apretar cobrar, con un
  // error de la API. Ahora el botón lo dice antes (FR-024).
  const { can } = usePermission()
  const puedeCobrar = can('ventas.crear')

  const [searchQuery, setSearchQuery] = useState('')
  const [customerDoc, setCustomerDoc] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState([])
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)

  // Clientes es uno de los módulos que todavía no se liberan a los clientes
  // finales. El POS tiene que funcionar igual sin él.
  const hayModuloClientes = useStore(s => s.usuario?.es_superadmin) === true
  const [lastInvoice, setLastInvoice] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)

  const { settings } = useStore()
  const isAfipConfigured = Boolean(settings.afip_cuit && settings.afip_pv)

  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const empresaActiva = useStore(s => s.empresaActiva)
  const pvId = puntoDeVentaActivo?.id || empresaActiva?.puntosDeVenta?.[0]?.id || null
  const location = puntoDeVentaActivo?.code || empresaActiva?.puntosDeVenta?.[0]?.code || 'general'

  const [docType, setDocType] = useState(() => comprobanteInicial(settings.tax_condition))
  const [customerVatCondition, setCustomerVatCondition] = useState('5')
  const [customerName, setCustomerName] = useState('')

  // ── Qué comprobantes se pueden emitir ──
  //
  // La lista y el valor inicial salen de `utils/comprobantes.js`, los dos del
  // mismo lugar. Antes el estado inicial decía `afip_c` y la lista de opciones
  // solo ofrecía Factura C cuando la condición era EXACTAMENTE `'Monotributo'`:
  // una empresa `Exento` se veía con «Remito» seleccionado y emitía Factura C.
  // Lo que se veía y lo que se emitía eran cosas distintas, y mandaba la que no
  // se veía (defecto 1, FR-060).
  const comprobantes = useMemo(
    () => comprobantesDisponibles({
      condicionFiscal: settings.tax_condition,
      afipConfigurado: isAfipConfigured,
    }),
    [settings.tax_condition, isAfipConfigured]
  )

  // FR-061: lo que muestra el selector y lo que se emite son SIEMPRE lo mismo.
  // Si la condición fiscal cambia —o si la empresa configura AFIP— y el valor
  // elegido deja de estar en la lista, se vuelve al inicial en vez de quedar
  // apuntando a un comprobante que el control ya no ofrece.
  useEffect(() => {
    const elegido = comprobantes.find((c) => c.valor === docType)
    if (elegido?.disponible) return

    // Sin AFIP configurado los fiscales existen pero no se pueden emitir, así
    // que el que queda elegido es el primero que SÍ se puede. El aviso de por
    // qué lo dibuja el propio control (FR-055): decirlo acá y no después de
    // haber registrado la venta es toda la diferencia.
    const inicial = comprobantes.find((c) => c.valor === comprobanteInicial(settings.tax_condition))
    const siguiente = inicial?.disponible ? inicial : comprobantes.find((c) => c.disponible)

    if (siguiente && siguiente.valor !== docType) setDocType(siguiente.valor)
  }, [comprobantes, docType, settings.tax_condition])

  useEffect(() => {
    if (docType === 'afip_a') setCustomerVatCondition('1')
    else if (docType === 'afip_b' || docType === 'afip_c') setCustomerVatCondition('5')
  }, [docType])

  useEffect(() => { initialize() }, [initialize])

  // ── El cerrojo contra el doble cobro ──
  //
  // Es un `useRef` y NO estado de React (FR-042, defecto 5). `loading` se leía
  // actualizado recién en el render siguiente: dos eventos de la misma tanda
  // —doble clic, o la tecla en autorrepetición— ejecutaban el mismo handler de
  // la misma copia y los dos leían `false`. Para cuando `disabled` llegaba al
  // DOM, los dos `POST` ya habían salido, y como cada uno generaba su propio
  // `sale_${Date.now()}` ni siquiera chocaban contra la clave primaria: quedaban
  // dos ventas y dos descuentos de stock.
  //
  // Un `ref` es una celda mutable única que sobrevive a los renders: lo que
  // escribe el primer disparo lo ve el segundo en el mismo tick. El `disabled`
  // del botón sigue existiendo para que se VEA que no hay que apretar, no como
  // guardia.
  const cobroEnCurso = useRef(false)

  /** `null` · `'registrando'` · `'facturando'`. Es lo que dibuja el botón. */
  const [pasoDelCobro, setPasoDelCobro] = useState(null)

  /**
   * Los avisos de stock que devolvió el servidor de la última venta.
   *
   * Van agrupados en un bloque FIJO del ticket y no en `toast` (decisión 7 de
   * la spec, FR-066): tres productos sin fila de stock eran cuatro `toast`
   * compitiendo con el verde de éxito, y el que importa —«no se descontó
   * inventario»— se iba solo a los segundos.
   */
  const [avisosDelServidor, setAvisosDelServidor] = useState([])

  /**
   * El medio de pago del ticket, que heredan las líneas nuevas.
   *
   * Es la decisión 3 de la spec, y es como funcionaba el sistema anterior
   * (`legacy:6237-6240`). Antes `addToCart` ponía siempre `'ef'`: un ticket de
   * ocho productos pagado con tarjeta exigía ocho clics en «Tarjeta», y el
   * precio de las líneas que se olvidaran quedaba mal, porque cada nivel tiene
   * otro precio. Cambiar el medio POR LÍNEA lo pisa solo para esa línea.
   */
  const [medioDelTicket, setMedioDelTicket] = useState('ef')

  /** Si la espera del CAE ya pasó el umbral y hay que explicar la demora. */
  const [arcaDemora, setArcaDemora] = useState(false)

  /**
   * La venta que quedó registrada y sin comprobante, si la hay.
   *
   * `null` la mayor parte del tiempo. Es un bloque FIJO del ticket y no un
   * `toast`: cinco segundos no alcanzan para «no se emitió la factura», y el
   * operador tiene que poder leerlo mientras decide qué hacer (FR-051).
   */
  const [avisoDeCobro, setAvisoDeCobro] = useState(null)

  const cobrando = pasoDelCobro !== null
  const totalAmount = getCartTotal()

  // ── El identificador de la venta: uno por ticket, no uno por disparo ──
  //
  // Antes se armaba adentro del handler con `sale_${Date.now()}`, y eso rompía
  // dos cosas distintas:
  //
  //  · Un reintento del MISMO ticket —la red se cortó después de que la venta se
  //    guardó pero antes de que llegara la respuesta— salía con un id nuevo y
  //    registraba una SEGUNDA venta, con su segundo descuento de stock. Con el
  //    id fijo por ticket, el servidor reconoce el reintento (FR-043).
  //  · Dos cajas cobrando en el mismo milisegundo producían el mismo id. Eso lo
  //    resuelve `nuevoIdDeVenta()`, que le agrega 8 hexadecimales.
  //
  // Va en un `useRef` y no en estado porque no se dibuja en ningún lado: no
  // tiene por qué provocar un render.
  const idDelTicket = useRef(nuevoIdDeVenta())

  // Se renueva cuando el ticket queda vacío, que es el único momento en el que
  // empieza otro ticket: después de cobrar, al vaciarlo a mano, o al cambiar de
  // empresa. Renovarlo en cada disparo del cobro es justamente el defecto que
  // esto arregla; no renovarlo nunca haría que el ticket siguiente saliera con
  // el id del anterior y el servidor lo descartara como un reintento.
  useEffect(() => {
    if (cart.length === 0) idDelTicket.current = nuevoIdDeVenta()
  }, [cart.length])

  // ── El foco vive en la búsqueda ──
  //
  // Es el campo en el que escribe el lector de código de barras, así que es
  // donde tiene que estar el cursor al abrir la pantalla y al terminar cada
  // venta. Antes el foco quedaba en el `<body>` y la segunda venta de la fila
  // arrancaba con un clic, que es justo el gesto que los atajos vienen a sacar.
  const buscador = useRef(null)

  // Al montar, y NADA MÁS que al montar. Ver el comentario del `finally` de
  // `handleRegisterSale` para el otro momento en que el foco se fuerza.
  useEffect(() => {
    buscador.current?.focus()
  }, [])

  // La confirmación de `Esc`. `useConfirmDialog` ya resuelve el overlay, la
  // trampa de foco y su propio `Esc`.
  const { confirm, ConfirmDialog } = useConfirmDialog()

  // ── Vuelto ──
  // Con cuánto paga el cliente. Se mantiene como texto y no como número para
  // que el campo pueda quedar vacío: un 0 obligaría a borrarlo antes de tipear.
  const [pagaCon, setPagaCon] = useState('')

  // ── El vuelto solo con efectivo DE VERDAD ──
  //
  // Sale de `llevaVuelto` y no de `i.method === 'ef'` escrito acá: el segmento
  // decide el PRECIO y la bandera decide el vuelto, que son dos ejes distintos.
  // Una transferencia cotiza como efectivo y no lleva vuelto — antes se
  // registraba como `ef`, así que el bloque aparecía cuando no correspondía.
  const hayEfectivo = cart.some((i) => llevaVuelto(i.method))

  // Si ninguna línea queda en efectivo, el importe se DESCARTA y no solo se
  // oculta (FR-067). Antes quedaba guardado y reaparecía con un valor viejo al
  // volver a efectivo: un vuelto calculado sobre un total que ya cambió.
  useEffect(() => {
    if (!hayEfectivo && pagaCon !== '') setPagaCon('')
  }, [hayEfectivo, pagaCon])

  // Las dos cuentas viven en `utils/vuelto.js`. Estaban acá adentro, una en una
  // línea suelta y la otra en un `useMemo`, donde ningún test las alcanzaba: es
  // aritmética con plata y CONVENCIONES obliga a probarla con casos de borde.
  const { vuelto, falta } = calcularVuelto(pagaCon, totalAmount)
  const sugerencias = useMemo(() => sugerenciasDeVuelto(totalAmount), [totalAmount])

  /**
   * Lo disponible del producto en la sucursal activa.
   *
   * Por `punto_de_venta_id` y nunca por el texto `location` (`filaDeStock` de
   * `utils/inventario.js`): dos sucursales distintas pueden haber tenido el
   * mismo texto, y una fila con un `location` que no corresponde a ninguna
   * sucursal no aparecía en ninguna columna.
   */
  const disponibleDe = (product) => filaDeStock(product, pvId)?.available ?? 0

  const baseProducts = useMemo(() => {
    let list = products || []
    if (categoryFilter) list = list.filter(p => p.category === categoryFilter)
    if (brandFilter) list = list.filter(p => p.brand_id === parseInt(brandFilter))
    if (inStockOnly) list = list.filter(p => disponibleDe(p) >= 1)
    return list
  }, [products, categoryFilter, brandFilter, inStockOnly, pvId])

  const fuse = useMemo(() => new Fuse(baseProducts, {
    keys: ['name', 'brand.name', 'category', 'sku', 'barcode'],
    threshold: 0.4,
    distance: 100,
  }), [baseProducts])

  // ── La búsqueda: código exacto → código inexistente → difusa ──
  //
  // `buscarEnCatalogo` resuelve los tres pasos. La lista que se DIBUJA y el
  // producto que agrega `Enter` salen del mismo lugar a propósito: si la lista
  // usara la difusa cruda y el atajo usara esto, el operador vería un producto
  // arriba de todo y `Enter` agregaría otro.
  //
  // La consecuencia visible es la buscada: escanear un código que no está
  // cargado deja la lista vacía en vez de mostrar el producto más parecido.
  const busqueda = useMemo(
    () => buscarEnCatalogo(baseProducts, searchQuery, fuse),
    [fuse, searchQuery, baseProducts]
  )

  const filteredProducts = useMemo(() => {
    return [...busqueda.resultados].sort((a, b) => {
      const aStock = disponibleDe(a) >= 1 ? 1 : 0
      const bStock = disponibleDe(b) >= 1 ? 1 : 0
      if (aStock !== bStock) return bStock - aStock
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [busqueda, pvId])

  /**
   * Las filas ya resueltas que dibuja el catálogo.
   *
   * El componente recibe datos y no productos: no calcula precios, no conoce el
   * store y no sabe qué sucursal está activa. Es lo que permite que la guardia
   * estática de `components/pos/` tenga sentido.
   */
  const filasDelCatalogo = useMemo(() => filteredProducts.map((p) => {
    const { cashPrice, cardPrice, alliancePrice, sinCosto } = calculatePrices(p)
    const disponible = disponibleDe(p)

    return {
      id: p.id,
      nombre: p.name,
      marca: p.brand?.name,
      sku: p.sku,
      disponible,
      agotado: disponible <= 0,
      sinCosto,
      efectivo: cashPrice,
      // `cardPrice` viene en `null` cuando el recargo configurado no deja un
      // precio finito; ahí se muestra el de efectivo, que es lo que se cobra.
      tarjeta: cardPrice === null ? cashPrice : cardPrice,
      alianza: alliancePrice,
    }
  }), [filteredProducts, settings, pvId])

  /**
   * Baja el stock del catálogo con lo que el servidor dice que descontó.
   *
   * Reemplaza a los dos `initialize()` que había al terminar el cobro. Ese
   * disparaba TRES pedidos, ponía `loading: true` global y volvía a traer todos
   * los productos con todas sus filas de stock para actualizar dos o tres: entre
   * una venta y la siguiente la pantalla parpadeaba y el catálogo se redibujaba
   * entero (defecto 4, FR-047).
   *
   * ⚠ Los valores salen del servidor y NO de restar `available - qty` acá. La
   * resta es MENTIRA en el caso que la spec nombra —el producto sin fila de
   * stock, que no se descontó— y también cuando otra caja vendió el mismo
   * producto mientras este ticket estaba abierto. Por eso `POST /api/sales`
   * devuelve la fila leída dentro de su propia transacción, con su
   * `punto_de_venta_id`: es lo que permite reemplazar ESA fila y no la de otra
   * sucursal.
   */
  const aplicarStockDelServidor = (filas) => {
    if (!Array.isArray(filas) || filas.length === 0) return

    for (const fila of filas) {
      const producto = useStore.getState().products.find((p) => p.id === fila.product_id)
      if (!producto) continue

      actualizarProducto({
        id: producto.id,
        stock: (producto.stock || []).map((s) => (
          String(s.punto_de_venta_id) === String(fila.punto_de_venta_id)
            ? { ...s, quantity: fila.quantity, available: fila.available }
            : s
        )),
      })
    }
  }

  /**
   * Las líneas del ticket que ya no entran en el disponible de la sucursal.
   *
   * Se recalcula con `pvId` en las dependencias, y eso resuelve DOS cosas de una
   * (FR-063 y FR-065): superar el disponible se avisa en la pantalla antes de
   * cobrar —y no cuando la API rechace la venta—, y cambiar de sucursal
   * revalida cada línea contra la sucursal nueva sin tocar el ticket. El
   * producto es el mismo; lo que cambia es de dónde sale.
   */
  const excesosDeStock = useMemo(() => cart.flatMap((linea) => {
    const producto = (products || []).find((p) => p.id === linea.id)
    if (!producto) return []

    const disponible = disponibleDe(producto)
    if (linea.qty <= disponible) return []

    return [`«${linea.name}»: hay ${disponible} en esta sucursal y el ticket lleva ${linea.qty}.`]
  }), [cart, products, pvId])

  const handleCustomerSearch = async (query) => {
    setCustomerSearch(query)
    if (query.length < 2) { setCustomerResults([]); return }
    try {
      const res = await getCustomers({ search: query, limit: 10 })
      setCustomerResults(res.data.data || [])
      setShowCustomerSearch(true)
    } catch { setCustomerResults([]) }
  }

  const selectCustomer = (c) => {
    setCustomerId(c.id)
    setCustomerDoc(c.tax_id || '')
    setCustomerName(c.name)
    setCustomerSearch(c.name)
    setShowCustomerSearch(false)
  }

  const clearCustomer = () => {
    setCustomerId(null)
    setCustomerDoc('')
    setCustomerName('')
    setCustomerSearch('')
    setCustomerResults([])
  }

  // ── Orden: PRIMERO se guarda la venta, DESPUES se pide el CAE ──
  //
  // Antes era al revés: se pedía el CAE y después se guardaba. Si el guardado
  // fallaba —red, validación, stock insuficiente— quedaba un comprobante fiscal
  // emitido, con número de AFIP consumido, sin ningún registro en el sistema, y
  // el usuario solo veía un toast rojo.
  //
  // Con este orden el peor caso cambia por completo:
  //   - Falla el guardado  → no se pidió ningún CAE. No hay nada huérfano.
  //   - Falla AFIP         → la venta quedó registrada sin comprobante y se
  //                          puede reintentar. No se pierde la operación.
  /**
   * Todo lo que se limpia al terminar una venta que EXISTE (FR-048).
   *
   * Lo que NO está acá se conserva a propósito (FR-049): el tipo de
   * comprobante, los filtros de categoría y marca, «Solo con stock» y la
   * sucursal activa. En un mostrador se emite el mismo comprobante cincuenta
   * veces seguidas, y resetearlo obliga a volver a elegirlo cincuenta veces.
   */
  const limpiarDespuesDeCobrar = () => {
    clearCart()
    setPagaCon('')
    setCustomerDoc('')
    setCustomerName('')
    setSearchQuery('')
    clearCustomer()
  }

  /** Pide el CAE de una venta ya registrada. NUNCA registra nada. */
  const pedirCae = (ventaId, tipo) => api.post(`/sales/${ventaId}/facturar`, {
    type: tipo,
    customerCuit: customerDoc,
    customerVatCondition,
    pv: settings.afip_pv,
  })

  /**
   * El comprobante que se imprime.
   *
   * ⚠ Las líneas salen de LA VENTA cuando el servidor las devolvió, y solo caen
   * a las de pantalla cuando no vinieron —el alta normal responde la cabecera—.
   * Mezclar las dos fuentes era el defecto: `items` de pantalla con `total` del
   * servidor imprimía **dos unidades con el total de una** después de un
   * reintento del mismo ticket modificado. Un papel que no cierra consigo mismo
   * es peor que no imprimir nada.
   */
  const lineasDelComprobante = (venta, lineasEnPantalla) => (
    Array.isArray(venta.items) ? venta.items : lineasEnPantalla
  )

  const comprobanteImpreso = (venta, afipData, lineasEnPantalla) => {
    const lineas = lineasDelComprobante(venta, lineasEnPantalla)

    if (afipData) {
      return {
        ...afipData,
        items: lineas,
        total: parseFloat(venta.total),
        customer: customerDoc,
        // ⚠ La fecha del NEGOCIO, no el reloj del navegador.
        //
        // Decía `new Date().toLocaleDateString('es-AR')`, o sea la hora de esta
        // computadora en el momento de imprimir. La carga fiscal va a AFIP con
        // la fecha que calcula el servidor en la zona de la empresa, y el QR de
        // este mismo papel usa `venta.date`: un solo comprobante tenía TRES
        // fuentes de fecha. Una máquina con la zona mal puesta, un reloj
        // atrasado, o una venta registrada 23:59 e impresa 00:01 alcanzan para
        // que el papel diga un día y AFIP tenga otro.
        date: fechaDeComprobante(venta.date, venta.time),
        fechaIso: venta.date,
        isInternal: false,
        empresa: empresaActiva,
        empresaNombre: empresaActiva?.name,
      }
    }

    return {
      voucherNumber: venta.id,
      pointOfSale: 0,
      typeStr: docType === 'remito' ? 'REMITO' : 'RECIBO X',
      items: lineas,
      total: parseFloat(venta.total),
      customer: customerName || 'Consumidor Final',
      // Igual que arriba. Un remito o un recibo X no van a AFIP, pero se
      // reimprimen desde el historial —y ahí sale `venta.date`—, así que si acá
      // saliera el reloj del navegador las dos copias del mismo papel podrían
      // decir días distintos.
      date: fechaDeComprobante(venta.date, venta.time),
      isInternal: true,
      empresa: empresaActiva,
      empresaNombre: empresaActiva?.name,
    }
  }

  const handleRegisterSale = async () => {
    if (cart.length === 0) return

    // La mitad que el `disabled` NO cubre: `Ctrl+Enter` no pasa por el botón
    // (escenario 2.17). Sin esto, el atajo manda el pedido igual y el rechazo
    // llega del servidor, que es tarde y confuso.
    if (!puedeCobrar) return

    // El cerrojo se LEE acá y se ESCRIBE como primera línea del `try`. Ver el
    // comentario de `cobroEnCurso`.
    if (cobroEnCurso.current) return

    const isAfip = docType.startsWith('afip_')
    const lineasCobradas = [...cart]
    let avisarDemoraDeArca = null

    try {
      // ⚠ ESTA LÍNEA VA ACÁ Y NO ANTES DEL `try`, y moverla «para que quede más
      // prolijo» reintroduce el riesgo: una excepción lanzada entre la toma del
      // cerrojo y la entrada al bloque dejaría el cerrojo tomado sin que el
      // `finally` lo suelte, y el POS no cobraría más hasta cambiar de pantalla
      // —con el botón habilitado y sin que pase nada al apretarlo, que es el
      // peor síntoma posible en un mostrador—.
      cobroEnCurso.current = true
      setPasoDelCobro('registrando')
      setArcaDemora(false)
      setAvisoDeCobro(null)

      // ── El comprobante de la venta ANTERIOR se olvida acá ──
      //
      // Y no en el final feliz, que es donde estaba implícito. La rama del
      // rechazo de AFIP vacía el ticket y vuelve con un `return` sin tocar
      // `lastInvoice`: quedaban, uno al lado del otro, el aviso rojo «la venta
      // quedó REGISTRADA pero sin comprobante» y el botón verde «Imprimir el
      // comprobante 40» —el de la venta anterior, de otro cliente—, justo
      // cuando el operador está buscando algo que darle al que tiene enfrente.
      //
      // Un comprobante fiscal ajeno entregado al cliente equivocado no se
      // deshace: hay que emitir una nota de crédito. Se limpia al EMPEZAR el
      // cobro porque así lo cubren los cuatro finales de una sola vez, sin
      // repetirlo en cada `return`, que es como se olvida uno.
      setLastInvoice(null)

      if (isAfip && !isAfipConfigured) {
        // ⚠ «Ajustes» NO es ninguna pantalla: se llama «Facturación AFIP», y
        // el nombre sale de la barra lateral para que no puedan separarse.
        // Este mensaje aparece en el pie del cobro, con un cliente enfrente:
        // mandarlo a buscar una pantalla que no existe es el peor momento
        // posible para hacerlo.
        throw new Error(`AFIP no está configurado. Revisá ${nombreDeRuta('/facturacion')}.`)
      }

      // ── 1. Guardar la venta ──
      // La fecha y la hora ya NO se mandan: las decide el servidor en la zona
      // horaria del negocio. toISOString() devuelve UTC, y en Argentina
      // (UTC-3) una venta de las 21:30 quedaba asentada al dia siguiente.
      const salePayload = {
        // El id sale del ref del ticket, NO de un `Date.now()` de acá adentro:
        // ver el comentario de `idDelTicket`.
        id: idDelTicket.current,
        // El medio del TICKET y no `cart[0]?.method`: con nueve medios, más
        // tickets van a quedar clasificados como mixtos —`metodoDePago` del
        // servidor devuelve el método solo si TODAS las líneas coinciden— y
        // entonces el servidor cae al declarado. «Con qué se pagó esta venta»
        // se contesta con el medio vigente del pie, no con el de la primera
        // línea que alguien agregó.
        payment_method: medioDelTicket,
        items: cart,
        total: totalAmount,
        location,
        // `notes` es para observaciones, que es para lo que existe. Antes se le
        // metía adentro el nombre del cliente —"REMITO - Cliente: Perez"—
        // porque el backend solo guardaba customer_name cuando había ficha.
        // Metido ahí, el nombre no lo encuentra ninguna búsqueda del historial
        // y la columna Cliente no lo puede leer: la venta figuraba como
        // «Consumidor final» aunque el operador hubiera escrito el nombre.
        notes: isAfip ? '' : (docType === 'remito' ? 'REMITO' : 'RECIBO X'),
        // Se manda siempre, haya ficha o no. El backend lo recorta y lo guarda.
        customer_name: customerName || null,
      }
      if (customerId) {
        // Solo la ficha habilita cuenta corriente: un nombre libre no puede
        // generar una deuda sin deudor.
        salePayload.customer_id = customerId
      }

      const ventaRes = await api.post('/sales', salePayload)
      const venta = ventaRes.data.data

      // El backend avisa cuando no pudo descontar stock de algún producto. Va
      // al bloque fijo del ticket y no a `toast`: es lo que hay que leer
      // DESPUÉS de que el verde de éxito ya se fue.
      setAvisosDelServidor(ventaRes.data.warnings || [])

      // El catálogo se actualiza acá y no al final: la venta ya está registrada
      // y su stock ya se descontó, así que lo que muestra la pantalla tiene que
      // decir la verdad aunque el CAE después falle.
      aplicarStockDelServidor(ventaRes.data.stock)

      // ── El reintento que el servidor reconoce, pero con OTRO contenido ──
      //
      // `200 { yaRegistrada: true }` significa «ya tengo una venta con este
      // id», y el id es uno por TICKET (FR-043). Aceptarlo sin mirar es cómo se
      // entregan dos unidades habiendo registrado y descontado una: la red se
      // corta después del commit, el operador lee «Error» y entiende que no se
      // registró nada, el cliente pide otra unidad, se vuelve a cobrar con el
      // mismo id y vuelve la venta VIEJA. El motivo largo está en
      // `utils/reintentoDeVenta.js`.
      //
      // El ticket NO se vacía: nada de lo que hay en pantalla quedó registrado
      // como tal, así que es el final (c) y no el (b) —vaciarlo tiraría la única
      // evidencia de lo que se estaba por cobrar, y además renovaría el id, con
      // lo cual el intento siguiente registraría las dos unidades ENTERAS sobre
      // la que ya se descontó—. Lo que corresponde es que el operador vea los
      // dos contenidos y lo resuelva desde el historial.
      //
      // Y no se pide el CAE: un comprobante fiscal por $1.500 mientras la
      // pantalla dice $3.000 es exactamente el papel que no cierra.
      if (ventaRes.data.yaRegistrada) {
        const { coincide, diferencias } = comparacionDelReintento(venta, {
          lineas: lineasCobradas,
          total: totalAmount,
        })

        if (!coincide) {
          setAvisoDeCobro({
            reintentable: false,
            mensaje: `La venta ${venta.id} YA estaba registrada, y con OTRO contenido: `
              + 'lo que quedó asentado no es lo que hay en pantalla. Este ticket no se '
              + 'registró de nuevo y sigue acá. Resolvelo desde el historial de ventas, '
              + 'y vaciá el ticket para empezar una operación nueva.',
            detalles: diferencias,
          })
          return
        }
      }

      // ── 2. Pedir el CAE, si corresponde ──
      let afipData = null

      // `200 { yaRegistrada: true }` es un reintento del MISMO ticket que el
      // servidor reconoció: la venta ya está y su stock ya se descontó. Si
      // además ya tiene CAE, pedirlo otra vez sería pedir un comprobante para
      // algo que ya lo tiene, y por eso acá se usa el que vino.
      const yaTieneCae = Boolean(venta.afip_cae)

      if (isAfip && yaTieneCae) {
        afipData = {
          cae: venta.afip_cae,
          expiration: venta.afip_vto,
          voucherNumber: venta.afip_nro,
          type: venta.afip_type,
        }
      } else if (isAfip) {
        const vType = docType === 'afip_a' ? 1 : docType === 'afip_b' ? 6 : 11

        // Registrar la venta y pedir el CAE son DOS esperas distintas, y la
        // segunda puede durar 30 s (`afipService.js:26`). El botón lo dice
        // (FR-045), y pasado el umbral aparece además la línea que explica que
        // la venta YA quedó registrada — sin eso, el operador aprieta de nuevo,
        // que es exactamente lo que el cerrojo viene a hacer innecesario.
        setPasoDelCobro('facturando')
        avisarDemoraDeArca = setTimeout(() => setArcaDemora(true), UMBRAL_DE_ESPERA_DE_ARCA)

        try {
          const res = await pedirCae(venta.id, vType)
          afipData = res.data.data
        } catch (errAfip) {
          // ── Final (b): la venta se registró y AFIP la rechazó ──
          //
          // El aviso NO es un `toast` (FR-051): «no se emitió la factura» no
          // entra en cinco segundos. Queda fijo en el ticket hasta que el
          // operador lo cierre.
          //
          // Y el ticket SE VACÍA igual (FR-052): la operación existe, y dejarlo
          // cargado invita a cobrarla de nuevo.
          setAvisoDeCobro(avisoDeRechazoDeAfip(errAfip, {
            ventaId: venta.id,
            tipo: vType,
            lineas: lineasCobradas,
            total: venta.total,
          }))
          limpiarDespuesDeCobrar()
          return
        }
      }

      // ── 3. Comprobante para imprimir ──
      setLastInvoice(comprobanteImpreso(venta, isAfip ? afipData : null, lineasCobradas))

      toast.success(isAfip
        ? `Factura ${afipData.voucherNumber} registrada. CAE: ${afipData.cae}`
        : 'Venta registrada con éxito')

      // ── Final (a): éxito ──
      limpiarDespuesDeCobrar()
    } catch (err) {
      // ── Final (c): la API rechazó y NO registró nada ──
      //
      // Total inconsistente, ítem inválido, stock insuficiente: el ticket queda
      // INTACTO (FR-053), porque la corrección se hace sobre esas mismas
      // líneas. Confundir este final con el (b) es cómo se cobra dos veces.
      const data = err.response?.data
      toast.error('Error: ' + (data?.message || data?.error || err.message))
    } finally {
      if (avisarDemoraDeArca) clearTimeout(avisarDemoraDeArca)
      cobroEnCurso.current = false
      setPasoDelCobro(null)
      setArcaDemora(false)

      // ── El foco se pide acá, imperativamente, y NO con un efecto ──
      //
      // Los escenarios 3.3 y 3.7 hablan del mismo instante y piden cosas
      // opuestas: «terminó la venta → el foco vuelve a la búsqueda» y «estoy
      // escribiendo el CUIT y llega la respuesta de un pedido en vuelo → el
      // foco no se me mueve».
      //
      // Se resuelve forzando el foco SOLO al terminar la operación de cobro,
      // que es la que además limpia el CUIT: no hay nada que preservar. Los
      // demás pedidos en vuelo —la búsqueda de fichas de cliente— nunca tocan
      // el foco.
      //
      // Un `useEffect` con el estado de la espera en las dependencias haría lo
      // mismo en apariencia y rompería 3.7 la primera vez que el operador tipee
      // un CUIT mientras se resuelve cualquier otra cosa. Es la salida «obvia»
      // y vuelve sola: hay un test que la detiene.
      //
      // Va en el `finally` porque los tres finales —todo bien, AFIP rechaza, la
      // API rechaza— terminan la operación, y en los tres el operador sigue con
      // la venta que viene o corrige el ticket que quedó.
      buscador.current?.focus()
    }
  }

  /**
   * Reintenta SOLO la facturación de una venta que YA está registrada (FR-054).
   *
   * No vuelve a llamar a `handleRegisterSale`: eso mandaría otro `POST /sales`
   * y registraría la operación dos veces. El caso típico es `CUIT_REQUERIDO`
   * —una Factura A sin el CUIT del comprador—, donde lo único que falta es un
   * dato del pie de cobro y la venta ya está asentada.
   */
  const reintentarFacturacion = async () => {
    const pendiente = avisoDeCobro
    if (!pendiente?.reintentable) return
    if (cobroEnCurso.current) return

    // ── El clic que emitía un comprobante fiscal real sin preguntar nada ──
    //
    // Este botón NO es «reintentar la venta»: la venta ya está registrada. Lo
    // único que hace es emitir el comprobante ante ARCA, y eso consume un
    // número correlativo que no se devuelve.
    //
    // Va ANTES de tomar el cerrojo: si se tomara primero, un «Cancelar» tendría
    // que acordarse de soltarlo, y el día que alguien agregue un `return` en el
    // medio el POS deja de cobrar con el botón habilitado.
    const confirmado = await confirm(
      textoDeConfirmacionDeEmision({
        comprobante: NOMBRE_DEL_COMPROBANTE[pendiente.tipo] || 'un comprobante fiscal',
        ambiente: settings.afip_environment,
      }),
      // El rojo aparece SOLO en producción, que es donde el acto es
      // irreversible: consume numeración correlativa de AFIP y no se puede
      // borrar desde acá. En homologación no pasa nada, y pintarlo de rojo
      // igual es exactamente lo que hace que el rojo deje de significar algo.
      { verbo: 'Emitir comprobante', destructivo: settings.afip_environment === 'produccion' }
    )

    if (!confirmado) return

    let avisarDemoraDeArca = null

    try {
      cobroEnCurso.current = true
      setPasoDelCobro('facturando')
      setArcaDemora(false)
      avisarDemoraDeArca = setTimeout(() => setArcaDemora(true), UMBRAL_DE_ESPERA_DE_ARCA)

      const res = await pedirCae(pendiente.ventaId, pendiente.tipo)
      const afipData = res.data.data

      setAvisoDeCobro(null)
      setLastInvoice(comprobanteImpreso(
        { id: pendiente.ventaId, total: pendiente.total },
        afipData,
        pendiente.lineas
      ))
      setCustomerDoc('')
      toast.success(`Factura ${afipData.voucherNumber} registrada. CAE: ${afipData.cae}`)
    } catch (err) {
      setAvisoDeCobro(avisoDeRechazoDeAfip(err, pendiente))
    } finally {
      if (avisarDemoraDeArca) clearTimeout(avisarDemoraDeArca)
      cobroEnCurso.current = false
      setPasoDelCobro(null)
      setArcaDemora(false)
    }
  }

  // ════════════════════════════════════════════
  //  Los cuatro atajos
  //
  //  `atajoDe` decide SI se dispara; acá se decide QUÉ hace cada uno. La
  //  separación es la que permite probar las cuarenta combinaciones de teclas
  //  sin montar la pantalla.
  // ════════════════════════════════════════════

  /** Agrega un producto y devuelve el cursor a la búsqueda (escenario 3.6). */
  const agregarConElMouse = (id) => {
    // El ticket que se está facturando no cambia (FR-046). Se lee el cerrojo y
    // no `cobrando`: un `disabled` en el DOM no impide que la acción llegue por
    // otro camino, y el estado se lee un render tarde.
    if (cobroEnCurso.current) return

    const producto = products.find((p) => p.id === id)
    if (!producto) return

    setAvisosDelServidor([])
    addToCart(producto, medioDelTicket)
    buscador.current?.focus()
  }

  const enfocarBusqueda = () => {
    buscador.current?.focus()
    // Se selecciona lo que haya escrito: `/` en el medio de una búsqueda que no
    // encontró nada sirve para reemplazarla, no para agregarle texto.
    buscador.current?.select?.()
  }

  const agregarPrimero = () => {
    // La otra mitad de FR-046: `Enter` con un escáner en la mano no puede
    // meterle una línea al ticket que ya salió para el servidor.
    if (cobroEnCurso.current) return

    if (busqueda.codigoNoEncontrado) {
      // El aviso apunta al DATO que falta y no al producto: si el catálogo
      // tiene los códigos de barras a medio cargar, el producto puede estar y
      // el código no. Y la consulta NO se borra: borrarla obliga a volver a
      // tipear el código que justamente no existe (escenario 2.5).
      toast.warning('Ningún producto tiene ese código de barras o SKU. Buscalo por nombre en el mismo campo.')
      return
    }

    const primero = filteredProducts[0]

    if (!primero) {
      toast.warning('No hay ningún producto que coincida con la búsqueda.')
      return
    }

    // Lo que el botón no deja hacer, el atajo tampoco (escenario 2.6).
    if (disponibleDe(primero) <= 0) {
      toast.warning(`«${primero.name}» no tiene stock en esta sucursal.`)
      return
    }

    setAvisosDelServidor([])
    addToCart(primero, medioDelTicket)
    // La consulta se vacía y el foco se queda donde estaba —en la búsqueda—
    // para que el escaneo siguiente entre directo.
    setSearchQuery('')
  }

  /**
   * `Esc`, con sus tres casos.
   *
   * Con texto en la búsqueda limpia EL CAMPO y no toca el ticket: en un
   * mostrador `Esc` se aprieta por reflejo para cerrar cualquier cosa, y un
   * ticket de quince líneas con precios negociados a mano no se recupera.
   */
  const limpiar = async (evento) => {
    // ── FR-036, y va PRIMERO ──
    //
    // Con el foco en un campo de texto que no es la búsqueda, `Esc` limpia ESE
    // campo y devuelve el cursor a la búsqueda, sin tocar el ticket. Antes el
    // atajo estaba definido solo sobre la búsqueda: apretar `Esc` en el CUIT o
    // en «Paga con» no limpiaba nada y —si la búsqueda estaba vacía— abría la
    // confirmación de vaciado del ticket, que es exactamente lo contrario.
    //
    // El hook le pasa el evento a la acción justamente para esto: sin él, la
    // pantalla no tiene forma de saber dónde estaba el foco.
    const campo = campoLimpiable(evento)

    if (campo) {
      limpiadoresDeCampo[campo.nombre]?.(campo.linea)
      buscador.current?.focus()
      return
    }

    if (searchQuery) {
      setSearchQuery('')
      buscador.current?.focus()
      return
    }

    // Con el ticket vacío no se abre nada: un diálogo para confirmar que se
    // borre lo que ya está borrado es ruido.
    if (cart.length === 0) return

    const confirmado = await confirm(
      '¿Vaciar el ticket? Se pierden las líneas cargadas y los precios puestos a mano.',
      { verbo: 'Vaciar ticket' }
    )

    if (confirmado) clearCart()

    // ⚠ Este `focus()` no es adorno, y va en los DOS finales. El diálogo
    // devuelve el foco al elemento que lo abrió, y acá no hay elemento: lo
    // abrió una tecla. Sin esto el foco vuelve al `<body>` y el operador tiene
    // que apretar `/` para volver a donde ya estaba.
    buscador.current?.focus()
  }

  /**
   * Qué significa «limpiar» en cada campo del pie de cobro.
   *
   * Se busca por el nombre que el campo declara en `data-campo-del-pos`. En el
   * precio de línea, vaciarlo es además cómo se vuelve al precio de lista, así
   * que `Esc` ahí hace lo mismo que borrar el campo a mano.
   */
  const limpiadoresDeCampo = {
    cuit: () => setCustomerDoc(''),
    pagaCon: () => setPagaCon(''),
    cliente: () => setCustomerName(''),
    fichaDeCliente: () => { setCustomerSearch(''); setCustomerResults([]) },
    precioDeLinea: (linea) => updateCartPrice(Number(linea), ''),
  }

  useAtajosDelPos({
    enfocarBusqueda,
    agregarPrimero,
    cobrar: handleRegisterSale,
    limpiar,
  })

  const vaciarConConfirmacion = async () => {
    if (cart.length === 0) return
    const confirmado = await confirm(
      '¿Vaciar el ticket? Se pierden las líneas cargadas y los precios puestos a mano.',
      { verbo: 'Vaciar ticket' }
    )
    if (confirmado) clearCart()
    buscador.current?.focus()
  }

  const desglose = desglosarIva({
    total: totalAmount,
    condicionFiscal: settings.tax_condition,
    comprobante: docType,
  })

  /**
   * El buscador de fichas de cliente.
   *
   * Va como nodo y no como props del ticket porque es la única pieza de la
   * pantalla condicionada por un módulo no liberado: sin él,
   * `GET /api/customers` responde 404 y el campo quedaría tirando errores en
   * cada tecla. El nombre libre alcanza para el comprobante.
   */
  const buscadorDeClientes = hayModuloClientes ? (
    <div className="relative">
      {/* La lupa, como los otros seis buscadores. Sin ella el campo se lee como
          uno más para completar, y en el pie del cobro —con un cliente
          enfrente— es justo donde no hay tiempo de averiguarlo. */}
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
      <input
        {...{ [ATRIBUTO_CAMPO]: 'fichaDeCliente' }}
        placeholder="Buscar ficha de cliente…"
        value={customerSearch}
        onChange={e => handleCustomerSearch(e.target.value)}
        onFocus={() => customerResults.length > 0 && setShowCustomerSearch(true)}
        className="h-[34px] w-full rounded-lg border border-border bg-surface pl-8 pr-8 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {customerId && (
        <button
          type="button"
          onClick={clearCustomer}
          aria-label="Quitar la ficha de cliente"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-3 hover:text-danger"
        >
          ×
        </button>
      )}
      {showCustomerSearch && customerResults.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-popover shadow-nivel-2">
          {customerResults.map(c => (
            <button
              key={c.id}
              type="button"
              className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-surface-3"
              onClick={() => selectCustomer(c)}
            >
              <span>{c.name}</span>
              <span className="num text-xs text-fg-3">{c.tax_id || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    // El desbordamiento horizontal queda ADENTRO del punto de venta y no en el
    // cuerpo de la página (escenario 1.3): con la ventana por debajo de los
    // 1080px de la maqueta, lo que scrollea es esta zona.
    <div className="h-full overflow-x-auto">
      {/* La confirmación de `Esc`. Se dibuja siempre y se abre sola. */}
      <ConfirmDialog />

      <div className="flex h-full min-h-0 min-w-[1080px]">
        <CatalogoDelPos
          consulta={searchQuery}
          onConsulta={setSearchQuery}
          refBuscador={buscador}
          marcaDelBuscador={{ [ATRIBUTO_BUSCADOR]: '' }}
          categorias={CATEGORIAS}
          categoria={categoryFilter}
          onCategoria={setCategoryFilter}
          marcas={brands}
          marca={brandFilter}
          onMarca={setBrandFilter}
          soloConStock={inStockOnly}
          onSoloConStock={setInStockOnly}
          filas={filasDelCatalogo}
          onAgregar={agregarConElMouse}
          bloqueado={cobrando}
        />

        <TicketDelPos
          lineas={cart}
          onCantidad={updateCartQty}
          onQuitar={removeFromCart}
          onPrecio={updateCartPrice}
          onMedio={updateCartMethod}
          medioDelTicket={medioDelTicket}
          onMedioDelTicket={setMedioDelTicket}
          onVaciar={vaciarConConfirmacion}
          comprobantes={comprobantes}
          comprobante={docType}
          onComprobante={setDocType}
          desglose={desglose}
          total={totalAmount}
          hayVuelto={hayEfectivo}
          pagaCon={pagaCon}
          onPagaCon={setPagaCon}
          sugerencias={sugerencias}
          vuelto={vuelto}
          falta={falta}
          condicionIva={customerVatCondition}
          onCondicionIva={setCustomerVatCondition}
          cuit={customerDoc}
          onCuit={setCustomerDoc}
          nombreCliente={customerName}
          onNombreCliente={setCustomerName}
          buscadorDeClientes={buscadorDeClientes}
          onCobrar={handleRegisterSale}
          // El botón dice EN QUÉ PASO está y no «Procesando…»: registrar la
          // venta tarda lo que tarda la red y pedir el CAE puede tardar 30 s, y
          // el operador que no sabe cuál de las dos está esperando aprieta de
          // nuevo (FR-045).
          textoDeCobro={
            pasoDelCobro === 'registrando' ? 'Registrando la venta…'
              : pasoDelCobro === 'facturando' ? 'Pidiendo el CAE a ARCA…'
                : 'Confirmar venta'
          }
          cobroHabilitado={cart.length > 0 && !cobrando && puedeCobrar}
          motivoDeCobro={puedeCobrar
            ? null
            : 'No tenés el permiso «ventas.crear». Pedíselo a quien administra el equipo.'}
          avisoDeEspera={arcaDemora
            ? 'ARCA está tardando. La venta ya quedó registrada: no vuelvas a apretar.'
            : null}
          // FR-046: lo que se está facturando no puede cambiar mientras se
          // factura. El `disabled` cubre el mouse; el chequeo del cerrojo en
          // `agregarPrimero` y en `agregarConElMouse` cubre el teclado, que es
          // por donde el `disabled` no pasa.
          bloqueado={cobrando}
          comprobanteParaImprimir={lastInvoice}
          onImprimir={() => printInvoice(lastInvoice)}
          avisosDeStock={[...excesosDeStock, ...avisosDelServidor]}
          avisoDeCobro={avisoDeCobro}
          onReintentarFacturacion={reintentarFacturacion}
          onCerrarAviso={() => setAvisoDeCobro(null)}
        />
      </div>
    </div>
  )
}

export default Billing
