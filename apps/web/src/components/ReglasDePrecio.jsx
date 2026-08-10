import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Info, Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import api from '@/services/api'
import EstadoVacio from '@/components/EstadoVacio'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { faltaElPermiso } from '@/utils/permisos'
import { pesosDeLista } from '@/utils/formato'
import {
  AMBITOS, TIPOS, ETIQUETAS_DE_AMBITO, ETIQUETAS_DE_TIPO,
  ordenarPorEspecificidad, sangriaDeAmbito, textoDeValor, textoDeCobertura,
  esReglaSinEfecto, etiquetaDeAviso,
} from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · Las reglas de precio de un catálogo
//
//  Es el corazón de la pantalla, y lo que lo hace entendible son **dos cosas
//  visuales** — no un párrafo de ayuda:
//
//  **1. La sangría por especificidad.** Las cuatro filas no están alineadas al
//  mismo margen: cuanto más específica es la regla, más a la derecha empieza.
//  Con eso, «gana la más específica» se ve; alineadas, hay que leerlo en un
//  manual y creerle.
//
//  **2. La columna «Gana en N de M».** Una regla de catálogo que alcanza a ocho
//  productos y gana en cuatro es una a la que otras cuatro más específicas le
//  pisaron la mitad. Los dos números juntos cuentan esa historia de un vistazo;
//  el de la izquierda solo, no.
//
//  ── La pantalla NO calcula ningún precio (H2) ──
//
//  Los precios de lista, la regla que gana, las pisadas y las coberturas vienen
//  del servidor, que los resuelve con `utils/reglasDePrecio.js` — el mismo motor
//  que usa la tienda pública. Una segunda implementación acá abajo sería otra
//  que se desincroniza, y el número que ve el comercio dejaría de ser el que ve
//  el visitante sin que nada falle.
//
//  ── La regla huérfana se dibuja, no desaparece ──
//
//  Una regla cuya marca alguien borró queda con cobertura `0 de 0`. Se muestra
//  **atenuada** y con esos dos ceros. Esconderla dejaría una fila en la base que
//  nadie puede ver para borrarla, y una columna «Gana en» que no suma lo que
//  debería sin ninguna explicación a la vista.
// ════════════════════════════════════════════

/**
 * Las columnas de la tabla de reglas.
 *
 * El MISMO string en el encabezado y en las filas. Si difieren, las etiquetas
 * dejan de estar sobre sus datos y se lee un porcentaje bajo «Gana en».
 */
const COLUMNAS = '250px minmax(0,1fr) 152px 92px 96px 72px'

/** Las columnas de la previsualización sobre productos reales. */
const COLUMNAS_PREVIA = 'minmax(0,1fr) 132px 112px 230px 118px'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface '
  + 'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 '
  + 'disabled:cursor-not-allowed disabled:opacity-55'

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13.5px] '
  + 'transition-colors focus-visible:border-brand focus-visible:outline-none '
  + 'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-2'

const ETIQUETA = 'text-[12.5px] font-semibold'

