import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Pencil, Plus, Store, Trash2, Wallet } from 'lucide-react'
import useStore from '@/store/useStore'
import { deleteExpense, getExpenses, setSetting } from '@/services/api'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import PageHeader from '@/components/PageHeader'
import { Can } from '@/components/Can'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import GastosVariables from '@/components/GastosVariables'
import PanelDeGasto from '@/components/PanelDeGasto'
import { agruparGastosPorSucursal, CLAVE_GENERAL } from '@/utils/gastos'
import { pesos } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'

// ════════════════════════════════════════════
//  ADMINAPP · Gastos
//
//  ── El defecto que esta pasada cierra ──
//
//  **Un gasto fijo sin sucursal podía no dibujarse en ninguna parte, y seguía
//  moviendo el punto de equilibrio.** El agrupado viejo vivía acá adentro y
//  repartía por `'gf' + puntosDeVenta.indexOf(pv)`: con UNA sola sucursal —el
//  caso de Comprafit— `'gf0'` no coincidía con nada y `'gf1'` quedaba excluido
//  de «General» por el `!e.group?.startsWith('gf')`. El gasto existía, lo sumaba
//  `dashboardService.js` para el BEP, y la pantalla no lo mostraba. Plata que
//  decide precios y que nadie ve.
//
//  El reparto se fue a `utils/gastos.js`, mira **solo `punto_de_venta_id`** y
//  tiene sus dos invariantes probados como propiedad. Acá quedó el dibujo.
//
//  ── Qué más se fue de este archivo ──
//
//   · **La suma de los totales.** `group.expenses.reduce((s, e) => s +
//     parseFloat(e.amount), 0)` acumulaba en punto flotante un DECIMAL que
//     vuelve como string. Los totales los calcula el servidor en centavos
//     enteros y viajan al lado de las filas (FR-026 a FR-028).
//   · **El filtro por NOMBRE del grupo** (`g.name !== 'General'`), que dejaba
//     «General» sin tarjeta —así que la suma de las tarjetas no era el total— y
//     que además hacía desaparecer a cualquier sucursal que se llamara
//     «General» (FR-023).
//   · **Los `Table*` de shadcn y el `Dialog`.** Tabla en grid con el mismo
//     string de columnas en el encabezado y en las filas (FR-007), y panel
//     lateral de 520px para el alta y la edición (FR-039).
//   · **`toLocaleString()` sin locale**, en dos lugares. En un navegador en
//     inglés `1234.5` salía «1,234.5»: es el error que convierte $1.234 en
//     $1,234 sin que falle nada. Ahora sale de `pesos` (FR-010, FR-011).
//   · **`toast.error('Error: ' + err.message)`**, que en axios es «Request
//     failed with status code 400» y no dice qué corregir (FR-008).
//   · **El `console.error` del fallo de carga**, que dejaba la pantalla con una
//     lista vacía indistinguible de una empresa sin gastos (FR-009).
//   · **Los botones que la API rechaza.** El rol `gerente` tiene `gastos.crear`
//     y `gastos.editar` pero NO `gastos.eliminar`, y veía el tacho igual. Ahora
//     va deshabilitado con su explicación, no ausente (FR-017, FR-036).
//
//  ── Lo que se agregó ──
//
//   · **La edición de un gasto fijo**, que no existía: `updateExpense` estaba
//     declarado en `services/api.js` desde siempre y ningún componente lo
//     importaba. Corregir un alquiler obligaba a borrarlo y volver a cargarlo.
//   · **«Facturación mensual promedio»**, que el legacy tenía al lado de los
//     gastos fijos (`legacy:3030`) y que escribe `settings.target_sales`: es la
//     mitad que le falta al simulador de precios para no arrancar con un número
//     inventado (decisión 13, FR-051).
//
//  Reglas: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Las cuatro columnas, idénticas en el encabezado y en las filas (FR-007).
 *
 * Es el MISMO string y no dos copias: cuando difieren, las etiquetas dejan de
 * estar sobre sus datos y se lee un importe bajo «Sucursal». La separación de
 * 16px la pone `TablaGrid` con su `gap-x-4`.
 */
