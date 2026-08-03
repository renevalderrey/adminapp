const { Op } = require('sequelize');
const { assertEmpresaId } = require('../utils/tenantScope');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');
const {
  ProductionOrder,
  ProductionOrderItem,
  Product,
  Recipe,
  RecipeItem,
  Stock,
  ProductCostHistory,
  sequelize,
} = require('../models');

class ProductionService {
  async calculateOrderCosts(productId, quantityProduced) {
    const recipe = await Recipe.findOne({
      where: { product_id: productId },
      include: [
        {
          model: RecipeItem,
          as: 'items',
          include: [{ model: Product, as: 'ingredient', attributes: ['id', 'name', 'cost'] }],
        },
      ],
    });

    if (!recipe) {
      throw new Error('El producto no tiene una receta activa configurada');
    }

    const lossPct = parseFloat(recipe.loss_percentage) || 0;
    const recipeYield = parseFloat(recipe.yield) || 1;
    const items = recipe.items || [];
    const costSnapshot = {
      recipe_yield: recipeYield,
      loss_percentage: lossPct,
      ingredients: [],
    };
    let totalIngredientsCost = 0;

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0;
      const unitCost = parseFloat(item.ingredient ? item.ingredient.cost : 0) || 0;
      const subtotal = qty * unitCost;
      totalIngredientsCost += subtotal;

      costSnapshot.ingredients.push({
        product_id: item.ingredient_product_id,
        name: item.ingredient ? item.ingredient.name : 'Desconocido',
        quantity: qty,
        unit_cost: unitCost,
        subtotal,
      });
    }

    const denominator = recipeYield * (1 - lossPct / 100);
    if (denominator <= 0) {
      throw new Error('La receta tiene un rendimiento o merma inválidos');
    }

    const totalCost = (totalIngredientsCost * quantityProduced) / denominator;
    const unitCost = totalCost / quantityProduced;

