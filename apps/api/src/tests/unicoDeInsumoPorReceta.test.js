// ════════════════════════════════════════════
//  Un insumo aparece UNA vez por receta
//
//  `recipe_items` no tenía índice único por `(recipe_id, ingredient_product_id)`.
//  Cuando una receta lista el mismo insumo dos veces,
//  `costService.calculateProductCost` —que recorre TODOS los ítems sumando
//  `cantidad × costo`— lo suma dos veces y el elaborado queda costeado de más,
//  en silencio. De ahí salen el margen del POS y el precio del Comparador.
//
//  La migración `20260809-unico-de-insumo-por-receta` limpia los duplicados que
//  ya existan y recién después crea el índice. **Qué se hace con esos
//  duplicados es una decisión de negocio**, y por eso vive en una función pura
//  —`planificarFusiones`— en vez de dentro de un SQL: se puede afirmar sobre
//  ella sin levantar Postgres, igual que `utils/consolidacionDeStock`.
//
//  La decisión, resumida: **se suman las cantidades**. Es lo único que no mueve
//  ningún número de plata, porque el costo que el sistema calcula HOY ya es el
//  de la suma. Conservar una sola fila bajaría el costo del elaborado la próxima
//  vez que algo lo recosteara, días después del deploy y sin que nada avise.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

const {
  planificarFusiones,
  informar,
  INDICE,
} = require('../migrations/20260809-unico-de-insumo-por-receta');

const EMPRESA = 7;
const OTRA_EMPRESA = 9;

/** Una fila de `recipe_items` ya unida a su receta, como la lee la migración. */
const item = (id, recipeId, insumo, cantidad, extra = {}) => ({
  id,
  recipe_id: recipeId,
  ingredient_product_id: insumo,
  quantity: cantidad,
  empresa_id: EMPRESA,
  product_id: 100 + recipeId,
  ...extra,
});

describe('planificarFusiones · qué se fusiona con qué', () => {
  it('una receta sin insumos repetidos no produce ninguna fusión', async () => {
    const plan = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 42, '1.5000'),
    ]);

    expect(plan.fusiones).toEqual([]);
    // Ancla: sin esto, un plan vacío por un error de lectura se leería igual que
    // «no había duplicados», que es la diferencia entre mirar y no mirar.
    expect(plan.resumen.filasLeidas).toBe(2);
    expect(plan.resumen.filasAbsorbidas).toBe(0);
  });

  it('el mismo insumo dos veces en la misma receta se fusiona SUMANDO las cantidades', async () => {
    // 200 g para la masa y 50 g para espolvorear. El costo que el sistema
    // calcula hoy para ese elaborado ya es el de 250 g: sumar es lo único que lo
    // deja donde está.
    const plan = planificarFusiones([
      item(1, 1, 41, '0.2000'),
      item(2, 1, 41, '0.0500'),
    ]);

    expect(plan.fusiones).toHaveLength(1);
    expect(plan.fusiones[0].cantidad_final).toBe('0.2500');
    expect(plan.resumen.filasAbsorbidas).toBe(1);
  });

  it('NO se queda con una sola fila y tira la otra: eso bajaría el costo del elaborado', async () => {
    // La corrección fácil —conservar una— cambia un número de plata días después
    // del deploy, cuando algo recostee ese elaborado. Este caso es el que la
    // descarta: 0,20 solo, o 0,05 solo, no son la cantidad de esa receta.
    const [fusion] = planificarFusiones([
      item(1, 1, 41, '0.2000'),
      item(2, 1, 41, '0.0500'),
    ]).fusiones;

    expect(fusion.cantidad_final).not.toBe('0.2000');
    expect(fusion.cantidad_final).not.toBe('0.0500');
  });

  it('las cantidades vienen como STRING de Postgres y se suman: no se concatenan', async () => {
    // `quantity` es NUMERIC y el driver lo entrega como texto. Sumarlo tal cual
    // con `+` concatena —`'0.2000' + '0.0500'` da `'0.20000.0500'`— y eso no
    // rompe nada visible: la cantidad queda en NaN y el costo del elaborado con
    // ella. Los decimales de las fixtures no son decorativos: con cantidades
    // enteras —2 y 3— la concatenación daría `'23'`, que también es un número, y
    // el caso pasaría con y sin la corrección.
    const [fusion] = planificarFusiones([
      item(1, 1, 41, '0.2000'),
      item(2, 1, 41, '0.0500'),
    ]).fusiones;

    expect(fusion.cantidad_final).toBe('0.2500');
    expect(fusion.filas.map((f) => f.quantity)).toEqual(['0.2000', '0.0500']);
  });

  it('sobrevive la fila de MENOR id, aunque llegue última', async () => {
    // La de menor id es la única elección que no depende de datos que empatan:
    // las cantidades empatan justo en el caso sospechoso y `created_at` empata
    // siempre, porque guardar una receta borra y recrea todos sus ítems.
    const [fusion] = planificarFusiones([
      item(9, 1, 41, '3.0000'),
      item(4, 1, 41, '1.0000'),
    ]).fusiones;

    expect(fusion.sobreviviente_id).toBe(4);
    expect(fusion.filas.find((f) => f.sobrevive).id).toBe(4);
    expect(fusion.filas.filter((f) => !f.sobrevive).map((f) => f.id)).toEqual([9]);
  });

  it('tres filas del mismo insumo se juntan en una: dos absorbidas', async () => {
    const plan = planificarFusiones([
      item(1, 1, 41, '1.0000'),
      item(2, 1, 41, '2.0000'),
      item(3, 1, 41, '4.0000'),
    ]);

    expect(plan.fusiones[0].cantidad_final).toBe('7.0000');
    expect(plan.resumen.filasAbsorbidas).toBe(2);
  });

  it('el MISMO insumo en dos recetas distintas NO es un duplicado', async () => {
    // Si la clave del grupo fuera solo el insumo, esto fusionaría dos recetas
    // —acá, encima, de dos empresas cliente distintas— en una sola línea. Es el
    // mismo agujero que la prueba de mutación encontró en la migración de stock.
    const plan = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 2, 41, '5.0000', { empresa_id: OTRA_EMPRESA }),
    ]);

    expect(plan.fusiones).toEqual([]);
  });

  it('dos insumos distintos en la MISMA receta tampoco lo son', async () => {
    // El contrario del anterior: si la clave fuera solo la receta, la harina y
    // la sal terminarían sumadas en una sola línea.
    const plan = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 42, '5.0000'),
    ]);

    expect(plan.fusiones).toEqual([]);
  });

  it('el resumen cuenta recetas y grupos por separado', async () => {
    // Una receta con DOS insumos repetidos es un problema de una sola receta,
    // pero dos fusiones. Contarlo mal en el informe manda a revisar el número
    // equivocado de recetas.
    const plan = planificarFusiones([
      item(1, 1, 41, '1.0000'),
      item(2, 1, 41, '2.0000'),
      item(3, 1, 42, '1.0000'),
      item(4, 1, 42, '3.0000'),
      item(5, 2, 41, '1.0000'),
    ]);

    expect(plan.resumen.recetasConDuplicados).toBe(1);
    expect(plan.resumen.gruposFusionados).toBe(2);
  });
});

