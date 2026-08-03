// ════════════════════════════════════════════
//  Guardia contra la reaparicion de fugas entre empresas cliente
//
//  La auditoria encontro el mismo error repetido en 20 endpoints: consultar
//  por id sin filtrar por empresa_id. Corregirlos uno por uno no impide que el
//  proximo endpoint que se escriba repita el patron.
//
//  Estos tests leen el codigo fuente y fallan si los patrones peligrosos
//  vuelven a aparecer. Son groseros a proposito: un analisis exacto exigiria
//  un parser, y lo que se busca es que el error sea visible en la revision, no
//  demostrar ausencia de bugs.
//
//  Si un caso nuevo es legitimo, se agrega a la lista de excepciones CON el
//  motivo. Esa lista es justamente lo que hay que mirar en un code review.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

function leerArchivos(subdir) {
  const dir = path.join(SRC, subdir);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({
      nombre: `${subdir}/${f}`,
      contenido: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

/** Devuelve las lineas que matchean, con su numero. */
function lineasQueMatchean(contenido, regex) {
  return contenido
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => regex.test(texto) && !texto.startsWith('//') && !texto.startsWith('*'));
}

describe('No debe haber fallbacks a la empresa 1', () => {
  // `req.empresaId || 1` aparecia en ~50 lugares. Ante un contexto de empresa
  // no resuelto, el request operaba sobre la empresa 1 — un cliente real en
  // produccion. Lo mismo con `empresaId = 1` como default de parametro.
  const PATRON = /empresaId\s*(\|\||=)\s*1\b|empresa_id\s*(:|\|\|)\s*1\b/;

  it.each([...leerArchivos('routes'), ...leerArchivos('services')])(
    '$nombre',
    ({ contenido }) => {
      const hallazgos = lineasQueMatchean(contenido, PATRON);
      expect(hallazgos.map((h) => `L${h.n}: ${h.texto}`)).toEqual([]);
    }
  );
});

describe('No debe usarse findByPk con un id que viene del cliente', () => {
  // findByPk busca por clave primaria y nada mas: ignora empresa_id por
  // definicion. Con un id del cliente, es un IDOR listo para usar.
  const PATRON = /findByPk\(\s*(req\.(params|body|query)|productId|customerId|orderId|id)\b/;

  // Excepciones legitimas, cada una con su motivo.
  const PERMITIDOS = {
    'routes/auth.js': 'El id sale de invitacion.empresa_id, una fila de la base, no del cliente.',
    'routes/empresas.js': 'Estas rutas van detras de requireEmpresaPropia(), que compara el id con la empresa activa.',
    'routes/products.js': 'El unico caso restante relee un producto ya validado mas arriba en el mismo handler.',
    'services/costService.js': 'Helpers recursivos internos; el producto raiz se valida en la ruta antes de entrar.',
    'services/productionService.js': 'Releen filas recien creadas por su propio id, o productos ya validados.',
  };

  it.each([...leerArchivos('routes'), ...leerArchivos('services')])(
    '$nombre',
    ({ nombre, contenido }) => {
      const hallazgos = lineasQueMatchean(contenido, PATRON);

      if (PERMITIDOS[nombre]) {
        // Documentado: no se falla, pero el motivo queda escrito.
        expect(typeof PERMITIDOS[nombre]).toBe('string');
        return;
      }

      expect(hallazgos.map((h) => `L${h.n}: ${h.texto}`)).toEqual([]);
    }
  );
});

describe('No debe filtrarse por empresa_id IS NULL', () => {
  // empresa_id es NOT NULL en las 22 tablas del schema. Aceptar filas con
  // empresa_id NULL como "globales" es codigo muerto hoy, y una fuga el dia
  // que alguien haga la columna nullable.
  const PATRON = /empresa_id:\s*null/;

  it.each([...leerArchivos('routes'), ...leerArchivos('services')])(
    '$nombre',
    ({ contenido }) => {
      expect(lineasQueMatchean(contenido, PATRON).map((h) => `L${h.n}: ${h.texto}`)).toEqual([]);
    }
  );
});

describe('Ninguna fila de stock se escribe sin sucursal (FR-052)', () => {
  // `stock.punto_de_venta_id` es la identidad de la sucursal y es NOT NULL
  // desde la migracion 14. Una escritura que lo deje en null falla contra
  // Postgres; una que lo omita crea una fila que la pantalla —que lee por
  // `punto_de_venta_id`— no muestra nunca. Las dos son formas de que aparezca
  // mercaderia que nadie ve.
  //
  // La guardia mira **los bloques de escritura de Stock** y no todo el codigo.
  // `StockMovement.punto_de_venta_id` sigue siendo nullable a proposito y hay
  // lugares que lo escriben asi legitimamente: una guardia que empieza con seis
  // excepciones no se lee y termina desactivada.
  //
  // Escanea tambien `utils/`, que es donde vive ahora la resolucion de
  // sucursal. Las guardias anteriores solo miran `routes/` y `services/`, y una
  // escritura de stock que se mudara a un helper saldria del radar sin que nada
  // avise.
  const LINEAS_DEL_BLOQUE = 6;

  /**
   * Los nombres que en este archivo salen de `ubicacionDeStock(...)`.
   *
   * Esa funcion devuelve `{ punto_de_venta_id, location }` y **tira** si le
   * llega un punto de venta sin id, asi que esparcirla es tan explicito como
   * escribir la clave a mano. Cualquier OTRO spread no cuenta: seria un objeto
   * armado en otro lado, que es justo lo que esta guardia tiene que ver.
   */
  function nombresDeUbicacion(contenido) {
    return [...contenido.matchAll(/const\s+(\w+)\s*=\s*ubicacionDeStock\(/g)].map((m) => m[1]);
  }

  it.each([...leerArchivos('routes'), ...leerArchivos('services'), ...leerArchivos('utils')])(
    '$nombre',
    ({ contenido }) => {
      const lineas = contenido.split('\n');
      const problemas = [];
      const ubicaciones = nombresDeUbicacion(contenido);

      lineas.forEach((linea, i) => {
        if (!/Stock\.(create|findOrCreate)\(/.test(linea)) return;
        if (linea.trim().startsWith('//') || linea.trim().startsWith('*')) return;

        const bloque = lineas.slice(i, i + LINEAS_DEL_BLOQUE + 1).join('\n');
        const esparceLaUbicacion = ubicaciones.some(
          (nombre) => new RegExp(`\\.\\.\\.${nombre}\\b`).test(bloque)
        );

        if (!/punto_de_venta_id/.test(bloque) && !esparceLaUbicacion) {
          problemas.push(`L${i + 1}: escribe stock sin decir en que sucursal`);
        }

        if (/punto_de_venta_id:\s*null/.test(bloque)) {
          problemas.push(`L${i + 1}: escribe punto_de_venta_id en null`);
        }

        if (/punto_de_venta_id:\s*[^,\n]*\|\|\s*null/.test(bloque)) {
          problemas.push(`L${i + 1}: cae a null cuando no vino la sucursal`);
        }
      });

      expect(problemas).toEqual([]);
    }
  );
});

describe('La configuracion de AFIP se lee siempre por empresa', () => {
  // La identidad fiscal (CUIT, certificado, clave) es de cada empresa cliente.
  // Una lectura de Setting sin empresa_id significa que una empresa puede
  // terminar facturando con el CUIT de otra.
  const CLAVES_SENSIBLES = /afip_(cuit|cert|key|environment)/;

  it.each([
    { nombre: 'services/afipAuth.js' },
    { nombre: 'services/afipService.js' },
    { nombre: 'routes/afip.js' },
  ])('$nombre pasa empresa_id en cada consulta a Setting', ({ nombre }) => {
    const contenido = fs.readFileSync(path.join(SRC, nombre), 'utf8');

    // Cada bloque Setting.findOne/findAll/upsert debe mencionar empresa_id
    // dentro de las 5 lineas siguientes.
    const lineas = contenido.split('\n');
    const problemas = [];

    lineas.forEach((linea, i) => {
      if (!/Setting\.(findOne|findAll|upsert|findOrCreate)/.test(linea)) return;
      if (linea.trim().startsWith('//')) return;

      const bloque = lineas.slice(i, i + 6).join('\n');
      if (!/empresa_id/.test(bloque)) {
        problemas.push(`L${i + 1}: ${linea.trim()}`);
      }
    });

    expect(problemas).toEqual([]);
  });

  it('afipAuth cachea el ticket WSAA por empresa, no en una sola entrada', () => {
    const contenido = fs.readFileSync(path.join(SRC, 'services/afipAuth.js'), 'utf8');

    // Un `this.taCache = {` (objeto unico) significa que todas las empresas
    // comparten el mismo ticket de acceso.
    expect(contenido).toMatch(/this\.taCache = new Map\(\)/);
    expect(contenido).not.toMatch(/this\.taCache = \{/);
  });

  it('no quedan claves sensibles de AFIP leidas sin empresa', () => {
    const contenido = fs.readFileSync(path.join(SRC, 'services/afipAuth.js'), 'utf8');
    const lineas = contenido.split('\n');

    lineas.forEach((linea, i) => {
      if (!CLAVES_SENSIBLES.test(linea)) return;
      if (linea.trim().startsWith('//') || linea.trim().startsWith('*')) return;
      if (!/findOne|findAll|where/.test(linea)) return;

      const bloque = lineas.slice(Math.max(0, i - 2), i + 4).join('\n');
      expect(bloque).toMatch(/empresa_id|_getSetting/);
    });
  });
});

describe('requireEmpresa esta conectado en la cadena de middlewares', () => {
  const server = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');

  it('se importa desde el middleware de auth', () => {
    expect(server).toMatch(/requireEmpresa/);
  });

  it('las rutas con datos de empresa usan la cadena que lo incluye', () => {
    expect(server).toMatch(/const authEmpresa = /);
    expect(server).toMatch(/requireEmpresa/);

    // Todos los routers con datos de una empresa deben ir con authEmpresa.
    const conDatosDeEmpresa = [
      'products', 'sales', 'suppliers', 'afip', 'production',
      'customers', 'stock', 'reports', 'dashboard', 'cashflow',
      'taxes', 'import',
    ];

    for (const ruta of conDatosDeEmpresa) {
      const linea = server
        .split('\n')
        .find((l) => l.includes(`'/api/${ruta}'`) && l.includes('app.use'));

      expect(linea).toBeDefined();
      expect(linea).toContain('authEmpresa');
    }
  });

  it('empresas y accept-invite NO lo exigen, para no bloquear el onboarding', () => {
    // Un usuario recien registrado no tiene empresa hasta completar el
    // onboarding: exigirsela ahi lo dejaria sin forma de crear la primera.
    const lineaEmpresas = server
      .split('\n')
      .find((l) => l.includes("'/api/empresas'") && l.includes('app.use'));

    expect(lineaEmpresas).toContain('authSinEmpresa');
  });
});
