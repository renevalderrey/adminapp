const { Op } = require('sequelize');
const { assertEmpresaId, findScoped } = require('../utils/tenantScope');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');
const {
  ProductionOrder,
  ProductionOrderItem,
  Product,
  Recipe,
  RecipeItem,
  Stock,
  sequelize,
} = require('../models');
const {
  registrarCambioDeCosto,
  esCambioSignificativo,
  MOTIVOS,
} = require('../utils/historialDeCostos');
// El motivo real de un recosteo que se cae no puede quedarse solo en el aviso
// del usuario: «revisá esa receta» no dice cuál de las dos cosas pasó, y el
// aviso es lo único que quedaría si el error se traga en silencio.
const logger = require('../utils/logger');

/**
 * Propaga el costo nuevo del elaborado a las recetas que lo usan como insumo.
 *
 * Cerrar una orden de producción recalcula el costo del producto terminado. Ese
 * producto puede a su vez ser insumo de otras recetas —una preparación
 * intermedia dentro de un combo—, y si no se propaga, el combo sigue costeado
 * con el número viejo: el margen que muestra el POS y el precio recomendado del
 * Comparador se calculan sobre algo que dejó de ser cierto, y no falla nada.
 *
 * `costService` se requiere adentro para no cerrar el ciclo de imports en la
 * carga del módulo.
 *
 * ── Por qué el `visited` se clona por rama ──
 *
 * Hasta este corte había **un solo Set** para todas las ramas del bucle, y
 * encima se le agregaba cada elaborado ya recosteado. Con un grafo en diamante
 * —el Colágeno es insumo de la Premezcla, y el Combo lleva Colágeno **y**
 * Premezcla— la segunda rama se encontraba el Combo ya marcado por la primera y
 * `costService` respondía «Dependencia circular detectada» sobre un grafo **que
 * no tiene ningún ciclo**.
 *
 * El Set contesta «por dónde vine», que es una pregunta por camino. Compartirlo
 * entre ramas hermanas lo convierte en «quién pasó antes», que es otra cosa y
 * no corta ciclos: los inventa. `costService.recalculateCascadingCosts` ya
 * clonaba por rama desde siempre; acá no, y esa era toda la diferencia.
 *
 * El error que lanzaba es un `Error` pelado y la llamada está adentro de la
 * transacción de la orden, así que subía como 500 genérico —sin nombrar ni el
 * producto ni la receta— y revertía la orden entera: el descuento de insumos, el
 * alta de producto terminado, el costo y su fila de historial. Y era
 * intermitente, que es lo peor que podía ser: el `findAll` no llevaba `ORDER BY`
 * y con la fila de la Premezcla primero la misma orden se cerraba sin problema.
 *
 * ── Qué pasa si el recosteo falla de verdad ──
 *
 * **La orden de producción vale igual, y el recosteo se informa como aviso.** Es
 * el mismo criterio que se tomó en `purchaseService.recostearDependientes`, y
 * acá pesa todavía más:
 *
 *  - el lote se produjo: los insumos se consumieron y el producto terminado
 *    existe en el depósito. Son hechos del mundo, y abortar deja al sistema
 *    diciendo lo contrario de lo que hay en la estantería;
 *  - la receta que se rompe es la de un TERCER producto, aguas abajo. Bloquear
 *    la producción de A porque la receta de C está mal cargada castiga a la
 *    operación equivocada, y quien cierra un lote casi nunca puede tocar esa
 *    receta;
 *  - abortar revierte también el costo del producto recién producido y su fila
 *    de historial, que es el propósito de cerrar la orden.
 *
 * Lo que **no** se hace es callarlo: el aviso nombra el elaborado y viaja en
 * `warnings`, la misma lista con la que ya se avisa el stock insuficiente y que
 * la pantalla ya dibuja. El motivo real queda en el log del servidor.
 *
 * ⚠ Lo que queda afuera: la cascada pudo haber escrito algunos costos antes de
 * fallar y eso **no** se deshace —haría falta un SAVEPOINT—. Sobre un grafo con
 * un ciclo real esos costos ya eran indefendibles antes de esta orden; el aviso
 * es lo que hace que alguien vaya a mirarlos.
 *
 * @param {number} productId El elaborado cuyo costo acaba de cambiar.
 * @param {object} transaction La MISMA de la orden de producción.
 * @param {{empresaId?: number, avisos?: string[]}} [contexto] `avisos` se muta:
 *   es la lista que se le devuelve al usuario.
 */