describe('planificarFusiones · a quién hay que ir a mirarle la receta', () => {
  it('marca REVISAR cuando las filas tienen la MISMA cantidad: se ve como carga doble', async () => {
    const [fusion] = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 41, '2.0000'),
    ]).fusiones;

    expect(fusion.revisar).toBe(true);
    // Se suman IGUAL: bajar el costo de un elaborado sin que nadie lo pida es
    // peor que dejarlo como está y avisar.
    expect(fusion.cantidad_final).toBe('4.0000');
  });

  it('NO marca cuando las cantidades son distintas: se ven como dos momentos de la receta', async () => {
    const [fusion] = planificarFusiones([
      item(1, 1, 41, '0.2000'),
      item(2, 1, 41, '0.0500'),
    ]).fusiones;

    expect(fusion.revisar).toBe(false);
  });

  it('con tres filas, alcanza que UNA sea distinta para no marcar', async () => {
    const [fusion] = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 41, '2.0000'),
      item(3, 1, 41, '5.0000'),
    ]).fusiones;

    expect(fusion.revisar).toBe(false);
  });

  it('la nota explica por qué se sumó, en los dos casos', async () => {
    // El archivo se lee meses después, cuando quien migró ya no está. Una fila
    // con `revisar = TRUE` y sin texto no dice qué hay que hacer con ella.
    const marcada = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 41, '2.0000'),
    ]).fusiones[0];

    const suelta = planificarFusiones([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 41, '5.0000'),
    ]).fusiones[0];

    expect(marcada.nota).toMatch(/dos veces/);
    expect(suelta.nota).toMatch(/dos momentos/);
  });
});

