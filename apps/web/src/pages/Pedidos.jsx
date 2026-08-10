import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Inbox, Info, Loader2 } from 'lucide-react'
import api from '@/services/api'
import PageHeader from '@/components/PageHeader'
import EstadoVacio from '@/components/EstadoVacio'
import { TablaGrid, Encabezado, Fila } from '@/components/TablaGrid'
import PanelDePedido from '@/components/PanelDePedido'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { pesos, fechaCortaDeMomento } from '@/utils/formato'
import { ESTADOS_DE_PEDIDO, etiquetaDeEstadoDePedido, tonoDeEstadoDePedido, numeroDePedido } from '@/utils/pedidos'

// ════════════════════════════════════════════
//  FAVALIO · Pedidos
//
//  La bandeja: todo lo que entró por los catálogos públicos, con su estado y el
//  panel lateral para operarlo.
//
//  ── El aviso permanente, y por qué no se puede cerrar ──
//
//  «Marcar cobrado» cambia **un estado** y nada más: no descuenta stock, no
//  registra la venta y no toca la caja. La maqueta no lo dice, y una pantalla que
//  no lo dice produce exactamente el error que este módulo tiene que evitar —el
//  comercio marca veinte pedidos cobrados, da por hecho que el inventario se
//  movió, y a fin de mes el stock no cierra—.
//
//  Por eso el aviso **no tiene botón de cerrar, no guarda preferencia y se
//  muestra en cada visita** (FR-167a). Un aviso que se cierra es un aviso que se
//  cierra el primer día, y el que entra a la pantalla en marzo es el que más lo
//  necesita.
//
//  ── La columna «Canal» no es decoración ──
//
//  Hoy dice siempre `catalogo`, porque hoy hay un solo canal. Está desde el
//  primer día para que cuando entre el segundo no haya que migrar datos ni
//  enseñarle una columna nueva a una pantalla que ya está en producción — es la
//  misma decisión que la columna `origen` de la tabla.
//
//  📌 **Los pedidos de TiendaNube NO entran acá.** `tiendanube_pedidos` no es
//  una bandeja: es el **libro de idempotencia del webhook de stock**. Sus filas
//  son inmutables, no se borran nunca, y no tienen comprador, total, estado,
//  entrega ni medio de pago. Unificar las dos tablas obligaría a llenar seis
//  columnas con nulos en una de ellas y a explicar en cada consulta cuál de los
//  dos significados tiene la fila que se está leyendo.
//
//  ── Los dos vacíos son distintos ──
//
//  «Todavía no entró ningún pedido» y «el filtro no devolvió nada» son dos
//  pantallas: la segunda tiene una salida —sacar el filtro— que la primera no
//  tiene, y decirle «todavía no entró ninguno» a alguien que filtró por
//  «entregados» es mentirle. Lo distingue `hay_filtros`, que manda el servidor.
//
//  Reglas: `docs/REGLAS-DISENO.md`.
// ════════════════════════════════════════════

/**
 * Las columnas de la bandeja.
 *
 * El MISMO string en el encabezado y en las filas: si difieren, las etiquetas
 * dejan de estar sobre sus datos y se lee un total bajo «Canal».
 */
const COLUMNAS = '92px minmax(0,1fr) 132px 108px 116px 116px'

const PILDORA =
  'inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] '
  + 'font-medium transition-colors'

const CAMPO =
  'h-[30px] rounded-lg border border-border bg-surface px-2 text-[12.5px] '
  + 'transition-colors focus-visible:border-brand focus-visible:outline-none'

