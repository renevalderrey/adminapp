// ════════════════════════════════════════════
//  Cerrar una orden de producción sobre un grafo en diamante
//
//  El grafo: la Premezcla es insumo de la Barra, y el Combo lleva Premezcla
//  **y** Barra. Dos caminos distintos llegan al Combo desde la Premezcla, y
//  ninguno vuelve para atrás: no hay ciclo por ningún lado.
//
//  `createProductionOrder` recorría los dependientes con **un solo Set
//  `visited`** para todas las ramas del bucle, y encima le agregaba cada
//  elaborado ya recosteado. Así, la segunda rama se encontraba el Combo marcado
//  por la primera y `costService` respondía «Dependencia circular detectada»
//  sobre un grafo que no tiene ciclos.
//
//  Ese error es un `Error` pelado y la llamada está adentro de la transacción de
//  la orden: subía como 500 genérico —«Error al crear la orden de producción»,
//  sin nombrar ni el producto ni la receta— y revertía la orden entera. O sea,
//  **el lote se producía en la planta y el sistema no lo podía registrar**.
//
//  Y era intermitente: el `findAll` de dependientes no llevaba `ORDER BY`, así
//  que con la fila de la Barra primero la misma orden se cerraba con un 201.
//
//  ⚠ Estos casos corren `costService` DE VERDAD. Un doble que solo anota el Set
//  y no recorre recetas deja el defecto estructuralmente invisible: nunca llega
//  al `visited.has()` que lanza. Eso ya pasó una vez en `recepcionDeOrden`, con
//  diez casos en verde sobre un endpoint que respondía 500.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const { crearModelo } = require('./helpers/modelosFalsos');

const PROPIA = 7;
const AJENA = 9;

const COLAGENO = 41;
const PREMEZCLA = 60;
const BARRA = 70;
const COMBO = 80;

/**
 * `crearModelo` no trae `findOrCreate` y `productionService` la usa para las
 * cuatro escrituras de stock. Se agrega acá y no en el helper compartido para
 * no cambiarle la superficie a los archivos que ya lo usan.
 */
function conFindOrCreate(modelo) {
  modelo.findOrCreate = async ({ where, defaults = {}, transaction }) => {
    const existente = await modelo.findOne({ where, transaction });
    if (existente) return [existente, false];

    const creada = await modelo.create({ ...where, ...defaults }, { transaction });
    return [creada, true];
  };

  return modelo;
}

const mockProduct = crearModelo([]);
const mockStock = conFindOrCreate(crearModelo([]));
const mockPuntoDeVenta = crearModelo([]);
const mockProductCostHistory = crearModelo([]);

const mockRecipe = crearModelo([], {
  // `costService.calculateProductCost` pide la receta con sus ítems y, dentro de
  // cada ítem, el costo del insumo. `crearModelo` resuelve un nivel por alias,
  // así que el anidado se arma acá.
  //
  // ⚠ `ingredient` apunta a la fila VIVA de `mockProduct`, no a una copia. Con
  // una copia la cascada leería siempre el costo anterior al UPDATE —que es
  // exactamente el defecto de MVCC que documenta costService— y el diamante
  // daría el mismo número con y sin la corrección.
  items: (fila) => mockRecipeItem.filas
    .filter((i) => i.recipe_id === fila.id)
    .map((i) => ({
      ...i,
      ingredient: mockProduct.filas.find((p) => p.id === i.ingredient_product_id) || null,
    })),
});

const mockRecipeItem = crearModelo([], {
  recipe: (fila) => mockRecipe.filas.find((r) => r.id === fila.recipe_id) || null,
});

const mockProductionOrder = crearModelo([], {
  product: (fila) => mockProduct.filas.find((p) => p.id === fila.product_id) || null,
  items: (fila) => mockProductionOrderItem.filas.filter((i) => i.production_order_id === fila.id),
});

const mockProductionOrderItem = crearModelo([]);

