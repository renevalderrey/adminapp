// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Productos
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Product, Brand, Stock } = require('../models');
const { Op } = require('sequelize');

// GET /api/products — Listar todos los productos (con marca y stock)
router.get('/', async (req, res) => {
  try {
    const { search, brand, active } = req.query;
    const where = {};

    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }
    if (brand) {
      where.brand_id = brand;
    }
    if (active !== undefined) {
      where.is_active = active === 'true';
    }

    const products = await Product.findAll({
      where,
      include: [
        { model: Brand, as: 'brand', attributes: ['id', 'name', 'color'] },
        { model: Stock, as: 'stock', attributes: ['location', 'quantity', 'available'] },
      ],
      order: [['name', 'ASC']],
    });

    res.json({ ok: true, data: products });
  } catch (err) {
    console.error('[products:list]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/products/:id — Un producto específico
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
  try {
    const { name, sku, cost, brand_id, margin_override, price_override, category } = req.body;
    const product = await Product.create({ name, sku, cost, brand_id, margin_override, price_override, category });
    res.status(201).json({ ok: true, data: product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/products/:id — Actualizar producto
router.put('/:id', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    await product.update(req.body);
    res.json({ ok: true, data: product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/products/:id — Eliminar (soft: desactivar)
router.delete('/:id', async (req, res) => {
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
router.post('/bulk', async (req, res) => {
  try {
    const { products } = req.body; // [{ name, cost, sku, brand_name, quantity, location }]
    if (!Array.isArray(products)) return res.status(400).json({ ok: false, error: 'Formato inválido' });

    let created = 0, updated = 0;

    for (const p of products) {
      // Buscar o crear marca
      let brandId = null;
      if (p.brand_name) {
        const [brand] = await Brand.findOrCreate({ where: { name: p.brand_name } });
        brandId = brand.id;
      }

      // Buscar producto existente por nombre o SKU
      let product = null;
      if (p.sku) product = await Product.findOne({ where: { sku: p.sku } });
      if (!product) product = await Product.findOne({ where: { name: p.name } });

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
        });
        created++;
      }

      // Actualizar stock si se proporcionó
      if (p.quantity !== undefined) {
        const location = p.location || 'general';
        const [stock] = await Stock.findOrCreate({
          where: { product_id: product.id, location },
          defaults: { quantity: p.quantity, available: p.quantity },
        });
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

module.exports = router;
