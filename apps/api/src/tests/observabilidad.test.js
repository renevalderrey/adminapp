// ════════════════════════════════════════════
//  Observabilidad: id de request, respuestas de error y envio de email
//
//  Los tres hallazgos que cubre este archivo tienen la misma forma: el sistema
//  seguia andando y no decia nada. Un 500 sin log, un 500 sin identificador, y
//  un email que se daba por enviado sin haberse enviado.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const requestId = require('../middleware/requestId');
const { fallo, ErrorDeNegocio } = require('../utils/errores');

/** Dobles minimos de req/res, suficientes para lo que se ejercita. */
function fingirReq(extra = {}) {
  return {
    headers: {},
    originalUrl: '/api/ventas',
    method: 'POST',
    empresaId: 7,
    userId: 'auth0|abc',
    ...extra,
  };
}

function fingirRes() {
  return {
    headersSent: false,
    statusCode: null,
    cuerpo: null,
    cabeceras: {},
    setHeader(k, v) { this.cabeceras[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.cuerpo = b; return this; },
  };
}

describe('middleware requestId', () => {
  it('genera un id y lo devuelve en la cabecera', () => {
    const req = fingirReq();
    const res = fingirRes();
    let siguiente = false;

    requestId(req, res, () => { siguiente = true; });

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.cabeceras['X-Request-Id']).toBe(req.id);
    expect(siguiente).toBe(true);
  });

  it('reusa el id que viene del proxy, para poder seguir el request entre saltos', () => {
    const req = fingirReq({ headers: { 'x-request-id': 'abc123def456' } });
    const res = fingirRes();

    requestId(req, res, () => {});

    expect(req.id).toBe('abc123def456');
  });

  it('descarta un id con salto de linea: partiria el log en dos', () => {
    const req = fingirReq({
      headers: { 'x-request-id': 'valido\nnivel=error msg="linea falsa"' },
    });
    const res = fingirRes();

    requestId(req, res, () => {});

    expect(req.id).not.toContain('\n');
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('descarta un id demasiado corto o demasiado largo', () => {
    for (const entrante of ['x', 'a'.repeat(200)]) {
      const req = fingirReq({ headers: { 'x-request-id': entrante } });
      requestId(req, fingirRes(), () => {});
      expect(req.id).not.toBe(entrante);
    }
  });
});

describe('fallo()', () => {
  it('responde 500 con el mensaje en castellano y el id, sin filtrar el error', () => {
    const req = fingirReq({ id: 'req-1' });
    const res = fingirRes();
    const err = new Error('relation "sales" does not exist at character 42');

    fallo(req, res, err, 'Error al registrar la venta');

    expect(res.statusCode).toBe(500);
    expect(res.cuerpo).toEqual({
      ok: false,
      error: 'Error al registrar la venta',
      requestId: 'req-1',
    });

    // Lo importante: el detalle interno NO viaja al cliente.
    expect(JSON.stringify(res.cuerpo)).not.toContain('relation');
  });

  it('deja pasar el mensaje de un ErrorDeNegocio, que si es para el usuario', () => {
    const req = fingirReq({ id: 'req-2' });
    const res = fingirRes();
    const err = new ErrorDeNegocio('Stock insuficiente en "Deposito" para "Harina"');

    fallo(req, res, err, 'Error al transferir stock');

    expect(res.statusCode).toBe(400);
    expect(res.cuerpo.error).toBe('Stock insuficiente en "Deposito" para "Harina"');
    expect(res.cuerpo.requestId).toBe('req-2');
  });

  it('no vuelve a escribir si la respuesta ya salio', () => {
    const req = fingirReq({ id: 'req-3' });
    const res = fingirRes();
    res.headersSent = true;

    fallo(req, res, new Error('tarde'), 'Error');

    expect(res.statusCode).toBeNull();
    expect(res.cuerpo).toBeNull();
  });
});

describe('sendEmail sin RESEND_API_KEY', () => {
  it('devuelve ok:false — antes decia ok:true y el email no salia', () => {
    jest.resetModules();
    const anterior = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    const { sendEmail } = require('../services/email');

    return sendEmail({ to: 'alguien@ejemplo.com', subject: 'x', html: '<p>x</p>' })
      .then((r) => {
        expect(r.ok).toBe(false);
        expect(r.enviado).toBe(false);
        expect(r.error).toBe('EMAIL_NO_CONFIGURADO');
      })
      .finally(() => {
        if (anterior !== undefined) process.env.RESEND_API_KEY = anterior;
        jest.resetModules();
      });
  });
});

// ════════════════════════════════════════════
//  Guardias estaticas
//
//  Del mismo estilo que las de aislamientoEmpresas.test.js: leen el fuente y
//  fallan si el patron peligroso reaparece.
// ════════════════════════════════════════════

const SRC = path.join(__dirname, '..');
const RUTAS = path.join(SRC, 'routes');

function leerRutas() {
  return fs.readdirSync(RUTAS)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ nombre: f, contenido: fs.readFileSync(path.join(RUTAS, f), 'utf8') }));
}

