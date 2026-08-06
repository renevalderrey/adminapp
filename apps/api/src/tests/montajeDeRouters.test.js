const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Guardia estática · cómo y DÓNDE se monta cada router en server.js
//
//  ── Los dos defectos que cierra, que son distintos ──
//
//  **(1) El tipo.** `server.js` montaba las dos rutas de invitación así:
//
//      app.get('/api/auth/invite/:token', require('./routes/auth'));
//      app.post('/api/auth/accept-invite/:token', ...authSinEmpresa, require('./routes/auth'));
//
//  Un `Router` de Express resuelve la ruta **relativa a su punto de montaje**, y
//  con `app.get` el punto de montaje es la URL entera: adentro del router se
//  buscaba `/`, que no está declarada. Las dos respondían **404 siempre**.
//  Ninguna invitación se pudo aceptar nunca.
//
//  **(2) El orden, que es el que no se ve.** Cambiar `app.get` por `app.use` en
//  el mismo lugar **no arregla nada**, y eso está medido contra el express
//  instalado (5.2.1): cuarenta líneas más arriba está
//  `app.use('/api', ...authEmpresa, require('./routes/general'))`, y los
//  middlewares de un `app.use('/api', …)` corren para todo lo que empiece con
//  `/api`, matchee o no el router de atrás. El 404 se convierte en un 401 —para
//  quien abre el enlace del mail sin haber entrado nunca— o en un 403
//  `NO_EMPRESA` —para el invitado, que por definición todavía no tiene empresa—.
//
//      A (app.use('/api/auth', authRouter) DEBAJO del /api genérico)  -> 403
//      B (app.use('/api/auth', authRouter) ARRIBA  del /api genérico)  -> 200
//
//  Una guardia que verificara **solo el tipo** dejaría pasar exactamente el
//  defecto que este corte vino a arreglar. Por eso son dos reglas.
//
//  ── Por qué la regla de orden NO es «ningún /api/<algo> después del /api» ──
//
//  Así enunciada falla contra **trece montajes que hoy son correctos**
//  (`/api/dashboard`, `/api/stock`, `/api/customers`, …): todos llevan
//  `...authEmpresa`, la misma cadena que el montaje genérico, así que que ésta
//  les corra antes no les cambia absolutamente nada. Una guardia que nace en
//  rojo contra trece líneas sanas es una guardia que alguien desactiva el mismo
//  día.
//
//  Lo que de verdad rompe es que un montaje quede debajo de otro **más fuerte**
//  que el suyo. La regla es:
//
//    > Un montaje de un subcamino de /api cuya cadena NO incluya
//    > `requireEmpresa` tiene que estar ARRIBA del /api genérico.
//
//  ── Por qué esto es una guardia y no un test de integración ──
//
//  Porque **ningún test de integración lo puede ver**. Con `BYPASS_AUTH=true`
//  —que es lo que usan `npm test`, `npm run test:integracion` y las pruebas de
//  navegador— `server.js` clava `req.empresaId = 1` y `requireEmpresa` no
//  dispara nunca: un test de la aceptación pasaría en verde con el orden mal.
//  Esta guardia es la única red, y por eso no se borra creyendo que el test de
//  integración la cubre.
// ════════════════════════════════════════════

const SRC = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');

