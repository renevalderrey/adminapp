const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Las dos migraciones de TiendaNube dicen exactamente lo mismo que los modelos
//
//  Es una comparación de texto y de listas, y es grosera a propósito: **ninguna
//  de las tres cosas que verifica la ve un test de comportamiento**.
//
//   1. **El ancho de los ids.** Un `INTEGER` donde el modelo dice `BIGINT` anda
//      perfecto: el SELECT devuelve lo mismo. Lo que pasa es que el día que
//      TiendaNube emita un id por encima de 2.147.483.647 —los decide un
//      tercero— insertar un mapeo devuelve un 500 sin ningún mensaje que diga
//      qué pasó. Y peor: si `tiendanube_mappings` quedara en `INTEGER` mientras
//      `tiendanube_variantes` es `BIGINT`, ese día una tabla acepta la fila y la
//      otra no, y el mapeo queda apuntando a una variante que existe.
//   2. **El nombre de los índices.** Sequelize nombraría los suyos
//      `<tabla>_<col>_<col>`; las migraciones los llaman `uq_…` / `idx_…`. Sobre
//      una base creada por migraciones, un `sync({ alter: true })` en desarrollo
//      crearía un SEGUNDO índice sobre las mismas columnas. Es el mismo cuidado
//      que documenta `20260808-indices-de-empresa-en-proveedores.js` y que
//      compara `indicesDeProveedores.test.js`. `verificar-esquema.js` tampoco lo
//      ve: hace un `findOne` por modelo.
//   3. **El orden de los tres escalones de la sucursal designada.** Es el único
//      número de esta migración que el cliente ve —qué stock se publica y de qué
//      sucursal se descuenta— y leer el `down` no lo contesta.
//
//  Y una cuarta, que es una guardia y no una comparación: que ninguna de las dos
//  migraciones cree el índice único que pide FR-026 sobre `stock_movements`. Es
//  el riesgo 1 del plan y el más caro de la lista.
// ════════════════════════════════════════════

const SRC = path.join(__dirname, '..');

const ARCHIVO_VINCULACION = '20260810-tiendanube-vinculacion-y-estado.js';
const ARCHIVO_CATALOGO = '20260811-tiendanube-catalogo-pedidos-y-corridas.js';

const vinculacion = require(`../migrations/${ARCHIVO_VINCULACION}`);
const catalogo = require(`../migrations/${ARCHIVO_CATALOGO}`);

const modelos = require('../models');
const Product = require('../models/Product');

const leerMigracion = (archivo) => fs.readFileSync(path.join(SRC, 'migrations', archivo), 'utf8');

/**
 * El archivo SIN comentarios.
 *
 * Las afirmaciones de texto tienen que mirar el código y no la explicación. Los
 * encabezados de estas dos migraciones dicen «el índice único de FR-026 NO se
 * crea» y nombran `stock_movements` cuatro veces para explicar por qué: sin
 * sacar los comentarios, la guardia del punto 4 contestaría sobre la prosa que
 * dice que no lo hace. Es el mismo filtro que usa `tiposEnumDelEsquema.test.js`.
 */
const sinComentarios = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

const TEXTO_VINCULACION = leerMigracion(ARCHIVO_VINCULACION);
const TEXTO_CATALOGO = leerMigracion(ARCHIVO_CATALOGO);

const CODIGO_VINCULACION = sinComentarios(TEXTO_VINCULACION);
const CODIGO_CATALOGO = sinComentarios(TEXTO_CATALOGO);

// ════════════════════════════════════════════
//  1 · El ancho de los ids de un tercero
// ════════════════════════════════════════════

/**
 * Los cuatro modelos que guardan un identificador emitido por TiendaNube.
 *
 * Se enumeran a mano y no se barren todos los modelos por una razón que hay que
 * dejar escrita: `Product` **también** tiene una columna
 * `tiendanube_variant_id`, y ésa se queda en `INTEGER` a propósito. Un barrido
 * automático la pondría en rojo y alguien la ensancharía «para que pase», que es
 * exactamente lo contrario de lo que el hito decidió.
 */
const MODELOS_CON_IDS_DE_TIENDANUBE = [
  'TiendanubeMapping',
  'TiendanubeTienda',
  'TiendanubeVariante',
  'TiendanubePedido',
];