/**
 * Los .js de un directorio de `src/`, con el nombre prefijado.
 *
 * `leerRutas()` mira **solo** `routes/`, y por eso las guardias de este archivo
 * nunca vieron nada de `services/` ni de `utils/`. Este lector es el que
 * necesitan las reglas que son del repositorio y no de las rutas.
 */
function leerCarpeta(subdir) {
  const dir = path.join(SRC, subdir);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({
      nombre: `${subdir}/${f}`,
      contenido: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

describe('Toda ruta con :empresaId tiene que validar que sea la propia', () => {
  // checkPermission verifica el permiso en la empresa ACTIVA del usuario, no en
  // la de la URL. Sin requireEmpresaPropia, cambiar el numero de la URL alcanza
  // para operar sobre otra empresa cliente.
  it.each(leerRutas())('$nombre', ({ contenido }) => {
    const sinGuardia = contenido
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) =>
        /^router\.(get|post|put|delete|patch)\(\s*['"`][^'"`]*:empresaId/.test(texto) &&
        !texto.includes('requireEmpresaPropia'))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(sinGuardia).toEqual([]);
  });
});

describe('No se consulta por un id del cliente sin acotar a la empresa', () => {
  // El patron `where: { algo_id: req.params.id }` sin empresa_id fue la fuga
  // que quedo abierta en el historial de costos y en las recetas.
  const PATRON = /where:\s*\{\s*\w+_id:\s*req\.(params|query|body)\.\w+\s*\}/;

  // Excepciones legitimas: el recurso padre ya se resolvio con scoping de
  // empresa unas lineas antes, y estas consultas operan sobre sus hijos.
  const EXCEPCIONES = {
    'suppliers.js': [
      'await SupplierDocument.destroy({ where: { supplier_id: req.params.id }, transaction: t });',
      'await SupplierMovement.destroy({ where: { supplier_id: req.params.id }, transaction: t });',
      'await SupplierOrder.destroy({ where: { supplier_id: req.params.id }, transaction: t });',
    ],
  };

  it('la lista de excepciones de suppliers.js no crecio', () => {
    // FR-068: la lista de excepciones **no puede crecer**. Son las tres lineas
    // del DELETE que borran los hijos del proveedor, y el padre ya se resolvio
    // con empresa_id unas lineas antes.
    //
    // El hito 012 le agrego a ese handler el chequeo de saldo (T1221) —una
    // consulta mas, ANTES de los tres destroy— y no toco las tres lineas. Esta
    // prueba es la que hace que eso siga siendo verdad.
    expect(EXCEPCIONES['suppliers.js']).toHaveLength(3);

    // ⚠ Y las tres siguen escritas TAL CUAL: la exencion es un match exacto
    // sobre la linea recortada, asi que un cambio de espaciado la rompe y la
    // linea vuelve a aparecer como un hallazgo de aislamiento que no lo es.
    // Sin este segundo bloque, el falso positivo se descubre corriendo la suite
    // entera y sin saber que lo causo.
    const { contenido } = leerRutas().find((r) => r.nombre === 'suppliers.js');
    const lineas = contenido.split('\n').map((l) => l.trim());

    for (const excepcion of EXCEPCIONES['suppliers.js']) {
      expect(lineas).toContain(excepcion);
    }
  });

  it.each(leerRutas())('$nombre', ({ nombre, contenido }) => {
    const permitidas = EXCEPCIONES[nombre] || [];

    const hallazgos = contenido
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) =>
        PATRON.test(texto) &&
        !texto.includes('empresa_id:') &&
        !texto.startsWith('//') &&
        !permitidas.includes(texto))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(hallazgos).toEqual([]);
  });
});

describe('Ningun catch responde 500 con el mensaje del error', () => {
  // `res.status(500).json({ error: err.message })` hacia dos cosas malas a la
  // vez: no logueaba nada y le mandaba al cliente nombres de tabla y de
  // constraint. Se reemplazo por fallo() en los 79 lugares donde aparecia.
  const PATRON = /res\.status\(500\)[\s\S]{0,80}?err\.message/;

  it.each(leerRutas())('$nombre', ({ contenido }) => {
    const hallazgos = contenido
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) => PATRON.test(texto) && !texto.startsWith('//'))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(hallazgos).toEqual([]);
  });
});