export default function ReglasDePrecio({ catalogo, puedeEditar, confirm }) {
  const [reglas, setReglas] = useState([])
  const [previa, setPrevia] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [marcas, setMarcas] = useState([])
  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [editando, setEditando] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [resReglas, resPrevia, resCategorias, resProductos] = await Promise.all([
        api.get(`/catalogos/${catalogo.id}/reglas`),
        api.get(`/catalogos/${catalogo.id}/previsualizacion`),
        api.get(`/catalogos/${catalogo.id}/categorias`),
        api.get(`/catalogos/${catalogo.id}/productos`),
      ])

      setReglas(resReglas.data?.data?.reglas || [])
      setPrevia(resPrevia.data?.data || null)
      setCategorias(resCategorias.data?.data || [])
      setProductos((resProductos.data?.data || []).filter((p) => p.en_el_catalogo))
      setError(null)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar las reglas de precio.'))
    } finally {
      setCargando(false)
    }
  }, [catalogo.id])

  useEffect(() => { cargar() }, [cargar])

  // Las marcas van por su cuenta y su fallo NO rompe la pestaña: `/brands` pide
  // `products.ver`, que es un permiso distinto de `catalogo.ver`. Sin marcas, el
  // ámbito «Marca» queda sin opciones y lo dice; lo demás sigue funcionando.
  useEffect(() => {
    let vivo = true

    api.get('/brands')
      .then((res) => { if (vivo) setMarcas(res.data?.data || []) })
      .catch(() => { if (vivo) setMarcas([]) })

    return () => { vivo = false }
  }, [])

  const nombreDeMarca = useMemo(() => {
    const porId = new Map(marcas.map((m) => [m.id, m.name]))

    return (id) => porId.get(id) || (id ? `Marca #${id}` : '—')
  }, [marcas])

  const nombreDeProducto = useMemo(() => {
    const porId = new Map(productos.map((p) => [p.id, p.name]))

    return (id) => porId.get(id) || (id ? `Producto #${id}` : '—')
  }, [productos])

  const etiquetaDeCategoria = useMemo(() => {
    const porClave = new Map(categorias.map((c) => [c.categoria, c.etiqueta]))

    return (clave) => porClave.get(clave) || clave || '—'
  }, [categorias])

  /** A qué apunta una regla, con el nombre que se lee y no con el id. */
  const objetivoDe = (regla) => {
    if (regla.ambito === 'catalogo') return 'Todos los productos del catálogo'
    if (regla.ambito === 'categoria') return etiquetaDeCategoria(regla.categoria)
    if (regla.ambito === 'marca') return nombreDeMarca(regla.brand_id)

    return nombreDeProducto(regla.product_id)
  }

  const borrar = async (regla) => {
    const ok = await confirm(
      `La regla «${ETIQUETAS_DE_AMBITO[regla.ambito]} · ${textoDeValor(regla)}» deja de aplicarse `
      + 'y los productos que alcanzaba pasan a mandarse con la regla que siga en especificidad.',
      { verbo: 'Eliminar la regla' }
    )
    if (!ok) return

    try {
      await api.delete(`/catalogos/${catalogo.id}/reglas/${regla.id}`)
      cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo eliminar la regla.'))
    }
  }

  const ordenadas = ordenarPorEspecificidad(reglas)

  return (
    <div className="flex flex-col gap-5">

      {/* ── La regla del sistema, dicha una vez ── */}
      <div className="flex items-start gap-3 rounded-xl border border-info-line bg-info-soft px-4 py-3.5">
        <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-info" />
        <div>
          <p className="text-[13px] font-semibold text-info">
            Gana la regla más específica. No se acumulan.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">
            Un producto con regla propia ignora la de su marca; una marca ignora la de su
            categoría; y todas ignoran la del catálogo entero. La columna «Gana en» dice sobre
            cuántos productos manda cada una hoy.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-5 py-4">
          <p className="text-[13.5px] font-semibold text-danger">{error}</p>
        </div>
      )}

      {/* ── Las reglas ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <h2>Reglas del catálogo</h2>
          <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
            {reglas.length}
          </span>
          <div className="flex-1" />
          <button
            className={BOTON_SECUNDARIO}
            disabled={!puedeEditar}
            title={puedeEditar ? undefined : faltaElPermiso('catalogo.editar')}
            onClick={() => setEditando({ ambito: 'catalogo', tipo: 'porcentaje_descuento', valor: '' })}
          >
            <Plus className="h-3.5 w-3.5 text-fg-3" />
            Nueva regla
          </button>
        </div>

        {cargando ? (
          <div className="grid place-items-center py-14">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : reglas.length === 0 ? (
          <EstadoVacio
            icono={Tag}
            codigo="sin_reglas"
            titulo="El catálogo sale con los precios de lista."
            detalle="Una regla cambia el precio de un producto, de una marca, de una categoría o del catálogo entero. Gana la más específica."
          />
        ) : (
          <>
            <TablaGrid anchoMinimo={860}>
              <Encabezado columnas={COLUMNAS}>
                <span>Ámbito</span>
                <span>A qué se aplica</span>
                <span>Tipo</span>
                <span className="text-right">Valor</span>
                <span className="text-right">Gana en</span>
                <span />
              </Encabezado>

              {ordenadas.map((regla) => {
                const sinEfecto = esReglaSinEfecto(regla)

                return (
                  <Fila
                    key={regla.id}
                    columnas={COLUMNAS}
                    data-regla={regla.id}
                    /* Atenuada y NO escondida: la regla cuya marca alguien borró
                       tiene que poder verse para poder borrarse. */
                    className={sinEfecto ? 'opacity-55' : ''}
                  >
                    {/* La sangría por especificidad. Es la que hace visible que
                        una regla de producto manda sobre una de marca. */}
                    <span style={{ paddingLeft: `${sangriaDeAmbito(regla.ambito)}px` }}>
                      <span className="inline-flex items-center rounded-md border border-brand-line bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-dark">
                        {ETIQUETAS_DE_AMBITO[regla.ambito]}
                      </span>
                    </span>

                    <span className="min-w-0 truncate text-[13.5px]">{objetivoDe(regla)}</span>

                    <span className="text-[13px] text-fg-2">{ETIQUETAS_DE_TIPO[regla.tipo]}</span>

                    <span className="num text-right text-[13.5px] font-semibold">
                      {textoDeValor(regla)}
                    </span>

                    <span
                      className="num text-right text-[12.5px] text-fg-2"
                      title={sinEfecto ? 'Hoy no alcanza a ningún producto del catálogo.' : undefined}
                    >
                      {textoDeCobertura(regla.cobertura)}
                    </span>

                    <span className="flex justify-end gap-0.5">
                      <BotonDeFila
                        title={puedeEditar ? 'Editar la regla' : faltaElPermiso('catalogo.editar')}
                        disabled={!puedeEditar}
                        onClick={() => setEditando({ ...regla, valor: String(regla.valor) })}
                      >
                        <Pencil />
                      </BotonDeFila>
                      <BotonDeFila
                        title={puedeEditar ? 'Eliminar la regla' : faltaElPermiso('catalogo.editar')}
                        disabled={!puedeEditar}
                        onClick={() => borrar(regla)}
                      >
                        <Trash2 />
                      </BotonDeFila>
                    </span>
                  </Fila>
                )
              })}
            </TablaGrid>

            <p className="flex items-center gap-2 px-5 py-2.5 text-[12.5px] text-fg-2">
              <span className="inline-block h-2 w-2 rounded-sm bg-brand-line" />
              La sangría indica la especificidad: cuanto más a la derecha, más manda.
            </p>
          </>
        )}
      </section>

      {/* ── La previsualización sobre productos reales ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="border-b border-border px-5 py-4">
          <h2>Previsualización sobre productos reales</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-2">
            Precio de lista de Favalio, la regla que termina ganando, y el precio con el que sale a
            la tienda. Los tres los calcula el servidor.
          </p>
        </div>

        {cargando ? (
          <div className="grid place-items-center py-14">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : (previa?.productos || []).length === 0 ? (
          <EstadoVacio
            icono={Tag}
            codigo="sin_previsualizacion"
            titulo="Todavía no hay productos que salgan."
            detalle="Agregá productos en la pestaña Productos: la previsualización muestra los que están publicables, activos y con precio."
          />
        ) : (
          <>
            <TablaGrid anchoMinimo={880}>
              <Encabezado columnas={COLUMNAS_PREVIA}>
                <span>Producto</span>
                <span>Marca</span>
                <span className="text-right">Precio de lista</span>
                <span>Regla que gana</span>
                <span className="text-right">Precio del catálogo</span>
              </Encabezado>

              {previa.productos.map((p) => (
                <Fila key={p.id} columnas={COLUMNAS_PREVIA} data-previa={p.id}>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px]">{p.name}</span>
                    {p.avisos.map((aviso) => (
                      <span key={aviso} className="block text-[11px] font-medium text-warn">
                        {etiquetaDeAviso(aviso)}
                      </span>
                    ))}
                  </span>

                  <span className="truncate text-[13px] text-fg-2">{nombreDeMarca(p.brand_id)}</span>

                  <span className="num text-right text-[13px] text-fg-2 line-through">
                    ${pesosDeLista(p.precio_lista)}
                  </span>

                  <span className="min-w-0">
                    {p.regla ? (
                      <span className="inline-flex items-center rounded-md border border-brand-line bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-dark">
                        {ETIQUETAS_DE_AMBITO[p.regla.ambito]} · {textoDeValor(p.regla)}
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-fg-3">Sale al precio de lista</span>
                    )}

                    {/* Las pisadas, tachadas y debajo de la que ganó: es lo que
                        hace entendible por qué el precio es ese y no el otro. */}
                    {p.pisadas.map((pisada) => (
                      <span key={pisada.id} className="mt-1 block text-[11px] text-fg-3 line-through">
                        {ETIQUETAS_DE_AMBITO[pisada.ambito]} · {textoDeValor(pisada)}
                      </span>
                    ))}
                  </span>

                  <span className="num text-right text-[14px] font-semibold">
                    ${pesosDeLista(p.precio)}
                  </span>
                </Fila>
              ))}
            </TablaGrid>

            {/* Los que NO van a salir, con nombre y apellido: «55 de 431» sin la
                lista no le sirve a nadie para arreglarlo. */}
            {(previa.sin_precio || []).length > 0 && (
              <p className="border-t border-border px-5 py-2.5 text-[12.5px] text-fg-2">
                <span className="num font-semibold text-warn">{previa.sin_precio.length}</span>
                {' productos del catálogo no salen porque no tienen precio: '}
                {previa.sin_precio.map((p) => p.name).join(', ')}.
              </p>
            )}
          </>
        )}
      </section>

      {editando && (
        <DialogoDeRegla
          catalogo={catalogo}
          regla={editando}
          categorias={categorias}
          marcas={marcas}
          productos={productos}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); cargar() }}
        />
      )}
    </div>
  )
}

