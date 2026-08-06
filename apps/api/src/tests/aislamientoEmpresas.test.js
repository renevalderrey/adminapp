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

// ════════════════════════════════════════════
//  El padre ajeno: escribir y leer colgado de una fila de otra empresa
//
//  Forma nueva. Ninguna de las guardias de arriba la ve: no hay findByPk, no
//  hay `where: { x_id: req.params.id }`, y la fila que se crea lleva el
//  empresa_id correcto. Aun asi cruza empresas, y hace falta mirar las dos
//  mitades juntas porque cerrar una sola deja el camino abierto:
//
//   1. Un `create` que pone `<algo>_id` con un id que mando el cliente sin
//      haber comprobado que ese padre sea de la empresa. La fila queda con el
//      empresa_id de quien la mando: no parece una fuga.
//   2. Un `include` de un hijo que tiene empresa_id, sin `where`. Sequelize une
//      SOLO por la clave foranea, asi que la fila del punto 1 aparece en la
//      pantalla del otro cliente. Ahi si se ve, y ya con el saldo cambiado.
//
//  Asi entraba un pago en la cuenta corriente de un proveedor de otra empresa:
//  POST /api/suppliers/:id/payments no validaba el proveedor, y los include de
//  GET /api/suppliers no filtraban los movimientos.
//
//  ── Sobre pasar en vacio ──
//
//  Este repositorio ya tuvo dos guardias que pasaban sin verificar nada: una
//  comparaba la posicion de un token que tambien aparecia en un comentario, y
//  otra leia un directorio sin recursion y dejaba afuera media carpeta. Por eso
//  cada detector de aca se ejercita ademas contra una MUESTRA sintetica que
//  contiene el defecto, y se exige que lo encuentre y lo nombre con archivo y
//  linea. Si un refactor hace desaparecer el patron del repositorio, esa prueba
//  sigue afirmando que el detector funciona; y las pruebas de poblacion
//  afirman que ademas leyo los archivos que dice leer.
// ════════════════════════════════════════════

const models = require('../models');

/** Indice del cierre que corresponde a la apertura en `inicio`. */
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

/** true si el modelo existe y su tabla tiene columna empresa_id. */
function esDeEmpresa(nombreDeModelo) {
  const Modelo = models[nombreDeModelo];
  return !!(Modelo && Modelo.rawAttributes && Modelo.rawAttributes.empresa_id);
}

/**
 * Los ambitos donde puede vivir una consulta: handlers de ruta y funciones
 * async de los services.
 *
 * Hace falta el ambito, y no «las N lineas de arriba», por dos motivos: para
 * saber que parametros recibe la funcion (de ahi sale si el id lo eligio el
 * cliente) y para poder mirar TODO lo que pasa antes del create dentro de esa
 * misma funcion (de ahi sale si el padre se valido). Contar lineas fue lo que
 * hizo fragil a mas de una guardia vieja.
 */