// ════════════════════════════════════════════
//  Nadie escribe en el log por fuera del logger
//
//  `utils/logger.js:63-67` redacta `access_token`, `*.access_token`,
//  `tiendanube_access_token`, el SQL y los parametros de un error de Sequelize;
//  `config/sentry.js:55` los tapa **antes** de salir a un tercero. Las dos cosas
//  viven adentro del logger: `console.error` no pasa por ninguna.
//
//  El caso medido: `services/tiendanubeService.js:35` imprimia
//  `error.response?.data` del canje del `code` de OAuth. O sea, la respuesta que
//  trae el `access_token`. Era la UNICA linea de esa integracion por la que un
//  secreto podia llegar a un log, y era justo la que esquivaba el filtro.
//
//  La regla es del repositorio y no de TiendaNube, asi que se mira `routes/`,
//  `services/` y `utils/` enteros.
// ════════════════════════════════════════════

/**
 * Las lineas que usan `console.error`, con su numero.
 *
 * ⚠ El patron NO exige el parentesis a proposito, y por eso el filtro de
 * comentarios es lo que sostiene la guardia: `routes/suppliers.js:56` menciona
 * `console.error` **adentro de un JSDoc** —explicando un defecto viejo de la
 * pantalla— y sin ese filtro la guardia naceria en rojo por una explicacion.
 * Una guardia que empieza en rojo por un comentario es una guardia que alguien
 * desactiva el mismo dia.
 */
function usosDeConsoleError(contenido) {
  return contenido
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => /console\.error/.test(texto)
      && !texto.startsWith('//')
      && !texto.startsWith('*'))
    .map(({ n, texto }) => `L${n}: ${texto}`);
}

const MUESTRA_CONSOLE_MALA = `
  async getAccessToken(code, empresaId) {
    try {
      return await canjear(code);
    } catch (error) {
      console.error('Error al obtener token TiendaNube:', error.response?.data);
      throw new Error('No se pudo autenticar con TiendaNube');
    }
  }
`;

const MUESTRA_CONSOLE_COMENTADA = `
/**
 * Ese espacio llegaba a una columna INTEGER, Postgres respondia 500 y el catch
 * de la pantalla hacia console.error: la lista quedaba con lo anterior y sin
 * ningun aviso.
 */
// Antes de dfd7009 esto era un console.error y el token salia sin redactar.
router.get('/', checkPermission('proveedores.ver'), async (req, res) => {
  logger.info({ empresaId: req.empresaId }, 'proveedores: listado');
});
`;

