// ════════════════════════════════════════════
//  Guardia estática · toda ruta autenticada declara el permiso que exige
//
//  ── Por qué es estática, y por qué eso NO es pereza ──
//
//  `src/tests/setup.js:13` pone `process.env.BYPASS_AUTH = 'true'`, y
//  `src/middleware/checkPermission.js:5-11` devuelve `next()` **de entrada**
//  con esa variable encendida. La consecuencia es que, dentro de la suite de
//  jest, un endpoint con `checkPermission('proveedores.ver')` y el mismo
//  endpoint sin nada se comportan EXACTAMENTE igual. No es que falte un caso de
//  prueba: **ningún test de ejecución de esta suite puede distinguir un
//  endpoint con permiso de uno sin permiso.** La suite entera es ciega a esto.
//
//  Medido sobre el hito 6 de la funcionalidad 012: sacando
//  `checkPermission('proveedores.ver')` de
//  `router.get('/:id/movimientos/export')` en `routes/suppliers.js`, corrían los
//  479 tests de la API y los 479 quedaban en verde. FR-102 dice «la exportación
//  DEBE exigir `proveedores.ver`» y no había una sola línea del repositorio que
//  lo sostuviera — ni para esa ruta, ni para las otras ~130.
//
//  Por eso esto se lee del **texto** del código: es el único nivel en el que la
//  afirmación se puede hacer mientras el bypass exista. El día que `setup.js`
//  deje de encenderlo, y haya forma de fabricar un usuario con un juego de
//  permisos concreto, esta guardia se **reemplaza** por tests que llamen al
//  endpoint sin el permiso y esperen un 403. Hay una prueba al final de este
//  archivo que se pone en rojo ese día, justamente para avisarlo.
//
//  ── Las dos formas en que una guardia así deja de servir ──
//
//  1. **Pasar por vacío.** Si mañana cambia la forma de declarar rutas y el
//     detector deja de encontrarlas, recorre una lista vacía y queda en verde
//     sin haber mirado nada. Este repositorio ya tuvo dos guardias así. Contra
//     eso: se afirma qué archivos leyó, que **cada uno** aporte al menos una
//     ruta, cuántas rutas encontró en total, y se corre el detector contra dos
//     muestras sintéticas —una con el defecto y otra sin él— exigiendo que
//     nombre la primera con archivo y línea y que no marque la segunda.
//
//  2. **Ser una lista que hay que mantener a mano.** Un mapa ruta→permiso
//     escrito a dedo no va a incluir la ruta que alguien escriba mañana, y nadie
//     se va a enterar. Por eso lo que se afirma es una **regla** —toda ruta
//     montada detrás de una cadena autenticada declara un `checkPermission`— y
//     lo único escrito a mano es la lista corta de excepciones, cada una con su
//     motivo. La única tabla ruta→permiso de este archivo es la de
//     `routes/suppliers.js`, el archivo del hito, y está atada por igualdad
//     exacta: una ruta nueva ahí **obliga** a agregarle su fila.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const DIR_RUTAS = path.join(SRC, 'routes');
const SERVER = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');

// ════════════════════════════════════════════
//  Las excepciones, cada una con su motivo
// ════════════════════════════════════════════

/**
 * Routers que se montan SIN cadena de autenticación, a propósito.
 *
 * La clave es `archivo variable`. Se afirma por igualdad exacta más abajo: un
 * router nuevo montado sin sesión pone la guardia en rojo, que es justo lo que
 * hay que mirar en la revisión.
 */
const ROUTERS_SIN_SESION = {
  'routes/auth.js router':
    'GET /api/auth/invite/:token se monta público a propósito: quien recibe una ' +
    'invitación por mail todavía no tiene cuenta y tiene que poder ver de qué ' +
    'empresa es. El POST /accept-invite del mismo archivo SÍ va detrás de ' +
    'authSinEmpresa, pero es el MISMO objeto router, así que la guardia lo ' +
    'clasifica por su montaje más débil y no puede exigirle permisos a ninguna ' +
    'de las dos.',
  'routes/tiendanube.js publico':
    'Lo llama TiendaNube desde afuera: /callback es el redirect final del OAuth y ' +
    '/webhook se autentica con la firma HMAC del cuerpo crudo. No hay sesión de ' +
    'usuario de la cual pueda salir un permiso. Está separado del router `privado` ' +
    'justamente para que esto se vea en server.js.',
};