/** `[{ modelo, columna, clave }]` de todo atributo `tiendanube_*_id`. */
function idsDeTiendanube() {
  const encontrados = [];

  for (const nombre of MODELOS_CON_IDS_DE_TIENDANUBE) {
    for (const [atributo, def] of Object.entries(modelos[nombre].rawAttributes)) {
      if (!/^tiendanube_\w+_id$/.test(atributo)) continue;

      encontrados.push({ modelo: nombre, columna: atributo, clave: def.type && def.type.key });
    }
  }

  return encontrados;
}

describe('Los ids que emite TiendaNube son BIGINT en el modelo y en la migración', () => {
  const ids = idsDeTiendanube();

  it('el lector encuentra los seis ids que dice leer', () => {
    // Ancla. Sin esto, un modelo que se renombre dejaría la lista vacía y los
    // casos de abajo pasarían comparando nada contra nada.
    expect(ids.map((i) => `${i.modelo}.${i.columna}`).sort()).toEqual([
      'TiendanubeMapping.tiendanube_product_id',
      'TiendanubeMapping.tiendanube_variant_id',
      'TiendanubePedido.tiendanube_order_id',
      'TiendanubeTienda.tiendanube_user_id',
      'TiendanubeVariante.tiendanube_product_id',
      'TiendanubeVariante.tiendanube_variant_id',
    ]);
  });

  it('los seis los declara BIGINT el modelo', () => {
    const enteros = ids.filter((i) => i.clave !== 'BIGINT').map((i) => `${i.modelo}.${i.columna} es ${i.clave}`);

    expect(enteros).toEqual([]);
  });

  it('la migración 20260810 ensancha los dos de tiendanube_mappings, y su down los devuelve a INTEGER', () => {
    // Es la mitad que el modelo no puede decir: el modelo describe el esquema de
    // hoy y la migración es la única que lo cambia. Declararlo BIGINT allá y
    // dejarlo INTEGER acá deja las dos cosas en desacuerdo sin que nada falle
    // hasta el día del desbordamiento.
    for (const columna of vinculacion.IDS_DE_TIENDANUBE) {
      expect(CODIGO_VINCULACION).toContain(`ALTER COLUMN \${columna} TYPE BIGINT`);
      expect(CODIGO_VINCULACION).toContain(`'${columna}'`);
    }

    expect(vinculacion.IDS_DE_TIENDANUBE).toEqual(['tiendanube_variant_id', 'tiendanube_product_id']);
    expect(CODIGO_VINCULACION).toContain('ALTER COLUMN ${columna} TYPE INTEGER');
  });

  it('la migración 20260811 crea los tres ids nuevos como BIGINT', () => {
    for (const columna of ['tiendanube_variant_id', 'tiendanube_product_id', 'tiendanube_order_id']) {
      expect(CODIGO_CATALOGO).toMatch(new RegExp(`${columna}\\s+BIGINT`));
    }
  });

  it('la migración 20260810 crea tiendanube_user_id como BIGINT', () => {
    expect(CODIGO_VINCULACION).toMatch(/tiendanube_user_id\s+BIGINT/);
  });

  it('products.tiendanube_variant_id sigue en INTEGER: es la columna muerta y NO se ensancha', () => {
    // Es una asimetría deliberada y por eso está fijada acá: esa columna deja de
    // ser escribible (FR-070), no la lee nadie, y ensanchar una columna que nadie
    // va a escribir es trabajo sin destino. Sin este caso, la próxima persona que
    // vea `BIGINT` en cinco lugares y `INTEGER` en el sexto lo lee como un olvido.
    expect(Product.rawAttributes.tiendanube_variant_id.type.key).toBe('INTEGER');
  });
});

// ════════════════════════════════════════════
//  2 · Los índices, con el mismo nombre en los dos lados
// ════════════════════════════════════════════

/** Los índices que declaran los cinco modelos nuevos, con su `name`. */
function indicesDeLosModelos() {
  const encontrados = [];

  for (const nombre of [
    'TiendanubeTienda',
    'TiendanubeEstadoOauth',
    'TiendanubeVariante',
    'TiendanubePedido',
    'TiendanubeCorrida',
  ]) {
    for (const indice of modelos[nombre].options.indexes || []) {
      encontrados.push({
        nombre: indice.name,
        columnas: indice.fields.map((f) => (typeof f === 'string' ? f : f.name)),
        unico: Boolean(indice.unique),
      });
    }
  }

  return encontrados;
}

/**
 * Las columnas de un índice de la migración, sin el `DESC`.
 *
 * El `DESC` no se compara y conviene que quede escrito: un índice de Postgres
 * sobre `(a, b DESC)` sirve igual para `ORDER BY a, b DESC` que para
 * `ORDER BY a, b` recorrido al revés, así que el sentido no es lo que se está
 * protegiendo acá. Lo que se protege es el nombre y **qué columnas**, en qué
 * orden: `(empresa_id, status)` y `(status, empresa_id)` no son el mismo índice
 * y solo el primero sirve para filtrar por empresa.
 */