describe('Ningun archivo de routes/, services/ ni utils/ usa console.error', () => {
  const archivos = [...leerCarpeta('routes'), ...leerCarpeta('services'), ...leerCarpeta('utils')];

  it('leyo los tres directorios y ninguno vino vacio', () => {
    // El ancla. `leerRutas()` mira solo `routes/`, y una guardia que copiara ese
    // lector recorreria un tercio de lo que dice recorrer **en verde**. Este
    // repositorio ya tuvo dos guardias asi.
    for (const subdir of ['routes', 'services', 'utils']) {
      expect(archivos.filter((a) => a.nombre.startsWith(`${subdir}/`)).length).toBeGreaterThan(3);
    }

    expect(archivos.length).toBeGreaterThan(35);
  });

  it('el detector encuentra la forma y la nombra con archivo y linea', () => {
    const hallazgos = usosDeConsoleError(MUESTRA_CONSOLE_MALA);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain('L6:');
    expect(hallazgos[0]).toContain('error.response?.data');
  });

  it('la guardia distingue un console.error de una linea que lo menciona en un comentario', () => {
    // Sin este caso, el filtro de comentarios se puede sacar «para simplificar»
    // y la guardia pasa a nombrar el JSDoc de suppliers.js, que es un falso
    // positivo — y un falso positivo se cierra con una excepcion, que es como
    // una guardia deja de servir.
    expect(usosDeConsoleError(MUESTRA_CONSOLE_COMENTADA)).toEqual([]);
  });

  it.each(archivos)('$nombre', ({ contenido }) => {
    expect(usosDeConsoleError(contenido)).toEqual([]);
  });
});

// ════════════════════════════════════════════
//  src/controllers/ no existe
//
//  Era el unico directorio del servidor que NINGUNA de las cinco guardias
//  estaticas miraba: `aislamientoEmpresas.test.js` recorre routes/, services/ y
//  utils/; `observabilidad.test.js` y `permisosDeRutas.test.js`, solo routes/.
//  Tenia exactamente un archivo, `tiendanube.js`, y adentro un `create` que
//  colgaba una fila de un producto que nadie habia validado: el mismo IDOR que
//  dfd7009 cerro en los pagos a proveedores, respondiendo 201.
//
//  El archivo se disolvio en routes/tiendanube.js. Esta guardia existe porque
//  no alcanza con no volver a usar el directorio: cada guardia que se escriba
//  de ahora en mas vuelve a nacer con su lista de directorios, y la lista de
//  directorios de una guardia es exactamente el lugar donde nadie mira.
// ════════════════════════════════════════════

describe('src/controllers/ no vuelve a existir', () => {
  it('el chequeo sabe reconocer un directorio que SI existe', () => {
    // El ancla: sin esto, un error de tipeo en la ruta —o un __dirname que
    // cambie de lugar— dejaria la prueba de abajo en verde para siempre,
    // afirmando la ausencia de algo que nunca busco.
    expect(fs.existsSync(path.join(SRC, 'routes'))).toBe(true);
    expect(fs.existsSync(path.join(SRC, 'services'))).toBe(true);
    expect(fs.existsSync(path.join(SRC, 'utils'))).toBe(true);
  });

  it('src/controllers/ no existe: es el directorio que ninguna guardia miraba', () => {
    expect(fs.existsSync(path.join(SRC, 'controllers'))).toBe(false);
  });
});

// ════════════════════════════════════════════
//  El webhook de TiendaNube tiene que recibir el CUERPO CRUDO
//
//  ── Que rompia, exactamente ──
//
//  `routes/tiendanube.js` monta su propio `express.json({ type, verify })` para
//  guardar el cuerpo crudo en `req.rawBody`, que es contra lo que se verifica la
//  firma HMAC. body-parser **no ejecuta el `verify` si el cuerpo ya viene
//  parseado**: con `app.use(express.json({ limit: '10mb' }))` montado antes,
//  `req.rawBody` quedaba `undefined`, `firmaValida` cortaba ahi y **todo webhook
//  respondia 401**.
//
//  Las dos consecuencias: ningun pedido de la tienda online desconto stock
//  jamas, y el 401 repetido apaga la integracion del otro lado —TiendaNube
//  deshabilita el webhook ante errores repetidos, y el comentario del propio
//  archivo lo decia mientras el codigo hacia lo contrario—.
//
//  ── Por que esto es una guardia y no un test de integracion ──
//
//  El de integracion existe y es el que prueba que el cuerpo LLEGA
//  (`integracion/tiendanubeWebhook.integracion.test.js`). Esta guardia es lo
//  unico que impide que el proximo `app.use` que alguien agregue arriba vuelva a
//  matar la integracion sin que nadie se entere: el sintoma no aparece en
//  ninguna pantalla, aparece en un recuento de inventario meses despues.
// ════════════════════════════════════════════