// El recorrido real, con un espía encima. Lo que llega acá son las llamadas de
// NIVEL SUPERIOR —una por rama del bucle—, porque la recursión de costService va
// por `this` y no vuelve a pasar por el doble. El Set que recibió cada una es
// justamente lo que el defecto compartía.
const mockRecosteosPedidos = [];

jest.mock('../services/costService', () => ({
  recalculateCascadingCosts: jest.fn(async (productId, visited, transaction) => {
    // `visitadosAlLlamar` es una copia y hace falta: `recalculateCascadingCosts`
    // le agrega el producto al Set que recibe, así que mirar la referencia viva
    // después del request no dice con qué llegó, dice cómo terminó.
    mockRecosteosPedidos.push({
      productId,
      visited,
      visitadosAlLlamar: new Set(visited),
      transaction,
    });

    return mockCostServiceDeVerdad
      .recalculateCascadingCosts(productId, visited, transaction);
  }),
}));

// `findScoped` mira la PK del modelo para decidir si castea el id a entero. Sin
// esto devuelve `String(id)`, el `where` compara '70' contra 70 y el aviso no
// encontraría nunca el producto que tiene que nombrar.
for (const doble of [mockProduct, mockPuntoDeVenta]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

jest.mock('../models', () => ({
  ProductionOrder: mockProductionOrder,
  ProductionOrderItem: mockProductionOrderItem,
  Product: mockProduct,
  Recipe: mockRecipe,
  RecipeItem: mockRecipeItem,
  Stock: mockStock,
  PuntoDeVenta: mockPuntoDeVenta,
  ProductCostHistory: mockProductCostHistory,
  // ⚠ Sin transacción de verdad: **los dobles no revierten nada**. Un request
  // que termina en 500 deja igual escrito el stock y el costo, así que «el
  // insumo se descontó» o «el costo quedó» no significan nada por sí solos. Por
  // eso todo caso que afirme sobre datos escritos mira TAMBIÉN el status.
  sequelize: {
    transaction: async () => ({ commit: async () => {}, rollback: async () => {} }),
  },
}));

// El algoritmo real se resuelve UNA vez y acá, no dentro del espía.
//
// Resolverlo en cada llamada le cargaba el primer `requireActual` —y con él la
// carga de pino y su worker— al primer `it` del archivo, que pasaba de los
// 5000 ms de jest en una corrida de cada tres. Un test que se pone rojo por el
// reloj y no por el código es el mismo problema que un test intermitente:
// alguien termina borrándolo.
const mockCostServiceDeVerdad = jest.requireActual('../services/costService');

// Por el mismo motivo el router se arma en la carga del módulo y no en el
// primer request.
const rutaDeProduccion = require('../routes/production');

function levantarApi(empresaId = PROPIA) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.id = 'req-de-prueba';
    req.usuario = { id: 3 };
    siguiente();
  });
  api.use('/api/production', rutaDeProduccion);
  return api;
}

/** La orden que cierra el lote de Premezcla: 10 unidades. */
const producir = () => request(levantarApi())
  .post('/api/production')
  .send({
    product_id: PREMEZCLA,
    quantity_produced: 10,
    batch_code: 'L-2026-07',
    production_date: '2026-07-20',
  });

const costoDe = (id) => mockProduct.filas.find((p) => p.id === id).cost;

