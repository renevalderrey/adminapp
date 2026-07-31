// ════════════════════════════════════════════
//  costService · costeo de recetas
//
//  Es el nucleo del modulo de produccion: de aca sale el costo de todo
//  producto elaborado, y de ese costo salen el precio de venta y el margen.
//  Un error aca se propaga a toda la rentabilidad del negocio.
// ════════════════════════════════════════════

const { crearModelo } = require('./helpers/modelosFalsos');

// Los modelos se mockean antes de requerir el service, porque costService los
// captura en el require de nivel de modulo.
const mockProductos = crearModelo([]);
const mockRecetas = crearModelo([]);
const mockItemsReceta = crearModelo([]);
const mockHistorialCostos = crearModelo([]);

jest.mock('../models', () => ({
  Product: mockProductos,
  Recipe: mockRecetas,
  RecipeItem: mockItemsReceta,
  ProductCostHistory: mockHistorialCostos,
}));

const costService = require('../services/costService');

// Recipe.findOne(...) tiene que devolver .items, y cada item su .ingredient.
// El wrapper se instala UNA sola vez: hacerlo dentro de armarCatalogo lo
// reenvolvia en cada test y terminaba llamandose a si mismo.
const hidratarRecetaOriginal = mockRecetas._hidratar;
mockRecetas._hidratar = (fila, opciones = {}) => {
  const instancia = hidratarRecetaOriginal(fila, opciones);
  if (!instancia) return null;

  const pideItems = (opciones.include || []).some((i) => i.as === 'items');
  if (pideItems) {
    instancia.items = (fila.items || []).map((it) => ({
      ...it,
      ingredient: mockProductos.filas.find((p) => p.id === it.ingredient_product_id) || null,
    }));
  }
  return instancia;
};

/** Arma el grafo de recetas que van a ver los modelos falsos. */
function armarCatalogo({ productos: prods = [], recetas: recs = [] }) {
  mockProductos.filas = prods.map((p) => ({ ...p }));
  mockRecetas.filas = recs.map((r, i) => ({ id: i + 1, ...r }));

  // RecipeItem.findAll({ where: { ingredient_product_id } }) para la cascada.
  mockItemsReceta.filas = recs.flatMap((r) =>
    (r.items || []).map((it) => ({
      ...it,
      recipe: { product_id: r.product_id },
    }))
  );
}

beforeEach(() => {
  mockProductos.llamadas = [];
  mockRecetas.llamadas = [];
  mockItemsReceta.llamadas = [];
  mockHistorialCostos.filas = [];
});

describe('calculateProductCost', () => {
  it('sin receta devuelve el costo manual del producto', async () => {
    armarCatalogo({ productos: [{ id: 1, cost: '150.50' }], recetas: [] });

    await expect(costService.calculateProductCost(1)).resolves.toBe(150.5);
  });

  it('suma cantidad por costo de cada ingrediente', async () => {
    // Pan: 2 kg de harina a $100 + 1 kg de sal a $50 = $250.
    // Rendimiento 1, sin merma -> costo unitario $250.
    armarCatalogo({
      productos: [
        { id: 1, cost: '0' },
        { id: 10, cost: '100' },
        { id: 11, cost: '50' },
      ],
      recetas: [{
        product_id: 1,
        yield: '1',
        loss_percentage: '0',
        items: [
          { ingredient_product_id: 10, quantity: '2' },
          { ingredient_product_id: 11, quantity: '1' },
        ],
      }],
    });

    await expect(costService.calculateProductCost(1)).resolves.toBe(250);
  });

  it('divide por el rendimiento', async () => {
    // $250 de insumos que rinden 10 unidades -> $25 por unidad.
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: '100' }],
      recetas: [{
        product_id: 1,
        yield: '10',
        loss_percentage: '0',
        items: [{ ingredient_product_id: 10, quantity: '2.5' }],
      }],
    });

    await expect(costService.calculateProductCost(1)).resolves.toBe(25);
  });

  it('la merma encarece el costo unitario', async () => {
    // $100 de insumos, rinde 1, se pierde 20% -> 100 / (1 * 0.8) = 125.
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: '100' }],
      recetas: [{
        product_id: 1,
        yield: '1',
        loss_percentage: '20',
        items: [{ ingredient_product_id: 10, quantity: '1' }],
      }],
    });

    await expect(costService.calculateProductCost(1)).resolves.toBe(125);
  });

  it('un ingrediente sin costo cargado aporta cero, no rompe', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: null }, { id: 11, cost: '50' }],
      recetas: [{
        product_id: 1,
        yield: '1',
        loss_percentage: '0',
        items: [
          { ingredient_product_id: 10, quantity: '2' },
          { ingredient_product_id: 11, quantity: '1' },
        ],
      }],
    });

    // El resultado es $50 y no $250: el ingrediente sin costo se cuenta como 0.
    // Es el comportamiento actual y no rompe, pero el costo queda subestimado
    // sin ningun aviso al usuario. Ver la nota en docs/ANALISIS.md.
    await expect(costService.calculateProductCost(1)).resolves.toBe(50);
  });

  // Una merma del 100% deja el denominador en cero: no queda producto
  // terminado. Antes devolvia 0 en silencio y ese 0 se persistia como costo
  // del producto, con lo cual pasaba a venderse regalado.
  it('rechaza una merma del 100% en vez de devolver costo cero', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: '100' }],
      recetas: [{
        product_id: 1,
        yield: '1',
        loss_percentage: '100',
        items: [{ ingredient_product_id: 10, quantity: '1' }],
      }],
    });

    await expect(costService.calculateProductCost(1)).rejects.toThrow(/Receta invalida|Receta inválida/);
  });

  it('rechaza una merma mayor al 100%', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: '100' }],
      recetas: [{
        product_id: 1,
        yield: '1',
        loss_percentage: '150',
        items: [{ ingredient_product_id: 10, quantity: '1' }],
      }],
    });

    await expect(costService.calculateProductCost(1)).rejects.toMatchObject({ status: 400 });
  });

  it('una merma del 99% encarece muchisimo pero sigue siendo valida', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: '100' }],
      recetas: [{
        product_id: 1,
        yield: '1',
        loss_percentage: '99',
        items: [{ ingredient_product_id: 10, quantity: '1' }],
      }],
    });

    await expect(costService.calculateProductCost(1)).resolves.toBe(10000);
  });
});

