import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, Users } from 'lucide-react'
import useStore from '@/store/useStore'
import { createGastoVariable, deleteGastoVariable, getGastosVariables } from '@/services/api'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import { Can } from '@/components/Can'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { desplazarMes, nombreDelMes } from '@/utils/gastos'
import { fechaDeHoy, pesos } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'

// ════════════════════════════════════════════
//  FAVALIO · Gastos variables
//
//  Los que cambian mes a mes y tienen un responsable: viáticos, combustible,
//  adelantos, compras sueltas. El sistema anterior los cargaba así —por persona
//  y por mes— y era rutina de fin de mes.
//
//  Están separados de los fijos a propósito: **el punto de equilibrio se calcula
//  con los FIJOS.** Si entraran en la misma bolsa, cargar un viático le
//  cambiaría el precio recomendado a todo el catálogo.
//
//  ── Qué cambió en esta pasada ──
//
//   · **El mes por defecto ya no se calcula en UTC.** Era
//     `new Date().toISOString().slice(0, 7)`: el 31 a las 21:30 hora argentina
//     la pantalla abría en el mes siguiente, vacío, y el gasto que se cargaba
//     esa noche entraba en el mes equivocado. Sale de `fechaDeHoy` y el nombre
//     del mes de `utils/gastos.js`, que no depende de la localización del
//     navegador (FR-035, FR-012).
//   · **Los tres `err.response?.data?.error || err.message`.** El primero
//     dibujaba el código crudo —`checkPermission` responde `{error:'FORBIDDEN'}`
//     y el toast decía «FORBIDDEN»— y el segundo, «Request failed with status
//     code 400». Los dos salen ahora de `mensajeDeError`, que filtra los códigos
//     de máquina (FR-008).
//   · **El fallo de carga se ve en la pantalla**, no solo en un toast que se va
//     a los cinco segundos y deja una lista vacía indistinguible de un mes sin
//     gastos (FR-009, FR-019).
//   · **Los `Table*` de shadcn y los `toLocaleString('es-AR')` sueltos**, que
//     mostraban «1.234,5» al lado de «1.234,50» porque fijaban el locale y no
//     los decimales. Tabla en grid con el mismo string de columnas en el
//     encabezado y en las filas, e importes por `pesos` (FR-007, FR-010, FR-011).
//   · **El alta gateada con `Can` y con su explicación**, no ausente: un
//     formulario que desaparece sin decir por qué se lee como que la pantalla
//     está rota (FR-017).
// ════════════════════════════════════════════

/**
 * Las cuatro columnas, idénticas en el encabezado y en las filas (FR-007).
 *
 * La persona va primero porque es por lo que se busca: «cuánto gastó Marina
 * este mes» es la pregunta, y el concepto es el detalle.
 */
const COLUMNAS = '200px minmax(0,1fr) 150px 52px'

const ANCHO_MINIMO = 700

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none'

/** El mes en curso según la fecha local, nunca según UTC. */
function mesDeHoy() {
  return fechaDeHoy().slice(0, 7)
}

const NUEVO_VACIO = { persona: '', nombre: '', monto: '', punto_de_venta_id: '' }

