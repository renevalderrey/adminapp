// ════════════════════════════════════════════
//  Guardia estática · la aritmética de cantidades
//
//  ── Qué protege, y por qué no lo puede proteger ningún otro nivel ──
//
//  Las nueve columnas de cantidad pasan de `INTEGER` a `DECIMAL(14,4)`, y `pg`
//  devuelve un `NUMERIC` como **texto**: un stock de doce vuelve como la cadena
//  `"12.0000"`. En JavaScript, con un operando de texto **el operador decide**:
//
//      '100' - 5              →  95        la resta anda
//      '100' + 5              →  '1005'    la suma concatena
//      Math.max(0, '100' + 5) →  1005      convierte DESPUÉS de concatenar
//      parseInt('0.4')        →  0         truncar no avisa
//
//  El modo de falla central de esta funcionalidad es que **alguien saque una
//  conversión y nada se ponga en rojo**. Los 1400 tests rápidos corren sobre los
//  dobles de `helpers/modelosFalsos.js`, cuyo propio encabezado dice que «un bug
//  que solo aparece contra Postgres real —por ejemplo, DECIMAL devuelto como
//  string— NO lo atrapan estos tests». Y los de integración, que sí lo verían,
//  **no corren en `npm test`**: son otra suite y hay que pedirla.
//
//  O sea que esta guardia es la única red que corre siempre, y además mira
//  **todos** los archivos y no solo el que alguien se acordó de probar.
//
//  ── Las tres reglas ──
//
//   (a) Una suma desnuda sobre `.quantity`, `.available`, `.min_stock` o
//       `.cantidad`. Es la forma exacta de los cinco sitios que la 016 corrigió.
//   (b) Un `parseInt` sobre una cantidad: trunca, y truncar no avisa (FR-026).
//   (c) Un `pg.types.setTypeParser` en `src/`. Es la «solución de una línea» que
//       aparece primero y que **no se puede tomar** (FR-027, H6): haría que los
//       importes empezaran a llegar como `number`, con la pérdida de precisión
//       que el texto evita. Está escrito en
//       `tests/integracion/centavoDelSaldo.integracion.test.js:243`, pero ese
//       test vive en la suite lenta: acá se protege en la rápida.
//
//  ── Cómo está construida, y por qué así ──
//
//  En el molde exacto de `observabilidad.test.js`: lector de carpetas con
//  **ancla que afirma cuántos archivos leyó**, detector probado contra una
//  muestra mala y una buena **antes** de correrlo sobre el repositorio, y filtro
//  de comentarios. Este repositorio ya tuvo dos guardias que pasaban por vacío;
//  las tres piezas son las que evitan eso.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

/** Los .js de un directorio de `src/`, con el nombre prefijado. */
function leerCarpeta(subdir) {
  const dir = path.join(SRC, subdir);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({
      nombre: `${subdir}/${f}`,
      contenido: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

/**
 * Todo `src/`, recursivo, **menos los tests**.
 *
 * La regla (c) es del repositorio y no de las rutas: un `setTypeParser` se
 * registra donde se construye la conexión (`config/database.js`), al arrancar
 * (`server.js`) o al armar los modelos (`models/index.js`), y ninguno de esos
 * tres está en `routes/`, `services/` ni `utils/`. Una guardia que solo mirara
 * esas tres carpetas pasaría en verde justo con la línea que busca.
 *
 * `tests/` queda afuera a propósito: **este mismo archivo** nombra
 * `setTypeParser` en sus muestras sintéticas, y una guardia que se marca a sí
 * misma se arregla borrando la explicación.
 */
function leerTodoSrc(dir = SRC, encontrados = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name === 'tests') continue;
      leerTodoSrc(completo, encontrados);
      continue;
    }

    if (!entrada.name.endsWith('.js')) continue;

    encontrados.push({
      nombre: path.relative(SRC, completo).split(path.sep).join('/'),
      contenido: fs.readFileSync(completo, 'utf8'),
    });
  }

  return encontrados;
}

/**
 * El fuente con las líneas de comentario en blanco, **conservando los saltos**.
 *
 * Hace falta y no es prolijidad: el motivo de cada una de estas correcciones
 * está escrito **arriba de la línea corregida** y nombra la forma que la
 * guardia busca —`stock.quantity + item.quantity`, `parseInt('0.4')`,
 * `setTypeParser`—. Sin el filtro, la guardia nacería en rojo por las
 * explicaciones, y una guardia que empieza en rojo por un comentario es una que
 * alguien desactiva el mismo día.
 *
 * Se blanquean en vez de borrarse para no correr los números de línea: un
 * hallazgo reportado en la L40 de un texto acortado manda a leer otra cosa.
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

// ════════════════════════════════════════════
//  Regla (a) · una suma desnuda sobre una cantidad
// ════════════════════════════════════════════

/**
 * La cantidad del lado izquierdo del `+`: `stock.quantity + …`, `destStock.quantity += …`.
 */
