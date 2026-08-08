import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Laptop, LogOut, RotateCcw, Smartphone } from 'lucide-react'
import { BotonDeFila, Encabezado, Fila, TablaGrid } from '@/components/TablaGrid'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import {
  cerrarMisOtrasSesiones,
  cerrarSesion,
  getSesionesDelEquipo,
} from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { etiquetaDeDispositivo, haceCuanto } from '@/utils/sesiones'
import { faltaElPermiso } from '@/utils/permisos'

// ════════════════════════════════════════════
//  ADMINAPP · Sesiones activas del equipo
//
//  El legacy las tenía y no estaban (`legacy:3070-3084`, `:10016-10088`): una
//  fila por dispositivo, el badge «Este dispositivo», un botón de cerrar por
//  fila y un «cerrar todas menos yo».
//
//  ── ⚠ Lo que este bloque NO hace, y hay que decirlo con estas palabras ──
//
//  **No revoca ningún token.** Sin la Management API de Auth0 eso no se puede
//  hacer desde acá. Lo que se cierra es la sesión del navegador que **coopera**:
//  recibe 401 en su próximo pedido, borra su identificador y vuelve al login.
//  Alguien con el token y otra herramienta puede seguir entrando hasta que el
//  token venza.
//
//  Por eso el botón dice **«Cerrar sesión en ese dispositivo»** y no «Revocar el
//  acceso». No es una sutileza de redacción: quien lee «revocar» da por cerrado
//  el problema de alguien que se fue enojado, y el corte de verdad es otro
//  —desactivar a la persona en la tabla de arriba—, que la API aplica en el
//  request siguiente porque relee la membresía en cada uno.
//
//  ── Y lo segundo que la confirmación tiene que decir ──
//
//  Una sesión es de un **dispositivo de una persona** y no de una empresa: la
//  tabla no tiene `empresa_id`. Cerrar una la cierra en **todas** las empresas a
//  las que esa persona tenga acceso. Es la decisión 3 del plan, y sin decirlo
//  alguien cierra la sesión de un contador que trabaja para tres clientes
//  creyendo que lo saca de uno.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * El `grid-template-columns`, escrito UNA vez.
 *
 * El encabezado y las filas comparten este mismo string. Cuando difieren, las
 * etiquetas dejan de estar sobre sus datos y se lee una IP bajo «Inicio».
 */
const COLUMNAS = 'minmax(0,1.4fr) 150px minmax(0,1fr) 130px 140px 56px'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

/** El ícono del aparato. Es la etiqueta dibujada, no una segunda regla. */
function IconoDeDispositivo({ codigo }) {
  const Icono = codigo === 'celular' ? Smartphone : Laptop

  return <Icono className="h-[15px] w-[15px] shrink-0 text-fg-3" strokeWidth={1.8} />
}