function ambitos(contenido) {
  const encontrados = [];

  // ⚠ El router NO siempre se llama `router`. `routes/tiendanube.js` declara
  // DOS —`publico` y `privado`, separados por exposicion a proposito— y con el
  // literal `router.` ninguno de sus handlers era un ambito. La consecuencia es
  // la que muerde al reves: sin ambito, `antes` queda vacio (mas abajo) y
  // NINGUN findScoped escrito en ese archivo cuenta como validacion previa. La
  // guardia reportaria como sinValidar un create que si valido el padre, y un
  // falso positivo se cierra agregando una excepcion — que es exactamente como
  // una guardia deja de servir.
  for (const m of contenido.matchAll(/\b(\w+)\.(get|post|put|delete|patch)\s*\(/g)) {
    const abre = contenido.indexOf('(', m.index + m[0].length - 1);
    encontrados.push({
      ini: m.index,
      fin: cierreDe(contenido, abre, '(', ')'),
      nombre: `${m[1]}.${m[2]}`,
      parametros: ['req', 'res'],
    });
  }

  for (const m of contenido.matchAll(/\basync\s+(\w+)\s*\(/g)) {
    const abre = contenido.indexOf('(', m.index + m[0].length - 1);
    const cierra = cierreDe(contenido, abre, '(', ')');
    const llave = contenido.indexOf('{', cierra);
    if (llave === -1) continue;

    encontrados.push({
      ini: m.index,
      fin: cierreDe(contenido, llave, '{', '}'),
      nombre: m[1],
      parametros: contenido
        .slice(abre + 1, cierra)
        .split(',')
        .map((p) => p.trim().split('=')[0].trim())
        .filter(Boolean),
    });
  }

  return encontrados;
}

const queEnvuelve = (lista, ini, fin) =>
  lista.filter((a) => a.ini < ini && a.fin > fin).sort((a, b) => b.ini - a.ini)[0];

// ── Detector 1: creates colgados de un padre que nadie valido ──

/**
 * De donde salio un identificador que el create pasa en forma corta.
 *
 * `product_id,` a secas no dice nada; lo que importa es que tres lineas mas
 * arriba diga `const { product_id } = req.body`. Sin resolver esa
 * desestructuracion el valor seria el nombre de la clave, y el clasificador no
 * podria distinguir un id que eligio el cliente de una variable que calculo el
 * servidor.
 *
 * ⚠ Se busca en el archivo ENTERO y no solo en el ambito del create, a
 * proposito. El dia que el detector de ambitos no reconozca una forma nueva
 * —que es exactamente el defecto que este hito vino a cerrar— buscar solo ahi
 * devolveria «no vino del cliente» y la guardia se callaria justo cuando mas
 * falta hace. Ante la duda se revisa de mas, que es el lado seguro para
 * equivocarse.
 */
function origenDelIdentificador(clave, contenido) {
  for (const m of contenido.matchAll(/\{([^{}]*)\}\s*=\s*(req\.(?:body|params|query))/g)) {
    // `const { product_id: pid } = req.body` deja como local a `pid`: lo que
    // se compara es el nombre con el que se usa, no el de la propiedad.
    const locales = m[1].split(',').map((n) => n.trim().split(':').pop().trim());
    if (locales.includes(clave)) return `${m[2]}.${clave}`;
  }

  return clave;
}

/**
 * Las claves `<algo>_id` que recibe un create, con el valor de cada una.
 *
 * Reconoce las DOS formas de escribir lo mismo: `product_id: valor` y la forma
 * corta de ES6, `product_id,`. El extractor anterior exigia los dos puntos, asi
 * que contra el objeto de `controllers/tiendanube.js:159` devolvia CERO claves
 * y el bucle hacia `continue` antes de mirar nada: la guardia pasaba en verde
 * sobre el defecto que existe para encontrar, y ese defecto era el mismo IDOR
 * que dfd7009 habia cerrado en los pagos a proveedores.
 *
 * El `(?<![.\w])` deja afuera lo que viene despues de un punto: en
 * `total: fila.product_id` la clave es `total`, y sin ese filtro `product_id`
 * entraria como si fuera una clave del objeto.
 */
function clavesForaneas(argumentos, contenido) {
  return [...argumentos.matchAll(/(?<![.\w])(\w+_id)\s*(?::\s*([^,\n}]+)|(?=\s*[,}]))/g)]
    .filter(([, clave]) => clave !== 'empresa_id')
    .map(([, clave, valor]) => ({
      clave,
      valor: valor === undefined ? origenDelIdentificador(clave, contenido) : valor.trim(),
    }));
}

/**
 * @returns {{ conClaveForanea: object[], delCliente: object[], sinValidar: object[] }}
 *   `conClaveForanea` es la poblacion que el detector reviso —sirve de ancla—;
 *   `sinValidar` es lo que hay que arreglar.
 */
