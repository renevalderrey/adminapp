import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Calculator,
  LayoutDashboard,
  Loader2,
  ClipboardList,
  PackageSearch,
  Receipt,
  ShoppingCart,
  Truck,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import RequiereTuAtencion from '@/components/RequiereTuAtencion'
import TarjetaDeIndicador from '@/components/TarjetaDeIndicador'
import { useIsMounted } from '@/lib/useAsyncEffect'
import { getDashboardKpis } from '@/services/api'
import useStore from '@/store/useStore'
import { calcularBep, estrategiasDePrecio } from '@/utils/bep'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { importeAbreviado, importeOGuion, pesos } from '@/utils/formato'
import { etiquetaDePago } from '@/utils/mediosDePago'
import { nombreDeRuta } from '@/components/navegacion'
import { faltaElPermiso } from '@/utils/permisos'
import EstadoVacio from '@/components/EstadoVacio'

// ════════════════════════════════════════════
//  ADMINAPP · Panel de control
//
//  ── Las tres cosas que esta pantalla dejó de hacer ──
//
//  1. **Leer `kpis.cashflow?.balance || 0`.** Estaba en SEIS lugares, y convertía
//     «no tenés permiso» en «cero pesos», que es una respuesta falsa a una
//     pregunta sobre plata. Desde el corte 2 el servidor **omite la clave** del
//     bloque que el usuario no puede ver —no la manda en `null`, porque `null` y
//     `0` se confunden en cuanto alguien escribe `|| 0`—, así que acá se
//     pregunta `'cashflow' in kpis` y la tarjeta que no vino **no se dibuja**
//     (FR-050). Que faltan tarjetas se dice UNA vez, abajo de la grilla, con los
//     nombres: un panel con una sola tarjeta y sin explicación se lee como que
//     el sistema se rompió.
//
//  2. **Pedir `GET /api/alerts`.** Ese endpoint pedía `stock.ver` mientras
//     `/kpis` pide `dashboard.ver`: un rol con uno y sin el otro rechazaba el
//     `Promise.all` y dejaba el Panel entero en `-` y `0`, **sin un solo
//     cartel** (hallazgo P9). El endpoint se borró en este mismo corte y los
//     avisos salen de `kpis` (FR-058).
//
//  3. **Arrancar el simulador con 7.000.000 y 2.400.000.** Eran dos literales:
//     `settings.target_sales` no existía en ningún default, y
//     `fixed_expenses_total` tenía default `0`, que es falsy. Toda empresa que
//     no lo hubiera cargado veía **precios recomendados calculados sobre plata
//     inventada**, con la misma cara con la que mostraría los reales. Ahora los
//     gastos fijos salen de `kpis.fixed_expenses` —la misma suma que la franja
//     de arriba (FR-052)— y sin los dos datos el simulador **no simula**: dice
//     qué falta y adónde cargarlo (FR-051).
//
//     ⚠ **Y un cero tampoco es un dato.** Una empresa sin gastos fijos cargados
//     recibe `fixed_expenses: 0` —la clave viene, porque el permiso está—, y ese
//     cero hacía que el simulador cayera en «no hay precio que cierre», que es
//     la frase reservada para gastos ≥ facturación. Con los gastos en cero lo
//     que hay que decir es qué falta, no que el negocio no cierra.
//
//  ── Y una que empezó a hacer ──
//
//  **Cada tarjeta lleva su nota al pie con la definición del número.** Es la
//  parte durable de la decisión 7: cinco números se movieron el día del deploy
//  del corte 2, y la tabla de `OPERACION.md` la lee alguien una vez mientras la
//  nota al pie la lee todos los días el que mira el número.
//
//  ── Qué NO tiene, y por qué ──
//
//  El selector «Últimos 30 días» y el botón «Exportar» de la maqueta (`:226-234`)
//  no existen: son una funcionalidad propia y están anotados como pendiente. Y
//  el bloque de abajo se rotula **«Últimas ventas»** y no «Actividad reciente»
//  (decisión 19): no hay tabla de auditoría, y de los cuatro tipos de evento que
//  la maqueta dibuja solo las ventas tienen autor guardado. Prometer un registro
//  que no existe es lo mismo que dibujar un sparkline con `Math.sin`.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/** Cuántas columnas usa la grilla según cuántas tarjetas vinieron (FR-050). */
const COLUMNAS = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
}

