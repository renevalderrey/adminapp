const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  La migración de ENUM dice exactamente lo mismo que los modelos
//
//  Ocho columnas estaban declaradas `DataTypes.ENUM` en el modelo y creadas
//  `VARCHAR` por las migraciones. Con eso, una base creada solo con migraciones
//  **no podía levantar el servidor en desarrollo**: `sequelize.sync({ alter: true })`
//  intentaba convertirlas y moría con «default for column "unit_type" cannot be
//  cast automatically to type enum_products_unit_type».
//
//  `migrations/20260809-tipos-enum-y-indices-de-productos.js` crea los tipos. Lo
//  que este test protege es que esa migración y los modelos **no se separen**,
//  porque la separación no la ve nada más:
//
//  - Un valor de menos en el tipo no rompe al migrar. Rompe cuando alguien
//    guarda ese valor, meses después, con un 500 que nombra el tipo y no la
//    funcionalidad.
//  - Un valor **en distinto orden** no rompe nunca de forma visible: el orden de
//    un ENUM de Postgres es el de comparación, así que dos bases con los mismos
//    valores en distinto orden devuelven `ORDER BY status` distinto y nadie lo
//    atribuye al esquema.
//  - Un ENUM nuevo en un modelo, sin su entrada acá, reproduce el defecto
//    entero: se crea VARCHAR y el arranque en desarrollo vuelve a fallar.
//
//  Los valores se leen de los modelos de verdad —`rawAttributes`—, no de una
//  copia: si se leyeran de una lista escrita a mano, el test compararía la copia
//  contra la migración y las dos podrían estar mal juntas.
// ════════════════════════════════════════════

const migracion = require('../migrations/20260809-tipos-enum-y-indices-de-productos');
const modelos = require('../models');
const Product = require('../models/Product');

const TEXTO_DE_LA_MIGRACION = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '20260809-tipos-enum-y-indices-de-productos.js'),
  'utf8'
);

/**
 * El archivo SIN comentarios.
 *
 * Las afirmaciones de texto tienen que mirar el código, no la explicación. La
 * primera versión de este test miraba el archivo entero, y el encabezado de la
 * migración —que explica «el orden es DROP DEFAULT → ALTER TYPE → SET DEFAULT»
 * y por qué el `down` no usa CASCADE— hacía que dos tests contestaran sobre la
 * prosa en vez de sobre las sentencias. Uno de los dos habría pasado con el
 * código mal escrito.
 */
const CODIGO_DE_LA_MIGRACION = TEXTO_DE_LA_MIGRACION
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

/** Todas las columnas ENUM que declaran los modelos, como 'tabla.columna'. */
function columnasEnumDeLosModelos() {
  const encontradas = [];

  for (const nombre of Object.keys(modelos)) {
    const Modelo = modelos[nombre];
    if (!Modelo || typeof Modelo.findOne !== 'function' || !Modelo.getTableName) continue;

    for (const [atributo, def] of Object.entries(Modelo.rawAttributes)) {
      if (!def.type || def.type.key !== 'ENUM') continue;

      encontradas.push({
        clave: `${Modelo.getTableName()}.${def.field || atributo}`,
        valores: def.type.values,
        porDefecto: def.defaultValue === undefined ? null : def.defaultValue,
      });
    }
  }

  // Los modelos se exportan más de una vez (`models/index.js` y el archivo
  // suelto), así que la misma columna aparece repetida.
  return [...new Map(encontradas.map((c) => [c.clave, c])).values()]
    .sort((a, b) => a.clave.localeCompare(b.clave));
}

/**
 * Los ENUM que NO convierte `20260809`, porque nacen ya como tipo en su propia
 * migración.
 *
 * `20260809` existió para **arreglar** ocho columnas que las migraciones habían
 * creado VARCHAR mientras el modelo decía ENUM. Un ENUM nuevo no necesita esa
 * conversión: se crea con `CREATE TYPE` en la migración que crea la tabla.
 *
 * Lo que sigue haciendo falta verificar es lo mismo de siempre —que exista un
 * tipo de verdad y no un VARCHAR— y eso se comprueba abajo buscando el
 * `CREATE TYPE enum_<tabla>_<columna>` en alguna migración. Sin esa regla, un
 * modelo que declara ENUM contra una columna VARCHAR vuelve a tumbar el job
 * `navegador` del CI, que es de donde salió todo esto.
 */
