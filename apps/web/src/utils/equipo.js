// ════════════════════════════════════════════
//  FAVALIO · Las reglas del equipo, del lado del navegador
//
//  ⚠ **Este archivo es el ESPEJO de `apps/api/src/utils/equipo.js`.** Son dos
//  copias a proposito: el monorepo no tiene paquete compartido entre `apps/api`
//  y `apps/web`, y el precedente del repositorio es el espejo con su comentario
//  y su test de los dos lados (`utils/stockBajo.js`).
//
//  Lo que impide que deriven es la guardia de espejo de
//  `apps/api/src/tests/sesionesYEquipo.test.js`, que compara las claves de
//  `ETIQUETAS_DE_ROL` y los textos de `MOTIVOS` en los dos archivos. Sin ella,
//  agregar un rol de un solo lado deja la pantalla sin la opcion y nadie se
//  entera: es exactamente lo que paso con `gerente`, que estaba en el catalogo
//  del servidor desde siempre y **no** en la tabla de `Team.jsx`.
//
//  ── Por que la pantalla necesita la regla y no le alcanza con el 400 ──
//
//  Porque un `Select` que se dibuja habilitado y siempre falla es el defecto que
//  este hito viene a sacar de otras pantallas: el usuario elige, espera, y recibe
//  un error que no explica que la opcion nunca fue posible. La regla del
//  repositorio es **deshabilitado con su explicacion, no ausente** — y la
//  explicacion es `motivo`.
//
//  El servidor la vuelve a aplicar igual: la pantalla es la explicacion, no la
//  garantia. Un `PUT` a mano dejaria la empresa sin admin, y de eso solo se sale
//  escribiendo en la base.
// ════════════════════════════════════════════

/**
 * Los cinco roles del sistema, con el nombre que ve el usuario.
 *
 * Son los mismos cinco que siembra `seedPermissions.js` en `rolesData`, y hay
 * una guardia que lo verifica: un sexto rol sembrado y no listado aca seria un
 * rol que nadie puede elegir desde la pantalla.
 *
 * ⚠ `gerente` estaba en el catalogo del servidor y **faltaba** en la tabla de
 * `Team.jsx`: una empresa con un gerente veia su fila con el `Select` en blanco,
 * y elegir cualquier otro rol lo degradaba sin poder volver.
 */
export const ETIQUETAS_DE_ROL = {
  admin: 'Administrador',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
  produccion: 'Producción',
  compras: 'Compras',
}

/** Los codigos de rol que la columna `usuario_empresas.role` acepta. */
export const ROLES_VALIDOS = Object.keys(ETIQUETAS_DE_ROL)

/**
 * Los motivos, escritos una sola vez.
 *
 * Son texto para el usuario y no codigos: los codigos van aparte, en `codigo`,
 * porque la pantalla necesita mostrar el texto y el servidor necesita responder
 * algo que no haya que parsear en castellano. Es la misma separacion que
 * `utils/erroresDeApi.js` documenta.
 */
export const MOTIVOS = {
  NO_TE_PODES_TOCAR:
    'No podés cambiar tu propio rol ni desactivarte. Pedíselo a otra persona ' +
    'con permiso sobre el equipo: así nadie se saca a sí mismo por accidente.',
  ULTIMO_ADMIN:
    'Es el único administrador activo de la empresa. Si le cambiás el rol o lo ' +
    'desactivás, nadie va a poder invitar, cambiar roles ni tocar la ' +
    'configuración. Nombrá a otro administrador antes.',
  MIEMBRO_DESCONOCIDO:
    'No se pudo identificar a qué miembro corresponde el cambio.',
}

/**
 * Si esta fila es un administrador que hoy tiene acceso.
 *
 * `is_active !== false` y no `is_active === true`: una fila que no trae la
 * columna —una respuesta vieja, un doble incompleto— se cuenta como activa. Es
 * la direccion segura: contarla de menos haria creer que no queda ningun admin y
 * bloquearia un cambio legitimo; contarla de mas, como mucho, deja pasar un
 * cambio que el servidor vuelve a verificar contra la base.
 */