export default function Pedidos() {
  const [datos, setDatos] = useState(null)
  // Arranca en `true` para que el primer pintado muestre el spinner y no el
  // vacío: al revés, la pantalla afirma «todavía no entró ningún pedido»
  // mientras la bandeja viaja por la red.
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [estado, setEstado] = useState('')
  const [catalogoId, setCatalogoId] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [catalogos, setCatalogos] = useState([])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = {}
      if (estado) params.estado = estado
      if (catalogoId) params.catalogo_id = catalogoId

      const res = await api.get('/pedidos', { params })
      setDatos(res.data?.data || null)
      setError(null)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los pedidos.'))
    } finally {
      setCargando(false)
    }
  }, [estado, catalogoId])

  useEffect(() => { cargar() }, [cargar])

  // El filtro por catálogo necesita los nombres, y son de otra tabla. Se piden
  // una sola vez: la lista de catálogos de una empresa no cambia mientras
  // alguien mira la bandeja.
  useEffect(() => {
    api.get('/catalogos')
      .then((res) => setCatalogos(res.data?.data || []))
      .catch(() => setCatalogos([]))
  }, [])

  const nombreDelCatalogo = useMemo(
    () => new Map(catalogos.map((c) => [c.id, c.nombre_visible])),
    [catalogos]
  )

  const pedidos = datos?.pedidos || []
  const porEstado = datos?.por_estado || {}

  /** Refresca la fila que cambió sin recargar la bandeja entera. */
  const alCambiarEstado = (actualizado) => {
    setDatos((d) => (d ? {
      ...d,
      pedidos: d.pedidos.map((p) => (p.id === actualizado.id ? { ...p, estado: actualizado.estado } : p)),
    } : d))
    // Los números de las píldoras sí cambian, y salen del servidor: recalcularlos
    // acá sería una segunda cuenta que se desincroniza de la primera.
    cargar()
  }

  return (
    <div className="anim-subida flex flex-col gap-6">

      <PageHeader
        titulo="Pedidos"
        descripcion="Lo que entró por los catálogos públicos. Se opera desde acá: el comprador ve el estado que le pongas."
        icono={Inbox}
      />

      {/* ⚠ Sin botón de cerrar y sin preferencia de ocultamiento (FR-167a). */}
      <div
        data-aviso-bandeja
        role="note"
        className="flex items-start gap-2.5 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3"
      >
        <Info className="mt-0.5 h-4 w-4 flex-none text-warn" />
        <p className="text-[13px] leading-relaxed text-fg-2">
          Marcar un pedido como cobrado cambia su estado. Por ahora no descuenta stock ni registra
          la venta: eso se hace a mano desde el punto de venta.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-filtro-estado=""
          onClick={() => setEstado('')}
          className={`${PILDORA} ${estado === '' ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface hover:bg-surface-3'}`}
        >
          Todos
          <span className="tabular-nums text-fg-3">{datos?.total ?? 0}</span>
        </button>

        {ESTADOS_DE_PEDIDO.map((clave) => (
          <button
            key={clave}
            type="button"
            data-filtro-estado={clave}
            onClick={() => setEstado(clave)}
            className={`${PILDORA} ${estado === clave ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface hover:bg-surface-3'}`}
          >
            {etiquetaDeEstadoDePedido(clave)}
            <span className="tabular-nums text-fg-3">{porEstado[clave] ?? 0}</span>
          </button>
        ))}

        <select
          data-filtro-catalogo
          aria-label="Catálogo"
          value={catalogoId}
          onChange={(e) => setCatalogoId(e.target.value)}
          className={`${CAMPO} ml-auto`}
        >
          <option value="">Catálogo: todos</option>
          {catalogos.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre_visible}</option>
          ))}
        </select>
      </div>

      {cargando && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
        </div>
      )}

      {!cargando && error && (
        <EstadoVacio codigo="error" titulo="No se pudieron cargar los pedidos" detalle={error} />
      )}

      {!cargando && !error && pedidos.length === 0 && (
        datos?.hay_filtros ? (
          <EstadoVacio
            codigo="sin-resultados"
            titulo="Ningún pedido con ese filtro"
            detalle="Probá con otro estado o mirá todos los catálogos."
          />
        ) : (
          <EstadoVacio
            codigo="sin-pedidos"
            titulo="Todavía no entró ningún pedido"
            detalle="Cuando alguien compre desde un catálogo publicado, va a aparecer acá."
          />
        )
      )}

      {!cargando && !error && pedidos.length > 0 && (
        <TablaGrid anchoMinimo={780}>
          <Encabezado columnas={COLUMNAS}>
            <span>Pedido</span>
            <span>Comprador</span>
            <span>Catálogo</span>
            <span>Canal</span>
            <span>Estado</span>
            <span className="text-right">Total</span>
          </Encabezado>

          {pedidos.map((p) => (
            <Fila
              key={p.id}
              columnas={COLUMNAS}
              data-pedido={p.numero}
              onClick={() => setAbierto(p.id)}
            >
              <span className="tabular-nums font-medium">{numeroDePedido(p.numero)}</span>
              <span className="min-w-0 truncate">
                {p.comprador_nombre}
                <span className="ml-1.5 text-[12px] text-fg-3">{fechaCortaDeMomento(p.created_at)}</span>
              </span>
              <span className="min-w-0 truncate text-fg-2">
                {nombreDelCatalogo.get(p.catalogo_id) || '—'}
              </span>
              {/* Hoy siempre dice lo mismo. Ver el encabezado. */}
              <span data-canal className="text-[12.5px] text-fg-2">{p.origen}</span>
              <span>
                <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium ${tonoDeEstadoDePedido(p.estado)}`}>
                  {etiquetaDeEstadoDePedido(p.estado)}
                </span>
              </span>
              <span className="text-right tabular-nums">{`$${pesos(p.total)}`}</span>
            </Fila>
          ))}
        </TablaGrid>
      )}

      <PanelDePedido
        pedidoId={abierto}
        alCerrar={() => setAbierto(null)}
        alCambiarEstado={alCambiarEstado}
        alFallar={(mensaje) => toast.error(mensaje)}
      />
    </div>
  )
}