function analizarCreates(nombre, contenido) {
  const conClaveForanea = [];
  const delCliente = [];
  const sinValidar = [];
  const scopes = ambitos(contenido);

  for (const m of contenido.matchAll(/\b([A-Z]\w*)\s*\.\s*(create|bulkCreate|findOrCreate)\s*\(/g)) {
    if (!esDeEmpresa(m[1])) continue;

    const abre = contenido.indexOf('(', m.index + m[0].length - 1);
    const fin = cierreDe(contenido, abre, '(', ')');
    const argumentos = contenido.slice(abre, fin + 1);

    const claves = clavesForaneas(argumentos, contenido);
    if (claves.length === 0) continue;

    const hallazgo = {
      archivo: nombre,
      linea: numeroDeLinea(contenido, m.index),
      escritura: `${m[1]}.${m[2]}`,
    };
    conClaveForanea.push(hallazgo);

    const scope = queEnvuelve(scopes, m.index, fin);
    const parametros = scope ? scope.parametros : [];
    const esConsciente = parametros.some((p) => /^empresa_?[Ii]d$/.test(p));

    const sospechosas = claves.filter(({ valor }) => {
      // `puntoDeVentaId` y `req.puntoDeVentaId` quedan afuera a proposito:
      // middleware/auth.js resuelve la cabecera X-Punto-De-Venta-Id contra la
      // empresa activa y descarta la que no pertenece, asi que para cuando
      // llega aca ya es un id validado. La prueba de mas abajo se encarga de
      // que esa validacion siga existiendo: sin ella, esta excepcion seria un
      // agujero silencioso.
      const base = valor.replace(/\s*\|\|[\s\S]*$/, '').trim();
      if (base === 'puntoDeVentaId' || base === 'req.puntoDeVentaId') return false;

      if (/^req\.(params|body|query)\./.test(valor)) return true;
      return esConsciente && parametros.includes(base);
    });
    if (sospechosas.length === 0) continue;

    const detalle = {
      ...hallazgo,
      claves: sospechosas.map(({ clave, valor }) => `${clave}: ${valor}`).join(', '),
    };
    delCliente.push(detalle);

    // Se acepta como validacion cualquier busqueda del padre acotada a la
    // empresa, hecha antes del create y dentro de la misma funcion.
    const antes = scope ? contenido.slice(scope.ini, m.index) : '';
    const validado = /findScoped(OrFail)?\(/.test(antes) ||
      /find(One|All)\(\s*\{[^;]*?empresa_id/.test(antes);

    if (!validado) {
      sinValidar.push(`${detalle.archivo}:${detalle.linea} — ${detalle.escritura} cuelga de ${detalle.claves} sin validar el padre`);
    }
  }

  return { conClaveForanea, delCliente, sinValidar };
}

// ── Detector 2: includes de hijos con empresa_id sin filtrar ──

/** Valor de una clave del objeto, ignorando lo que este anidado adentro. */
function valorDeClave(bloque, clave) {
  let nivel = 0;

  for (let i = 0; i < bloque.length; i++) {
    const c = bloque[i];
    if (c === '{' || c === '[' || c === '(') { nivel++; continue; }
    if (c === '}' || c === ']' || c === ')') { nivel--; continue; }
    if (nivel !== 1) continue;
    if (!bloque.startsWith(`${clave}:`, i)) continue;
    if (/[\w$]/.test(bloque[i - 1] || ' ')) continue;

    let j = i + clave.length + 1;
    while (j < bloque.length && /\s/.test(bloque[j])) j++;
    if (bloque[j] === '{') return bloque.slice(j, cierreDe(bloque, j, '{', '}') + 1);
    if (bloque[j] === '[') return bloque.slice(j, cierreDe(bloque, j, '[', ']') + 1);
    const coma = bloque.indexOf(',', j);
    return bloque.slice(j, coma === -1 ? bloque.length : coma);
  }

  return null;
}

/**
 * Las asociaciones que pueden estar detras de un `{ model: X, as: 'y' }`.
 *
 * Primero se intenta resolver por el modelo de la consulta —o del include—
 * que lo envuelve, que es la respuesta exacta. Cuando eso no se puede
 * —el include vive en una variable suelta o lo arma un helper— se devuelven
 * TODAS las asociaciones que coinciden en destino y alias: ante la duda se
 * revisa de mas, que es el lado seguro para equivocarse.
 */
function asociacionesPosibles(origen, modelo, alias) {
  if (origen && models[origen] && models[origen].associations && models[origen].associations[alias]) {
    return [models[origen].associations[alias]];
  }

  const candidatas = [];
  for (const M of Object.values(models)) {
    if (!M || !M.associations) continue;
    for (const [as, asoc] of Object.entries(M.associations)) {
      if (as === alias && asoc.target && asoc.target.name === modelo) candidatas.push(asoc);
    }
  }
  return candidatas;
}

/**
 * Un include es «de un hijo con empresa_id» cuando la union la hace la clave
 * foranea del hijo (hasMany / hasOne) y ese hijo tiene columna empresa_id.
 *
 * Queda afuera el caso en que la clave de union ES empresa_id —Empresa
 * hasMany PuntoDeVenta, por ejemplo—: ahi el join ya es el filtro.
 */
const esHijoConEmpresa = (asoc) =>
  (asoc.associationType === 'HasMany' || asoc.associationType === 'HasOne') &&
  asoc.foreignKey !== 'empresa_id' &&
  !!(asoc.target.rawAttributes && asoc.target.rawAttributes.empresa_id);

function analizarIncludes(nombre, contenido) {
  const entradas = [...contenido.matchAll(/\{\s*model:\s*(\w+)\s*,\s*(?:[^{}]*?\s)?as:\s*'([^']+)'/g)]
    .map((m) => ({
      modelo: m[1],
      alias: m[2],
      ini: m.index,
      fin: cierreDe(contenido, m.index, '{', '}'),
    }));

  const consultas = [...contenido.matchAll(/\b([A-Z]\w*)\s*\.\s*(findAll|findOne|findAndCountAll|count|sum)\s*\(/g)]
    .map((m) => {
      const abre = contenido.indexOf('(', m.index + m[0].length - 1);
      return { modelo: m[1], ini: m.index, fin: cierreDe(contenido, abre, '(', ')') };
    });

  const deHijos = [];
  const sinFiltrar = [];

  for (const entrada of entradas) {
    const padre = entradas.filter((o) => o !== entrada && o.ini < entrada.ini && o.fin > entrada.fin);
    const consulta = consultas.filter((c) => c.ini < entrada.ini && c.fin > entrada.fin);
    const envolvente = [...padre, ...consulta].sort((a, b) => b.ini - a.ini)[0];

    const asociaciones = asociacionesPosibles(
      envolvente ? envolvente.modelo : null,
      entrada.modelo,
      entrada.alias
    );
    if (!asociaciones.some(esHijoConEmpresa)) continue;

    const linea = numeroDeLinea(contenido, entrada.ini);
    deHijos.push(`${nombre}:${linea} ${entrada.modelo} as '${entrada.alias}'`);

    const where = valorDeClave(contenido.slice(entrada.ini, entrada.fin + 1), 'where');
    if (!where || !/empresa_id/.test(where)) {
      sinFiltrar.push(`${nombre}:${linea} — include de ${entrada.modelo} as '${entrada.alias}' sin where de empresa_id`);
    }
  }

  return { deHijos, sinFiltrar };
}

// ── Las muestras sinteticas ──
//
// No son documentacion: son lo que sostiene a las dos guardias cuando el
// repositorio deja de tener el defecto. Si alguien afloja un detector, estas
// pruebas se ponen en rojo aunque el codigo real este impecable.

const MUESTRA_CREATE_MALA = `
router.post('/:id/payments', checkPermission('x'), async (req, res) => {
  const movement = await SupplierMovement.create({
    supplier_id: req.params.id,
    empresa_id: req.empresaId,
    amount: req.body.amount,
  });
  res.json({ ok: true, data: movement });
});
`;

const MUESTRA_CREATE_BUENA = `
router.post('/:id/payments', checkPermission('x'), async (req, res) => {
  const supplier = await findScoped(Supplier, req.params.id, req.empresaId);
  if (!supplier) return res.status(404).json({ ok: false });
  const movement = await SupplierMovement.create({
    supplier_id: supplier.id,
    empresa_id: req.empresaId,
    amount: req.body.amount,
  });
  res.json({ ok: true, data: movement });
});
`;

// ── Las dos formas que el detector NO veia hasta el hito 013 ──
//
// Las dos salen del mismo archivo real, `controllers/tiendanube.js:157-164`, y
// cada una por su cuenta alcanzaba para que la guardia pasara en verde:
//
//  · la forma corta de ES6 (`product_id,` sin dos puntos) dejaba el objeto sin
//    ninguna clave que extraer, asi que el create ni se miraba;
//  · el router se llama `privado`, no `router`, asi que el handler no era un
//    ambito y ningun findScoped de ese archivo contaba como validacion.
//
// La segunda muerde al reves que la primera: no tapa un defecto, INVENTA uno.
// Por eso van las dos muestras y no una.

const MUESTRA_CREATE_CORTA_MALA = `
privado.post('/mapping', checkPermission('config.editar'), async (req, res) => {
  const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;

  const mapping = await TiendanubeMapping.create({
    empresa_id: req.empresaId,
    product_id,
    tiendanube_variant_id,
    tiendanube_product_id,
  });

  res.status(201).json({ ok: true, data: mapping });
});
`;

const MUESTRA_CREATE_CORTA_BUENA = `
privado.post('/mapping', checkPermission('config.editar'), async (req, res) => {
  const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;

  const producto = await findScoped(Product, product_id, req.empresaId);
  if (!producto) return res.status(404).json({ ok: false });

  const mapping = await TiendanubeMapping.create({
    empresa_id: req.empresaId,
    product_id: producto.id,
    tiendanube_variant_id,
    tiendanube_product_id,
  });

  res.status(201).json({ ok: true, data: mapping });
});
`;

const MUESTRA_INCLUDE_MALA = `
const suppliers = await Supplier.findAll({
  where: { empresa_id: req.empresaId },
  include: [
    { model: SupplierMovement, as: 'movements' },
  ],
});
`;

const MUESTRA_INCLUDE_BUENA = `
const suppliers = await Supplier.findAll({
  where: { empresa_id: req.empresaId },
  include: [
    { model: SupplierMovement, as: 'movements', where: { empresa_id: req.empresaId }, required: false },
  ],
});
`;

describe('Un create no cuelga una fila de un padre que no se valido', () => {
  const archivos = [...leerArchivos('routes'), ...leerArchivos('services')];
  const analisis = archivos.map(({ nombre, contenido }) => analizarCreates(nombre, contenido));

  it('el detector encuentra la forma y la nombra con archivo y linea', () => {
    const { sinValidar } = analizarCreates('muestra/mala.js', MUESTRA_CREATE_MALA);

    expect(sinValidar).toHaveLength(1);
    expect(sinValidar[0]).toContain('muestra/mala.js:3');
    expect(sinValidar[0]).toContain('supplier_id: req.params.id');
  });

  it('el detector NO se queja cuando el padre se valido antes', () => {
    // Sin esto la guardia podria estar fallando siempre, que es tan inutil
    // como no fallar nunca: nadie convive con una guardia que no se puede
    // poner en verde.
    expect(analizarCreates('muestra/buena.js', MUESTRA_CREATE_BUENA).sinValidar).toEqual([]);
  });

  it('ve el create que cuelga de un product_id escrito en forma corta', () => {
    // El extractor viejo exigia los dos puntos —`/(\w+_id)\s*:\s*…/`— y contra
    // este objeto devolvia CERO claves: el bucle hacia `continue` antes de
    // mirar nada. La guardia pasaba en verde sobre un IDOR identico al que
    // dfd7009 cerro en los pagos a proveedores.
    const { sinValidar } = analizarCreates('muestra/corta.js', MUESTRA_CREATE_CORTA_MALA);

    expect(sinValidar).toHaveLength(1);
    expect(sinValidar[0]).toContain('muestra/corta.js:5');
    expect(sinValidar[0]).toContain('product_id: req.body.product_id');
  });

  it('acepta el findScoped que esta adentro de un handler de un router que no se llama router', () => {
    // La otra mitad, y muerde al reves: sin ambito, `antes` queda vacio y
    // ningun findScoped cuenta. La guardia reportaria un create que SI valido
    // el padre, y ese falso positivo se cierra agregando una excepcion — que es
    // como una guardia deja de servir.
    expect(analizarCreates('muestra/corta-buena.js', MUESTRA_CREATE_CORTA_BUENA).sinValidar).toEqual([]);

    // Y no pasa por vacio: el create SI se miro, con sus claves foraneas.
    const { conClaveForanea } = analizarCreates('muestra/corta-buena.js', MUESTRA_CREATE_CORTA_BUENA);
    expect(conClaveForanea).toHaveLength(1);
  });

  it('leyo los archivos que dice leer', () => {
    // **El ancla.** Sin esto, mover estos creates a otro lado —o cambiar la
    // forma de escribirlos— dejaria a la guardia recorriendo una lista vacia y
    // pasando en verde sin haber mirado nada.
    //
    // ── Que la sostiene, y que impide (hito 012) ──
    //
    // Los dos archivos del arrayContaining son los dos que escriben la cuenta
    // corriente de un proveedor, y cada uno tiene el suyo:
    //
    //   routes/suppliers.js         SupplierMovement.create — el PAGO
    //                               (POST /:id/payments), con findScoped(Supplier
    //                               ...) inmediatamente antes.
    //                               Y SupplierDocument.create, con el mismo
    //                               findScoped adelante.
    //   services/purchaseService.js SupplierMovement.create — la DEUDA que genera
    //                               la recepcion, y SupplierOrder.create.
    //
    // **Consecuencia concreta: el create del pago se QUEDA en
    // routes/suppliers.js y no se muda a un servicio.** Es una restriccion de
    // arquitectura, no un detalle de estilo: es la clase de mudanza que alguien
    // hace «para ordenar» —«los creates van en services/»— y que pone esta ancla
    // en rojo con un arrayContaining que no dice nada sobre que se rompio.
    //
    // El dia que haya que moverlo de verdad: **se mueve el ancla con el y se
    // escribe el motivo ahi mismo**. Nunca se borra. Un ancla borrada deja a la
    // guardia mirando una lista que puede quedar vacia sin que nada avise, que
    // es como este repositorio ya tuvo dos guardias pasando en verde sin
    // verificar nada.
    const conClaveForanea = analisis.flatMap((a) => a.conClaveForanea);
    const porArchivo = [...new Set(conClaveForanea.map((h) => h.archivo))];

    expect(conClaveForanea.length).toBeGreaterThan(10);
    expect(porArchivo).toEqual(expect.arrayContaining([
      'routes/suppliers.js',
      'services/purchaseService.js',
    ]));
  });

  it('el create del mapeo de TiendaNube esta adentro de la poblacion que se revisa', () => {
    // Es la afirmacion entera del hito 013: ese create vivia en
    // `src/controllers/`, el unico directorio del servidor que NINGUNA de las
    // cinco guardias estaticas lee, y por eso colgo una fila de un producto sin
    // validar durante meses —respondiendo 201— y sobrevivio a una auditoria de
    // aislamiento que encontro veintiocho casos.
    //
    // Si alguien lo devuelve a un directorio que esta guardia no recorre, esto
    // se pone en rojo en vez de pasar en verde sin haber mirado nada.
    const conClaveForanea = analisis.flatMap((a) => a.conClaveForanea);
    const delMapeo = conClaveForanea.filter((h) => h.escritura === 'TiendanubeMapping.create');

    expect(delMapeo.map((h) => h.archivo)).toEqual(['routes/tiendanube.js']);
  });

  it('el create del pago sigue viviendo en routes/suppliers.js', () => {
    // El ancla de arriba solo dice «este archivo tiene ALGUN create con clave
    // foranea», y eso lo cumpliria cualquier otro: routes/suppliers.js tiene
    // ademas el de SupplierDocument, asi que mudar el pago a un servicio dejaria
    // el ancla **en verde**. Este caso es el que nombra el archivo.
    const escribenElMovimiento = archivos
      .filter(({ contenido }) => contenido.includes('SupplierMovement.create('))
      .map(({ nombre }) => nombre);

    expect(escribenElMovimiento).toEqual([
      'routes/suppliers.js',          // el pago
      'services/purchaseService.js',  // la deuda de la recepcion
    ]);

    // Y sigue teniendo el findScoped del proveedor delante: es lo que hace que
    // el detector lo de por validado. Sin el, el ancla apuntaria a un create que
    // volvio a colgar una fila de un padre que nadie miro, que es exactamente el
    // agujero que cerro dfd7009.
    const { contenido } = archivos.find((a) => a.nombre === 'routes/suppliers.js');
    const iCreate = contenido.indexOf('SupplierMovement.create(');
    const iHandler = contenido.lastIndexOf("router.post('/:id/payments'", iCreate);

    expect(iHandler).toBeGreaterThan(-1);
    expect(contenido.slice(iHandler, iCreate)).toContain('findScoped(Supplier');
  });

  it.each(archivos)('$nombre', ({ nombre, contenido }) => {
    expect(analizarCreates(nombre, contenido).sinValidar).toEqual([]);
  });
});

describe('La excepcion de puntoDeVentaId sigue estando justificada', () => {
  // El detector de arriba deja pasar `punto_de_venta_id: puntoDeVentaId`
  // porque el middleware valida la cabecera contra la empresa activa. Si esa
  // validacion desapareciera, la excepcion pasaria a tapar una fuga real y
  // nadie se enteraria. Esta prueba es la que ata las dos cosas.
  const auth = fs.readFileSync(path.join(SRC, 'middleware', 'auth.js'), 'utf8');

  it('auth.js resuelve X-Punto-De-Venta-Id contra la empresa activa', () => {
    expect(auth).toMatch(/x-punto-de-venta-id/);

    const consulta = auth.slice(auth.indexOf('PuntoDeVenta.findOne'));
    expect(consulta).toMatch(/empresa_id:\s*req\.empresaId/);
  });
});

describe('Ningun include de un hijo con empresa_id se trae sin filtrar', () => {
  const archivos = [...leerArchivos('routes'), ...leerArchivos('services'), ...leerArchivos('utils')];
  const analisis = archivos.map(({ nombre, contenido }) => analizarIncludes(nombre, contenido));

  it('el detector encuentra la forma y la nombra con archivo y linea', () => {
    const { sinFiltrar } = analizarIncludes('muestra/mala.js', MUESTRA_INCLUDE_MALA);

    expect(sinFiltrar).toHaveLength(1);
    expect(sinFiltrar[0]).toContain('muestra/mala.js:5');
    expect(sinFiltrar[0]).toContain("SupplierMovement as 'movements'");
  });

  it('el detector NO se queja cuando el include filtra por empresa', () => {
    expect(analizarIncludes('muestra/buena.js', MUESTRA_INCLUDE_BUENA).sinFiltrar).toEqual([]);
  });

  it('encuentra los tres includes de hijos con empresa_id que tiene que mirar', () => {
    // **El ancla, y se lee en las DOS direcciones.**
    //
    // Si SUBE, hay un include nuevo de un hijo con empresa_id y **hay que
    // leerlo**, no ajustar el numero.
    //
    // Si BAJA es igual de sospechoso: o algun include dejo de existir —y
    // entonces hay que saber cual y por que— o el detector dejo de reconocer la
    // forma, y la guardia estaria recorriendo menos de lo que cree, en verde. El
    // comentario anterior solo advertia sobre subir; bajar merece la misma
    // lectura.
    //
    // ── Por que bajo de 8 a 4 (hito 012, corte 4) ──
    //
    // Los cuatro que se fueron son los del listado y la ficha de proveedores. El
    // saldo lo calcula ahora el servidor con consultas agregadas planas, asi que
    // no hay hijo que traer:
    //
    //   1. SupplierMovement as 'movements' — routes/suppliers.js, listado.
    //      Los saldos salen del GROUP BY de T1215.
    //   2. SupplierDocument as 'documents' — routes/suppliers.js, listado.
    //      La lista solo necesita el conteo.
    //   3. SupplierOrder    as 'orders'    — routes/suppliers.js, ficha.
    //      Salen de GET /api/suppliers/orders?supplier_id= (T1216).
    //   4. SupplierMovement as 'movements' — routes/suppliers.js, ficha.
    //      Paginan por GET /api/suppliers/:id/movimientos (T1217).
    //
    // El SupplierDocument as 'documents' de la ficha **se queda**, con su where:
    // es el unico include de hijo que sobrevive en ese archivo.
    //
    // Si el numero bajara MAS de cuatro, se saco un include que este plan no
    // nombra y hay que leerlo.
    //
    // ── Por que bajo de 4 a 3 (hito 014, corte 2, T1355) ──
    //
    // El que se fue es **Sale as 'sales' de services/dashboardService.js**, en
    // `_customerStats`. Estaba bien puesto —traia su `where: { empresa_id }`—
    // pero servia a un N+1: por cada cliente que devolvia ese include se hacian
    // DOS `SUM` mas, en serie. Con 500 clientes eran 1.000 consultas
    // secuenciales en cada carga del panel de control (hallazgo P16, FR-062).
    //
    // Lo reemplazan dos GROUP BY fijos, con el molde de routes/suppliers.js. El
    // include que quedo en su lugar es `Customer as 'customer'` —la direccion
    // contraria— y **no entra en esta cuenta**: es un belongsTo. Su `where` con
    // `empresa_id` esta igual, y eso lo verifica el test de integracion
    // `panel.integracion.test.js`, no esta guardia.
    //
    // Los tres que quedan son los dos `Stock as 'stock'` de routes/products.js y
    // el `SupplierDocument as 'documents'` de la ficha de proveedores.
    //
    // ⚠ El include de Supplier que T1211 le agrego a getOrders **no entra en
    // esta cuenta**: es un belongsTo, y el detector solo clasifica HasMany y
    // HasOne. Lo mismo vale para los cuatro includes de `Product as 'product'`
    // que la 014 toca (`Stock.belongsTo(Product)`): el hallazgo P17 dice
    // textualmente que la guardia no los puede ver. Queda escrito porque es lo
    // primero que alguien va a mirar cuando el numero no le cierre.
    const deHijos = analisis.flatMap((a) => a.deHijos);

    expect(deHijos.length).toBeGreaterThan(0);
    expect(deHijos.length).toBe(3);
  });

  it.each(archivos)('$nombre', ({ nombre, contenido }) => {
    expect(analizarIncludes(nombre, contenido).sinFiltrar).toEqual([]);
  });
});

describe('Nadie pide include: [{ all: true }]', () => {
  // `{ all: true }` trae todas las asociaciones del modelo y no deja lugar
  // donde poner un where: las que apuntan a tablas con empresa_id se unen solo
  // por su clave foranea. Ademas cambia sola cuando alguien agrega una
  // asociacion nueva, asi que lo que devuelve el endpoint deja de estar escrito
  // en ningun lado.
  const PATRON = /\ball:\s*true\b/;

  it.each([...leerArchivos('routes'), ...leerArchivos('services')])(
    '$nombre',
    ({ contenido }) => {
      const hallazgos = lineasQueMatchean(contenido, PATRON).map((h) => `L${h.n}: ${h.texto}`);
      expect(hallazgos).toEqual([]);
    }
  );
});

describe('Todo archivo que llama a fallo() lo importa', () => {
  // `routes/customers.js` usaba fallo() en sus once catch sin haberlo
  // importado, y `routes/afip.js` en dos. El unico momento en que eso se nota
  // es cuando algo falla: el catch tira ReferenceError, tapa el error original
  // y el usuario no recibe ni el mensaje ni el requestId. Es un error que solo
  // aparece cuando ya hay otro error, que es cuando menos se lo quiere.
  const archivos = [...leerArchivos('routes'), ...leerArchivos('services'), ...leerArchivos('utils')]
    .filter(({ nombre, contenido }) => nombre !== 'utils/errores.js' && /\bfallo\(/.test(contenido));

  it('hay archivos que usan fallo() (si no, esta guardia no verifica nada)', () => {
    expect(archivos.length).toBeGreaterThan(5);
  });

  it.each(archivos)('$nombre', ({ contenido }) => {
    expect(contenido).toMatch(/\{[^}]*\bfallo\b[^}]*\}\s*=\s*require\('[^']*errores'\)/);
  });
});
