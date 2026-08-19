import React, { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import { getStockTransfers, getProducts, marcarPublicables } from '@/services/api'
import { calcularPrecios } from '@favalio/precios'
import {
  TODAS_LAS_CATEGORIAS, TODAS_LAS_SUCURSALES, filaDeStock, filtrarInventario,
  calcularIndicadores, tonoDeStock, sucursalesComparables as calcularSucursalesComparables,
} from '@/utils/inventario'
import { descargarInventario } from '@/utils/exportarInventario'
import { imprimirInventario } from '@/utils/impresionInventario'
// `pesos` y `pesosRedondos` estaban escritos acá. Los dos se mudaron: el
// valorizado sin centavos es una diferencia deliberada y conservó su nombre.
import { cantidad, pesos, pesosRedondos } from '@/utils/formato'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Package, Plus, Search, Edit2, ArrowRightLeft, FileSpreadsheet, Loader2, Tags, X,
  FilterX, AlertTriangle, Archive, SlidersHorizontal, Download, Printer, Globe,
} from 'lucide-react'
import { Can } from '@/components/Can'
import { usePermission } from '@/hooks/usePermission'
import Pagination from '@/components/Pagination'
import ImportWizard from '@/components/ImportWizard'
import PanelProducto from '@/components/PanelProducto'
import PanelTransferencia from '@/components/PanelTransferencia'
import PreciosMasivos from '@/components/PreciosMasivos'
import MenuDesplegable from '@/components/MenuDesplegable'
import { mensajeDeError } from '@/utils/erroresDeApi'
import PieDeTabla from '@/components/PieDeTabla'

// ════════════════════════════════════════════
//  FAVALIO · Inventario
//
//  La segunda pantalla que aplica el patrón de tabla que fijó Historial de
//  ventas. El marco vive en `components/TablaGrid.jsx`; las columnas y las
//  celdas se escriben acá.
//
//  Lo que esta pantalla agrega al patrón y las otras cuatro van a necesitar:
//  una columna de selección al principio del string y un número de columnas que
//  **depende de los datos** —una por sucursal—, así que `COLUMNAS` es una
//  función y no una constante.
//
//  Reglas: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Las columnas, idénticas en el encabezado y en las filas.
 *
 * `n` es cuántas columnas de stock hay. La maqueta
 * (`Favalio-Rediseno.dc.html:599`) dibuja
 * `minmax(0,1.6fr) 116px 116px 104px 104px` + una por sucursal + `56px`, y
 * **no** dibuja la columna de selección: se dibujó antes de que se liberara la
 * actualización masiva de precios, que es la que necesita seleccionar filas. Por
 * eso el string arranca con `32px` y no con `minmax`.
 *
 * Que sea una función y no dos strings copiados no es cosmético: cuando el
 * encabezado y las filas difieren, las etiquetas dejan de estar sobre sus datos
 * y se lee una cantidad bajo «Costo».
 */
const COLUMNAS = (n) =>
  `32px minmax(0,1.6fr) 116px 116px 104px 104px ${'92px '.repeat(n)}56px`

/**
 * Por debajo de esto la tabla scrollea DENTRO de su tarjeta.
 *
 * 848 son las columnas fijas más las separaciones y el padding; 108 por
 * sucursal son los 92px de la columna más los 16 de separación que agrega. Da
 * 956 / 1064 / 1172 para una, dos y tres sucursales.
 *
 * El `min-width:1140px` que la maqueta le pone al contenedor de la página NO se
 * copia: haría scrollear el body entero y el usuario perdería de vista la barra
 * lateral cada vez que mira la última columna.
 */
const ANCHO_MINIMO = (n) => 848 + 108 * n

/** Las mismas 25 filas por página que Historial de ventas (FR-018). */
const FILAS_POR_PAGINA = 25

/** Botón principal del sistema: 34px, marca, sombra de nivel 1. */
const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/** Botón secundario del sistema: 34px, borde, hover en surface-3. */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/** Cantidades: sin decimales forzados, pero con separador de miles. */
const unidades = (n) => Number(n || 0).toLocaleString('es-AR')

/**
 * Cuántas columnas de stock se dibujan a la vez.
 *
 * Con más, la tabla deja de entrar y el usuario scrollea horizontal para
 * comparar dos números que ya no ve juntos — que es exactamente el problema que
 * la comparación viene a resolver. Con más de tres sucursales, el usuario elige
 * cuáles comparar (FR-063).
 */
const MAXIMO_COLUMNAS_DE_SUCURSAL = 3

/**
 * Más de esto no se baja en un solo archivo.
 *
 * Es el mismo tope que fijó Historial de ventas. ⚠ Queda anotado que **el techo
 * real no es este**: la pantalla se sigue trayendo el catálogo entero en la
 * carga inicial, así que lo que limita cuántos productos se pueden exportar es
 * cuántos entraron ahí. Está en `docs/PROXIMOS-PROYECTOS.md` como
 * «5e · La pantalla de Inventario se trae el catálogo entero» y está Fuera de
 * alcance de esta funcionalidad.
 */
const LIMITE_EXPORT = 5000

/**
 * Cuántas transferencias trae el historial.
 *
 * Era un `20` escrito en la llamada. Sale acá porque el pie que avisa que la
 * lista está cortada compara contra el total del endpoint, y un tope escrito en
 * dos lugares es un pie que un día deja de aparecer.
 */
const TRANSFERENCIAS_A_LA_VISTA = 20

/** Las columnas del historial de transferencias. Mismo patrón que la tabla de
 *  productos: el mismo string arriba y abajo. */
const COLUMNAS_TRANSFERENCIAS = '150px minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr)'
const ANCHO_MINIMO_TRANSFERENCIAS = 760

/**
 * El nombre de una sucursal de una transferencia.
 *
 * Primero el objeto que devuelve la API (`fromPuntoDeVenta` / `toPuntoDeVenta`),
 * y si no está, el texto `from_location` / `to_location`. Las transferencias
 * **anteriores** a esta funcionalidad tienen los dos ids en `null` —no se
 * migran, está Fuera de alcance— y sin la caída al texto se verían como dos
 * huecos: el caso hay que mostrarlo, no evitarlo.
 */
function nombreDeSucursalDeTransferencia(puntoDeVenta, textoViejo) {
  return puntoDeVenta?.name || textoViejo || '—'
}

/**
 * «Colágeno ×2 · Whey ×1».
 *
 * La cantidad pasa por `cantidad()` aunque NO venga de una columna `DECIMAL`:
 * sale de `StockTransfer.items`, que es `JSONB` y guarda lo que se transfirió.
 * O sea que acá no hay regresión del día de la migración (FR-034a) — entra por
 * el separador decimal: una transferencia de 9,6 kg se escribía «×9.6», y en
 * es-AR el punto es el separador de MILES. Con enteros dice exactamente lo
 * mismo que hoy.
 */
function resumenDeItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'Sin ítems'
  return items.map((i) => `${i.product_name} ×${cantidad(i.quantity)}`).join(' · ')
}

const Inventory = () => {
  const { products, brands, settings, initialize, loading, error } = useStore()
  const actualizarProducto = useStore(s => s.actualizarProducto)
  const quitarProducto = useStore(s => s.quitarProducto)
  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  // Las sucursales salen de `GET /api/stock/sucursales` y NO de
  // `empresaActiva.puntosDeVenta`: ese filtra por `is_active`, y una sucursal
  // dada de baja con mercadería adentro desaparecería con la mercadería adentro
  // (FR-066). Es justo el stock que hay que poder ver para sacarlo de ahí.
  const sucursales = useStore(s => s.sucursales)
  const cargarSucursales = useStore(s => s.cargarSucursales)
  const { can } = usePermission()
  const puedeTransferir = can('stock.transferir')

  const [searchQuery, setSearchQuery] = useState('')
  const [categoria, setCategoria] = useState(TODAS_LAS_CATEGORIAS)
  const [soloStockBajo, setSoloStockBajo] = useState(false)
  // ── Ver los productos desactivados ──
  //
  // `useStore.initialize()` pide `?active=true`, así que hasta acá desactivar un
  // producto lo hacía invisible **para siempre desde la interfaz**: no había
  // ningún filtro para lo otro y el producto quedaba sin forma de volver
  // (defecto 5, FR-078). Se piden aparte y no se meten en el store: son otro
  // conjunto, no una versión más grande del mismo, y mezclarlos haría que el
  // POS y el resto de las pantallas ofrezcan productos dados de baja.
  const [verDesactivados, setVerDesactivados] = useState(false)
  // `null` y no `[]`: es lo que distingue «todavía no los pedí» de «los pedí y
  // no hay ninguno». Con `[]` las dos situaciones se ven igual y la pantalla
  // diría «no hay productos desactivados» mientras el pedido está en vuelo.
  const [desactivados, setDesactivados] = useState(null)
  // El panel es uno solo para las dos cosas: `productoAbierto` en `null` con el
  // panel abierto es el alta. Tener dos componentes —uno para crear y otro para
  // editar— es como el alta se quedó sin la sección de stock que la edición sí
  // tenía, y nadie lo notó hasta que hubo que cargar el inventario entero.
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [productoAbierto, setProductoAbierto] = useState(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isTransfer, setIsTransfer] = useState(false)
  /**
   * La sucursal que eligió el usuario EN ESTA PANTALLA, o `undefined` si
   * todavía no tocó el filtro.
   *
   * Mientras vale `undefined`, manda el selector del encabezado de la
   * aplicación: es el contexto de trabajo y define el valor inicial. Apenas el
   * usuario elige algo acá —«Todas» incluido— manda el filtro de la pantalla
   * (FR-065). Sin esta distinción, elegir «Todas» con una sucursal activa en el
   * encabezado no tendría efecto y el usuario no podría ver la comparación.
   */
  const [sucursalDelFiltro, setSucursalDelFiltro] = useState(undefined)
  /** Qué sucursales se comparan cuando hay más de tres. Vacío = las tres
   *  primeras, que es el valor por defecto de FR-063. */
  const [columnasElegidas, setColumnasElegidas] = useState(new Set())
  const [transfers, setTransfers] = useState([])
  // El `total` del endpoint y NO `transfers.length`: la lista se pide con tope.
  const [totalDeTransferencias, setTotalDeTransferencias] = useState(0)
  const [showTransfers, setShowTransfers] = useState(false)
  const [cargandoTransferencias, setCargandoTransferencias] = useState(false)
  const [page, setPage] = useState(1)

  // ── Selección para la actualización masiva de precios ──
  // Se guardan ids y no productos: la lista se recarga después de aplicar, y
  // una copia del producto quedaría desactualizada.
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [preciosAbierto, setPreciosAbierto] = useState(false)
  /** Mientras el `PATCH` de publicables está en vuelo. */
  const [marcandoPublicables, setMarcandoPublicables] = useState(false)

  /** Con qué se abre el panel de transferencia cuando sale de una fila. */
  const [precargaDeTransferencia, setPrecargaDeTransferencia] = useState(null)

  useEffect(() => { initialize() }, [initialize])

  useEffect(() => { cargarSucursales() }, [cargarSucursales])

  // Los desactivados se piden una sola vez, y solo si alguien los pide. El
  // `catch` deja la lista vacía en vez de dejarla en `null`: si no, el efecto se
  // volvería a disparar en cada render y reintentaría el pedido fallido para
  // siempre.
  useEffect(() => {
    if (!verDesactivados || desactivados !== null) return

    getProducts({ active: 'false' })
      .then((res) => setDesactivados(res.data.data || []))
      .catch((err) => {
        toast.error('No se pudieron cargar los productos desactivados: ' + (err.response?.data?.error || err.message))
        setDesactivados([])
      })
  }, [verDesactivados, desactivados])

  /** Abre el panel vacío, para dar de alta. */
  const openCreate = () => {
    setProductoAbierto(null)
    setPanelAbierto(true)
  }

  /** Abre el panel del producto. Es lo que hace el clic en cualquier parte de
   *  la fila que no sea un botón de acción ni la casilla de selección. */
  const abrirPanel = (product) => {
    setProductoAbierto(product)
    setPanelAbierto(true)
  }

  const cerrarPanel = (abierto) => {
    if (abierto) return
    setPanelAbierto(false)
    setProductoAbierto(null)
  }

  /**
   * Reemplaza la fila con lo que devolvió el guardado.
   *
   * Sin recargar: `initialize()` dispara tres pedidos, pone `loading` global —la
   * tabla entera parpadea— y devuelve la lista al principio, con lo cual el
   * usuario pierde la página, la búsqueda, el orden y el scroll (FR-035). Con
   * doscientos productos y una corrección por fila, es la diferencia entre
   * trabajar y pelearse con la pantalla.
   */
  const alGuardarProducto = (actualizado) => {
    if (verDesactivados) {
      // En la vista de desactivados la lista es local, no la del store. Un
      // producto reactivado sale de este conjunto, igual que uno desactivado
      // sale del de activos.
      setDesactivados((filas) => (filas || [])
        .filter((p) => p.id !== actualizado.id || actualizado.is_active === false)
        .map((p) => (p.id === actualizado.id ? { ...p, ...actualizado } : p)))
      return
    }

    actualizarProducto(actualizado)
  }

  /**
   * Un producto recién creado sí obliga a recargar.
   *
   * Es la excepción a FR-035 y es a propósito: un alta cambia **la composición**
   * de la lista, no una fila —el catálogo viene ordenado por nombre desde el
   * servidor, y el producto nuevo puede caer en cualquier página—. El store no
   * tiene una acción para agregar (T1030 definió `actualizarProducto` y
   * `quitarProducto`, que reemplazan y sacan), así que meterlo a mano dejaría la
   * lista desordenada respecto de la del servidor. Es un pedido por alta, no uno
   * por guardado.
   */
  const alCrearProducto = () => { initialize() }

  const alDesactivarProducto = (id) => {
    // La lista de activos se carga con `?active=true`: dejarlo mostraría una
    // fila que ya no corresponde.
    quitarProducto(id)
    setSeleccionados((prev) => {
      if (!prev.has(id)) return prev
      const siguiente = new Set(prev)
      siguiente.delete(id)
      return siguiente
    })
  }

  /**
   * Trae el historial de transferencias.
   *
   * ⚠ Se guarda el `total` del endpoint, y no solo las filas. El pedido lleva un
   * tope de veinte, así que el badge —que contaba el arreglo— decía «20» en un
   * comercio con doscientas transferencias: un contador que miente hacia abajo y
   * sin ninguna señal de que la lista está cortada.
   */
  const pedirTransferencias = async () => {
    setCargandoTransferencias(true)
    try {
      const res = await getStockTransfers({ limit: TRANSFERENCIAS_A_LA_VISTA })
      setTransfers(res.data.data || [])
      setTotalDeTransferencias(res.data.total || 0)
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cargar el historial de transferencias.'))
      setTotalDeTransferencias(0)
    } finally {
      setCargandoTransferencias(false)
    }
  }

  const alternarHistorial = () => {
    const abriendo = !showTransfers
    setShowTransfers(abriendo)
    if (abriendo) pedirTransferencias()
  }

  /** Parchea campos de una fila, sea de la lista de activos o la de baja. */
  const parchearProducto = (id, cambios) => {
    if (verDesactivados) {
      setDesactivados((filas) => (filas || []).map((p) => (p.id === id ? { ...p, ...cambios } : p)))
      return
    }

    actualizarProducto({ id, ...cambios })
  }

  /**
   * Marca o desmarca en lote los productos seleccionados.
   *
   * ── Esto NO publica nada ──
   *
   * Va contra `PATCH /api/products/publicables`, que escribe una columna del
   * producto. Un producto sale a una tienda recién cuando se lo agrega a un
   * catálogo, y esta pantalla no agrega a ningún catálogo: por eso la llamada
   * es a productos y no a catálogos.
   *
   * ── Los dos números de la respuesta ──
   *
   * `actualizados` puede ser MENOR que `pedidos`: los que faltan eran de otra
   * empresa o ya no existen. Cuando difieren hay que decirlo. «Listo, 60»
   * cuando se marcaron 58 es una afirmación falsa sobre una operación que ya
   * pasó, y el usuario se entera —si se entera— el día que dos productos no
   * aparecen donde los esperaba.
   *
   * ⚠ La selección NO se limpia después, y ahí difiere a propósito de
   * «Actualizar precios». Allá se limpia porque aplicar el mismo ajuste dos
   * veces sube el costo dos veces; acá la operación es idempotente —marcar lo
   * ya marcado no cambia nada— y lo más frecuente después de marcar es
   * arrepentirse y desmarcar el mismo conjunto.
   */
  const cambiarPublicables = async (publicable) => {
    const ids = [...seleccionados]

    if (ids.length === 0 || marcandoPublicables) return

    setMarcandoPublicables(true)
    try {
      const res = await marcarPublicables(ids, publicable)
      const datos = res.data?.data || {}
      const pedidos = Number(datos.pedidos ?? ids.length)
      const actualizados = Number(datos.actualizados ?? 0)

      if (actualizados === pedidos) {
        // Se parchean las filas sin recargar (FR-035): la operación ya ocurrió
        // y se sabe exactamente qué cambió en cuáles.
        for (const id of ids) parchearProducto(id, { publicable })

        const s = actualizados === 1 ? '' : 's'

        // ⚠ El mensaje de marcar dice lo que la acción NO hizo, y no es
        // redundante: «marcado como publicable» se lee como «publicado», que es
        // justo lo que no pasó.
        toast.success(publicable
          ? `${actualizados} producto${s} marcado${s} como publicable${s}. Para que aparezcan en una página hay que agregarlos a un catálogo.`
          : `${actualizados} producto${s} desmarcado${s}: ya no ${actualizados === 1 ? 'puede' : 'pueden'} salir a una página pública.`)
      } else {
        // La respuesta trae el CONTEO y no los ids, así que no se sabe cuáles
        // quedaron afuera: parchear las filas a mano dejaría en pantalla
        // productos marcados que en la base no lo están, que es peor que perder
        // la página. Se recarga.
        toast.warning(
          `Se ${publicable ? 'marcaron' : 'desmarcaron'} ${actualizados} de ${pedidos}. `
          + `${pedidos - actualizados} ya no ${pedidos - actualizados === 1 ? 'existe' : 'existen'} o `
          + 'no son de esta empresa.'
        )
        initialize()
      }
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cambiar qué productos son publicables.'))
    } finally {
      setMarcandoPublicables(false)
    }
  }

  /**
   * Aplica una transferencia ya confirmada a las columnas de la tabla.
   *
   * Sin recargar (FR-116): la operación ya ocurrió en el servidor y las dos
   * cantidades que cambiaron se conocen exactamente. Recargar acá devolvería la
   * lista al principio justo después de una operación que el usuario quiere
   * ver reflejada en la fila que está mirando.
   */
  const aplicarTransferencia = ({ origen, destino, items }) => {
    for (const item of items) {
      const producto = catalogo.find((p) => String(p.id) === String(item.product_id))
      if (!producto) continue

      const filas = [...(producto.stock || [])]

      const mover = (sucursalId, delta) => {
        const i = filas.findIndex((s) => String(s.punto_de_venta_id) === String(sucursalId))

        if (i >= 0) {
          filas[i] = {
            ...filas[i],
            quantity: Number(filas[i].quantity) + delta,
            available: Number(filas[i].available) + delta,
          }
          return
        }

        // La fila de destino puede no existir todavía: el servidor la creó en
        // esta misma transferencia. Se agrega sin `id` —no lo conocemos— y la
        // próxima carga trae la de verdad.
        filas.push({
          id: null,
          punto_de_venta_id: sucursalId,
          quantity: delta,
          available: delta,
          min_stock: 0,
        })
      }

      mover(origen, -Number(item.quantity))
      mover(destino, Number(item.quantity))

      parchearProducto(producto.id, { stock: filas })
    }

    // Si el historial está abierto, la transferencia que se acaba de hacer tiene
    // que aparecer: verlo sin la operación recién confirmada se lee como que no
    // se guardó.
    if (showTransfers) pedirTransferencias()
  }

  /**
   * Abre la transferencia desde una fila, con todo precargado (FR-068).
   *
   * El origen es la sucursal donde MÁS hay y el destino la que menos: es lo que
   * la fila está diciendo cuando se la mira —a una le falta lo que a la otra le
   * sobra— y es la transferencia que el usuario iba a armar a mano.
   */
  const transferirDesdeLaFila = (producto) => {
    const conCantidad = columnasDeStock.map((col) => ({
      id: col.id,
      cantidad: Number(filaDeStock(producto, col.id)?.quantity) || 0,
    }))

    const ordenadas = [...conCantidad].sort((a, b) => b.cantidad - a.cantidad)

    setPrecargaDeTransferencia({
      productoId: producto.id,
      origen: ordenadas[0]?.id ?? null,
      destino: ordenadas.length > 1 ? ordenadas[ordenadas.length - 1].id : null,
    })
    setIsTransfer(true)
  }

  const catalogo = useMemo(
    () => (verDesactivados ? (desactivados || []) : products),
    [verDesactivados, desactivados, products]
  )

  const cargandoDesactivados = verDesactivados && desactivados === null

  /**
   * La sucursal que está mostrando el filtro.
   *
   * Mientras el usuario no lo toque, sale del selector del encabezado. Apenas
   * elige algo —«Todas» incluido— manda lo que eligió acá (FR-065).
   */
  const sucursalElegida = sucursalDelFiltro !== undefined
    ? sucursalDelFiltro
    : (puntoDeVentaActivo?.id ? String(puntoDeVentaActivo.id) : TODAS_LAS_SUCURSALES)

  /** Las categorías que EXISTEN en el catálogo. `Product.category` es texto
   *  libre: una lista cerrada dejaría afuera lo que el cliente ya cargó. */
  const categorias = useMemo(() => {
    const vistas = new Set()
    for (const p of catalogo) if (p.category) vistas.add(p.category)
    return [...vistas].sort((a, b) => String(a).localeCompare(String(b), 'es'))
  }, [catalogo])

  const umbralStockBajo = Number(settings.umbral_stock_bajo)

  /**
   * El resultado del listado.
   *
   * La regla vive en `utils/inventario.js` y no acá: adentro del componente no
   * hay forma de testearla —`apps/web` no tiene entorno de render— y así fue
   * como el filtro de sucursal se quedó sin su predicado (FR-064) sin que
   * ningún test se pusiera en rojo.
   */
  const filteredProducts = useMemo(
    () => filtrarInventario(catalogo, {
      texto: searchQuery,
      categoria,
      soloStockBajo,
      sucursalElegida,
      umbral: umbralStockBajo,
    }),
    [catalogo, searchQuery, categoria, soloStockBajo, sucursalElegida, umbralStockBajo]
  )

  /** Los cuatro indicadores, sobre el RESULTADO FILTRADO y la sucursal elegida. */
  const indicadores = useMemo(
    () => calcularIndicadores(filteredProducts, {
      sucursalElegida,
      umbral: umbralStockBajo,
    }),
    [filteredProducts, sucursalElegida, umbralStockBajo]
  )

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / FILAS_POR_PAGINA))
  const paginatedProducts = filteredProducts.slice((page - 1) * FILAS_POR_PAGINA, page * FILAS_POR_PAGINA)

  const alternarSeleccion = (id) => {
    setSeleccionados(prev => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  // Selecciona TODO lo que da la búsqueda, no solo la página que se ve. Que el
  // "seleccionar todo" dependiera de en qué página estás sería una fuente
  // silenciosa de actualizaciones incompletas.
  const seleccionarFiltrados = () => {
    setSeleccionados(new Set(filteredProducts.map(p => p.id)))
  }

  const limpiarSeleccion = () => setSeleccionados(new Set())

  const todosLosFiltradosSeleccionados =
    filteredProducts.length > 0 && filteredProducts.every(p => seleccionados.has(p.id))


  /**
   * Las sucursales que pueden ser columna: las activas, y las dadas de baja con
   * mercadería adentro (FR-066). La regla —y por qué es `!== 0` y no `> 0`—
   * está en `utils/inventario.js`.
   */
  const sucursalesComparables = useMemo(
    () => calcularSucursalesComparables(sucursales, catalogo),
    [sucursales, catalogo]
  )

  /** Con el filtro en una sucursal, una sola columna; con «Todas», hasta tres. */
  const columnasDeStock = useMemo(() => {
    if (sucursalElegida !== TODAS_LAS_SUCURSALES) {
      const elegida = sucursales.find(s => String(s.id) === String(sucursalElegida))
      return elegida ? [elegida] : []
    }

    if (sucursalesComparables.length <= MAXIMO_COLUMNAS_DE_SUCURSAL) return sucursalesComparables

    const marcadas = sucursalesComparables.filter(s => columnasElegidas.has(String(s.id)))

    return (marcadas.length ? marcadas : sucursalesComparables).slice(0, MAXIMO_COLUMNAS_DE_SUCURSAL)
  }, [sucursales, sucursalesComparables, sucursalElegida, columnasElegidas])

  const columnas = COLUMNAS(columnasDeStock.length)
  const anchoMinimo = ANCHO_MINIMO(columnasDeStock.length)

  /**
   * Las sucursales que van como columna EN EL ARCHIVO.
   *
   * No están limitadas a tres: el tope de la pantalla es de ancho, y una hoja de
   * cálculo no tiene ese problema. Con «Todas» van todas, así que la suma de la
   * columna Valorizado coincide con el indicador «Valor del stock».
   */
  const sucursalesParaExportar = sucursalElegida === TODAS_LAS_SUCURSALES
    ? sucursalesComparables
    : columnasDeStock

  /** El nombre de la sucursal filtrada, para el nombre del archivo. */
  const nombreDeLaSucursal = sucursalElegida === TODAS_LAS_SUCURSALES
    ? null
    : (sucursales.find(s => String(s.id) === String(sucursalElegida))?.name || null)

  /**
   * Lo que impide exportar, o `null`.
   *
   * Los dos avisos se dan ANTES de armar nada: descargar un archivo con solo los
   * encabezados es peor que decir que no hay nada, y armar la hoja de seis mil
   * productos para descartarla congela la pestaña para nada.
   */
  const problemaDeExportar = () => {
    if (filteredProducts.length === 0) {
      return 'No hay productos para exportar con estos filtros.'
    }

    if (filteredProducts.length > LIMITE_EXPORT) {
      return `El filtro devuelve ${filteredProducts.length} productos y el máximo `
        + `por archivo es ${LIMITE_EXPORT}. Acotá por categoría, por sucursal o `
        + 'con la búsqueda.'
    }

    return null
  }

  const exportarExcel = () => {
    const problema = problemaDeExportar()

    if (problema) {
      toast.error(problema)
      return
    }

    // El archivo lleva TODO el resultado del filtro y no las 25 filas visibles:
    // exportar lo que se ve sería un archivo distinto según en qué página estaba
    // el usuario.
    descargarInventario(filteredProducts, {
      sucursales: sucursalesParaExportar,
      settings,
      sucursalElegida: sucursalElegida === TODAS_LAS_SUCURSALES ? null : sucursalElegida,
      nombreDeLaSucursal,
    })
  }

  const imprimir = () => {
    const problema = problemaDeExportar()

    if (problema) {
      toast.error(problema)
      return
    }

    const ventana = imprimirInventario({
      productos: filteredProducts,
      sucursales: sucursalesParaExportar,
      sucursalElegida: sucursalElegida === TODAS_LAS_SUCURSALES ? null : sucursalElegida,
      nombreDeLaSucursal,
      settings,
      umbral: umbralStockBajo,
    })

    // Con el bloqueador de emergentes activo, `window.open` devuelve `null` y sin
    // este aviso el usuario aprieta «Imprimir» y no pasa **nada**: ni la hoja, ni
    // un error, ni una explicación (FR-135).
    if (!ventana) {
      toast.error(
        'El navegador bloqueó la ventana de impresión. Permití las ventanas '
        + 'emergentes para este sitio y volvé a intentar.'
      )
    }
  }

  /** Alterna una sucursal en la comparación, con el tope de tres. */
  const alternarColumna = (id) => {
    setColumnasElegidas(prev => {
      const siguiente = new Set(prev.size ? prev : sucursalesComparables.slice(0, MAXIMO_COLUMNAS_DE_SUCURSAL).map(s => String(s.id)))
      const clave = String(id)

      if (siguiente.has(clave)) {
        // No se puede dejar la tabla sin ninguna columna de stock: sería la
        // pantalla de inventario sin el inventario.
        if (siguiente.size > 1) siguiente.delete(clave)
      } else if (siguiente.size < MAXIMO_COLUMNAS_DE_SUCURSAL) {
        siguiente.add(clave)
      }

      return siguiente
    })
  }

  /**
   * Si hay algún filtro puesto. Decide cuál de los dos vacíos se muestra.
   *
   * La sucursal cuenta como filtro desde que acota el listado (FR-064): sin
   * ella acá, elegir una sucursal que no maneja ningún producto mostraría «No
   * hay productos cargados» —que es mentira— en vez de «ninguno coincide».
   */
  const hayFiltros = searchQuery.trim() !== ''
    || categoria !== TODAS_LAS_CATEGORIAS
    || soloStockBajo
    || verDesactivados
    || sucursalElegida !== TODAS_LAS_SUCURSALES

  /**
   * Todo cambio de filtro vuelve a la página 1.
   *
   * Va acá y no en un `useEffect` sobre los filtros: el efecto pinta una vez la
   * página vieja con el resultado nuevo antes de corregirse, y sobre todo,
   * estando en la página 5 y aplicando un filtro cuyo resultado tiene 2, la
   * pantalla queda en una página que no existe y se ve vacía sin motivo.
   */
  const aplicarFiltro = (cambiar) => {
    cambiar()
    setPage(1)
  }

  // «Limpiar» limpia lo mismo que cuenta `hayFiltros`, la sucursal incluida: el
  // botón aparece justo en el vacío que produjo el filtro de sucursal, y uno que
  // no lo saca es un botón que no cambia nada.
  const limpiarFiltros = () => aplicarFiltro(() => {
    setSearchQuery('')
    setCategoria(TODAS_LAS_CATEGORIAS)
    setSoloStockBajo(false)
    setVerDesactivados(false)
    setSucursalDelFiltro(TODAS_LAS_SUCURSALES)
  })

  if (error) {
    return (
      <div className="anim-subida flex flex-col gap-6">
        <div>
          <h1>Inventario</h1>
        </div>
        {/* `role="alert"`: sin él la falla de carga no se anuncia y la persona
            sigue esperando productos que no van a llegar. */}
        <div
          role="alert"
          className="rounded-xl border border-danger-line bg-danger-soft p-6 text-center"
        >
          <p className="font-semibold text-danger">Error al cargar los productos</p>
          <p className="mx-auto mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">{error}</p>
          <button className={`${BOTON_SECUNDARIO} mt-3`} onClick={() => initialize()}>
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="anim-subida flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1>Inventario</h1>
          {/* ⚠ La descripción DICE el alcance. El selector de sucursal de
              arriba filtra esta lista, y sin decirlo el mismo producto se ve
              con distinto stock según lo que quedó elegido —que puede haber
              quedado de otra pantalla, hace media hora—. */}
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">
            Stock por sucursal, costos y márgenes. Filtra por la sucursal
            elegida arriba. Hacé clic en un producto para editarlo sin salir de
            la lista.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={BOTON_SECUNDARIO}
            onClick={alternarHistorial}
          >
            <ArrowRightLeft className="h-3.5 w-3.5 text-fg-3" /> Transferencias
          </button>
          {/* Sin `stock.transferir` el botón no se ve. La API lo rechaza
              igual: la pantalla es la cortesía, no la barrera. */}
          <Can codigo="stock.transferir">
            <button className={BOTON_SECUNDARIO} onClick={() => { setPrecargaDeTransferencia(null); setIsTransfer(true) }}>
              <ArrowRightLeft className="h-3.5 w-3.5 text-fg-3" /> Transferir
            </button>
          </Can>
          <Can codigo="products.crear">
            <button className={BOTON_SECUNDARIO} onClick={() => setIsImportOpen(true)}>
              <FileSpreadsheet className="h-3.5 w-3.5 text-fg-3" /> Importar
            </button>
          </Can>

          {/* Exportar, con Excel e Imprimir adentro. Van juntos porque son la
              misma decisión —«llevarme este listado»— y separados serían dos
              botones secundarios más compitiendo con el principal. */}
          <Can codigo="products.ver">
            <MenuDesplegable
              claseDelBoton={BOTON_SECUNDARIO}
              boton={<><Download className="h-3.5 w-3.5 text-fg-3" /> Exportar</>}
            >
              <div>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-3"
                  onClick={exportarExcel}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-fg-3" />
                  Excel (.xlsx)
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-3"
                  onClick={imprimir}
                >
                  <Printer className="h-3.5 w-3.5 text-fg-3" />
                  Imprimir
                </button>
              </div>
            </MenuDesplegable>
          </Can>
          <button className={BOTON_PRINCIPAL} onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nuevo producto
          </button>
        </div>
      </div>

      {/* ── Indicadores y sucursal ──
          Los cuatro números y el selector de sucursal van juntos porque los
          cuatro se refieren a la sucursal elegida: separados, el usuario cambia
          de sucursal y no relaciona el cambio de los números con lo que tocó. */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1">
        <div className="flex min-w-[104px] flex-col gap-0.5">
          <span className="text-[11.5px] font-medium text-fg-2">
            {verDesactivados ? 'Productos desactivados' : 'Productos activos'}
          </span>
          <span className="num text-[21px] font-semibold">{unidades(indicadores.productos)}</span>
        </div>

        <div className="flex min-w-[104px] flex-col gap-0.5">
          <span className="text-[11.5px] font-medium text-fg-2">Valor del stock</span>
          <span className="num text-[21px] font-semibold">${pesosRedondos(indicadores.valor)}</span>
        </div>

        <div className="flex min-w-[104px] flex-col gap-0.5">
          <span className="text-[11.5px] font-medium text-fg-2">Stock bajo</span>
          <span className="num text-[21px] font-semibold text-warn">{unidades(indicadores.bajo)}</span>
        </div>

        <div className="flex min-w-[104px] flex-col gap-0.5">
          <span className="text-[11.5px] font-medium text-fg-2">Sin stock</span>
          <span className="num text-[21px] font-semibold text-danger">{unidades(indicadores.sin)}</span>
        </div>

        <div className="flex-1" />

        {/* «Todas» primero y siempre: es la vista que compara, y es lo que esta
            pantalla vino a poder hacer. Las inactivas se marcan pero se ofrecen:
            hay que poder mirar lo que quedó adentro de un local cerrado. */}
        <div className="flex flex-wrap gap-[3px] rounded-lg bg-surface-3 p-[3px]">
          <button
            onClick={() => aplicarFiltro(() => setSucursalDelFiltro(TODAS_LAS_SUCURSALES))}
            className={`h-7 rounded-md px-3 text-[12.5px] transition-colors ${sucursalElegida === TODAS_LAS_SUCURSALES ? 'bg-surface font-semibold text-foreground shadow-nivel-1' : 'font-medium text-fg-2 hover:text-foreground'}`}
          >Todas</button>
          {sucursales.map(s => (
            <button
              key={s.id}
              onClick={() => aplicarFiltro(() => setSucursalDelFiltro(String(s.id)))}
              title={s.is_active === false ? 'Sucursal dada de baja' : undefined}
              className={`h-7 rounded-md px-3 text-[12.5px] transition-colors ${String(s.id) === String(sucursalElegida) ? 'bg-surface font-semibold text-foreground shadow-nivel-1' : 'font-medium text-fg-2 hover:text-foreground'}`}
            >
              {s.is_active === false ? `${s.name} (inactiva)` : s.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
          <input
            placeholder="Buscar por nombre, marca, SKU o categoría…"
            value={searchQuery}
            onChange={(e) => aplicarFiltro(() => setSearchQuery(e.target.value))}
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13.5px]
                       transition-colors focus-visible:border-brand focus-visible:outline-none"
          />
        </div>

        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px]">
          <Package className="h-3.5 w-3.5 text-fg-3" />
          <select
            aria-label="Categoría"
            value={categoria}
            onChange={(e) => aplicarFiltro(() => setCategoria(e.target.value))}
            className="border-none bg-transparent text-[13px] outline-none"
          >
            <option value={TODAS_LAS_CATEGORIAS}>Todas las categorías</option>
            {/* Las categorías salen del catálogo y no de una lista cerrada:
                `Product.category` es texto libre. */}
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <button
          onClick={() => aplicarFiltro(() => setSoloStockBajo(v => !v))}
          aria-pressed={soloStockBajo}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
            soloStockBajo
              ? 'border-warn-line bg-warn-soft font-medium text-warn'
              : 'border-border bg-surface hover:bg-surface-3'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Stock bajo
        </button>

        {/* Los desactivados no aparecen por ningún otro camino: `initialize()`
            pide `?active=true`. Sin este filtro, dar de baja un producto lo hace
            invisible para siempre desde la interfaz (defecto 5). */}
        <button
          onClick={() => aplicarFiltro(() => setVerDesactivados(v => !v))}
          aria-pressed={verDesactivados}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors ${
            verDesactivados
              ? 'border-brand-line bg-brand-soft font-medium text-brand'
              : 'border-border bg-surface hover:bg-surface-3'
          }`}
        >
          {cargandoDesactivados
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Archive className="h-3.5 w-3.5" />}
          Desactivados
        </button>

        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-fg-2 transition-colors hover:bg-surface-3"
          >
            <FilterX className="h-3.5 w-3.5" />
            Limpiar
          </button>
        )}

        <div className="flex-1" />

        {/* ── Qué sucursales se comparan ──
            Aparece solo con más de tres: con tres o menos están todas y un
            selector que no puede cambiar nada es un botón que enseña a ignorar
            los botones. Va con `MenuDesplegable`, que es un `<details>` con las
            tres líneas que el navegador NO resuelve: cerrar al hacer clic
            afuera, cerrar con Escape y devolver el foco al botón. */}
        {sucursalElegida === TODAS_LAS_SUCURSALES
          && sucursalesComparables.length > MAXIMO_COLUMNAS_DE_SUCURSAL && (
          <MenuDesplegable
            ancho="w-[240px]"
            claseDelBoton="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-fg-2 transition-colors hover:bg-surface-3"
            boton={
              <>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Columnas
                <span className="num text-[11.5px] text-fg-3">
                  {columnasDeStock.length}/{MAXIMO_COLUMNAS_DE_SUCURSAL}
                </span>
              </>
            }
          >
            <div className="p-1">
              <p className="px-2 py-1 text-[11.5px] text-fg-3">
                Hasta {MAXIMO_COLUMNAS_DE_SUCURSAL} sucursales lado a lado.
              </p>
              {sucursalesComparables.map(s => {
                const marcada = columnasDeStock.some(c => String(c.id) === String(s.id))

                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-3"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={marcada}
                      disabled={!marcada && columnasDeStock.length >= MAXIMO_COLUMNAS_DE_SUCURSAL}
                      onChange={() => alternarColumna(s.id)}
                    />
                    <span className="truncate">
                      {s.is_active === false ? `${s.name} (inactiva)` : s.name}
                    </span>
                  </label>
                )
              })}
            </div>
          </MenuDesplegable>
        )}
      </div>

      {/* ── El historial de transferencias ──
          En el patrón de tabla y en la página, no como tarjetas adentro de un
          modal: un modal obliga a cerrarlo para mirar el stock del que habla, y
          es justo la comparación que hay que hacer. */}
      {showTransfers && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
            <h2>Transferencias</h2>
            <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
              {totalDeTransferencias}
            </span>
            <div className="flex-1" />
            {cargandoTransferencias && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
            <button
              className="text-[12.5px] font-medium text-fg-2 transition-colors hover:text-foreground"
              onClick={() => setShowTransfers(false)}
            >
              Ocultar
            </button>
          </div>

          {transfers.length === 0 && !cargandoTransferencias ? (
            <div className="py-10 text-center">
              <ArrowRightLeft className="mx-auto h-7 w-7 text-fg-3" />
              <p className="mt-3 font-semibold">Todavía no se movió mercadería entre sucursales.</p>
              <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                Cuando transfieras, cada operación queda acá con su fecha, su
                origen, su destino y todo lo que llevó.
              </p>
            </div>
          ) : (
            <TablaGrid anchoMinimo={ANCHO_MINIMO_TRANSFERENCIAS}>
              <Encabezado columnas={COLUMNAS_TRANSFERENCIAS}>
                <span>Fecha</span>
                <span>Origen</span>
                <span>Destino</span>
                <span>Productos</span>
              </Encabezado>

              {transfers.map(t => {
                const items = Array.isArray(t.items) ? t.items : []
                const resumen = resumenDeItems(items)

                return (
                  <Fila key={t.id} columnas={COLUMNAS_TRANSFERENCIAS} className="cursor-default">
                    <span className="num text-[12.5px] text-fg-2">
                      {new Date(t.createdAt).toLocaleString('es-AR')}
                    </span>
                    <span className="truncate text-[13px]">
                      {nombreDeSucursalDeTransferencia(t.fromPuntoDeVenta, t.from_location)}
                    </span>
                    <span className="truncate text-[13px]">
                      {nombreDeSucursalDeTransferencia(t.toPuntoDeVenta, t.to_location)}
                    </span>
                    <span className="min-w-0 truncate text-[12.5px] text-fg-2" title={resumen}>
                      <span className="num">{items.length}</span>
                      {items.length === 1 ? ' producto · ' : ' productos · '}
                      {resumen}
                    </span>
                  </Fila>
                )
              })}
            </TablaGrid>
          )}

          {/* ── La señal de truncado ──
              Solo cuando la lista está cortada de verdad. Un pie que dijera
              siempre «Mostrando 7 de 7» es ruido; el que falta es el que avisa
              que hay transferencias que no se ven. */}
          {totalDeTransferencias > transfers.length && (
            <div className="border-t border-border px-5 py-3 text-[12.5px] text-fg-2">
              Mostrando <span className="num">{transfers.length}</span> de{' '}
              <span className="num">{totalDeTransferencias}</span>. Las más nuevas primero.
            </div>
          )}
        </section>
      )}

      {/* ── El listado ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        {/* Barra de selección: aparece solo cuando hay algo seleccionado. */}
        {seleccionados.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-brand-soft px-5 py-2.5">
            <span className="text-[13px] font-semibold">
              {seleccionados.size} seleccionado{seleccionados.size === 1 ? '' : 's'}
            </span>

            {!todosLosFiltradosSeleccionados && filteredProducts.length > seleccionados.size && (
              <button className="text-[12.5px] font-medium text-brand hover:underline" onClick={seleccionarFiltrados}>
                Seleccionar los {filteredProducts.length} de la búsqueda
              </button>
            )}

            <button
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-fg-2 hover:text-foreground"
              onClick={limpiarSeleccion}
            >
              <X className="h-3.5 w-3.5" /> Limpiar
            </button>

            <div className="ml-auto flex items-center gap-2">
              {/* ── Página pública ──
                  Las dos acciones van juntas adentro de un menú y no como dos
                  botones sueltos, por el mismo motivo que «Exportar» de arriba:
                  son la misma decisión —«qué hago con la publicabilidad de
                  estos»— y separadas serían dos secundarios más compitiendo con
                  el principal de al lado.

                  Y es secundario, no principal: el principal de esta barra ya
                  es «Actualizar precios». */}
              <Can codigo="products.editar">
                <MenuDesplegable
                  claseDelBoton={BOTON_SECUNDARIO}
                  boton={
                    <>
                      {marcandoPublicables
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-3" />
                        : <Globe className="h-3.5 w-3.5 text-fg-3" />}
                      Página pública
                    </>
                  }
                >
                  <div>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={marcandoPublicables}
                      onClick={() => cambiarPublicables(true)}
                    >
                      <Globe className="h-3.5 w-3.5 text-fg-3" />
                      Marcar como publicables
                    </button>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={marcandoPublicables}
                      onClick={() => cambiarPublicables(false)}
                    >
                      <X className="h-3.5 w-3.5 text-fg-3" />
                      Quitar de publicables
                    </button>
                    {/* Lo que el menú tiene que decir y el nombre de la acción
                        no dice: marcar no publica nada. */}
                    <p className="px-2.5 py-2 text-[11.5px] text-fg-3">
                      Marcarlos no los publica: para que aparezcan en una página
                      hay que agregarlos a un catálogo.
                    </p>
                  </div>
                </MenuDesplegable>
              </Can>

              <Can codigo="products.editar">
                <button className={BOTON_PRINCIPAL} onClick={() => setPreciosAbierto(true)}>
                  <Tags className="h-4 w-4" /> Actualizar precios
                </button>
              </Can>
            </div>
          </div>
        )}

        {(loading || cargandoDesactivados) && catalogo.length === 0 ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-fg-3" />
            <p className="mt-3 text-sm text-fg-2">Cargando productos…</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          // Los dos vacíos son distintos y dicen cosas distintas: «todavía no
          // cargaste nada» se resuelve cargando, «ninguno coincide» se resuelve
          // sacando un filtro.
          hayFiltros ? (
            <div className="py-12 text-center">
              <FilterX className="mx-auto h-7 w-7 text-fg-3" />
              <p className="mt-3 font-semibold">Ningún producto coincide con los filtros.</p>
              <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                Probá con otro texto, otra categoría o todas las sucursales. La
                búsqueda ignora los acentos: «colageno» encuentra «Colágeno».
              </p>
              <button onClick={limpiarFiltros} className={`${BOTON_SECUNDARIO} mt-4`}>
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="py-12 text-center">
              <Package className="mx-auto h-7 w-7 text-fg-3" />
              <p className="mt-3 font-semibold">No hay productos cargados.</p>
              <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
                Cargá el primero con «Nuevo producto», o subí tu lista con
                «Importar».
              </p>
            </div>
          )
        ) : (
          <>
            <TablaGrid anchoMinimo={anchoMinimo}>
              <Encabezado columnas={columnas}>
                <span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 align-middle accent-brand"
                    checked={todosLosFiltradosSeleccionados}
                    onChange={() => todosLosFiltradosSeleccionados ? limpiarSeleccion() : seleccionarFiltrados()}
                    title="Seleccionar todo lo que da la búsqueda"
                  />
                </span>
                <span>Producto</span>
                <span>Marca</span>
                <span>Categoría</span>
                <span className="text-right">Costo</span>
                <span className="text-right">Precio</span>
                {columnasDeStock.map(col => (
                  <span
                    key={col.id}
                    className="truncate text-center"
                    title={col.is_active === false ? `${col.name} (sucursal dada de baja)` : col.name}
                  >
                    {col.is_active === false ? `${col.name} (inactiva)` : col.name}
                  </span>
                ))}
                <span />
              </Encabezado>

              {paginatedProducts.map(p => {
                const precios = calcularPrecios(p, settings)

                return (
                  <Fila
                    key={p.id}
                    columnas={columnas}
                    onClick={() => abrirPanel(p)}
                    className={seleccionados.has(p.id) ? 'bg-brand-soft' : undefined}
                  >
                    {/* La selección no abre el panel: son dos gestos distintos
                        sobre la misma fila. */}
                    <span onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 align-middle accent-brand"
                        checked={seleccionados.has(p.id)}
                        onChange={() => alternarSeleccion(p.id)}
                      />
                    </span>

                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="truncate text-[13.5px] font-medium" title={p.name}>{p.name}</span>
                      <span className="num truncate text-[11.5px] text-fg-3">{p.sku || '—'}</span>
                    </span>

                    <span className="truncate text-[13px] text-fg-2" title={p.brand?.name || ''}>
                      {p.brand?.name || '—'}
                    </span>

                    {p.category ? (
                      <span className="w-fit truncate rounded-md bg-surface-3 px-2 py-[3px] text-xs text-fg-2">
                        {p.category}
                      </span>
                    ) : (
                      <span className="text-[13px] text-fg-3">—</span>
                    )}

                    <span className="num text-right text-[13px] text-fg-2">
                      ${pesos(p.cost)}
                    </span>

                    {/* Un producto sin costo y sin precio manual NO muestra
                        «$0»: cero es un precio, y quien lo lee así lo vende
                        gratis. Se marca como lo que es —falta el costo— y el
                        panel es donde se corrige. */}
                    {precios.sinCosto ? (
                      <span className="text-right text-[11.5px] font-medium text-warn" title="El producto no tiene costo cargado: no se puede calcular el precio">
                        Sin costo
                      </span>
                    ) : (
                      <span className="num text-right text-[13.5px] font-medium">
                        ${pesos(precios.cashPrice)}
                      </span>
                    )}

                    {columnasDeStock.map(col => {
                      // Sin fila de stock la celda dice `0` y no queda vacía:
                      // «hay cero» y «no sé» son cosas distintas, y para decidir
                      // una transferencia hay que saber cuál de las dos es
                      // (FR-067).
                      const entry = filaDeStock(p, col.id)
                      // ⚠ Esta `cantidad` es un NÚMERO y tapa a la función
                      // `cantidad` que este archivo importa de `utils/formato`
                      // (016). Adentro de este bloque, `cantidad(...)` no
                      // formatea nada: es una llamada a un número. Queda
                      // anotado y no renombrado porque la celda la dibuja
                      // `unidades()`, que es otra decisión —esa columna SÍ
                      // agrupa los miles— y cambiarla no es de esta spec.
                      const cantidad = Number(entry?.quantity) || 0
                      const minimo = Number(entry?.min_stock) || 0

                      return (
                        <span key={col.id} className="text-center">
                          {/* El mínimo y el valorizado van en el tooltip y no
                              apilados en la celda: en 92px entra una cantidad y
                              nada más, y tres cifras por sucursal por fila
                              vuelven la tabla ilegible justo cuando hay tres
                              sucursales, que es cuando importa. */}
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  className={`num inline-block min-w-[38px] cursor-default rounded-md border px-2 py-[3px]
                                              text-[12.5px] font-semibold ${tonoDeStock(entry, umbralStockBajo)}`}
                                />
                              }
                            >
                              {unidades(cantidad)}
                            </TooltipTrigger>
                            <TooltipContent>
                              <span className="flex flex-col gap-0.5">
                                <span>{col.name}{col.is_active === false ? ' (inactiva)' : ''}</span>
                                <span className="num">
                                  Mínimo: {minimo > 0 ? unidades(minimo) : 'sin cargar'}
                                </span>
                                <span className="num">
                                  Valorizado: ${pesosRedondos(cantidad * (parseFloat(p.cost) || 0))}
                                </span>
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      )
                    })}

                    <span className="flex justify-end gap-0.5">
                      {/* Transferir desde la fila: es donde se ve que a una
                          sucursal le falta lo que a otra le sobra. El botón
                          frena la propagación (lo hace `BotonDeFila`), así que
                          no abre además el panel del producto. */}
                      {puedeTransferir && columnasDeStock.length > 1 && (
                        <BotonDeFila title="Transferir a otra sucursal" onClick={() => transferirDesdeLaFila(p)}>
                          <ArrowRightLeft />
                        </BotonDeFila>
                      )}
                      <BotonDeFila title="Editar" onClick={() => abrirPanel(p)}>
                        <Edit2 />
                      </BotonDeFila>
                    </span>
                  </Fila>
                )
              })}
            </TablaGrid>

            <PieDeTabla
              mostrados={paginatedProducts.length}
              total={filteredProducts.length}
              sustantivo="productos"
              pagina={page}
              totalPaginas={totalPages}
              alCambiarPagina={setPage}
            />
          </>
        )}
      </section>

      <PreciosMasivos
        open={preciosAbierto}
        onOpenChange={setPreciosAbierto}
        productIds={[...seleccionados]}
        onAplicado={() => {
          // Recargar y soltar la selección: los productos ya cambiaron, y dejar
          // marcados los mismos invita a aplicar el ajuste dos veces.
          initialize()
          limpiarSeleccion()
        }}
      />

      {/* El panel del producto: se edita mirando la lista, no tapándola. */}
      <PanelProducto
        abierto={panelAbierto}
        onOpenChange={cerrarPanel}
        producto={productoAbierto}
        sucursales={sucursales}
        marcas={brands}
        settings={settings}
        onGuardado={alGuardarProducto}
        onCreado={alCrearProducto}
        onDesactivado={alDesactivarProducto}
      />

      {/* Wizard: Importar productos */}
      <ImportWizard
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onSuccess={() => initialize()}
      />

      {/* Transferir: panel y no modal, y con VARIOS productos en una sola
          operación. El formulario anterior movía uno por vez. */}
      <PanelTransferencia
        abierto={isTransfer}
        onOpenChange={(abierto) => {
          setIsTransfer(abierto)
          if (!abierto) setPrecargaDeTransferencia(null)
        }}
        sucursales={sucursales}
        productos={catalogo}
        precarga={precargaDeTransferencia}
        onTransferido={aplicarTransferencia}
      />

    </div>
  )
}

export default Inventory
