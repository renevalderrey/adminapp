import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Package, Search } from 'lucide-react'
import api from '@/services/api'
import EstadoVacio from '@/components/EstadoVacio'
import { TablaGrid, Encabezado, Fila } from '@/components/TablaGrid'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { faltaElPermiso } from '@/utils/permisos'
import { pesosDeLista } from '@/utils/formato'
import { ETIQUETAS_DE_AMBITO, textoDeValor, etiquetaDeAviso } from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · Qué productos salen a este catálogo
//
//  `catalogo_productos` es una **lista de inclusión** (decisión 9): estar en la
//  tabla **es** estar en el catálogo. No hay «todos los publicables menos
//  excepciones», y un producto publicable nuevo no aparece en ningún catálogo
//  hasta que alguien lo agrega acá (FR-064).
//
//  ── Por qué las acciones son EN LOTE, y no un botón por fila ──
//
//  Comprafit tiene 431 productos. Montar su catálogo el primer día con un clic
//  por producto son 62 clics para los que salen, y eso es lo que hace que la
//  selección explícita no se use (FR-066). La selección múltiple no es un adorno
//  de la maqueta: es lo que la vuelve usable.
//
//  Y son **una llamada**, no una por producto. Diez llamadas en paralelo sobre
//  la misma tabla es la forma de que cinco entren, tres choquen y dos se
//  pierdan, con la pantalla mostrando un estado que no es el de la base.
//
//  ── Quitar BORRA la fila ──
//
//  No hay una tercera bandera que apagar (FR-065): `publicable` e `is_active`
//  ya existen en el producto, y una columna `visible` acá sería una tercera
//  forma de decir lo mismo — con lo cual habría tres lugares donde mirar cuando
//  un producto no sale. La pantalla lo dice al lado del botón: quitar del
//  catálogo no toca el inventario.
//
//  ── Los dos avisos ──
//
//  · **Sin precio**: no va a salir aunque esté marcado publicable. Hoy son 376
//    de los 431 de Comprafit, o sea la mayoría: sin el aviso, el comercio
//    publica el catálogo y descubre que está casi vacío.
//  · **Foto externa**: la imagen vive en un hosting de terceros que puede
//    caerse, cambiar la foto o pedir referer, así que **no se publica** (FR-030,
//    H6). El producto sale igual, sin foto, y eso hay que decirlo antes.
// ════════════════════════════════════════════

/**
 * Las columnas de la grilla.
 *
 * La casilla de selección va **al principio del string** y mide 30px, como fija
 * `REGLAS-DISENO.md` para las pantallas con acción masiva. El mismo string en el
 * encabezado y en las filas.
 */
const COLUMNAS = '30px minmax(0,1fr) 132px 118px 104px 168px 112px'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface '
  + 'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 '
  + 'disabled:cursor-not-allowed disabled:opacity-55'