/**
 * Rutas de un router autenticado que NO declaran permiso, a propósito.
 *
 * Tres, y las tres del onboarding: son las que un usuario tiene que poder usar
 * ANTES de tener rol, que es de donde salen los permisos.
 */
const SIN_PERMISO_A_PROPOSITO = {
  'routes/empresas.js POST /onboarding':
    'Crea la PRIMERA empresa. Quien la llama todavía no tiene fila en ' +
    'usuario_empresas, así que no tiene rol y no puede tener ningún permiso: ' +
    'exigirle uno dejaría a todo usuario recién registrado sin forma de arrancar. ' +
    'El handler opera sobre req.usuario y sobre nada más.',
  'routes/empresas.js GET /mi-contexto':
    'Es lo que la app pide al arrancar para SABER qué permisos tiene. Pedir un ' +
    'permiso para poder leer los permisos es circular. Devuelve solo las ' +
    'usuario_empresas del propio usuario.',
  'routes/empresas.js PUT /cambiar-empresa/:id':
    'Cambia la empresa activa del propio usuario, y su autorización ES la ' +
    'membresía: busca la UsuarioEmpresa del usuario y responde 403 si no existe. ' +
    'No hay ningún permiso del catálogo que signifique «cambiar de empresa», y ' +
    'uno encima de la membresía no agregaría nada.',
};

/**
 * Rutas que **deberían** declarar un permiso y hoy no lo hacen.
 *
 * No se corrigen desde acá: son código de producción y esta tarea es la
 * guardia, no el arreglo. Se listan para que la guardia pueda estar en verde
 * sin tapar el hallazgo, y se afirma que **siguen existiendo**: el día que
 * alguien las arregle, la prueba de más abajo se pone en rojo pidiendo que se
 * borre la entrada. Una lista de deuda que sobrevive a la deuda es peor que no
 * tenerla — pasa a ser una excepción permanente que nadie recuerda por qué está.
 */
const DEUDA_DE_PERMISOS = {
  'routes/empresas.js GET /:id/suscripcion':
    'Va detrás de requireEmpresa + requireEmpresaPropia(), así que ya no cruza ' +
    'empresas; pero cualquier miembro —un cajero— puede leer el plan, el estado y ' +
    'las fechas de vencimiento de la suscripción. Le correspondería config.ver, ' +
    'que es lo que piden GET /api/empresas y GET /api/empresas/:id.',
};

/**
 * Rutas declaradas directo sobre `app` en server.js, sin pasar por ningún
 * router de `routes/`. Se afirman por igualdad exacta: son el agujero por el
 * que alguien puede agregar un endpoint real que nunca pase por esta guardia.
 */
const RUTAS_INLINE_DE_SERVER = {
  'GET /api/ping':
    'Health check superficial, público a propósito: lo consulta la plataforma y ' +
    'sirve para despertar el free tier. No lee nada de ninguna empresa.',
  'GET /api/health':
    'Health check profundo: dice si Postgres contesta, y nada más. Es el que mira ' +
    'Render para decidir si el servicio está sano; exigirle una sesión lo volvería ' +
    'inútil.',
  'POST /api/tareas/ejecutar':
    'Lo llama una máquina, no una persona: se autentica con el secreto compartido ' +
    'CRON_SECRET y, sin ese secreto configurado, queda deshabilitado (404). No hay ' +
    'usuario del cual sacar un permiso.',
};

/** Las cadenas de middlewares de server.js que autentican al que llama. */
const CADENAS_AUTENTICADAS = ['authEmpresa', 'authSinEmpresa', 'authMiddleware'];

// ════════════════════════════════════════════
//  El detector
// ════════════════════════════════════════════

/** Índice del cierre que corresponde a la apertura en `inicio`. */
function cierreDe(texto, inicio, abre, cierra) {
  let nivel = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === abre) nivel++;
    else if (texto[i] === cierra) {
      nivel--;
      if (nivel === 0) return i;
    }
  }
  return texto.length - 1;
}

const numeroDeLinea = (contenido, i) => contenido.slice(0, i).split('\n').length;

