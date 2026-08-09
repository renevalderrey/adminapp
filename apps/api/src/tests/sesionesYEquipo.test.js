const fs = require('fs');
const path = require('path');

const {
  ETIQUETAS_DE_ROL,
  MOTIVOS,
  ROLES_VALIDOS,
  esRolValido,
  esUltimoAdmin,
  puedeCambiarRol,
} = require('../utils/equipo');

// ════════════════════════════════════════════
//  FAVALIO · Las reglas del equipo
//
//  Las dos que hasta la 014 no aplicaba nadie —«no te podés tocar a vos mismo» y
//  «el último administrador activo no se degrada»— más la tabla de nombres de
//  rol, que estaba escrita a mano en `Team.jsx` y **le faltaba `gerente`**.
//
//  ── Por qué son funciones puras y no un `if` adentro del handler ──
//
//  Porque las necesitan los dos lados. El servidor, para decidir; la pantalla,
//  para deshabilitar el `Select` **con su explicación** en vez de dibujarlo
//  habilitado y que siempre falle. Escritas dos veces derivan; escritas una vez
//  y espejadas, hay una guardia que lo verifica — y está más abajo.
//
//  ── El caso que las dos reglas evitan ──
//
//  Una empresa con un solo administrador. Ese administrador se cambia el rol a
//  «vendedor» —o alguien se lo cambia— y a partir de ahí **nadie** puede
//  invitar, cambiar roles ni tocar la configuración: los tres permisos cuelgan
//  de `admin`. De eso no se sale desde la aplicación; hay que escribir en la
//  base.
// ════════════════════════════════════════════

/** El único admin activo de la empresa. */
const ADMIN = { id: 1, usuario_id: 10, role: 'admin', is_active: true };

/** Un segundo admin, para que degradar al primero deje de ser el último. */
const OTRO_ADMIN = { id: 2, usuario_id: 20, role: 'admin', is_active: true };

/** Un admin DESACTIVADO: no cuenta, y es la mitad del defecto. */
const ADMIN_DESACTIVADO = { id: 3, usuario_id: 30, role: 'admin', is_active: false };

const VENDEDOR = { id: 4, usuario_id: 40, role: 'vendedor', is_active: true };

describe('esUltimoAdmin · quién no se puede degradar', () => {
  it('el único admin activo de la empresa ES el último', () => {
    expect(esUltimoAdmin(ADMIN, [ADMIN, VENDEDOR])).toBe(true);
  });

  it('con un segundo admin activo ya no lo es', () => {
    // Es el caso que hace verificable la regla: sin él, «devuelve true siempre»
    // pasaría igual.
    expect(esUltimoAdmin(ADMIN, [ADMIN, OTRO_ADMIN, VENDEDOR])).toBe(false);
  });

  it('un admin DESACTIVADO no cuenta como el segundo', () => {
    // El defecto que esto evita: la empresa tiene dos filas con rol `admin`,
    // así que un chequeo por `role` a secas dejaría degradar al único que
    // todavía puede entrar. `is_active: false` ya no tiene acceso —
    // `loadEmpresaContext` relee la membresía en cada request y responde 403.
    expect(esUltimoAdmin(ADMIN, [ADMIN, ADMIN_DESACTIVADO])).toBe(true);
  });

  it('quien no es admin nunca es el último admin, ni en una empresa sin ninguno', () => {
    expect(esUltimoAdmin(VENDEDOR, [VENDEDOR])).toBe(false);
    expect(esUltimoAdmin(ADMIN_DESACTIVADO, [ADMIN_DESACTIVADO])).toBe(false);
  });

  it('una lista que no lo incluye lo trata igual: se cuenta por id, no por presencia', () => {
    // Una lista incompleta —una página, una respuesta recortada— no puede
    // convertir «es el último» en «hay otro». Falla cerrado.
    expect(esUltimoAdmin(ADMIN, [VENDEDOR])).toBe(true);
    expect(esUltimoAdmin(ADMIN, [])).toBe(true);
    expect(esUltimoAdmin(ADMIN, undefined)).toBe(true);
  });
});