describe('El informe: una limpieza silenciosa sobre datos de un cliente no vale', () => {
  const capturar = (filas) => {
    const lineas = [];
    informar(planificarFusiones(filas), (l) => lineas.push(l));
    return lineas.join('\n');
  };

  it('dice cuántas filas leyó incluso cuando no hay nada que tocar', async () => {
    // «Las leí y no había» es distinto de un log mudo, que se lee igual que «no
    // miré». Es la misma distinción que pide `docs/OPERACION.md` para el informe
    // de stock.
    const salida = capturar([item(1, 1, 41, '2.0000')]);

    expect(salida).toMatch(/1 fila\(s\) de receta leídas/);
    expect(salida).toMatch(/No hay ninguna receta con el mismo insumo repetido/);
  });

  it('nombra la empresa, el elaborado y el insumo de cada fusión', async () => {
    // Sin el elaborado, el operador tiene el número de una receta y ninguna
    // pantalla donde buscarlo.
    const salida = capturar([
      item(1, 3, 41, '0.2000'),
      item(2, 3, 41, '0.0500'),
    ]);

    expect(salida).toMatch(/empresa 7/);
    expect(salida).toMatch(/elaborado 103/);
    expect(salida).toMatch(/insumo 41/);
    expect(salida).toMatch(/0\.2000 \+ 0\.0500 = 0\.2500/);
  });

  it('las marcadas se ven en el informe y no solo en la tabla', async () => {
    const salida = capturar([
      item(1, 1, 41, '2.0000'),
      item(2, 1, 41, '2.0000'),
    ]);

    expect(salida).toMatch(/REVISAR/);
    expect(salida).toMatch(/1 fusión\(es\) marcadas para revisar/);
  });

  it('con muchas fusiones manda al archivo en vez de escupir mil líneas', async () => {
    const filas = [];
    for (let receta = 1; receta <= 60; receta += 1) {
      filas.push(item(receta * 2 - 1, receta, 41, '1.0000'));
      filas.push(item(receta * 2, receta, 41, '2.0000'));
    }

    const salida = capturar(filas);

    expect(salida).toMatch(/y 10 más/);
    expect(salida).toMatch(/recipe_items_duplicados/);
  });
});

// ════════════════════════════════════════════
//  El índice que crea la migración es el que declara el modelo
//
//  Un índice que la migración crea y el modelo no declara desaparece la primera
//  vez que alguien levanta una base con `sync({ alter: true })`. Y si los
//  NOMBRES no coinciden, sobre una base migrada ese mismo `sync` intenta crear
//  un SEGUNDO índice único sobre las mismas dos columnas.
//
//  Es una comparación de texto, grosera a propósito: el desajuste no lo ve
//  ningún test de comportamiento y `scripts/verificar-esquema.js` tampoco —hace
//  un `findOne` por modelo—.
// ════════════════════════════════════════════

describe('El único de recipe_items, en el modelo y en la migración', () => {
  const migracion = fs.readFileSync(
    path.join(SRC, 'migrations', '20260809-unico-de-insumo-por-receta.js'),
    'utf8'
  );
  const modelo = fs.readFileSync(path.join(SRC, 'models', 'RecipeItem.js'), 'utf8');

  it('el modelo declara el índice con el MISMO nombre que la migración', async () => {
    expect(INDICE).toBe('idx_recipe_items_recipe_ingredient');
    expect(modelo).toMatch(new RegExp(`name: '${INDICE}'`));
  });

  it('es único en los dos lados: sin `unique` no impide nada', async () => {
    // Un índice no único sobre esas dos columnas acelera la consulta y deja
    // entrar el duplicado igual. El costo seguiría saliendo mal.
    expect(modelo).toMatch(/unique: true,\s*\n\s*fields: \['recipe_id', 'ingredient_product_id'\]/);
    expect(migracion).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS \$\{INDICE\} ON recipe_items \(recipe_id, ingredient_product_id\)/
    );
  });

  it('la migración limpia los duplicados ANTES de crear el índice', async () => {
    // Al revés, el CREATE falla sobre cualquier base que ya los tenga y el
    // contenedor no levanta. Es el orden lo que se afirma, no que exista cada
    // paso.
    const fusion = migracion.indexOf('const plan = planificarFusiones(filas)');
    const borrado = migracion.indexOf('DELETE FROM recipe_items WHERE id IN');
    const indice = migracion.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS');

    expect(fusion).toBeGreaterThanOrEqual(0);
    expect(borrado).toBeGreaterThan(fusion);
    expect(indice).toBeGreaterThan(borrado);
  });

  it('el down borra el índice que el up crea, y antes de reinsertar', async () => {
    // Reinsertar las filas absorbidas vuelve a crear los duplicados: con el
    // único todavía puesto, el INSERT falla y el rollback no se puede hacer.
    const dropIndice = migracion.indexOf('DROP INDEX IF EXISTS');
    const reinsercion = migracion.indexOf('INSERT INTO recipe_items (id,');

    expect(dropIndice).toBeGreaterThanOrEqual(0);
    expect(reinsercion).toBeGreaterThan(dropIndice);
  });

  it('la sobreviviente vuelve a su cantidad ANTES de que se reinserten las otras', async () => {
    // Al revés, la receta queda con la cantidad sumada MÁS las filas
    // originales: el elaborado costaría el doble después de un rollback.
    const restaura = migracion.indexOf('UPDATE recipe_items ri');
    const reinsercion = migracion.indexOf('INSERT INTO recipe_items (id,');

    expect(restaura).toBeGreaterThanOrEqual(0);
    expect(reinsercion).toBeGreaterThan(restaura);
  });
});