/** true si el índice cae en una línea que es comentario. */
function enComentario(contenido, i) {
  const inicioDeLinea = contenido.lastIndexOf('\n', i) + 1;
  const anterior = contenido.slice(inicioDeLinea, i).trim();
  return anterior.startsWith('//') || anterior.startsWith('*');
}

/**
 * Saca los comentarios de línea.
 *
 * Hace falta porque `routes/suppliers.js` explica el orden de `/:id/…` en un
 * comentario que contiene literalmente `router.get('/:id')`. Sin esto, la
 * guardia inventaría una ruta que no existe y la marcaría como sin permiso.
 */
function sinComentarios(texto) {
  return texto
    .split('\n')
    .map((linea) => {
      const i = linea.indexOf('//');
      if (i === -1) return linea;
      if (linea[i - 1] === ':') return linea; // https://
      return linea.slice(0, i);
    })
    .join('\n');
}

/** Las variables que son un express.Router() en este archivo. */
function routersDelArchivo(contenido) {
  return [...contenido.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*express\.Router\s*\(/g)]
    .map((m) => m[1]);
}

/**
 * Qué nombre expone el archivo y a qué variable corresponde.
 *
 * `module.exports = router` → `{ '': 'router' }` (la exportación por defecto).
 * `module.exports = { publico, privado }` → una entrada por propiedad, que es
 * como server.js las monta: `require('./routes/tiendanube').publico`.
 */
function exportacionesDelArchivo(contenido) {
  const m = contenido.match(/module\.exports\s*=\s*([^;]+);/);
  if (!m) return {};

  const expresion = m[1].trim();
  if (!expresion.startsWith('{')) return { '': expresion };

  const salida = {};
  for (const parte of expresion.slice(1, -1).split(',')) {
    const texto = parte.trim();
    if (!texto) continue;
    const [clave, valor] = texto.includes(':')
      ? texto.split(':').map((s) => s.trim())
      : [texto, texto];
    salida[clave] = valor;
  }
  return salida;
}

/**
 * El código de permiso que declara esta ruta, o null.
 *
 * El texto que se mira es el de la lista de argumentos, acotado además al
 * comienzo de la ruta siguiente: sin ese tope, un paréntesis desbalanceado
 * adentro de un string haría que una ruta «viera» el checkPermission de la de
 * abajo y la guardia diera por declarada una que no lo está.
 */
function permisoDeclarado(texto) {
  const m = sinComentarios(texto).match(/checkPermission\(\s*'([^']+)'\s*\)/);
  return m ? m[1] : null;
}

/**
 * Todas las rutas que declara un archivo de `routes/`.
 *
 * @returns {{archivo, variable, metodo, ruta, linea, permiso}[]}
 */
function rutasDeclaradas(nombre, contenido) {
  const variables = routersDelArchivo(contenido);
  if (variables.length === 0) return [];

  const patron = new RegExp(
    `\\b(${variables.join('|')})\\.(get|post|put|delete|patch)\\s*\\(\\s*'([^']*)'`,
    'g'
  );

  const crudas = [...contenido.matchAll(patron)]
    .filter((m) => !enComentario(contenido, m.index));

  return crudas.map((m, i) => {
    const abre = contenido.indexOf('(', m.index);
    const siguiente = i + 1 < crudas.length ? crudas[i + 1].index : contenido.length;
    const hasta = Math.min(cierreDe(contenido, abre, '(', ')') + 1, siguiente);

    return {
      archivo: nombre,
      variable: m[1],
      metodo: m[2].toUpperCase(),
      ruta: m[3],
      linea: numeroDeLinea(contenido, m.index),
      permiso: permisoDeclarado(contenido.slice(m.index, hasta)),
    };
  });
}

/** La clave con la que se nombra una ruta en las listas de excepciones. */
const claveDe = (r) => `${r.archivo} ${r.metodo} ${r.ruta}`;

/**
 * Las rutas de `lista` que no declaran permiso y no están justificadas.
 * Cada hallazgo se nombra con archivo y línea, para que se pueda ir a mirarlo.
 */
function rutasSinPermiso(lista, justificadas = {}) {
  return lista
    .filter((r) => !r.permiso && !justificadas[claveDe(r)])
    .map((r) => `${r.archivo}:${r.linea} — ${r.metodo} ${r.ruta} no declara checkPermission`);
}