const COLUMNAS = 'minmax(0,1fr) 220px 150px 84px'

/**
 * Por debajo de esto la tabla scrollea DENTRO de su tarjeta.
 *
 * 454px de columnas fijas + 48px de separaciones + 40px de padding, y el resto
 * es lo mínimo que se le deja a la descripción. El `min-width` de la página no
 * se toca: haría scrollear el `<body>` entero.
 */
const ANCHO_MINIMO = 760

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark'

const SOLAPAS = [
  ['fijos', 'Fijos'],
  ['variables', 'Variables'],
]

const DESCRIPCION = {
  fijos: 'Costos que se repiten todos los meses, agrupados por sucursal. Son los que el punto de equilibrio necesita para decir cuánto hay que vender.',
  variables: 'Gastos que cambian mes a mes y tienen un responsable. NO entran en el punto de equilibrio.',
}

/**
 * El total que le corresponde a un grupo, tal como lo sumó el servidor.
 *
 * ⚠ **La pantalla no suma nada.** `amount` es `DECIMAL(12,2)` y vuelve como
 * string: acumular `parseFloat` deja residuo —0,1 + 0,2 da 0,30000000000000004—
 * en el número del que cuelga el precio recomendado. Y el total general sale de
 * la misma lectura que las filas, así que las tarjetas y la tabla no pueden
 * mostrar dos verdades.
 *
 * El `?? 0` es para la sucursal que todavía no tiene ningún gasto: el servidor
 * no manda su clave y la tarjeta tiene que existir igual, en cero.
 */
function totalDelGrupo(grupo, totales) {
  if (grupo.clave === CLAVE_GENERAL) return totales?.sin_sucursal ?? 0

  return totales?.por_sucursal?.[String(grupo.id)] ?? 0
}

/**
 * La tarjeta de total de un grupo.
 *
 * El `aria-label` no es decorativo: es lo que permite afirmar que **la suma de
 * las tarjetas es el total de abajo** sin buscarlas por su clase de color, que
 * es como un test encuentra lo que fue a buscar y no puede distinguir una
 * tarjeta de otra.
 */
function TarjetaDeTotal({ grupo, total }) {
  return (
    <article
      aria-label={`Total del grupo ${grupo.nombre}`}
      className="rounded-xl border border-border bg-surface px-4 py-3.5 shadow-nivel-1"
    >
      <p className="eyebrow flex items-center gap-1.5">
        <Store className="h-3 w-3 shrink-0 text-fg-3" />
        <span className="truncate">{grupo.nombre}</span>
      </p>

      <p className="num mt-1.5 text-[22px] font-semibold">${pesos(total)}</p>

      {grupo.gastos.length === 0 ? (
        // Un estado vacío propio: «esta sucursal no tiene gastos propios» no es
        // lo mismo que «no hay ningún gasto cargado», que es lo que dice la
        // tabla de abajo cuando está vacía (FR-019).
        <p className="mt-1 text-[12px] text-fg-3">Sin gastos propios todavía</p>
      ) : (
        <p className="mt-1 text-[12px] text-fg-3">
          {grupo.gastos.length === 1 ? '1 gasto' : `${grupo.gastos.length} gastos`}
        </p>
      )}

      {!grupo.conocida && (
        // La sucursal salió de un gasto y no de la lista de la empresa: puede
        // estar dada de baja. Se dice, en vez de esconder el gasto o de meterlo
        // en «General», que afirmaría que no tiene sucursal.
        <p className="mt-1 text-[12px] text-warn">Sucursal que ya no está en la lista</p>
      )}
    </article>
  )
}

