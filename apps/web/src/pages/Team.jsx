import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Copy, Link2, Loader2, Mail, RotateCcw, UserPlus, Users, X,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { BotonDeFila, Encabezado, Fila, TablaGrid } from '@/components/TablaGrid'
import PanelDeMiembro from '@/components/PanelDeMiembro'
import { Can } from '@/components/Can'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import useStore from '@/store/useStore'
import {
  getInvitations,
  getTeamMembers,
  inviteMember,
  reenviarInvitacion,
  revokeInvitation,
} from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { fechaCorta } from '@/utils/formato'
import {
  ETIQUETAS_DE_INVITACION,
  ETIQUETAS_DE_MIEMBRO,
  ETIQUETAS_DE_ROL,
  estadoDeInvitacion,
  estadoDeMiembro,
  tonoDeInvitacion,
  tonoDeMiembro,
} from '@/utils/equipo'

// ════════════════════════════════════════════
//  ADMINAPP · /equipo
//
//  ── Lo que esta pantalla dejaba de decir ──
//
//  `toast.success('Invitación enviada')` **incondicional**. La API está bien
//  desde hace meses —`sendEmail` devuelve `{ok:false, enviado:false}` sin
//  RESEND_API_KEY y `POST /:empresaId/invitar` propaga `email_enviado` y un
//  mensaje que dice qué hacer— y la pantalla lo tiraba: leía la respuesta,
//  descartaba los dos campos y afirmaba que el mail salió.
//
//  El agujero no se había cerrado: se había **mudado** de `services/email.js` a
//  acá. Es uno de los tres errores caros que abren `CONVENCIONES.md` —«las
//  invitaciones se perdían en silencio y quien invitaba veía "enviada"»— y el
//  único que estaba corregido de un solo lado.
//
//  Ahora la pantalla lee `email_enviado`, y cuando el mail no salió muestra el
//  **enlace** con un botón de copiar (FR-106): la invitación existe igual y el
//  enlace sirve igual, así que lo único que falta es que alguien lo pase a mano.
//
//  ── Las otras cuatro ──
//
//  · La columna Estado **lee `is_active`**. Estaba clavada en «Activo» para
//    todas las filas: alguien desactivado se veía igual que alguien que entra
//    todos los días (E10, FR-118).
//  · Una invitación **vencida** se distingue de una pendiente. Nada pasa
//    `status` a `expired`, así que una de hace tres meses figuraba «Pendiente» y
//    quien la miraba esperaba a alguien que ya no podía entrar.
//  · El catálogo de roles incluye **`gerente`**, que existía en el servidor y no
//    en la tabla de esta pantalla (E9, FR-117).
//  · Todos los `catch` usan `mensajeDeError`, y el fallo de carga se dibuja en
//    la pantalla. Antes un 403 por falta de `equipo.ver` mostraba «Sin miembros
//    aún»: un equipo vacío, no «no tenés permiso».
//
//  ── Y lo que afirma, que tiene que ser cierto ──
//
//  Que la persona invitada tiene que registrarse **con ese mismo email**.
//  AdminApp no crea nada en Auth0: el usuario se auto-registra y la API lo da de
//  alta desde el JWT (`middleware/auth.js`). Si se registra con otra dirección,
//  el token de la invitación no le va a corresponder y
//  `POST /accept-invite/:token` responde `INVITACION_DE_OTRO_EMAIL` (E14,
//  FR-125).
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * El `grid-template-columns` de la tabla de miembros, escrito UNA vez.
 *
 * El encabezado y las filas comparten este mismo string. Cuando difieren, las
 * etiquetas dejan de estar sobre sus datos y se lee un rol bajo «Estado».
 */
const COLUMNAS_MIEMBROS = 'minmax(0,1.3fr) minmax(0,1.6fr) 150px 130px 56px'

/** Ídem para la tabla de invitaciones. */
const COLUMNAS_INVITACIONES = 'minmax(0,1.8fr) 140px 110px 110px 130px 92px'