/** Los montajes de routers que hace server.js, con su cadena. */
function montajesDeServer(server) {
  const encontrados = [];

  server.split('\n').forEach((linea, i) => {
    if (linea.trim().startsWith('//')) return;

    const m = linea.match(
      /app\.(use|get|post|put|delete|patch)\(\s*'([^']+)'[^\n]*require\('\.\/routes\/(\w+)'\)(?:\.(\w+))?/
    );
    if (!m) return;

    encontrados.push({
      linea: i + 1,
      montaje: m[2],
      archivo: `routes/${m[3]}.js`,
      exportacion: m[4] || '',
      autenticado: CADENAS_AUTENTICADAS.some((cadena) => linea.includes(cadena)),
    });
  });

  return encontrados;
}

/** Las rutas que server.js declara sobre `app` sin pasar por routes/. */
function rutasInlineDeServer(server) {
  return server.split('\n').reduce((acc, linea, i) => {
    if (linea.trim().startsWith('//')) return acc;
    if (linea.includes("require('./routes/")) return acc;

    const m = linea.match(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'/);
    if (m) acc.push({ clave: `${m[1].toUpperCase()} ${m[2]}`, linea: i + 1 });

    return acc;
  }, []);
}

// ── Lo que hay en el repositorio hoy ──

const ARCHIVOS = fs.readdirSync(DIR_RUTAS)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({
    nombre: `routes/${f}`,
    contenido: fs.readFileSync(path.join(DIR_RUTAS, f), 'utf8'),
  }));

const MONTAJES = montajesDeServer(SERVER);

/**
 * `archivo variable` → true si TODOS sus montajes van detrás de la cadena de
 * autenticación.
 *
 * Se exige que lo sean todos y no alguno: `routes/auth.js` se monta dos veces,
 * una pública y otra autenticada, y es el MISMO objeto router. Lo que llega al
 * handler es lo que dejó pasar el montaje más débil.
 */
function autenticacionPorRouter(montajes, archivos) {
  const estado = {};

  for (const montaje of montajes) {
    const archivo = archivos.find((a) => a.nombre === montaje.archivo);
    if (!archivo) continue;

    const variable = exportacionesDelArchivo(archivo.contenido)[montaje.exportacion];
    if (!variable) continue;

    const clave = `${montaje.archivo} ${variable}`;
    estado[clave] = (estado[clave] === undefined ? true : estado[clave]) && montaje.autenticado;
  }

  return estado;
}

const AUTENTICADO_POR_ROUTER = autenticacionPorRouter(MONTAJES, ARCHIVOS);

const TODAS_LAS_RUTAS = ARCHIVOS.flatMap(({ nombre, contenido }) => rutasDeclaradas(nombre, contenido));

const RUTAS_AUTENTICADAS = TODAS_LAS_RUTAS.filter(
  (r) => AUTENTICADO_POR_ROUTER[`${r.archivo} ${r.variable}`] === true
);

// ════════════════════════════════════════════
//  Las muestras sintéticas
//
//  No son documentación: son lo que sostiene a la guardia el día que el
//  repositorio ya no tenga el defecto. Si alguien afloja el detector, estas dos
//  pruebas se ponen en rojo aunque el código real esté impecable.
//
//  La mala es, textualmente, el defecto medido: el export de la cuenta
//  corriente sin su checkPermission, al lado de un hermano que sí lo tiene.
// ════════════════════════════════════════════

const MUESTRA_MALA = `
const express = require('express');
const router = express.Router();
const checkPermission = require('../middleware/checkPermission');

router.get('/:id/movimientos', checkPermission('proveedores.ver'), async (req, res) => {
  res.json({ ok: true, data: [] });
});

router.get('/:id/movimientos/export', async (req, res) => {
  res.json({ ok: true, data: [] });
});

module.exports = router;
`;

const MUESTRA_BUENA = MUESTRA_MALA.replace(
  "router.get('/:id/movimientos/export', async",
  "router.get('/:id/movimientos/export', checkPermission('proveedores.ver'), async"
);

// ════════════════════════════════════════════

