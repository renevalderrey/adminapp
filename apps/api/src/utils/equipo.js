// ════════════════════════════════════════════
//  FAVALIO · Las reglas del equipo
//
//  Dos preguntas que hasta la 014 no contestaba nadie, y una tabla de nombres
//  que estaba escrita a mano y le faltaba un rol.
//
//  ── Por qué existe este archivo ──
//
//  `PUT /api/empresas/usuarios/:id` cambiaba el rol de cualquier miembro sin
//  mirar nada: se podia degradar al UNICO administrador activo de la empresa y
//  quedarse sin nadie que pueda invitar, cambiar roles ni tocar la
//  configuracion. De eso no se sale desde la aplicacion — hay que escribir en la
//  base—. Y uno podia cambiarse el rol a si mismo, que es la misma puerta con un
//  paso menos.
//
//  La pantalla tambien las necesita, y por eso son funciones puras: un `Select`
//  que se dibuja habilitado y siempre falla es el defecto que este hito viene a
//  sacar de otras pantallas. La regla vive en un solo lugar y la usan los dos
//  lados — el servidor para decidir, la pantalla para explicar.
//
//  ── ⚠ Este archivo tiene un ESPEJO ──
//
//  `apps/web/src/utils/equipo.js` es la misma funcion, escrita como modulo ES.
//  Son dos copias a proposito: el monorepo no tiene paquete compartido entre
//  `apps/api` y `apps/web`, y el precedente del repositorio es el espejo con su
//  comentario y su test de los dos lados (`utils/stockBajo.js`).
//
//  **Lo que impide que deriven** es la guardia de espejo de
//  `src/tests/sesionesYEquipo.test.js`, que compara las claves de
//  `ETIQUETAS_DE_ROL` y los textos de `MOTIVOS` en los dos archivos. Sin ella,
//  agregar un rol de un solo lado deja la pantalla sin la opcion y nadie se
//  entera: es exactamente lo que paso con `gerente`, que estaba en el catalogo
//  del servidor desde siempre y **no** en la tabla de `Team.jsx`.
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
const ETIQUETAS_DE_ROL = {
  admin: 'Administrador',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
  produccion: 'Producción',
  compras: 'Compras',
};

/** Los codigos de rol que la columna `usuario_empresas.role` acepta. */
const ROLES_VALIDOS = Object.keys(ETIQUETAS_DE_ROL);

/**
 * Los motivos, escritos una sola vez.
 *
 * Son texto para el usuario y no codigos: los codigos van aparte, en `codigo`,
 * porque la pantalla necesita mostrar el texto y el servidor necesita responder
 * algo que no haya que parsear en castellano. Es la misma separacion que
 * `utils/erroresDeApi.js` documenta del otro lado.
 */
const MOTIVOS = {
  NO_TE_PODES_TOCAR:
    'No podés cambiar tu propio rol ni desactivarte. Pedíselo a otra persona ' +
    'con permiso sobre el equipo: así nadie se saca a sí mismo por accidente.',
  ULTIMO_ADMIN:
    'Es el único administrador activo de la empresa. Si le cambiás el rol o lo ' +
    'desactivás, nadie va a poder invitar, cambiar roles ni tocar la ' +
    'configuración. Nombrá a otro administrador antes.',
  MIEMBRO_DESCONOCIDO:
    'No se pudo identificar a qué miembro corresponde el cambio.',
};

/**
 * Si esta fila es un administrador que hoy tiene acceso.
 *
 * `is_active !== false` y no `is_active === true`: una fila que no trae la
 * columna —una respuesta vieja, un doble incompleto— se cuenta como activa. Es
 * la direccion segura: contarla de menos haria creer que no queda ningun admin y
 * bloquearia un cambio legitimo; contarla de mas, como mucho, deja pasar un
 * cambio que el servidor vuelve a verificar contra la base.
 */
function esAdminActivo(miembro) {
  return Boolean(miembro) && miembro.role === 'admin' && miembro.is_active !== false;
}

/** El identificador de una fila de `usuario_empresas`. */
function idDe(miembro) {
  return miembro && miembro.id !== undefined && miembro.id !== null ? String(miembro.id) : null;
}

/**
 * Si sacar a este miembro dejaria la empresa sin ningun administrador activo.
 *
 * @param {{id?: number|string, role?: string, is_active?: boolean}} miembro
 * @param {Array<object>} miembros Todas las filas de `usuario_empresas` de la
 *   empresa. Puede no incluir a `miembro`: se cuenta por id.
 * @returns {boolean}
 */
function esUltimoAdmin(miembro, miembros) {
  if (!esAdminActivo(miembro)) return false;

  const lista = Array.isArray(miembros) ? miembros : [];
  const propio = idDe(miembro);

  const otrosAdmins = lista.filter(
    (otro) => esAdminActivo(otro) && idDe(otro) !== propio
  );

  return otrosAdmins.length === 0;
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
function puedeCambiarRol({ miembro, yo, miembros } = {}) {
  if (!miembro) {
    return { puede: false, motivo: MOTIVOS.MIEMBRO_DESCONOCIDO, codigo: 'MIEMBRO_DESCONOCIDO' };
  }

  // La comparacion es por `usuario_id` y no por el id de la fila: una persona
  // tiene una fila por empresa, y lo que hay que impedir es que se toque a SI
  // MISMA. Comparar ids de fila dejaria pasar el caso el dia que la pantalla
  // muestre miembros de mas de una empresa.
  const miUsuario = yo && yo.usuario_id !== undefined && yo.usuario_id !== null
    ? String(yo.usuario_id)
    : null;
  const suUsuario = miembro.usuario_id !== undefined && miembro.usuario_id !== null
    ? String(miembro.usuario_id)
    : null;

  if (miUsuario !== null && miUsuario === suUsuario) {
    return { puede: false, motivo: MOTIVOS.NO_TE_PODES_TOCAR, codigo: 'NO_TE_PODES_TOCAR' };
  }

  if (esUltimoAdmin(miembro, miembros)) {
    return { puede: false, motivo: MOTIVOS.ULTIMO_ADMIN, codigo: 'ULTIMO_ADMIN' };
  }

  return { puede: true, motivo: '', codigo: null };
}

/** Si el codigo de rol existe en el catalogo. */
function esRolValido(role) {
  return typeof role === 'string' && ROLES_VALIDOS.includes(role);
}

module.exports = {
  ETIQUETAS_DE_ROL,
  ROLES_VALIDOS,
  MOTIVOS,
  esAdminActivo,
  esUltimoAdmin,
  puedeCambiarRol,
  esRolValido,
};