export default function ProductosDelCatalogo({ catalogo, puedeEditar, onCambio }) {
  const [productos, setProductos] = useState([])
  const [precios, setPrecios] = useState(new Map())
  const [marcas, setMarcas] = useState([])
  const [elegidos, setElegidos] = useState(() => new Set())
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [resProductos, resPrevia] = await Promise.all([
        api.get(`/catalogos/${catalogo.id}/productos`),
        api.get(`/catalogos/${catalogo.id}/previsualizacion`),
      ])

      setProductos(resProductos.data?.data || [])
      // La regla que gana y el precio final los resuelve el servidor. Acá sólo
      // se indexan por producto para poder ponerlos en su fila.
      setPrecios(new Map((resPrevia.data?.data?.productos || []).map((p) => [p.id, p])))
      setElegidos(new Set())
      setError(null)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los productos del catálogo.'))
    } finally {
      setCargando(false)
    }
  }, [catalogo.id])

  useEffect(() => { cargar() }, [cargar])

  // `/brands` pide `products.ver`, que es otro permiso: su fallo no puede dejar
  // la pestaña sin productos.
  useEffect(() => {
    let vivo = true

    api.get('/brands')
      .then((res) => { if (vivo) setMarcas(res.data?.data || []) })
      .catch(() => { if (vivo) setMarcas([]) })

    return () => { vivo = false }
  }, [])

  const nombreDeMarca = useMemo(() => {
    const porId = new Map(marcas.map((m) => [m.id, m.name]))

    return (id) => porId.get(id) || '—'
  }, [marcas])

  const enElCatalogo = productos.filter((p) => p.en_el_catalogo).length

  // El filtro es del navegador y no del servidor: el endpoint devuelve la lista
  // entera de una vez, así que rebotar un pedido por tecla sería demora pura
  // sobre datos que ya están en memoria.
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return productos

    return productos.filter((p) => [p.name, p.sku, p.category]
      .some((campo) => String(campo || '').toLowerCase().includes(texto)))
  }, [productos, busqueda])

  const alternar = (id) => setElegidos((actual) => {
    const proximo = new Set(actual)
    if (proximo.has(id)) proximo.delete(id)
    else proximo.add(id)

    return proximo
  })

  const alternarTodos = () => setElegidos((actual) => (
    actual.size === visibles.length ? new Set() : new Set(visibles.map((p) => p.id))
  ))

  /**
   * Publicar y quitar, los dos con UNA sola llamada.
   *
   * Los ids viajan juntos en el cuerpo. El servidor filtra los que no son de la
   * empresa y contesta cuántos entraron; rechazar el lote entero porque uno de
   * los ids ya no existe dejaría al comercio sin forma de avanzar y sin saber
   * cuál era.
   */
  const enLote = async (accion) => {
    const ids = [...elegidos]
    if (ids.length === 0) return

    setEnviando(true)
    try {
      if (accion === 'publicar') {
        const res = await api.post(`/catalogos/${catalogo.id}/productos`, { ids })
        const datos = res.data?.data || {}
        toast.success(`${datos.agregados ?? ids.length} productos agregados al catálogo.`)
      } else {
        const res = await api.delete(`/catalogos/${catalogo.id}/productos`, { data: { ids } })
        const datos = res.data?.data || {}
        toast.success(`${datos.quitados ?? ids.length} productos quitados del catálogo.`)
      }

      await cargar()
      onCambio?.()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo actualizar la lista de productos.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-border bg-surface px-2.5">
          <Search className="h-[15px] w-[15px] shrink-0 text-fg-3" />
          <input
            className="w-full bg-transparent text-[13.5px] outline-none"
            placeholder="Buscar por producto, marca o código"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        {/* El contador de la maqueta (`:985`): los dos números salen de la misma
            respuesta, así que no pueden contradecirse. */}
        <span className="text-[12.5px] text-fg-2">
          <strong className="num font-semibold text-foreground">{enElCatalogo}</strong>
          {' publicados de '}
          <span className="num">{productos.length}</span>
          {' del inventario'}
        </span>

        <div className="flex-1" />

        {elegidos.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-brand-line bg-brand-soft px-2.5 py-1.5">
            <span className="text-[12.5px] font-semibold text-brand-dark">
              <span className="num">{elegidos.size}</span> seleccionados
            </span>
            <span className="h-3.5 w-px bg-brand-line" />
            <button
              className="h-[26px] rounded-md px-2 text-[12.5px] font-semibold text-brand-dark transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!puedeEditar || enviando}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onClick={() => enLote('publicar')}
            >
              Publicar
            </button>
            <button
              className="h-[26px] rounded-md px-2 text-[12.5px] font-semibold text-fg-2 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!puedeEditar || enviando}
              title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
              onClick={() => enLote('quitar')}
            >
              Quitar
            </button>
          </div>
        )}
      </div>

      {/* Dicho donde se aprieta, y no en un manual: «Quitar» no desactiva nada,
          borra la fila del catálogo. El producto sigue en el inventario. */}
      <p className="border-b border-border bg-surface-2 px-5 py-2 text-[12px] text-fg-2">
        «Publicar» agrega los seleccionados a este catálogo y «Quitar» los saca. Quitar borra la
        fila del catálogo: el producto sigue en el inventario, con su stock y su precio.
      </p>

      {error && (
        <div role="alert" className="border-b border-border bg-danger-soft px-5 py-3">
          <p className="text-[13px] font-semibold text-danger">{error}</p>
        </div>
      )}

      {cargando ? (
        <div className="grid place-items-center py-14">
          <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
        </div>
      ) : productos.length === 0 ? (
        <EstadoVacio
          icono={Package}
          codigo="sin_productos"
          titulo="No hay ningún producto publicable."
          detalle="Un producto sale a un catálogo sólo si está marcado como publicable en el inventario. Marcá los que quieras vender y volvé acá."
        />
      ) : visibles.length === 0 ? (
        <EstadoVacio
          icono={Search}
          codigo="sin_coincidencias"
          titulo="Ningún producto coincide con la búsqueda."
          detalle="Probá con parte del nombre, del código o de la marca."
        />
      ) : (
        <TablaGrid anchoMinimo={980}>
          <Encabezado columnas={COLUMNAS}>
            <span>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand"
                aria-label="Seleccionar todos los productos de la lista"
                checked={elegidos.size > 0 && elegidos.size === visibles.length}
                onChange={alternarTodos}
              />
            </span>
            <span>Producto</span>
            <span>Marca</span>
            <span>Categoría</span>
            <span className="text-right">Lista</span>
            <span>Regla que gana</span>
            <span className="text-right">Precio catálogo</span>
          </Encabezado>

          {visibles.map((p) => {
            const calculado = precios.get(p.id)

            return (
              <Fila
                key={p.id}
                columnas={COLUMNAS}
                data-producto={p.id}
                className={p.en_el_catalogo ? '' : 'opacity-70'}
              >
                <span>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-brand"
                    aria-label={`Seleccionar ${p.name}`}
                    checked={elegidos.has(p.id)}
                    onChange={() => alternar(p.id)}
                  />
                </span>

                <span className="min-w-0">
                  <span className="block truncate text-[13.5px]">{p.name}</span>
                  <span className="num block truncate text-[11px] text-fg-3">{p.sku}</span>

                  {/* Los avisos van en la fila del producto que los tiene, no en
                      un resumen al pie: el comercio arregla productos, no
                      resúmenes. */}
                  {p.avisos.map((aviso) => (
                    <span key={aviso} className="block text-[11px] font-medium text-warn">
                      {etiquetaDeAviso(aviso)}
                    </span>
                  ))}
                </span>

                <span className="truncate text-[13px] text-fg-2">{nombreDeMarca(p.brand_id)}</span>

                <span className="truncate text-[13px] text-fg-2">{p.category || '—'}</span>

                <span className="num text-right text-[13px] text-fg-2">
                  ${pesosDeLista(p.precio_lista)}
                </span>

                <span className="min-w-0 truncate text-[12px] text-fg-2">
                  {calculado?.regla
                    ? `${ETIQUETAS_DE_AMBITO[calculado.regla.ambito]} · ${textoDeValor(calculado.regla)}`
                    : '—'}
                </span>

                <span className="num text-right text-[13.5px] font-semibold">
                  {calculado ? `$${pesosDeLista(calculado.precio)}` : '—'}
                </span>
              </Fila>
            )
          })}
        </TablaGrid>
      )}

      {!cargando && visibles.length > 0 && (
        <p className="px-5 py-2.5 text-[12.5px] text-fg-2">
          Mostrando <span className="num">{visibles.length}</span> de{' '}
          <span className="num">{productos.length}</span> productos
        </p>
      )}
    </section>
  )
}
