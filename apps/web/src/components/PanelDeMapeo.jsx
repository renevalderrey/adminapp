import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Info, Loader2, Search, Unlink } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { usePermission } from '@/hooks/usePermission'
import { borrarTiendanubeMapeo, crearTiendanubeMapeo, getProducts } from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import {
  ETIQUETAS_DE_MAPEO,
  estadoDeMapeo,
  tonoDeMapeo,
} from '@/utils/tiendanube'

// ════════════════════════════════════════════
//  ADMINAPP · El panel de mapeo de una variante
//
//  **Panel y no modal** (FR-053), y es una decisión y no una preferencia: el
//  producto del sistema se elige **mirando** la lista de variantes, no
//  tapándola. Quien mapea está comparando dos catálogos y necesita ver el
//  nombre de la variante de al lado para no equivocarse de talle. Es la misma
//  decisión que tomó Inventario en el hito 4.
//
//  ── La sugerencia PROPONE, no mapea ([PENDIENTE N3], US3 escenario 6) ──
//
//  El servidor manda `sugerencia: { coincidencias, producto }` en cada fila sin
//  mapear de `GET /variantes`, y este panel la dibuja **marcada como sugerencia
//  y sin aplicar**. Hay que apretarla y después confirmar.
//
//  Mapear solo por SKU es exactamente cómo se mapea el producto equivocado sin
//  que nadie lo mire: dos productos con el mismo SKU no son imposibles en este
//  catálogo —es un dato que se carga a mano y se copia entre listas de
//  proveedor— y el síntoma aparece meses después, en un recuento físico, cuando
//  ya no se puede reconstruir qué pasó. Por eso, con **más de una** coincidencia
//  el servidor no propone ninguna y este panel **dice cuántas hay**: elegir por
//  el usuario cuando el dato es ambiguo es peor que no ayudar.
//
//  ── Por qué un error NO cierra el panel ──
//
//  Un 429 o un 502 con el panel cerrándose deja a quien estaba mapeando sin el
//  mensaje, sin el producto que había elegido y sin lo que había escrito en el
//  buscador, y con la sensación de que guardó. El aviso queda adentro, arriba
//  del pie, y el estado no se toca (US6 escenarios 2 y 4).
//
//  Y los avisos de las dos familias **son distintos** (FR-062): un problema de
//  TiendaNube y uno de AdminApp se arreglan en lados distintos, y el usuario que
//  ve siempre el mismo texto llama al que no es.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/** Cuántos productos trae la búsqueda del panel. Es una lista para elegir, no un listado. */
const RESULTADOS = 20

/** Cuánto espera el buscador antes de salir a la red. */
const REBOTE_MS = 300

/**
 * El aviso que se le muestra a una persona por un error de la API.
 *
 * ⚠ **Se exporta y la pantalla usa el mismo**, por el mismo motivo que
 * `CLASES_POR_TONO` vive en un solo lugar: dos traducciones del mismo error
 * derivan, y entonces el 429 dice una cosa en el panel y otra en la tabla.
 *
 * Los tres tramos son tres respuestas distintas y por eso no comparten texto:
 *
 *  · **429** no es un error, es «más despacio». Reintentar en el momento lo
 *    empeora, y el texto lo dice.
 *  · **5xx** es del otro lado. Decir «no se pudo guardar» a secas manda a
 *    revisar AdminApp, que es el lado que está bien (FR-062).
 *  · el resto lo explica el servidor en castellano, que es donde `fallo()` y
 *    `ErrorDeNegocio` dejan el mensaje con el contexto —«"Colágeno 300g" ya está
 *    mapeado a la variante …»—. `err.message` de axios diría «Request failed
 *    with status code 409».
 */
export function avisoDeError(err, generico) {
  const status = err?.response?.status

  if (status === 429) {
    return 'Se hicieron demasiadas consultas seguidas. Esperá unos segundos y volvé a intentar: no se perdió nada.'
  }

  if (status >= 500 && status <= 599) {
    return 'TiendaNube no está contestando. No es un problema de AdminApp: probá de nuevo en unos minutos.'
  }

  return mensajeDeError(err, generico)
}