export default function GastosVariables() {
  const empresaActiva = useStore((s) => s.empresaActiva)
  const puntosDeVenta = empresaActiva?.puntosDeVenta || []

  const [mes, setMes] = useState(mesDeHoy())
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [errorDeCarga, setErrorDeCarga] = useState('')

  const { confirm, ConfirmDialog } = useConfirmDialog()

  const [nuevo, setNuevo] = useState(NUEVO_VACIO)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await getGastosVariables(mes)

      setDatos(res.data?.data || null)
      setErrorDeCarga('')
    } catch (err) {
      setErrorDeCarga(
        err?.response?.status === 403
          ? 'No podés ver los gastos variables: te falta el permiso «gastos.ver».'
          : mensajeDeError(err, 'No se pudieron cargar los gastos variables del mes.')
      )
      setDatos(null)
    } finally {
      setCargando(false)
    }
  }, [mes])

  useEffect(() => { cargar() }, [cargar])

  const agregar = async (evento) => {
    evento.preventDefault()

    if (!nuevo.persona.trim() || !nuevo.nombre.trim()) {
      toast.error('Falta la persona o el concepto.')
      return
    }

    setGuardando(true)
    try {
      await createGastoVariable({
        persona: nuevo.persona.trim(),
        nombre: nuevo.nombre.trim(),
        monto: Number(nuevo.monto) || 0,
        mes,
        punto_de_venta_id: nuevo.punto_de_venta_id ? Number(nuevo.punto_de_venta_id) : null,
      })

      // La persona queda cargada: lo normal es cargar varios gastos seguidos de
      // la misma persona.
      setNuevo((previo) => ({ ...previo, nombre: '', monto: '' }))
      cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cargar el gasto.'))
    } finally {
      setGuardando(false)
    }
  }

  const eliminar = async (item) => {
    const ok = await confirm(`¿Eliminar «${item.nombre}»?`, { verbo: 'Eliminar' })
    if (!ok) return

    try {
      await deleteGastoVariable(item.id)
      cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo eliminar el gasto.'))
    }
  }

  const personas = datos?.personas || []

  // Las filas salen del agrupado del servidor, aplanado con su persona al lado:
  // es una sola lectura y no puede discrepar con los subtotales de arriba.
  const filas = personas.flatMap((grupo) => grupo.items.map((item) => ({ item, persona: grupo.persona })))

  const esMesActual = mes >= mesDeHoy()

  return (
    <div className="flex flex-col gap-4">
      {/* ── El mes, y el total del mes ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setMes(desplazarMes(mes, -1))}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface
                       text-fg-2 transition-colors hover:bg-surface-3"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="min-w-[9.5rem] text-center text-[13.5px] font-semibold capitalize">
            {nombreDelMes(mes)}
          </span>

          <button
            type="button"
            aria-label="Mes siguiente"
            disabled={esMesActual}
            title={esMesActual ? 'No se cargan gastos de meses que todavía no empezaron' : undefined}
            onClick={() => setMes(desplazarMes(mes, 1))}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface
                       text-fg-2 transition-colors hover:bg-surface-3
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {cargando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
        </div>

        <div className="text-right">
          <p className="eyebrow">Total del mes</p>
          <p className="num text-[22px] font-semibold">${pesos(datos?.total ?? 0)}</p>
        </div>
      </div>

      {errorDeCarga && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-5 py-4"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
          <p className="text-[13.5px] font-medium">{errorDeCarga}</p>
        </div>
      )}

      {/* ── El alta ── */}
      <Can
        codigo="gastos.crear"
        fallback={
          <p className="rounded-xl border border-border bg-surface-2 px-5 py-3.5 text-[12.5px] text-fg-2">
            No podés cargar gastos variables: te falta el permiso «gastos.crear». Lo que hay cargado
            se ve igual.
          </p>
        }
      >
        <form
          onSubmit={agregar}
          className="grid grid-cols-1 items-end gap-2 rounded-xl border border-border bg-surface
                     px-5 py-4 shadow-nivel-1 md:grid-cols-[1fr_1.5fr_140px_auto_auto]"
        >
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">Persona</span>
            <input
              className={CAMPO}
              list="personas-cargadas"
              value={nuevo.persona}
              placeholder="Nombre"
              onChange={(e) => setNuevo({ ...nuevo, persona: e.target.value })}
            />
            {/* Sugiere las que ya se cargaron este mes: evita que la misma
                persona quede escrita de tres formas distintas. */}
            <datalist id="personas-cargadas">
              {personas.map((p) => <option key={p.persona} value={p.persona} />)}
            </datalist>
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">Concepto</span>
            <input
              className={CAMPO}
              value={nuevo.nombre}
              placeholder="Ej: nafta, viático, adelanto"
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">Monto</span>
            <input
              className={`${CAMPO} num`}
              type="number"
              step="0.01"
              value={nuevo.monto}
              placeholder="0"
              onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })}
            />
          </label>

          {puntosDeVenta.length > 1 && (
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">Sucursal</span>
              <select
                className={CAMPO}
                aria-label="Sucursal"
                value={nuevo.punto_de_venta_id}
                onChange={(e) => setNuevo({ ...nuevo, punto_de_venta_id: e.target.value })}
              >
                <option value="">General</option>
                {puntosDeVenta.map((pv) => (
                  <option key={pv.id} value={pv.id}>{pv.name}</option>
                ))}
              </select>
            </label>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[13px]
                       font-semibold text-white shadow-nivel-1 transition-colors hover:bg-brand-dark
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar
          </button>
        </form>
      </Can>

      {/* ── Los subtotales por persona, que es como se mira ── */}
      {personas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {personas.map((grupo) => (
            <span
              key={grupo.persona}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2
                         px-3 py-1 text-[12.5px]"
            >
              <span className="font-medium">{grupo.persona}</span>
              <span className="num font-semibold">${pesos(grupo.total)}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── La tabla ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        {filas.length === 0 && !cargando ? (
          <div className="py-12 text-center">
            <Users className="mx-auto h-7 w-7 text-fg-3" />
            <p className="mt-3 font-semibold capitalize">Sin gastos variables en {nombreDelMes(mes)}.</p>
            <p className="mt-1 text-sm text-fg-2">
              Los viáticos, la nafta y los adelantos de este mes van acá, con el nombre de quien los
              hizo. No entran en el punto de equilibrio.
            </p>
          </div>
        ) : (
          <TablaGrid anchoMinimo={ANCHO_MINIMO}>
            <Encabezado columnas={COLUMNAS}>
              <span>Persona</span>
              <span>Concepto</span>
              <span className="text-right">Importe</span>
              <span className="text-right">Acciones</span>
            </Encabezado>

            {filas.map(({ item, persona }) => (
              <Fila key={item.id} columnas={COLUMNAS} className="cursor-default">
                <span className="truncate text-[13.5px] font-medium">{persona}</span>

                <span className="min-w-0 truncate text-[13px] text-fg-2">{item.nombre}</span>

                <span className="num text-right text-[13.5px] font-semibold">${pesos(item.monto)}</span>

                <span className="flex justify-end">
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
                      onClick={() => eliminar(item)}
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

      <ConfirmDialog />
    </div>
  )
}
