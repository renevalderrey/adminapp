import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Link2, Loader2, RefreshCw, Unlink } from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import { getTiendanubeUltimaCorrida } from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { fechaCortaDeMomento } from '@/utils/formato'
import {
  ETIQUETAS_DE_CONEXION,
  estadoDeLaConexion,
  resumenDeCorrida,
  tonoDeConexion,
} from '@/utils/tiendanube'
import { faltaElPermiso } from '@/utils/permisos'

// ════════════════════════════════════════════
//  ADMINAPP · El bloque de conexión de /tiendanube
//
//  Los cuatro estados de FR-006 —`sin_configurar`, `no_vinculada`, `vinculada`
//  y `vinculada_con_error`— más el quinto **de la pantalla**, `no_comprobada`.
//  Cuál de los cinco es lo decide `estadoDeLaConexion` en `utils/tiendanube.js`
//  y **acá no se recalcula nada**: el servidor es el único que sabe si falta
//  `TIENDANUBE_CLIENT_ID` y si la última llamada a la API salió bien, y una
//  segunda fuente de verdad para la misma pregunta se separa de la primera sin
//  que nada avise.
//
//  ── El defecto que este bloque viene a cerrar ──
//
//  La tarjeta de Ajustes pedía `GET /tiendanube/status`, leía un booleano y, si
//  la llamada fallaba, hacía `console.error` y quedaba diciendo **«no
//  vinculada»**. Una empresa con la tienda conectada y una caída de red se veían
//  idénticas, y la que salía en pantalla era la mentira: el dueño volvía a
//  vincular sobre una vinculación que estaba bien. Acá eso es `no_comprobada`,
//  que dice «no sabemos» y ofrece reintentar.
//
//  Esa tarjeta ya no existe (T1345): el estado de la conexión se dice en UN solo
//  lugar, que es éste. En `/facturacion` quedó un enlace.
//
//  ── Qué recibe por props y qué lee por su cuenta ──
//
//  **Todos los datos llegan por props.** No lee el store: dos dueños del mismo
//  estado terminan dibujando una cosa y mandando otra, que es la misma regla de
//  los tres componentes de `components/pos/` y del panel de órdenes de compra.
//
//  La única excepción son los permisos, y por el mismo motivo que allá: no son
//  un dato de la tienda sino del contexto, y `usePermission` es de donde los lee
//  todo el repositorio.
//
//  ── Las tres fechas que están a la vista, y por qué ninguna es decoración ──
//
//   1. **`vinculada_en`** — desde cuándo. Sin ella, «Vinculada» no distingue una
//      conexión de ayer de una de hace un año.
//   2. **`catalogo_refrescado_en`** — de cuándo es la instantánea local que la
//      tabla de abajo está mostrando. Una instantánea sin fecha a la vista es
//      una mentira con horario: alguien lee un catálogo de la semana pasada
//      creyendo que es el estado actual de su tienda.
//   3. **`reconciliada_en`** — cuándo corrió la red de la decisión 4. Es la más
//      importante de las tres y la que más fácil se cae de una pantalla, porque
//      cuando funciona no dice nada. **El cron externo que la dispara hoy falla
//      todos los días**: faltan `API_URL` y `CRON_SECRET`
//      (`.github/workflows/tareas-diarias.yml:50-51`). Mientras eso siga así, un
//      empujón de stock que falle queda desfasado en silencio y **nada lo
//      reintenta**. Por eso, si nunca corrió, este bloque **lo dice** en vez de
//      dejar el hueco: la ausencia de la red tiene que verse, no suponerse
//      (riesgo 4 del plan, paso manual P3).
//
//  ── Lo que este bloque NO muestra, nunca ──
//
//  **El token.** Ni entero, ni truncado, ni «los últimos cuatro» ([PENDIENTE
//  N7], FR-075, US1 escenario 7). Mostrar los últimos cuatro de un secreto es
//  una costumbre de tarjetas de crédito —donde el número lo tiene el titular en
//  la mano— que acá no aporta nada y filtra. `GET /status` tampoco lo manda; el
//  test de este archivo verifica la otra mitad: que si algún día lo mandara,
//  esta pantalla no lo dibuje.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/** Clases del botón secundario del sistema (34px, borde, hover en surface-3). */
const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface ' +
  'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/** Los dos estados en los que hay una tienda del otro lado. */