export function esAdminActivo(miembro) {
  return Boolean(miembro) && miembro.role === 'admin' && miembro.is_active !== false
}

/** El identificador de una fila de `usuario_empresas`. */
function idDe(miembro) {
  return miembro && miembro.id !== undefined && miembro.id !== null ? String(miembro.id) : null
}

/**
 * Si sacar a este miembro dejaria la empresa sin ningun administrador activo.
 *
 * @param {{id?: number|string, role?: string, is_active?: boolean}} miembro
 * @param {Array<object>} miembros Todas las filas de `usuario_empresas` de la
 *   empresa. Puede no incluir a `miembro`: se cuenta por id.
 * @returns {boolean}
 */
export function esUltimoAdmin(miembro, miembros) {
  if (!esAdminActivo(miembro)) return false

  const lista = Array.isArray(miembros) ? miembros : []
  const propio = idDe(miembro)

  const otrosAdmins = lista.filter(
    (otro) => esAdminActivo(otro) && idDe(otro) !== propio
  )

  return otrosAdmins.length === 0
}

/**
 * Si se le puede cambiar el rol —o el estado— a este miembro.
 *
 * **Nunca devuelve `undefined`**, ni en `puede` ni en `motivo` ni en `codigo`:
 * la pantalla escribe el motivo al lado del `Select` deshabilitado, y un
 * `undefined` ahi es un campo apagado sin explicacion, que se lee como un error
 * de la aplicacion.
 *
 * @param {object} args
 * @param {object} args.miembro La fila que se quiere cambiar.
 * @param {{usuario_id?: number|string}} args.yo Quien pide el cambio.
 * @param {Array<object>} args.miembros Todo el equipo de la empresa.
 * @returns {{puede: boolean, motivo: string, codigo: string|null}}
 */
export function puedeCambiarRol({ miembro, yo, miembros } = {}) {
  if (!miembro) {
    return { puede: false, motivo: MOTIVOS.MIEMBRO_DESCONOCIDO, codigo: 'MIEMBRO_DESCONOCIDO' }
  }

  // La comparacion es por `usuario_id` y no por el id de la fila: una persona
  // tiene una fila por empresa, y lo que hay que impedir es que se toque a SI
  // MISMA. Comparar ids de fila dejaria pasar el caso el dia que la pantalla
  // muestre miembros de mas de una empresa.
  const miUsuario = yo && yo.usuario_id !== undefined && yo.usuario_id !== null
    ? String(yo.usuario_id)
    : null
  const suUsuario = miembro.usuario_id !== undefined && miembro.usuario_id !== null
    ? String(miembro.usuario_id)
    : null

  if (miUsuario !== null && miUsuario === suUsuario) {
    return { puede: false, motivo: MOTIVOS.NO_TE_PODES_TOCAR, codigo: 'NO_TE_PODES_TOCAR' }
  }

  if (esUltimoAdmin(miembro, miembros)) {
    return { puede: false, motivo: MOTIVOS.ULTIMO_ADMIN, codigo: 'ULTIMO_ADMIN' }
  }

  return { puede: true, motivo: '', codigo: null }
}

/** Si el codigo de rol existe en el catalogo. */
export function esRolValido(role) {
  return typeof role === 'string' && ROLES_VALIDOS.includes(role)
}

// ════════════════════════════════════════════
//  Lo que sigue NO está en el espejo del servidor, y es a propósito
//
//  La guardia de espejo compara `ETIQUETAS_DE_ROL` y `MOTIVOS` — lo que los dos
//  lados necesitan decir igual—. De acá para abajo es **dibujo**: qué etiqueta y
//  qué tono lleva el badge de una fila. El servidor no dibuja badges, y meter
//  esto en su archivo sería pedirle que mantenga una tabla de colores.
//
//  Son funciones puras y viven en `utils/` por lo de siempre: un test de render
//  que verifica de qué color va un badge es diez veces más lento y se rompe
//  cuando alguien mueve un `<div>`.
// ════════════════════════════════════════════

