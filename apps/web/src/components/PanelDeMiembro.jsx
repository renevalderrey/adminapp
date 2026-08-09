import { useEffect, useState } from 'react'
import { Loader2, ShieldAlert, UserMinus, UserPlus } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { desactivarMiembro, reactivarMiembro, updateMemberRole } from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { fechaCortaDeMomento } from '@/utils/formato'
import {
  ETIQUETAS_DE_MIEMBRO,
  ETIQUETAS_DE_ROL,
  estadoDeMiembro,
  puedeCambiarRol,
  tonoDeMiembro,
} from '@/utils/equipo'

// ════════════════════════════════════════════
//  FAVALIO · Panel de un miembro del equipo
//
//  Es un panel lateral y no un modal por el mismo motivo que el del producto y
//  el de la orden: se cambia el rol de alguien **mirando el resto del equipo**,
//  que es lo que dice si el cambio deja a la empresa sin administrador. Un modal
//  tapa exactamente eso.
//
//  ── Las dos cosas que este panel hace y la pantalla vieja no ──
//
//  · **Deshabilita el selector con su explicación** cuando `puedeCambiarRol`
//    dice que no (FR-111). Antes el `Select` se dibujaba igual en todas las
//    filas —incluida la propia—, sin `disabled`, sin confirmación y sin ninguna
//    regla del otro lado: se podía degradar al único administrador de la empresa
//    y quedarse sin nadie que pudiera invitar, cambiar roles ni tocar la
//    configuración. De eso no se sale desde la aplicación.
//  · **Deja sacar a alguien del equipo, y devolverlo** (FR-113, E12). El
//    endpoint existía —`PUT /usuarios/:id` con `is_active`— y la pantalla no lo
//    exponía: la única forma de sacar a alguien era escribir en la base.
//
//  ── Y lo que dice con todas las letras ──
//
//  Que desactivar **corta el acceso en el próximo request**. Es cierto y hay que
//  decirlo porque es lo contrario de lo que se cree: `loadEmpresaContext` relee
//  la membresía en cada request, así que no hay que esperar a que venza ningún
//  token. Prometer menos de lo que hace deja a alguien mirando el reloj sin
//  motivo; prometer más sería peor.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const BOTON_PELIGRO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-danger-line bg-surface px-3 ' +
  'text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/** Un dato del panel: etiqueta arriba, valor abajo. */
function Dato({ etiqueta, children }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{etiqueta}</p>
      <div className="mt-1 text-[13.5px]">{children}</div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object|null} props.miembro La fila de `usuario_empresas`, con `usuario`.
 * @param {Array<object>} props.miembros Todo el equipo: de ahí sale «es el último admin».
 * @param {{usuario_id?: number|string}} props.yo Quién está mirando.
 * @param {boolean} props.puedeEditar Si tiene el permiso `equipo.editar`.
 * @param {Function} props.onCambio Se llama después de cada cambio guardado.
 */