/** Clases del botón principal del sistema (34px, marca, texto blanco). */
const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/** Clases del botón secundario del sistema. */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface ' +
  'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

export default function PanelDeMapeo({ variante, abierto, onOpenChange, onCambio }) {
  const { can } = usePermission()
  const puedeEditar = can('config.editar')

  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const varianteId = variante?.tiendanube_variant_id ?? null

  // Cambiar de variante limpia todo. Sin esto, el producto elegido para la
  // variante anterior queda seleccionado en la siguiente y un «Confirmar» de
  // más mapea la variante equivocada contra un producto que nadie eligió.
  useEffect(() => {
    setTexto('')
    setResultados([])
    setElegido(null)
    setAviso(null)
  }, [varianteId])

  useEffect(() => {
    const buscado = texto.trim()

    if (buscado.length < 2) {
      setResultados([])
      return undefined
    }

    // El rebote existe para que escribir «Colágeno» no sean ocho consultas: la
    // API tiene un límite por IP y el buscador de una pantalla es lo primero que
    // lo agota.
    const temporizador = setTimeout(async () => {
      setBuscando(true)
      try {
        const res = await getProducts({ search: buscado, limit: RESULTADOS })
        setResultados(res.data?.data || [])
      } catch (err) {
        setAviso(avisoDeError(err, 'No se pudo buscar en el catálogo del sistema.'))
      } finally {
        setBuscando(false)
      }
    }, REBOTE_MS)

    return () => clearTimeout(temporizador)
  }, [texto])

  if (!variante) return null

  const estado = estadoDeMapeo(variante)
  const sugerencia = variante.sugerencia || null
  const coincidencias = Number(sugerencia?.coincidencias) || 0

  const confirmar = async () => {
    if (!elegido) return

    setGuardando(true)
    setAviso(null)

    try {
      await crearTiendanubeMapeo({
        product_id: elegido.id,
        tiendanube_variant_id: variante.tiendanube_variant_id,
        tiendanube_product_id: variante.tiendanube_product_id,
      })

      await onCambio?.()
      onOpenChange?.(false)
    } catch (err) {
      // El panel NO se cierra y el estado NO se toca: el aviso aparece adentro,
      // con lo elegido y lo escrito en su lugar.
      setAviso(avisoDeError(err, 'No se pudo guardar el mapeo.'))
    } finally {
      setGuardando(false)
    }
  }

  const quitar = async () => {
    if (!variante.mapeo?.id) return

    setGuardando(true)
    setAviso(null)

    try {
      await borrarTiendanubeMapeo(variante.mapeo.id)
      await onCambio?.()
      onOpenChange?.(false)
    } catch (err) {
      setAviso(avisoDeError(err, 'No se pudo quitar el mapeo.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent
        // El ancho va en `style` y no en clases: `SheetContent` trae
        // `data-[side=right]:sm:max-w-sm` y `w-3/4` propios, y esas reglas viven
        // en un media query que gana por orden de hoja. Un estilo en línea las
        // supera sin pelearse con el orden del CSS (FR-053).
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        {/* ── Encabezado ── */}
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Variante de tu tienda</p>

          <SheetTitle className="mt-1 text-[18px] font-semibold">
            {variante.nombre_producto}
            {variante.nombre_variante ? ` · ${variante.nombre_variante}` : ''}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            SKU <span className="num">{variante.sku || '—'}</span>
            {' · '}
            publica <span className="num">{variante.stock_en_tienda ?? '—'}</span> en la tienda
          </SheetDescription>

          <span
            className={`mt-2.5 inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeMapeo(estado)}`}
          >
            {ETIQUETAS_DE_MAPEO[estado]}
          </span>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          {variante.mapeo ? (
            <div>
              <p className="eyebrow">Producto del sistema</p>
              <p className="mt-1 text-[14px] font-semibold">{variante.mapeo.product_name}</p>
              <p className="mt-0.5 text-[12.5px] text-fg-3">
                SKU <span className="num">{variante.mapeo.sku || '—'}</span>
              </p>

              <button
                type="button"
                className={`${BOTON_SECUNDARIO} mt-4`}
                onClick={quitar}
                disabled={!puedeEditar || guardando}
              >
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5 text-fg-3" />}
                Quitar mapeo
              </button>

              {!puedeEditar && (
                <p className="mt-2 text-[12.5px] text-fg-3">
                  No podés cambiar los mapeos: te falta el permiso para editar la configuración.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* ── La sugerencia por SKU ── */}
              {coincidencias === 1 && sugerencia?.producto && (
                <div className="rounded-xl border border-info-line bg-info-soft px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-info" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-info">
                        Sugerencia por SKU · hay que confirmarla
                      </p>
                      <p className="mt-0.5 truncate text-[13.5px] font-semibold">
                        {sugerencia.producto.name}
                      </p>
                      <p className="text-[12.5px] text-fg-2">
                        Tiene el mismo SKU que esta variante. Revisá que sea el producto
                        correcto: el mapeo no se aplica solo.
                      </p>

                      <button
                        type="button"
                        className={`${BOTON_SECUNDARIO} mt-2.5`}
                        onClick={() => setElegido(sugerencia.producto)}
                        disabled={!puedeEditar}
                      >
                        Usar este producto
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {coincidencias > 1 && (
                <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-warn">
                        Hay {coincidencias} productos con el SKU {variante.sku}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-fg-2">
                        Por eso no proponemos ninguno: elegilo vos abajo. Mapear el
                        equivocado publica el stock de otro producto en esta variante.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Buscar el producto del sistema ── */}
              <div>
                <label className="eyebrow" htmlFor="tn-buscar-producto">
                  Buscar el producto del sistema
                </label>
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-surface px-3">
                  <Search className="h-[15px] w-[15px] shrink-0 text-fg-3" />
                  <input
                    id="tn-buscar-producto"
                    value={texto}
                    onChange={(evento) => setTexto(evento.target.value)}
                    placeholder="Por nombre o por SKU"
                    disabled={!puedeEditar}
                    className="h-[34px] min-w-0 flex-1 bg-surface text-[13px] outline-none disabled:cursor-not-allowed"
                  />
                  {buscando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
                </div>

                {resultados.length > 0 && (
                  <div className="mt-2 max-h-[240px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {resultados.map((producto) => (
                      <button
                        key={producto.id}
                        type="button"
                        onClick={() => setElegido(producto)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px]">{producto.name}</span>
                          <span className="block text-[12px] text-fg-3">
                            SKU <span className="num">{producto.sku || '—'}</span>
                          </span>
                        </span>
                        {elegido?.id === producto.id && <Check className="h-4 w-4 shrink-0 text-ok" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Lo elegido, y la confirmación ── */}
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                <p className="eyebrow">Se va a mapear contra</p>
                <p className="mt-1 text-[13.5px] font-semibold">
                  {elegido ? elegido.name : 'Todavía no elegiste ningún producto'}
                </p>

                <button
                  type="button"
                  className={`${BOTON_PRINCIPAL} mt-3`}
                  onClick={confirmar}
                  disabled={!puedeEditar || !elegido || guardando}
                >
                  {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirmar mapeo
                </button>

                {!puedeEditar && (
                  <p className="mt-2 text-[12.5px] text-fg-3">
                    No podés crear mapeos: te falta el permiso para editar la configuración.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ⚠ El aviso va ACÁ adentro y el panel sigue abierto: cerrarlo se
              lleva el mensaje, el producto elegido y lo que había escrito. */}
          {aviso && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3"
            >
              <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
              <p className="text-[13px] text-danger">{aviso}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