/** Qué permiso le falta a quien no ve cada bloque, en castellano. */
const BLOQUES_DE_PLATA = [
  ['cashflow', 'el saldo de caja', 'caja'],
  ['receivables', 'las cuentas por cobrar', 'clientes'],
  ['payables', 'las cuentas por pagar', 'proveedores'],
  ['fixed_expenses', 'los gastos fijos', 'gastos'],
]

/** Los cuatro accesos rápidos de la maqueta (`:320-330`). */
const ACCESOS_RAPIDOS = [
  { ruta: '/pos', etiqueta: 'Nueva venta', icono: ShoppingCart },
  { ruta: '/faltantes', etiqueta: 'Qué hay que reponer', icono: PackageSearch },
  { ruta: '/ordenes-compra', etiqueta: 'Orden de compra', icono: Truck },
  { ruta: '/ventas', etiqueta: 'Historial de ventas', icono: Receipt },
]

/**
 * Un importe del negocio, listo para el campo. Vacío si no hay dato.
 *
 * El `> 0` no es cosmético y vale para los DOS campos:
 *
 *  · `target_sales` puede venir en cero, y un cero en la facturación no es un
 *    dato con el que se pueda simular —el margen sería una división por cero—.
 *  · `kpis.fixed_expenses` viene en cero cuando la empresa **no cargó ningún
 *    gasto fijo**: `FixedExpense.sum` de cero filas es cero. Ese cero llegaba al
 *    campo como «0» y el simulador lo tomaba por un dato, con lo cual el Panel
 *    de una empresa recién abierta decía «los gastos se llevan todo lo que
 *    entra» —la frase reservada para gastos ≥ facturación— en vez de decir qué
 *    falta y dónde se carga (FR-051).
 *
 * Vacío dice «falta cargarlo», que es lo que pasa.
 */