export default function SesionesDelEquipo({ empresaId, onCambio }) {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const [sesiones, setSesiones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorDeCarga, setErrorDeCarga] = useState('')

  const puedeCerrarAjenas = can('equipo.editar')

  const cargar = useCallback(async () => {
    if (!empresaId) return

    setCargando(true)
    try {
      const res = await getSesionesDelEquipo(empresaId)
      setSesiones(res.data?.data || [])
      setErrorDeCarga('')
    } catch (err) {
      // El fallo se dibuja en la pantalla y no en la consola: una lista vacía es
      // una afirmación sobre la empresa —«nadie tiene una sesión abierta»— y no
      // es lo que pasó.
      setSesiones([])
      setErrorDeCarga(mensajeDeError(err, 'No se pudieron leer las sesiones abiertas.'))
    } finally {
      setCargando(false)
    }
  }, [empresaId])

  useEffect(() => { cargar() }, [cargar])

  const cerrarUna = async (sesion) => {
    const quien = sesion.nombre || 'esa persona'

    const ok = await confirm(
      `¿Cerrar sesión en ese dispositivo? ${quien} va a tener que volver a entrar desde ` +
      'esa computadora o ese teléfono. Se va a cerrar esa sesión en todas las empresas a ' +
      'las que esta persona tenga acceso, porque la sesión es del dispositivo y no de la ' +
      'empresa. Esto no revoca su acceso: si vuelve a entrar, abre una sesión nueva. Para ' +
      'sacarla del equipo, desactivala en la lista de miembros.',
      { verbo: 'Cerrar esa sesión' }
    )
    if (!ok) return

    try {
      await cerrarSesion(sesion.id)
      await cargar()
      onCambio?.()
      toast.success('Se cerró la sesión de ese dispositivo.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo cerrar esa sesión.'))
    }
  }

  const cerrarLasMias = async () => {
    const ok = await confirm(
      '¿Cerrar todas tus otras sesiones? Ésta, la de este navegador, sigue abierta. ' +
      'Los demás dispositivos van a tener que volver a entrar.',
      { verbo: 'Cerrar las otras' }
    )
    if (!ok) return

    try {
      const res = await cerrarMisOtrasSesiones()
      await cargar()
      onCambio?.()
      toast.success(res.data?.message || 'Se cerraron tus otras sesiones.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron cerrar tus otras sesiones.'))
    }
  }

  return (
    <section
      data-bloque="sesiones"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Sesiones activas</h2>
        <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
          {sesiones.length}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={BOTON_SECUNDARIO}
            onClick={cerrarLasMias}
            disabled={cargando}
          >
            <LogOut className="h-3.5 w-3.5 text-fg-3" />
            Cerrar mis otras sesiones
          </button>
        </div>
      </div>

      {/* ⚠ El techo, a la vista y no en un comentario del código: quien lee esta
          lista tiene que saber qué compra el botón y qué no. */}
      <p className="border-b border-border bg-surface-2 px-5 py-3 text-[12.5px] leading-relaxed text-fg-2">
        Cerrar una sesión saca a ese navegador: en su próximo pedido vuelve al inicio de
        sesión. <strong>No revoca el acceso de la persona</strong> — si vuelve a entrar, abre
        una sesión nueva. Para sacar a alguien del equipo, desactivalo en la lista de miembros.
      </p>

      {/* ── El fallo y el vacío son EL MISMO bloque, y es deliberado ──

          Una lista vacía es una afirmación sobre la empresa —«nadie tiene una
          sesión abierta»— y cuando el pedido falló eso es falso. Los dos estados
          se dibujan en el mismo lugar con textos opuestos, y el `data-` dice
          cuál es cuál.

          No lleva `role="alert"` y no es un olvido: la pantalla de Equipo ya
          tiene uno para el fallo de la lista de miembros, y cuando la API está
          caída fallan los dos pedidos. Dos regiones «alert» anunciando lo mismo
          es ruido para quien usa lector de pantalla, y para el resto es un
          cartel duplicado. */}
      {!cargando && sesiones.length === 0 ? (
        <div
          data-estado-vacio={errorDeCarga ? 'no_se_pudieron_leer' : 'sin_sesiones'}
          className="px-5 py-12 text-center"
        >
          {errorDeCarga ? (
            <AlertTriangle className="mx-auto mb-2.5 h-7 w-7 text-fg-3" strokeWidth={1.6} />
          ) : (
            <Laptop className="mx-auto mb-2.5 h-7 w-7 text-fg-3" strokeWidth={1.6} />
          )}

          <p className="font-semibold">
            {errorDeCarga ? 'No se pudieron leer las sesiones.' : 'No hay ninguna sesión abierta.'}
          </p>

          <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">
            {errorDeCarga || 'Acá aparece cada navegador desde el que alguien del equipo entró, con la última vez que pidió datos.'}
          </p>

          {errorDeCarga && (
            <button type="button" className={`${BOTON_SECUNDARIO} mt-3`} onClick={cargar}>
              <RotateCcw className="h-3.5 w-3.5 text-fg-3" />
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <TablaGrid anchoMinimo={880}>
          <Encabezado columnas={COLUMNAS}>
            <span>Persona</span>
            <span>Dispositivo</span>
            <span>Desde</span>
            <span>Inicio</span>
            <span>Último acceso</span>
            <span />
          </Encabezado>

          {sesiones.map((sesion) => (
            <Fila key={sesion.id} columnas={COLUMNAS} className="cursor-default">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13.5px] font-medium" title={sesion.email || ''}>
                  {sesion.nombre || <span className="text-fg-3">Sin nombre</span>}
                </span>

                {sesion.es_este_dispositivo && (
                  <span
                    data-este-dispositivo="si"
                    className="shrink-0 rounded-md border border-ok-line bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok"
                  >
                    Este dispositivo
                  </span>
                )}
              </span>

              <span className="flex items-center gap-1.5 text-[13px]">
                <IconoDeDispositivo codigo={sesion.dispositivo} />
                {etiquetaDeDispositivo(sesion.dispositivo)}
              </span>

              <span className="num truncate text-[13px] text-fg-2" title={sesion.user_agent || ''}>
                {sesion.ip || '—'}
              </span>

              <span className="text-[13px] text-fg-2">{haceCuanto(sesion.iniciada_en)}</span>

              <span className="text-[13px] text-fg-2">{haceCuanto(sesion.vista_en)}</span>

              <span className="flex justify-end">
                <BotonDeFila
                  onClick={() => cerrarUna(sesion)}
                  disabled={!puedeCerrarAjenas || sesion.es_este_dispositivo}
                  title={
                    sesion.es_este_dispositivo
                      ? 'Es la sesión de este navegador: usá «Cerrar mis otras sesiones» o cerrá sesión normalmente'
                      : puedeCerrarAjenas
                        ? 'Cerrar sesión en ese dispositivo'
                        : faltaElPermiso('equipo.editar')
                  }
                >
                  <LogOut />
                </BotonDeFila>
              </span>
            </Fila>
          ))}
        </TablaGrid>
      )}

      <ConfirmDialog />
    </section>
  )
}