describe('el detector encuentra una ruta sin permiso, y no inventa las que sí lo tienen', () => {
  it('nombra la ruta sin checkPermission con archivo y línea', () => {
    const rutas = rutasDeclaradas('muestra/mala.js', MUESTRA_MALA);
    const hallazgos = rutasSinPermiso(rutas);

    expect(rutas).toHaveLength(2);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain('muestra/mala.js:10');
    expect(hallazgos[0]).toContain('GET /:id/movimientos/export');
  });

  it('NO marca la ruta que sí lo declara', () => {
    // Sin esto la guardia podría estar fallando siempre, que es tan inútil como
    // no fallar nunca: nadie convive con una guardia que no se puede poner en
    // verde, y la primera reacción de quien la encuentra es desactivarla.
    expect(rutasSinPermiso(rutasDeclaradas('muestra/buena.js', MUESTRA_BUENA))).toEqual([]);
  });

  it('lee el código de permiso y no solo su presencia', () => {
    const [movimientos] = rutasDeclaradas('muestra/buena.js', MUESTRA_BUENA);
    expect(movimientos.permiso).toBe('proveedores.ver');
  });

  it('NO cuenta como ruta un router.get() que está adentro de un comentario', () => {
    // routes/suppliers.js explica el orden de las rutas `/:id/…` en un
    // comentario que contiene literalmente `router.get('/:id')`. Contarlo daría
    // una ruta fantasma, siempre sin permiso: la guardia quedaría en rojo
    // permanente por algo que no existe, y terminaría desactivada.
    const conComentario = `
const express = require('express');
const router = express.Router();
// Cuelga de /:id/… a propósito, porque router.get('/:id') está declarado antes.
router.get('/:id', checkPermission('proveedores.ver'), async (req, res) => {});
module.exports = router;
`;
    const rutas = rutasDeclaradas('muestra/comentario.js', conComentario);

    expect(rutas).toHaveLength(1);
    expect(rutas[0].linea).toBe(5);
  });

  it('NO le atribuye a una ruta el checkPermission de la de abajo', () => {
    // El tope por «comienzo de la ruta siguiente» es lo que lo impide. Sin él,
    // un paréntesis desbalanceado adentro de un string —hay mensajes de error
    // con paréntesis en varios handlers— haría que el balanceo se pase de largo
    // y dé por declarada una ruta que no declara nada.
    const pegadas = `
const express = require('express');
const router = express.Router();
router.get('/export', async (req, res) => {
  res.status(400).json({ error: 'Falta el filtro (from' });
});
router.get('/otra', checkPermission('proveedores.ver'), async (req, res) => {});
module.exports = router;
`;
    const hallazgos = rutasSinPermiso(rutasDeclaradas('muestra/pegadas.js', pegadas));

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain('GET /export');
  });
});

// Un server.js de mentira, para poder ejercitar la clasificación de montajes
// sin tocar el de verdad. Tiene las tres formas que existen hoy: el montaje
// normal, el router que se exporta por propiedad y va sin sesión, y su hermano
// que sí va detrás de la cadena.
const MUESTRA_SERVER = `
app.use('/api/suppliers', ...authEmpresa, require('./routes/suppliers'));
app.use('/api/tiendanube', require('./routes/tiendanube').publico);
app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').privado);
app.get('/api/ping', (req, res) => res.json({ ok: true }));
`;

const ARCHIVOS_MUESTRA = [
  {
    nombre: 'routes/suppliers.js',
    contenido: 'const router = express.Router();\nmodule.exports = router;\n',
  },
  {
    nombre: 'routes/tiendanube.js',
    contenido: 'const publico = express.Router();\nconst privado = express.Router();\n'
      + 'module.exports = { publico, privado };\n',
  },
];