const columnasDe = (texto) => texto.split(',').map((c) => c.trim().replace(/\s+(DESC|ASC)$/i, ''));

describe('Los índices de las dos migraciones son los que declaran los modelos', () => {
  // Los siete: el de `tiendanube_estados_oauth` lo crea `20260810` y los otros
  // seis `20260811`. Se juntan porque lo que importa es que ningún modelo declare
  // un índice que ninguna migración crea, ni al revés.
  const deLasMigraciones = [...vinculacion.INDICES, ...catalogo.INDICES];
  const delModelo = indicesDeLosModelos();

  it('el lector encuentra los siete índices que dice leer', () => {
    expect(deLasMigraciones).toHaveLength(7);
    expect(delModelo).toHaveLength(7);
  });

  it('los siete del modelo tienen el MISMO nombre que los de la migración', () => {
    expect(delModelo.map((i) => i.nombre).sort())
      .toEqual(deLasMigraciones.map((i) => i.nombre).sort());
  });

  it('y las MISMAS columnas, en el mismo orden', () => {
    const porNombre = new Map(delModelo.map((i) => [i.nombre, i.columnas]));

    for (const { nombre, columnas } of deLasMigraciones) {
      expect(porNombre.get(nombre)).toEqual(columnasDe(columnas));
    }
  });

  it('los dos únicos son únicos en los dos lados', () => {
    // No es cosmético: `uq_tn_pedido` es lo ÚNICO que sostiene la idempotencia
    // del webhook, y `uq_tn_variante` es lo que agrupa cien empujones del mismo
    // producto en un solo PUT. Declarados sin `unique`, los dos siguen siendo
    // índices que aceleran consultas y ninguna de las dos garantías existe.
    const porNombre = new Map(delModelo.map((i) => [i.nombre, i.unico]));

    for (const { nombre, unico } of deLasMigraciones) {
      expect(porNombre.get(nombre)).toBe(Boolean(unico));
    }

    expect(deLasMigraciones.filter((i) => i.unico).map((i) => i.nombre).sort())
      .toEqual(['uq_tn_pedido', 'uq_tn_variante']);
  });

  it('los dos parciales llevan su WHERE, que es de donde sale que sean baratos', () => {
    const porNombre = new Map(deLasMigraciones.map((i) => [i.nombre, i.donde]));

    expect(porNombre.get('idx_tn_variantes_cola')).toBe('pendiente_desde IS NOT NULL');
    expect(porNombre.get('idx_tn_pedidos_pendientes')).toBe('items_sin_descontar > 0');
  });
});

// ════════════════════════════════════════════
//  3 · La sucursal designada
// ════════════════════════════════════════════

describe('La sucursal designada sale de los mismos tres escalones que elegirPorDefecto', () => {
  // `utils/sucursalDeStock.js:59-69` es la única función que contesta «qué
  // sucursal le toca», y la migración no la puede llamar: una migración corre
  // contra el esquema de ayer y no puede depender del código de hoy. Lo que sí
  // tiene que ser igual es el ORDEN, y eso no lo dice ningún test de
  // comportamiento porque la migración no se ejecuta en la suite rápida.
  const sql = vinculacion.SUCURSAL_DESIGNADA;

  it('el primer escalón es la sucursal `principal`, el segundo la activa y el tercero la de menor id', () => {
    const principal = sql.indexOf("p.code = 'principal'");
    const activa = sql.indexOf('p.is_active');
    // El tercero es el único SELECT sin ninguna condición sobre `p` más allá de
    // la empresa: se lo ubica por el cierre del `WHERE p.empresa_id = s.empresa_id`
    // sin `AND`.
    const cualquiera = sql.search(/WHERE p\.empresa_id = s\.empresa_id\s+ORDER BY/);

    expect(principal).toBeGreaterThan(-1);
    expect(activa).toBeGreaterThan(-1);
    expect(cualquiera).toBeGreaterThan(-1);

    expect(principal).toBeLessThan(activa);
    expect(activa).toBeLessThan(cualquiera);
  });

  it('los tres desempatan por el id más chico y no por el orden que devuelva Postgres', () => {
    // Sin `ORDER BY`, un `LIMIT 1` devuelve la fila que Postgres tenga a mano, y
    // dos corridas de la misma migración pueden designar sucursales distintas.
    expect([...sql.matchAll(/ORDER BY p\.id LIMIT 1/g)]).toHaveLength(3);
  });

  it('la columna es NOT NULL: no hay rama de omisión que se pueda equivocar', () => {
    // Es la decisión 4 del plan. Una columna que admite null tiene una rama de
    // omisión, y esa rama es literalmente el defecto de hoy: el webhook pasa
    // `null`, cae al punto de venta por defecto, y la sincronización elige otro
    // por el orden de las filas.
    expect(CODIGO_VINCULACION).toMatch(/punto_de_venta_id\s+INTEGER\s+NOT NULL/);
  });

  it('borrar una sucursal NO se lleva la vinculación por delante', () => {
    // `ON DELETE RESTRICT` y no `CASCADE`: lo que tiene que pasar es que la
    // operación falle y alguien elija otra sucursal.
    expect(CODIGO_VINCULACION).toMatch(/REFERENCES puntos_de_venta\(id\)[^\n]*ON DELETE RESTRICT/);
    expect(CODIGO_CATALOGO).toMatch(/REFERENCES puntos_de_venta\(id\)[^\n]*ON DELETE RESTRICT/);
  });
});

