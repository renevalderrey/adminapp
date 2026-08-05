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

const RUTAS = path.join(__dirname, '..', 'routes');

function leerRutas() {
  return fs.readdirSync(RUTAS)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ nombre: f, contenido: fs.readFileSync(path.join(RUTAS, f), 'utf8') }));
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