/** El montaje del router publico, textual. */
const MONTAJE_PUBLICO = "app.use('/api/tiendanube', require('./routes/tiendanube').publico)";

/** El parser global que le come el cuerpo. */
const JSON_GLOBAL = 'app.use(express.json(';

/**
 * El fuente sin las lineas de comentario.
 *
 * ⚠ Hace falta y no es prolijidad: el motivo por el que este montaje esta donde
 * esta ocupa veinte lineas de comentario **arriba del propio montaje**, y ahi se
 * nombran las dos lineas que esta guardia busca. Sin sacar los comentarios, el
 * `indexOf` encuentra primero la explicacion y la guardia mide la prosa en vez
 * del codigo — medido: daba en rojo con el orden correcto.
 */
function sinComentarios(contenido) {
  return contenido
    .split('\n')
    .filter((linea) => {
      const texto = linea.trim();
      return !texto.startsWith('//') && !texto.startsWith('*') && !texto.startsWith('/*');
    })
    .join('\n');
}

/**
 * ¿El montaje del router publico esta ANTES del `express.json` global?
 *
 * Devuelve `null` —y no `true`— cuando falta alguna de las dos lineas: una
 * guardia que no encontro que mirar tiene que fallar, no pasar. Es el modo de
 * falla que este repositorio viene juntando.
 */
function montajePublicoAntesDelJson(contenido) {
  const codigo = sinComentarios(contenido);
  const publico = codigo.indexOf(MONTAJE_PUBLICO);
  const parser = codigo.indexOf(JSON_GLOBAL);

  if (publico === -1 || parser === -1) return null;

  return publico < parser;
}

const MUESTRA_MONTAJE_MALA = `
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/api/', limiter);
app.use('/api/tiendanube', require('./routes/tiendanube').publico);
`;

const MUESTRA_MONTAJE_BUENA = `
app.use(cors({ origin: true }));
app.use('/api/tiendanube', require('./routes/tiendanube').publico);
app.use(express.json({ limit: '10mb' }));
app.use('/api/', limiter);
`;

describe('El router publico de TiendaNube se monta antes del express.json global', () => {
  const server = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');

  it('la guardia reconoce el orden de hoy —el defecto— y lo llama defecto', () => {
    // Sin esta muestra, la guardia podria estar comparando dos `-1` y pasando
    // siempre. Es el orden EXACTO que tenia server.js hasta este hito.
    expect(montajePublicoAntesDelJson(MUESTRA_MONTAJE_MALA)).toBe(false);
  });

  it('la guardia deja pasar el orden correcto', () => {
    expect(montajePublicoAntesDelJson(MUESTRA_MONTAJE_BUENA)).toBe(true);
  });

  it('un comentario que NOMBRA el parser global no la confunde', () => {
    // Es el caso real: el motivo del movimiento esta escrito arriba del montaje y
    // menciona las dos lineas. Sin el filtro de comentarios esta guardia daba en
    // rojo con el orden correcto, y una guardia que empieza en rojo por una
    // explicacion es una guardia que alguien desactiva el mismo dia.
    const conProsa = `
// Sube arriba de app.use(express.json( porque si no no hay rawBody, y ademas
// queda antes de app.use('/api/', limiter).
app.use('/api/tiendanube', require('./routes/tiendanube').publico);
app.use(express.json({ limit: '10mb' }));
`;

    expect(montajePublicoAntesDelJson(conProsa)).toBe(true);
  });

  it('si alguna de las dos lineas desaparece, la guardia NO dice que esta bien', () => {
    // Un renombre del router —o sacar el parser global— dejaria la guardia
    // afirmando algo que no miro. Devuelve null y la asercion de abajo falla.
    expect(montajePublicoAntesDelJson('app.use(express.json({ limit: "10mb" }));')).toBeNull();
    expect(montajePublicoAntesDelJson(MONTAJE_PUBLICO)).toBeNull();
  });

  it('server.js monta el publico ANTES del parser global: sin esto no hay rawBody', () => {
    expect(montajePublicoAntesDelJson(server)).toBe(true);
  });

  it('y por lo tanto tambien antes del rate limiter pensado para el navegador', () => {
    // FR-029, y sale del mismo movimiento: 600 requests por IP cada 15 minutos
    // estan pensados para las cajas de un comercio detras de un router. Un 429 al
    // webhook es un pedido que no descuenta, y las IP de TiendaNube no son las de
    // nadie sentado en una caja.
    const codigo = sinComentarios(server);
    const publico = codigo.indexOf(MONTAJE_PUBLICO);
    const limiter = codigo.indexOf("app.use('/api/', limiter)");

    expect(publico).toBeGreaterThanOrEqual(0);
    expect(limiter).toBeGreaterThanOrEqual(0);
    expect(publico).toBeLessThan(limiter);
  });

  it('el router privado sigue detras de la cadena de autenticacion', () => {
    // El movimiento es del publico y solo del publico: subir tambien el privado
    // dejaria once endpoints con datos de una empresa abiertos a internet.
    expect(server).toContain(
      "app.use('/api/tiendanube', ...authEmpresa, require('./routes/tiendanube').privado)"
    );
  });
});