/**
 * Los roles que se pueden elegir AL INVITAR.
 *
 * ⚠ **No son los cinco del catálogo, y no es un olvido.** La columna
 * `invitaciones.role` es un `ENUM('admin','vendedor','produccion','compras')`
 * —`models/Invitacion.js`— y no incluye `gerente`: mandar `gerente` no da un 400
 * sino un 500, porque la validación revienta adentro de Sequelize.
 *
 * La tabla de miembros SÍ ofrece los cinco, porque `usuario_empresas.role` es un
 * `STRING(20)` libre. O sea: hoy se puede promover a alguien a gerente pero no
 * invitarlo como gerente. Está reportado y se cierra con una migración del enum
 * — hasta entonces, ofrecerlo acá sería dibujar una opción que rompe.
 *
 * Hay una guardia en `tests/renderDeEquipo.test.jsx` que compara esta lista
 * contra el enum del modelo: el día que la migración entre, se pone en rojo
 * pidiendo que se agregue `gerente`.
 */
const ROLES_PARA_INVITAR = ['admin', 'vendedor', 'produccion', 'compras']

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3'

/**
 * Uno de los estados vacíos de la pantalla.
 *
 * `codigo` queda en el DOM a propósito: cada uno dice algo distinto y esa es la
 * afirmación que hay que poder verificar. «Sos la única persona del equipo» y
 * «no se pudo leer el equipo» se leen igual si el texto es el mismo, y la acción
 * que sugiere cada uno es opuesta.
 */
function EstadoVacio({ codigo, titulo, detalle, icono }) {
  // El componente se pasa a una variable con mayúscula en vez de renombrarlo en
  // la desestructuración: con `icono: Icono`, la única referencia a `Icono`
  // queda adentro del JSX, y esta configuración de eslint no trae
  // `jsx-uses-vars` —no está `eslint-plugin-react`—, así que lo marca como
  // parámetro sin usar. Acá `icono` se usa de verdad y `Icono` cae bajo el
  // `varsIgnorePattern: '^[A-Z_]'` que ya existe.
  const Icono = icono || Users

  return (
    <div data-estado-vacio={codigo} className="px-5 py-12 text-center">
      <Icono className="mx-auto mb-2.5 h-7 w-7 text-fg-3" strokeWidth={1.6} />
      <p className="font-semibold">{titulo}</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-sm text-fg-2">{detalle}</p>
    </div>
  )
}

