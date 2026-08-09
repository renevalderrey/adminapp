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
//     motivo. La única tabla ruta→permiso completa de este archivo es la de
//     `routes/suppliers.js`, el archivo del hito, y está atada por igualdad
//     exacta: una ruta nueva ahí **obliga** a agregarle su fila.
//
//     Fuera de esa tabla se fija el código exacto de **tres** rutas sueltas: las
//     de `routes/empresas.js` que leen la empresa. Ahí no alcanza con «declara
//     algún permiso», porque degradar `config.ver` a `dashboard.ver` —que lo
//     tienen los cinco roles— dejaría la regla en verde con el dato igual de
//     abierto. Medido: esa mutación pone en rojo **una sola** prueba, la
//     específica.
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
  'routes/auth.js publico':
    'GET /api/auth/invite/:token se monta público a propósito: quien recibe una ' +
    'invitación por mail todavía no tiene cuenta y tiene que poder ver de qué ' +
    'empresa es. Hasta este hito el archivo exportaba UN router con las dos ' +
    'rutas, así que la guardia clasificaba a las dos por el montaje más débil y ' +
    'el POST /accept-invite se le escapaba de la revisión. Ahora son dos objetos ' +
    'distintos —`publico` y `privado`, como en routes/tiendanube.js— y acá queda ' +
    'exento únicamente el que de verdad se abre sin sesión.',
  'routes/tiendanube.js publico':
    'Lo llama TiendaNube desde afuera: /callback es el redirect final del OAuth y ' +
    '/webhook se autentica con la firma HMAC del cuerpo crudo. No hay sesión de ' +
    'usuario de la cual pueda salir un permiso. Está separado del router `privado` ' +
    'justamente para que esto se vea en server.js.',
};

/**
 * Rutas de un router autenticado que NO declaran permiso, a propósito.
 *
 * Cuatro, y las cuatro son lo mismo: lo que un usuario tiene que poder usar
 * ANTES de tener rol, que es de donde salen los permisos.
 *
 * La cuarta —aceptar una invitación— no estaba porque **la guardia no la veía**:
 * hasta este hito `routes/auth.js` exportaba un router único montado dos veces,
 * y la guardia lo clasificaba por su montaje más débil, así que el
 * `POST /accept-invite/:token` quedaba fuera de `RUTAS_AUTENTICADAS`. Partir el
 * archivo en `publico` / `privado` la trajo adentro, que es lo que se quería:
 * ahora está exenta con su motivo escrito y no por un efecto colateral del
 * montaje.
 */