// ════════════════════════════════════════════
//  4 · Lo que estas migraciones NO tienen que hacer
// ════════════════════════════════════════════

describe('El índice único de FR-026 sobre stock_movements NO se crea', () => {
  // Es el riesgo 1 del plan y el peor de su lista. FR-026 pide
  // `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements`, y
  // `referencia_id` no es único por diseño en ninguno de sus tres usos:
  // `routes/sales.js:557` escribe una fila POR LÍNEA de la venta con el mismo
  // `sale.id`. Con ese índice, el primer ticket de dos productos del día
  // siguiente al deploy revierte la transacción entera y el comercio no puede
  // cobrar.
  //
  // El plan lo deja escrito en tres lugares y esta guardia es el cuarto, que es
  // el único que se ejecuta.
  it('ninguna de las dos migraciones toca stock_movements', () => {
    expect(CODIGO_VINCULACION).not.toContain('stock_movements');
    expect(CODIGO_CATALOGO).not.toContain('stock_movements');
  });

  it('la guardia mira el CÓDIGO y no los comentarios que explican por qué no se hace', () => {
    // Los dos encabezados nombran `stock_movements` para explicar el motivo. Sin
    // el filtro de comentarios, esta guardia nacería en rojo por una explicación
    // —y alguien la borraría—; con el filtro mal escrito, pasaría en verde
    // aunque la migración lo creara de verdad.
    expect(TEXTO_VINCULACION).toContain('stock_movements');
    expect(TEXTO_CATALOGO).toContain('stock_movements');

    expect(sinComentarios('// stock_movements\nCREATE TABLE x;')).not.toContain('stock_movements');
    expect(sinComentarios('/* stock_movements */\nCREATE TABLE x;')).not.toContain('stock_movements');
    expect(sinComentarios("q('CREATE UNIQUE INDEX ON stock_movements');")).toContain('stock_movements');
  });
});

describe('disparador es VARCHAR con CHECK y no un ENUM', () => {
  // El proyecto 0 de `PROXIMOS-PROYECTOS.md` dejó ocho columnas declaradas
  // `ENUM` en el modelo y creadas `VARCHAR` por las migraciones, y ese desajuste
  // sigue abierto: `sync({ alter: true })` en desarrollo muere en
  // `products.unit_type` antes de llegar a cualquier otra cosa. Un ENUM nuevo
  // sería la novena columna de ese problema.
  it('el modelo lo declara STRING y no ENUM', () => {
    expect(modelos.TiendanubeCorrida.rawAttributes.disparador.type.key).toBe('STRING');
  });

  it('la migración lo crea VARCHAR con un CHECK que nombra los dos valores', () => {
    expect(CODIGO_CATALOGO).toMatch(/disparador\s+VARCHAR\(20\)/);
    expect(CODIGO_CATALOGO).toMatch(/CHECK \(disparador IN \('manual', 'reconciliacion'\)\)/);
    expect(CODIGO_CATALOGO).not.toContain('CREATE TYPE');
  });

  it('los valores del CHECK son los mismos que valida el modelo', () => {
    // Si se separaran, el modelo dejaría pasar un valor que la base rechaza con
    // un 500 que nombra una restricción y no una funcionalidad.
    expect(modelos.TiendanubeCorrida.DISPARADORES).toEqual(['manual', 'reconciliacion']);
  });
});