const CON_TIENDA = ['vinculada', 'vinculada_con_error']

/**
 * Una fecha que puede no existir todavía.
 *
 * Devuelve el texto de «nunca» en vez de una cadena vacía: un hueco donde tenía
 * que ir una fecha se lee como un error de carga y no como «esto no pasó».
 */
function fechaOTexto(iso, siNunca) {
  return iso ? fechaCortaDeMomento(iso) : siNunca
}

/**
 * Una fila de dato: la etiqueta arriba en `.eyebrow` y el valor abajo.
 *
 * `tono` es el color del valor —los tokens del sistema, nunca un hex— y `clase`
 * es para `.num`, la variante de cifras tabulares. Van separados porque un
 * contador puede necesitar las dos cosas a la vez y concatenarlas en un solo
 * prop hace que quien lo lee no sepa cuál es cuál.
 */
function Dato({ etiqueta, valor, nota, tono, clase }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{etiqueta}</p>
      <p
        className={`mt-1 truncate text-[13.5px] font-medium ${clase || ''} ${tono || ''}`}
        title={String(valor)}
      >
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-[12px] leading-snug text-fg-3">{nota}</p>}
    </div>
  )
}

export default function EstadoDeTiendanube({
  status,
  cargando = false,
  sucursales = [],
  ocupado = false,
  onConectar,
  onDesvincular,
  onCambiarSucursal,
  onReintentar,
}) {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [cambiandoSucursal, setCambiandoSucursal] = useState(false)

  const puedeEditar = can('config.editar')
  const estado = estadoDeLaConexion(status)
  const tienda = status?.tienda || null
  const mapeados = Number(status?.variantes?.mapeadas) || 0

  // Mientras la primera respuesta no llegó, el estado NO es «no se pudo
  // comprobar»: todavía no se intentó. Decir que falló algo que está en curso es
  // la misma familia de mentira que decir «no vinculada» ante un error de red.
  if (cargando && !status) {
    return (
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-fg-3" />
          <p className="text-[13.5px] text-fg-2">Comprobando el estado de la conexión…</p>
        </div>
      </section>
    )
  }

  const desvincular = async () => {
    const ok = await confirm(
      `Se borran el acceso a tu tienda y la copia local del catálogo. ` +
      `Los ${mapeados} mapeos NO se borran: si volvés a vincular la misma tienda, ` +
      `siguen ahí. Si vinculás otra, van a quedar apuntando a variantes que no existen.`,
      // Rojo: borra el acceso a la tienda y la copia local del catálogo.
      { verbo: 'Desvincular tienda', destructivo: true }
    )
    if (!ok) return

    await onDesvincular?.()
  }

  /**
   * El cambio de sucursal, con la cuenta ANTES de confirmar.
   *
   * ⚠ Lo que se dice acá es lo que hace el `PUT`: cambiar la sucursal designada
   * **encola todas las variantes mapeadas** para volver a empujarlas, porque el
   * número que la tienda publica sale de esa sucursal y cambia entero. Sin ese
   * aviso, alguien cambia la sucursal para probar y dispara N llamadas a una API
   * con límite sin saberlo (riesgo 8 del plan).
   */
  const cambiarSucursal = async (evento) => {
    const nuevoId = Number(evento.target.value)
    const destino = sucursales.find((s) => s.id === nuevoId)
    if (!destino || destino.id === tienda?.punto_de_venta?.id) return

    const desde = tienda?.punto_de_venta?.name || 'la sucursal actual'

    const ok = await confirm(
      `El stock que publica tu tienda va a pasar a salir de «${destino.name}» en vez de «${desde}». ` +
      `Se vuelven a empujar ${mapeados} variantes mapeadas, una por una.`,
      // No es rojo: cambiar de sucursal se deshace volviendo a cambiarla.
      { verbo: 'Cambiar sucursal' }
    )
    if (!ok) return

    setCambiandoSucursal(true)
    try {
      await onCambiarSucursal?.(destino.id)
    } finally {
      setCambiandoSucursal(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Conexión con TiendaNube</h2>

        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeConexion(estado)}`}
        >
          {ETIQUETAS_DE_CONEXION[estado]}
        </span>

        <div className="flex-1" />

        {estado === 'no_comprobada' && (
          <button type="button" className={BOTON_SECUNDARIO} onClick={onReintentar} disabled={ocupado}>
            <RefreshCw className="h-3.5 w-3.5 text-fg-3" />
            Reintentar
          </button>
        )}

        {estado === 'no_vinculada' && (
          <>
            <button
              type="button"
              className={BOTON_SECUNDARIO}
              onClick={onConectar}
              disabled={!puedeEditar || ocupado}
              // El botón se DESHABILITA, no desaparece (US1 escenario 11): un
              // botón ausente parece que la función no existe y manda a buscarla
              // a otro lado; uno deshabilitado con su explicación manda a pedir
              // el permiso, que es lo que hay que hacer.
              title={puedeEditar ? 'Conectar con TiendaNube' : undefined}
            >
              <Link2 className="h-3.5 w-3.5 text-fg-3" />
              Conectar con TiendaNube
            </button>
            {!puedeEditar && (
              <p className="w-full text-[12.5px] text-fg-3">
                No podés conectar la tienda: {faltaElPermiso('config.editar').toLowerCase()}.
              </p>
            )}
          </>
        )}

        {CON_TIENDA.includes(estado) && (
          <>
            <button
              type="button"
              className={BOTON_SECUNDARIO}
              onClick={desvincular}
              disabled={!puedeEditar || ocupado}
            >
              <Unlink className="h-3.5 w-3.5 text-fg-3" />
              Desvincular
            </button>
            {!puedeEditar && (
              <p className="w-full text-[12.5px] text-fg-3">
                No podés desvincular la tienda: {faltaElPermiso('config.editar').toLowerCase()}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-5 py-4">
        {estado === 'sin_configurar' && (
          <div className="py-6 text-center">
            <p className="font-semibold">La integración no está configurada en el servidor.</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">
              Falta la credencial de la aplicación de TiendaNube. No es algo que se
              resuelva desde acá: lo configura quien administra el servidor.
            </p>
          </div>
        )}

        {estado === 'no_vinculada' && (
          <div className="py-6 text-center">
            <p className="font-semibold">Todavía no conectaste tu tienda.</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">
              Al conectarla vas a poder mapear tus productos contra las variantes de
              la tienda y empujarles el stock.
            </p>
          </div>
        )}

        {estado === 'no_comprobada' && (
          <div className="py-6 text-center">
            <p className="font-semibold">No pudimos comprobar el estado de la conexión.</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">
              Esto <strong>no</strong> quiere decir que tu tienda esté desvinculada:
              quiere decir que no lo sabemos. Probá de nuevo en un momento.
            </p>
          </div>
        )}

        {CON_TIENDA.includes(estado) && tienda && (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dato
              etiqueta="Tienda"
              // Recién vinculada la tienda NO tiene nombre: el canje del OAuth
              // devuelve el `user_id` y nada más, y el nombre lo trae el primer
              // refresco del catálogo. Dibujar «—» ahí haría parecer que la
              // vinculación quedó a medias.
              valor={tienda.nombre || 'Todavía sin nombre'}
              nota={
                tienda.nombre
                  ? `Identificador de tienda ${tienda.tiendanube_user_id}`
                  : `Identificador de tienda ${tienda.tiendanube_user_id} · el nombre llega con el primer refresco del catálogo`
              }
            />

            <Dato
              etiqueta="Vinculada el"
              valor={fechaOTexto(tienda.vinculada_en, 'Sin fecha')}
            />

            <Dato
              etiqueta="Última comunicación"
              valor={fechaOTexto(tienda.ultima_comunicacion_en, 'Todavía ninguna')}
              tono={estado === 'vinculada_con_error' ? 'text-danger' : undefined}
              nota={estado === 'vinculada_con_error' ? tienda.ultimo_error || 'La última llamada a TiendaNube falló.' : undefined}
            />

            <div className="min-w-0">
              <p className="eyebrow">Sucursal de la tienda online</p>
              <div className="mt-1 flex items-center gap-2">
                <select
                  aria-label="Sucursal de la tienda online"
                  className="h-[34px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2
                             text-[13px] transition-colors focus-visible:border-brand focus-visible:outline-none
                             disabled:cursor-not-allowed disabled:opacity-55"
                  value={tienda.punto_de_venta?.id ?? ''}
                  onChange={cambiarSucursal}
                  disabled={!puedeEditar || ocupado || cambiandoSucursal}
                >
                  {!tienda.punto_de_venta && <option value="">Sin designar</option>}
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {cambiandoSucursal && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-fg-3">
                De acá sale el stock que se publica y acá se descuenta cada pedido.
              </p>
            </div>

            <Dato
              etiqueta="Catálogo actualizado el"
              valor={fechaOTexto(tienda.catalogo_refrescado_en, 'Nunca se refrescó')}
              nota="La lista de abajo es una copia local de esa fecha, no lo que tu tienda muestra ahora."
            />

            {/* ⚠ La reconciliación es la red que atrapa un empujón perdido, y
                hoy depende de un cron externo que falla todos los días. Si nunca
                corrió, se dice con su tono: un hueco donde va una fecha se lee
                como «no importa». */}
            <Dato
              etiqueta="Última reconciliación"
              valor={fechaOTexto(tienda.reconciliada_en, 'Nunca corrió')}
              tono={tienda.reconciliada_en ? undefined : 'text-warn'}
              nota={
                tienda.reconciliada_en
                  ? 'Compara tu stock con el de la tienda y corrige lo que quedó desfasado.'
                  : 'Es la revisión diaria que corrige lo que quedó desfasado. Mientras no corra, un envío que falle queda así y nada lo reintenta.'
              }
            />
          </div>
        )}
      </div>

      <ConfirmDialog />
    </section>
  )
}

// ════════════════════════════════════════════
//  El resultado de la última corrida de sincronización
//
//  El pedido de la sección 4.10 nombra «el resultado de la última corrida»
//  explícitamente, y hasta este hito **no existía en ningún lado**: ni tabla, ni
//  setting, ni un log del que se pudiera leer. Quien apretaba «sincronizar» no
//  sabía cuántas variantes habían entrado, cuáles faltaban, ni si el botón había
//  hecho algo — y ante el primer fallo el conteo se perdía entero.
//
//  ── Por qué este bloque SÍ pide sus datos y el de arriba no ──
//
//  `EstadoDeTiendanube` recibe todo por props porque su dato —`GET /status`— lo
//  usan además el encabezado de la pantalla, la tabla y el panel: un segundo
//  dueño de ese estado dibujaría una cosa y mandaría otra. La corrida no la usa
//  nadie más, así que traerla hasta la página para bajarla de vuelta solo sumaría
//  un intermediario. El molde es `components/HistorialDeCostos.jsx`.
//
//  ⚠ Que pida datos al montar tiene una consecuencia en su test: el render va
//  envuelto en `await act(async () => …)` (`CONVENCIONES.md`, punto 5). Sin eso
//  React llena la salida de «An update … was not wrapped in act(...)», y una
//  suite que imprime ruido en verde es una que nadie lee cuando se pone en rojo.
//
//  ── Las tres cosas que este bloque distingue, y que dibujadas igual mienten ──
//
//   1. **`corrida: null` NO es «una corrida que mandó cero».** La primera dice
//      «nunca lo intentamos» y la segunda «lo intentamos y no había nada que
//      mandar». Con el mismo texto, una tienda recién vinculada y una tienda sin
//      ningún mapeo se ven iguales, y son dos problemas con dos arreglos
//      distintos. Lo resuelve `resumenDeCorrida`, que devuelve títulos distintos.
//   2. **Una corrida sin `terminada_en` quedó a medias** —el proceso se cayó, la
//      red se cortó— y eso no es «terminó sin errores». Lo que hay que decir no
//      es cuántas entraron, que quedó a medio escribir, sino que volver a
//      apretar el botón es seguro: el PUT manda el número absoluto de cada
//      variante, no una diferencia (FR-045).
//   3. **Las que fallaron se NOMBRAN.** «3 con error» sin decir cuáles obliga a
//      abrir TiendaNube y comparar el catálogo a mano, que es exactamente lo que
//      esta pantalla vino a evitar (criterio 11).
//
//  ── Y `cola` no es un adorno ──
//
//  El empujón por movimiento de stock **no escribe corridas** —serían cientos de
//  filas diarias que nadie lee y que crecen sin tope—, así que su estado vive en
//  la fila de cada variante. `cola` lo resume, y contesta algo que un registro de
//  lotes no puede: **qué está desfasado ahora**.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {number} [props.refresco] Cambia cuando la pantalla hizo algo que
 *   afecta a la corrida o a la cola —sincronizar, cambiar de sucursal—. No es un
 *   dato: es la señal de «volvé a pedirlo». Sin esto, apretar «Sincronizar»
 *   dejaría el bloque mostrando el resultado de la corrida ANTERIOR, que es la
 *   forma más directa de hacer creer que el botón no hizo nada.
 */
export function UltimaCorrida({ refresco = 0 }) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const pedir = useCallback(async () => {
    setCargando(true)
    try {
      const res = await getTiendanubeUltimaCorrida()
      setDatos(res.data || null)
      setError(null)
    } catch (err) {
      // ⚠ El error NO se dibuja como «todavía no se sincronizó ninguna vez». Es
      // el mismo defecto que tenía la tarjeta de Ajustes con la conexión: una
      // caída de red y un hecho del negocio se ven idénticos, y el que sale en
      // pantalla es la mentira.
      setDatos(null)
      setError(mensajeDeError(err, 'No se pudo leer el resultado de la última sincronización.'))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { pedir() }, [pedir, refresco])

  const resumen = resumenDeCorrida(datos?.corrida, datos?.cola)
  const fallas = datos?.corrida?.fallas || []

  return (
    <section
      data-bloque="ultima-corrida"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Última sincronización de stock</h2>

        {!error && (
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${resumen.tono}`}>
            {resumen.titulo}
          </span>
        )}

        <div className="flex-1" />

        {cargando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
      </div>

      {error ? (
        <div className="px-5 py-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3">
            <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-[13px] text-danger">{error}</p>
              <button
                type="button"
                className="mt-2 text-[12.5px] font-medium text-fg-2 underline hover:text-foreground"
                onClick={pedir}
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-fg-2">{resumen.detalle}</p>

          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Dato etiqueta="Cuándo" valor={resumen.cuando} />
            {/* `duracion` es `null` cuando la corrida quedó a medias: no hay
                `terminada_en` con el que restar, y escribir un número inventado
                ahí sería peor que el guion. */}
            <Dato etiqueta="Cuánto tardó" valor={resumen.duracion || '—'} />
            <Dato etiqueta="Quién la disparó" valor={resumen.disparador} />
            <Dato
              etiqueta="Variantes actualizadas"
              valor={resumen.mandadas}
              clase="num"
              nota={`${resumen.fallidas} con error`}
            />
          </div>

          {fallas.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow">Las que no se pudieron actualizar</p>

              {/* Se NOMBRAN una por una: «3 con error» sin decir cuáles obliga a
                  abrir TiendaNube y comparar el catálogo a mano. Y el SKU va
                  primero porque es lo que la persona tiene en la mano; el id de
                  la variante es lo que sirve para buscarla en el panel de
                  TiendaNube. */}
              <ul className="mt-1.5 divide-y divide-border overflow-hidden rounded-lg border border-border">
                {fallas.map((falla, i) => (
                  <li
                    key={`${falla.variante ?? 'sin-variante'}-${i}`}
                    className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-3 py-2"
                  >
                    <span className="num text-[13px] font-medium">
                      {falla.sku || 'Sin SKU'}
                    </span>
                    <span className="num text-[12px] text-fg-3">
                      variante {falla.variante ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px] text-fg-2">{falla.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resumen.cola && (
            <div className="mt-4 rounded-lg border border-border bg-surface-2 px-4 py-3">
              <p className="eyebrow">Esperando ahora</p>
              <p className="mt-1 text-[13px]">{resumen.cola}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-fg-3">
                Cada movimiento de stock empuja el número nuevo a tu tienda sin esperar a
                ninguna corrida. Esto es lo que todavía no salió.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