/** El montaje genérico, contra el que se mide todo lo demás. */
const GENERICO = /^\s*app\.use\(\s*'\/api'\s*,/;

/**
 * Las líneas del archivo con las de comentario en blanco.
 *
 * Se blanquean en vez de sacarse para que el número de línea de cada hallazgo
 * siga siendo el del archivo real: un hallazgo con la línea corrida manda a
 * mirar el lugar equivocado.
 *
 * ⚠ Hace falta, y no es prolijidad. El motivo por el que estos montajes están
 * donde están ocupa treinta líneas de comentario **arriba de ellos**, y ahí se
 * nombran textualmente `app.use('/api', …)` y `app.use('/api/auth', …)`. Sin
 * este filtro la guardia mide la prosa y no el código. Es la lección de
 * `observabilidad.test.js:426-434`, donde el mismo detalle la dejaba en rojo con
 * el orden correcto.
 */
function lineasDeCodigo(contenido) {
  return contenido.split('\n').map((linea) => {
    const texto = linea.trim();
    if (texto.startsWith('//') || texto.startsWith('*') || texto.startsWith('/*')) return '';
    return linea;
  });
}

// ════════════════════════════════════════════
//  Regla 1 · un Router se monta con app.use, nunca con app.get/app.post
// ════════════════════════════════════════════

/**
 * Los montajes de un router hechos con un verbo HTTP, con archivo y línea.
 *
 * Se mira que la línea declare un verbo sobre `app` **y** cargue un archivo de
 * `routes/`: un `app.get('/api/ping', (req, res) => …)` es un handler inline y
 * está bien, lo que no puede haber es un `Router` de por medio.
 */
function routersMontadosConVerbo(contenido) {
  return lineasDeCodigo(contenido).reduce((hallazgos, linea, i) => {
    const verbo = linea.match(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'/);
    if (verbo && linea.includes("require('./routes/")) {
      hallazgos.push(
        `server.js:${i + 1} — app.${verbo[1]}('${verbo[2]}', …) monta un Router: ` +
        'adentro busca "/" y responde 404 siempre. Va con app.use.'
      );
    }
    return hallazgos;
  }, []);
}

// ════════════════════════════════════════════
//  Regla 2 · lo más débil que el /api genérico va arriba de él
// ════════════════════════════════════════════

/**
 * El texto de la declaración `const <nombre> = …`, hasta la próxima declaración
 * o el próximo montaje.
 *
 * Acotarlo importa: `const authEmpresa = …` es un ternario de tres líneas y
 * `const authMiddleware = …` es un bloque de cincuenta con puntos y comas
 * adentro, así que cortar en el primer `;` leería media definición.
 */
function definicionDeCadena(codigo, nombre) {
  const inicio = codigo.indexOf(`const ${nombre} =`);
  if (inicio === -1) return null;

  const resto = codigo.slice(inicio + 1);
  const cortes = [resto.indexOf('\nconst '), resto.indexOf('\napp.')].filter((i) => i >= 0);

  return resto.slice(0, cortes.length ? Math.min(...cortes) : resto.length);
}

/**
 * ¿Esta cadena de middlewares incluye `requireEmpresa`, directo o por spread?
 *
 * Se resuelven los `...otraCadena` en vez de mirar solo el texto propio: el día
 * que alguien escriba `const authEmpresaYAlgo = [...authEmpresa, otro]`, mirar
 * únicamente su cuerpo la clasificaría como débil y la mandaría a subir arriba
 * del genérico, que es lo contrario de lo que corresponde.
 */
function incluyeRequireEmpresa(codigo, nombre, vistos = new Set()) {
  if (vistos.has(nombre)) return false;
  vistos.add(nombre);

  const definicion = definicionDeCadena(codigo, nombre);
  if (definicion === null) return false;
  if (definicion.includes('requireEmpresa')) return true;

  return [...definicion.matchAll(/\.\.\.(\w+)/g)]
    .some((m) => incluyeRequireEmpresa(codigo, m[1], vistos));
}

/**
 * Los montajes de un subcamino de `/api` que quedaron DEBAJO del genérico con
 * una cadena más débil que la suya.
 *
 * ⚠ Devuelve **`null`** —y no `[]`— si no encuentra el montaje genérico. Una
 * guardia que no encontró qué mirar tiene que fallar, no pasar: sin esto, un
 * renombre de `general.js` o un cambio de prefijo la dejarían en verde para
 * siempre sin haber comparado nada. Es la lección de
 * `observabilidad.test.js:504-509`.
 */
function montajesDebilesDebajoDelGenerico(contenido) {
  const lineas = lineasDeCodigo(contenido);
  const codigo = lineas.join('\n');

  const generico = lineas.findIndex((linea) => GENERICO.test(linea));
  if (generico === -1) return null;

  return lineas.reduce((hallazgos, linea, i) => {
    if (i <= generico) return hallazgos;

    const montaje = linea.match(/app\.use\(\s*'(\/api\/[^']*)'/);
    if (!montaje || !linea.includes("require('./routes/")) return hallazgos;

    const cadenas = [...linea.matchAll(/\.\.\.(\w+)/g)].map((m) => m[1]);
    const conEmpresa = cadenas.some((cadena) => incluyeRequireEmpresa(codigo, cadena));

    if (!conEmpresa) {
      hallazgos.push(
        `server.js:${i + 1} — ${montaje[1]} se monta sin requireEmpresa DEBAJO del ` +
        `app.use('/api', …) de la línea ${generico + 1}: el request nunca llega a su handler.`
      );
    }

    return hallazgos;
  }, []);
}

// ════════════════════════════════════════════
//  Las muestras sintéticas
//
//  No son documentación: son lo que sostiene a la guardia el día que el
//  repositorio ya no tenga el defecto. Si alguien afloja un detector, estas
//  pruebas se ponen en rojo aunque server.js esté impecable.
// ════════════════════════════════════════════

/** Las dos cadenas de server.js, reducidas a lo que la guardia les mira. */
const CADENAS = `
const authMiddleware = [checkJwt, extractUser, loadEmpresaContext];
const authEmpresa = [...authMiddleware, requireEmpresa, checkSubscription];
const authSinEmpresa = [...authMiddleware];
`;

/** El montaje de hoy, textual: es el defecto que este corte arregla. */
const MUESTRA_TIPO_MALA = `${CADENAS}
app.use('/api', ...authEmpresa, require('./routes/general'));
app.get('/api/auth/invite/:token', require('./routes/auth'));
app.post('/api/auth/accept-invite/:token', ...authSinEmpresa, require('./routes/auth'));
`;

/** El mismo archivo con los dos montajes bien hechos y bien ubicados. */
const MUESTRA_TIPO_BUENA = `${CADENAS}
app.use('/api/auth', require('./routes/auth').publico);
app.use('/api/auth', ...authSinEmpresa, require('./routes/auth').privado);
app.use('/api', ...authEmpresa, require('./routes/general'));
`;

/** El orden de hoy: /api/empresas con authSinEmpresa debajo del genérico. */
const MUESTRA_ORDEN_MALA = `${CADENAS}
app.use('/api', ...authEmpresa, require('./routes/general'));
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));
`;

/** El orden nuevo. */
const MUESTRA_ORDEN_BUENA = `${CADENAS}
app.use('/api/auth', require('./routes/auth').publico);
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));
app.use('/api', ...authEmpresa, require('./routes/general'));
`;

/**
 * La tercera muestra, y es la que impide que la guardia se escriba como la
 * enuncia el plan: un montaje con la MISMA cadena que el genérico puede quedar
 * debajo sin problema, y así están trece de los de hoy.
 */
const MUESTRA_ORDEN_IGUAL_DE_FUERTE = `${CADENAS}
app.use('/api', ...authEmpresa, require('./routes/general'));
app.use('/api/dashboard', ...authEmpresa, require('./routes/dashboard'));
`;

// ════════════════════════════════════════════

describe('un Router nunca se monta con app.get/app.post', () => {
  it('la guardia reconoce el montaje de hoy —el defecto— y lo llama defecto', () => {
    const hallazgos = routersMontadosConVerbo(MUESTRA_TIPO_MALA);

    expect(hallazgos).toHaveLength(2);
    expect(hallazgos[0]).toContain('/api/auth/invite/:token');
    expect(hallazgos[1]).toContain('/api/auth/accept-invite/:token');
  });

  it('la guardia deja pasar los app.use equivalentes', () => {
    // Sin esto la guardia podría estar fallando siempre, que es tan inútil como
    // no fallar nunca: nadie convive con una guardia que no se puede poner en
    // verde.
    expect(routersMontadosConVerbo(MUESTRA_TIPO_BUENA)).toEqual([]);
  });

  it('NO marca un handler inline, que es lo que /api/ping tiene que poder ser', () => {
    const inline = "app.get('/api/ping', (req, res) => res.json({ ok: true }));";

    expect(routersMontadosConVerbo(inline)).toEqual([]);
  });

  it('un comentario que muestra el montaje viejo no la confunde', () => {
    // El motivo del cambio está escrito arriba del montaje y cita la línea de
    // antes. Sin el filtro de comentarios, la guardia nombraría una línea que ya
    // no existe y quedaría en rojo permanente por su propia explicación.
    const conProsa = `
// Antes era app.get('/api/auth/invite/:token', require('./routes/auth')).
app.use('/api/auth', require('./routes/auth').publico);
`;

    expect(routersMontadosConVerbo(conProsa)).toEqual([]);
  });

  it('server.js no monta ningún Router con un verbo HTTP', () => {
    expect(routersMontadosConVerbo(SERVER)).toEqual([]);
  });
});

describe('lo que no exige empresa se monta ARRIBA del /api genérico', () => {
  it('la guardia nombra el montaje débil que quedó debajo, con su línea', () => {
    const hallazgos = montajesDebilesDebajoDelGenerico(MUESTRA_ORDEN_MALA);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain('/api/empresas');
    expect(hallazgos[0]).toContain('server.js:7');
  });

  it('la guardia deja pasar el orden nuevo', () => {
    expect(montajesDebilesDebajoDelGenerico(MUESTRA_ORDEN_BUENA)).toEqual([]);
  });

  it('un montaje con la MISMA cadena que el genérico puede quedar debajo', () => {
    // Es la muestra que impide escribir la regla como «ningún /api/<algo>
    // después del /api»: así enunciada sale roja contra trece montajes que hoy
    // están bien, y una guardia que nace en rojo contra código sano se desactiva
    // el mismo día.
    expect(montajesDebilesDebajoDelGenerico(MUESTRA_ORDEN_IGUAL_DE_FUERTE)).toEqual([]);
  });

  it('resuelve el spread: una cadena armada sobre authEmpresa NO es débil', () => {
    // Sin resolver los `...`, `const authEmpresaYSuperadmin = [...authEmpresa]`
    // se leería como débil y la guardia mandaría a subir arriba del genérico un
    // montaje que está perfecto.
    const derivada = `
const authMiddleware = [checkJwt];
const authEmpresa = [...authMiddleware, requireEmpresa];
const authEmpresaYSuperadmin = [...authEmpresa, requireSuperadmin];

app.use('/api', ...authEmpresa, require('./routes/general'));
app.use('/api/reports', ...authEmpresaYSuperadmin, require('./routes/reports'));
`;

    expect(montajesDebilesDebajoDelGenerico(derivada)).toEqual([]);
  });

  it('si el montaje genérico no aparece, la guardia NO dice que está todo bien', () => {
    // Un renombre de general.js o un cambio de prefijo dejarían la guardia
    // comparando contra nada. Devuelve null y la aserción de más abajo falla,
    // que es lo contrario de pasar por vacío.
    const sinGenerico = `${CADENAS}
app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'));
`;

    expect(montajesDebilesDebajoDelGenerico(sinGenerico)).toBeNull();
  });

  it('server.js: ningún montaje sin requireEmpresa quedó debajo del genérico', () => {
    const hallazgos = montajesDebilesDebajoDelGenerico(SERVER);

    // Que no sea null es la mitad de la afirmación: dice que la guardia
    // encontró el montaje genérico contra el cual medir.
    expect(hallazgos).not.toBeNull();
    expect(hallazgos).toEqual([]);
  });

  it('los tres montajes que necesitan un usuario sin empresa están arriba', () => {
    // La regla de arriba se satisface también borrándolos. Esto fija que las
    // tres líneas existen y que su cadena es la que corresponde: /api/auth
    // público sin ninguna, y las otras dos con authSinEmpresa.
    const lineas = lineasDeCodigo(SERVER);
    const numero = (patron) => lineas.findIndex((l) => l.includes(patron));

    const generico = lineas.findIndex((l) => GENERICO.test(l));
    const publico = numero("app.use('/api/auth', require('./routes/auth').publico)");
    const privado = numero("app.use('/api/auth', ...authSinEmpresa, require('./routes/auth').privado)");
    const empresas = numero("app.use('/api/empresas', ...authSinEmpresa, require('./routes/empresas'))");

    expect(publico).toBeGreaterThanOrEqual(0);
    expect(privado).toBeGreaterThanOrEqual(0);
    expect(empresas).toBeGreaterThanOrEqual(0);

    expect(publico).toBeLessThan(generico);
    expect(privado).toBeLessThan(generico);
    expect(empresas).toBeLessThan(generico);
  });
});

describe('la guardia leyó server.js y no una lista vacía', () => {
  it('encuentra los montajes de routers que dice revisar', () => {
    // El ancla contra el modo de falla de siempre: si mañana los montajes se
    // escriben de otra forma y el detector deja de reconocerlos, las dos reglas
    // de arriba quedan en verde sin haber mirado una sola línea.
    const montajes = lineasDeCodigo(SERVER)
      .filter((linea) => /app\.use\(\s*'\/api/.test(linea) && linea.includes("require('./routes/"));

    expect(montajes.length).toBeGreaterThan(15);
  });

  it('routes/auth.js exporta los dos routers que server.js monta por separado', () => {
    // Sin esto, `require('./routes/auth').publico` sería `undefined` y
    // `app.use` con undefined tira al arrancar — pero recién en producción, no
    // acá. Y la mitad interesante es que el archivo NO vuelva a exportar un
    // router único: con uno solo, el montaje público le abriría también el
    // accept-invite a cualquiera sin sesión.
    const auth = require('../routes/auth');

    expect(typeof auth.publico).toBe('function');
    expect(typeof auth.privado).toBe('function');
    expect(auth.publico).not.toBe(auth.privado);
  });
});
