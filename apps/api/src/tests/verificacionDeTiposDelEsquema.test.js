const {
  compararTipos,
  describirModelo,
  udtEsperado,
} = require('../../scripts/verificar-esquema');

const Product = require('../models/Product');

// ════════════════════════════════════════════
//  La red que el chequeo de esquema no tenía
//
//  `scripts/verificar-esquema.js` hacía un `findOne` por modelo. Con eso pasaba
//  en verde una base donde ocho columnas eran `VARCHAR` y sus modelos declaraban
//  `ENUM`: un SELECT sobre un VARCHAR anda perfecto. Lo que no andaba era el
//  arranque en desarrollo, porque `sequelize.sync({ alter: true })` intentaba
//  convertirlas. O sea: el chequeo decía que sí y el servidor no levantaba.
//
//  La segunda comprobación compara el tipo declarado por el modelo contra
//  `information_schema`. Este test la ejercita con modelos y columnas
//  inventadas, que es la única forma de afirmar que **detecta** una divergencia
//  sin fabricar una base rota en cada corrida: si el test se limitara a correr
//  el script contra una base sana, pasaría en verde con la comparación
//  desactivada.
// ════════════════════════════════════════════

/** Un modelo descrito como lo devuelve `describirModelo`, sin base de por medio. */
function modelo(tabla, columnas) {
  return { tabla, columnas };
}

/** El Map de columnas reales que la comparación espera recibir de la base. */
function base(entradas) {
  return new Map(Object.entries(entradas));
}

describe('La comparación de tipos contra information_schema', () => {
  it('ve el defecto original: el modelo declara ENUM y la base tiene VARCHAR', () => {
    // Es exactamente `products.unit_type` antes de
    // `migrations/20260809-tipos-enum-y-indices-de-productos.js`.
    const { comparadas, divergencias } = compararTipos(
      [modelo('products', [
        { columna: 'unit_type', clave: 'ENUM', valores: ['unidad', 'kg'] },
      ])],
      base({ 'products.unit_type': { udt_name: 'varchar', etiquetas: null } })
    );

    expect(comparadas).toBe(1);
    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].donde).toBe('products.unit_type');
    // El mensaje tiene que nombrar los dos lados: sin eso, quien lee el rojo de
    // CI no sabe si sobra el ENUM en el modelo o falta en la base.
    expect(divergencias[0].motivo).toContain('enum_products_unit_type');
    expect(divergencias[0].motivo).toContain('varchar');
  });

  it('no se queja cuando la columna YA es el ENUM que el modelo declara', () => {
    // El caso de producción: ahí estas columnas ya son ENUM. Si esto diera
    // divergencia, CI estaría en rojo permanente contra la única base real.
    const { comparadas, divergencias } = compararTipos(
      [modelo('products', [
        { columna: 'unit_type', clave: 'ENUM', valores: ['unidad', 'kg'] },
      ])],
      base({
        'products.unit_type': {
          udt_name: 'enum_products_unit_type',
          etiquetas: ['unidad', 'kg'],
        },
      })
    );

    expect(comparadas).toBe(1);
    expect(divergencias).toEqual([]);
  });

  it('ve los MISMOS valores en distinto orden como una divergencia', () => {
    // El orden de un ENUM en Postgres es el de comparación: `ORDER BY status`
    // ordena por `enumsortorder`, no alfabéticamente. Dos bases con los mismos
    // valores en distinto orden devuelven listados distintos y ninguna consulta
    // falla, así que si esto no lo mirara acá no lo miraría nada.
    const { divergencias } = compararTipos(
      [modelo('suscripciones', [
        { columna: 'status', clave: 'ENUM', valores: ['trialing', 'active'] },
      ])],
      base({
        'suscripciones.status': {
          udt_name: 'enum_suscripciones_status',
          etiquetas: ['active', 'trialing'],
        },
      })
    );

    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].motivo).toContain('valores del ENUM');
  });

  it('ve un valor que falta en el tipo de la base', () => {
    const { divergencias } = compararTipos(
      [modelo('invitaciones', [
        { columna: 'role', clave: 'ENUM', valores: ['admin', 'vendedor', 'compras'] },
      ])],
      base({
        'invitaciones.role': {
          udt_name: 'enum_invitaciones_role',
          etiquetas: ['admin', 'vendedor'],
        },
      })
    );

    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].motivo).toContain('compras');
  });

  it('ve una divergencia que no es de ENUM: DECIMAL declarado sobre un varchar', () => {
    // El defecto de los ENUM es el que se encontró, pero la comprobación no es
    // sobre los ENUM: es sobre el tipo. Una columna de plata guardada como texto
    // suma mal y no falla nada.
    const { divergencias } = compararTipos(
      [modelo('sales', [{ columna: 'total', clave: 'DECIMAL', valores: null }])],
      base({ 'sales.total': { udt_name: 'varchar', etiquetas: null } })
    );

    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].motivo).toContain('numeric');
  });

  it('falla si un tipo de Sequelize no está en la tabla, en vez de saltearlo', () => {
    // Saltearlo dejaría el mismo agujero que este chequeo vino a tapar: una
    // columna que nadie compara y un script que igual sale en verde. El mensaje
    // dice dónde se agrega el equivalente.
    const { divergencias } = compararTipos(
      [
        modelo('t', [{ columna: 'c', clave: 'GEOMETRY', valores: null }]),
        modelo('t', [{ columna: 'd', clave: 'INTEGER', valores: null }]),
      ],
      base({
        't.c': { udt_name: 'geometry', etiquetas: null },
        't.d': { udt_name: 'int4', etiquetas: null },
      })
    );

    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].donde).toBe('t.c');
    expect(divergencias[0].motivo).toContain('UDT_POR_TIPO');
  });

  it('una columna que la base no tiene NO cuenta como comparada', () => {
    // Si contara, una base a la que le faltan la mitad de las columnas
    // informaría el mismo número que una completa, y el número es lo único que
    // avisa que el chequeo se quedó mirando poco.
    const { comparadas, divergencias } = compararTipos(
      [modelo('t', [
        { columna: 'existe', clave: 'INTEGER', valores: null },
        { columna: 'no_existe', clave: 'INTEGER', valores: null },
      ])],
      base({ 't.existe': { udt_name: 'int4', etiquetas: null } })
    );

    expect(comparadas).toBe(1);
    expect(divergencias).toHaveLength(1);
    expect(divergencias[0].donde).toBe('t.no_existe');
  });

  it('TIRA si no comparó ninguna columna, en vez de salir en verde', () => {
    // El ancla. Un chequeo que no comparó nada y contesta «todo bien» es peor
    // que no tener chequeo: da una garantía que no existe. Ya pasó en este
    // repositorio con `--passWithNoTests`.
    expect(() => compararTipos([], base({}))).toThrow(/no comparó ninguna columna/);

    expect(() => compararTipos(
      [modelo('t', [{ columna: 'c', clave: 'INTEGER', valores: null }])],
      base({})
    )).toThrow(/no comparó ninguna columna/);
  });

  it('cuenta cuántas columnas comparó', () => {
    const { comparadas } = compararTipos(
      [
        modelo('a', [
          { columna: 'x', clave: 'INTEGER', valores: null },
          { columna: 'y', clave: 'TEXT', valores: null },
        ]),
        modelo('b', [{ columna: 'z', clave: 'BOOLEAN', valores: null }]),
      ],
      base({
        'a.x': { udt_name: 'int4', etiquetas: null },
        'a.y': { udt_name: 'text', etiquetas: null },
        'b.z': { udt_name: 'bool', etiquetas: null },
      })
    );

    expect(comparadas).toBe(3);
  });
});

