// ════════════════════════════════════════════
//  La causa raíz de los dos defectos de diamante
//
//  `costService.recalculateCascadingCosts` hacía dos cosas frágiles:
//
//   1. **confiaba en que el llamador clonara el Set `visited`**. Clonaba solo
//      hacia adentro, en su propia recursión, y de paso MUTABA el Set que
//      recibía. Cinco caminos la llaman y dos se olvidaron de clonar
//      —`purchaseService.recostearDependientes` y `productionService`—: los dos
//      se cayeron con un 500 sobre grafos que no tienen ningún ciclo, y cada uno
//      se corrigió por su lado, del lado del llamador;
//   2. respondía con un `Error` **pelado**, sin `status` y sin el nombre del
//      producto, así que subía como 500 genérico —«Error al crear la orden de
//      producción»— y quien lo leía no sabía qué receta abrir.
//
//  Estos casos son sobre la función, no sobre un endpoint: es donde vive el
//  defecto, y es el único nivel en el que se puede afirmar que el PRÓXIMO
//  llamador tampoco se va a caer.
//
//  ⚠ El grafo tiene que ser un diamante de verdad —dos caminos al mismo
//  elaborado, ninguno que vuelva para atrás— y los ciclos reales tienen que
//  seguir fallando. Una corrección que deja pasar el ciclo es peor que el
//  defecto: la recursión no termina nunca.
// ════════════════════════════════════════════

const { crearModelo } = require('./helpers/modelosFalsos');

const EMPRESA = 7;

const COLAGENO = 41;
const PREMEZCLA = 60;
const BARRA = 70;
const COMBO = 80;

const mockProduct = crearModelo([]);