describe('la clasificación de montajes distingue con sesión de sin sesión', () => {
  // Se ejercita contra la muestra y no contra server.js a propósito: si mañana
  // todos los montajes reales quedaran autenticados, esta prueba seguiría
  // afirmando que el detector SABE reconocer el caso contrario. Y si alguien
  // sacara la cadena de un montaje real, la igualdad exacta de más abajo lo
  // nombra.
  const montajes = montajesDeServer(MUESTRA_SERVER);

  it('lee los montajes de routers y deja afuera el health check inline', () => {
    expect(montajes).toHaveLength(3);
    expect(montajes.map((m) => m.montaje)).toEqual([
      '/api/suppliers', '/api/tiendanube', '/api/tiendanube',
    ]);
  });

  it('el router exportado por propiedad se clasifica por su propio montaje', () => {
    const estado = autenticacionPorRouter(montajes, ARCHIVOS_MUESTRA);

    expect(estado).toEqual({
      'routes/suppliers.js router': true,
      'routes/tiendanube.js publico': false,
      'routes/tiendanube.js privado': true,
    });
  });

  it('sacarle la cadena a un montaje lo deja SIN sesión, no lo exime', () => {
    // Es la mutación que importa: si quitar `...authEmpresa` dejara el router
    // clasificado como autenticado, la guardia seguiría exigiendo permisos sobre
    // rutas que ya no los puede verificar nadie. Y si lo dejara clasificado como
    // «público» en silencio, alcanzaría con borrar la cadena para sacar 17
    // endpoints del radar.
    const sinCadena = montajesDeServer(
      MUESTRA_SERVER.replace(", ...authEmpresa, require('./routes/suppliers')", ", require('./routes/suppliers')")
    );
    const estado = autenticacionPorRouter(sinCadena, ARCHIVOS_MUESTRA);

    expect(estado['routes/suppliers.js router']).toBe(false);
  });
});

describe('la guardia leyó lo que dice leer, y no una lista vacía', () => {
  it('lee los 19 archivos de routes/, y server.js los monta a todos', () => {
    // **El ancla de archivos.** Un archivo de rutas que nadie monta es código
    // muerto —o peor, un router que alguien cree publicado— y además saldría de
    // esta guardia sin que nada avise.
    const nombres = ARCHIVOS.map((a) => a.nombre).sort();
    const montados = [...new Set(MONTAJES.map((m) => m.archivo))].sort();

    expect(nombres).toEqual([
      'routes/afip.js', 'routes/auth.js', 'routes/cashflow.js', 'routes/comparador.js',
      'routes/customers.js', 'routes/dashboard.js', 'routes/empresas.js',
      'routes/gastosVariables.js', 'routes/general.js', 'routes/import.js',
      'routes/precios.js', 'routes/production.js', 'routes/products.js',
      'routes/reports.js', 'routes/sales.js', 'routes/stock.js', 'routes/suppliers.js',
      'routes/taxes.js', 'routes/tiendanube.js',
    ]);
    expect(montados).toEqual(nombres);
  });

  it('CADA archivo aporta al menos una ruta', () => {
    // Es el ancla que más muerde. Un ancla global —«hay más de 120 rutas»—
    // seguiría en verde si el detector dejara de reconocer la forma de UN
    // archivo; esta dice cuál se quedó en cero.
    const vacios = ARCHIVOS
      .filter(({ nombre }) => !TODAS_LAS_RUTAS.some((r) => r.archivo === nombre))
      .map(({ nombre }) => nombre);

    expect(vacios).toEqual([]);
  });

  it('encuentra las ~134 rutas que tiene que revisar', () => {
    // Piso y no igualdad: una ruta nueva legítima sube el número y no tiene por
    // qué poner esto en rojo (para eso está la regla, que sí la va a mirar). Lo
    // que este piso impide es que el número se desplome —a cero o a un puñado—
    // porque el detector dejó de entender cómo se declara una ruta. Hoy son 134
    // en total y 130 detrás de una cadena autenticada.
    expect(TODAS_LAS_RUTAS.length).toBeGreaterThan(120);
    expect(RUTAS_AUTENTICADAS.length).toBeGreaterThan(115);
  });

  it('reconoce las dos cadenas de server.js y no da todo por público', () => {
    // Si `autenticado` diera false para todo, RUTAS_AUTENTICADAS quedaría vacío
    // y el it.each de abajo pasaría en verde sin revisar un solo endpoint.
    expect(MONTAJES.filter((m) => m.autenticado).length).toBeGreaterThan(15);
    expect(SERVER).toMatch(/const authEmpresa = /);
    expect(SERVER).toMatch(/const authSinEmpresa = /);
  });
});