describe('puedeCambiarRol · las dos reglas, con su motivo', () => {
  it('el último admin activo NO se puede degradar, y el motivo lo dice', () => {
    const r = puedeCambiarRol({ miembro: ADMIN, yo: { usuario_id: 20 }, miembros: [ADMIN, VENDEDOR] });

    expect(r.puede).toBe(false);
    expect(r.codigo).toBe('ULTIMO_ADMIN');
    // El motivo tiene que decir qué se pierde y qué hacer antes, no «no se
    // puede»: es lo único que la persona del otro lado va a leer.
    expect(r.motivo).toContain('único administrador activo');
    expect(r.motivo).toContain('Nombrá a otro administrador');
  });

  it('uno NO se puede cambiar el rol a sí mismo', () => {
    // `yo.usuario_id` es el de la sesión y `miembro.usuario_id` el de la fila:
    // se comparan las personas, no las filas.
    const r = puedeCambiarRol({
      miembro: OTRO_ADMIN,
      yo: { usuario_id: 20 },
      miembros: [ADMIN, OTRO_ADMIN],
    });

    expect(r.puede).toBe(false);
    expect(r.codigo).toBe('NO_TE_PODES_TOCAR');
    expect(r.motivo).toContain('tu propio rol');
  });

  it('a otro miembro, con otro admin en la empresa, SÍ', () => {
    // Sin este caso la función podría devolver `false` siempre y los dos de
    // arriba pasarían igual.
    const r = puedeCambiarRol({
      miembro: VENDEDOR,
      yo: { usuario_id: 10 },
      miembros: [ADMIN, VENDEDOR],
    });

    expect(r).toEqual({ puede: true, motivo: '', codigo: null });
  });

  it('«soy yo» pesa más que «soy el último admin», porque se arregla distinto', () => {
    // El único admin mirando su propia fila cae en los dos casos. Se responde
    // el propio: «pedíselo a otra persona» es accionable, y «nombrá a otro
    // administrador antes» le pediría hacer justamente lo que no puede hacer
    // sobre sí mismo.
    const r = puedeCambiarRol({ miembro: ADMIN, yo: { usuario_id: 10 }, miembros: [ADMIN] });

    expect(r.codigo).toBe('NO_TE_PODES_TOCAR');
  });

  it('NUNCA devuelve undefined, ni sin miembro ni sin argumentos', () => {
    // La pantalla escribe `motivo` al lado del `Select` deshabilitado: un
    // `undefined` ahí es un campo apagado sin explicación.
    for (const r of [puedeCambiarRol(), puedeCambiarRol({ miembro: null, yo: null, miembros: null })]) {
      expect(r.puede).toBe(false);
      expect(typeof r.motivo).toBe('string');
      expect(r.motivo.length).toBeGreaterThan(20);
      expect(r.codigo).toBe('MIEMBRO_DESCONOCIDO');
    }
  });

  it('sin saber quién pide el cambio, la regla del propio rol no dispara', () => {
    // `yo` sin resolver no puede coincidir con nadie: si coincidiera, un
    // contexto a medias bloquearía todos los cambios de la pantalla.
    const r = puedeCambiarRol({ miembro: VENDEDOR, yo: null, miembros: [ADMIN, VENDEDOR] });

    expect(r.puede).toBe(true);
  });
});

