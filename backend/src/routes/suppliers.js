// ════════════════════════════════════════════
//  COMPRAFIT · Rutas: Proveedores
// ════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { Supplier, SupplierOrder, SupplierMovement, SupplierDocument } = require('../models');
const sequelize = require('../config/database');

// GET /api/suppliers — Listar todos
router.get('/', async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({
      include: [
        { model: SupplierMovement, as: 'movements' },
        { model: SupplierDocument, as: 'documents' },
      ],
      order: [['name', 'ASC']],
    });
    res.json({ ok: true, data: suppliers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/suppliers/:id — Detalle
router.get('/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id, {
      include: [
        { model: SupplierOrder, as: 'orders', order: [['date', 'DESC']] },
        { model: SupplierMovement, as: 'movements', order: [['date', 'DESC']] },
        { model: SupplierDocument, as: 'documents' },
      ],
    });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    res.json({ ok: true, data: supplier });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/suppliers — Crear proveedor
router.post('/', async (req, res) => {
  try {
    const supplier = await Supplier.create(req.body);
    res.status(201).json({ ok: true, data: supplier });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/suppliers/:id — Eliminar proveedor y sus datos
router.delete('/:id', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    await SupplierDocument.destroy({ where: { supplier_id: req.params.id }, transaction: t });
    await SupplierMovement.destroy({ where: { supplier_id: req.params.id }, transaction: t });
    await SupplierOrder.destroy({ where: { supplier_id: req.params.id }, transaction: t });
    await Supplier.destroy({ where: { id: req.params.id }, transaction: t });
    await t.commit();
    res.json({ ok: true, message: 'Proveedor eliminado' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Pedidos ──

// POST /api/suppliers/:id/orders — Registrar pedido
router.post('/:id/orders', async (req, res) => {
  try {
    const { date, total, notes, detail } = req.body;
    const order = await SupplierOrder.create({
      supplier_id: req.params.id, date, total, notes, detail,
    });
    // Registrar como movimiento tipo "deuda"
    await SupplierMovement.create({
      supplier_id: req.params.id,
      type: 'deuda',
      date,
      amount: total,
      notes: notes || `Pedido #${order.id}`,
    });
    res.status(201).json({ ok: true, data: order });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Pagos ──

// POST /api/suppliers/:id/payments — Registrar pago
router.post('/:id/payments', async (req, res) => {
  try {
    const { date, amount, payment_method, notes } = req.body;
    const movement = await SupplierMovement.create({
      supplier_id: req.params.id,
      type: 'pago',
      date,
      amount,
      payment_method,
      notes,
    });
    res.status(201).json({ ok: true, data: movement });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/suppliers/movements/:id — Editar movimiento
router.put('/movements/:id', async (req, res) => {
  try {
    const movement = await SupplierMovement.findByPk(req.params.id);
    if (!movement) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    await movement.update(req.body);
    res.json({ ok: true, data: movement });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/suppliers/movements/:id — Eliminar movimiento
router.delete('/movements/:id', async (req, res) => {
  try {
    const deleted = await SupplierMovement.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    res.json({ ok: true, message: 'Movimiento eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Documentos ──

// POST /api/suppliers/:id/documents
router.post('/:id/documents', async (req, res) => {
  try {
    const doc = await SupplierDocument.create({ supplier_id: req.params.id, ...req.body });
    res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/suppliers/documents/:id
router.delete('/documents/:id', async (req, res) => {
  try {
    const deleted = await SupplierDocument.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    res.json({ ok: true, message: 'Documento eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