describe('toda ruta detrás de una cadena autenticada declara su permiso', () => {
  it.each(ARCHIVOS)('$nombre', ({ nombre }) => {
    const delArchivo = RUTAS_AUTENTICADAS.filter((r) => r.archivo === nombre);
    const justificadas = { ...SIN_PERMISO_A_PROPOSITO, ...DEUDA_DE_PERMISOS };

    expect(rutasSinPermiso(delArchivo, justificadas)).toEqual([]);
  });

  it('los routers montados sin sesión son exactamente los dos documentados', () => {
    // Montar un router nuevo sin la cadena de autenticación saca de golpe a
    // todas sus rutas de esta guardia. Tiene que costar: acá se ve, con nombre.
    const sinSesion = Object.entries(AUTENTICADO_POR_ROUTER)
      .filter(([, autenticado]) => !autenticado)
      .map(([clave]) => clave)
      .sort();

    expect(sinSesion).toEqual(Object.keys(ROUTERS_SIN_SESION).sort());

    for (const motivo of Object.values(ROUTERS_SIN_SESION)) {
      expect(motivo.length).toBeGreaterThan(40);
    }
  });

  it('las excepciones a propósito son las tres del onboarding, y siguen existiendo', () => {
    // Una excepción que sobrevive a la ruta que la justificaba deja de ser una
    // excepción y pasa a ser un permiso de circulación para cualquier ruta que
    // mañana se llame igual.
    const claves = TODAS_LAS_RUTAS.map(claveDe);

    for (const clave of Object.keys(SIN_PERMISO_A_PROPOSITO)) {
      expect(claves).toContain(clave);
    }
    expect(Object.keys(SIN_PERMISO_A_PROPOSITO)).toHaveLength(3);
  });

  it('la deuda conocida sigue sin permiso (si se corrigió, se borra de la lista)', () => {
    // Esta prueba se pone en rojo cuando alguien ARREGLA la ruta. Es a
    // propósito: el mensaje que hay que leer es «sacá la entrada de
    // DEUDA_DE_PERMISOS», no «volvé a romperlo».
    const sinPermiso = TODAS_LAS_RUTAS.filter((r) => !r.permiso).map(claveDe);

    for (const clave of Object.keys(DEUDA_DE_PERMISOS)) {
      expect(sinPermiso).toContain(clave);
    }
  });

  it('las rutas que server.js declara sin router son solo los health checks y el cron', () => {
    // El otro agujero: un endpoint escrito directo sobre `app` en server.js no
    // pasa por ningún archivo de routes/ y por lo tanto no lo mira nada de lo
    // de arriba.
    const inline = rutasInlineDeServer(SERVER).map((r) => r.clave).sort();

    expect(inline).toEqual(Object.keys(RUTAS_INLINE_DE_SERVER).sort());
  });
});

describe('ningún checkPermission pide un permiso que no existe en el catálogo', () => {
  // Un código con un error de tipeo no falla ni avisa: `seedPermissions.js` le
  // da al rol admin `PERMISOS.map(p => p.codigo)`, así que un código que no está
  // en esa lista no lo tiene NADIE. El endpoint responde 403 para siempre, para
  // todos, y en la pantalla se ve como «no anda».
  const seed = fs.readFileSync(path.join(SRC, 'seedPermissions.js'), 'utf8');
  const CATALOGO = [...seed.matchAll(/codigo:\s*'([^']+)'/g)].map((m) => m[1]);

  it('el catálogo se leyó y tiene los permisos que tiene que tener', () => {
    expect(CATALOGO.length).toBeGreaterThan(40);
    expect(CATALOGO).toContain('proveedores.ver');
    expect(CATALOGO).toContain('ordenes_compra.recibir');
  });

  it('todos los códigos usados en routes/ están en el catálogo', () => {
    const usados = [...new Set(TODAS_LAS_RUTAS.map((r) => r.permiso).filter(Boolean))];

    expect(usados.length).toBeGreaterThan(20);
    expect(usados.filter((codigo) => !CATALOGO.includes(codigo))).toEqual([]);
  });
});

// ════════════════════════════════════════════
//  El archivo del hito 6 (funcionalidad 012)
//
//  Acá sí hay una tabla ruta→permiso, y es a propósito: la regla de arriba dice
//  que hay ALGÚN checkPermission, no cuál. Degradar `proveedores.eliminar` a
//  `proveedores.ver` la dejaría en verde. Para el archivo del hito eso no
//  alcanza, así que se fija el código exacto de cada ruta.
//
//  La tabla no se puede desactualizar en silencio porque se compara por
//  igualdad exacta contra lo que el detector encontró: una ruta nueva en
//  suppliers.js pone esta prueba en rojo hasta que se le escriba su fila.
// ════════════════════════════════════════════