beforeEach(() => {
  mockRecosteosPedidos.length = 0;

  // Los costos de partida son DISTINTOS de los que va a dar el recosteo, en los
  // tres productos. Con fixtures donde el costo viejo ya coincide con el nuevo,
  // `esCambioSignificativo` corta antes y la cascada no se recorre: el test
  // pasaría con y sin la corrección.
  mockProduct.filas = [
    { id: COLAGENO, empresa_id: PROPIA, name: 'Colágeno 300g', cost: 900 },
    { id: PREMEZCLA, empresa_id: PROPIA, name: 'Premezcla base', cost: 1500 },
    { id: BARRA, empresa_id: PROPIA, name: 'Barra proteica', cost: 1200 },
    { id: COMBO, empresa_id: PROPIA, name: 'Combo proteico', cost: 2000 },
    { id: 99, empresa_id: AJENA, name: 'Producto de otro cliente', cost: 100 },
  ];

  // Rendimiento 1 y merma 0: lo que se afirma acá es el recorrido del grafo, no
  // la fórmula del costo, que tiene sus propios tests.
  mockRecipe.filas = [
    { id: 1, product_id: PREMEZCLA, yield: 1, loss_percentage: 0 },
    { id: 2, product_id: BARRA, yield: 1, loss_percentage: 0 },
    { id: 3, product_id: COMBO, yield: 1, loss_percentage: 0 },
  ];

  // ⚠ El orden de estas filas no es casual: la del Combo va ANTES que la de la
  // Barra.
  //
  // El `findAll` no llevaba `ORDER BY`, así que el orden lo elegía Postgres: con
  // la fila de la Barra primero, la misma orden se cerraba con 201 **y el
  // defecto puesto**. Con la del Combo primero el 500 es determinístico, y un
  // test que reproduce el defecto una de cada dos veces es un test que alguien
  // termina borrando por intermitente.
  mockRecipeItem.filas = [
    { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
    { id: 11, recipe_id: 3, ingredient_product_id: PREMEZCLA, quantity: 1 },
    { id: 10, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
    { id: 12, recipe_id: 3, ingredient_product_id: BARRA, quantity: 1 },
  ];

  mockPuntoDeVenta.filas = [
    { id: 1, empresa_id: PROPIA, code: 'principal', name: 'Principal', is_active: true },
  ];

  // Insumo de sobra: los faltantes de stock viajan por la MISMA lista `warnings`
  // que los avisos de recosteo, y un faltante sembrado sin querer haría pasar
  // por bueno el caso en el que el aviso de receta rota no se emite.
  mockStock.filas = [
    { id: 1, empresa_id: PROPIA, product_id: COLAGENO, punto_de_venta_id: 1, location: 'principal', quantity: 100, available: 100 },
  ];

  mockProductionOrder.filas = [];
  mockProductionOrderItem.filas = [];
  mockProductCostHistory.filas = [];

  for (const doble of [mockProduct, mockStock, mockRecipeItem, mockProductionOrder]) {
    doble.llamadas = [];
  }
});

describe('Un grafo en diamante no es una dependencia circular', () => {
  it('cerrar un lote cuyo elaborado alimenta dos recetas del diamante NO responde 500', async () => {
    const res = await producir();

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('el descuento de insumos y el alta de producto terminado entran igual', async () => {
    // Lo que el 500 se llevaba puesto: no quedaba dato corrupto, quedaba la
    // producción bloqueada mientras el lote ya existía en la planta.
    //
    // El status va acá también, y no es redundante: los dobles no entienden
    // transacciones, así que estas filas quedan escritas aunque el request haya
    // terminado en 500 y Postgres las hubiera revertido. Sin mirar el status,
    // «entraron igual» se cumpliría sobre una orden que el usuario nunca vio.
    const res = await producir();

    expect(res.status).toBe(201);
    expect(mockStock.filas).toEqual([
      // 100 − 2 × 10.
      expect.objectContaining({ product_id: COLAGENO, quantity: 80, available: 80 }),
      expect.objectContaining({ product_id: PREMEZCLA, quantity: 10, available: 10 }),
    ]);
    expect(mockProductionOrder.filas).toHaveLength(1);
    expect(mockProductionOrder.filas[0]).toMatchObject({
      product_id: PREMEZCLA, status: 'completed', total_cost: 18000, unit_cost_calculated: 1800,
    });
  });

  it('el costo del elaborado producido y su fila de historial sobreviven', async () => {
    const res = await producir();

    // Igual que arriba: sin el status, esto pasaría sobre un 500, porque los
    // dobles no revierten nada.
    expect(res.status).toBe(201);
    // 2 × 900, rendimiento 1 y merma 0.
    expect(costoDe(PREMEZCLA)).toBe(1800);
    expect(mockProductCostHistory.filas).toContainEqual(expect.objectContaining({
      product_id: PREMEZCLA,
      old_cost: 1500,
      new_cost: 1800,
      reason: 'Actualización por orden de producción',
      usuario_id: 3,
    }));
  });

  it('los dos elaborados de aguas abajo quedan recosteados, y el Combo por el camino largo', async () => {
    await producir();

    // Barra = 1 × Premezcla.
    expect(costoDe(BARRA)).toBe(1800);
    // Combo = 1 × Premezcla + 1 × Barra = 1800 + 1800. El 3600 es lo que prueba
    // que la rama que pasa POR la Barra se recorrió entera: si se cortara ahí,
    // el Combo quedaría en 1800 + 1200 = 3000, con el costo viejo de la barra
    // adentro y nada avisando.
    expect(costoDe(COMBO)).toBe(3600);
  });

  it('cada rama arranca con su propio visited y no con el de la rama anterior', async () => {
    await producir();

    const [primera, segunda] = mockRecosteosPedidos;

    expect(mockRecosteosPedidos).toHaveLength(2);
    // Con un solo Set compartido las dos ramas reciben el MISMO objeto.
    expect(primera.visited).not.toBe(segunda.visited);
    // Y lo puntual: la segunda rama no puede llegar con el Combo ya marcado por
    // la primera. Eso, y nada más que eso, es lo que costService tomaba por un
    // ciclo. La Premezcla sí tiene que estar: es lo que corta los ciclos reales.
    expect(segunda.visitadosAlLlamar.has(COMBO)).toBe(false);
    expect(segunda.visitadosAlLlamar.has(PREMEZCLA)).toBe(true);
  });

  it('la cascada viaja con la MISMA transacción de la orden', async () => {
    // Sin la transacción, `calculateProductCost` abre otra conexión y por MVCC
    // lee los costos anteriores al UPDATE que se acaba de hacer: la cascada
    // recalcula con el número viejo y no cambia nada.
    await producir();

    for (const llamada of mockRecosteosPedidos) {
      expect(llamada.transaction).toBeTruthy();
    }
  });

  it('los dependientes se piden ordenados por id: sin ORDER BY el resultado lo elige Postgres', async () => {
    // Los dobles ignoran `order`, así que esto se afirma sobre la consulta y no
    // sobre el resultado. Es la mitad del defecto que no se puede reproducir en
    // memoria: contra Postgres, sin esta cláusula, la misma orden respondía 201
    // o 500 según qué fila saliera primero.
    await producir();

    const porInsumo = mockRecipeItem.llamadas.filter(
      (l) => l.metodo === 'findAll' && l.where && l.where.ingredient_product_id === PREMEZCLA
    );

    expect(porInsumo.length).toBeGreaterThan(0);
    expect(porInsumo[0].order).toEqual([['id', 'ASC']]);
  });

  it('una receta que lista el mismo insumo dos veces se recostea UNA vez y no falla', async () => {
    // `recipe_items` no tiene índice único por (recipe_id, ingredient_product_id),
    // así que dos filas de la Premezcla en la MISMA receta son posibles. Ahí el
    // 500 ni siquiera dependía del orden de las filas: era determinístico.
    mockRecipeItem.filas = [
      { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
      { id: 20, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
      { id: 21, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
    ];

    const res = await producir();

    expect(res.status).toBe(201);
    // Barra = (1 + 1) × 1800. Un solo elaborado, recosteado una sola vez:
    // hacerlo dos veces da exactamente el mismo número.
    expect(costoDe(BARRA)).toBe(3600);
    expect(mockRecosteosPedidos).toHaveLength(1);
  });

  it('no aparece ningún aviso de receta rota: este grafo no tiene ciclos', async () => {
    const res = await producir();

    expect(res.body.warnings.join(' ')).not.toMatch(/no se pudo recalcular/i);
  });
});

// ════════════════════════════════════════════
//  Un ciclo real avisa, no bloquea la producción
//
//  **Decisión de producto, escrita a propósito y no heredada de dónde cayó el
//  `try`.** Si la cascada se cae de verdad —una receta con un ciclo, o una merma
//  que no deja producto terminado— la orden de producción vale igual y el
//  recosteo se informa como aviso. Es el mismo criterio que tomó
//  `purchaseService.recostearDependientes`, y acá pesa todavía más:
//
//   - el lote se produjo: los insumos se consumieron y el producto terminado
//     está en el depósito. Abortar deja al sistema diciendo lo contrario de lo
//     que hay en la estantería, y sin forma de registrarlo;
//   - la receta que se rompe es la de un TERCER producto, aguas abajo. Bloquear
//     la producción de A porque la receta de C está mal cargada castiga a la
//     operación equivocada, y quien cierra un lote casi nunca puede tocar esa
//     receta;
//   - abortar revierte también el costo del producto recién producido y su fila
//     de historial, que es el propósito de cerrar la orden.
//
//  Lo que no se hace es callarlo: el aviso NOMBRA el elaborado y viaja en
//  `warnings`, la misma lista de los faltantes de stock.
// ════════════════════════════════════════════

describe('Una receta con un ciclo real avisa y no bloquea la producción', () => {
  beforeEach(() => {
    // El ciclo de verdad: la Barra lleva Combo y el Combo lleva Barra. Se puede
    // cargar —`checkCircularDependency` es de este año y las recetas viejas no
    // pasaron por ahí— y no hay forma de recostearlo.
    mockRecipeItem.filas = [
      { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
      { id: 30, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
      { id: 31, recipe_id: 2, ingredient_product_id: COMBO, quantity: 1 },
      { id: 32, recipe_id: 3, ingredient_product_id: BARRA, quantity: 1 },
    ];
  });

  it('la orden se registra: insumos descontados, producto terminado y 201', async () => {
    const res = await producir();

    expect(res.status).toBe(201);
    expect(mockStock.filas).toEqual([
      expect.objectContaining({ product_id: COLAGENO, quantity: 80 }),
      expect.objectContaining({ product_id: PREMEZCLA, quantity: 10 }),
    ]);
    expect(mockProductionOrder.filas[0]).toMatchObject({ status: 'completed' });
  });

  it('el costo del producto producido se actualiza igual, con su fila de historial', async () => {
    // Es lo que el rollback se llevaba: el propósito de cerrar la orden.
    const res = await producir();

    expect(res.status).toBe(201);
    expect(costoDe(PREMEZCLA)).toBe(1800);
    expect(mockProductCostHistory.filas.some(
      (f) => f.product_id === PREMEZCLA && f.reason === 'Actualización por orden de producción'
    )).toBe(true);
  });

  it('el aviso NOMBRA el elaborado que no se pudo recostear', async () => {
    // El 500 decía «Error al crear la orden de producción» y nada más: no
    // nombraba ni el producto ni la receta, así que no había qué abrir para
    // arreglarlo.
    const res = await producir();

    const avisos = res.body.warnings.join(' ');

    expect(avisos).toContain('Barra proteica');
    expect(avisos).toContain('revisá esa receta');
  });

  it('el nombre del elaborado se resuelve con findScoped y no con findByPk', async () => {
    // `recipe_items` no tiene `empresa_id`: una fila cruzada entre empresas
    // pondría el nombre de un producto ajeno en la respuesta.
    await producir();

    const porNombre = mockProduct.llamadas.filter(
      (l) => l.metodo === 'findOne' && l.where && l.where.id === BARRA
    );

    expect(porNombre.length).toBeGreaterThan(0);
    expect(porNombre[0].where.empresa_id).toBe(PROPIA);
  });
});