const mockRecipe = crearModelo([], {
  // `calculateProductCost` pide la receta con sus ítems y, dentro de cada ítem,
  // el costo del insumo. `crearModelo` resuelve un nivel por alias, así que el
  // anidado se arma acá.
  //
  // ⚠ `ingredient` apunta a la fila VIVA de `mockProduct` y no a una copia. Con
  // una copia, la cascada leería siempre el costo anterior al UPDATE —el mismo
  // defecto de MVCC que documenta costService— y el diamante daría el mismo
  // número con y sin la corrección.
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

const mockProductCostHistory = crearModelo([]);

jest.mock('../models', () => ({
  Product: mockProduct,
  Recipe: mockRecipe,
  RecipeItem: mockRecipeItem,
  ProductCostHistory: mockProductCostHistory,
}));

const costService = require('../services/costService');

const costoDe = (id) => mockProduct.filas.find((p) => p.id === id).cost;

/** El diamante: Premezcla → Barra → Combo, y Premezcla → Combo. Sin ciclos. */
const RECETAS_EN_DIAMANTE = [
  { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
  // ⚠ El orden no es casual: la fila del COMBO va ANTES que la de la BARRA.
  //
  // Con la de la Barra primero, el defecto no aparece: la rama larga corre antes
  // de que nadie haya marcado el Combo. Contra Postgres el orden lo elegía el
  // planificador, y por eso el mismo request respondía 201 o 500 según el día.
  // Acá se fija a mano para que el caso sea determinístico.
  { id: 11, recipe_id: 3, ingredient_product_id: PREMEZCLA, quantity: 1 },
  { id: 10, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
  { id: 12, recipe_id: 3, ingredient_product_id: BARRA, quantity: 1 },
];

beforeEach(() => {
  // Los costos de partida son DISTINTOS de los que va a dar el recosteo, en los
  // tres elaborados. Con un costo viejo que ya coincide con el nuevo,
  // `esCambioSignificativo` corta antes de propagar y el caso pasaría con y sin
  // la corrección.
  mockProduct.filas = [
    { id: COLAGENO, empresa_id: EMPRESA, name: 'Colágeno 300g', cost: 900 },
    { id: PREMEZCLA, empresa_id: EMPRESA, name: 'Premezcla base', cost: 1500 },
    { id: BARRA, empresa_id: EMPRESA, name: 'Barra proteica', cost: 1200 },
    { id: COMBO, empresa_id: EMPRESA, name: 'Combo proteico', cost: 2000 },
  ];

  // Rendimiento 1 y merma 0: lo que se afirma es el recorrido del grafo, no la
  // fórmula, que tiene sus propios casos en `costService.test.js`.
  mockRecipe.filas = [
    { id: 1, product_id: PREMEZCLA, yield: 1, loss_percentage: 0 },
    { id: 2, product_id: BARRA, yield: 1, loss_percentage: 0 },
    { id: 3, product_id: COMBO, yield: 1, loss_percentage: 0 },
  ];

  mockRecipeItem.filas = RECETAS_EN_DIAMANTE.map((i) => ({ ...i }));
  mockProductCostHistory.filas = [];

  for (const doble of [mockProduct, mockRecipe, mockRecipeItem]) {
    doble.llamadas = [];
  }
});

describe('Un diamante no es un ciclo', () => {
  it('recostear el insumo raíz de un diamante NO lanza «dependencia circular»', async () => {
    await expect(
      costService.recalculateCascadingCosts(PREMEZCLA, new Set())
    ).resolves.toBeUndefined();
  });

  it('el Combo queda costeado por el camino LARGO, con la Barra ya recosteada', async () => {
    await costService.recalculateCascadingCosts(PREMEZCLA, new Set());

    // 2 × 900.
    expect(costoDe(PREMEZCLA)).toBe(1800);
    // 1 × Premezcla.
    expect(costoDe(BARRA)).toBe(1800);
    // 1 × Premezcla + 1 × Barra = 1800 + 1800. El 3600 es lo que prueba que la
    // rama que pasa POR la Barra se recorrió entera: si se cortara ahí, el Combo
    // quedaría en 1800 + 1200 = 3000 —con el costo viejo de la Barra adentro— y
    // nada avisaría.
    expect(costoDe(COMBO)).toBe(3600);
  });
});

// ════════════════════════════════════════════
//  Lo que cierra la clase entera de defectos: el clon es de la función
//
//  Los dos defectos del hito son este caso. El llamador tenía un solo Set para
//  todas las ramas de su bucle, y como esta función lo MUTABA, la segunda rama
//  se encontraba el Combo ya marcado por la primera.
//
//  Se puede escribir sin tocar `purchaseService` ni `productionService`: lo que
//  reproduce el defecto es reusar el Set entre dos llamadas, que es exactamente
//  lo que hacían los dos.
// ════════════════════════════════════════════

describe('El Set que recibe es del llamador, y la función no lo toca', () => {
  it('dos ramas hermanas que comparten un MISMO Set no inventan un ciclo', async () => {
    // La forma exacta que tenían los dos llamadores que se cayeron: un Set para
    // todo el bucle, sembrado con el producto que cambió de costo.
    const compartido = new Set([PREMEZCLA]);

    // Rama 1: el camino corto al Combo. Es la que dejaba el Combo marcado.
    await costService.recalculateCascadingCosts(COMBO, compartido);

    // Rama 2: el camino largo, que vuelve a pasar por el Combo a través de la
    // Barra. Acá salía «Dependencia circular detectada» sobre un grafo sin un
    // solo ciclo.
    await expect(
      costService.recalculateCascadingCosts(BARRA, compartido)
    ).resolves.toBeUndefined();
  });

  it('el Set del llamador queda como estaba: la función no le agrega nada', async () => {
    const compartido = new Set([PREMEZCLA]);

    await costService.recalculateCascadingCosts(COMBO, compartido);

    // Sin esto, «no inventa un ciclo» se podría cumplir por casualidad —por
    // ejemplo si el grafo se recorriera en otro orden—. Que el Set salga con lo
    // mismo con que entró es la propiedad, y es la que hace que el próximo
    // llamador no tenga que acordarse de nada.
    expect([...compartido]).toEqual([PREMEZCLA]);
    expect(compartido.has(COMBO)).toBe(false);
  });

  it('el llamador que YA clonaba sigue funcionando igual: clonar dos veces es inofensivo', async () => {
    // `preciosService` (dos veces) y `routes/products.js` pasan un Set nuevo en
    // cada vuelta. Son tres caminos que hoy andan y que este cambio no puede
    // romper.
    await costService.recalculateCascadingCosts(BARRA, new Set([PREMEZCLA]));

    // 1 × el costo de la Premezcla, que en este caso NO se recosteó: se entra
    // por la Barra, igual que hacen los tres.
    expect(costoDe(BARRA)).toBe(1500);
    expect(costoDe(COMBO)).toBe(3000);
  });
});

// ════════════════════════════════════════════
//  Y el ciclo real sigue fallando
//
//  Es la mitad que no se puede perder. Una receta que se usa a sí misma como
//  insumo —directa o a través de otra— no tiene costo que calcular, y sin el
//  corte la recursión no termina nunca.
// ════════════════════════════════════════════

describe('Un ciclo real sigue siendo un ciclo', () => {
  it('una receta que se lista a sí misma como insumo falla', async () => {
    // La Premezcla lleva Premezcla. Se puede cargar: `checkCircularDependency`
    // es de este año y las recetas viejas no pasaron por ahí.
    mockRecipeItem.filas = [
      { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
      { id: 6, recipe_id: 1, ingredient_product_id: PREMEZCLA, quantity: 1 },
    ];

    await expect(
      costService.recalculateCascadingCosts(PREMEZCLA, new Set())
    ).rejects.toThrow(/dependencia circular/i);
  });

  it('un ciclo indirecto entre dos elaborados falla', async () => {
    // La Barra lleva Combo y el Combo lleva Barra.
    mockRecipeItem.filas = [
      { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
      { id: 30, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
      { id: 31, recipe_id: 2, ingredient_product_id: COMBO, quantity: 1 },
      { id: 32, recipe_id: 3, ingredient_product_id: BARRA, quantity: 1 },
    ];

    await expect(
      costService.recalculateCascadingCosts(PREMEZCLA, new Set())
    ).rejects.toThrow(/dependencia circular/i);
  });

  it('el ciclo NOMBRA el producto: es lo único que dice qué receta abrir', async () => {
    mockRecipeItem.filas = [
      { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
      { id: 30, recipe_id: 2, ingredient_product_id: PREMEZCLA, quantity: 1 },
      { id: 31, recipe_id: 2, ingredient_product_id: COMBO, quantity: 1 },
      { id: 32, recipe_id: 3, ingredient_product_id: BARRA, quantity: 1 },
    ];

    // El texto anterior era «Dependencia circular detectada para el producto ID
    // 70». Un id no se puede buscar en la pantalla de recetas.
    await expect(
      costService.recalculateCascadingCosts(PREMEZCLA, new Set())
    ).rejects.toThrow(/Barra proteica/);
  });

  it('es un ErrorDeNegocio y no un Error pelado: llega al usuario en vez de un 500', async () => {
    mockRecipeItem.filas = [
      { id: 5, recipe_id: 1, ingredient_product_id: COLAGENO, quantity: 2 },
      { id: 6, recipe_id: 1, ingredient_product_id: PREMEZCLA, quantity: 1 },
    ];

    // `fallo()` mira `publico` para decidir si devuelve el mensaje o lo tapa con
    // «Error interno del servidor». Con un `Error` pelado, el usuario leía
    // «Error al crear la orden de producción» y nada más.
    await expect(
      costService.recalculateCascadingCosts(PREMEZCLA, new Set())
    ).rejects.toMatchObject({
      name: 'ErrorDeNegocio',
      publico: true,
      status: 400,
    });
  });

  it('un ciclo que se cierra SOBRE el diamante sigue fallando', async () => {
    // El diamante entero, más una fila que cierra el círculo: el Combo vuelve a
    // ser insumo de la Premezcla. Es el caso que separa las dos cosas de una
    // corrección que se podía hacer mal en cualquiera de las dos direcciones —
    // hay que dejar pasar los dos caminos al Combo **y** seguir cortando cuando
    // el camino vuelve a un producto por el que ya pasó.
    //
    // Si el corte se perdiera, esto no fallaría: se quedaría girando hasta el
    // timeout de jest. Por eso el caso afirma que RECHAZA, no que resuelve.
    mockRecipeItem.filas = [
      ...RECETAS_EN_DIAMANTE.map((i) => ({ ...i })),
      { id: 40, recipe_id: 1, ingredient_product_id: COMBO, quantity: 1 },
    ];

    await expect(
      costService.recalculateCascadingCosts(PREMEZCLA, new Set())
    ).rejects.toMatchObject({
      name: 'ErrorDeNegocio',
      message: expect.stringContaining('Premezcla base'),
    });
  });
});
