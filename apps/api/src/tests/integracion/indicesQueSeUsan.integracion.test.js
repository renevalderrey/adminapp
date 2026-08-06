// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, sequelize, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const path = require('path');
const { sembrarDosEmpresas } = require('./fixtures');
const { capturarConsultas, unicoSelect } = require('./espiaDeConsultas');

// ════════════════════════════════════════════
//  P4 y P6 · Que los cuatro índices existan, y que el planificador los USE
//
//  `tasks.md` decía de P6: «es el único paso que verifica que el índice sirva
//  para lo que se creó, y por eso es el que no se puede saltear». Y de P4: que
//  `verificar:esquema` **no mira índices** —hace un `findOne` por modelo—, así
//  que una migración a la que le faltara uno pasaría el chequeo igual.
//
//  Los dos se pueden correr acá, y este archivo los corre.
//
//  ── Por qué el `EXPLAIN` va sobre el SQL de la APLICACIÓN ──
//
//  El paso manual pedía pegar la consulta en `psql`. Una consulta retipeada en
//  el test dice que *esa* consulta usa el índice, no la que corre la pantalla:
//  las dos se separan apenas alguien agregue un `where` o cambie el `group`, y
//  el test seguiría en verde hablando de algo que ya no existe. Acá se pide el
//  request de verdad, se espía el SQL que Sequelize emitió y se le pide el plan
//  a ese texto.
//
//  ── Por qué hace falta volumen, y cuánto ──
//
//  Con las cuatro filas de la fixture, Postgres elige `Seq Scan` **y tiene
//  razón**: leer una página entera cuesta menos que bajar por un índice. Un
//  `EXPLAIN` sobre la fixture chica no diría nada sobre el índice; diría que la
//  tabla es chica.
//
//  Lo que hace falta no es «muchas filas» sino que **`empresa_id` sea
//  selectivo**, que es exactamente para lo que se creó el índice: la tabla
//  grande es la de todas las empresas cliente juntas y cada pantalla lee la suya.
//  Por eso se siembran 10.000 movimientos de la empresa B contra 300 de la A. El
//  plan quedó igual —el mismo índice— probado con 2.000, 10.000 y 40.000, así
//  que el número no está al filo.
//
//  ⚠ **El `ANALYZE` no es decorativo.** Sin estadísticas frescas el planificador
//  usa las de antes del `TRUNCATE` del `beforeEach`, que dicen que la tabla está
//  vacía, y elige secuencial sobre diez mil filas.
//
//  ── Lo que se afirma del plan, y lo que no ──
//
//  Se afirma **el nombre del índice** y que no haya `Seq Scan` sobre la tabla.
//  **No** se afirma el tipo de nodo: el mismo índice se lee con `Index Scan` o
//  con `Bitmap Index Scan` según la selectividad, y las tres corridas de prueba
//  dieron los dos. Fijar el tipo de nodo sería un test que se pone en rojo
//  cuando cambia la cantidad de datos y no cuando se rompe lo que dice cuidar.
// ════════════════════════════════════════════

/** El archivo que crea los índices. Los nombres salen de acá, no de una copia. */
const MIGRACION = path.join(
  __dirname, '..', '..', 'migrations', '20260808-indices-de-empresa-en-proveedores.js'
);

/** Los cuatro índices tal como los declara la migración. */
const { INDICES_DECLARADOS, listaDeLaMigracion } = (() => {
  // Se lee el módulo y se le saca la constante por texto: exportarla solo para
  // el test cambiaría el archivo de producción, y lo que se quiere verificar es
  // justamente lo que ese archivo dice.
  const fuente = require('fs').readFileSync(MIGRACION, 'utf8');

  const lista = [...fuente.matchAll(
    /\{\s*nombre:\s*'([^']+)',\s*tabla:\s*'([^']+)',\s*columnas:\s*'([^']+)'\s*\}/g
  )].map(([, nombre, tabla, columnas]) => ({
    nombre,
    tabla,
    columnas: columnas.split(',').map((c) => c.trim()),
  }));

  return { INDICES_DECLARADOS: lista, listaDeLaMigracion: lista };
})();

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterAll(async () => {
  await cerrar();
});

