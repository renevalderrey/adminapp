// ════════════════════════════════════════════
//  Operador de la plataforma
//
//  Este es el único lugar del sistema donde alguien puede operar sobre una
//  empresa de la que no es miembro. La auditoría del Frente 1 encontró veinte
//  endpoints que hacían eso por accidente; acá se hace a propósito, para un
//  único usuario marcado en la base.
//
//  Lo que estos tests protegen, en orden de gravedad:
//
//   1. Que un usuario normal NO pueda entrar a otra empresa poniendo el header.
//   2. Que `es_superadmin` no se pueda activar por ningún endpoint.
//   3. Que el gate de los módulos no liberados esté en la API y no solo en el
//      menú del frontend.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const requireSuperadmin = require('../middleware/requireSuperadmin');

const SRC = path.join(__dirname, '..');

function fingirRes() {
  return {
    statusCode: null,
    cuerpo: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.cuerpo = b; return this },
  };
}

describe('requireSuperadmin', () => {
  it('deja pasar a un operador de la plataforma', () => {
    const res = fingirRes();
    let siguio = false;

    requireSuperadmin({ usuario: { es_superadmin: true }, headers: {} }, res, () => { siguio = true });

    expect(siguio).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('corta a un usuario normal', () => {
    const res = fingirRes();
    let siguio = false;

    requireSuperadmin({ usuario: { es_superadmin: false }, headers: {} }, res, () => { siguio = true });

    expect(siguio).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it('responde 404 y no 403', () => {
    // Un 403 confirma que el módulo existe y está oculto. Un 404 no le dice
    // nada a quien está probando rutas a mano.
    const res = fingirRes();

    requireSuperadmin({ usuario: {}, headers: {} }, res, () => {});

    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.cuerpo)).not.toMatch(/superadmin|permiso|oculto/i);
  });

  it('corta cuando no hay usuario en el request', () => {
    const res = fingirRes();
    let siguio = false;

    requireSuperadmin({ headers: {} }, res, () => { siguio = true });

    expect(siguio).toBe(false);
    expect(res.statusCode).toBe(404);
  });
});

// ── Guardias estáticas ──

const leer = (relativo) => fs.readFileSync(path.join(SRC, relativo), 'utf8');

describe('Los módulos no liberados están cerrados en la API', () => {
  const server = leer('server.js');

  // Si mañana se libera uno, se saca de esta lista Y del server. Que el test
  // falle al liberar es correcto: obliga a que sea una decisión y no un
  // descuido.
  it.each([
    ['/api/customers', 'clientes y cuenta corriente'],
    ['/api/production', 'producción'],
    ['/api/cashflow', 'flujo de caja'],
    ['/api/taxes', 'impuestos'],
    ['/api/reports', 'reportes'],
  ])('%s (%s) exige superadmin', (ruta) => {
    const linea = server
      .split('\n')
      .find((l) => l.includes(`app.use('${ruta}'`));

    expect(linea).toBeDefined();
    expect(linea).toContain('requireSuperadmin');
  });

  it('las rutas de receta también', () => {
    const products = leer('routes/products.js');

    const rutasDeReceta = products
      .split('\n')
      .filter((l) => /^router\.(get|post|delete)\('\/:id\/recipe'/.test(l.trim()));

    expect(rutasDeReceta.length).toBe(3);

    for (const linea of rutasDeReceta) {
      expect(linea).toContain('requireSuperadmin');
    }
  });
});

describe('es_superadmin no se puede activar desde la API', () => {
  // Un endpoint que otorga superadmin es una escalada de privilegios esperando
  // a que alguien encuentre el IDOR: quien lo llame se vuelve operador de toda
  // la plataforma. Solo se activa con scripts/superadmin.js.
  const carpetas = ['routes', 'services', 'controllers'];

  const archivos = carpetas.flatMap((carpeta) => {
    const dir = path.join(SRC, carpeta);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => ({ nombre: `${carpeta}/${f}`, contenido: fs.readFileSync(path.join(dir, f), 'utf8') }));
  });

  it.each(archivos)('$nombre no escribe es_superadmin', ({ contenido }) => {
    const escrituras = contenido
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) => (
        /es_superadmin\s*[:=]/.test(texto) &&
        !texto.startsWith('//') &&
        !texto.startsWith('*') &&
        // Leerla para decidir sí; escribirla no.
        !/es_superadmin\s*===/.test(texto) &&
        !/es_superadmin\s*!==/.test(texto)
      ))
      .map(({ n, texto }) => `L${n}: ${texto}`);

    expect(escrituras).toEqual([]);
  });
});

describe('El acceso multi-empresa no toca el scoping', () => {
  const auth = leer('middleware/auth.js');

  it('el contexto de superadmin sigue fijando UNA empresa', () => {
    // Lo que se ensancha es qué empresa se puede elegir. Si algún día esto
    // pasara a ser una lista de empresas, todo el scoping por req.empresaId
    // dejaría de alcanzar.
    expect(auth).toMatch(/req\.empresaId = ue\.empresa_id/);
    expect(auth).not.toMatch(/req\.empresaIds\s*=/);
  });

  it('el ensanchamiento exige es_superadmin explícito', () => {
    const linea = auth
      .split('\n')
      .find((l) => l.includes('usuario.es_superadmin'));

    expect(linea).toBeDefined();
    expect(linea).toMatch(/!ue && usuario\.es_superadmin/);
  });

  it('queda registrado en el log', () => {
    // Sin rastro, un operador puede tocar los datos de un cliente y no queda
    // forma de reconstruir qué pasó.
    expect(auth).toMatch(/superadmin: true/);
  });
});