/**
 * El alta y la edición de una regla.
 *
 * El ámbito decide qué campo de objetivo se dibuja, y **sólo uno**: es lo mismo
 * que exige el CHECK de la base y lo mismo que valida el servidor. Dibujar los
 * tres a la vez deja mandar una regla de marca con `product_id` cargado, que el
 * servidor rechaza con un mensaje que ya no se puede relacionar con ningún
 * campo de la pantalla.
 */
function DialogoDeRegla({ catalogo, regla, categorias, marcas, productos, onCerrar, onGuardado }) {
  const [forma, setForma] = useState(() => ({
    ambito: regla.ambito || 'catalogo',
    tipo: regla.tipo || 'porcentaje_descuento',
    valor: regla.valor ?? '',
    categoria: regla.categoria || categorias[0]?.categoria || '',
    brand_id: regla.brand_id || marcas[0]?.id || '',
    product_id: regla.product_id || productos[0]?.id || '',
  }))
  const [guardando, setGuardando] = useState(false)

  const cambiar = (campo, valor) => setForma((f) => ({ ...f, [campo]: valor }))

  const guardar = async () => {
    const cuerpo = { ambito: forma.ambito, tipo: forma.tipo, valor: Number(forma.valor) }

    if (forma.ambito === 'categoria') cuerpo.categoria = forma.categoria
    if (forma.ambito === 'marca') cuerpo.brand_id = Number(forma.brand_id)
    if (forma.ambito === 'producto') cuerpo.product_id = Number(forma.product_id)

    setGuardando(true)
    try {
      if (regla.id) await api.put(`/catalogos/${catalogo.id}/reglas/${regla.id}`, cuerpo)
      else await api.post(`/catalogos/${catalogo.id}/reglas`, cuerpo)

      onGuardado()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar la regla.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4">
      <div role="dialog" aria-label="Regla de precio" className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-nivel-3">
        <h2>{regla.id ? 'Editar la regla' : 'Nueva regla'}</h2>
        <p className="mt-1 text-[13px] text-fg-2">
          Cuanto más específico es el ámbito, más manda: un producto ignora a su marca, y una marca
          ignora a su categoría.
        </p>

        <div className="mt-4 flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className={ETIQUETA} htmlFor="regla-ambito">Ámbito</label>
            <select
              id="regla-ambito"
              className={CAMPO}
              value={forma.ambito}
              onChange={(e) => cambiar('ambito', e.target.value)}
            >
              {AMBITOS.map((a) => (
                <option key={a} value={a}>{ETIQUETAS_DE_AMBITO[a]}</option>
              ))}
            </select>
          </div>

          {forma.ambito === 'categoria' && (
            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="regla-categoria">Categoría</label>
              <select
                id="regla-categoria"
                className={CAMPO}
                value={forma.categoria}
                onChange={(e) => cambiar('categoria', e.target.value)}
              >
                {categorias.map((c) => (
                  <option key={c.categoria} value={c.categoria}>{c.etiqueta}</option>
                ))}
              </select>
              {categorias.length === 0 && (
                <p className="text-[11.5px] text-fg-3">
                  Todavía no hay categorías: salen de los productos publicables del catálogo.
                </p>
              )}
            </div>
          )}

          {forma.ambito === 'marca' && (
            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="regla-marca">Marca</label>
              <select
                id="regla-marca"
                className={CAMPO}
                value={forma.brand_id}
                onChange={(e) => cambiar('brand_id', e.target.value)}
              >
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {marcas.length === 0 && (
                <p className="text-[11.5px] text-fg-3">
                  No se pudieron cargar las marcas. Hace falta {faltaElPermiso('products.ver')}.
                </p>
              )}
            </div>
          )}

          {forma.ambito === 'producto' && (
            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="regla-producto">Producto</label>
              <select
                id="regla-producto"
                className={CAMPO}
                value={forma.product_id}
                onChange={(e) => cambiar('product_id', e.target.value)}
              >
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="regla-tipo">Tipo</label>
              <select
                id="regla-tipo"
                className={CAMPO}
                value={forma.tipo}
                onChange={(e) => cambiar('tipo', e.target.value)}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>{ETIQUETAS_DE_TIPO[t]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={ETIQUETA} htmlFor="regla-valor">Valor</label>
              <input
                id="regla-valor"
                className={`${CAMPO} num`}
                inputMode="decimal"
                value={forma.valor}
                onChange={(e) => cambiar('valor', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className={BOTON_SECUNDARIO} onClick={onCerrar}>Cancelar</button>
          <button className={BOTON_SECUNDARIO} disabled={guardando} onClick={guardar}>
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {regla.id ? 'Guardar la regla' : 'Crear la regla'}
          </button>
        </div>
      </div>
    </div>
  )
}