/**
 * Deja las dos tablas con volumen suficiente para que `empresa_id` sea
 * selectivo, y con las estadísticas al día.
 *
 * Se insertan con un solo `INSERT … SELECT generate_series` por tabla: diez mil
 * `bulkCreate` tardarían más que todo el resto del archivo junto.
 */
async function sembrarVolumen({ ajenas = 10000, propias = 300 } = {}) {
  await sequelize.query(
    `INSERT INTO supplier_movements (empresa_id, supplier_id, type, date, amount)
     SELECT ${datos.empresaB.id}, ${datos.molinoB.id},
            (CASE WHEN i % 2 = 0 THEN 'deuda' ELSE 'pago' END)::enum_supplier_movements_type,
            DATE '2026-01-01', 1.00
       FROM generate_series(1, ${ajenas}) AS i`
  );

  await sequelize.query(
    `INSERT INTO supplier_movements (empresa_id, supplier_id, type, date, amount)
     SELECT ${datos.empresaA.id}, ${datos.zeta.id},
            (CASE WHEN i % 2 = 0 THEN 'deuda' ELSE 'pago' END)::enum_supplier_movements_type,
            DATE '2026-01-01', 1.00
       FROM generate_series(1, ${propias}) AS i`
  );

  await sequelize.query(
    `INSERT INTO supplier_orders (empresa_id, supplier_id, date, total, detail, status)
     SELECT ${datos.empresaB.id}, ${datos.molinoB.id}, DATE '2026-01-01', 1.00, '[]'::jsonb,
            (CASE WHEN i % 7 = 0 THEN 'pending' ELSE 'received' END)::enum_supplier_orders_status
       FROM generate_series(1, ${ajenas}) AS i`
  );

  await sequelize.query('ANALYZE supplier_movements');
  await sequelize.query('ANALYZE supplier_orders');
}

/** Todos los nodos del plan, aplanados. */
function nodosDelPlan(nodo, acc = []) {
  if (!nodo) return acc;
  acc.push(nodo);
  for (const hijo of nodo.Plans || []) nodosDelPlan(hijo, acc);
  return acc;
}

/** El plan de una consulta ya escrita, como lista de nodos. */
async function planDe(sql) {
  const [filas] = await sequelize.query(`EXPLAIN (FORMAT JSON) ${sql}`);
  // `pg` devuelve la columna `QUERY PLAN` ya parseada a objeto.
  const raiz = filas[0]['QUERY PLAN'][0].Plan;
  return nodosDelPlan(raiz);
}

/**
 * Afirma que el plan usa el índice y que no barre la tabla.
 *
 * Las dos mitades hacen falta: un plan puede usar un índice para una parte y
 * barrer la tabla igual para otra, y entonces el índice «aparece» sin haber
 * servido de nada.
 */