export default function PanelDeMiembro({
  miembro,
  miembros = [],
  yo,
  abierto,
  onOpenChange,
  puedeEditar = false,
  onCambio,
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // El aviso es de la fila que se está mirando: dejarlo puesto al abrir otra
  // haría que un error de Marcos apareciera sobre el panel de Ana.
  useEffect(() => { setError('') }, [miembro?.id])

  if (!miembro) {
    return (
      <Sheet open={abierto} onOpenChange={onOpenChange}>
        <SheetContent
          style={{ width: '520px', maxWidth: '92vw' }}
          className="anim-panel gap-0 overflow-y-auto bg-surface p-0 shadow-nivel-3"
        >
          <div className="border-b border-border px-6 py-5 pr-12">
            <SheetTitle className="text-[18px] font-semibold">—</SheetTitle>
            <SheetDescription className="mt-1 text-[13px] text-fg-2">
              Elegí a alguien del equipo para ver su detalle.
            </SheetDescription>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  const persona = miembro.usuario || {}
  const estado = estadoDeMiembro(miembro)
  const activo = estado === 'activo'

  const veredicto = puedeCambiarRol({ miembro, yo, miembros })

  // Dos motivos distintos para lo mismo, y se dicen distinto: no tener el
  // permiso se arregla pidiéndolo, y ser el último admin se arregla nombrando a
  // otro. Un único texto genérico mandaría a la persona equivocada.
  const bloqueado = !puedeEditar || !veredicto.puede
  const explicacion = !puedeEditar
    ? 'No podés cambiar roles ni sacar a nadie del equipo: te falta el permiso «equipo.editar».'
    : veredicto.motivo

  const guardar = async (accion, mensajeDeFallo) => {
    setGuardando(true)
    setError('')
    try {
      await accion()
      await onCambio?.()
    } catch (err) {
      // Nunca `err.message`: en axios eso es «Request failed with status code
      // 400», y el texto que sí sirve —«Es el único administrador activo…»— lo
      // manda el servidor en el cuerpo.
      setError(mensajeDeError(err, mensajeDeFallo))
    } finally {
      setGuardando(false)
    }
  }

  const cambiarRol = (role) => {
    if (role === miembro.role) return

    return guardar(
      () => updateMemberRole(miembro.id, role),
      `No se pudo cambiar el rol de ${persona.nombre || persona.email || 'esta persona'}.`
    )
  }

  const desactivar = async () => {
    const ok = await confirm(
      `¿Sacar a ${persona.nombre || persona.email} del equipo de esta empresa? ` +
      'Pierde el acceso en su próximo pedido al sistema y sus invitaciones ' +
      'pendientes quedan revocadas. Su historial —ventas, movimientos— no se toca, ' +
      'y podés devolverle el acceso desde acá cuando quieras.',
      { verbo: 'Sacar del equipo' }
    )
    if (!ok) return

    return guardar(
      () => desactivarMiembro(miembro.id),
      `No se pudo desactivar a ${persona.nombre || persona.email || 'esta persona'}.`
    )
  }

  const reactivar = () => guardar(
    () => reactivarMiembro(miembro.id),
    `No se pudo reactivar a ${persona.nombre || persona.email || 'esta persona'}.`
  )

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
          <p className="eyebrow">Miembro del equipo</p>

          <SheetTitle className="mt-1 text-[18px] font-semibold">
            {persona.nombre || persona.email || 'Sin nombre'}
          </SheetTitle>

          <SheetDescription className="mt-1 text-[13px] text-fg-2">
            {persona.email || 'Sin email'}
          </SheetDescription>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <Dato etiqueta="Estado">
              <span
                data-estado-del-miembro={estado}
                className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeMiembro(estado)}`}
              >
                {ETIQUETAS_DE_MIEMBRO[estado]}
              </span>
            </Dato>

            <Dato etiqueta="En el equipo desde">
              <span className="num">{fechaCortaDeMomento(miembro.createdAt)}</span>
            </Dato>
          </div>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">Rol</span>
            <select
              aria-label="Rol"
              className={CAMPO}
              value={miembro.role || ''}
              disabled={bloqueado || guardando}
              onChange={(evento) => cambiarRol(evento.target.value)}
            >
              {/* Un rol que no está en el catálogo —una fila vieja, un valor
                  escrito a mano en la base— tiene que poder verse: sin esta
                  opción el selector quedaría en blanco y no habría forma de
                  saber qué dice la fila. */}
              {!ETIQUETAS_DE_ROL[miembro.role] && miembro.role && (
                <option value={miembro.role}>{miembro.role} (fuera del catálogo)</option>
              )}

              {Object.entries(ETIQUETAS_DE_ROL).map(([codigo, etiqueta]) => (
                <option key={codigo} value={codigo}>{etiqueta}</option>
              ))}
            </select>
          </label>

          {/* FR-111 y FR-017: deshabilitado CON su explicación, no ausente. Un
              campo apagado sin motivo se lee como un error de la aplicación. */}
          {bloqueado && (
            <p data-motivo-bloqueo className="flex items-start gap-2 text-[12.5px] text-fg-2">
              <ShieldAlert className="mt-[2px] h-3.5 w-3.5 shrink-0 text-fg-3" />
              <span>{explicacion}</span>
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px]">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
            {guardando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}

            {activo ? (
              <button
                type="button"
                className={BOTON_PELIGRO}
                onClick={desactivar}
                disabled={bloqueado || guardando}
                title={bloqueado ? explicacion : 'Le saca el acceso a esta empresa'}
              >
                <UserMinus className="h-3.5 w-3.5" />
                Sacar del equipo
              </button>
            ) : (
              <button
                type="button"
                className={BOTON_SECUNDARIO}
                onClick={reactivar}
                disabled={bloqueado || guardando}
                title={bloqueado ? explicacion : 'Le devuelve el acceso a esta empresa'}
              >
                <UserPlus className="h-3.5 w-3.5 text-fg-3" />
                Devolverle el acceso
              </button>
            )}
          </div>

          <p className="text-[12.5px] leading-relaxed text-fg-3">
            Sacar a alguien del equipo le corta el acceso <strong>en su próximo pedido</strong> al
            sistema: no hay que esperar a que venza ninguna sesión. Lo que no hace es borrar nada
            de lo que cargó.
          </p>
        </div>

        <ConfirmDialog />
      </SheetContent>
    </Sheet>
  )
}
