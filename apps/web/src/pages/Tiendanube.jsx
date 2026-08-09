import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Link2, Loader2, PackageSearch, RefreshCw, Search, Store, Unlink, X,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Pagination from '@/components/Pagination'
import EstadoDeTiendanube, { UltimaCorrida } from '@/components/EstadoDeTiendanube'
import PanelDeMapeo, { avisoDeError } from '@/components/PanelDeMapeo'
import { BotonDeFila, Encabezado, Fila, TablaGrid } from '@/components/TablaGrid'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import useStore from '@/store/useStore'
import {
  borrarTiendanubeMapeo,
  desvincularTiendanube,
  getTiendanubeAuthUrl,
  getTiendanubePedidos,
  getTiendanubeStatus,
  getTiendanubeVariantes,
  refrescarTiendanubeCatalogo,
  setTiendanubeSucursal,
  sincronizarTiendanube,
} from '@/services/api'
import { fechaCortaDeMomento } from '@/utils/formato'
import {
  ETIQUETAS_DE_MAPEO,
  estadoDeLaConexion,
  estadoDeMapeo,
  etiquetaDeMotivo,
  hayFiltro,
  tonoDeMapeo,
} from '@/utils/tiendanube'
import { faltaElPermiso } from '@/utils/permisos'
import { ESPERA_DE_BUSQUEDA } from '@/utils/busqueda'
import EstadoVacio from '@/components/EstadoVacio'
import PieDeTabla from '@/components/PieDeTabla'

// ════════════════════════════════════════════
//  ADMINAPP · /tiendanube
//
//  La pantalla que el hito 7 pide y que **no existía**: hasta ahora la
//  vinculación era una tarjeta de treinta líneas al final de Ajustes
//  (`Settings.jsx:372-403`) y los endpoints de catálogo, mapeo y sincronización
//  no los llamaba nadie.
//
//  ── Qué se decide acá y qué no ──
//
//  Nada. Los estados, los tonos y el filtro son funciones puras de
//  `utils/tiendanube.js`, y el estado de la conexión lo decide el **servidor**
//  (`GET /status`). Un test de render que verifica una regla es diez veces más
//  lento y se pone en rojo cuando alguien mueve un `<div>`: la regla no cambió y
//  el test igual quedó rojo.
//
//  ── Por qué el filtro sale por la red y no se resuelve acá ──
//
//  `q` y `sin_mapear` van como parámetros de `GET /variantes`. La lista está
//  **paginada de a cincuenta desde el servidor** (hallazgo 10: hasta este hito
//  llegaba una sola página de TiendaNube y nada avisaba), así que filtrar la
//  página cargada respondería «no hay resultados» sobre una variante que existe
//  en la página 3. Es literalmente el defecto que la funcionalidad 012 encontró
//  en el buscador de órdenes, y por eso `filtrarVariantes` **no** se usa para la
//  tabla; lo que sí se usa es `hayFiltro`, que es lo que separa dos de los cuatro
//  estados vacíos.
//
//  ── Lo que esta pantalla afirma, y que tiene que ser cierto ──
//
//  Es la mitad del valor de esta pantalla, y es donde la anterior mentía. La
//  tarjeta de Ajustes decía «sincronización bidireccional» y «El stock se
//  sincroniza automáticamente mediante webhooks»: la primera no aclaraba qué va
//  en cada sentido y la segunda describía un webhook que **respondía 401 a
//  todo** y no descontó un solo pedido. Es la misma familia de error que
//  `sendEmail` devolviendo `ok: true` sin haber enviado. Esa tarjeta se sacó en
//  T1345 y en `/facturacion` quedó un enlace a acá.
//
//  Los cuatro avisos del bloque «Qué hace y qué no hace» son FR-073, FR-074, US7
//  escenario 3 y [PENDIENTE N5]. Ninguno es relleno: el primero es la diferencia
//  entre cerrar la caja cuadrada y no poder explicar un faltante.
//
//  ── Y los dos bloques que contestan «¿anduvo?» ──
//
//  `UltimaCorrida` dice qué pasó la última vez que se empujó stock —cuántas
//  entraron, cuáles no y por qué— y `PedidosConProblemas` dice qué NO descontó
//  un pedido de la tienda. Los dos existen porque hasta este hito la respuesta a
//  «¿el stock de mi tienda está bien?» era «probablemente, y no hay forma de
//  saberlo».
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/** Cuántas variantes trae una página. Es el valor por defecto del servidor. */
const POR_PAGINA = 50