const SUMA_A_LA_IZQUIERDA = /\.(quantity|available|min_stock|cantidad)\s*\+/;

/**
 * La cantidad del lado derecho: `… + item.quantity`.
 *
 * Las dos direcciones hacen falta: `'100' + 5` y `5 + '100'` dan la misma
 * cadena, y de los cinco sitios que la 016 corrigió, `sales.js:722` tenía la
 * cantidad de los **dos** lados y `purchaseService.js:496` solo de uno.
 */
const SUMA_A_LA_DERECHA = /\+\s*\w+\.(quantity|available|min_stock|cantidad)\b/;

/**
 * La única excepción, con el texto exacto de la línea.
 *
 * `catalogoPublico.js:168` suma `catalogo_visitas.cantidad + 1` **adentro de un
 * `UPDATE` de SQL**: ahí suma Postgres y no JavaScript, así que el defecto no
 * existe. Va con el texto completo —igual que `observabilidad.test.js:203-232`
 * hace con `suppliers.js`— para que el día que alguien edite esa consulta la
 * guardia vuelva a mirarla en vez de seguir eximiéndola por el nombre del
 * archivo.
 */
const EXCEPCIONES = [
  'DO UPDATE SET cantidad = catalogo_visitas.cantidad + 1, updated_at = NOW()`,',
];

function sumasDesnudasDeCantidad(contenido, permitidas = EXCEPCIONES) {
  return comentariosEnBlanco(contenido)
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) =>
      (SUMA_A_LA_IZQUIERDA.test(texto) || SUMA_A_LA_DERECHA.test(texto))
      && !permitidas.includes(texto))
    .map(({ n, texto }) => `L${n}: ${texto}`);
}

// ════════════════════════════════════════════
//  Regla (b) · un parseInt sobre una cantidad
// ════════════════════════════════════════════

const PARSE_INT_DE_CANTIDAD = /parseInt\([^)]*\b(quantity|min_stock|cantidad)\b/;

function parseIntsSobreCantidad(contenido) {
  return comentariosEnBlanco(contenido)
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => PARSE_INT_DE_CANTIDAD.test(texto))
    .map(({ n, texto }) => `L${n}: ${texto}`);
}

// ════════════════════════════════════════════
//  Regla (c) · ningún setTypeParser
// ════════════════════════════════════════════

const SET_TYPE_PARSER = /setTypeParser/;

function registrosDeTypeParser(contenido) {
  return comentariosEnBlanco(contenido)
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => SET_TYPE_PARSER.test(texto))
    .map(({ n, texto }) => `L${n}: ${texto}`);
}

// ════════════════════════════════════════════
//  Las muestras. Son las que sostienen esta guardia el día que el repositorio
//  esté bien escrito y ninguna regla encuentre nada.
// ════════════════════════════════════════════

const MUESTRA_SUMA_MALA = `
      if (stock) {
        const oldQty = stock.quantity;
        await stock.update({
          quantity: stock.quantity + item.quantity,
          available: stock.available + item.quantity,
        }, { transaction: t });
      }

      if (destStock) {
        destStock.quantity += qty;
      }

      cambios.available = Math.max(0, stock.available + (quantity - stock.quantity));
`;

const MUESTRA_SUMA_BUENA = `
      if (stock) {
        await stock.update({
          quantity: sumarCantidades(stock.quantity, item.quantity),
          available: sumarCantidades(stock.available, item.quantity),
        }, { transaction: t });
      }

      cambios.available = Math.max(0, aCantidad(oldAvail) + delta);
      const restar = sourceStock.quantity - qty;
`;

const MUESTRA_SUMA_COMENTADA = `
// Antes esto era \`stock.quantity + item.quantity\` y concatenaba.
/**
 * Ver también destStock.quantity += qty, que tenía el mismo defecto.
 */
const TOPE = 10;
`;

const MUESTRA_PARSEINT_MALA = `
        const qtyImportada = parseInt(data.quantity, 10);
        const minimo = parseInt(data.min_stock) || 0;
`;

const MUESTRA_PARSEINT_BUENA = `
        const qtyImportada = aCantidad(aNumero(data.quantity));
        const pagina = parseInt(req.query.page, 10) || 1;
        const id = parseInt(req.params.id, 10);
`;

const MUESTRA_TYPEPARSER_MALA = `
const pg = require('pg');
pg.types.setTypeParser(1700, (valor) => parseFloat(valor));
`;