/** Los dos estados de un miembro del equipo. */
export const ETIQUETAS_DE_MIEMBRO = {
  activo: 'Activo',
  desactivado: 'Desactivado',
}

const TONOS_DE_MIEMBRO = {
  activo: 'border-ok-line bg-ok-soft text-ok',
  // Neutro y no rojo: alguien desactivado no es una alarma, es un estado. El
  // rojo de esta pantalla queda para lo que hay que arreglar.
  desactivado: 'border-border bg-surface-3 text-fg-2',
}

/**
 * Si este miembro tiene acceso hoy.
 *
 * ⚠ Hasta la 014 la columna Estado de `Team.jsx` estaba **clavada en «Activo»**
 * para todas las filas: se dibujaba un badge verde con un tilde sin mirar el
 * dato. Alguien desactivado —que la API ya rechaza en el request siguiente— se
 * veía exactamente igual que alguien que entra todos los días.
 */
export function estadoDeMiembro(miembro) {
  return miembro && miembro.is_active === false ? 'desactivado' : 'activo'
}

/** Las tres clases del badge de un miembro, en un solo string. */
export function tonoDeMiembro(estado) {
  return TONOS_DE_MIEMBRO[estado] || TONOS_DE_MIEMBRO.desactivado
}

/** Los cuatro estados que puede tener una invitación en la pantalla. */
export const ETIQUETAS_DE_INVITACION = {
  pendiente: 'Pendiente',
  vencida: 'Vencida',
  aceptada: 'Aceptada',
  revocada: 'Revocada',
}

const TONOS_DE_INVITACION = {
  // Amarillo: hay algo esperando y alguien tiene que hacer algo.
  pendiente: 'border-warn-line bg-warn-soft text-warn',
  // Vencida SÍ es roja: el enlace ya no sirve y hay que volver a invitar. Es la
  // diferencia que FR-118 pide poder ver.
  vencida: 'border-danger-line bg-danger-soft text-danger',
  aceptada: 'border-ok-line bg-ok-soft text-ok',
  revocada: 'border-border bg-surface-3 text-fg-2',
}

/**
 * En qué estado está esta invitación, mirando su `status` **y su fecha**.
 *
 * ⚠ Las dos cosas, y ese es el punto. La columna `status` se queda en `pending`
 * para siempre: nada la pasa a `expired`, ni un cron ni el propio endpoint —
 * `GET /api/auth/invite/:token` simplemente no la devuelve—. Una invitación de
 * hace tres meses figuraba «Pendiente» en la pantalla y quien la miraba esperaba
 * a alguien que ya no podía entrar aunque quisiera.
 *
 * @param {{status?: string, expires_at?: string}} invitacion
 * @param {Date} [ahora] Inyectable para poder testear el corte sin esperar.
 */
export function estadoDeInvitacion(invitacion, ahora = new Date()) {
  if (!invitacion) return 'revocada'

  if (invitacion.status === 'accepted') return 'aceptada'
  if (invitacion.status === 'revoked') return 'revocada'
  if (invitacion.status === 'expired') return 'vencida'

  const vence = invitacion.expires_at ? new Date(invitacion.expires_at) : null

  // `Number.isNaN(vence)` cubre la fecha ilegible: sin fecha utilizable no se
  // puede afirmar que venció, y decirlo sin saberlo mandaría a reinvitar a
  // alguien cuyo enlace todavía sirve.
  if (vence && !Number.isNaN(vence.getTime()) && vence.getTime() <= ahora.getTime()) {
    return 'vencida'
  }

  return 'pendiente'
}

/** Las tres clases del badge de una invitación, en un solo string. */
export function tonoDeInvitacion(estado) {
  return TONOS_DE_INVITACION[estado] || TONOS_DE_INVITACION.revocada
}