const SIN_PERMISO_A_PROPOSITO = {
  'routes/auth.js POST /accept-invite/:token':
    'Crea la membresía. Quien la llama todavía no tiene fila en usuario_empresas ' +
    '—es justamente lo que este endpoint le crea— así que no tiene rol y no puede ' +
    'tener ningún permiso: es el mismo motivo que POST /onboarding. Su ' +
    'autorización sale del token de la invitación, que se busca por el email del ' +
    'usuario de la sesión.',
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
 *
 * ── Está vacía, y eso es el resultado, no un olvido ──
 *
 * La única entrada era `routes/empresas.js GET /:id/suscripcion`, y el
 * mecanismo funcionó como se esperaba: al ponerle su `checkPermission`, la
 * prueba de más abajo se puso en rojo pidiendo que se borrara la entrada. Se
 * borró el 5/8/2026.
 *
 * La lista vacía **no deja la prueba en verde por vacío**: lo que se afirma es
 * la igualdad exacta contra `SIN_PERMISO_A_PROPOSITO`, así que una ruta
 * autenticada sin permiso que aparezca mañana pone la guardia en rojo aunque
 * nadie escriba nada acá.
 */
const DEUDA_DE_PERMISOS = {};

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

  it('las excepciones a propósito son las cuatro de antes del rol, y siguen existiendo', () => {
    // Una excepción que sobrevive a la ruta que la justificaba deja de ser una
    // excepción y pasa a ser un permiso de circulación para cualquier ruta que
    // mañana se llame igual.
    const claves = TODAS_LAS_RUTAS.map(claveDe);

    for (const clave of Object.keys(SIN_PERMISO_A_PROPOSITO)) {
      expect(claves).toContain(clave);
    }
    // Sube de tres a cuatro con la partición de routes/auth.js: el
    // POST /accept-invite/:token entró a la guardia porque dejó de compartir
    // objeto con la ruta pública. Es una ruta que ya existía y que hasta hoy no
    // revisaba nadie, no una excepción nueva.
    expect(Object.keys(SIN_PERMISO_A_PROPOSITO)).toHaveLength(4);
  });

  it('la deuda conocida sigue sin permiso (si se corrigió, se borra de la lista)', () => {
    // Esta prueba se pone en rojo cuando alguien ARREGLA la ruta. Es a
    // propósito: el mensaje que hay que leer es «sacá la entrada de
    // DEUDA_DE_PERMISOS», no «volvé a romperlo».
    const sinPermiso = TODAS_LAS_RUTAS.filter((r) => !r.permiso).map(claveDe);

    for (const clave of Object.keys(DEUDA_DE_PERMISOS)) {
      expect(sinPermiso).toContain(clave);
    }

    // ── El ancla de la lista vacía ──
    //
    // Con `DEUDA_DE_PERMISOS` en cero, el `for` de arriba no recorre nada y esta
    // prueba pasaría en verde sin haber mirado un solo endpoint: es la primera
    // de las dos formas de morir que describe el encabezado de este archivo.
    //
    // Lo que sostiene la afirmación es la igualdad exacta: las únicas rutas
    // autenticadas que pueden no declarar permiso son las **tres del
    // onboarding**. Sacarle el `checkPermission` a `GET /:id/suscripcion` —o a
    // cualquier otra— agrega una clave acá y pone esto en rojo con su nombre.
    const autenticadasSinPermiso = RUTAS_AUTENTICADAS
      .filter((r) => !r.permiso)
      .map(claveDe)
      .sort();

    expect(autenticadasSinPermiso).toEqual(Object.keys(SIN_PERMISO_A_PROPOSITO).sort());
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
//  routes/afip.js · la superficie que produce hechos fiscales irreversibles
//
//  Es la segunda tabla ruta→permiso de este archivo, y entra por el mismo motivo
//  que la de suppliers: la regla de más arriba dice que hay ALGÚN
//  `checkPermission`, no cuál. Acá eso no alcanza, y no por prolijidad:
//
//   · `POST /verificar` **escribe** la evidencia que habilita el pase a
//     producción. Con `config.ver` —que tiene el rol `gerente`— el paso 4 del
//     checklist lo podría cumplir alguien que no puede tocar la configuración.
//   · `DELETE /vinculacion` borra el certificado y la clave privada, y **la clave
//     no se puede recuperar de acá**: no sale por la API y la del CSR nunca se
//     guardó del lado del servidor. Degradarlo a `config.ver` sería dejar que
//     medio equipo destruya material fiscal que hay que volver a tramitar en
//     ARCA.
//   · `POST /invoice` **no está en la tabla porque no existe**: se borró en el
//     corte 3 (emitía un comprobante fiscal real con `ventas.crear`, el permiso
//     del rol `vendedor`, sin crear ninguna `Sale`). La igualdad exacta de acá
//     abajo es lo que hace que volver a agregarlo obligue a escribirle su fila —y
//     a que alguien mire por qué.
//
//  La tabla no se puede desactualizar en silencio: se compara por igualdad exacta
//  contra lo que el detector encontró.
// ════════════════════════════════════════════

describe('routes/afip.js · cada ruta con el permiso que le corresponde', () => {
  const ESPERADO = {
    'GET /status': 'config.ver',
    'GET /cert-info': 'config.ver',
    'POST /setup': 'config.editar',
    'POST /generate-csr': 'config.editar',
    'POST /verificar': 'config.editar',
    'DELETE /vinculacion': 'config.editar',
    // Lee un comprobante YA emitido para imprimirlo (`pages/InvoicesList.jsx`).
    // No emite nada, y por eso pide el permiso de ventas y no el de configurar.
    'GET /invoice/:type/:pv/:number/data': 'ventas.ver',
  };

  const DEL_ARCHIVO = TODAS_LAS_RUTAS.filter((r) => r.archivo === 'routes/afip.js');

  it('la tabla cubre las 7 rutas del archivo, ni una más ni una menos', () => {
    const encontradas = DEL_ARCHIVO.map((r) => `${r.metodo} ${r.ruta}`).sort();

    expect(encontradas).toEqual(Object.keys(ESPERADO).sort());
    expect(DEL_ARCHIVO).toHaveLength(7);
  });

  it.each(Object.entries(ESPERADO))('%s exige %s', (clave, permiso) => {
    const [metodo, ...resto] = clave.split(' ');
    const ruta = DEL_ARCHIVO.find((r) => r.metodo === metodo && r.ruta === resto.join(' '));

    expect(ruta).toBeDefined();
    expect(ruta.permiso).toBe(permiso);
  });

  it('las dos rutas que escriben material fiscal piden config.editar, no config.ver', () => {
    // El caso específico. Degradar cualquiera de las dos a `config.ver` deja la
    // regla general en verde y esta prueba en rojo, que es exactamente la
    // diferencia que la tabla existe para marcar.
    const escritoras = DEL_ARCHIVO
      .filter((r) => ['/verificar', '/vinculacion'].includes(r.ruta))
      .map((r) => r.permiso);

    expect(escritoras).toEqual(['config.editar', 'config.editar']);
  });
});

// ════════════════════════════════════════════
//  Quién tiene cada permiso, leído de seedPermissions.js
//
//  Hace falta para poder afirmar algo sobre las CONSECUENCIAS de un
//  `checkPermission`. La regla de más arriba dice que la ruta pide un permiso;
//  lo que no dice —y es lo único que le importa a un cliente— es **quién queda
//  afuera** cuando se lo ponemos.
//
//  Se lee del texto por el mismo motivo que todo lo demás de este archivo:
//  `seedPermissions.js` exporta solo la función, y el mapa `ROLE_PERMISOS` es
//  una constante privada. Requerir el módulo tampoco serviría: `seedPermissions`
//  escribe en la base.
// ════════════════════════════════════════════

const SEED = fs.readFileSync(path.join(SRC, 'seedPermissions.js'), 'utf8');

/** Los códigos del catálogo, en el orden en que están escritos. */
const CATALOGO = [...SEED.matchAll(/codigo:\s*'([^']+)'/g)].map((m) => m[1]);

/**
 * `rol → códigos de permiso`, leído del texto de `seedPermissions.js`.
 *
 * `admin: PERMISOS.map(p => p.codigo)` se resuelve al catálogo completo: es
 * literalmente lo que hace el archivo, y escribirlo de otra forma acá haría que
 * el día que admin deje de tener todo esto siguiera diciendo que sí.
 */
function permisosPorRol(seed) {
  const inicio = seed.indexOf('const ROLE_PERMISOS = {');
  const abre = seed.indexOf('{', inicio);
  const bloque = seed.slice(abre, cierreDe(seed, abre, '{', '}') + 1);

  const salida = {};

  for (const m of bloque.matchAll(/(\w+):\s*(PERMISOS\.map\([^)]*\)[^,]*|\[[^\]]*\])/g)) {
    salida[m[1]] = m[2].startsWith('PERMISOS')
      ? [...CATALOGO]
      : [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }

  return salida;
}

const POR_ROL = permisosPorRol(SEED);

/** Los roles del sistema que tienen un permiso, en orden alfabético. */
const rolesCon = (codigo) =>
  Object.keys(POR_ROL).filter((rol) => POR_ROL[rol].includes(codigo)).sort();

describe('el lector de roles leyó los cinco roles y no una lista vacía', () => {
  it('los cinco roles del sistema, con sus permisos', () => {
    // Sin este ancla, un cambio de forma en `seedPermissions.js` dejaría a
    // `POR_ROL` vacío y **todas** las afirmaciones de abajo pasarían por
    // vacuidad: `[].includes(...)` es false y `rolesCon()` devolvería `[]`, que
    // es exactamente lo que varias de ellas esperan.
    expect(Object.keys(POR_ROL).sort()).toEqual(
      ['admin', 'compras', 'gerente', 'produccion', 'vendedor']
    );

    // admin es el catálogo entero; el resto, listas propias y más cortas.
    expect(POR_ROL.admin).toEqual(CATALOGO);
    expect(CATALOGO.length).toBeGreaterThan(40);
    expect(POR_ROL.gerente.length).toBeGreaterThan(20);
    expect(POR_ROL.gerente.length).toBeLessThan(CATALOGO.length);
    expect(POR_ROL.compras).toContain('ordenes_compra.recibir');
    expect(POR_ROL.vendedor).not.toContain('config.ver');
  });
});

// ════════════════════════════════════════════
//  routes/empresas.js · los tres endpoints que leen la empresa piden lo mismo
//
//  El 5/8/2026 `GET /:id/suscripcion` no pedía nada: iba detrás de
//  `requireEmpresa` + `requireEmpresaPropia()` —así que no cruzaba empresas—
//  pero cualquier miembro, un cajero incluido, leía el plan, el estado y las
//  fechas de vencimiento de la suscripción del cliente.
//
//  Igual que con `routes/suppliers.js`, acá se fija el **código exacto** y no la
//  mera presencia: degradar `config.ver` a `dashboard.ver` —que lo tienen los
//  cinco roles— dejaría la regla de más arriba en verde y el dato igual de
//  abierto.
// ════════════════════════════════════════════

describe('routes/empresas.js · la suscripción se lee con config.ver', () => {
  const DEL_ARCHIVO = TODAS_LAS_RUTAS.filter((r) => r.archivo === 'routes/empresas.js');

  const rutaDe = (metodo, ruta) =>
    DEL_ARCHIVO.find((r) => r.metodo === metodo && r.ruta === ruta);

  it('GET /:id/suscripcion exige config.ver, igual que sus dos hermanas', () => {
    // Las tres devuelven la misma información de la empresa —la primera y la
    // segunda incluyen la suscripción entera en el `include`—, así que pedir
    // cosas distintas es una puerta de atrás para el mismo dato.
    expect(rutaDe('GET', '/:id/suscripcion')).toBeDefined();
    expect(rutaDe('GET', '/:id/suscripcion').permiso).toBe('config.ver');
    expect(rutaDe('GET', '/').permiso).toBe('config.ver');
    expect(rutaDe('GET', '/:id').permiso).toBe('config.ver');
  });

  it('config.ver lo tienen el dueño y el gerente, y NO el cajero', () => {
    // Es la pregunta que había que contestar antes de tocar el endpoint: a quién
    // deja afuera. `POST /onboarding` crea al dueño con el rol `admin`
    // (`routes/empresas.js:120`), así que el dueño lo tiene por definición.
    //
    // Si mañana alguien le saca `config.ver` a gerente, el gerente pierde la
    // pantalla de suscripción **en silencio** —el `catch { }` vacío de
    // `SubscriptionSettings.jsx:28` muestra «No hay información de suscripción»
    // en vez de «no tenés permiso»—. Esto se pone en rojo antes.
    expect(rolesCon('config.ver')).toEqual(['admin', 'gerente']);

    // Se afirma la lista y no rol por rol: `expect` de jest no acepta el
    // mensaje que sí acepta el de vitest, y un `for` con tres `not.toContain`
    // sueltos no dice cuál falló.
    const sinConfigVer = Object.keys(POR_ROL).filter((rol) => !POR_ROL[rol].includes('config.ver'));
    expect(sinConfigVer.sort()).toEqual(['compras', 'produccion', 'vendedor']);

    // Y un superadmin entra igual sin ser miembro: `PUT /cambiar-empresa/:id` le
    // carga el catálogo completo (`routes/empresas.js:334`).
    expect(SEED).toMatch(/config\.ver/);
  });
});

// ════════════════════════════════════════════
//  routes/empresas.js · cambiar un rol pide equipo.editar, no config.editar
//
//  Hasta la 014, `PUT /usuarios/:id` —el endpoint que cambia el rol de un
//  miembro y lo activa o desactiva— pedía `config.editar`, que es el permiso de
//  la configuración de la empresa. El endpoint estaba bien protegido y mal
//  nombrado: quien leía el catálogo no tenía cómo saber que ese código también
//  repartía roles, y quien quisiera darle a alguien la administración del equipo
//  sin darle la configuración fiscal no podía.
//
//  **El cambio es de nombre y no de alcance**, y esta guardia lo afirma con los
//  dos números al lado: los roles que tienen `equipo.editar` tienen que ser
//  exactamente los mismos que tenían `config.editar`. Si mañana alguien reparte
//  el permiso nuevo a otro rol «porque es del equipo», acá se ve.
//
//  Y hay un modo de falla propio que la otra guardia —«ningún checkPermission
//  pide un permiso que no existe en el catálogo»— ya cubre y conviene nombrar:
//  cambiar la ruta sin sembrar el código deja el endpoint respondiendo 403 para
//  SIEMPRE y para TODOS, porque un permiso que no está en el catálogo no lo
//  tiene nadie.
// ════════════════════════════════════════════

describe('routes/empresas.js · el rol de un miembro se cambia con equipo.editar', () => {
  const DEL_ARCHIVO = TODAS_LAS_RUTAS.filter((r) => r.archivo === 'routes/empresas.js');

  it('PUT /usuarios/:id pide equipo.editar', () => {
    const ruta = DEL_ARCHIVO.find((r) => r.metodo === 'PUT' && r.ruta === '/usuarios/:id');

    expect(ruta).toBeDefined();
    expect(ruta.permiso).toBe('equipo.editar');
  });

  it('equipo.editar existe en el catálogo, y lo tiene admin y nadie más', () => {
    // Las dos mitades juntas: el código sembrado (si falta, el endpoint queda
    // cerrado para todo el mundo) y a quién le llega (si llega a más gente que
    // `config.editar`, el cambio dejó de ser de nombre).
    expect(CATALOGO).toContain('equipo.editar');
    expect(rolesCon('equipo.editar')).toEqual(['admin']);
    expect(rolesCon('equipo.editar')).toEqual(rolesCon('config.editar'));
  });
});

// ════════════════════════════════════════════
//  routes/empresas.js · las tres rutas de sesiones, y por qué NO piden lo mismo
//
//  La regla general de este archivo —«toda ruta autenticada declara algún
//  permiso»— las dejaría las tres en verde con cualquier código. Acá lo que
//  importa es **cuál**, y la asimetría es la decisión:
//
//   · Ver la lista y cerrar LAS PROPIAS piden `equipo.ver`. Cerrar la sesión que
//     me quedó abierta en la computadora del local no puede exigir el permiso de
//     administrar el equipo: es mi sesión, y quien no lo tuviera no tendría forma
//     de cerrarla.
//   · Cerrar la sesión de OTRO pide `equipo.editar`, que solo tiene `admin`. Es
//     una acción sobre otra persona —le corta el acceso en TODAS las empresas a
//     las que tenga acceso— y va con el mismo permiso que cambiarle el rol.
//
//  Degradar el DELETE de la sesión ajena a `equipo.ver` dejaría a un gerente
//  cerrándole la sesión al dueño, y la regla general no lo vería.
//
//  ── ⚠ `equipo.ver` NO lo tienen los cinco roles ──
//
//  Acá decía «`equipo.ver` —que tienen los cinco roles—» y **es falso**: según
//  `seedPermissions.js` lo tienen `admin` y `gerente`, y nadie más. El que tienen
//  los cinco es `dashboard.ver`. La frase estaba también en el comentario de la
//  ruta, con la misma consecuencia: dice «cualquiera puede cerrar sus propias
//  sesiones» sobre un endpoint que hoy le responde 403 a un vendedor, a alguien
//  de producción y a alguien de compras — que son justamente quienes dejan la
//  sesión abierta en la computadora del local.
//
//  Se corrige el TEXTO y no el alcance, y es una decisión: repartir un permiso
//  cambia lo que puede hacer un rol que ya está en producción, y además no
//  alcanzaría con la ruta —`Team.jsx:637` dibuja el bloque de sesiones solo con
//  `equipo.ver`, así que un vendedor con el permiso nuevo seguiría sin el botón—.
//  Son tres lados y se deciden juntos. Lo que queda anclado abajo es el hecho:
//  quién tiene de verdad el permiso que la ruta declara.
// ════════════════════════════════════════════

describe('routes/empresas.js · las tres rutas de sesiones y su permiso exacto', () => {
  const DEL_ARCHIVO = TODAS_LAS_RUTAS.filter((r) => r.archivo === 'routes/empresas.js');

  const buscar = (metodo, ruta) => DEL_ARCHIVO.find((r) => r.metodo === metodo && r.ruta === ruta);

  it.each([
    ['GET', '/:empresaId/sesiones', 'equipo.ver'],
    ['DELETE', '/sesiones', 'equipo.ver'],
    ['DELETE', '/sesiones/:id', 'equipo.editar'],
  ])('%s %s pide %s', (metodo, ruta, permiso) => {
    const encontrada = buscar(metodo, ruta);

    expect(encontrada).toBeDefined();
    expect(encontrada.permiso).toBe(permiso);
  });

  it('cerrar LAS PROPIAS lo pueden hoy admin y gerente, y NO los cinco roles', () => {
    // El ancla del texto de arriba. Se ata el permiso que la ruta **declara** a
    // quién lo tiene **en el catálogo**: si mañana alguien mueve la ruta a un
    // código más ancho —`dashboard.ver`, que sí tienen los cinco— este caso se
    // pone en rojo y obliga a corregir también los dos comentarios, en vez de
    // dejarlos afirmando lo contrario de lo que hace el código.
    const declarado = buscar('DELETE', '/sesiones').permiso;

    expect(rolesCon(declarado)).toEqual(['admin', 'gerente']);

    // Y el contraste, que es lo que hace verificable la afirmación: el permiso
    // que sí tienen los cinco existe y es otro.
    expect(rolesCon('dashboard.ver')).toEqual(
      ['admin', 'compras', 'gerente', 'produccion', 'vendedor']
    );
  });

  it('las tres se declaran ARRIBA de DELETE /:id, o una de ellas no existe', () => {
    // ⚠ No es orden estético: `DELETE /sesiones` es **un solo segmento**, así que
    // `router.delete('/:id')` lo atrapa primero con `id = 'sesiones'`,
    // `requireEmpresaPropia` hace `parseInt('sesiones')` → NaN y el endpoint
    // responde 403 sin haber existido nunca. Express resuelve por orden de
    // declaración, y eso no se ve en ninguna otra guardia: la ruta está escrita,
    // declara su permiso, y no la alcanza ningún request.
    const generica = buscar('DELETE', '/:id');

    expect(generica).toBeDefined();
    expect(buscar('DELETE', '/sesiones').linea).toBeLessThan(generica.linea);
    expect(buscar('DELETE', '/sesiones/:id').linea).toBeLessThan(generica.linea);
  });
});

// ════════════════════════════════════════════
//  ⚠ El mismo pago pide dos permisos distintos según a quién se le pague
//
//  **Esto es un análisis escrito, no una corrección.** Mover un permiso cambia
//  lo que puede hacer un rol que ya existe en producción, y eso se decide con el
//  catálogo a la vista. Lo que sigue es el catálogo a la vista, para que la
//  próxima persona decida en dos minutos en vez de investigarlo de nuevo.
//
//  ── Los dos endpoints ──
//
//  · `POST /api/suppliers/:id/payments` → `proveedores.crear`
//    (`routes/suppliers.js:891`). Escribe un `SupplierMovement` de tipo `pago`.
//  · `POST /api/customers/:id/payments` → `caja.crear`
//    (`routes/customers.js:108`). Llama a `customerService.registerPayment`.
//
//  Es la misma operación: registrar un movimiento de plata en una cuenta
//  corriente. La única diferencia es de qué lado del mostrador está la cuenta.
//
//  ── Quién queda de cada lado HOY ──
//
//  | permiso              | admin | gerente | vendedor | produccion | compras |
//  |----------------------|-------|---------|----------|------------|---------|
//  | `caja.crear`         |  sí   |   sí    |    no    |     no     |   NO    |
//  | `proveedores.crear`  |  sí   |   sí    |    no    |     no     |   SÍ    |
//
//  **El desvío es un solo rol: `compras`.** Puede registrarle pagos a un
//  proveedor —y editarlos, porque `PUT /movements/:id` pide `proveedores.editar`
//  y también lo tiene— y no tiene **ningún** permiso de caja: no puede registrar
//  un movimiento de caja (`POST /api/cashflow/entries`, `caja.crear`) ni
//  siquiera **verlos** (`caja.ver`). Quien armó ese rol estaba pensando «que
//  pueda comprar y recibir», no «que pueda pagar», y el nombre del permiso no se
//  lo dijo.
//
//  ── Cuál de los dos criterios es el correcto ──
//
//  El de `customers.js`: **`caja.crear`**. Con las dos familias definidas
//  —`caja.*` es «mueve plata», `proveedores.*` es «administra la ficha del
//  proveedor»— un pago es un movimiento de plata, y que el destinatario sea un
//  proveedor no lo convierte en un dato de su ficha. El nombre y la dirección
//  del proveedor son la ficha; lo que se le pagó, no.
//
//  ── Qué cuesta moverlo, que es por lo que no se movió acá ──
//
//  `compras` **pierde** el alta de pagos el día que se aplique. Las tres salidas,
//  en orden de menor a mayor sorpresa para el cliente:
//
//   1. sumarle `caja.crear` al rol `compras` en `seedPermissions.js` **en el
//      mismo cambio** —queda igual que hoy, con el permiso que lo nombra bien, y
//      de paso gana el alta de movimientos de caja, que es lo que hay que
//      decidir de verdad—;
//   2. dejarlo perder el permiso, que es lo correcto si «compras» no paga;
//   3. resolverlo por usuario con `usuario_permisos`, que ya existe y admite
//      excepciones por persona sin tocar el rol.
//
//  Lo que **no** es una salida es dejarlo como está: los dos endpoints hermanos
//  de edición y borrado —`PUT`/`DELETE /movements/:id`— también cuelgan de
//  `proveedores.*`, así que la familia entera de la plata del proveedor está del
//  lado equivocado y va a arrastrar al próximo endpoint que se escriba ahí.
// ════════════════════════════════════════════

describe('el pago a un proveedor y el de un cliente piden permisos distintos', () => {
  const permisoDe = (archivo, metodo, ruta) =>
    TODAS_LAS_RUTAS.find((r) => r.archivo === archivo && r.metodo === metodo && r.ruta === ruta)
      ?.permiso;

  it('la inconsistencia sigue ahí: proveedores.crear contra caja.crear', () => {
    // Esta prueba se pone en rojo el día que alguien unifique el criterio. Es a
    // propósito, igual que DEUDA_DE_PERMISOS: el mensaje que hay que leer es
    // «actualizá el análisis de acá arriba y borralo», no «volvé a romperlo».
    expect(permisoDe('routes/suppliers.js', 'POST', '/:id/payments')).toBe('proveedores.crear');
    expect(permisoDe('routes/customers.js', 'POST', '/:id/payments')).toBe('caja.crear');
  });

  it('el rol que queda del lado equivocado es «compras», y sigue siendo el único', () => {
    // El número concreto que hace falta para decidir. Si mañana otro rol gana
    // `proveedores.crear` sin `caja.crear`, o si `compras` gana `caja.crear`, la
    // tabla del comentario de arriba dejó de ser cierta y esto lo dice.
    const puedenPagarProveedores = rolesCon('proveedores.crear');
    const puedenMoverCaja = rolesCon('caja.crear');

    expect(puedenPagarProveedores).toEqual(['admin', 'compras', 'gerente']);
    expect(puedenMoverCaja).toEqual(['admin', 'gerente']);

    const soloProveedores = puedenPagarProveedores.filter((r) => !puedenMoverCaja.includes(r));
    expect(soloProveedores).toEqual(['compras']);

    // Y no es que «compras» tenga caja por otro lado: no tiene ninguno.
    expect(POR_ROL.compras.filter((c) => c.startsWith('caja.'))).toEqual([]);
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

// ════════════════════════════════════════════
//  Ningún router sin sesión escribe `products.publicable`
//
//  ── Qué defecto cierra ──
//
//  `publicable` es lo que decide si un producto **puede** salir a una página
//  pública. Escribirlo desde un router que se monta sin cadena de autenticación
//  significa que alguien de afuera —sin usuario, sin empresa y sin permiso—
//  puede poner productos ajenos en condiciones de publicarse.
//
//  Hoy `ROUTERS_SIN_SESION` tiene dos entradas y ninguna lo escribe, así que
//  esta guardia nace en verde. Existe para el día que tenga cuatro: el hito 10
//  agrega el router público del catálogo, y la tentación de resolver «que el
//  producto aparezca» desde ahí va a estar.
//
//  ── Por qué se lee y no se ejecuta ──
//
//  Es el mismo motivo que el resto de este archivo: con `BYPASS_AUTH` la sesión
//  es siempre la empresa 1 y `checkPermission` corta antes de mirar nada. Un
//  endpoint público que escriba `publicable` pasa en verde en la suite rápida.
// ════════════════════════════════════════════

/**
 * Lo que cuenta como **escribir** la columna, y no como leerla.
 *
 * Las tres formas en las que este repositorio escribe un campo: el objeto
 * literal de un `create`/`update`, la asignación directa, y el nombre entre
 * comillas de una lista blanca de campos editables.
 *
 * Leerla —`if (p.publicable)`, `filas.filter((f) => f.publicable)`— no cuenta:
 * un router público **tiene** que poder leerla para saber qué mostrar.
 */
const ESCRITURAS_DE_PUBLICABLE = [
  /publicable\s*:/,
  /publicable\s*=[^=]/,
  /['"]publicable['"]/,
];

const escribePublicable = (fuente) =>
  ESCRITURAS_DE_PUBLICABLE.filter((patron) => patron.test(fuente));

describe('publicable no se escribe desde afuera', () => {
  it('el detector distingue escribir de leer', () => {
    // Muestra mala: las tres formas.
    expect(escribePublicable('await Product.update({ publicable: true }, { where })')).toHaveLength(1);
    expect(escribePublicable('producto.publicable = true')).toHaveLength(1);
    expect(escribePublicable("const CAMPOS = ['name', 'publicable']")).toHaveLength(1);

    // Muestra buena: leerla es legítimo y no se marca.
    expect(escribePublicable('if (producto.publicable) { mostrar(producto) }')).toEqual([]);
    expect(escribePublicable('const visibles = filas.filter((f) => f.publicable)')).toEqual([]);
    expect(escribePublicable('where: { publicable: true }')).toHaveLength(1);
  });

  it('ninguno de los routers montados sin sesión la escribe', () => {
    const hallazgos = [];

    for (const clave of Object.keys(ROUTERS_SIN_SESION)) {
      const [archivo] = clave.split(' ');
      const fuente = fs.readFileSync(path.join(SRC, archivo), 'utf8');

      if (escribePublicable(fuente).length > 0) hallazgos.push(clave);
    }

    expect(hallazgos).toEqual([]);
  });

  it('la guardia está mirando archivos que existen', () => {
    // El ancla. Sin esto, un renombre de `routes/auth.js` dejaría el bucle sin
    // iteraciones y la guardia pasaría en verde sin haber leído nada.
    expect(Object.keys(ROUTERS_SIN_SESION).length).toBeGreaterThan(0);

    for (const clave of Object.keys(ROUTERS_SIN_SESION)) {
      const [archivo] = clave.split(' ');
      expect(fs.existsSync(path.join(SRC, archivo))).toBe(true);
    }
  });
});

// ════════════════════════════════════════════
//  Los cuatro permisos de la venta online
//
//  ── Por qué códigos propios y no `config.*` ──
//
//  TiendaNube arrastra el pendiente 12b desde el hito 7 justamente por reusar
//  `config.ver` / `config.editar`: un permiso cuyo nombre no dice lo que abre no
//  se puede auditar leyendo el catálogo, que es la única forma en que alguien
//  revisa esto.
//
//  Y hay un motivo concreto además del nombre: **`config.editar` es lo que da
//  acceso al certificado y a la clave de AFIP**. Colgar de ahí «puede editar el
//  catálogo» significa que quien publica precios también puede tocar el material
//  fiscal de la empresa.
//
//  ── Por qué el vendedor no toca `catalogo.*` ──
//
//  Prepara y entrega los pedidos: los ve y los mueve de estado. Qué productos
//  salen a la calle y a qué precio es una decisión de negocio, y una regla de
//  precio mal puesta se publica sola en una página sin login.
// ════════════════════════════════════════════

const PERMISOS_DE_VENTA_ONLINE = [
  'catalogo.ver', 'catalogo.editar', 'pedidos.ver', 'pedidos.gestionar',
];

describe('los permisos de la venta online', () => {
  it('los cuatro están en el catálogo, con su módulo propio', () => {
    for (const codigo of PERMISOS_DE_VENTA_ONLINE) {
      expect(CATALOGO).toContain(codigo);
    }

    // El módulo es lo que agrupa la pantalla de Equipo. `catalogo` y `pedidos`,
    // no `config`.
    expect(SEED).toMatch(/codigo: 'catalogo\.ver'[^}]*modulo: 'catalogo'/);
    expect(SEED).toMatch(/codigo: 'pedidos\.ver'[^}]*modulo: 'pedidos'/);
  });

  it('un vendedor ve y gestiona pedidos, y NO edita catálogos', () => {
    expect(POR_ROL.vendedor).toContain('pedidos.ver');
    expect(POR_ROL.vendedor).toContain('pedidos.gestionar');

    expect(POR_ROL.vendedor).not.toContain('catalogo.ver');
    expect(POR_ROL.vendedor).not.toContain('catalogo.editar');
  });

  it('ningún permiso nuevo hereda de config.*', () => {
    // Que ninguno de los cuatro SEA `config.algo` es trivial; lo que esta regla
    // sostiene es que el rol que tiene la venta online no la recibió **por**
    // tener config: `gerente` los tiene los cuatro y tiene `config.ver`, pero
    // no `config.editar`.
    for (const codigo of PERMISOS_DE_VENTA_ONLINE) {
      expect(codigo.startsWith('config.')).toBe(false);
    }

    expect(POR_ROL.gerente).toContain('catalogo.editar');
    expect(POR_ROL.gerente).not.toContain('config.editar');
  });

  it('producción y compras no reciben ninguno', () => {
    for (const codigo of PERMISOS_DE_VENTA_ONLINE) {
      expect(rolesCon(codigo)).not.toContain('produccion');
      expect(rolesCon(codigo)).not.toContain('compras');
    }
  });

  it('admin los recibe por ser el catálogo entero, sin enumerarlos', () => {
    for (const codigo of PERMISOS_DE_VENTA_ONLINE) {
      expect(POR_ROL.admin).toContain(codigo);
    }
  });
});