async function recostearDependientes(productId, transaction, { empresaId = null, avisos = [] } = {}) {
  const costService = require('./costService');

  const dependientes = await RecipeItem.findAll({
    where: { ingredient_product_id: productId },
    include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
    // Sin `ORDER BY`, el orden de las filas lo elige Postgres, y con él cambiaba
    // el resultado de cerrar la orden: la misma producción respondía 201 o 500
    // según qué rama del diamante saliera primero. Hoy ya no cambia el
    // resultado, pero sí el orden de los avisos, y un aviso que aparece en
    // distinto lugar en cada orden es un aviso que nadie termina de leer.
    order: [['id', 'ASC']],
    transaction,
  });

  // Una misma receta puede listar el mismo insumo dos veces: `recipe_items` no
  // tiene índice único por (recipe_id, ingredient_product_id). Recostear dos
  // veces el mismo elaborado da exactamente el mismo número, y con el defecto
  // viejo ni siquiera llegaba a hacerlo: la segunda vuelta encontraba el
  // elaborado ya marcado y el 500 era determinístico, sin depender del orden.
  const yaRecosteados = new Set();

  for (const dep of dependientes) {
    if (!dep.recipe || !dep.recipe.product_id) continue;

    const elaborado = dep.recipe.product_id;

    if (yaRecosteados.has(elaborado)) continue;
    yaRecosteados.add(elaborado);

    try {
      // Un Set NUEVO por rama, con el producto producido adentro para cortar los
      // ciclos que sí existen. Ver arriba por qué no puede ser el de la rama
      // anterior.
      await costService.recalculateCascadingCosts(
        elaborado,
        new Set([productId]),
        transaction
      );
    } catch (err) {
      logger.warn(
        { err, producido: productId, elaborado, empresaId },
        'No se pudo recostear un elaborado al cerrar una orden de producción'
      );

      avisos.push(await avisoDeRecosteoFallido(elaborado, empresaId, transaction));
    }
  }
}

/**
 * El aviso de un elaborado que no se pudo recostear.
 *
 * **Nombra el producto.** Lo que había antes era un 500 «Error al crear la orden
 * de producción»: no decía ni qué producto ni qué receta, así que ni siquiera se
 * sabía qué abrir para arreglarlo.
 *
 * `findScoped` y no `findByPk`: el id sale del grafo de recetas y no del
 * cliente, pero `recipe_items` no tiene `empresa_id`, así que una fila cruzada
 * entre empresas pondría el nombre de un producto ajeno en la respuesta.
 */
async function avisoDeRecosteoFallido(productId, empresaId, transaction) {
  const elaborado = empresaId
    ? await findScoped(Product, productId, empresaId, { transaction })
    : null;

  const nombre = elaborado && elaborado.name
    ? `«${elaborado.name}»`
    : `el producto #${productId}`;

  return `No se pudo recalcular el costo de ${nombre}: su receta tiene una `
    + 'dependencia circular o un rendimiento que no deja producto terminado. '
    + 'La producción se registró igual; revisá esa receta.';
}

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

  // `usuarioId` es cuarto y opcional a proposito: quien recibe una orden de
  // produccion cambia el costo del producto elaborado, y hasta ahora esa fila
  // del historial no decia quien. Por defecto null para no romper a los dos
  // tests que llaman con tres argumentos.
  async createProductionOrder(data, empresaId, puntoDeVentaId = null, usuarioId = null) {
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

      // La comparacion la hace ahora `registrarCambioDeCosto`, en centavos: la
      // resta en punto flotante que habia aca daba 0.009999999999999787 para un
      // cambio de $1.200,00 a $1.200,01, o sea que ese cambio no se registraba
      // ni se escribia. El `update` del costo colgaba de la misma condicion, asi
      // que el producto se quedaba con el costo viejo.
      if (esCambioSignificativo(currentCost, unitCost)) {
        await product.update({ cost: unitCost }, { transaction: t });

        await registrarCambioDeCosto({
          producto: product,
          costoAnterior: currentCost,
          costoNuevo: unitCost,
          motivo: MOTIVOS.ORDEN_DE_PRODUCCION,
          usuarioId,
          transaction: t,
        });

        // `warnings` es la MISMA lista que ya lleva los faltantes de stock: un
        // recosteo que no se pudo hacer es información de la misma clase —la
        // orden se registró, pero hay algo que revisar— y la pantalla ya la
        // dibuja.
        await recostearDependientes(product_id, t, { empresaId, avisos: warnings });
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