function textoDeImporte(valor) {
  const n = Number(valor)

  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

/** Un número que el usuario escribe: vacío es «no hay dato», no cero. */
function numeroDelCampo(texto) {
  const limpio = String(texto ?? '').trim()

  if (limpio === '') return null

  const n = Number(limpio)

  return Number.isFinite(n) ? n : null
}

/** Una sección con su encabezado, como las de la maqueta (`:258-282`). */
function Bloque({ titulo, accion, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>{titulo}</h2>
        <div className="flex-1" />
        {accion}
      </div>
      {children}
    </section>
  )
}

export default function Dashboard() {
  const isMounted = useIsMounted()
  const { settings, initialize } = useStore()

  const [kpis, setKpis] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)

  // ── Los dos campos del simulador ──
  //
  // `null` significa «el usuario no lo tocó», y entonces vale lo que el negocio
  // tiene cargado. Es estado DERIVADO y no una copia sincronizada con un
  // `useEffect`: una copia se desincroniza —el pedido llega después del primer
  // dibujo— y el defecto que produce es que el simulador calcule sobre el valor
  // viejo mientras la franja de arriba muestra el nuevo, que es exactamente el
  // problema de los dos «gastos fijos» que este corte cierra.
  const [metaEscrita, setMetaEscrita] = useState(null)
  const [gastosEscritos, setGastosEscritos] = useState(null)

  const pedir = useCallback(async () => {
    setCargando(true)
    try {
      const res = await getDashboardKpis()

      if (!isMounted()) return

      setKpis(res.data?.data || null)
      setError(null)
    } catch (err) {
      if (!isMounted()) return

      // Antes esto era un `console.error`: el Panel se dibujaba entero con
      // `kpis = null` —seis tarjetas en `-` y `0`— y nadie se enteraba de que
      // había fallado algo (FR-009, FR-055).
      setKpis(null)
      setError(mensajeDeError(err, 'No se pudieron cargar los indicadores del panel.'))
    } finally {
      if (isMounted()) setCargando(false)
    }
  }, [isMounted])

  useEffect(() => {
    initialize()
    pedir()
  }, [initialize, pedir])

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-fg-3" />
      </div>
    )
  }

  const tiene = (clave) => !!kpis && clave in kpis
  const serie = (clave) => kpis?.series?.[clave]

  const tarjetas = []

  if (kpis) {
    tarjetas.push({
      etiqueta: 'Ventas del mes',
      valor: importeAbreviado(kpis.sales_current_month?.total),
      serie: serie('ventas'),
      variacion: variacionDeVentas(kpis),
      notaDeVariacion: kpis.comparacion_parcial
        ? 'El mes en curso está incompleto: se compara contra un mes entero.'
        : undefined,
      nota: kpis.comparacion_parcial
        ? 'Ventas no anuladas del mes en curso, de toda la empresa. La variación compara un mes parcial contra uno completo.'
        : 'Ventas no anuladas del mes, de toda la empresa.',
    })
  }

  if (tiene('cashflow')) {
    tarjetas.push({
      etiqueta: 'Saldo de caja',
      valor: importeAbreviado(kpis.cashflow.balance),
      serie: serie('cashflow'),
      nota: 'Lo que entró menos lo que salió, de toda la empresa. Los gastos fijos se descuentan enteros: no tienen fecha.',
    })
  }

  if (tiene('receivables')) {
    tarjetas.push({
      etiqueta: 'Por cobrar',
      valor: importeAbreviado(kpis.receivables.total),
      serie: serie('receivables'),
      nota: 'Ventas a cuenta corriente menos lo cobrado. Las ventas de contado no cuentan, aunque tengan cliente.',
    })
  }

  if (tiene('payables')) {
    tarjetas.push({
      etiqueta: 'Por pagar',
      valor: importeAbreviado(kpis.payables.total),
      serie: serie('payables'),
      nota: 'Lo que se les debe a los proveedores: deuda menos pagos. Registrar un pago lo baja.',
    })
  }

  const ocultos = kpis
    ? BLOQUES_DE_PLATA.filter(([clave]) => !(clave in kpis)).map(([, texto]) => texto)
    : []

  // Los gastos fijos del simulador salen de la MISMA fuente que la franja de
  // arriba (FR-052). `settings.fixed_expenses_total` ya no se lee: eran dos
  // números con la misma etiqueta a cuarenta píxeles, y el de abajo decidía el
  // precio (decisión 13).
  const metaDeVentas = metaEscrita ?? textoDeImporte(settings?.target_sales)
  const gastosFijos = gastosEscritos
    ?? (tiene('fixed_expenses') ? textoDeImporte(kpis.fixed_expenses) : '')

  const meta = numeroDelCampo(metaDeVentas)
  const fijos = numeroDelCampo(gastosFijos)
  // Gastos fijos en cero es «falta el dato», no «no hay precio que cierre». El
  // `> 0` cubre además el cero escrito a mano, que el campo vacío no alcanza a
  // atajar.
  const puedeSimular = meta !== null && meta > 0 && fijos !== null && fijos > 0
  const bep = puedeSimular ? calcularBep(fijos, meta) : null
  const estrategias = puedeSimular ? estrategiasDePrecio(fijos, meta) : []

  return (
    <div className="anim-subida flex flex-col gap-7">
      <PageHeader
        titulo="Panel de control"
        descripcion="Cómo viene el negocio y qué necesita tu intervención. Los indicadores son de toda la empresa."
        icono={LayoutDashboard}
      />

      {/* ⚠ `role="alert"`. Sin él, con un lector de pantalla nadie se entera de
          que la carga falló: la persona sigue esperando datos que no van a
          llegar, y el único indicio es visual. Es el mismo aviso que ya lo
          llevan otras pantallas. */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3"
        >
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
      )}

      {tarjetas.length > 0 && (
        <div className={`grid gap-4 sm:grid-cols-2 ${COLUMNAS[tarjetas.length] || COLUMNAS[4]}`}>
          {tarjetas.map((t) => (
            <TarjetaDeIndicador key={t.etiqueta} {...t} />
          ))}
        </div>
      )}

      {/* Se dice UNA vez y con los nombres. Sin esto, un rol de producción abre
          el Panel, ve una sola tarjeta y no tiene forma de saber si le falta un
          permiso o si el sistema se rompió (FR-056). */}
      {ocultos.length > 0 && (
        <p data-bloques-ocultos="true" className="text-[12.5px] text-fg-2">
          No ves {ocultos.join(', ')} porque te faltan permisos. No es que estén en cero:
          es que no se te muestran.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <RequiereTuAtencion avisos={kpis?.requiere_atencion || []} />

          {/* «Últimas ventas», no «Actividad reciente». Ver el encabezado. */}
          {/* ⚠ El nombre de la pantalla sale de la barra lateral y NO se
              escribe acá. Decía «Historial completo», y el aviso de más arriba
              decía «Ver ventas» para esta misma ruta: tres nombres —con el del
              menú— para una sola pantalla. Quien lee cualquiera de los dos y va
              a buscarla al menú no la encuentra. */}
          <Bloque
            titulo="Últimas ventas"
            accion={
              <Link to="/ventas" className="text-[12.5px] font-medium text-fg-2 hover:text-brand">
                Ir a {nombreDeRuta('/ventas')}
              </Link>
            }
          >
            {kpis?.ultimas_ventas?.length ? (
              <ul className="flex flex-col px-5 py-2">
                {kpis.ultimas_ventas.map((venta) => (
                  <li key={venta.id} className="flex items-baseline gap-3.5 py-2.5">
                    <span className="num w-11 shrink-0 text-[11.5px] text-fg-3">{venta.hora}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-fg-2">
                      <strong className="font-medium text-foreground">
                        {venta.vendedor || 'Sin vendedor'}
                      </strong>{' '}
                      cobró la venta {venta.id}
                    </span>
                    <span className="num shrink-0 text-[12.5px] font-medium">
                      ${pesos(venta.total)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EstadoVacio
                icono={ClipboardList}
                codigo="sin_ventas"
                titulo="Todavía no hay ventas registradas."
                detalle="Acá van a aparecer las últimas, con la hora y quién las cobró."
              />
            )}
          </Bloque>

          {kpis?.sales_30d?.by_method && Object.keys(kpis.sales_30d.by_method).length > 0 && (
            <Bloque titulo="Cómo te pagaron (30 días)">
              <ul className="flex flex-col gap-2 px-5 py-4">
                {Object.entries(kpis.sales_30d.by_method).map(([medio, total]) => (
                  <li key={medio} className="flex items-center justify-between gap-3 text-[13px]">
                    {/* La clave cruda no es para mostrar: le diría «tc3n» al
                        dueño. La etiqueta sale de `utils/mediosDePago.js`. */}
                    <span className="min-w-0 truncate">{etiquetaDePago(medio)}</span>
                    <span className="num shrink-0 font-medium">{importeAbreviado(total)}</span>
                  </li>
                ))}
              </ul>
            </Bloque>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Los gastos fijos van en su propia franja y SIN sparkline: son un
              estado, no una serie —no tienen fecha—, así que no hay historia que
              reconstruir (decisión 18). Y van al lado del simulador, que es lo
              único que los usa. */}
          <Bloque titulo="Gastos fijos y precios">
            <div className="flex flex-col gap-5 px-5 py-4">
              {tiene('fixed_expenses') ? (
                <div>
                  <p className="eyebrow">Gastos fijos por mes</p>
                  <p className="num mt-1 text-[22px] font-semibold">
                    {importeOGuion(kpis.fixed_expenses)}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-fg-3">
                    La suma de los gastos fijos cargados en{' '}
                    <Link to="/gastos" className="underline hover:text-brand">
                      {nombreDeRuta('/gastos')}
                    </Link>. No
                    lleva sparkline: un gasto fijo no tiene fecha.
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-fg-2">
                  {/* ⚠ NOMBRA el permiso. Decía «el permiso de gastos», que es
                      una paráfrasis: el usuario no puede pedir lo que no puede
                      nombrar, y quien administra la empresa busca el código. */}
                  No ves los gastos fijos: {faltaElPermiso('gastos.ver').toLowerCase()}.
                </p>
              )}

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-brand" />
                  <h3 className="text-[13.5px] font-semibold">Simulador de punto de equilibrio</h3>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="eyebrow">Facturación mensual</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label="Facturación mensual"
                      value={metaDeVentas}
                      onChange={(e) => setMetaEscrita(e.target.value)}
                      className="num h-9 rounded-lg border border-border bg-surface px-2.5 text-[14px]
                                 focus-visible:border-brand focus-visible:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="eyebrow">Gastos fijos por mes</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label="Gastos fijos por mes"
                      value={gastosFijos}
                      onChange={(e) => setGastosEscritos(e.target.value)}
                      className="num h-9 rounded-lg border border-border bg-surface px-2.5 text-[14px]
                                 focus-visible:border-brand focus-visible:outline-none"
                    />
                  </label>
                </div>

                {!puedeSimular ? (
                  // No simula con datos inventados. Un simulador que se abre con
                  // números de ejemplo y no lo dice es una calculadora que da un
                  // resultado falso con cara de real (FR-051, FR-053).
                  <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
                    <p className="text-[13px] font-medium">Falta un dato para calcular.</p>
                    <p className="mt-1 text-[12.5px] leading-snug text-fg-2">
                      {faltaParaSimular(meta, fijos, tiene('fixed_expenses'))}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
                    {bep.viable ? (
                      <>
                        <p className="num text-[26px] font-semibold text-ok">
                          {bep.recargoSobreCosto}%
                        </p>
                        <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
                          Para cubrir gastos fijos de <strong>${pesos(fijos)}</strong> con una
                          facturación de <strong>${pesos(meta)}</strong>, el recargo mínimo sobre el
                          costo es del <strong>{bep.recargoSobreCosto}%</strong>. Equivale a que el{' '}
                          <strong>{bep.margenSobreVenta}%</strong> de lo que facturás sea margen
                          bruto: no es lo mismo un recargo del {bep.recargoSobreCosto}% sobre el
                          costo que un margen del {bep.recargoSobreCosto}% sobre la venta.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[15px] font-semibold text-warn">No hay precio que cierre.</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
                          Con gastos fijos de <strong>${pesos(fijos)}</strong> y una facturación de{' '}
                          <strong>${pesos(meta)}</strong>, los gastos se llevan todo lo que entra.
                          Hay que subir la facturación o bajar los gastos fijos.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {puedeSimular && bep.viable && (
                  <ul className="flex flex-col gap-2">
                    {estrategias.map((e) => (
                      <li
                        key={e.clave}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium">{e.titulo}</span>
                          <span className="block text-[12px] text-fg-3">{e.descripcion}</span>
                        </span>
                        <span className="num shrink-0 text-[13px] font-semibold">
                          {e.recargoSobreCosto === null
                            ? 'No alcanzable'
                            : `+${e.recargoSobreCosto}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Bloque>

          {tiene('cashflow') && (
            <Bloque titulo="Proyección de caja">
              <div className="flex flex-col gap-3 px-5 py-4">
                <div>
                  <p className="eyebrow">Proyección a 30 días</p>
                  <p className="num mt-1 text-[20px] font-semibold">
                    {importeOGuion(kpis.cashflow.projected_30d)}
                  </p>
                </div>
                {/* El supuesto, dicho. Antes el número salía 10 % inflado y la
                    pantalla no lo mencionaba (FR-060). */}
                <p className="text-[12px] leading-snug text-fg-3">
                  Supone que el próximo mes repite el anterior con un{' '}
                  {porcentajeDeCrecimiento(kpis.supuesto_crecimiento)} de crecimiento. No es un dato
                  histórico.
                </p>
              </div>
            </Bloque>
          )}

          <Bloque titulo="Accesos rápidos">
            <div className="grid grid-cols-2 gap-2.5 px-5 py-4">
              {ACCESOS_RAPIDOS.map((acceso) => {
                const Icono = acceso.icono

                return (
                  <Link
                    key={acceso.ruta}
                    to={acceso.ruta}
                    className="flex flex-col items-start gap-2 rounded-[10px] border border-border
                               bg-surface-2 p-3 text-[12.5px] font-medium leading-tight
                               transition-colors hover:border-brand-line hover:bg-brand-soft"
                  >
                    <Icono className="h-[17px] w-[17px] text-brand" />
                    {acceso.etiqueta}
                  </Link>
                )
              })}
            </div>
          </Bloque>
        </div>
      </div>
    </div>
  )
}

/**
 * La variación del mes contra el anterior, o `null` cuando no se puede comparar.
 *
 * `null` **no es cero**: con el mes anterior en cero no hay porcentaje que
 * calcular, y dibujar «+0 %» afirmaría que el negocio quedó igual.
 */
function variacionDeVentas(kpis) {
  const actual = Number(kpis?.sales_current_month?.total)
  const anterior = Number(kpis?.sales_previous_month?.total)

  if (!Number.isFinite(actual) || !Number.isFinite(anterior) || anterior === 0) return null

  return ((actual - anterior) / anterior) * 100
}

/** Qué falta para poder simular, dicho con el lugar donde se carga (FR-051). */
function faltaParaSimular(meta, fijos, puedeVerGastos) {
  // Un cero se trata igual que un vacío: con los gastos fijos en cero no hay
  // punto de equilibrio que calcular, y la respuesta útil es dónde cargarlos.
  const hayGastos = fijos !== null && fijos > 0

  if (!hayGastos && !puedeVerGastos) {
    return `No podemos traer tus gastos fijos: ${faltaElPermiso('gastos.ver').toLowerCase()}. `
      + 'Podés escribirlos a mano acá arriba.'
  }

  if (!hayGastos) {
    return `Cargá tus gastos fijos en ${nombreDeRuta('/gastos')}, o escribí un importe acá arriba para probar.`
  }

  return 'Escribí tu facturación mensual promedio acá arriba. ' +
    'Es la que el simulador usa para calcular el recargo mínimo.'
}

/** `1.1` → «10 %». Un factor crudo no le dice nada a nadie. */
function porcentajeDeCrecimiento(factor) {
  const n = Number(factor)

  if (!Number.isFinite(n)) return '0 %'

  return `${Math.round((n - 1) * 100)} %`
}