async function esperaQueUseElIndice(sql, indice, tabla) {
  const nodos = await planDe(sql);

  const indices = nodos.map((n) => n['Index Name']).filter(Boolean);
  const barridos = nodos.filter(
    (n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === tabla
  );

  expect({ indices, barridos: barridos.length }).toEqual({
    indices: expect.arrayContaining([indice]),
    barridos: 0,
  });
}

describe('P4 · Los cuatro índices que la migración declara existen en la base', () => {
  it('la migración declara cuatro y todos están creados, sobre su tabla y sus columnas', async () => {
    // El ancla: si alguien vacía la lista de la migración, esto lo dice en vez
    // de pasar por recorrer un arreglo vacío.
    expect(listaDeLaMigracion).toHaveLength(4);

    const [filas] = await sequelize.query(
      `SELECT i.relname AS nombre, t.relname AS tabla,
              array_agg(a.attname::text ORDER BY k.ord) AS columnas
         FROM pg_class i
         JOIN pg_index x ON x.indexrelid = i.oid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE i.relname LIKE 'idx_supplier%'
        GROUP BY i.relname, t.relname`
    );

    const enLaBase = new Map(filas.map((f) => [f.nombre, f]));

    for (const declarado of INDICES_DECLARADOS) {
      const real = enLaBase.get(declarado.nombre);

      // El mensaje nombra el índice: «undefined» sin decir cuál obliga a ir a
      // buscar los cuatro a mano.
      expect(real ? real.nombre : `FALTA ${declarado.nombre}`).toBe(declarado.nombre);
      expect(real.tabla).toBe(declarado.tabla);
      // El ORDEN de las columnas importa: `(empresa_id, supplier_id)` sirve para
      // filtrar por empresa y `(supplier_id, empresa_id)` no.
      expect(real.columnas).toEqual(declarado.columnas);
    }
  });

  it('⚠ el `\\di supplier*` del paso manual NO los habría mostrado', async () => {
    // `\di` filtra por el nombre del ÍNDICE, no por el de la tabla, y los cuatro
    // se llaman `idx_…`. O sea que el comando escrito en el paso manual devuelve
    // los nueve índices viejos y ninguno de los cuatro nuevos: quien lo corriera
    // habría concluido que la migración no hizo nada.
    //
    // Queda como test y no como nota al pie porque es la clase de cosa que se
    // corrige en el documento y vuelve en el siguiente.
    const [conElPatronDelPaso] = await sequelize.query(
      "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'supplier%'"
    );

    const nombres = conElPatronDelPaso.map((f) => f.indexname);

    for (const { nombre } of INDICES_DECLARADOS) {
      expect(nombres).not.toContain(nombre);
    }
  });
});

describe('P6 · El planificador elige el índice, no un Seq Scan', () => {
  it('el GROUP BY del listado de proveedores usa idx_supplier_movements_empresa_supplier', async () => {
    await sembrarVolumen();

    const { consultas } = await capturarConsultas(sequelize, () =>
      request(app).get('/api/suppliers').query({ limit: 200 })
    );

    // El SQL que corrió la aplicación, no uno retipeado acá.
    const sql = unicoSelect(
      consultas.filter((s) => s.includes('GROUP BY')),
      'supplier_movements'
    );

    expect(sql).toContain('GROUP BY');

    await esperaQueUseElIndice(
      sql,
      'idx_supplier_movements_empresa_supplier',
      'supplier_movements'
    );
  });

  it('la consulta de órdenes abiertas del listado usa idx_supplier_orders_empresa_status', async () => {
    await sembrarVolumen();

    const { consultas } = await capturarConsultas(sequelize, () =>
      request(app).get('/api/suppliers').query({ limit: 200 })
    );

    const sql = unicoSelect(consultas, 'supplier_orders');

    await esperaQueUseElIndice(
      sql,
      'idx_supplier_orders_empresa_status',
      'supplier_orders'
    );
  });

  it('el GROUP BY de la ficha de un proveedor también baja por el índice', async () => {
    await sembrarVolumen();

    const { consultas } = await capturarConsultas(sequelize, () =>
      request(app).get(`/api/suppliers/${datos.zeta.id}`)
    );

    const sql = unicoSelect(
      consultas.filter((s) => s.includes('GROUP BY')),
      'supplier_movements'
    );

    // La ficha filtra por empresa **y** por proveedor: es el par exacto del
    // índice compuesto, y es la consulta que más veces corre —una por cada
    // apertura de ficha, más el chequeo del borrado—.
    await esperaQueUseElIndice(
      sql,
      'idx_supplier_movements_empresa_supplier',
      'supplier_movements'
    );
  });
});