const MUESTRA_TYPEPARSER_COMENTADA = `
// NO registrar un pg.types.setTypeParser global para NUMERIC: los importes
// empezarían a llegar como number.
const sequelize = new Sequelize(process.env.DATABASE_URL);
`;

// ════════════════════════════════════════════

describe('Guardia · la aritmética de cantidades no depende del tipo del driver', () => {
  const deRutasServiciosYUtils = [
    ...leerCarpeta('routes'),
    ...leerCarpeta('services'),
    ...leerCarpeta('utils'),
  ];
  const todoSrc = leerTodoSrc();

  // ── El ancla ──

  it('leyó los tres directorios y ninguno vino vacío', () => {
    // `observabilidad.test.js` tiene esta misma comprobación y está escrito por
    // qué: una guardia que copiara un lector acotado recorrería un tercio de lo
    // que dice recorrer **en verde**.
    for (const subdir of ['routes', 'services', 'utils']) {
      expect(deRutasServiciosYUtils.filter((a) => a.nombre.startsWith(`${subdir}/`)).length)
        .toBeGreaterThan(3);
    }

    expect(deRutasServiciosYUtils.length).toBeGreaterThan(35);
  });

  it('el recorrido de todo src/ incluye los tres archivos donde un setTypeParser viviría', () => {
    // El ancla de la regla (c). Un `setTypeParser` no se registra en una ruta:
    // se registra donde se arma la conexión, donde arranca el servidor o donde
    // se cargan los modelos. Sin esta afirmación, la regla podría estar
    // recorriendo un árbol que no contiene ninguno de los tres.
    const nombres = todoSrc.map((a) => a.nombre);

    expect(nombres).toContain('config/database.js');
    expect(nombres).toContain('server.js');
    expect(nombres).toContain('models/index.js');
    expect(todoSrc.length).toBeGreaterThan(deRutasServiciosYUtils.length);
  });

  it('ningún archivo de tests entra en el recorrido de src/', () => {
    // Este archivo nombra `setTypeParser` y `stock.quantity + item.quantity` en
    // sus muestras. Si `tests/` entrara, la guardia se marcaría a sí misma.
    expect(todoSrc.filter((a) => a.nombre.startsWith('tests/'))).toEqual([]);
  });

  // ── Regla (a): el detector, antes de correrlo sobre el repositorio ──

  it('(a) el detector encuentra las cuatro formas de la suma desnuda, con su línea', () => {
    const hallazgos = sumasDesnudasDeCantidad(MUESTRA_SUMA_MALA, []);

    expect(hallazgos).toHaveLength(4);
    expect(hallazgos[0]).toBe('L5: quantity: stock.quantity + item.quantity,');
    expect(hallazgos[1]).toBe('L6: available: stock.available + item.quantity,');
    expect(hallazgos[2]).toBe('L11: destStock.quantity += qty;');
    // El `Math.max`, que es el que parece coercionado y no lo está.
    expect(hallazgos[3]).toContain('Math.max(0, stock.available + (quantity - stock.quantity))');
  });

  it('(a) el detector NO marca la forma corregida ni la resta', () => {
    // La resta anda: `'100' - 5` es 95. Marcarla llenaría la guardia de falsos
    // positivos, y un falso positivo se cierra con una excepción, que es como
    // una guardia deja de servir.
    expect(sumasDesnudasDeCantidad(MUESTRA_SUMA_BUENA, [])).toEqual([]);
  });

  it('(a) una suma NOMBRADA en un comentario no cuenta como suma', () => {
    // Es el caso real: el motivo de cada corrección está escrito arriba de la
    // línea corregida y nombra la forma vieja.
    expect(sumasDesnudasDeCantidad(MUESTRA_SUMA_COMENTADA, [])).toEqual([]);
  });

  it('(a) el detector sigue reconociendo la forma en el repositorio de verdad', () => {
    // **El ancla de la regla (a).** Hoy, con las cinco correcciones puestas,
    // queda exactamente una línea con esta forma en todo `routes/` —la excepción
    // de SQL—. Si el detector dejara de reconocerla, devolvería `[]` para todos
    // los archivos y la guardia pasaría sin haber mirado nada.
    const { contenido } = deRutasServiciosYUtils.find((a) => a.nombre === 'routes/catalogoPublico.js');

    expect(sumasDesnudasDeCantidad(contenido, [])).toHaveLength(1);
  });

  // ── Regla (a): la excepción ──

  it('(a) la lista de excepciones tiene UNA entrada, y sigue escrita tal cual', () => {
    // El mismo par de afirmaciones que `observabilidad.test.js:211-232`. La
    // exención es un match exacto sobre la línea recortada: un cambio de
    // espaciado la rompe y la línea vuelve a aparecer como un hallazgo que no lo
    // es. Sin este segundo bloque, el falso positivo se descubre corriendo la
    // suite entera y sin saber qué lo causó.
    expect(EXCEPCIONES).toHaveLength(1);

    const { contenido } = deRutasServiciosYUtils.find((a) => a.nombre === 'routes/catalogoPublico.js');
    const lineas = contenido.split('\n').map((l) => l.trim());

    expect(lineas).toContain(EXCEPCIONES[0]);
  });

  it('(a) el punto ciego de la regla: los dos Math.max de general.js, atados a mano', () => {
    // ⚠ **La regla (a) tiene un punto ciego y este es.** El patrón busca el
    // acceso a la propiedad —`.quantity +`, `+ x.available`—, y `general.js:90`
    // escribe la misma suma sobre variables locales:
    //
    //     const delta = cambios.quantity - oldQty;
    //     cambios.available = Math.max(0, oldAvail + delta);   ← invisible
    //
    // Medido: revirtiendo esa línea sola, las tres reglas siguen en verde. Su
    // gemela de `:181` sí se ve, porque ahí los operandos son propiedades.
    //
    // Ensanchar la regla a «cualquier `Math.max` con un `+` adentro» daría
    // falsos positivos sobre las sumas de plata, que están bien y son muchas
    // más. Así que el punto ciego se cierra donde se puede cerrar sin ensanchar
    // nada: atando **los dos** `Math.max` de ese archivo, con el conteo puesto
    // para que un tercero que aparezca mañana obligue a leerlo en vez de
    // colarse.
    const { contenido } = deRutasServiciosYUtils.find((a) => a.nombre === 'routes/general.js');

    const conMathMax = comentariosEnBlanco(contenido)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('Math.max(0,'));

    expect(conMathMax).toHaveLength(2);

    for (const linea of conMathMax) {
      expect(linea).toMatch(/aCantidad\(/);
    }
  });

  it('(a) la excepción es SQL, no JavaScript: la suma la hace Postgres', () => {
    // Es lo único que la justifica. Si esa línea dejara de estar adentro de un
    // `sequelize.query`, la exención dejaría de valer y hay que sacarla.
    const { contenido } = deRutasServiciosYUtils.find((a) => a.nombre === 'routes/catalogoPublico.js');
    const desde = contenido.indexOf('await sequelize.query(');
    const hasta = contenido.indexOf(EXCEPCIONES[0]);

    expect(desde).toBeGreaterThanOrEqual(0);
    expect(hasta).toBeGreaterThan(desde);
  });

  // ── Regla (b): el detector ──

  it('(b) el detector encuentra el parseInt sobre una cantidad', () => {
    const hallazgos = parseIntsSobreCantidad(MUESTRA_PARSEINT_MALA);

    expect(hallazgos).toHaveLength(2);
    expect(hallazgos[0]).toContain("parseInt(data.quantity, 10)");
    expect(hallazgos[1]).toContain('parseInt(data.min_stock)');
  });

  it('(b) el detector NO marca el parseInt de una página ni el de un id', () => {
    // `parseInt` sobre un entero que **es** entero está bien y se usa en medio
    // repositorio. La regla es sobre cantidades, no sobre `parseInt`.
    expect(parseIntsSobreCantidad(MUESTRA_PARSEINT_BUENA)).toEqual([]);
  });

  // ── Regla (c): el detector ──

  it('(c) el detector encuentra el setTypeParser', () => {
    const hallazgos = registrosDeTypeParser(MUESTRA_TYPEPARSER_MALA);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain('setTypeParser');
  });

  it('(c) el comentario que PROHÍBE registrarlo no cuenta como registro', () => {
    // El motivo de FR-027 está escrito, y nombra la función. Sin el filtro, la
    // guardia estaría en rojo por la prohibición.
    expect(registrosDeTypeParser(MUESTRA_TYPEPARSER_COMENTADA)).toEqual([]);
  });

  // ── El repositorio ──

  describe('(a) ninguna suma desnuda sobre una cantidad', () => {
    it.each(deRutasServiciosYUtils)('$nombre', ({ contenido }) => {
      expect(sumasDesnudasDeCantidad(contenido)).toEqual([]);
    });
  });

  describe('(b) ningún parseInt sobre una cantidad', () => {
    it.each(deRutasServiciosYUtils)('$nombre', ({ contenido }) => {
      expect(parseIntsSobreCantidad(contenido)).toEqual([]);
    });
  });

  describe('(c) ningún setTypeParser en todo src/', () => {
    it.each(todoSrc)('$nombre', ({ contenido }) => {
      expect(registrosDeTypeParser(contenido)).toEqual([]);
    });
  });
});