// ════════════════════════════════════════════
//  Ninguna llamada saliente queda sin `timeout`
//
//  ── Que pasaba, exactamente ──
//
//  Las tres llamadas de `services/tiendanubeService.js` —el canje del `code`, el
//  catalogo y el PUT de stock— no tenian ninguna. Un `axios` sin `timeout` no
//  tiene tope: si el otro lado acepta la conexion y no contesta nunca, el
//  request de AdminApp **espera para siempre** y se queda con una conexion del
//  pool. Con unas cuantas, el resto de la aplicacion se queda sin conexiones y
//  el sintoma no se parece en nada a «TiendaNube no contesta»: se parece a
//  «AdminApp esta caido».
//
//  El precedente contrario esta escrito y comentado en `afipService.js:86-89`,
//  con el motivo: «Sin timeout, una llamada colgada a AFIP queda esperando para
//  siempre».
//
//  ── Por que la regla es del repositorio y no de TiendaNube ──
//
//  Hoy `axios` se usa en un solo archivo, y por eso una guardia acotada a el
//  pasaria en verde el dia que alguien integre otro tercero en otro lado. Se
//  miran `routes/`, `services/` y `utils/` enteros, igual que la del
//  `console.error`.
// ════════════════════════════════════════════

/**
 * El fuente con las lineas de comentario en blanco, **conservando los saltos**.
 *
 * `sinComentarios` las borra, y eso corre los numeros de linea: un hallazgo
 * reportado en la L40 de un texto acortado manda a leer otra cosa. Acá el número
 * de línea es lo único que hace accionable el reporte.
 */
function comentariosEnBlanco(contenido) {
  return contenido
    .split('\n')
    .map((linea) => {
      const texto = linea.trim();
      const esComentario = texto.startsWith('//') || texto.startsWith('*') || texto.startsWith('/*');
      return esComentario ? '' : linea;
    })
    .join('\n');
}

/** El indice del parentesis que cierra al que abre en `desde`. */
function cierreDelParentesis(texto, desde) {
  let nivel = 0;

  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === '(') nivel++;
    else if (texto[i] === ')') {
      nivel--;
      if (nivel === 0) return i;
    }
  }

  return -1;
}

/**
 * Las llamadas de axios de un archivo, con sus argumentos completos.
 *
 * Se recorta con parentesis balanceados y no con una expresion regular: los
 * argumentos de una llamada real traen objetos con parentesis adentro
 * (`\${credentials.user_id}`, `fn(...)`), y un `[^)]*` cortaria en el primer
 * cierre y daria por «sin timeout» a una llamada que lo tiene tres lineas mas
 * abajo. Un falso positivo se cierra con una excepcion, que es como una guardia
 * deja de servir.
 */
