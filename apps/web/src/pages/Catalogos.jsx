import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ShoppingBag, Plus, ExternalLink, Loader2, Info, TriangleAlert, ImageIcon, Trash2, ChevronRight,
} from 'lucide-react'
import api from '@/services/api'
import useStore from '@/store/useStore'
import { Can } from '@/components/Can'
import { usePermission } from '@/hooks/usePermission'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import PageHeader from '@/components/PageHeader'
import EstadoVacio from '@/components/EstadoVacio'
import { TablaGrid, Encabezado, Fila } from '@/components/TablaGrid'
import ReglasDePrecio from '@/components/ReglasDePrecio'
import ProductosDelCatalogo from '@/components/ProductosDelCatalogo'
import QrDelCatalogo from '@/components/QrDelCatalogo'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { faltaElPermiso } from '@/utils/permisos'
import {
  tonoDeCatalogo, etiquetaDeEstado, llevaAlgunLado,
  normalizarSlug, validarSlug, urlDelCatalogo,
  colorDeMarca, estiloDePrevisualizacion, MARCA_POR_DEFECTO,
  tituloDeRequisito,
} from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · Catálogos
//
//  Las tiendas públicas de la empresa: la lista, y el detalle del catálogo
//  elegido con sus cinco pestañas —Identidad, Entrega y pago, Reglas de precio,
//  Productos, y QR y enlace—. Es lo que le permite al comercio armar y publicar
//  su catálogo **sin `curl`**.
//
//  ── Las tres cosas que ordenan esta pantalla ──
//
//  **1. La dirección se imprime en una pared.** El slug que propone el
//  formulario y el que guarda el servidor salen de la MISMA función
//  (`utils/catalogos.js`, atada por texto a la de la API). Si se separaran, el
//  comercio apretaría «Publicar» sobre una dirección y quedaría publicada otra,
//  con el QR ya pegado en la recepción del gimnasio y nada fallando en ningún
//  log. Por eso el cambio de slug además **pide confirmación explícita** y dice
//  qué se rompe (FR-068): el nombre viejo muere sin dejar rastro.
//
//  **2. Lo que falta para publicar es una LISTA.** El 409 del servidor devuelve
//  `faltan: [{ que, detalle }]` y acá se dibuja renglón por renglón. Concatenado
//  en un solo mensaje, el comercio arregla una cosa, reintenta, descubre la
//  siguiente y repite; con la lista ve las cuatro de una.
//
//  **3. La pantalla no calcula ningún precio.** Los precios de lista, la regla
//  que gana y las coberturas salen del servidor (H2). Una segunda
//  implementación del motor de reglas acá abajo sería otra que se desincroniza,
//  y el número que vería el comercio no sería el que ve el visitante.
//
//  ── Lo que la maqueta dibuja y esta pantalla NO ──
//
//  · Las columnas **Pedidos** y **Último pedido** de la lista (`:740`). Los
//    pedidos son de la etapa 2 y todavía no existe la tabla: dibujarlas hoy
//    sería mostrar tres ceros inventados en la primera pantalla que el comercio
//    mira. Entran con la bandeja.
//  · El botón **Duplicar** del detalle (`:769`). No hay endpoint que duplique un
//    catálogo, y armarlo desde el navegador —crear, copiar los campos, copiar
//    las reglas, copiar los productos— son cuatro llamadas que pueden fallar por
//    la mitad y dejar un catálogo a medio copiar.
//
//  ── Un solo botón principal ──
//
//  «Nuevo catálogo» y nada más (`REGLAS-DISENO.md` → «Botones»). La maqueta pone
//  tres —también «Nueva regla» y «Descargar PNG»—, y con tres el ojo deja de
//  saber cuál es la acción de la pantalla. Los otros dos son secundarios.
//
//  Reglas: `docs/REGLAS-DISENO.md`. Referencia viva: `pages/Comparador.jsx`.
// ════════════════════════════════════════════

/** Clases del botón secundario del sistema (34px, borde, hover en surface-3). */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface '
  + 'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 '
  + 'disabled:cursor-not-allowed disabled:opacity-55'

/** El único botón principal de la pantalla. */
const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] '
  + 'font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark '
  + 'focus-visible:border-brand focus-visible:outline-none '
  + 'disabled:cursor-not-allowed disabled:opacity-55'

/**
 * Un campo de formulario, 36px como fija `REGLAS-DISENO.md` → «Medidas».
 *
 * ⚠ Lleva `disabled:cursor-not-allowed` y **no** `disabled:pointer-events-none`:
 * el segundo saca al elemento del hit-testing y con eso el navegador nunca
 * muestra el `title`, que es justamente donde vive la explicación de por qué el
 * campo está apagado.
 */
const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13.5px] '
  + 'transition-colors focus-visible:border-brand focus-visible:outline-none '
  + 'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-2'

const ETIQUETA = 'text-[12.5px] font-semibold'

/** Las cinco pestañas del detalle, en el orden de la maqueta (`:774`). */
const PESTANAS = [
  { clave: 'identidad', nombre: 'Identidad' },
  { clave: 'entrega', nombre: 'Entrega y pago' },
  { clave: 'reglas', nombre: 'Reglas de precio' },
  { clave: 'productos', nombre: 'Productos' },
  { clave: 'qr', nombre: 'QR y enlace' },
]