describe('routes/suppliers.js · cada ruta con el permiso que le corresponde', () => {
  const ESPERADO = {
    'GET /orders': 'ordenes_compra.ver',
    'GET /orders/:id': 'ordenes_compra.ver',
    'PUT /orders/:id/receive': 'ordenes_compra.recibir',
    'PUT /orders/:id/cancel': 'ordenes_compra.anular',
    'GET /': 'proveedores.ver',
    'GET /:id': 'proveedores.ver',
    'GET /:id/movimientos': 'proveedores.ver',
    'GET /:id/movimientos/export': 'proveedores.ver',
    'POST /': 'proveedores.crear',
    'PUT /:id': 'proveedores.editar',
    'DELETE /:id': 'proveedores.eliminar',
    'POST /:id/orders': 'ordenes_compra.crear',
    // Observación, no defecto de esta corrida: el pago a un proveedor pide
    // `proveedores.crear`, mientras que el pago de un cliente
    // —routes/customers.js POST /:id/payments— pide `caja.crear`. Son la misma
    // forma de operación con dos permisos distintos.
    'POST /:id/payments': 'proveedores.crear',
    'PUT /movements/:id': 'proveedores.editar',
    'DELETE /movements/:id': 'proveedores.eliminar',
    'POST /:id/documents': 'proveedores.editar',
    'DELETE /documents/:id': 'proveedores.eliminar',
  };

  const DEL_ARCHIVO = TODAS_LAS_RUTAS.filter((r) => r.archivo === 'routes/suppliers.js');

  it('la tabla cubre las 17 rutas del archivo, ni una más ni una menos', () => {
    const encontradas = DEL_ARCHIVO.map((r) => `${r.metodo} ${r.ruta}`).sort();

    expect(encontradas).toEqual(Object.keys(ESPERADO).sort());
    expect(DEL_ARCHIVO).toHaveLength(17);
  });

  it.each(Object.entries(ESPERADO))('%s exige %s', (clave, permiso) => {
    const [metodo, ...resto] = clave.split(' ');
    const ruta = DEL_ARCHIVO.find((r) => r.metodo === metodo && r.ruta === resto.join(' '));

    expect(ruta).toBeDefined();
    expect(ruta.permiso).toBe(permiso);
  });

  it('la exportación de la cuenta corriente exige proveedores.ver (FR-102)', () => {
    // Es el caso medido: sin esta línea se sacaba el checkPermission del export
    // y los 479 tests de la API seguían en verde. La cuenta corriente completa
    // de todos los proveedores —saldos, pagos, comprobantes— se bajaba en un
    // xlsx sin ningún permiso.
    const exportar = DEL_ARCHIVO.find((r) => r.ruta === '/:id/movimientos/export');

    expect(exportar).toBeDefined();
    expect(exportar.permiso).toBe('proveedores.ver');
  });
});

// ════════════════════════════════════════════

describe('por qué esto se verifica leyendo y no ejecutando', () => {
  it('el setup de jest sigue encendiendo BYPASS_AUTH y checkPermission sigue cortando antes', () => {
    // Si esta prueba se pone en roja es una BUENA noticia: significa que ya se
    // puede verificar ejecutando. Lo que corresponde ese día es **reemplazar**
    // esta guardia por tests que llamen a cada endpoint con un usuario sin el
    // permiso y esperen un 403 — no ajustar esta prueba para que vuelva a pasar.
    const setup = fs.readFileSync(path.join(SRC, 'tests', 'setup.js'), 'utf8');
    const middleware = fs.readFileSync(path.join(SRC, 'middleware', 'checkPermission.js'), 'utf8');

    expect(setup).toMatch(/process\.env\.BYPASS_AUTH\s*=\s*'true'/);

    const iBypass = middleware.indexOf("process.env.BYPASS_AUTH === 'true'");
    const iPermisos = middleware.indexOf('req.usuarioPermisos');

    expect(iBypass).toBeGreaterThanOrEqual(0);
    expect(iPermisos).toBeGreaterThan(iBypass);
  });
});
