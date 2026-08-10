const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Guardia estática · nada de lo interno sale por una respuesta pública
//
//  ── Qué defecto cierra ──
//
//  `GET /api/products` devuelve la fila del producto con `cost` crudo, el
//  proveedor y el stock por sucursal. Es correcto: del otro lado hay una sesión
//  del comercio. El catálogo público es otra cosa — del otro lado hay cualquiera
//  con el enlace, incluida la competencia y el proveedor.
//
//  Y el defecto que importa no es el de hoy: es el de dentro de dos meses.
//  **La columna que `Product` gane el mes que viene entra sola a toda respuesta
//  pública** si alguna de ellas se arma con un spread, y nadie se entera. Por eso
//  la regla no es «no devuelvas estos diez campos» sino **«todo lo que devolvés
//  es un literal escrito a mano»**: una lista negra envejece, una lista blanca
//  obliga a decidir cada vez.
//
//  ── Por qué esta guardia se escribe ANTES que los archivos ──
//
//  Nace con dos hallazgos —«el archivo NO existe»— y eso es lo correcto. Una
//  guardia que nace en verde es una guardia que no se sabe si mira: podría estar
//  buscando en la ruta equivocada y nadie lo notaría hasta que sirva de nada.
//
//  A medida que los dos archivos se escriben, baja a uno y después a cero.
//
//  ── El protocolo de los archivos que faltan ──
//
//  Es el de `apps/web/src/tests/guardiasDeDiseno.test.js`: un archivo que no
//  está **se marca**, no se saltea. Un `readFileSync` directo haría explotar el
//  módulo entero y la suite diría un ENOENT de Node en vez de «falta este
//  archivo»; envolverlo en un `try` sin marcar nada sería peor todavía, porque
//  el archivo ausente pasaría a ser un archivo sin hallazgos, que es exactamente
//  igual a un archivo impecable.
// ════════════════════════════════════════════

const SRC = path.join(__dirname, '..');

const VISTA = 'utils/vistaPublica.js';
const ROUTER = 'routes/catalogoPublico.js';

/**
 * Los diez nombres que no pueden aparecer en la proyección pública.
 *
 * Los cuatro primeros son plata del comercio; `supplier_id` es de quién compra;
 * `barcode` es interno; `is_active` y `publicable` son banderas del ABM que le
 * cuentan a un desconocido cómo trabaja el negocio; y los dos últimos son la
 * identidad del tenant, que en una superficie pública no tiene por qué viajar.
 */
const PROHIBIDOS = [
  'cost', 'margin_override', 'wholesale_margin', 'wholesale_price',
  'supplier_id', 'barcode', 'is_active', 'publicable',
  'empresa_id', 'punto_de_venta_id',
];

/**
 * Las formas de copiar un objeto entero sin decidir qué lleva.
 *
 * Cada una de estas es un camino por el que una columna nueva entra sola.
 */