/**
 * Las columnas de la lista.
 *
 * El MISMO string en el encabezado y en las filas: si difieren, las etiquetas
 * dejan de estar sobre sus datos y se lee un número bajo «Estado».
 */
const COLUMNAS = 'minmax(0,1fr) 128px 96px 40px'

export default function Catalogos() {
  const [catalogos, setCatalogos] = useState([])
  // Arranca en `true` para que el PRIMER pintado —antes de que corra el efecto—
  // muestre el spinner y no el vacío: al revés, la pantalla afirma «todavía no
  // creaste ningún catálogo» mientras la lista viaja por la red.
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [elegido, setElegido] = useState(null)
  const [pestana, setPestana] = useState('identidad')
  // La lista del 409 `FALTAN_REQUISITOS`, tal cual la manda el servidor.
  const [faltan, setFaltan] = useState([])
  const [dialogoAbierto, setDialogoAbierto] = useState(false)

  const { can } = usePermission()
  const puedeEditar = can('catalogo.editar')
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const sucursales = useStore((s) => s.empresaActiva?.puntosDeVenta) || []

  const cargar = useCallback(async (idParaElegir) => {
    setCargando(true)
    try {
      const res = await api.get('/catalogos')
      const lista = res.data?.data || []

      setCatalogos(lista)
      setError(null)
      setElegido((actual) => {
        const buscado = idParaElegir ?? actual
        if (buscado && lista.some((c) => c.id === buscado)) return buscado
        return lista[0]?.id ?? null
      })
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los catálogos.'))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const catalogo = useMemo(
    () => catalogos.find((c) => c.id === elegido) || null,
    [catalogos, elegido]
  )

  /** Reemplaza UNA fila de la lista, sin recargar todo ni perder la pestaña. */
  const actualizar = useCallback((actualizado) => {
    setCatalogos((lista) => lista.map(
      (c) => (c.id === actualizado.id ? { ...c, ...actualizado } : c)
    ))
  }, [])

  const guardar = async (cambios) => {
    try {
      const res = await api.put(`/catalogos/${catalogo.id}`, cambios)
      actualizar(res.data?.data || {})
      // Los requisitos que faltaban se descartan al guardar: son la respuesta a
      // un intento anterior y dejarlos a la vista afirmaría que siguen faltando.
      setFaltan([])
      toast.success('Cambios guardados.')

      return true
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron guardar los cambios.'))

      return false
    }
  }

  const publicar = async () => {
    setFaltan([])
    try {
      const res = await api.post(`/catalogos/${catalogo.id}/publicar`)
      actualizar(res.data?.data || {})
      toast.success('El catálogo está publicado.')
    } catch (err) {
      const cuerpo = err?.response?.data

      // El 409 NO es un error genérico: es la lista de lo que falta, y se dibuja
      // como lista. Un `toast` con las cuatro cosas concatenadas se lee una vez
      // y se va.
      if (err?.response?.status === 409 && Array.isArray(cuerpo?.faltan)) {
        setFaltan(cuerpo.faltan)

        return
      }

      toast.error(mensajeDeError(err, 'No se pudo publicar el catálogo.'))
    }
  }

  const cambiarEstado = async (accion) => {
    try {
      const res = await api.post(`/catalogos/${catalogo.id}/${accion}`)
      actualizar(res.data?.data || {})
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cambiar el estado del catálogo.'))
    }
  }

  /**
   * Despublicar manda el catálogo a **borrador**, no a pausado.
   *
   * O sea: la dirección pasa a devolver el mismo 404 que una inventada, y los QR
   * impresos dejan de abrir nada. Por eso pregunta antes y nombra la
   * alternativa: pausar deja el cartel de «volvemos pronto», que es lo que la
   * mayoría quiere cuando se queda sin stock.
   */
  const despublicar = async () => {
    const ok = await confirm(
      'La dirección va a devolver el mismo 404 que una inventada, y los QR ya impresos dejan de '
      + 'abrir el catálogo. Pausarlo, en cambio, deja el cartel de «volvemos pronto».',
      { verbo: 'Despublicar' }
    )
    if (!ok) return

    cambiarEstado('despublicar')
  }

  const enLaCalle = catalogo && llevaAlgunLado(catalogo.estado)

  return (
    <div className="anim-subida flex flex-col gap-6">

      <PageHeader
        titulo="Catálogos"
        descripcion="Tiendas públicas de la empresa. Cada una tiene su propio color, sus reglas de precio y su QR; el stock y las ventas son los mismos de Favalio."
        icono={ShoppingBag}
      >
        {/* Sin catálogo elegido o con uno en borrador no hay tienda que ver: el
            enlace daría el mismo 404 que un slug inventado. Se apaga con el
            motivo en vez de esconderse. */}
        <a
          href={catalogo ? urlDelCatalogo(catalogo.slug) : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!enLaCalle}
          title={enLaCalle ? undefined : 'El catálogo está en borrador: su dirección todavía no lleva a ningún lado.'}
          className={`${BOTON_SECUNDARIO} ${enLaCalle ? '' : 'pointer-events-none opacity-55'}`}
        >
          <ExternalLink className="h-3.5 w-3.5 text-fg-3" />
          Ver la tienda
        </a>

        {/* ⚠ Sin el permiso el botón se DESHABILITA con su motivo, no se
            esconde: el estado vacío de abajo le pide al usuario que cree el
            primero, y esconderle el único botón que hace eso es la llamada de
            soporte «a mí no me sale». */}
        <Can
          codigo="catalogo.editar"
          fallback={
            <button disabled title={faltaElPermiso('catalogo.editar')} className={BOTON_PRINCIPAL}>
              <Plus className="h-4 w-4" />
              Nuevo catálogo
            </button>
          }
        >
          <button className={BOTON_PRINCIPAL} onClick={() => setDialogoAbierto(true)}>
            <Plus className="h-4 w-4" />
            Nuevo catálogo
          </button>
        </Can>
      </PageHeader>

      {error && (
        <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-5 py-4">
          <p className="text-[13.5px] font-semibold text-danger">{error}</p>
        </div>
      )}

      {/* ── La lista ── */}
      <section data-lista="catalogos" className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        {cargando ? (
          /* ⚠ La carga va ANTES del vacío. Al revés, la pantalla afirma «todavía
             no creaste ningún catálogo» mientras los catálogos viajan por la
             red: le dice al comercio que su sistema está vacío justo cuando se
             está formando la primera impresión. */
          <div className="grid place-items-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : catalogos.length === 0 ? (
          <EstadoVacio
            icono={ShoppingBag}
            codigo="sin_catalogos"
            titulo="Todavía no creaste ningún catálogo."
            detalle="Un catálogo es una tienda pública con su propia dirección, su color y su QR. El stock y los precios salen de Favalio."
          />
        ) : (
          <TablaGrid anchoMinimo={720}>
            <Encabezado columnas={COLUMNAS}>
              <span>Catálogo</span>
              <span>Estado</span>
              <span className="text-right">Productos</span>
              <span />
            </Encabezado>

            {catalogos.map((c) => (
              <Fila
                key={c.id}
                columnas={COLUMNAS}
                onClick={() => { setElegido(c.id); setFaltan([]) }}
                className={c.id === elegido ? 'bg-surface-2' : ''}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold">{c.nombre_visible}</p>
                  <p className="num truncate text-[11.5px] text-fg-3">{urlDelCatalogo(c.slug)}</p>
                </div>

                <span>
                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeCatalogo(c.estado)}`}>
                    {etiquetaDeEstado(c.estado)}
                  </span>
                </span>

                <span className="num text-right text-[13px]">{c.productos ?? 0}</span>

                <span className="grid place-items-center text-fg-3">
                  <ChevronRight className="h-[15px] w-[15px]" />
                </span>
              </Fila>
            ))}
          </TablaGrid>
        )}
      </section>

      {/* ── El detalle ── */}
      {catalogo && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Detalle del catálogo</p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <h2 className="text-[19px] font-semibold tracking-[-0.015em]">{catalogo.nombre_visible}</h2>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeCatalogo(catalogo.estado)}`}>
                  {etiquetaDeEstado(catalogo.estado)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {catalogo.estado !== 'publicado' && (
                <BotonDeEstado
                  puedeEditar={puedeEditar}
                  onClick={publicar}
                >
                  Publicar
                </BotonDeEstado>
              )}

              {catalogo.estado === 'publicado' && (
                <BotonDeEstado
                  puedeEditar={puedeEditar}
                  onClick={() => cambiarEstado('pausar')}
                >
                  Pausar
                </BotonDeEstado>
              )}

              {llevaAlgunLado(catalogo.estado) && (
                <BotonDeEstado puedeEditar={puedeEditar} onClick={despublicar}>
                  Despublicar
                </BotonDeEstado>
              )}
            </div>
          </div>

          {/* ⚠ La lista de lo que falta, y no un mensaje concatenado.
              El comercio arregla una cosa, reintenta y descubre la siguiente:
              con la lista ve las cuatro de una. */}
          {faltan.length > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-warn-line bg-warn-soft px-5 py-4">
              <TriangleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" />
              <div>
                <p className="text-[13.5px] font-semibold text-warn">
                  Falta esto para publicar el catálogo.
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {faltan.map((f) => (
                    <li key={f.que} className="text-[13px] text-fg-2">
                      <span className="font-semibold text-foreground">{tituloDeRequisito(f.que)}</span>
                      {' · '}
                      {f.detalle}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Las cinco pestañas ── */}
          <div className="flex flex-wrap border-b border-border" role="tablist">
            {PESTANAS.map((p) => (
              <button
                key={p.clave}
                role="tab"
                aria-selected={pestana === p.clave}
                onClick={() => setPestana(p.clave)}
                className={`h-9 px-3.5 text-[13px] font-medium transition-colors ${
                  pestana === p.clave
                    ? 'border-b-2 border-brand text-foreground'
                    : 'border-b-2 border-transparent text-fg-2 hover:text-foreground'
                }`}
              >
                {p.nombre}
              </button>
            ))}
          </div>

          {pestana === 'identidad' && (
            <PestanaIdentidad
              catalogo={catalogo}
              sucursales={sucursales}
              puedeEditar={puedeEditar}
              onGuardar={guardar}
              onImagen={actualizar}
              confirm={confirm}
            />
          )}

          {pestana === 'entrega' && (
            <PestanaEntrega
              catalogo={catalogo}
              puedeEditar={puedeEditar}
              onGuardar={guardar}
            />
          )}

          {pestana === 'reglas' && (
            <ReglasDePrecio catalogo={catalogo} puedeEditar={puedeEditar} confirm={confirm} />
          )}

          {pestana === 'productos' && (
            <ProductosDelCatalogo
              catalogo={catalogo}
              puedeEditar={puedeEditar}
              onCambio={() => cargar(catalogo.id)}
            />
          )}

          {pestana === 'qr' && <QrDelCatalogo catalogo={catalogo} />}
        </div>
      )}

      <DialogoNuevoCatalogo
        abierto={dialogoAbierto}
        onCerrar={() => setDialogoAbierto(false)}
        sucursales={sucursales}
        onCreado={(nuevo) => cargar(nuevo.id)}
      />

      <ConfirmDialog />
    </div>
  )
}

/** Un botón de cambio de estado, apagado con su motivo cuando falta el permiso. */
function BotonDeEstado({ puedeEditar, onClick, children }) {
  return (
    <button
      className={BOTON_SECUNDARIO}
      disabled={!puedeEditar}
      title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ════════════════════════════════════════════
//  Pestaña · Identidad (maqueta `:779-840`)
//
//  ── Por qué el slug tiene su propio camino ──
//
//  Todos los demás campos se guardan y listo. El slug no: cambiarlo **mata el
//  anterior sin dejar rastro** (FR-067, decisión 11). No hay tabla de alias ni
//  redirección, así que el QR pegado en la recepción del gimnasio pasa a abrir
//  un 404 igual al de una dirección inventada, y el nombre liberado vuelve al
//  espacio de nombres global — donde otra empresa lo puede tomar.
//
//  Por eso: se propone mientras se escribe el nombre, se normaliza con la misma
//  función que el servidor, se pregunta si está libre, y se **pide confirmación
//  explícita antes de guardarlo** diciendo qué se rompe (FR-068).
// ════════════════════════════════════════════

function PestanaIdentidad({ catalogo, sucursales, puedeEditar, onGuardar, onImagen, confirm }) {
  const [forma, setForma] = useState(() => desdeElCatalogo(catalogo))
  const [disponibilidad, setDisponibilidad] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // La forma se rearma cuando cambia el catálogo elegido: sin esto, elegir otro
  // de la lista dejaría el formulario mostrando los datos del anterior.
  useEffect(() => {
    setForma(desdeElCatalogo(catalogo))
    setDisponibilidad(null)
  }, [catalogo])

  const cambiar = (campo, valor) => setForma((f) => ({ ...f, [campo]: valor }))

  const slugPropuesto = normalizarSlug(forma.slug)
  const validacion = validarSlug(slugPropuesto)
  const cambiaElSlug = slugPropuesto !== catalogo.slug

  /**
   * La consulta va al salir del campo y no en cada tecla.
   *
   * Un rebote por tecla gasta una consulta por letra sobre un índice único que
   * igual vuelve a decidir al guardar: `GET /slug-disponible` es una ayuda para
   * el formulario y **no sustituye** al índice de la base — entre la consulta y
   * el guardado pasa tiempo, y dos empresas pueden pedir el mismo slug a la vez.
   */
  const revisarDisponibilidad = async () => {
    if (!cambiaElSlug || !validacion.ok) return

    try {
      const res = await api.get('/catalogos/slug-disponible', { params: { slug: slugPropuesto } })
      setDisponibilidad(res.data?.data || null)
    } catch {
      // Un fallo de red acá no bloquea nada: el índice único de la base es el
      // que decide, y afirmar «no está disponible» porque falló la consulta
      // sería mentirle al comercio sobre una dirección que sí puede tomar.
      setDisponibilidad(null)
    }
  }

  const enviar = async () => {
    if (cambiaElSlug) {
      if (!validacion.ok) {
        toast.error(validacion.motivo)

        return
      }

      const ok = await confirm(
        `La dirección pasa a ser «${slugPropuesto}». La anterior deja de existir: `
        + 'los QR y los carteles ya impresos dejan de abrir el catálogo y su enlace '
        + 'devuelve el mismo 404 que una dirección inventada.',
        { verbo: 'Cambiar la dirección' }
      )
      if (!ok) return
    }

    setGuardando(true)
    await onGuardar({
      nombre_visible: forma.nombre_visible.trim(),
      slug: slugPropuesto,
      descripcion: forma.descripcion,
      color_marca: colorDeMarca(forma.color_marca),
      punto_de_venta_id: forma.punto_de_venta_id,
      email_avisos: forma.email_avisos.trim() || null,
      mostrar_precio_lista: forma.mostrar_precio_lista,
    })
    setGuardando(false)
  }

  const estilo = estiloDePrevisualizacion(forma.color_marca)

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-nivel-1">
        {!puedeEditar && (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
            Los campos están apagados: {faltaElPermiso('catalogo.editar')}.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="cat-nombre">Nombre visible</label>
            <input
              id="cat-nombre"
              className={CAMPO}
              value={forma.nombre_visible}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiar('nombre_visible', e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="cat-slug">Dirección web</label>
            <input
              id="cat-slug"
              className={`${CAMPO} num`}
              value={forma.slug}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiar('slug', e.target.value)}
              onBlur={revisarDisponibilidad}
            />
            <p data-slug-propuesto className="num text-[11.5px] text-fg-3">
              {urlDelCatalogo(slugPropuesto)}
            </p>

            {!validacion.ok && (
              <p className="text-[11.5px] font-medium text-danger">{validacion.motivo}</p>
            )}

            {validacion.ok && disponibilidad && !disponibilidad.disponible && (
              <p className="text-[11.5px] font-medium text-danger">{disponibilidad.motivo}</p>
            )}

            {validacion.ok && disponibilidad?.disponible && (
              <p className="text-[11.5px] font-medium text-ok">Esa dirección está libre.</p>
            )}

            {cambiaElSlug && (
              <p className="text-[11.5px] text-warn">
                Al guardar, la dirección anterior deja de funcionar: los QR y carteles impresos dejan de abrir el catálogo.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={ETIQUETA} htmlFor="cat-descripcion">Descripción</label>
          <textarea
            id="cat-descripcion"
            rows={3}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[13.5px] transition-colors focus-visible:border-brand focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-2"
            value={forma.descripcion}
            disabled={!puedeEditar}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onChange={(e) => cambiar('descripcion', e.target.value)}
          />
          <p className="text-[11.5px] text-fg-3">
            Se muestra debajo del nombre, en la portada. Una línea alcanza.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ImagenDelCatalogo
            catalogo={catalogo}
            tipo="logo"
            etiqueta="Logo"
            ayuda="PNG o WEBP con fondo transparente. Se recorta a 400×400."
            puedeEditar={puedeEditar}
            onCambio={onImagen}
          />
          <ImagenDelCatalogo
            catalogo={catalogo}
            tipo="portada"
            etiqueta="Portada"
            ayuda="Se recorta a 1200×480. Es lo que se ve al abrir el enlace."
            puedeEditar={puedeEditar}
            onCambio={onImagen}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className={ETIQUETA} htmlFor="cat-color">Color de marca</label>
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="h-9 w-9 rounded-lg border border-border"
              style={{ background: estilo.marca }}
            />
            <input
              id="cat-color"
              className={`${CAMPO} num w-[130px] uppercase`}
              value={forma.color_marca}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiar('color_marca', e.target.value)}
            />
            <span className="max-w-[38ch] text-[11.5px] text-fg-2">
              Es el único color que define el comercio. Todo lo demás de la tienda es neutro.
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={ETIQUETA} htmlFor="cat-sucursal">Sucursal</label>
          <select
            id="cat-sucursal"
            className={CAMPO}
            value={forma.punto_de_venta_id ?? ''}
            disabled={!puedeEditar}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onChange={(e) => cambiar('punto_de_venta_id', Number(e.target.value))}
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-[11.5px] text-fg-3">
            El stock que se publica sale de esta sucursal y de ninguna otra.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={ETIQUETA} htmlFor="cat-email">Casilla para los avisos</label>
          <input
            id="cat-email"
            type="email"
            className={CAMPO}
            value={forma.email_avisos}
            disabled={!puedeEditar}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onChange={(e) => cambiar('email_avisos', e.target.value)}
          />
          {/* ⚠ El aviso va SIEMPRE que esté vacía, y no como texto de ayuda
              genérico: un catálogo sin casilla recibe pedidos igual (FR-183a),
              así que el pedido entra y nadie se entera por correo. Es la única
              forma de que eso no se descubra con el primer cliente enojado. */}
          {!forma.email_avisos.trim() && (
            <p className="text-[11.5px] font-medium text-warn">
              Mientras esté vacía, los pedidos entran igual pero nadie recibe un correo avisando.
            </p>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <input
            id="cat-precio-lista"
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand disabled:cursor-not-allowed"
            checked={forma.mostrar_precio_lista}
            disabled={!puedeEditar}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onChange={(e) => cambiar('mostrar_precio_lista', e.target.checked)}
          />
          <label className="text-[12.5px]" htmlFor="cat-precio-lista">
            <span className="font-semibold">Mostrar el precio de lista tachado</span>
            {/* Arranca apagado (FR-061): el default seguro es no publicar el
                margen. Encenderlo le muestra al visitante cuánto se le descuenta
                sobre el precio normal, que es una decisión comercial. */}
            <span className="block text-fg-2">
              Apagado por omisión. Encendido, el visitante ve el precio normal tachado al lado del del catálogo.
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            className={BOTON_SECUNDARIO}
            disabled={!puedeEditar || guardando}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onClick={enviar}
          >
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar identidad
          </button>
        </div>
      </section>

      {/* ── Cómo se ve ──
          El color se dibuja en los dos lugares en los que aparece en la tienda
          real —portada y botón— y el texto de encima se CALCULA por contraste
          (FR-060), con la misma función que la tienda. Elegirlo a mano es cómo
          un comercio con un amarillo termina con un botón ilegible que no puede
          arreglar desde ningún lado. */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-nivel-1">
        <p className="eyebrow mb-3">Cómo se ve</p>

        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: estilo.borde, background: estilo.papel }}
        >
          <div className="h-[92px]" style={{ background: estilo.portada }} />
          <div className="px-3.5 pb-4 pt-3">
            <p className="text-[15px] font-semibold" style={{ color: estilo.tinta }}>
              {forma.nombre_visible || 'Tu catálogo'}
            </p>
            <p className="mt-1 text-[11.5px] leading-snug" style={{ color: estilo.tintaMedia }}>
              {forma.descripcion || 'La descripción se muestra acá, debajo del nombre.'}
            </p>
            <div
              className="mt-3 grid h-9 place-items-center rounded-lg text-[12.5px] font-semibold"
              style={{ background: estilo.marca, color: estilo.textoSobreLaMarca }}
            >
              Ver el catálogo
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-fg-2">
          La previsualización usa el color en el mismo lugar que la tienda real: portada y botón.
          Nunca de fondo de una zona grande. El color del texto encima se calcula por contraste.
        </p>
      </section>
    </div>
  )
}

/** Los campos editables del catálogo, con la forma que espera el formulario. */
function desdeElCatalogo(catalogo) {
  return {
    nombre_visible: catalogo.nombre_visible || '',
    slug: catalogo.slug || '',
    descripcion: catalogo.descripcion || '',
    color_marca: catalogo.color_marca || MARCA_POR_DEFECTO,
    punto_de_venta_id: catalogo.punto_de_venta_id ?? null,
    email_avisos: catalogo.email_avisos || '',
    mostrar_precio_lista: catalogo.mostrar_precio_lista === true,
  }
}

/** El logo o la portada, con su subida y su borrado. */
function ImagenDelCatalogo({ catalogo, tipo, etiqueta, ayuda, puedeEditar, onCambio }) {
  const [subiendo, setSubiendo] = useState(false)
  const url = tipo === 'logo' ? catalogo.logo_url : catalogo.portada_url

  const subir = async (archivo) => {
    if (!archivo) return

    const cuerpo = new FormData()
    cuerpo.append('imagen', archivo)
    cuerpo.append('tipo', tipo)

    setSubiendo(true)
    try {
      const res = await api.post(`/catalogos/${catalogo.id}/imagen`, cuerpo)
      onCambio({ id: catalogo.id, [tipo === 'logo' ? 'logo_url' : 'portada_url']: res.data?.data?.url })
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo subir la imagen.'))
    } finally {
      setSubiendo(false)
    }
  }

  const borrar = async () => {
    try {
      await api.delete(`/catalogos/${catalogo.id}/imagen`, { params: { tipo } })
      onCambio({ id: catalogo.id, [tipo === 'logo' ? 'logo_url' : 'portada_url']: null })
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo borrar la imagen.'))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={ETIQUETA}>{etiqueta}</span>

      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-2 bg-surface-2 p-3">
        {url ? (
          <img src={url} alt="" className="h-14 w-14 rounded-lg border border-border object-contain" />
        ) : (
          <span className="grid h-14 w-14 place-items-center rounded-lg border border-border bg-surface text-fg-3">
            <ImageIcon className="h-5 w-5" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] text-fg-2">{ayuda}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              disabled={!puedeEditar || subiendo}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              aria-label={`Subir ${etiqueta.toLowerCase()}`}
              onChange={(e) => subir(e.target.files?.[0])}
              className="max-w-[150px] text-[11px] text-fg-3 file:mr-2 file:rounded-md file:border-0 file:bg-surface-3 file:px-2 file:py-1 file:text-[11px] file:font-medium"
            />
            {url && (
              <button
                className="grid h-[29px] w-[29px] place-items-center rounded-lg text-fg-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-55"
                disabled={!puedeEditar}
                title={puedeEditar ? `Quitar ${etiqueta.toLowerCase()}` : faltaElPermiso('catalogo.editar')}
                onClick={borrar}
              >
                <Trash2 className="h-[15px] w-[15px]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════
//  Pestaña · Entrega y pago (maqueta `:842-910`)
//
//  ── El campo que significa lo contrario de lo que parece ──
//
//  `envio_gratis_desde` **vacío o en cero es «no hay envío gratis»**, no «todo
//  gratis». Es el único campo de la pantalla donde el cero no es un número
//  chico: es la ausencia del beneficio. Con la lectura al revés, el comercio
//  deja el campo en blanco creyendo que no ofrece nada y regala el envío en
//  todos los pedidos.
//
//  Mercado Pago no se dibuja: `mp_habilitado` existe en la base y queda siempre
//  en `false` hasta la etapa 3. Un interruptor que no hace nada es lo que el
//  hito 9 corrigió en ocho pantallas.
// ════════════════════════════════════════════

function PestanaEntrega({ catalogo, puedeEditar, onGuardar }) {
  const [forma, setForma] = useState(() => entregaDelCatalogo(catalogo))
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { setForma(entregaDelCatalogo(catalogo)) }, [catalogo])

  const cambiar = (campo, valor) => setForma((f) => ({ ...f, [campo]: valor }))
  const cambiarTransferencia = (campo, valor) => setForma((f) => ({
    ...f,
    datos_transferencia: { ...f.datos_transferencia, [campo]: valor },
  }))

  const enviar = async () => {
    setGuardando(true)
    await onGuardar({
      retiro_socio: forma.retiro_socio,
      retiro_socio_direccion: forma.retiro_socio_direccion,
      retiro_local: forma.retiro_local,
      envio: forma.envio,
      envio_costo: numeroOCero(forma.envio_costo),
      // ⚠ Vacío viaja como `null` y no como 0: son dos cosas distintas y la
      // tienda las dibuja distinto. Ver el encabezado.
      envio_gratis_desde: forma.envio_gratis_desde === '' ? null : numeroOCero(forma.envio_gratis_desde),
      coordinar_whatsapp: forma.coordinar_whatsapp,
      whatsapp_destino: forma.whatsapp_destino.trim() || null,
      datos_transferencia: forma.datos_transferencia,
    })
    setGuardando(false)
  }

  const sinEnvioGratis = forma.envio_gratis_desde === '' || numeroOCero(forma.envio_gratis_desde) === 0

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="border-b border-border px-5 py-3.5">
          <h2>Entrega</h2>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <Interruptor
            id="ent-retiro-socio"
            titulo="Retiro en el punto del socio"
            detalle="El lugar donde el socio pasa a buscar el pedido."
            valor={forma.retiro_socio}
            puedeEditar={puedeEditar}
            onCambio={(v) => cambiar('retiro_socio', v)}
          />

          {forma.retiro_socio && (
            <input
              className={CAMPO}
              placeholder="Dirección y horarios del retiro"
              aria-label="Dirección del retiro del socio"
              value={forma.retiro_socio_direccion}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiar('retiro_socio_direccion', e.target.value)}
            />
          )}

          <Interruptor
            id="ent-retiro-local"
            titulo="Retiro en el local"
            detalle="La dirección de la sucursal del catálogo."
            valor={forma.retiro_local}
            puedeEditar={puedeEditar}
            onCambio={(v) => cambiar('retiro_local', v)}
          />

          <Interruptor
            id="ent-envio"
            titulo="Envío a domicilio"
            detalle="Se cobra en el pedido, además del total de los productos."
            valor={forma.envio}
            puedeEditar={puedeEditar}
            onCambio={(v) => cambiar('envio', v)}
          />

          {forma.envio && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className={ETIQUETA} htmlFor="ent-costo">Costo del envío</label>
                <input
                  id="ent-costo"
                  className={`${CAMPO} num`}
                  inputMode="decimal"
                  value={forma.envio_costo}
                  disabled={!puedeEditar}
                  title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
                  onChange={(e) => cambiar('envio_costo', e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={ETIQUETA} htmlFor="ent-gratis">Envío gratis a partir de</label>
                <input
                  id="ent-gratis"
                  className={`${CAMPO} num`}
                  inputMode="decimal"
                  value={forma.envio_gratis_desde}
                  disabled={!puedeEditar}
                  title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
                  onChange={(e) => cambiar('envio_gratis_desde', e.target.value)}
                />
                {/* El único campo de la pantalla donde el cero NO es un número
                    chico: es la ausencia del beneficio. Dicho acá, y no en un
                    manual, porque es lo que se lee mientras se completa. */}
                <p className="text-[11.5px] text-fg-3">
                  {sinEnvioGratis
                    ? 'Vacío o en cero significa que no hay envío gratis: se cobra siempre.'
                    : 'A partir de ese total, el envío no se cobra.'}
                </p>
              </div>
            </div>
          )}

          <Interruptor
            id="ent-whatsapp"
            titulo="Coordinar por WhatsApp"
            detalle="El pedido llega y se termina de acordar por mensaje."
            valor={forma.coordinar_whatsapp}
            puedeEditar={puedeEditar}
            onCambio={(v) => cambiar('coordinar_whatsapp', v)}
          />

          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="ent-whatsapp-numero">WhatsApp del comercio</label>
            <input
              id="ent-whatsapp-numero"
              className={`${CAMPO} num`}
              inputMode="tel"
              value={forma.whatsapp_destino}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiar('whatsapp_destino', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="border-b border-border px-5 py-3.5">
          <h2>Pago</h2>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-info-line bg-info-soft px-3 py-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <p className="text-[12.5px] text-fg-2">
              Los datos de transferencia se le muestran al comprador al cerrar el pedido.
              El pago se acredita a mano: el comercio lo marca como cobrado cuando entra la plata.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="pag-titular">Titular</label>
              <input
                id="pag-titular"
                className={CAMPO}
                value={forma.datos_transferencia.titular}
                disabled={!puedeEditar}
                title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
                onChange={(e) => cambiarTransferencia('titular', e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="pag-alias">Alias</label>
              <input
                id="pag-alias"
                className={`${CAMPO} num`}
                value={forma.datos_transferencia.alias}
                disabled={!puedeEditar}
                title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
                onChange={(e) => cambiarTransferencia('alias', e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="pag-cbu">CBU</label>
            <input
              id="pag-cbu"
              className={`${CAMPO} num`}
              inputMode="numeric"
              value={forma.datos_transferencia.cbu}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiarTransferencia('cbu', e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="pag-banco">Banco</label>
            <input
              id="pag-banco"
              className={CAMPO}
              value={forma.datos_transferencia.banco}
              disabled={!puedeEditar}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onChange={(e) => cambiarTransferencia('banco', e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            className={BOTON_SECUNDARIO}
            disabled={!puedeEditar || guardando}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onClick={enviar}
          >
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar entrega y pago
          </button>
        </div>
      </section>
    </div>
  )
}

/** Los campos de entrega y pago, con la forma que espera el formulario. */
function entregaDelCatalogo(catalogo) {
  const datos = catalogo.datos_transferencia || {}

  return {
    retiro_socio: catalogo.retiro_socio === true,
    retiro_socio_direccion: catalogo.retiro_socio_direccion || '',
    retiro_local: catalogo.retiro_local === true,
    envio: catalogo.envio === true,
    envio_costo: catalogo.envio_costo == null ? '' : String(catalogo.envio_costo),
    // ⚠ `null` se conserva como cadena vacía y NO se convierte en «0»: son dos
    // cosas distintas y la de abajo es la que el comercio lee como «regalo el
    // envío en todos los pedidos».
    envio_gratis_desde: catalogo.envio_gratis_desde == null ? '' : String(catalogo.envio_gratis_desde),
    coordinar_whatsapp: catalogo.coordinar_whatsapp === true,
    whatsapp_destino: catalogo.whatsapp_destino || '',
    datos_transferencia: {
      titular: datos.titular || '',
      cbu: datos.cbu || '',
      alias: datos.alias || '',
      banco: datos.banco || '',
    },
  }
}

const numeroOCero = (valor) => {
  const n = Number(String(valor).replace(',', '.'))

  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Un interruptor de la pestaña de entrega y pago. */
function Interruptor({ id, titulo, detalle, valor, puedeEditar, onCambio }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <label className="min-w-0" htmlFor={id}>
        <span className="text-[13.5px] font-semibold">{titulo}</span>
        <span className="block text-xs text-fg-2">{detalle}</span>
      </label>

      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-brand disabled:cursor-not-allowed"
        checked={valor}
        disabled={!puedeEditar}
        title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
        onChange={(e) => onCambio(e.target.checked)}
      />
    </div>
  )
}

// ════════════════════════════════════════════
//  El alta
//
//  Nace en borrador SIEMPRE y no se puede crear publicado: publicar es una
//  verificación de cuatro condiciones y no una casilla del formulario de alta.
// ════════════════════════════════════════════

function DialogoNuevoCatalogo({ abierto, onCerrar, sucursales, onCreado }) {
  const [nombre, setNombre] = useState('')
  const [slug, setSlug] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [guardando, setGuardando] = useState(false)

  // El slug se propone mientras se escribe el nombre, y deja de proponerse en
  // cuanto alguien lo toca: pisarle lo que escribió es cómo el formulario manda
  // una dirección que el comercio no eligió.
  const [tocado, setTocado] = useState(false)
  const propuesto = tocado ? normalizarSlug(slug) : normalizarSlug(nombre)
  const validacion = validarSlug(propuesto)

  useEffect(() => {
    if (!abierto) return

    setNombre('')
    setSlug('')
    setTocado(false)
    setSucursal(sucursales[0]?.id ?? '')
  }, [abierto, sucursales])

  if (!abierto) return null

  const crear = async () => {
    if (!nombre.trim()) {
      toast.error('Poné el nombre visible del catálogo.')

      return
    }

    if (!validacion.ok) {
      toast.error(validacion.motivo)

      return
    }

    setGuardando(true)
    try {
      const res = await api.post('/catalogos', {
        nombre_visible: nombre.trim(),
        slug: propuesto,
        punto_de_venta_id: Number(sucursal),
      })

      toast.success('El catálogo se creó en borrador.')
      onCerrar()
      onCreado(res.data?.data || {})
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo crear el catálogo.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4">
      <div role="dialog" aria-label="Nuevo catálogo" className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-nivel-3">
        <h2>Nuevo catálogo</h2>
        <p className="mt-1 text-[13px] text-fg-2">
          Nace en borrador: la dirección no lleva a ningún lado hasta que lo publiques.
        </p>

        <div className="mt-4 flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="nuevo-nombre">Nombre visible</label>
            <input
              id="nuevo-nombre"
              className={CAMPO}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="nuevo-slug">Dirección web</label>
            <input
              id="nuevo-slug"
              className={`${CAMPO} num`}
              value={tocado ? slug : propuesto}
              onChange={(e) => { setTocado(true); setSlug(e.target.value) }}
            />
            <p className="num text-[11.5px] text-fg-3">{urlDelCatalogo(propuesto)}</p>
            {!validacion.ok && propuesto !== '' && (
              <p className="text-[11.5px] font-medium text-danger">{validacion.motivo}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="nuevo-sucursal">Sucursal</label>
            <select
              id="nuevo-sucursal"
              className={CAMPO}
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p className="text-[11.5px] text-fg-3">
              De acá sale el stock que se publica. Se puede cambiar después.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className={BOTON_SECUNDARIO} onClick={onCerrar}>Cancelar</button>
          <button className={BOTON_SECUNDARIO} disabled={guardando} onClick={crear}>
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Crear catálogo
          </button>
        </div>
      </div>
    </div>
  )
}