describe('checkCircularDependency', () => {
  it('detecta el ciclo directo: un producto no puede ser ingrediente de si mismo', async () => {
    armarCatalogo({ productos: [{ id: 1, cost: '0' }], recetas: [] });

    await expect(costService.checkCircularDependency(1, [1])).resolves.toBe(true);
  });

  it('acepta un ingrediente simple, sin receta propia', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 10, cost: '100' }],
      recetas: [],
    });

    await expect(costService.checkCircularDependency(1, [10])).resolves.toBe(false);
  });

  // Este es el caso que estaba roto. Una receta anidada legitima —pan que usa
  // masa madre, y la masa madre a su vez tiene su propia receta de harina—
  // se reportaba como dependencia circular, con lo cual el modulo de recetas
  // rechazaba justamente el caso de uso para el que existe.
  it('acepta una receta anidada de dos niveles', async () => {
    armarCatalogo({
      productos: [
        { id: 1, cost: '0' },    // pan
        { id: 20, cost: '80' },  // masa madre
        { id: 30, cost: '100' }, // harina
      ],
      recetas: [{
        product_id: 20,
        yield: '1',
        loss_percentage: '0',
        items: [{ ingredient_product_id: 30, quantity: '1' }],
      }],
    });

    await expect(costService.checkCircularDependency(1, [20])).resolves.toBe(false);
  });

  it('acepta una receta anidada de tres niveles', async () => {
    armarCatalogo({
      productos: [
        { id: 1, cost: '0' },
        { id: 20, cost: '0' },
        { id: 30, cost: '0' },
        { id: 40, cost: '100' },
      ],
      recetas: [
        { product_id: 20, yield: '1', loss_percentage: '0', items: [{ ingredient_product_id: 30, quantity: '1' }] },
        { product_id: 30, yield: '1', loss_percentage: '0', items: [{ ingredient_product_id: 40, quantity: '1' }] },
      ],
    });

    await expect(costService.checkCircularDependency(1, [20])).resolves.toBe(false);
  });

  it('detecta el ciclo indirecto: P usa I, e I ya usa P', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 20, cost: '0' }],
      recetas: [{
        product_id: 20,
        yield: '1',
        loss_percentage: '0',
        items: [{ ingredient_product_id: 1, quantity: '1' }],
      }],
    });

    await expect(costService.checkCircularDependency(1, [20])).resolves.toBe(true);
  });

  it('acepta el rombo: dos ingredientes que comparten un sub-ingrediente', async () => {
    // P usa A y B; A y B usan ambos C. No hay ciclo.
    armarCatalogo({
      productos: [
        { id: 1, cost: '0' }, { id: 20, cost: '0' },
        { id: 21, cost: '0' }, { id: 30, cost: '100' },
      ],
      recetas: [
        { product_id: 20, yield: '1', loss_percentage: '0', items: [{ ingredient_product_id: 30, quantity: '1' }] },
        { product_id: 21, yield: '1', loss_percentage: '0', items: [{ ingredient_product_id: 30, quantity: '1' }] },
      ],
    });

    await expect(costService.checkCircularDependency(1, [20, 21])).resolves.toBe(false);
  });

  // Si los datos YA tienen un ciclo entre ingredientes (por ejemplo, cargado
  // antes de que existiera esta validacion), recorrerlos no debe colgar el
  // proceso ni desbordar la pila.
  it('termina aunque los datos ya contengan un ciclo entre ingredientes', async () => {
    armarCatalogo({
      productos: [{ id: 1, cost: '0' }, { id: 20, cost: '0' }, { id: 21, cost: '0' }],
      recetas: [
        { product_id: 20, yield: '1', loss_percentage: '0', items: [{ ingredient_product_id: 21, quantity: '1' }] },
        { product_id: 21, yield: '1', loss_percentage: '0', items: [{ ingredient_product_id: 20, quantity: '1' }] },
      ],
    });

    await expect(costService.checkCircularDependency(1, [20])).resolves.toBe(false);
  });
});
