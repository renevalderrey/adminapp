import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { createExpense, updateExpense } from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { pesos } from '@/utils/formato'
import { usePermission } from '@/hooks/usePermission'
import { faltaElPermiso } from '@/utils/permisos'

// ════════════════════════════════════════════
//  ADMINAPP · Panel del gasto fijo
//
//  ── Lo que no existía ──
//
//  **Un gasto fijo no se podía editar.** `services/api.js:222` declara
//  `updateExpense` desde siempre y NINGÚN componente lo importaba —verificado
//  con grep sobre todos los `.jsx`—: la pantalla solo sabía crear y borrar. Para
//  corregir un alquiler que subió había que eliminar el gasto y volver a
//  cargarlo, con lo cual el punto de equilibrio quedaba mal entre las dos
//  operaciones y, si alguien se distraía en el medio, quedaba mal y nadie se
//  enteraba.
//
//  ── Por qué panel lateral y no modal (FR-039) ──
//
//  Es el mismo motivo que el panel del producto y el de la venta: quien corrige
//  un importe lo hace **mirando el resto de la lista**, que es lo que le dice si
//  el número que está por escribir tiene sentido. Un modal tapa exactamente eso.
//  520px con `max-w-[92vw]`, como los otros dos.
//
//  Se apoya en `components/ui/sheet.jsx`, que ya resuelve Esc, el clic en el
//  overlay, la trampa de foco y el retorno del foco a la fila.
//
//  ⚠ **La sucursal vacía es un caso legítimo**, no un campo sin completar: un
//  gasto sin sucursal se dibuja en «General» (FR-022) y el servidor lo acepta.
//  Por eso la opción está primera y con su explicación, en vez de obligar a
//  elegir una sucursal cualquiera — que es cómo la plata termina cargada donde
//  no va.
// ════════════════════════════════════════════

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-2'

/** Un campo con su etiqueta. */
function Campo({ etiqueta, ayuda, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow">{etiqueta}</span>
      {children}
      {ayuda && <span className="text-[12px] text-fg-3">{ayuda}</span>}
    </label>
  )
}

const VACIO = { name: '', amount: '', punto_de_venta_id: '' }

/**
 * @param {object} props
 * @param {boolean} props.abierto
 * @param {(v: boolean) => void} props.onOpenChange
 * @param {object|null} props.gasto El gasto a editar, o `null` para el alta.
 * @param {Array<{id:number, name:string}>} props.sucursales
 * @param {() => void} props.onGuardado Se llama después de crear o editar.
 */
