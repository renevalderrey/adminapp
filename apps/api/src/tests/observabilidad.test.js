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