const FORMAS_DE_COPIAR = [
  { patron: /\.\.\./, nombre: 'spread (...)' },
  { patron: /Object\.assign/, nombre: 'Object.assign' },
  { patron: /toJSON/, nombre: 'toJSON' },
  { patron: /Object\.keys/, nombre: 'Object.keys' },
  { patron: /for\s*\(\s*const\s+\w+\s+in\s/, nombre: 'for (const … in …)' },
];

/** Saca comentarios de línea y de bloque: explicar el defecto no es cometerlo. */
function sinComentarios(fuente) {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Un archivo de la lista, exista o no. */
function leer(nombre) {
  const ruta = path.join(SRC, nombre);
  if (!fs.existsSync(ruta)) return { nombre, existe: false, contenido: '' };
  return { nombre, existe: true, contenido: fs.readFileSync(ruta, 'utf8') };
}

// ════════════════════════════════════════════
//  Regla A · la proyección no nombra nada prohibido y no copia
// ════════════════════════════════════════════

function analizarVista(fuente) {
  const hallazgos = [];
  const codigo = sinComentarios(fuente);

  for (const prohibido of PROHIBIDOS) {
    // Con límites de palabra: `cost` no puede matchear `costo_envio` ni
    // `precio_lista`. Una guardia que se pone en rojo por un nombre parecido es
    // una que alguien afloja.
    const patron = new RegExp(`\\b${prohibido}\\b`);
    if (patron.test(codigo)) hallazgos.push(`nombra «${prohibido}»`);
  }

  for (const { patron, nombre } of FORMAS_DE_COPIAR) {
    if (patron.test(codigo)) hallazgos.push(`copia con ${nombre}`);
  }

  return hallazgos;
}

// ════════════════════════════════════════════
//  Regla B · el router no serializa filas ni excluye columnas
// ════════════════════════════════════════════

function analizarRouter(fuente) {
  const hallazgos = [];
  const codigo = sinComentarios(fuente);

  // `attributes: { exclude: [...] }` es una lista negra: la columna nueva entra
  // sola. Tiene que ser un arreglo literal.
  if (/attributes\s*:\s*\{/.test(codigo)) {
    hallazgos.push('usa `attributes: { exclude: … }` en vez de un arreglo literal');
  }

  for (const { patron, nombre } of FORMAS_DE_COPIAR) {
    if (patron.test(codigo)) hallazgos.push(`copia con ${nombre}`);
  }

  // Un `res.json(` cuyo argumento es un identificador suelto —`res.json(producto)`—
  // está serializando una fila entera. Lo que se acepta es un literal `{`, o una
  // llamada a `vistaPublica.*`.
  const argumentos = [...codigo.matchAll(/res\s*\.\s*json\s*\(\s*([^\s(){[\]]+)/g)];
  for (const [, argumento] of argumentos) {
    if (argumento.startsWith('vistaPublica') || argumento.startsWith('vista')) continue;
    hallazgos.push(`\`res.json(${argumento})\` serializa algo que no es un literal`);
  }

  return hallazgos;
}

// ════════════════════════════════════════════
//  Regla C · las muestras sintéticas
//
//  Son las que sostienen la guardia el día que el repositorio ya no tenga el
//  defecto. Sin ellas, las dos reglas de arriba podrían dejar de detectar
//  cualquier cosa y seguirían en verde, porque los archivos reales están bien.
// ════════════════════════════════════════════

const MALAS = [
  {
    que: 'devolver la fila entera',
    donde: 'router',
    fuente: 'router.get("/x", async (req, res) => { res.json(producto) })',
  },
  {
    que: 'copiar con spread y toJSON',
    donde: 'router',
    fuente: 'const salida = { ...p.toJSON() }; res.json({ ok: true, data: salida })',
  },
  {
    que: 'excluir columnas en vez de enumerarlas',
    donde: 'router',
    fuente: "const filas = await Product.findAll({ attributes: { exclude: ['cost'] } })",
  },
  {
    que: 'nombrar un campo prohibido en la proyección',
    donde: 'vista',
    fuente: 'const productoPublico = (p) => ({ id: p.id, nombre: p.name, cost: p.cost })',
  },
];

const BUENAS = [
  {
    que: 'un literal con las hojas de la vista',
    donde: 'router',
    fuente: 'res.json({ ok: true, data: { catalogo: vistaPublica.catalogoPublico(c) } })',
  },
  {
    que: 'atributos como arreglo literal',
    donde: 'vista',
    fuente: "const productoPublico = (p) => ({ id: p.id, nombre: p.name, precio: p.precio })",
  },
];

const analizar = (donde, fuente) =>
  (donde === 'vista' ? analizarVista(fuente) : analizarRouter(fuente));

// ════════════════════════════════════════════

describe('el detector reconoce lo que dice reconocer', () => {
  for (const muestra of MALAS) {
    it(`marca: ${muestra.que}`, () => {
      expect(analizar(muestra.donde, muestra.fuente).length).toBeGreaterThan(0);
    });
  }

  for (const muestra of BUENAS) {
    it(`deja pasar: ${muestra.que}`, () => {
      expect(analizar(muestra.donde, muestra.fuente)).toEqual([]);
    });
  }

  it('un comentario que nombra el defecto no es el defecto', () => {
    // Sin esto, el archivo real no podría explicar por qué no devuelve `cost`.
    expect(analizarVista('// nunca devolvemos cost ni publicable\nconst x = 1')).toEqual([]);
  });
});

describe('las respuestas públicas se arman campo por campo', () => {
  const vista = leer(VISTA);
  const router = leer(ROUTER);

  it('los dos archivos existen', () => {
    // ⚠ Este `it` nace en ROJO, con dos hallazgos, y es lo correcto: la guardia
    // se escribió antes que los archivos que mira. Baja a uno cuando se escribe
    // `utils/vistaPublica.js` y a cero con `routes/catalogoPublico.js`.
    //
    // Una guardia que nace en verde es una guardia que no se sabe si mira.
    const faltantes = [vista, router]
      .filter((a) => !a.existe)
      .map((a) => `${a.nombre} — el archivo NO existe: la guardia no miró nada`);

    expect(faltantes).toEqual([]);
  });

  it('Regla A · la proyección no nombra ningún campo interno ni copia objetos', () => {
    if (!vista.existe) return; // Lo reporta el `it` de arriba, una sola vez.

    expect(analizarVista(vista.contenido)).toEqual([]);
  });

  it('Regla B · el router no serializa filas ni excluye columnas', () => {
    if (!router.existe) return;

    expect(analizarRouter(router.contenido)).toEqual([]);
  });

  it('el ancla · el detector encontró lo que dice mirar', () => {
    if (!router.existe || !vista.existe) return;

    // Si estos números se desploman, el detector dejó de entender la forma del
    // archivo y las dos reglas de arriba estarían pasando sin mirar nada.
    const codigo = sinComentarios(router.contenido);
    const respuestas = (codigo.match(/res\s*\.\s*json\s*\(/g) || []).length;
    const proyecciones = (codigo.match(/attributes\s*:/g) || []).length;

    expect(respuestas).toBeGreaterThanOrEqual(3);
    expect(proyecciones).toBeGreaterThanOrEqual(1);

    // Y la vista tiene que declarar de verdad sus tres funciones.
    for (const nombre of ['catalogoPublico', 'productoPublico', 'pedidoPublico']) {
      expect(vista.contenido).toContain(nombre);
    }
  });
});