export default function Team() {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const empresaActiva = useStore((s) => s.empresaActiva)
  const usuario = useStore((s) => s.usuario)

  const [miembros, setMiembros] = useState([])
  const [invitaciones, setInvitaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorDeCarga, setErrorDeCarga] = useState('')

  const [formAbierto, setFormAbierto] = useState(false)
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('vendedor')
  const [invitando, setInvitando] = useState(false)

  /**
   * El resultado de la última invitación, cuando hay algo que hacer con él.
   *
   * No es un toast: un toast se va solo a los cinco segundos y el enlace es
   * justamente lo que hay que copiar y pegar en otra aplicación.
   */
  const [ultimaInvitacion, setUltimaInvitacion] = useState(null)

  const [abierto, setAbierto] = useState(null)

  const puedeEditar = can('equipo.editar')
  const puedeInvitar = can('equipo.invitar')

  const yo = useMemo(() => ({ usuario_id: usuario?.id }), [usuario])

  const cargar = useCallback(async () => {
    if (!empresaActiva?.id) return

    setCargando(true)
    try {
      const [equipo, invites] = await Promise.all([
        getTeamMembers(empresaActiva.id),
        getInvitations(empresaActiva.id),
      ])

      setMiembros(equipo.data?.data || [])
      setInvitaciones(invites.data?.data || [])
      setErrorDeCarga('')
    } catch (err) {
      // ⚠ Esto era un `console.error` mudo. Un 403 por falta de `equipo.ver`
      // dibujaba «Sin miembros aún»: un equipo vacío, que es una afirmación
      // falsa sobre la empresa, en vez de «no tenés permiso para ver esto».
      setMiembros([])
      setInvitaciones([])
      setErrorDeCarga(mensajeDeError(err, 'No se pudo leer el equipo de esta empresa.'))
    } finally {
      setCargando(false)
    }
  }, [empresaActiva?.id])

  useEffect(() => { cargar() }, [cargar])

  const invitar = async () => {
    const destinatario = email.trim()
    if (!destinatario) return

    setInvitando(true)
    try {
      const res = await inviteMember(empresaActiva.id, { email: destinatario, role: rol })

      // ⚠ Acá estaba el agujero: `toast.success('Invitación enviada')` sin
      // mirar nada. Los dos campos vienen desde hace meses y esta pantalla los
      // descartaba.
      const salio = res.data?.email_enviado === true

      setUltimaInvitacion({
        email: destinatario,
        enlace: res.data?.enlace || '',
        salio,
        mensaje: res.data?.message || '',
      })

      if (salio) {
        toast.success(`Invitación enviada a ${destinatario}.`)
      } else {
        toast.warning('La invitación se creó, pero el mail NO salió. Pasale el enlace a mano.')
      }

      setEmail('')
      setRol('vendedor')
      setFormAbierto(false)
      await cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, `No se pudo invitar a ${destinatario}.`))
    } finally {
      setInvitando(false)
    }
  }

  const reenviar = async (invitacion) => {
    try {
      await reenviarInvitacion(invitacion.token)
      toast.success(`Invitación reenviada a ${invitacion.email}.`)
    } catch (err) {
      // El 502 de este endpoint dice que el mail no salió, y ése es el mensaje
      // que hay que mostrar: la invitación sigue viva y el enlace sirve igual.
      toast.error(mensajeDeError(err, `No se pudo reenviar la invitación a ${invitacion.email}.`))
    }
  }

  const revocar = async (invitacion) => {
    const ok = await confirm(
      `¿Revocar la invitación de ${invitacion.email}? El enlace que ya le mandaste ` +
      'deja de funcionar. Podés volver a invitarla cuando quieras.'
    )
    if (!ok) return

    try {
      await revokeInvitation(invitacion.id)
      await cargar()
      toast.success('Invitación revocada.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo revocar la invitación.'))
    }
  }

  const copiarEnlace = async (enlace) => {
    try {
      await navigator.clipboard.writeText(enlace)
      toast.success('Enlace copiado.')
    } catch {
      // Sin permiso de portapapeles —o sin `navigator.clipboard`, que es el caso
      // de cualquier origen sin HTTPS— el enlace igual está a la vista en el
      // campo de al lado, que es lo que hace que esto sea una comodidad y no la
      // única forma de llegar a él.
      toast.error('No se pudo copiar. Seleccioná el enlace y copialo a mano.')
    }
  }

  // El panel abierto se relee de la lista para que un cambio guardado se vea sin
  // cerrarlo: `abierto` guarda el id, no la fila.
  const miembroAbierto = miembros.find((m) => m.id === abierto) || null

  const pendientes = invitaciones.filter(
    (i) => estadoDeInvitacion(i) === 'pendiente' || estadoDeInvitacion(i) === 'vencida'
  )

  return (
    <div className="anim-subida flex flex-col gap-6">
      <PageHeader
        titulo="Equipo"
        descripcion={`Quién tiene acceso a ${empresaActiva?.name || 'esta empresa'}, con qué rol, y qué invitaciones están dando vueltas.`}
        icono={Users}
      >
        <Can
          codigo="equipo.invitar"
          fallback={
            <p className="text-[12.5px] text-fg-3">
              No podés invitar a nadie: te falta el permiso «equipo.invitar».
            </p>
          }
        >
          <button
            type="button"
            className={BOTON_PRINCIPAL}
            onClick={() => setFormAbierto((v) => !v)}
          >
            <UserPlus className="h-4 w-4" />
            Invitar a alguien
          </button>
        </Can>
      </PageHeader>

      {/* ── El fallo de carga, en la pantalla y no en la consola ── */}
      {errorDeCarga && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-5 py-4"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
          <div className="flex-1">
            <p className="text-[13.5px] font-medium">{errorDeCarga}</p>
            <p className="mt-1 text-[13px] text-fg-2">
              Lo que se ve abajo está vacío porque el pedido falló, no porque la empresa no
              tenga a nadie.
            </p>
          </div>
          <button type="button" className={BOTON_SECUNDARIO} onClick={cargar}>
            <RotateCcw className="h-3.5 w-3.5 text-fg-3" />
            Reintentar
          </button>
        </div>
      )}

      {/* ── El formulario de invitación ── */}
      {formAbierto && puedeInvitar && (
        <section className="rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1">
          <h2>Invitar a alguien</h2>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <span className="eyebrow">Email</span>
              <input
                type="email"
                aria-label="Email de la persona a invitar"
                className={CAMPO}
                placeholder="persona@ejemplo.com"
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
              />
            </label>

            <label className="flex w-[180px] flex-col gap-1.5">
              <span className="eyebrow">Rol</span>
              <select
                aria-label="Rol de la invitación"
                className={CAMPO}
                value={rol}
                onChange={(evento) => setRol(evento.target.value)}
              >
                {ROLES_PARA_INVITAR.map((codigo) => (
                  <option key={codigo} value={codigo}>{ETIQUETAS_DE_ROL[codigo]}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={BOTON_PRINCIPAL}
              onClick={invitar}
              disabled={invitando || !email.trim()}
            >
              {invitando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Enviar invitación
            </button>
          </div>

          {/* E14 / FR-125. AdminApp no crea nada en Auth0: quien recibe el enlace
              se registra solo, y la invitación se busca por el email de la
              sesión. Con otra dirección, aceptar responde
              INVITACION_DE_OTRO_EMAIL y la persona no entiende por qué. */}
          <p className="mt-3 max-w-[70ch] text-[12.5px] leading-relaxed text-fg-2">
            La persona tiene que registrarse en AdminApp <strong>con este mismo email</strong>.
            No le creamos la cuenta: el enlace la lleva al registro y la invitación se le asigna
            por su dirección. Si se registra con otra, el enlace no le va a servir.
          </p>
        </section>
      )}

      {/* ── El resultado de la última invitación ──

          Va acá y no en un toast porque el enlace es para copiarlo, y un toast
          se va solo a los cinco segundos. */}
      {ultimaInvitacion && (
        <section
          data-resultado-invitacion={ultimaInvitacion.salio ? 'enviada' : 'sin_enviar'}
          className={`rounded-xl border px-5 py-4 ${
            ultimaInvitacion.salio ? 'border-ok-line bg-ok-soft' : 'border-warn-line bg-warn-soft'
          }`}
        >
          <div className="flex items-start gap-3">
            <Link2 className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${ultimaInvitacion.salio ? 'text-ok' : 'text-warn'}`} />

            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">
                {ultimaInvitacion.salio
                  ? `Le mandamos el mail de invitación a ${ultimaInvitacion.email}.`
                  : `La invitación para ${ultimaInvitacion.email} se creó, pero el mail NO salió.`}
              </p>

              <p className="mt-1 text-[13px] text-fg-2">
                {ultimaInvitacion.salio
                  ? 'Si no le llega —spam, dirección mal escrita— pasale este enlace a mano. Sirve igual.'
                  : (ultimaInvitacion.mensaje ||
                     'Pasale este enlace a mano: la invitación existe y el enlace funciona.')}
              </p>

              {ultimaInvitacion.enlace && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    aria-label="Enlace de invitación"
                    className={`${CAMPO} min-w-[260px] flex-1`}
                    value={ultimaInvitacion.enlace}
                    onFocus={(evento) => evento.target.select()}
                  />
                  <button
                    type="button"
                    className={BOTON_SECUNDARIO}
                    onClick={() => copiarEnlace(ultimaInvitacion.enlace)}
                  >
                    <Copy className="h-3.5 w-3.5 text-fg-3" />
                    Copiar
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setUltimaInvitacion(null)}
              title="Cerrar el aviso"
              className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-lg text-fg-3
                         transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              <X className="h-[15px] w-[15px]" />
            </button>
          </div>
        </section>
      )}

      {/* ── Los miembros ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
          <h2>Miembros</h2>
          <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
            {miembros.length}
          </span>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
        </div>

        {!cargando && miembros.length === 0 ? (
          errorDeCarga ? (
            <EstadoVacio
              codigo="no_se_pudo_leer"
              titulo="No se pudo leer el equipo."
              detalle="El aviso de arriba dice qué pasó. Esta lista está vacía porque el pedido falló, no porque no haya nadie."
              icono={AlertTriangle}
            />
          ) : (
            <EstadoVacio
              codigo="equipo_de_una_persona"
              titulo="Por ahora estás sola o solo en esta empresa."
              detalle="Invitá a alguien con el botón de arriba: le va a llegar un enlace para registrarse y sumarse con el rol que elijas."
            />
          )
        ) : (
          <TablaGrid anchoMinimo={860}>
            <Encabezado columnas={COLUMNAS_MIEMBROS}>
              <span>Nombre</span>
              <span>Email</span>
              <span>Rol</span>
              <span>Estado</span>
              <span />
            </Encabezado>

            {miembros.map((miembro) => {
              const estado = estadoDeMiembro(miembro)
              const persona = miembro.usuario || {}

              return (
                <Fila
                  key={miembro.id}
                  columnas={COLUMNAS_MIEMBROS}
                  className={estado === 'desactivado' ? 'opacity-55' : ''}
                  onClick={() => setAbierto(miembro.id)}
                >
                  <span className="truncate text-[13.5px] font-medium" title={persona.nombre || ''}>
                    {persona.nombre || <span className="text-fg-3">Sin nombre</span>}
                  </span>

                  <span className="truncate text-[13px] text-fg-2" title={persona.email || ''}>
                    {persona.email || '—'}
                  </span>

                  <span className="truncate text-[13px]">
                    {ETIQUETAS_DE_ROL[miembro.role] || miembro.role || '—'}
                  </span>

                  <span>
                    <span
                      data-estado-del-miembro={estado}
                      className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeMiembro(estado)}`}
                    >
                      {ETIQUETAS_DE_MIEMBRO[estado]}
                    </span>
                  </span>

                  <span className="flex justify-end">
                    <BotonDeFila
                      onClick={() => setAbierto(miembro.id)}
                      title={puedeEditar ? 'Ver y editar' : 'Ver el detalle'}
                    >
                      <Users />
                    </BotonDeFila>
                  </span>
                </Fila>
              )
            })}
          </TablaGrid>
        )}
      </section>

      {/* ── Las invitaciones que están dando vueltas ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4">
          <h2>Invitaciones</h2>
          <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
            {pendientes.length}
          </span>
        </div>

        {pendientes.length === 0 ? (
          <EstadoVacio
            codigo="sin_invitaciones"
            titulo="No hay ninguna invitación esperando."
            detalle="Acá aparecen las que mandaste y todavía nadie aceptó, con la fecha en que vencen."
            icono={Mail}
          />
        ) : (
          <TablaGrid anchoMinimo={900}>
            <Encabezado columnas={COLUMNAS_INVITACIONES}>
              <span>Email</span>
              <span>Rol</span>
              <span>Enviada</span>
              <span>Vence</span>
              <span>Estado</span>
              <span />
            </Encabezado>

            {pendientes.map((invitacion) => {
              const estado = estadoDeInvitacion(invitacion)

              return (
                <Fila
                  key={invitacion.id}
                  columnas={COLUMNAS_INVITACIONES}
                  className="cursor-default"
                >
                  <span className="truncate text-[13.5px] font-medium" title={invitacion.email}>
                    {invitacion.email}
                  </span>

                  <span className="truncate text-[13px]">
                    {ETIQUETAS_DE_ROL[invitacion.role] || invitacion.role}
                  </span>

                  <span className="num text-[13px] text-fg-2">
                    {fechaCorta(invitacion.createdAt)}
                  </span>

                  <span className="num text-[13px] text-fg-2">
                    {fechaCorta(invitacion.expires_at)}
                  </span>

                  <span>
                    <span
                      data-estado-de-invitacion={estado}
                      className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${tonoDeInvitacion(estado)}`}
                    >
                      {ETIQUETAS_DE_INVITACION[estado]}
                    </span>
                  </span>

                  <span className="flex justify-end gap-1">
                    <BotonDeFila
                      onClick={() => reenviar(invitacion)}
                      disabled={!puedeInvitar}
                      title={
                        puedeInvitar
                          ? 'Volver a mandarle el mail'
                          : 'Necesitás el permiso «equipo.invitar»'
                      }
                    >
                      <RotateCcw />
                    </BotonDeFila>

                    <BotonDeFila
                      onClick={() => revocar(invitacion)}
                      disabled={!can('equipo.eliminar')}
                      title={
                        can('equipo.eliminar')
                          ? 'Revocar la invitación'
                          : 'Necesitás el permiso «equipo.eliminar»'
                      }
                    >
                      <X />
                    </BotonDeFila>
                  </span>
                </Fila>
              )
            })}
          </TablaGrid>
        )}
      </section>

      <PanelDeMiembro
        miembro={miembroAbierto}
        miembros={miembros}
        yo={yo}
        abierto={Boolean(abierto)}
        onOpenChange={(estaAbierto) => { if (!estaAbierto) setAbierto(null) }}
        puedeEditar={puedeEditar}
        onCambio={cargar}
      />

      <ConfirmDialog />
    </div>
  )
}