const NACEN_COMO_TIPO = [
  'catalogo_reglas_precio.ambito',
  'catalogo_reglas_precio.tipo',
  'catalogo_visitas.estado_catalogo',
  'catalogos.estado',
  // Los cuatro de `pedidos`, creados con su `CREATE TYPE` en `20260819-pedidos`.
  // `origen` tiene **un solo valor** hoy (`catalogo`) y es a propósito: es lo que
  // hace que el día que entre un segundo canal no haya que migrar datos.
  'pedidos.entrega',
  'pedidos.estado',
  'pedidos.medio_pago',
  'pedidos.origen',
];

describe('Los ocho ENUM que la migración crea', () => {
  const todosLosDelModelo = columnasEnumDeLosModelos();
  const delModelo = todosLosDelModelo.filter((c) => !NACEN_COMO_TIPO.includes(c.clave));
  const deLaMigracion = migracion.COLUMNAS;

  it('el lector encuentra las columnas que dice leer', () => {
    // Ancla. Sin esto, un cambio en cómo se exportan los modelos dejaría la
    // lista vacía y el test pasaría comparando nada contra nada.
    // 16 = los 8 que convirtió `20260809` + los 8 que nacieron como tipo
    // (cuatro de catálogos, cuatro de pedidos).
    expect(todosLosDelModelo).toHaveLength(16);
    expect(delModelo).toHaveLength(8);
    expect(deLaMigracion).toHaveLength(8);
  });

  it('cubre TODAS las columnas ENUM de los modelos, sin sobrar ninguna', () => {
    // Es la parte que protege del futuro: un ENUM nuevo sin su entrada acá se
    // crea VARCHAR y vuelve a romper el arranque en desarrollo.
    const enLaMigracion = deLaMigracion
      .map((c) => `${c.tabla}.${c.columna}`)
      .sort();

    expect(enLaMigracion).toEqual(delModelo.map((c) => c.clave));
  });

  it('los que nacen como tipo tienen su CREATE TYPE en alguna migración', () => {
    // La regla que reemplaza a la anterior para estos cuatro. Lo que importa no
    // es en QUÉ migración se creó el tipo, sino que exista uno: un modelo que
    // declara ENUM contra una columna VARCHAR es exactamente el defecto que el
    // proyecto 0 vino a cerrar.
    const fs = require('fs');
    const path = require('path');
    const carpeta = path.join(__dirname, '..', 'migrations');
    const fuente = fs.readdirSync(carpeta)
      .filter((n) => n.endsWith('.js'))
      .map((n) => fs.readFileSync(path.join(carpeta, n), 'utf8'))
      .join('\n');

    const sinTipo = NACEN_COMO_TIPO.filter((clave) => {
      const [tabla, columna] = clave.split('.');
      return !fuente.includes(`CREATE TYPE enum_${tabla}_${columna}`);
    });

    expect(sinTipo).toEqual([]);
  });

  it('la lista de los que nacen como tipo no tiene nombres inventados', () => {
    // El ancla de la exención: si alguien agrega una clave que ningún modelo
    // declara, la exención tapa una columna que no existe y la regla de arriba
    // pasa por vacío.
    const claves = todosLosDelModelo.map((c) => c.clave);

    for (const clave of NACEN_COMO_TIPO) {
      expect(claves).toContain(clave);
    }
  });

  it('los valores de cada tipo son los del modelo, EN EL MISMO ORDEN', () => {
    // El orden es el de comparación del tipo en Postgres. Comparar conjuntos en
    // vez de listas dejaría pasar justamente el caso que no falla al migrar.
    const porClave = new Map(delModelo.map((c) => [c.clave, c]));

    for (const { tabla, columna, valores } of deLaMigracion) {
      expect(valores).toEqual(porClave.get(`${tabla}.${columna}`).valores);
    }
  });

  it('el default que repone es el que declara el modelo', () => {
    // Es el valor que la migración vuelve a poner después del ALTER. Si dijera
    // otra cosa, cada fila insertada sin ese campo quedaría con un estado que
    // el código no espera —una suscripción `active` recién creada, por ejemplo—
    // y ninguna consulta fallaría.
    const porClave = new Map(delModelo.map((c) => [c.clave, c]));

    for (const { tabla, columna, porDefecto } of deLaMigracion) {
      expect(porDefecto).toEqual(porClave.get(`${tabla}.${columna}`).porDefecto);
    }
  });

  it('el nombre del tipo es el que usa Sequelize: enum_<tabla>_<columna>', () => {
    // No es una convención elegida acá: es la que tiene producción, donde estas
    // columnas ya son ENUM porque las creó `sequelize.sync()`. Con otro nombre,
    // la migración crearía un tipo paralelo al que esa base ya usa.
    for (const { tabla, columna, tipo } of deLaMigracion) {
      expect(tipo).toBe(`enum_${tabla}_${columna}`);
    }
  });

  it('todos los valores entran en el varchar al que vuelve el down', () => {
    // El `down` convierte de ENUM a `varchar(n)`. Si algún valor no entrara, el
    // down truncaría filas en vez de revertir.
    for (const { valores, anchoVarchar } of deLaMigracion) {
      for (const valor of valores) {
        expect(valor.length).toBeLessThanOrEqual(anchoVarchar);
      }
    }
  });

  it('saca el DEFAULT ANTES de convertir el tipo', () => {
    // Es la línea que el mensaje de error nombra: «default for column
    // "unit_type" cannot be cast automatically». Con el default puesto, el
    // ALTER TYPE es exactamente el fallo que rompía el arranque, así que el
    // orden de las tres sentencias es la corrección, no un detalle de estilo.
    const dropDefault = CODIGO_DE_LA_MIGRACION.indexOf('DROP DEFAULT');
    const alterType = CODIGO_DE_LA_MIGRACION.indexOf('TYPE ${tipo} USING');
    const setDefault = CODIGO_DE_LA_MIGRACION.indexOf('SET DEFAULT');

    expect(dropDefault).toBeGreaterThan(-1);
    expect(alterType).toBeGreaterThan(-1);
    expect(setDefault).toBeGreaterThan(-1);

    expect(dropDefault).toBeLessThan(alterType);
    expect(alterType).toBeLessThan(setDefault);
  });

  it('el default repuesto va casteado al tipo, no como texto suelto', () => {
    // `SET DEFAULT 'unidad'` sobre una columna ENUM funciona, pero deja el
    // default como `'unidad'::text` en algunas versiones y la base deja de ser
    // idéntica a producción, que lo tiene como `'unidad'::enum_products_unit_type`.
    expect(CODIGO_DE_LA_MIGRACION).toMatch(/SET DEFAULT '\$\{porDefecto\}'::\$\{tipo\}/);
  });

  it('el down NO usa DROP TYPE ... CASCADE', () => {
    // `DROP TYPE … CASCADE` no borra el tipo: borra las columnas que dependen
    // de él. Sobre producción eso sería perder ocho columnas con datos en un
    // `db:migrate:undo` reflejo.
    expect(CODIGO_DE_LA_MIGRACION).not.toMatch(/DROP TYPE[^\n]*CASCADE/);
    expect(CODIGO_DE_LA_MIGRACION).toMatch(/DROP TYPE IF EXISTS/);
  });
});

