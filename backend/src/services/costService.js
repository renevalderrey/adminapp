const { Product, Recipe, RecipeItem, ProductCostHistory } = require('../models');

/**
 * Servicio para gestionar cálculos de costos e integridad de recetas
 */
class CostService {
  /**
   * Calcula el costo unitario de un producto en base a su receta activa
   * Fórmula: Sum(Cantidad * Costo Ingrediente) / (Rendimiento * (1 - Merma / 100))
   */
  async calculateProductCost(productId) {
    // Buscar la receta del producto con sus ingredientes
    const recipe = await Recipe.findOne({
      where: { product_id: productId },
      include: [
        {
          model: RecipeItem,
          as: 'items',
          include: [{ model: Product, as: 'ingredient', attributes: ['id', 'cost'] }]
        }
      ]
    });

    // Si no tiene receta, retorna su costo manual actual
    if (!recipe) {
      const product = await Product.findByPk(productId, { attributes: ['cost'] });
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
    if (denominator <= 0) return 0;

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
    
    let newCost = oldCost;
    if (recipe) {
      newCost = await this.calculateProductCost(productId);
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
   * Detecta si añadir un conjunto de ingredientes a un producto generará una dependencia circular
   */
  async checkCircularDependency(productId, ingredientIds, visited = new Set()) {
    if (visited.has(productId)) {
      return true;
    }
    visited.add(productId);

    // Para cada ingrediente sugerido, revisar si depende directa o indirectamente del producto destino
    for (const ingredientId of ingredientIds) {
      if (ingredientId === productId) return true;

      // Buscar si el ingrediente tiene su propia receta
      const recipe = await Recipe.findOne({
        where: { product_id: ingredientId },
        include: [{ model: RecipeItem, as: 'items', attributes: ['ingredient_product_id'] }]
      });

      if (recipe && recipe.items && recipe.items.length > 0) {
        const subIngredientIds = recipe.items.map(item => item.ingredient_product_id);
        const branchVisited = new Set(visited);
        const hasLoop = await this.checkCircularDependency(productId, subIngredientIds, branchVisited);
        if (hasLoop) return true;
      }
    }

    return false;
  }
}

module.exports = new CostService();
