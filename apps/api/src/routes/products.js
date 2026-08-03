// ════════════════════════════════════════════
//  ADMINAPP · Rutas: Productos
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Product, Brand, Stock, Recipe, RecipeItem, ProductCostHistory, Supplier, sequelize } = require('../models');
const { Op } = require('sequelize');
const costService = require('../services/costService');
const logger = require('../utils/logger');
const checkPermission = require('../middleware/checkPermission');
const { findScoped } = require('../utils/tenantScope');
const { fallo } = require('../utils/errores');
const requireSuperadmin = require('../middleware/requireSuperadmin');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');

// ── Qué se puede editar de un producto ──
//
// Todo lo que NO está acá se ignora, aunque venga en el cuerpo. Lo importante
// que queda afuera: `empresa_id` —que decide de quién es el producto— y `id`.
//
// Se enumera lo permitido y no lo prohibido a propósito: con una lista de
// prohibidos, cada columna nueva del modelo queda editable por omisión, y nadie
// se acuerda de agregarla.
const CAMPOS_EDITABLES = [
  'name', 'description', 'sku', 'barcode', 'cost',
  'brand_id', 'supplier_id',
  'margin_override', 'price_override', 'wholesale_margin', 'wholesale_price',
  'category', 'unit_type', 'unit_size', 'taxed', 'image_url', 'is_active',
  'tiendanube_variant_id',
];

function camposEditables(body = {}) {
  const limpio = {};

  for (const campo of CAMPOS_EDITABLES) {
    if (body[campo] !== undefined) limpio[campo] = body[campo];
  }

  return limpio;
}