/**
 * Cuántos pedidos con problemas se listan.
 *
 * Es el valor por defecto de `GET /pedidos` y no se pagina: esta lista es un
 * aviso —«esto no descontó, arreglalo»— y no un historial. Si hay más de
 * veinticinco pedidos con ítems sin descontar, el problema no se resuelve
 * paginando sino mirando por qué se rompió el mapeo.
 */
const PEDIDOS_POR_PAGINA = 25

/** Los dos estados en los que hay una tienda del otro lado. */
const CON_TIENDA = ['vinculada', 'vinculada_con_error']

/**
 * El `grid-template-columns` de la tabla, escrito UNA vez.
 *
 * El encabezado y las filas comparten este mismo string. Cuando difieren, las
 * etiquetas dejan de estar sobre sus datos y se lee un stock bajo «SKU» — el
 * defecto 2 del relevamiento del hito 5, que no detectó ningún test hasta que se
 * compararon los dos strings.
 */
const COLUMNAS = 'minmax(0,1.7fr) 116px 96px minmax(0,1.3fr) 100px 136px 56px'

/**
 * Qué pasó cuando el callback del OAuth volvió con un error.
 *
 * ⚠ **El `default` no es defensivo de más: es el requisito.** El controlador
 * tiene un séptimo motivo, `error_interno`, que no está en el contrato de los
 * seis caminos previstos —lo devuelve el `catch` que envuelve al handler— y
 * cualquier motivo que se agregue mañana llega acá sin que esta pantalla lo
 * sepa. Sin un texto por defecto, un motivo desconocido dibuja una franja vacía:
 * el usuario vuelve de TiendaNube, algo falló y la pantalla no dice nada.
 */
const MOTIVOS_DEL_CALLBACK = {
  sin_codigo:
    'TiendaNube no devolvió el código de autorización. Volvé a apretar «Conectar con TiendaNube».',
  state_invalido:
    'El pedido de conexión venció o ya se había usado. Es de un solo uso: empezá la conexión de nuevo desde acá.',
  tienda_ocupada:
    'Esa tienda ya está vinculada a otra empresa. Desvinculala de allá antes de conectarla acá.',
  tiendanube:
    'TiendaNube no pudo completar la conexión. No es un problema de AdminApp: probá de nuevo en unos minutos.',
  sin_sucursal:
    'Tu empresa no tiene ninguna sucursal cargada, y hace falta una para saber de dónde sale el stock que se publica.',
  error_interno:
    'La conexión falló del lado de AdminApp, no de TiendaNube. No se guardó nada: volvé a intentar y, si sigue igual, avisá con la hora exacta.',
}

const MOTIVO_DESCONOCIDO =
  'No se pudo vincular la tienda. No se guardó nada. Volvé a intentar y, si sigue igual, avisá con la hora exacta.'

/** Clases del botón secundario del sistema (34px, borde, hover en surface-3). */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface ' +
  'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/** Clases del botón principal del sistema. Uno por pantalla. */
const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/**
 * Uno de los CUATRO estados vacíos de FR-055.
 *
 * `codigo` queda en el DOM a propósito: los cuatro dicen cosas distintas y esa
 * es la afirmación que hay que poder verificar. Con el mismo texto, «tu tienda
 * no tiene productos» y «el filtro no devolvió nada» se leen igual, y la acción
 * que sugiere cada uno es opuesta —cargar productos en TiendaNube contra borrar
 * el filtro—.
 */
// ════════════════════════════════════════════
//  Lo que un pedido NO descontó
//
//  Es el criterio 5 del lado de la pantalla: **un ítem que no descontó se puede
//  ver**. Hasta este hito los cuatro motivos eran un `continue` en silencio
//  (`tiendanubeService.js:129,134,144`) y lo único que quedaba era que el
//  inventario estaba mal — un faltante sin fecha, sin motivo y sin pedido, que
//  aparece en un recuento físico tres meses después, cuando ya no se puede
//  reconstruir qué pasó.
//
//  ── Por qué es una lista y no una `TablaGrid` ──
//
//  Un pedido tiene ítems adentro, y cada ítem tiene su motivo: es una jerarquía
//  de dos niveles, no filas de un mismo ancho. Meterla en un grid obligaría a
//  inventar una columna «motivo» que solo tiene sentido en el segundo nivel, o a
//  aplanar el pedido en tantas filas como ítems y repetir su número en cada una.
//  El molde de este dibujo es `components/HistorialDeCostos.jsx`.
//
//  ── Y por qué se listan SOLO los que tienen problemas ──
//
//  Los pedidos que descontaron todo son casi todos. Mezclados, los tres que hay
//  que mirar quedan escondidos entre doscientos que están bien: la lista se
//  vuelve un historial, y un historial no es un aviso.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {Array<object>} props.pedidos Los de `GET /pedidos?solo_con_problemas=true`.
 * @param {number} props.total Cuántos hay en total, que puede ser más que los
 *   que llegaron en esta página.
 */