export default function PanelDeGasto({
  abierto = false,
  onOpenChange,
  gasto = null,
  sucursales = [],
  onGuardado,
}) {
  const { can } = usePermission()

  const esAlta = !gasto
  // El permiso que hace falta depende de qué se está haciendo, y por eso se
  // resuelve acá y no en la pantalla: el mismo panel abre para las dos cosas.
  const puedeGuardar = esAlta ? can('gastos.crear') : can('gastos.editar')

  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return

    setForm(gasto
      ? {
        name: gasto.name || '',
        amount: gasto.amount ?? '',
        // El `?? ''` y no `|| ''`: un id nunca es 0, pero escribir `||` acá es
        // cómo se cuela el defecto que confunde «sin sucursal» con «la
        // sucursal cero».
        punto_de_venta_id: gasto.punto_de_venta_id ?? '',
      }
      : VACIO)
  }, [abierto, gasto])

  const cambiar = (campo) => (valor) => setForm((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async (evento) => {
    evento.preventDefault()
    if (guardando || !puedeGuardar) return

    const importe = Number(form.amount)

    if (!form.name.trim()) {
      toast.error('Poné una descripción: es lo único que después dice qué es este gasto.')
      return
    }
    if (!Number.isFinite(importe)) {
      toast.error('El importe tiene que ser un número.')
      return
    }

    // Los tres campos que el servidor acepta, y ninguno más: `group`,
    // `empresa_id` e `id` los ignora (FR-030 a FR-032).
    const cuerpo = {
      name: form.name.trim(),
      amount: importe,
      punto_de_venta_id: form.punto_de_venta_id === '' ? null : Number(form.punto_de_venta_id),
    }

    setGuardando(true)
    try {
      // ⚠ La rama es lo único que separa «corregir» de «duplicar»: con
      // `createExpense` siempre, editar el alquiler dejaría el viejo cargado y
      // el punto de equilibrio contaría el gasto dos veces.
      if (esAlta) await createExpense(cuerpo)
      else await updateExpense(gasto.id, cuerpo)

      toast.success(esAlta ? 'Gasto agregado' : 'Gasto actualizado')
      onGuardado?.()
      onOpenChange?.(false)
    } catch (err) {
      // Nunca `err.message`: en axios es «Request failed with status code 500»,
      // que no dice qué corregir y no se puede dictar por teléfono (FR-008).
      toast.error(mensajeDeError(err, 'No se pudo guardar el gasto.'))
    } finally {
      setGuardando(false)
    }
  }

  const sinPermiso = esAlta
    ? `No podés crear gastos: ${faltaElPermiso('gastos.crear').toLowerCase()}.`
    : `No podés editar gastos: ${faltaElPermiso('gastos.editar').toLowerCase()}.`

  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent
        // El ancho va en `style` y no en clases: `SheetContent` trae
        // `data-[side=right]:sm:max-w-sm` y `w-3/4` propios, y esas reglas viven
        // en un media query que gana por orden de hoja.
        style={{ width: '520px', maxWidth: '92vw' }}
        className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
      >
        <div className="border-b border-border px-6 py-5 pr-12">
          <p className="eyebrow">Gasto fijo</p>

          <SheetTitle className="mt-1 text-[19px] font-semibold">
            {esAlta ? 'Nuevo gasto fijo' : (gasto.name || '—')}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            {esAlta
              ? 'Un costo que se repite todos los meses. Entra en el cálculo del punto de equilibrio.'
              : `Se cobra todos los meses. Hoy son $${pesos(gasto.amount)}.`}
          </SheetDescription>
        </div>

        {!abierto ? null : (
          <form onSubmit={guardar} className="flex flex-col gap-6 px-6 py-6">
            {!puedeGuardar && (
              <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
                <p className="text-[12.5px] text-warn">{sinPermiso}</p>
              </div>
            )}

            <Campo etiqueta="Descripción">
              <input
                className={CAMPO}
                value={form.name}
                disabled={!puedeGuardar}
                onChange={(e) => cambiar('name')(e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Importe mensual">
              <input
                className={`${CAMPO} num`}
                type="number"
                step="0.01"
                value={form.amount}
                disabled={!puedeGuardar}
                onChange={(e) => cambiar('amount')(e.target.value)}
              />
            </Campo>

            <Campo
              etiqueta="Sucursal"
              ayuda="Sin sucursal, el gasto se agrupa en «General» y suma igual al total."
            >
              <select
                className={CAMPO}
                aria-label="Sucursal"
                value={form.punto_de_venta_id}
                disabled={!puedeGuardar}
                onChange={(e) => cambiar('punto_de_venta_id')(e.target.value)}
              >
                <option value="">General (sin sucursal)</option>
                {sucursales.map((pv) => (
                  <option key={pv.id} value={pv.id}>{pv.name}</option>
                ))}
              </select>
            </Campo>

            <div className="flex justify-end gap-2 border-t border-border pt-5">
              <button
                type="button"
                className={BOTON_SECUNDARIO}
                onClick={() => onOpenChange?.(false)}
              >
                Cancelar
              </button>

              <button
                type="submit"
                className={BOTON_PRINCIPAL}
                disabled={guardando || !puedeGuardar}
                title={puedeGuardar ? undefined : sinPermiso}
              >
                {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {esAlta ? 'Agregar gasto' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
