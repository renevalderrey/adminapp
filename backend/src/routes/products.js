// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Productos
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Product, Brand, Stock, Recipe, RecipeItem, ProductCostHistory, sequelize } = require('../models');
const { Op } = require('sequelize');
const costService = require('../services/costService');
const logger = require('../utils/logger');
const checkPermission = require('../middleware/checkPermission');

// GET /api/products — Listar productos (con marca y stock, paginado)
router.get('/', checkPermission('products.ver'), async (req, res) => {
  try {
    const { search, brand, active, page, limit } = req.query;
    const empresaId = req.empresaId || 1;
    const where = {
      [Op.or]: [
        { empresa_id: empresaId },
        { empresa_id: null },
      ],
    };

    if (search) {
      const tokens = search.trim().split(/\s+/).filter(Boolean);
      where[Op.and] = tokens.map(token => {
        const conditions = [
          { name: { [Op.iLike]: `%${token}%` } },
          { '$brand.name$': { [Op.iLike]: `%${token}%` } },
          { sku: { [Op.iLike]: `%${token}%` } },
          { category: { [Op.iLike]: `%${token}%` } },
        ];
        const num = parseFloat(token);
        if (!isNaN(num)) {
          conditions.push({ cost: num });
        }
        return { [Op.or]: conditions };
      });
    }
    if (brand) {
      where.brand_id = brand;
    }
    if (active !== undefined) {
      where.is_active = active === 'true';
    }

    const pageNum = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || null;
    const offset = pageLimit ? (pageNum - 1) * pageLimit : null;

    const queryOpts = {
      where,
      include: [
        { model: Brand, as: 'brand', attributes: ['id', 'name', 'color'] },
        { model: Stock, as: 'stock', attributes: ['location', 'punto_de_venta_id', 'quantity', 'available'] },
      ],
      order: [['name', 'ASC']],
    };

    if (pageLimit) {
      queryOpts.limit = pageLimit;
      queryOpts.offset = offset;
    }

    const { count, rows } = await Product.findAndCountAll(queryOpts);

    res.json({
      ok: true,
      data: rows,
      total: count,
      page: pageNum,
      totalPages: pageLimit ? Math.ceil(count / pageLimit) : 1,
    });
  } catch (err) {
    logger.error({ err }, '[products:list]');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/products/:id — Un producto específico
router.get('/:id', checkPermission('products.ver'), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: [
        { model: Brand, as: 'brand' },
        { model: Stock, as: 'stock' },
      ],
    });
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, data: product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/products — Crear producto
router.post('/', checkPermission('products.crear'), async (req, res) => {
  try {
    const { name, sku, cost, brand_id, margin_override, price_override, category } = req.body;
    const product = await Product.create({ name, sku, cost, brand_id, margin_override, price_override, category, empresa_id: req.empresaId || 1 });
    res.status(201).json({ ok: true, data: product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/products/:id — Actualizar producto
router.put('/:id', checkPermission('products.editar'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    const oldCost = parseFloat(product.cost) || 0;
    await product.update(req.body, { transaction: t });
    const newCost = parseFloat(product.cost) || 0;

    if (req.body.cost !== undefined && Math.abs(oldCost - newCost) >= 0.01) {
      // Registrar en el historial de costos para este producto
      await ProductCostHistory.create({
        product_id: product.id,
        old_cost: oldCost,
        new_cost: newCost,
        reason: 'Edición manual de costo base'
      }, { transaction: t });

      // Propagar el cambio a los productos que dependen de él
      const dependentItems = await RecipeItem.findAll({
        where: { ingredient_product_id: product.id },
        include: [{ model: Recipe, as: 'recipe', attributes: ['product_id'] }],
        transaction: t
      });

      for (const item of dependentItems) {
        if (item.recipe && item.recipe.product_id) {
          await costService.recalculateCascadingCosts(item.recipe.product_id, new Set([product.id]), t);
        }
      }
    }

    await t.commit();
    res.json({ ok: true, data: product });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/products/:id — Eliminar (soft: desactivar)
router.delete('/:id', checkPermission('products.eliminar'), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    await product.update({ is_active: false });
    res.json({ ok: true, message: 'Producto desactivado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/products/bulk — Carga masiva (reemplaza bulkGuardar)
router.post('/bulk', checkPermission('products.crear'), async (req, res) => {
  try {
    const { products } = req.body; // [{ name, cost, sku, brand_name, quantity, location }]
    if (!Array.isArray(products)) return res.status(400).json({ ok: false, error: 'Formato inválido' });

    let created = 0, updated = 0;

    const empresaId = req.empresaId || 1;

    for (const p of products) {
      // Buscar o crear marca
      let brandId = null;
      if (p.brand_name) {
        const [brand] = await Brand.findOrCreate({ where: { name: p.brand_name, empresa_id: empresaId }, defaults: { empresa_id: empresaId } });
        brandId = brand.id;
      }

      // Buscar producto existente por nombre o SKU
      let product = null;
      if (p.sku) product = await Product.findOne({ where: { sku: p.sku, empresa_id: empresaId } });
      if (!product) product = await Product.findOne({ where: { name: p.name, empresa_id: empresaId } });

      if (product) {
        // Actualizar costo
        await product.update({ cost: p.cost || product.cost, brand_id: brandId || product.brand_id });
        updated++;
      } else {
        // Crear nuevo producto
        product = await Product.create({
          name: p.name,
          sku: p.sku || null,
          cost: p.cost || 0,
          brand_id: brandId,
          category: p.category || 'otro',
          empresa_id: empresaId,
        });
        created++;
      }

      // Actualizar stock si se proporcionó
      if (p.quantity !== undefined) {
        const location = p.location || 'general';
        const pvId = req.puntoDeVentaId || p.punto_de_venta_id || null;
        const where = pvId
          ? { product_id: product.id, punto_de_venta_id: pvId, empresa_id: empresaId }
          : { product_id: product.id, location, empresa_id: empresaId };
        const defaults = { quantity: p.quantity, available: p.quantity, location, empresa_id: empresaId };
        if (pvId) defaults.punto_de_venta_id = pvId;
        const [stock] = await Stock.findOrCreate({ where, defaults });
        if (!stock.isNewRecord) {
          await stock.update({ quantity: p.quantity, available: p.quantity });
        }
      }
    }

    res.json({ ok: true, created, updated, total: products.length });
  } catch (err) {
    console.error('[products:bulk]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/products/:id/cost-history — Obtener historial de costos de un producto
router.get('/:id/cost-history', checkPermission('products.ver'), async (req, res) => {
  try {
    const history = await ProductCostHistory.findAll({
      where: { product_id: req.params.id },
      order: [['change_date', 'DESC']],
    });
    res.json({ ok: true, data: history });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/products/:id/recipe — Obtener receta de un producto
router.get('/:id/recipe', checkPermission('recetas.ver'), async (req, res) => {
  try {
    const recipe = await Recipe.findOne({
      where: { product_id: req.params.id },
      include: [
        {
          model: RecipeItem,
          as: 'items',
          include: [{ model: Product, as: 'ingredient', attributes: ['id', 'name', 'cost', 'sku'] }],
        },
      ],
    });
    res.json({ ok: true, data: recipe });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/products/:id/recipe — Crear o actualizar receta de un producto
router.post('/:id/recipe', checkPermission('recetas.crear'), async (req, res) => {
  const productId = parseInt(req.params.id);
  const { loss_percentage, yield: recipeYield, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'La receta debe contener al menos un ingrediente' });
  }

  // Validar dependencia circular
  const ingredientIds = items.map(item => parseInt(item.ingredient_product_id));
  const hasCircularDependency = await costService.checkCircularDependency(productId, ingredientIds);
  if (hasCircularDependency) {
    return res.status(400).json({
      ok: false,
      error: 'Dependencia circular detectada. Un ingrediente no puede depender de forma recursiva del producto elaborado.'
    });
  }

  const t = await sequelize.transaction();
  try {
    // Buscar o crear receta
    const [recipe, created] = await Recipe.findOrCreate({
      where: { product_id: productId },
      defaults: { loss_percentage: loss_percentage || 0, yield: recipeYield || 1, empresa_id: req.empresaId || 1 },
      transaction: t,
    });

    if (!created) {
      await recipe.update({ loss_percentage: loss_percentage || 0, yield: recipeYield || 1 }, { transaction: t });
    }

    // Eliminar ítems anteriores
    await RecipeItem.destroy({ where: { recipe_id: recipe.id }, transaction: t });

    // Crear nuevos ítems
    const newItems = items.map(item => ({
      recipe_id: recipe.id,
      ingredient_product_id: item.ingredient_product_id,
      quantity: item.quantity,
    }));
    await RecipeItem.bulkCreate(newItems, { transaction: t });

    // Confirmar transacción intermedia para que el costService pueda leer las relaciones actualizadas
    await t.commit();

    // Iniciar otra transacción para actualizar costos en cascada
    const tCascade = await sequelize.transaction();
    try {
      await costService.recalculateCascadingCosts(productId, new Set(), tCascade);
      await tCascade.commit();
    } catch (cascadeErr) {
      await tCascade.rollback();
      throw cascadeErr;
    }

    // Obtener costo final recalculado
    const updatedProduct = await Product.findByPk(productId);

    res.json({
      ok: true,
      data: recipe,
      calculated_cost: updatedProduct ? parseFloat(updatedProduct.cost) : 0,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/products/:id/recipe — Eliminar receta de un producto
router.delete('/:id/recipe', checkPermission('recetas.eliminar'), async (req, res) => {
  try {
    const deleted = await Recipe.destroy({ where: { product_id: req.params.id } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Receta no encontrada' });
    res.json({ ok: true, message: 'Receta eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