describe('el catálogo de roles', () => {
  it('tiene los CINCO, con gerente incluido', () => {
    // `gerente` es el que faltaba en `Team.jsx`: la empresa que tenía uno veía
    // su fila con el selector en blanco, y elegir cualquier opción lo degradaba
    // sin poder volver.
    expect(Object.keys(ETIQUETAS_DE_ROL).sort()).toEqual(
      ['admin', 'compras', 'gerente', 'produccion', 'vendedor']
    );
    expect(ETIQUETAS_DE_ROL.gerente).toBe('Gerente');
  });

  it('son exactamente los cinco que siembra seedPermissions.js', () => {
    // El ancla contra el catálogo real. Un sexto rol sembrado y no listado acá
    // sería un rol que nadie puede elegir desde la pantalla, y uno listado acá
    // y no sembrado sería una opción que crea un miembro con cero permisos.
    const seed = fs.readFileSync(path.join(__dirname, '..', 'seedPermissions.js'), 'utf8');

    const inicio = seed.indexOf('const rolesData = [');
    expect(inicio).toBeGreaterThan(-1);

    const bloque = seed.slice(inicio, seed.indexOf('];', inicio));
    const sembrados = [...bloque.matchAll(/nombre:\s*'([^']+)'/g)].map((m) => m[1]).sort();

    expect(sembrados).toEqual(ROLES_VALIDOS.slice().sort());
  });

  it('esRolValido rechaza lo que no está en el catálogo', () => {
    // La columna `usuario_empresas.role` es un STRING(20) libre: un rol mal
    // escrito no falla, crea un miembro con cero permisos y nadie se entera
    // hasta que esa persona no puede hacer nada.
    expect(esRolValido('gerente')).toBe(true);
    expect(esRolValido('Admin')).toBe(false);
    expect(esRolValido('superadmin')).toBe(false);
    expect(esRolValido('')).toBe(false);
    expect(esRolValido(undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════
//  La guardia de espejo
//
//  `apps/api/src/utils/equipo.js` y `apps/web/src/utils/equipo.js` son la misma
//  regla escrita dos veces, porque el monorepo no tiene paquete compartido. Dos
//  copias sin nada que las ate derivan, y la forma en que derivan ya pasó: el
//  catálogo del servidor tenía `gerente` y la tabla de `Team.jsx` no.
//
//  ── Sobre pasar en vacío ──
//
//  El extractor se ejercita primero contra el archivo de este lado, cuyo objeto
//  real está a mano: si el parser se rompiera —o si alguien cambiara la forma
//  del literal— devolvería `{}` para los dos archivos y la comparación pasaría
//  comparando dos listas vacías. Por eso el primer caso es la igualdad contra el
//  módulo requerido, y recién después viene la comparación entre lados.
// ════════════════════════════════════════════

const ESPEJO_WEB = path.join(__dirname, '..', '..', '..', 'web', 'src', 'utils', 'equipo.js');

/** El texto del literal de objeto `nombre = { … }`, con sus llaves. */
function bloqueDeObjeto(texto, nombre) {
  const inicio = texto.indexOf(`${nombre} = {`);
  if (inicio === -1) return '';

  const abre = texto.indexOf('{', inicio);
  let nivel = 0;

  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}') {
      nivel--;
      if (nivel === 0) return texto.slice(abre, i + 1);
    }
  }

  return '';
}

/**
 * Las entradas `clave: 'texto'` de un literal de objeto.
 *
 * Las concatenaciones de varias líneas —`'a' +\n  'b'`— se unen antes de leer:
 * los motivos están escritos así porque son párrafos, y sin unirlos el
 * extractor leería solo el primer pedazo de cada uno y dos motivos que difieren
 * en la segunda línea se verían iguales.
 */
function entradasDe(texto, nombre) {
  const unido = bloqueDeObjeto(texto, nombre).replace(/'\s*\+\s*'/g, '');
  const salida = {};

  for (const m of unido.matchAll(/([A-Za-z_][\w]*):\s*'([^']*)'/g)) salida[m[1]] = m[2];

  return salida;
}

describe('los dos espejos de utils/equipo.js dicen lo mismo', () => {
  const aqui = fs.readFileSync(path.join(__dirname, '..', 'utils', 'equipo.js'), 'utf8');

  it('el extractor lee de verdad: contra este lado da el objeto real', () => {
    expect(entradasDe(aqui, 'ETIQUETAS_DE_ROL')).toEqual(ETIQUETAS_DE_ROL);
    expect(entradasDe(aqui, 'MOTIVOS')).toEqual(MOTIVOS);
  });

  it('el archivo espejo existe y no está vacío', () => {
    // Sin esto, borrarlo dejaría las dos comparaciones de abajo comparando
    // objetos vacíos contra objetos vacíos.
    expect(fs.existsSync(ESPEJO_WEB)).toBe(true);
    expect(fs.readFileSync(ESPEJO_WEB, 'utf8').length).toBeGreaterThan(1000);
  });

  it('declara los mismos cinco roles, con las mismas etiquetas', () => {
    const alla = entradasDe(fs.readFileSync(ESPEJO_WEB, 'utf8'), 'ETIQUETAS_DE_ROL');

    expect(alla).toEqual(ETIQUETAS_DE_ROL);
  });

  it('declara los mismos motivos, palabra por palabra', () => {
    // Palabra por palabra y no «las mismas claves»: el motivo es lo que lee la
    // persona, y dos textos distintos para la misma negación —uno en el toast
    // del servidor y otro al lado del selector— es la pantalla contradiciéndose
    // a sí misma.
    const alla = entradasDe(fs.readFileSync(ESPEJO_WEB, 'utf8'), 'MOTIVOS');

    expect(alla).toEqual(MOTIVOS);
  });
});
