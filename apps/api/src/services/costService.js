const { Product, Recipe, RecipeItem, ProductCostHistory } = require('../models');

/**
 * Servicio para gestionar cálculos de costos e integridad de recetas
 */
class CostService {
  /**
   * Calcula el costo unitario de un producto en base a su receta activa
   * Fórmula: Sum(Cantidad * Costo Ingrediente) / (Rendimiento * (1 - Merma / 100))
   */
  /**
   * @param {number} productId
   * @param {import('sequelize').Transaction|null} [transaction] Obligatoria si
   *   se llama desde dentro de una transacción: sin ella las consultas van por
   *   otra conexión y, por MVCC, no ven los UPDATE todavía sin commitear.
   */
  async calculateProductCost(productId, transaction = null) {
    // Buscar la receta del producto con sus ingredientes
    const recipe = await Recipe.findOne({
      where: { product_id: productId },
      include: [
        {
          model: RecipeItem,
          as: 'items',
          include: [{ model: Product, as: 'ingredient', attributes: ['id', 'cost'] }]
        }
      ],
      transaction,
    });

    // Si no tiene receta, retorna su costo manual actual
    if (!recipe) {
      const product = await Product.findByPk(productId, { attributes: ['cost'], transaction });
      return product ? parseFloat(product.cost) : 0;
    }

    let ingredientsTotalCost = 0;
    const lossPercentage = parseFloat(recipe.loss_percentage) || 0;
    const recipeYield = parseFloat(recipe.yield) || 1.0000;

    if (recipe.items && recipe.items.length > 0) {
      for (const item of recipe.items) {
        const qty = parseFloat(item.quantity) || 0;
        const ingredientCost = parseFloat(item.ingredient ? item.ingredient.cost : 0) || 0;
        ingredientsTotalCost += qty * ingredientCost;
      }
    }

    // Aplicar fórmula
    const denominator = recipeYield * (1 - (lossPercentage / 100));

    // Una merma del 100% o más deja el denominador en cero o negativo: no hay
    // producto terminado, así que no hay costo unitario que calcular.
    //
    // Antes se devolvía 0 en silencio, y ese 0 se persistía como costo del
    // producto en recalculateCascadingCosts. El producto pasaba a costar nada,
    // el margen se calculaba sobre cero y terminaba vendiéndose regalado.
    // Es preferible fallar: la receta está mal cargada.
    if (denominator <= 0) {
      const err = new Error(
        `Receta inválida para el producto ${productId}: con rendimiento ${recipeYield} y merma ${lossPercentage}% no queda producto terminado.`
      );
      err.status = 400;
      throw err;
    }

    const finalCost = ingredientsTotalCost / denominator;
    return parseFloat(finalCost.toFixed(2));
  }

  /**
   * Recalcula el costo de un producto y propaga los cambios en cascada
   * a todos los productos terminados que lo utilicen como ingrediente.
   */
  async recalculateCascadingCosts(productId, visited = new Set(), transaction = null) {
    if (visited.has(productId)) {
      throw new Error(`Dependencia circular detectada para el producto ID ${productId}`);
    }
    visited.add(productId);

    // Obtener el producto
    const product = await Product.findByPk(productId, { transaction });
    if (!product) return;

    // Calcular el nuevo costo (si tiene receta, o el manual si no)
    const oldCost = parseFloat(product.cost) || 0;
    const recipe = await Recipe.findOne({ where: { product_id: productId }, transaction });
    
    // La transacción tiene que viajar hasta acá. Sin ella, calculateProductCost
    // abría sus propias consultas por otra conexión y, por MVCC, leía los
    // costos ANTERIORES al UPDATE que se acababa de hacer dentro de esta misma
    // transacción. El costo recalculado salía igual al viejo, no superaba el
    // umbral de 0.01 de más abajo y no se actualizaba nada: la propagación en
    // cascada —el propósito entero de esta función— era un no-op.
    let newCost = oldCost;
    if (recipe) {
      newCost = await this.calculateProductCost(productId, transaction);
    }

    // Si hay variación, actualizar y registrar historial
    if (Math.abs(oldCost - newCost) >= 0.01) {
      await product.update({ cost: newCost }, { transaction });

      // Registrar historial de costos
      await ProductCostHistory.create({
        product_id: productId,
        old_cost: oldCost,
        new_cost: newCost,
        reason: recipe 
          ? 'Recálculo automático por variación en ingredientes de receta' 
          : 'Edición manual de costo base'
      }, { transaction });
    }

    // Buscar productos que usan este producto como ingrediente
    const dependentItems = await RecipeItem.findAll({
      where: { ingredient_product_id: productId },
      include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
      transaction
    });

    // Recursión en cascada sobre los productos dependientes
    for (const item of dependentItems) {
      if (item.recipe && item.recipe.product_id) {
        // Clonar el set visitado para cada rama independiente de propagación
        const branchVisited = new Set(visited);
        await this.recalculateCascadingCosts(item.recipe.product_id, branchVisited, transaction);
      }
    }
  }

  /**
   * Detecta si añadir un conjunto de ingredientes a un producto generará una
   * dependencia circular.
   *
   * Recorre hacia abajo el árbol de recetas de cada ingrediente buscando si
   * `productId` aparece en algún nivel. Si aparece, agregar ese ingrediente
   * cerraría un ciclo.
   *
   * El Set `visited` registra los INGREDIENTES ya explorados, no el producto
   * destino. Cumple dos funciones:
   *
   *  - Memoización: si ya se recorrió el subárbol de un ingrediente y no se
   *    encontró `productId`, volver a recorrerlo da lo mismo. La respuesta no
   *    depende del camino por el que se llegó.
   *  - Terminación: si los datos ya contienen un ciclo entre ingredientes
   *    (cargado antes de que existiera esta validación), evita la recursión
   *    infinita.
   *
   * Por eso se comparte entre ramas hermanas en lugar de clonarse.
   *
   * NOTA: la versión anterior hacía `visited.add(productId)` al entrar y
   * `visited.has(productId)` como primera comprobación. Como el productId es
   * el mismo en toda la recursión, la primera llamada recursiva lo encontraba
   * siempre en el Set y devolvía true. El efecto era que CUALQUIER ingrediente
   * que tuviera receta propia se reportaba como dependencia circular, y el
   * módulo rechazaba las recetas anidadas — justamente el caso de uso para el
   * que existe (una preparación intermedia usada dentro de otra).
   */
  async checkCircularDependency(productId, ingredientIds, visited = new Set()) {
    for (const ingredientId of ingredientIds) {
      // El ingrediente es el producto mismo: ciclo directo.
      if (ingredientId === productId) return true;

      // Ya se exploró este subárbol y no llevaba a productId.
      if (visited.has(ingredientId)) continue;
      visited.add(ingredientId);

      const recipe = await Recipe.findOne({
        where: { product_id: ingredientId },
        include: [{ model: RecipeItem, as: 'items', attributes: ['ingredient_product_id'] }],
      });

      if (recipe && recipe.items && recipe.items.length > 0) {
        const subIngredientIds = recipe.items.map((item) => item.ingredient_product_id);
        const hasLoop = await this.checkCircularDependency(productId, subIngredientIds, visited);
        if (hasLoop) return true;
      }
    }

    return false;
  }
}

module.exports = new CostService();