// GET /api/products — Listar productos (con marca y stock, paginado)
router.get('/', checkPermission('products.ver'), async (req, res) => {
  try {
    const { search, brand, active, page, limit } = req.query;
    const empresaId = req.empresaId;
    // empresa_id es NOT NULL en las 22 tablas del schema: aceptar tambien
    // empresa_id IS NULL era codigo muerto, y se volveria una fuga el dia que
    // alguien haga la columna nullable.
    const where = { empresa_id: empresaId };

    if (search) {
      const tokens = search.trim().split(/\s+/).filter(Boolean);
      where[Op.and] = tokens.map(token => {
        const conditions = [
          { name: { [Op.iLike]: `%${token}%` } },
          { '$brand.name$': { [Op.iLike]: `%${token}%` } },
          { sku: { [Op.iLike]: `%${token}%` } },
          { barcode: { [Op.iLike]: `%${token}%` } },
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
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        { model: Stock, as: 'stock', attributes: ['id', 'location', 'punto_de_venta_id', 'quantity', 'available', 'min_stock'] },
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
    fallo(req, res, err, 'Error al listar los productos');
  }
});

// GET /api/products/:id — Un producto específico
router.get('/:id', checkPermission('products.ver'), async (req, res) => {
  try {
    const product = await findScoped(Product, req.params.id, req.empresaId, {
      include: [
        { model: Brand, as: 'brand' },
        { model: Supplier, as: 'supplier', attributes: ['id', 'name'] },
        { model: Stock, as: 'stock' },
      ],
    });
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, data: product });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener el producto');
  }
});

// POST /api/products — Crear producto
router.post('/', checkPermission('products.crear'), async (req, res) => {
  try {
    const sanitize = (v) => (v === '' || v === undefined || v === null ? null : v);
    const { name, description, sku, barcode, cost, brand_id, supplier_id, margin_override, price_override, wholesale_margin, wholesale_price, category, unit_type, unit_size, taxed, image_url } = req.body;
    const product = await Product.create({
      name, description,
      sku: sanitize(sku), barcode: sanitize(barcode),
      cost, brand_id: sanitize(brand_id), supplier_id: sanitize(supplier_id),
      margin_override: sanitize(margin_override), price_override: sanitize(price_override),
      wholesale_margin: sanitize(wholesale_margin), wholesale_price: sanitize(wholesale_price),
      category, unit_type, unit_size: sanitize(unit_size), taxed,
      image_url: sanitize(image_url),
      empresa_id: req.empresaId,
    });
    res.status(201).json({ ok: true, data: product });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el producto');
  }
});

// PUT /api/products/:id — Actualizar producto
router.put('/:id', checkPermission('products.editar'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const product = await findScoped(Product, req.params.id, req.empresaId, { transaction: t });
    if (!product) {
      await t.rollback();
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    const oldCost = parseFloat(product.cost) || 0;

    // Lista blanca, no `req.body` entero.
    //
    // `update(req.body)` escribe cualquier columna que venga en el cuerpo,
    // incluida `empresa_id`: mandandola se mueve el producto a otra empresa
    // cliente. El scoping de findScoped no alcanza — sirve para encontrar el
    // producto, no para impedir que despues se lo saque de la empresa.
    //
    // Tambien evita que se pisen `id` y las marcas de tiempo.
    await product.update(camposEditables(req.body), { transaction: t });

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
    fallo(req, res, err, 'Error al actualizar el producto');
  }
});

// DELETE /api/products/:id — Eliminar (soft: desactivar)
router.delete('/:id', checkPermission('products.eliminar'), async (req, res) => {
  try {
    const product = await findScoped(Product, req.params.id, req.empresaId);
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    await product.update({ is_active: false });
    res.json({ ok: true, message: 'Producto desactivado' });
  } catch (err) {
    fallo(req, res, err, 'Error al desactivar el producto');
  }
});

// POST /api/products/bulk — Carga masiva (reemplaza bulkGuardar)
router.post('/bulk', checkPermission('products.crear'), async (req, res) => {
  try {
    const { products } = req.body; // [{ name, cost, sku, brand_name, quantity, location }]
    if (!Array.isArray(products)) return res.status(400).json({ ok: false, error: 'Formato inválido' });

    let created = 0, updated = 0;

    const empresaId = req.empresaId;

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

      // Actualizar stock si se proporcionó.
      //
      // La sucursal sale de `utils/sucursalDeStock` y **nunca es null**. La
      // rama de antes —`pvId ? {…punto_de_venta_id} : {…location}`— hacía que
      // una carga masiva sin cabecera y sin `punto_de_venta_id` creara una fila
      // con `location: 'general'` y sin sucursal: mercadería que la pantalla,
      // que lee por `punto_de_venta_id`, no muestra nunca.
      //
      // `p.location` se ignora: era el texto que producía esas filas.
      if (p.quantity !== undefined) {
        const ubicacion = ubicacionDeStock(await resolverSucursal({
          empresaId,
          puntoDeVentaId: p.punto_de_venta_id || req.puntoDeVentaId,
        }));

        const [stock] = await Stock.findOrCreate({
          where: {
            product_id: product.id,
            punto_de_venta_id: ubicacion.punto_de_venta_id,
            empresa_id: empresaId,
          },
          defaults: {
            quantity: p.quantity,
            available: p.quantity,
            ...ubicacion,
            empresa_id: empresaId,
          },
        });
        if (!stock.isNewRecord) {
          await stock.update({ quantity: p.quantity, available: p.quantity });
        }
      }
    }

    res.json({ ok: true, created, updated, total: products.length });
  } catch (err) {
    fallo(req, res, err, 'Error en la carga masiva de productos');
  }
});

// GET /api/products/:id/cost-history — Obtener historial de costos de un producto
router.get('/:id/cost-history', checkPermission('products.ver'), async (req, res) => {
  try {
    // El historial se filtraba SOLO por product_id: con el id de un producto de
    // otra empresa cliente se leia su evolucion de costos completa. El producto
    // se resuelve primero con scoping, y el 404 no distingue "no existe" de
    // "no es tuyo" para no permitir enumerar ids ajenos.
    const product = await findScoped(Product, req.params.id, req.empresaId, { attributes: ['id'] });
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    const history = await ProductCostHistory.findAll({
      where: { product_id: product.id },
      order: [['change_date', 'DESC']],
    });
    res.json({ ok: true, data: history });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener el historial de costos');
  }
});

// GET /api/products/:id/recipe — Obtener receta de un producto
router.get('/:id/recipe', requireSuperadmin, checkPermission('recetas.ver'), async (req, res) => {
  try {
    // Misma fuga que en cost-history: la receta es la formula del producto —
    // que insumos lleva y en que proporcion— y se podia leer la de cualquier
    // empresa cliente sabiendo el id.
    const product = await findScoped(Product, req.params.id, req.empresaId, { attributes: ['id'] });
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    const recipe = await Recipe.findOne({
      where: { product_id: product.id },
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
    fallo(req, res, err, 'Error al obtener la receta');
  }
});

// POST /api/products/:id/recipe — Crear o actualizar receta de un producto
router.post('/:id/recipe', requireSuperadmin, checkPermission('recetas.crear'), async (req, res) => {
  const productId = parseInt(req.params.id);
  const { loss_percentage, yield: recipeYield, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'La receta debe contener al menos un ingrediente' });
  }

  // El producto elaborado tiene que ser de esta empresa. Sin este chequeo se
  // podia crear una receta sobre el producto de otra empresa cliente.
  const producto = await findScoped(Product, productId, req.empresaId);
  if (!producto) {
    return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
  }

  const ingredientIds = items.map((item) => parseInt(item.ingredient_product_id));

  if (ingredientIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ ok: false, error: 'Hay ingredientes con id inválido' });
  }

  // Los ingredientes tambien: referenciar el producto de otra empresa como
  // insumo filtraba su costo a traves del costo calculado de la receta.
  const ingredientesPropios = await Product.count({
    where: { id: ingredientIds, empresa_id: req.empresaId },
  });

  if (ingredientesPropios !== new Set(ingredientIds).size) {
    return res.status(400).json({
      ok: false,
      error: 'Alguno de los ingredientes no pertenece a tu empresa',
    });
  }

  // Validar dependencia circular
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
      where: { product_id: productId, empresa_id: req.empresaId },
      defaults: { loss_percentage: loss_percentage || 0, yield: recipeYield || 1, empresa_id: req.empresaId },
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
    fallo(req, res, err, 'Error al guardar la receta');
  }
});

// DELETE /api/products/:id/recipe — Eliminar receta de un producto
router.delete('/:id/recipe', requireSuperadmin, checkPermission('recetas.eliminar'), async (req, res) => {
  try {
    // La peor de las tres: un DELETE sin scoping borraba la receta de otra
    // empresa cliente. Destructivo y silencioso — el dueño se entera cuando
    // produce y el costo le da cero.
    const product = await findScoped(Product, req.params.id, req.empresaId, { attributes: ['id'] });
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    const deleted = await Recipe.destroy({ where: { product_id: product.id } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Receta no encontrada' });
    res.json({ ok: true, message: 'Receta eliminada correctamente' });
  } catch (err) {
    fallo(req, res, err, 'Error al eliminar la receta');
  }
});

module.exports = router;