describe('Los tres índices de products que faltaban', () => {
  const deLaMigracion = migracion.INDICES;

  /** Los índices de una sola columna que declara `models/Product.js`. */
  const delModelo = Product.options.indexes
    .filter((i) => !i.unique && i.fields.length === 1)
    .map((i) => i.fields[0]);

  it('el lector encuentra los índices que dice leer', () => {
    expect(deLaMigracion).toHaveLength(3);
    expect(delModelo.length).toBeGreaterThanOrEqual(3);
  });

  it('crea los tres que el modelo declara y ninguna migración creaba', () => {
    // `verificar-esquema.js` no los ve: un SELECT sin índice devuelve lo mismo,
    // solo que barriendo la tabla. Por eso estuvieron ausentes sin que nada
    // avisara.
    expect(deLaMigracion.map((i) => i.columnas).sort())
      .toEqual(['barcode', 'category', 'supplier_id']);
  });

  it('los tres van sobre products y se llaman como los nombraría Sequelize', () => {
    // Con un nombre propio —`idx_products_barcode`— un `sync({ alter: true })`
    // crearía un SEGUNDO índice sobre la misma columna, porque el modelo declara
    // el suyo sin `name`. Es el mismo cuidado que documenta
    // `20260808-indices-de-empresa-en-proveedores.js`.
    for (const { nombre, tabla, columnas } of deLaMigracion) {
      expect(tabla).toBe('products');
      expect(nombre).toBe(`products_${columnas}`);
      expect(delModelo).toContain(columnas);
    }
  });

  it('el down los borra a todos', () => {
    expect(CODIGO_DE_LA_MIGRACION).toMatch(/DROP INDEX IF EXISTS/);
    expect(CODIGO_DE_LA_MIGRACION).toMatch(/\[\.\.\.INDICES\]\.reverse\(\)/);
  });
});