function llamadasDeAxios(contenido) {
  const codigo = comentariosEnBlanco(contenido);
  const encontradas = [];

  for (const m of codigo.matchAll(/\baxios\s*\.\s*(get|post|put|patch|delete|request)\s*\(/g)) {
    const abre = codigo.indexOf('(', m.index + m[0].length - 1);
    const cierra = cierreDelParentesis(codigo, abre);
    if (cierra === -1) continue;

    encontradas.push({
      linea: codigo.slice(0, m.index).split('\n').length,
      metodo: m[1],
      argumentos: codigo.slice(abre, cierra + 1),
    });
  }

  return encontradas;
}

const llamadasSinTimeout = (contenido) =>
  llamadasDeAxios(contenido)
    .filter(({ argumentos }) => !/\btimeout\s*:/.test(argumentos))
    .map(({ linea, metodo }) => `L${linea}: axios.${metodo}(`);

const MUESTRA_AXIOS_SIN_TIMEOUT = `
  async getProducts(empresaId) {
    const response = await axios.get(
      \`https://api.tiendanube.com/v1/\${credentials.user_id}/products\`,
      {
        headers: {
          'Authentication': \`bearer \${credentials.access_token}\`,
        }
      }
    );

    return response.data;
  }
`;

const MUESTRA_AXIOS_CON_TIMEOUT = `
  async getProducts(empresaId) {
    const response = await axios.get(
      \`https://api.tiendanube.com/v1/\${credentials.user_id}/products\`,
      {
        headers: { 'Authentication': \`bearer \${credentials.access_token}\` },
        timeout: 15000,
      }
    );

    return response.data;
  }
`;

const MUESTRA_AXIOS_COMENTADA = `
// Antes esto era un axios.get( sin timeout y el request quedaba colgado.
/**
 * Ver tambien axios.put( en updateVariantStock.
 */
const TIMEOUT_TIENDANUBE_MS = 15000;
`;

describe('Ninguna llamada de axios de routes/, services/ ni utils/ queda sin timeout', () => {
  const archivos = [...leerCarpeta('routes'), ...leerCarpeta('services'), ...leerCarpeta('utils')];

  it('el detector encuentra la llamada sin timeout y la nombra con su linea', () => {
    // Sin esta muestra, la guardia podria no estar reconociendo la forma de una
    // llamada y estar pasando en verde sobre todas.
    const hallazgos = llamadasSinTimeout(MUESTRA_AXIOS_SIN_TIMEOUT);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toBe('L3: axios.get(');
  });

  it('el detector NO recorta los argumentos en el primer parentesis que encuentra', () => {
    // Es lo que hace falsa a una guardia escrita con `[^)]*`: los argumentos
    // reales traen `\${credentials.user_id}` y objetos anidados, y el timeout
    // esta despues.
    expect(llamadasSinTimeout(MUESTRA_AXIOS_CON_TIMEOUT)).toEqual([]);
  });

  it('una llamada nombrada en un comentario no cuenta como llamada', () => {
    // El motivo del timeout esta escrito arriba de las llamadas y las nombra.
    // Sin el filtro, la guardia naceria en rojo por una explicacion — y una
    // guardia que empieza en rojo por un comentario es una que alguien desactiva
    // el mismo dia.
    expect(llamadasSinTimeout(MUESTRA_AXIOS_COMENTADA)).toEqual([]);
  });

  it('encontro las llamadas que dice vigilar, y no una lista vacia', () => {
    // **El ancla.** Hoy axios se usa en un solo archivo: si el detector dejara
    // de reconocer la forma, `llamadasSinTimeout` devolveria `[]` para todos y la
    // guardia pasaria sin haber mirado nada.
    const deTiendanube = llamadasDeAxios(
      archivos.find((a) => a.nombre === 'services/tiendanubeService.js').contenido
    );

    expect(deTiendanube.length).toBeGreaterThanOrEqual(3);
    expect(deTiendanube.map((l) => l.metodo).sort()).toEqual(
      expect.arrayContaining(['get', 'post', 'put'])
    );
  });

  it.each(archivos)('$nombre', ({ contenido }) => {
    expect(llamadasSinTimeout(contenido)).toEqual([]);
  });
});