function PedidosConProblemas({ pedidos, total }) {
  return (
    <section
      data-bloque="pedidos-con-problemas"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Pedidos con ítems que no descontaron</h2>
        <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
          {total}
        </span>
      </div>

      {pedidos.length === 0 ? (
        // ⚠ Vacío NO es un hueco. Un bloque sin nada adentro se lee como un
        // error de carga; esto dice que se miró y que no había nada, que es una
        // buena noticia y hay que poder distinguirla de «no cargó».
        <div className="px-5 py-8 text-center">
          <p className="font-semibold">Ningún pedido quedó con ítems sin descontar.</p>
          <p className="mx-auto mt-1 max-w-[56ch] text-sm text-fg-2">
            Cada pedido pagado en tu tienda bajó el inventario completo. Si alguno no
            pudiera —porque la variante no está mapeada, o porque el producto no tiene
            stock en la sucursal de la tienda— iba a aparecer acá con su motivo.
          </p>
        </div>
      ) : (
        <>
          {pedidos.map((pedido) => {
            // Solo los que NO descontaron: los que sí no aportan nada acá y
            // esconderían a los que importan. El pedido igual dice cuántos
            // fueron cada uno.
            const sinDescontar = (pedido.items || []).filter((item) => !item.descontado)

            return (
              <div key={pedido.id} className="border-b border-border px-5 py-3.5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[13.5px] font-semibold">
                    {/* El número que ve el comprador, no el id interno: es lo
                        que el cliente va a decir por teléfono. */}
                    Pedido <span className="num">#{pedido.numero || pedido.tiendanube_order_id}</span>
                  </span>

                  <span className="num text-[12.5px] text-fg-3">
                    {fechaCortaDeMomento(pedido.recibido_en)}
                  </span>

                  <span className="text-[12.5px] text-fg-2">
                    <span className="num">{pedido.items_descontados ?? 0}</span> descontaron
                  </span>

                  <span className="rounded-md border border-danger-line bg-danger-soft px-2 py-[2px] text-[11.5px] font-semibold text-danger">
                    <span className="num">{pedido.items_sin_descontar ?? sinDescontar.length}</span>
                    {' '}sin descontar
                  </span>
                </div>

                <ul className="mt-2 flex flex-col gap-1">
                  {sinDescontar.map((item, i) => (
                    <li
                      key={`${item.variante ?? 'sin-variante'}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5"
                    >
                      <span className="num text-[12.5px] text-fg-3">
                        Variante {item.variante ?? 'sin identificar'}
                      </span>
                      <span className="num text-[12.5px] text-fg-2">
                        ×{item.cantidad ?? 0}
                      </span>
                      {/* En castellano y NUNCA el código de la base:
                          `sin_stock_en_sucursal` en pantalla se lee como un
                          error del sistema y manda a abrir un ticket por algo
                          que está funcionando. */}
                      <span className="min-w-0 flex-1 text-[12.5px]">
                        {etiquetaDeMotivo(item.motivo)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {total > pedidos.length && (
            <p className="border-t border-border bg-surface-2 px-5 py-2.5 text-[12.5px] text-fg-2">
              Se muestran los <span className="num">{pedidos.length}</span> más recientes de{' '}
              <span className="num">{total}</span>. Con tantos pedidos sin descontar, lo que
              hay que revisar es el mapeo y el stock de la sucursal, no esta lista.
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** Una línea del bloque «Qué hace y qué no hace». */
function Advertencia({ children }) {
  return (
    <li className="flex items-start gap-2">
      <ArrowRight className="mt-[3px] h-3.5 w-3.5 shrink-0 text-fg-3" />
      <span className="text-[13px] leading-relaxed text-fg-2">{children}</span>
    </li>
  )
}

export default function Tiendanube() {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [parametros, setParametros] = useSearchParams()

  const empresaActiva = useStore((s) => s.empresaActiva)
  const sucursales = useMemo(() => empresaActiva?.puntosDeVenta || [], [empresaActiva])

  const [status, setStatus] = useState(null)
  const [cargandoEstado, setCargandoEstado] = useState(true)
  const [ocupado, setOcupado] = useState(false)

  const [variantes, setVariantes] = useState([])
  const [total, setTotal] = useState(0)
  const [cargandoVariantes, setCargandoVariantes] = useState(false)
  const [pagina, setPagina] = useState(1)

  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloSinMapear, setSoloSinMapear] = useState(false)

  const [abierta, setAbierta] = useState(null)
  const [avisoDelCallback, setAvisoDelCallback] = useState(null)

  const [pedidosConProblemas, setPedidosConProblemas] = useState([])
  const [totalDePedidos, setTotalDePedidos] = useState(0)

  // No es un dato: es la señal de «volvé a pedir la corrida». `UltimaCorrida`
  // trae lo suyo por su cuenta, así que sin esto sincronizar dejaría el bloque
  // mostrando el resultado de la corrida ANTERIOR — la forma más directa de
  // hacer creer que el botón no hizo nada.
  const [refrescoDeCorrida, setRefrescoDeCorrida] = useState(0)

  const puedeEditar = can('config.editar')

  const estado = estadoDeLaConexion(status)
  const hayTienda = CON_TIENDA.includes(estado)
  const tienda = status?.tienda || null
  const totalDeVariantes = Number(status?.variantes?.total) || 0
  const mapeadas = Number(status?.variantes?.mapeadas) || 0

  const cargarEstado = useCallback(async () => {
    setCargandoEstado(true)
    try {
      const res = await getTiendanubeStatus()
      setStatus(res.data || null)
    } catch (err) {
      // ⚠ Un fallo de `/status` NO es «no vinculada» (FR-006, US1 escenario 10).
      // La tarjeta de Ajustes se comía el error con un `console.error` y dejaba
      // el booleano en `false`, así que una caída de red y una tienda sin
      // conectar se veían idénticas. Acá el `null` cae en `no_comprobada`, que
      // dice «no sabemos».
      setStatus(null)
    } finally {
      setCargandoEstado(false)
    }
  }, [])

  const cargarVariantes = useCallback(async () => {
    setCargandoVariantes(true)
    try {
      const res = await getTiendanubeVariantes({
        page: pagina,
        limit: POR_PAGINA,
        ...(busqueda ? { q: busqueda } : {}),
        ...(soloSinMapear ? { sin_mapear: true } : {}),
      })

      setVariantes(res.data?.data || [])
      setTotal(Number(res.data?.total) || 0)
    } catch (err) {
      setVariantes([])
      setTotal(0)
      toast.error(avisoDeError(err, 'No se pudieron traer las variantes de tu tienda.'))
    } finally {
      setCargandoVariantes(false)
    }
  }, [pagina, busqueda, soloSinMapear])

  /**
   * Los pedidos que entraron por el webhook y **no descontaron todo** (FR-027).
   *
   * `solo_con_problemas=true` no es un filtro de comodidad: los pedidos que
   * descontaron todo son casi todos, y una lista con todos adentro esconde
   * justamente los tres que hay que mirar. Del otro lado, ese parámetro usa el
   * índice parcial `idx_tn_pedidos_pendientes`.
   *
   * Un fallo acá **no muestra un toast**: es un bloque secundario y un error de
   * red en él no puede tapar la pantalla. Se deja vacío y el propio bloque dice
   * que no pudo leerse.
   */
  const cargarPedidos = useCallback(async () => {
    try {
      const res = await getTiendanubePedidos({
        solo_con_problemas: true,
        page: 1,
        limit: PEDIDOS_POR_PAGINA,
      })

      setPedidosConProblemas(res.data?.data || [])
      setTotalDePedidos(Number(res.data?.total) || 0)
    } catch {
      setPedidosConProblemas([])
      setTotalDePedidos(0)
    }
  }, [])

  useEffect(() => { cargarEstado() }, [cargarEstado])

  useEffect(() => {
    if (!hayTienda) return
    cargarVariantes()
  }, [hayTienda, cargarVariantes])

  useEffect(() => {
    if (!hayTienda) return
    cargarPedidos()
  }, [hayTienda, cargarPedidos])

  // El rebote existe para que escribir «Colágeno» no sean ocho consultas: la
  // búsqueda la resuelve el servidor y la API tiene un límite por IP.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      setBusqueda(texto.trim())
      setPagina(1)
    }, ESPERA_DE_BUSQUEDA)

    return () => clearTimeout(temporizador)
  }, [texto])

  /**
   * El resultado del OAuth, que vuelve como `?estado=ok|error&motivo=…`.
   *
   * Va como aviso en la pantalla y no como toast: un toast se va solo a los
   * cinco segundos y esto es algo que hay que leer y sobre lo que hay que hacer
   * algo. Los parámetros se limpian para que recargar no repita el aviso de una
   * conexión que ya pasó.
   */
  useEffect(() => {
    const resultado = parametros.get('estado')
    if (!resultado) return

    if (resultado === 'ok') {
      setAvisoDelCallback({ tono: 'ok', texto: 'Tu tienda quedó vinculada.' })
    } else {
      setAvisoDelCallback({
        tono: 'error',
        texto: MOTIVOS_DEL_CALLBACK[parametros.get('motivo')] || MOTIVO_DESCONOCIDO,
      })
    }

    setParametros({}, { replace: true })
  }, [parametros, setParametros])

  const conectar = async () => {
    setOcupado(true)
    try {
      const res = await getTiendanubeAuthUrl()
      // La URL lleva el `state` de un solo uso que el servidor acaba de crear.
      window.location.href = res.data.url
    } catch (err) {
      toast.error(avisoDeError(err, 'No se pudo empezar la conexión con TiendaNube.'))
      setOcupado(false)
    }
  }

  const desvincular = async () => {
    setOcupado(true)
    try {
      const res = await desvincularTiendanube()
      toast.success(
        `Tienda desvinculada. Se conservaron ${res.data?.mapeos_conservados ?? 0} mapeos.`
      )
      setVariantes([])
      setTotal(0)
      await cargarEstado()
    } catch (err) {
      toast.error(avisoDeError(err, 'No se pudo desvincular la tienda.'))
    } finally {
      setOcupado(false)
    }
  }

  const cambiarSucursal = async (puntoDeVentaId) => {
    try {
      const res = await setTiendanubeSucursal(puntoDeVentaId)
      toast.success(
        `Ahora se publica el stock de ${res.data?.punto_de_venta?.name}. ` +
        `Se encolaron ${res.data?.encoladas ?? 0} variantes.`
      )
      await cargarEstado()
      await cargarVariantes()
      // Cambiar la sucursal encola TODAS las variantes mapeadas —el número que
      // publica la tienda sale de esa sucursal y cambia entero—, así que el
      // bloque de la cola queda viejo en el mismo instante.
      setRefrescoDeCorrida((n) => n + 1)
    } catch (err) {
      toast.error(avisoDeError(err, 'No se pudo cambiar la sucursal de la tienda.'))
    }
  }

  const refrescarCatalogo = async () => {
    setOcupado(true)
    try {
      const res = await refrescarTiendanubeCatalogo()
      toast.success(
        `Catálogo actualizado: ${res.data?.variantes ?? 0} variantes, ${res.data?.nuevas ?? 0} nuevas.`
      )
      await cargarEstado()
      await cargarVariantes()
    } catch (err) {
      toast.error(avisoDeError(err, 'No se pudo refrescar el catálogo de tu tienda.'))
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Empuja el stock de todas las variantes mapeadas.
   *
   * ⚠ El botón queda ocupado mientras la llamada está en el aire, y eso es lo
   * único que evita la segunda corrida. Sin la bandera, dos clics seguidos
   * mandan dos: la segunda choca contra el arriendo del servidor y devuelve 409,
   * así que el usuario ve un error por haber apretado dos veces algo que estaba
   * andando bien (US5 escenario 5).
   *
   * ⚠⚠ **Sin ningún mapeo no sale ninguna llamada** (US5 escenario 9). El
   * servidor también lo rechaza —400 «No hay ningún producto mapeado»— pero
   * llegar hasta allá para que te digan que no, cuando `GET /status` ya contestó
   * que hay cero mapeadas, es un viaje que solo sirve para que la respuesta
   * parezca un error del sistema.
   */
  const sincronizar = async () => {
    if (mapeadas === 0) {
      toast.error(
        'No hay ningún producto mapeado, así que no hay stock que empujar. ' +
        'Abrí una variante de la lista y elegí contra qué producto del sistema va.'
      )
      return
    }

    setOcupado(true)
    try {
      const res = await sincronizarTiendanube()
      toast.success(
        `${res.data?.mandadas ?? 0} variantes actualizadas, ${res.data?.fallidas ?? 0} con error.`
      )
      await cargarEstado()
      await cargarVariantes()
      setRefrescoDeCorrida((n) => n + 1)
    } catch (err) {
      toast.error(avisoDeError(err, 'No se pudo sincronizar el stock con TiendaNube.'))
    } finally {
      setOcupado(false)
    }
  }

  const quitarMapeo = async (variante) => {
    const ok = await confirm(
      `¿Quitar el mapeo de «${variante.mapeo?.product_name}» con la variante ` +
      `«${variante.nombre_producto}${variante.nombre_variante ? ` · ${variante.nombre_variante}` : ''}»? ` +
      `La variante deja de recibir stock y vuelve a «Sin mapear».`,
      { verbo: 'Quitar mapeo' }
    )
    if (!ok) return

    try {
      await borrarTiendanubeMapeo(variante.mapeo.id)
      await cargarEstado()
      await cargarVariantes()
    } catch (err) {
      toast.error(avisoDeError(err, 'No se pudo quitar el mapeo.'))
    }
  }

  const filtroPuesto = hayFiltro({ q: busqueda, soloSinMapear })
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const sucursalDeLaTienda = tienda?.punto_de_venta?.name || 'la sucursal designada'

  return (
    <div className="anim-subida flex flex-col gap-6">
      <PageHeader
        titulo="TiendaNube"
        descripcion="Conectá tu tienda online, decí qué producto del sistema es cada variante y empujales el stock. El stock va de AdminApp a tu tienda; los pedidos vienen de tu tienda a AdminApp."
        icono={Store}
      >
        {hayTienda && (
          <button type="button" className={BOTON_SECUNDARIO} onClick={refrescarCatalogo} disabled={ocupado}>
            <RefreshCw className="h-3.5 w-3.5 text-fg-3" />
            Refrescar catálogo
          </button>
        )}

        {hayTienda ? (
          <>
            <button
              type="button"
              className={BOTON_PRINCIPAL}
              onClick={sincronizar}
              // ⚠ `ocupado` es lo ÚNICO que evita la segunda corrida: mientras la
              // llamada está en el aire el botón no se puede volver a apretar.
              disabled={!puedeEditar || ocupado || tienda?.sincronizando}
            >
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sincronizar stock
            </button>

            {/* US5 escenario 10: DESHABILITADO con su explicación, no ausente.
                Un botón que no está parece una función que no existe y manda a
                buscarla a otro lado; uno deshabilitado que dice por qué manda a
                pedir el permiso, que es lo que hay que hacer. */}
            {!puedeEditar && (
              <p className="w-full text-[12.5px] text-fg-3">
                No podés sincronizar el stock: {faltaElPermiso('config.editar').toLowerCase()}.
              </p>
            )}

            {puedeEditar && tienda?.sincronizando && (
              <p className="w-full text-[12.5px] text-fg-3">
                Hay una sincronización en curso. Cuando termine vas a poder empezar otra.
              </p>
            )}
          </>
        ) : (
          // ⚠ Solo con `no_vinculada`. Con `sin_configurar` el botón no llevaría
          // a ningún lado —falta la credencial del servidor— y con
          // `no_comprobada` sería peor: ofrecer «Conectar» sobre una tienda que
          // puede estar conectada es el defecto de hoy con otro traje, y termina
          // en alguien vinculando dos veces.
          estado === 'no_vinculada' && (
            <button
              type="button"
              className={BOTON_PRINCIPAL}
              onClick={conectar}
              disabled={!puedeEditar || ocupado}
            >
              <Link2 className="h-4 w-4" />
              Conectar con TiendaNube
            </button>
          )
        )}
      </PageHeader>

      {/* ── El resultado del OAuth ── */}
      {avisoDelCallback && (
        <div
          role="alert"
          className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${
            avisoDelCallback.tono === 'ok'
              ? 'border-ok-line bg-ok-soft'
              : 'border-danger-line bg-danger-soft'
          }`}
        >
          <AlertTriangle
            className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${
              avisoDelCallback.tono === 'ok' ? 'text-ok' : 'text-danger'
            }`}
          />
          <p className="flex-1 text-[13.5px] font-medium">{avisoDelCallback.texto}</p>
          <button
            type="button"
            onClick={() => setAvisoDelCallback(null)}
            title="Cerrar el aviso"
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-lg text-fg-3
                       transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        </div>
      )}

      <EstadoDeTiendanube
        status={status}
        cargando={cargandoEstado}
        sucursales={sucursales}
        ocupado={ocupado}
        onConectar={conectar}
        onDesvincular={desvincular}
        onCambiarSucursal={cambiarSucursal}
        onReintentar={cargarEstado}
      />

      {/* ── El resultado de la última corrida y la cola ──

          Solo con tienda vinculada: sin ella no hay corridas que mostrar y el
          bloque diría «todavía no se sincronizó» sobre algo que no se puede
          sincronizar. El bloque pide sus datos por su cuenta (T1343). */}
      {hayTienda && <UltimaCorrida refresco={refrescoDeCorrida} />}

      {/* ── Lo que un pedido no descontó ── */}
      {hayTienda && (
        <PedidosConProblemas pedidos={pedidosConProblemas} total={totalDePedidos} />
      )}

      {/* ── Qué hace y qué no hace ──

          Es la mitad del valor de esta pantalla. La tarjeta que este hito saca
          de Ajustes afirma dos cosas falsas, y quien las creyó cerró la caja con
          una diferencia que no pudo explicar. */}
      <section className="rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1">
        <h2>Qué hace y qué no hace esta integración</h2>

        <ul className="mt-3 flex flex-col gap-2">
          <Advertencia>
            <strong>Un pedido de tu tienda baja el inventario y no registra una venta.</strong>{' '}
            No aparece en facturación, ni en el flujo de caja, ni en los reportes: el stock
            sale del depósito sin ingreso asociado.
          </Advertencia>

          <Advertencia>
            <strong>Cada dato va en un solo sentido.</strong> El stock va de AdminApp a tu
            tienda, y AdminApp manda: la sincronización pisa el número de la tienda. Los
            pedidos vienen de tu tienda a AdminApp. Los precios, las fotos y el alta de
            productos no viajan en ninguna dirección.
          </Advertencia>

          <Advertencia>
            <strong>Se publica el stock disponible</strong> —lo que se puede vender, no lo
            que hay guardado— <strong>de la sucursal «{sucursalDeLaTienda}»</strong>. Un
            producto con 10 en el depósito y 3 comprometidos publica 7.
          </Advertencia>

          <Advertencia>
            <strong>Un pedido cancelado o devuelto en TiendaNube no repone el stock.</strong>{' '}
            Hay que ajustarlo a mano desde Inventario: reponer solo, sin una guarda propia,
            repondría dos veces ante un reintento.
          </Advertencia>
        </ul>
      </section>

      {/* ── Las variantes de la tienda ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
          <h2>Variantes de tu tienda</h2>
          <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
            {totalDeVariantes}
          </span>
          <span className="text-[12.5px] text-fg-3">
            <span className="num">{mapeadas}</span> mapeadas
          </span>

          <div className="flex-1" />

          {cargandoVariantes && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}

          {/* ⚠ La lupa, y el `placeholder` con el verbo.
              Era el único buscador de la aplicación sin ícono: sin lupa, un
              campo no se lee como buscador —se lee como un campo más que hay
              que completar— y el placeholder decía «Nombre o SKU», que nombra
              lo que se escribe pero no dice que sirva para buscar. Los otros
              seis buscadores tienen las dos cosas. */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-fg-3" />
            <input
              aria-label="Buscar variantes"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              placeholder="Buscar por nombre o SKU…"
              disabled={!hayTienda}
              className="h-[34px] w-[220px] rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px]
                         transition-colors focus-visible:border-brand focus-visible:outline-none
                         disabled:cursor-not-allowed disabled:opacity-55"
            />
          </div>

          <label className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium">
            <input
              type="checkbox"
              checked={soloSinMapear}
              disabled={!hayTienda}
              onChange={(evento) => { setSoloSinMapear(evento.target.checked); setPagina(1) }}
            />
            Solo sin mapear
          </label>
        </div>

        {!hayTienda ? (
          <EstadoVacio
            icono={PackageSearch}
            codigo="sin_tienda"
            titulo="Todavía no hay ninguna tienda conectada."
            detalle="Cuando conectes tu tienda de TiendaNube vas a ver acá cada variante de tu catálogo, con su SKU y el stock que publica."
          />
        ) : totalDeVariantes === 0 ? (
          <EstadoVacio
            icono={PackageSearch}
            codigo="tienda_sin_productos"
            titulo="Tu tienda no tiene ninguna variante cargada."
            detalle="Cargá productos en el panel de TiendaNube y después apretá «Refrescar catálogo» para traerlos acá."
          />
        ) : variantes.length === 0 && filtroPuesto ? (
          <EstadoVacio
            icono={PackageSearch}
            codigo="filtro_sin_resultados"
            titulo="Ninguna variante coincide con el filtro."
            detalle="Probá con otro texto o sacá «Solo sin mapear». Las variantes siguen ahí: lo que no encontró nada es la búsqueda."
          />
        ) : (
          <>
            {mapeadas === 0 && (
              <EstadoVacio
            icono={PackageSearch}
                codigo="sin_mapeos"
                titulo="Todavía no mapeaste ningún producto."
                detalle="Mientras ninguna variante esté mapeada, el stock que publica tu tienda no lo toca nadie. Abrí una variante de la lista y elegí contra qué producto del sistema va."
              />
            )}

            {!puedeEditar && (
              <p className="border-b border-border bg-surface-2 px-5 py-2.5 text-[12.5px] text-fg-2">
                Estás viendo los mapeos en modo lectura: {faltaElPermiso('config.editar').toLowerCase()},
                así que no podés crearlos ni quitarlos.
              </p>
            )}

            <TablaGrid anchoMinimo={1040}>
              <Encabezado columnas={COLUMNAS}>
                <span>Variante de la tienda</span>
                <span>SKU</span>
                <span className="text-right">En la tienda</span>
                <span>Producto del sistema</span>
                <span className="text-right">Disponible</span>
                <span>Estado</span>
                <span />
              </Encabezado>

              {variantes.map((variante) => {
                const estadoDeLaFila = estadoDeMapeo(variante)

                return (
                  <Fila
                    key={variante.tiendanube_variant_id}
                    columnas={COLUMNAS}
                    onClick={() => setAbierta(variante)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium" title={variante.nombre_producto}>
                        {variante.nombre_producto}
                      </p>
                      {variante.nombre_variante && (
                        <p className="truncate text-[12px] text-fg-3">{variante.nombre_variante}</p>
                      )}
                    </div>

                    <span className="num truncate text-[13px] text-fg-2">{variante.sku || '—'}</span>

                    <span className="num text-right text-[13.5px]">
                      {variante.stock_en_tienda ?? '—'}
                    </span>

                    <span className="truncate text-[13px]" title={variante.mapeo?.product_name || ''}>
                      {variante.mapeo?.product_name || <span className="text-fg-3">—</span>}
                    </span>

                    <span className="num text-right text-[13.5px]">
                      {variante.disponible ?? '—'}
                    </span>

                    <span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeMapeo(estadoDeLaFila)}`}
                      >
                        {ETIQUETAS_DE_MAPEO[estadoDeLaFila]}
                      </span>
                    </span>

                    <span className="flex justify-end">
                      {variante.mapeo ? (
                        <BotonDeFila
                          onClick={() => quitarMapeo(variante)}
                          disabled={!puedeEditar}
                          title="Quitar mapeo"
                        >
                          <Unlink />
                        </BotonDeFila>
                      ) : (
                        <BotonDeFila
                          onClick={() => setAbierta(variante)}
                          disabled={!puedeEditar}
                          title="Mapear esta variante"
                        >
                          <Link2 />
                        </BotonDeFila>
                      )}
                    </span>
                  </Fila>
                )
              })}
            </TablaGrid>

            <PieDeTabla
              mostrados={variantes.length}
              total={totalDeVariantes}
              sustantivo="variantes"
              pagina={pagina}
              totalPaginas={paginas}
              alCambiarPagina={setPagina}
            />
          </>
        )}
      </section>

      <PanelDeMapeo
        variante={abierta}
        abierto={Boolean(abierta)}
        onOpenChange={(abierto) => { if (!abierto) setAbierta(null) }}
        onCambio={async () => { await cargarEstado(); await cargarVariantes() }}
      />

      <ConfirmDialog />
    </div>
  )
}