describe('El nombre del tipo que se espera', () => {
  it('a un ENUM le corresponde enum_<tabla>_<columna>, que es como lo nombra Sequelize', () => {
    expect(udtEsperado('ENUM', 'products', 'unit_type')).toBe('enum_products_unit_type');
  });

  it('las familias que usan los modelos de hoy están todas mapeadas', () => {
    // Si alguna faltara, la comparación las reportaría como «no sé qué tipo le
    // corresponde» y el rojo de CI no diría nada sobre el esquema.
    for (const clave of ['BOOLEAN', 'DATE', 'DATEONLY', 'DECIMAL', 'INTEGER', 'JSONB', 'STRING', 'TEXT']) {
      expect(udtEsperado(clave, 't', 'c')).toBeTruthy();
    }
  });

  it('DATE es timestamptz y DATEONLY es date, que no son lo mismo', () => {
    // Confundirlos es lo que hace que una fecha cargada a las 21:30 aparezca al
    // día siguiente. Acá se fija cuál es cuál.
    expect(udtEsperado('DATE', 't', 'c')).toBe('timestamptz');
    expect(udtEsperado('DATEONLY', 't', 'c')).toBe('date');
  });
});

describe('La lectura de un modelo real', () => {
  const descrito = describirModelo(Product);

  it('encuentra la tabla y sus columnas', () => {
    // Ancla: sin esto, un cambio en `rawAttributes` dejaría la descripción vacía
    // y la comparación no tendría nada que comparar.
    expect(descrito.tabla).toBe('products');
    expect(descrito.columnas.length).toBeGreaterThan(10);
  });

  it('lee unit_type como ENUM con los valores que declara el modelo', () => {
    const unitType = descrito.columnas.find((c) => c.columna === 'unit_type');

    expect(unitType.clave).toBe('ENUM');
    expect(unitType.valores).toEqual(['unidad', 'kg', 'gr', 'litro', 'ml']);
  });

  it('y a la base le pediría el tipo enum_products_unit_type', () => {
    expect(udtEsperado('ENUM', descrito.tabla, 'unit_type')).toBe('enum_products_unit_type');
  });
});