export default function Expenses() {
  const empresaActiva = useStore((s) => s.empresaActiva)
  const settings = useStore((s) => s.settings)
  const puntosDeVenta = empresaActiva?.puntosDeVenta || []

  // Fijos y variables son cosas distintas: los fijos alimentan el punto de
  // equilibrio, los variables no. Se muestran en la misma pantalla porque es
  // donde el usuario los busca, pero nunca se suman entre sí.
  const [solapa, setSolapa] = useState('fijos')

  const [gastos, setGastos] = useState([])
  const [totales, setTotales] = useState(null)
  const [alcance, setAlcance] = useState('empresa')
  const [cargando, setCargando] = useState(true)
  const [errorDeCarga, setErrorDeCarga] = useState('')

  const [panelAbierto, setPanelAbierto] = useState(false)
  const [enEdicion, setEnEdicion] = useState(null)

  const { confirm, ConfirmDialog } = useConfirmDialog()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await getExpenses()

      setGastos(res.data?.data || [])
      setTotales(res.data?.totales || null)
      setAlcance(res.data?.alcance || 'empresa')
      setErrorDeCarga('')
    } catch (err) {
      // ⚠ Antes esto era un `console.error(err)` y nada más: un 403 por falta de
      // `gastos.ver` dibujaba una lista vacía, que es indistinguible de una
      // empresa que todavía no cargó ningún gasto. Las dos cosas se dicen, y
      // distinto (FR-009).
      setErrorDeCarga(
        err?.response?.status === 403
          ? 'No podés ver los gastos de esta empresa: te falta el permiso «gastos.ver».'
          : mensajeDeError(err, 'No se pudieron cargar los gastos fijos.')
      )
      setGastos([])
      setTotales(null)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const eliminar = async (gasto) => {
    const ok = await confirm(`¿Eliminar «${gasto.name}»? Deja de contar para el punto de equilibrio.`)
    if (!ok) return

    try {
      await deleteExpense(gasto.id)
      toast.success('Gasto eliminado')
      cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo eliminar el gasto.'))
    }
  }

  const abrirAlta = () => {
    setEnEdicion(null)
    setPanelAbierto(true)
  }

  const abrirEdicion = (gasto) => {
    setEnEdicion(gasto)
    setPanelAbierto(true)
  }

  const grupos = agruparGastosPorSucursal(gastos, puntosDeVenta)

  // Las filas salen del MISMO reparto que las tarjetas, aplanado. Es lo que
  // garantiza que la tabla y las tarjetas no puedan discrepar: cada gasto está
  // en exactamente un grupo, y la tabla los recorre todos.
  const filas = grupos.flatMap((grupo) => grupo.gastos.map((gasto) => ({ gasto, grupo })))

  return (
    <div className="anim-subida flex flex-col gap-6">
      <PageHeader titulo="Gastos" descripcion={DESCRIPCION[solapa]} icono={Wallet}>
        {solapa === 'fijos' && (
          <Can
            codigo="gastos.crear"
            fallback={
              <p className="text-[12.5px] text-fg-3">
                No podés cargar gastos: te falta el permiso «gastos.crear».
              </p>
            }
          >
            <button type="button" className={BOTON_PRINCIPAL} onClick={abrirAlta}>
              <Plus className="h-4 w-4" />
              Nuevo gasto
            </button>
          </Can>
        )}
      </PageHeader>

      {/* Las dos solapas como segmentos, con la forma de la maqueta
          (`AdminApp-Rediseno.dc.html:645-648`): contenedor de 3px sobre
          `surface-3`, radio 9px, botones de 28px con radio 7px (FR-038). Antes
          era un `border-b-2` a mano, que es el único control de este tipo que
          quedaba fuera del sistema. */}
      <div className="flex w-fit gap-[3px] rounded-[9px] bg-surface-3 p-[3px]">
        {SOLAPAS.map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setSolapa(valor)}
            aria-pressed={solapa === valor}
            className={`inline-flex h-7 items-center rounded-[7px] px-[13px] text-[12.5px] transition-colors ${
              solapa === valor
                ? 'bg-surface font-semibold text-foreground shadow-nivel-1'
                : 'font-medium text-fg-2 hover:text-foreground'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {solapa === 'variables' && <GastosVariables />}

      {solapa === 'fijos' && (
        <>
          {errorDeCarga && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-5 py-4"
            >
              <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
              <div>
                <p className="text-[13.5px] font-medium">{errorDeCarga}</p>
                <p className="mt-1 text-[13px] text-fg-2">
                  Los totales de abajo no incluyen nada hasta que la lista se pueda leer.
                </p>
              </div>
            </div>
          )}

          {/* ── Las tarjetas de total, una por grupo e incluida «General» ── */}
          <div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {grupos.map((grupo) => (
                <TarjetaDeTotal
                  key={grupo.clave}
                  grupo={grupo}
                  total={totalDelGrupo(grupo, totales)}
                />
              ))}
            </div>

            {/* FR-037: qué alcance tiene lo que se está mirando, escrito. `GET
                /api/expenses` NO cae a la sucursal activa —a diferencia de
                `/faltantes`—, y sin decirlo alguien con una sucursal
                seleccionada leería estos totales como los de esa sucursal. */}
            <p className="mt-2.5 text-[12.5px] text-fg-3">
              {alcance === 'empresa'
                ? 'Todos los gastos fijos de la empresa, sin filtrar por la sucursal activa.'
                : 'Solo los gastos de la sucursal activa.'}
            </p>
          </div>

          <FacturacionDeReferencia settings={settings} />

          {/* ── La tabla ── */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
              <h2>Gastos fijos</h2>

              <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
                {gastos.length}
              </span>

              <div className="flex-1" />

              <p className="text-[12.5px] text-fg-2">
                Total por mes{' '}
                <strong
                  aria-label="Total de gastos fijos por mes"
                  className="num text-[13.5px] text-foreground"
                >
                  ${pesos(totales?.general ?? 0)}
                </strong>
              </p>
            </div>

            {/* ⚠ El estado vacío NO se dibuja cuando la carga falló, y es lo
                que este corte vino a arreglar: «todavía no cargaste ningún
                gasto» sobre un 403 es afirmar que la empresa no tiene gastos
                cuando lo que pasó es que no se pudieron leer. Con el
                `console.error` de antes era peor todavía —el aviso no existía y
                quedaba solo esa frase—, pero repetirla debajo del aviso sería
                decir dos cosas que no pueden ser las dos ciertas. */}
            {filas.length === 0 && !cargando && !errorDeCarga ? (
              <div className="py-12 text-center">
                <Wallet className="mx-auto h-7 w-7 text-fg-3" />
                <p className="mt-3 font-semibold">Todavía no cargaste ningún gasto fijo.</p>
                <p className="mt-1 text-sm text-fg-2">
                  El alquiler, los sueldos y los servicios van acá: sin ellos el punto de equilibrio
                  no puede decir cuánto hay que vender para no perder plata.
                </p>
              </div>
            ) : filas.length === 0 && errorDeCarga ? (
              // Nada: el aviso de arriba ya dice qué pasó y qué falta.
              null
            ) : (
              <TablaGrid anchoMinimo={ANCHO_MINIMO}>
                <Encabezado columnas={COLUMNAS}>
                  <span>Descripción</span>
                  <span>Sucursal</span>
                  <span className="text-right">Importe mensual</span>
                  <span className="text-right">Acciones</span>
                </Encabezado>

                {filas.map(({ gasto, grupo }) => (
                  <Fila
                    key={gasto.id}
                    columnas={COLUMNAS}
                    onClick={() => abrirEdicion(gasto)}
                  >
                    {/* El `min-w-0` y el `truncate` son lo que impide que una
                        descripción larga se meta en la columna de importe. Es
                        geometría y jsdom no la puede contestar: lo verifica
                        `pruebas-de-navegador/maquetadoDeGastos.navegador.js`. */}
                    <span className="min-w-0 truncate text-[13.5px] font-medium">{gasto.name}</span>

                    <span className="truncate text-[13px] text-fg-2">{grupo.nombre}</span>

                    <span className="num text-right text-[13.5px] font-semibold">
                      ${pesos(gasto.amount)}
                    </span>

                    <span className="flex justify-end gap-1">
                      <Can
                        codigo="gastos.editar"
                        fallback={
                          <BotonDeFila
                            disabled
                            title="No podés editar gastos: te falta el permiso «gastos.editar»."
                          >
                            <Pencil />
                          </BotonDeFila>
                        }
                      >
                        <BotonDeFila title="Editar" onClick={() => abrirEdicion(gasto)}>
                          <Pencil />
                        </BotonDeFila>
                      </Can>

                      {/* ⚠ El rol `gerente` NO tiene `gastos.eliminar`
                          (`seedPermissions.js:85`) y hasta hoy veía el tacho
                          igual: lo apretaba y la API respondía 403. Va
                          deshabilitado y con el motivo escrito, no ausente
                          (FR-017). */}
                      <Can
                        codigo="gastos.eliminar"
                        fallback={
                          <BotonDeFila
                            disabled
                            title="No podés eliminar gastos: te falta el permiso «gastos.eliminar»."
                          >
                            <Trash2 />
                          </BotonDeFila>
                        }
                      >
                        <BotonDeFila
                          title="Eliminar"
                          className="hover:bg-danger-soft hover:text-danger"
                          onClick={() => eliminar(gasto)}
                        >
                          <Trash2 />
                        </BotonDeFila>
                      </Can>
                    </span>
                  </Fila>
                ))}
              </TablaGrid>
            )}
          </section>
        </>
      )}

      <PanelDeGasto
        abierto={panelAbierto}
        onOpenChange={setPanelAbierto}
        gasto={enEdicion}
        sucursales={puntosDeVenta}
        onGuardado={cargar}
      />

      <ConfirmDialog />
    </div>
  )
}

/**
 * La facturación mensual promedio, que alimenta el simulador de precios.
 *
 * El legacy la tenía **acá**, al lado de los gastos fijos (`legacy:3030`), y por
 * un motivo que no es de diseño: el margen mínimo se mira contra los gastos que
 * está mirando el usuario, no en otra pantalla. Escribe `settings.target_sales`.
 *
 * ⚠ **No es `settings.fixed_expenses_total`**, que era un total de gastos fijos
 * escrito a mano y que el simulador usaba mientras la tarjeta de arriba mostraba
 * la suma real: dos respuestas a la misma pregunta a cuarenta píxeles, y la de
 * abajo decidía el precio. Esa clave deja de leerse (decisión 13).
 */
function FacturacionDeReferencia({ settings }) {
  const guardada = settings?.target_sales ?? ''

  const [valor, setValor] = useState(String(guardada ?? ''))
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { setValor(String(guardada ?? '')) }, [guardada])

  const guardar = async (evento) => {
    evento.preventDefault()

    const numero = Number(valor)
    if (!Number.isFinite(numero) || numero < 0) {
      toast.error('La facturación tiene que ser un número positivo.')
      return
    }

    setGuardando(true)
    try {
      await setSetting('target_sales', numero)

      // El store se actualiza acá y no con un `initialize()` entero: es una
      // clave y `initialize()` son tres pedidos, uno de ellos el catálogo
      // completo de productos.
      useStore.setState((estado) => ({ settings: { ...estado.settings, target_sales: numero } }))
      toast.success('Facturación de referencia guardada')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo guardar la facturación de referencia.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form
      onSubmit={guardar}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1"
    >
      <label className="flex min-w-[220px] flex-col gap-1.5">
        <span className="eyebrow">Facturación mensual promedio</span>
        <input
          className="num h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors
                     focus-visible:border-brand focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-2"
          type="number"
          step="0.01"
          aria-label="Facturación mensual promedio"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </label>

      <Can
        codigo="config.editar"
        fallback={
          <p className="text-[12.5px] text-fg-3">
            No podés cambiarla: te falta el permiso «config.editar».
          </p>
        }
      >
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-[13px]
                     font-medium transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-60"
        >
          Guardar
        </button>
      </Can>

      <p className="min-w-[240px] flex-1 text-[12.5px] text-fg-3">
        Es contra este número que el simulador de precios calcula cuánto margen hace falta para
        cubrir los gastos fijos. Sin cargarlo, el simulador no inventa nada: dice qué falta.
      </p>
    </form>
  )
}