    return {
      totalCost: parseFloat(totalCost.toFixed(2)),
      unitCost: parseFloat(unitCost.toFixed(4)),
      recipe,
      items,
      costSnapshot,
    };
  }

  async validateStockForProduction(recipeItems, quantityProduced, location = 'general', puntoDeVentaId = null, empresaId) {
    assertEmpresaId(empresaId);

    const warnings = [];

    // La sucursal la decide `utils/sucursalDeStock` y no un ternario propio
    // (FR-049, decisión 8). El ternario `puntoDeVentaId ? … : { location }`
    // hacía que producir sin cabecera mirara una fila ubicada por texto —que
    // después de la migración 14 no existe— y **la validación de stock pasara
    // siempre**: se producía sin insumos y el faltante aparecía después.
    const sucursal = await resolverSucursal({ empresaId, puntoDeVentaId });

    for (const item of recipeItems) {
      const qty = parseFloat(item.quantity) || 0;
      const requiredQty = qty * quantityProduced;

      // Con empresa_id explicito y no confiando en que product_id ya la
      // implica: esa invariante es cierta hoy y nadie la escribio en ningun
      // lado, que es como dejan de ser ciertas.
      const stockRecord = await Stock.findOne({
        where: {
          empresa_id: empresaId,
          product_id: item.ingredient_product_id,
          punto_de_venta_id: sucursal.id,
        },
      });

      const available = stockRecord ? parseFloat(stockRecord.quantity) || 0 : 0;

      if (available < requiredQty) {
        const ingredientName = item.ingredient ? item.ingredient.name : `ID ${item.ingredient_product_id}`;
        warnings.push(
          `Stock insuficiente de '${ingredientName}': disponible ${available}, requerido ${requiredQty}`
        );
      }
    }

    return warnings;
  }

  async createProductionOrder(data, empresaId, puntoDeVentaId = null) {
    assertEmpresaId(empresaId);

    const { product_id, quantity_produced, batch_code, production_date, location, notes } = data;

    if (!quantity_produced || parseFloat(quantity_produced) <= 0) {
      throw new Error('quantity_produced debe ser mayor a 0');
    }

    // product_id viene del body sin validar. Sin este chequeo se podia lanzar
    // una orden sobre el producto de otra empresa cliente: calculateOrderCosts
    // lee su receta y guarda los costos de sus insumos en cost_snapshot, con lo
    // cual quedaban expuestos en la respuesta.
    const producto = await Product.findOne({
      where: { id: product_id, empresa_id: empresaId },
      attributes: ['id'],
    });

    if (!producto) {
      throw new Error('Producto no encontrado');
    }

    const { totalCost, unitCost, recipe, items, costSnapshot } =
      await this.calculateOrderCosts(product_id, quantity_produced);

    const targetLocation = location || 'general';

    const warnings = await this.validateStockForProduction(items, quantity_produced, targetLocation, puntoDeVentaId, empresaId);

    // La misma resolución que usa la validación de arriba: si las dos no
    // coincidieran, se validaría el stock de una sucursal y se descontaría el
    // de otra, que es peor que no validar.
    //
    // `ProductionOrder.location` sigue guardando `targetLocation` tal cual (esa
    // tabla no se migra, está Fuera de alcance); lo que cambia es dónde se
    // busca y se escribe el **stock**.
    const ubicacion = ubicacionDeStock(await resolverSucursal({ empresaId, puntoDeVentaId }));

    const t = await sequelize.transaction();

    try {
      const order = await ProductionOrder.create({
        product_id,
        quantity_produced,
        batch_code,
        production_date,
        unit_cost_calculated: unitCost,
        total_cost: totalCost,
        status: 'completed',
        notes: notes || null,
        location: targetLocation,
        cost_snapshot: costSnapshot,
        empresa_id: empresaId,
        punto_de_venta_id: puntoDeVentaId,
      }, { transaction: t });

      const orderItems = [];

      for (const item of items) {
        const qty = parseFloat(item.quantity) || 0;
        const requiredQty = qty * quantity_produced;
        const unitCostAtTime = parseFloat(item.ingredient ? item.ingredient.cost : 0) || 0;

        const orderItem = await ProductionOrderItem.create({
          production_order_id: order.id,
          ingredient_product_id: item.ingredient_product_id,
          quantity_used: requiredQty,
          unit_cost_at_time: unitCostAtTime,
        }, { transaction: t });

        orderItems.push(orderItem);

        // empresa_id va en el where Y en los defaults. Sin el, una fila de
        // stock creada aca cae en la empresa 1 por el valor por defecto de la
        // columna: la produccion de un cliente le crea inventario a otro, y a
        // quien produjo el stock le queda invisible.
        const [stockRecord] = await Stock.findOrCreate({
          where: {
            empresa_id: empresaId,
            product_id: item.ingredient_product_id,
            punto_de_venta_id: ubicacion.punto_de_venta_id,
          },
          defaults: {
            empresa_id: empresaId,
            quantity: 0,
            available: 0,
            ...ubicacion,
          },
          transaction: t,
        });

        const currentQty = parseFloat(stockRecord.quantity) || 0;
        const newQty = Math.max(0, currentQty - requiredQty);
        await stockRecord.update({ quantity: newQty, available: newQty }, { transaction: t });
      }

      const [finishedStock] = await Stock.findOrCreate({
        where: {
          empresa_id: empresaId,
          product_id,
          punto_de_venta_id: ubicacion.punto_de_venta_id,
        },
        defaults: {
          empresa_id: empresaId,
          quantity: 0,
          available: 0,
          ...ubicacion,
          current_batch: batch_code,
          purchase_date: production_date,
        },
        transaction: t,
      });

      const currentFinishedQty = parseFloat(finishedStock.quantity) || 0;
      await finishedStock.update({
        quantity: currentFinishedQty + parseFloat(quantity_produced),
        available: currentFinishedQty + parseFloat(quantity_produced),
        current_batch: batch_code,
        purchase_date: production_date,
      }, { transaction: t });

      const product = await Product.findByPk(product_id, { transaction: t });
      const currentCost = parseFloat(product.cost) || 0;
      if (Math.abs(currentCost - unitCost) >= 0.01) {
        await product.update({ cost: unitCost }, { transaction: t });

        await ProductCostHistory.create({
          product_id,
          old_cost: currentCost,
          new_cost: unitCost,
          reason: 'Actualización por orden de producción',
        }, { transaction: t });

        let visited = new Set([product_id]);
        const costService = require('./costService');
        const dependentItems = await RecipeItem.findAll({
          where: { ingredient_product_id: product_id },
          include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
          transaction: t,
        });
        for (const dep of dependentItems) {
          if (dep.recipe && dep.recipe.product_id) {
            await costService.recalculateCascadingCosts(dep.recipe.product_id, visited, t);
            visited.add(dep.recipe.product_id);
          }
        }
      }

      await t.commit();

      const createdOrder = await ProductionOrder.findByPk(order.id, {
        include: [
          { model: Product, as: 'product', attributes: ['id', 'name'] },
          { model: ProductionOrderItem, as: 'items' },
        ],
      });

      return { order: createdOrder, warnings };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  async voidProductionOrder(id, empresaId) {
    assertEmpresaId(empresaId);

    // Sin el filtro por empresa esto anulaba la orden de otra empresa cliente
    // y le revertia el stock de los insumos.
    const order = await ProductionOrder.findOne({
      where: { id, empresa_id: empresaId },
      include: [{ model: ProductionOrderItem, as: 'items' }],
    });

    if (!order) {
      throw new Error('Orden de producción no encontrada');
    }

    if (order.status === 'voided') {
      throw new Error('La orden ya se encuentra anulada');
    }

    const items = order.items || [];
    const t = await sequelize.transaction();

    try {
      // A dónde vuelven los insumos y de dónde sale el producto terminado.
      //
      // `order.punto_de_venta_id` está en `null` en todas las órdenes anteriores
      // a esta funcionalidad —igual que en `sales`—, y la tabla no se migra.
      // Con el ternario de antes, anular una orden vieja creaba una fila nueva
      // ubicada por texto: los insumos «volvían» a un lugar que no existe y el
      // producto terminado se descontaba de otro. La resolución compartida los
      // manda a los dos al mismo lado.
      const ubicacion = ubicacionDeStock(await resolverSucursal({
        empresaId,
        puntoDeVentaId: order.punto_de_venta_id,
        transaction: t,
      }));

      for (const item of items) {
        const qtyUsed = parseFloat(item.quantity_used) || 0;

        const [stockRecord] = await Stock.findOrCreate({
          where: {
            empresa_id: empresaId,
            product_id: item.ingredient_product_id,
            punto_de_venta_id: ubicacion.punto_de_venta_id,
          },
          defaults: {
            empresa_id: empresaId,
            quantity: 0,
            available: 0,
            ...ubicacion,
          },
          transaction: t,
        });

        const currentQty = parseFloat(stockRecord.quantity) || 0;
        await stockRecord.update({
          quantity: currentQty + qtyUsed,
          available: currentQty + qtyUsed,
        }, { transaction: t });
      }

      const [finishedStock] = await Stock.findOrCreate({
        where: {
          empresa_id: empresaId,
          product_id: order.product_id,
          punto_de_venta_id: ubicacion.punto_de_venta_id,
        },
        defaults: {
          empresa_id: empresaId,
          quantity: 0,
          available: 0,
          ...ubicacion,
        },
        transaction: t,
      });

      const currentFinishedQty = parseFloat(finishedStock.quantity) || 0;
      const producedQty = parseFloat(order.quantity_produced) || 0;
      const newFinishedQty = Math.max(0, currentFinishedQty - producedQty);

      await finishedStock.update({
        quantity: newFinishedQty,
        available: newFinishedQty,
      }, { transaction: t });

      await order.update({
        status: 'voided',
        voided_at: new Date(),
      }, { transaction: t });

      await t.commit();

      return await ProductionOrder.findByPk(order.id, {
        include: [
          { model: Product, as: 'product', attributes: ['id', 'name'] },
          { model: ProductionOrderItem, as: 'items' },
        ],
      });
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  async listProductionOrders(filters = {}, empresaId) {
    const where = { empresa_id: empresaId };
    const { product_id, status, batch_code, date_from, date_to, limit, offset } = filters;

    if (product_id) where.product_id = product_id;
    if (status) where.status = status;
    if (batch_code) where.batch_code = { [Op.iLike]: `%${batch_code}%` };
    if (date_from || date_to) {
      where.production_date = {};
      if (date_from) where.production_date[Op.gte] = date_from;
      if (date_to) where.production_date[Op.lte] = date_to;
    }

    const pageLimit = parseInt(limit) || 50;
    const pageOffset = parseInt(offset) || 0;

    const { count, rows } = await ProductionOrder.findAndCountAll({
      where,
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
      ],
      order: [['production_date', 'DESC'], ['created_at', 'DESC']],
      limit: pageLimit,
      offset: pageOffset,
    });

    return {
      data: rows.map(r => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.product ? r.product.name : null,
        quantity_produced: r.quantity_produced,
        batch_code: r.batch_code,
        production_date: r.production_date,
        unit_cost_calculated: r.unit_cost_calculated,
        total_cost: r.total_cost,
        status: r.status,
        notes: r.notes,
        voided_at: r.voided_at,
        location: r.location,
        punto_de_venta_id: r.punto_de_venta_id,
        created_at: r.created_at,
      })),
      total: count,
    };
  }

  async getProductionOrder(id, empresaId) {
    assertEmpresaId(empresaId);

    const order = await ProductionOrder.findOne({
      where: { id, empresa_id: empresaId },
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        {
          model: ProductionOrderItem,
          as: 'items',
          include: [{ model: Product, as: 'ingredient', attributes: ['id', 'name'] }],
        },
      ],
    });

    if (!order) return null;

    return {
      id: order.id,
      product_id: order.product_id,
      product_name: order.product ? order.product.name : null,
      quantity_produced: order.quantity_produced,
      batch_code: order.batch_code,
      production_date: order.production_date,
      unit_cost_calculated: order.unit_cost_calculated,
      total_cost: order.total_cost,
      status: order.status,
      notes: order.notes,
      voided_at: order.voided_at,
      location: order.location,
      punto_de_venta_id: order.punto_de_venta_id,
      cost_snapshot: order.cost_snapshot,
      created_at: order.created_at,
      items: (order.items || []).map(i => ({
        id: i.id,
        ingredient_product_id: i.ingredient_product_id,
        ingredient_name: i.ingredient ? i.ingredient.name : null,
        quantity_used: i.quantity_used,
        unit_cost_at_time: i.unit_cost_at_time,
      })),
    };
  }
}

module.exports = new ProductionService();
