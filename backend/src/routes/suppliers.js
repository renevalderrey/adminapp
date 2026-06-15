const express = require('express');
const router = express.Router();
const { Supplier, SupplierOrder, SupplierMovement, SupplierDocument } = require('../models');
const sequelize = require('../config/database');
const purchaseService = require('../services/purchaseService');
const checkPermission = require('../middleware/checkPermission');

// ── Órdenes de Compra (deben ir ANTES de /:id) ──

// GET /api/suppliers/orders — Lista global de órdenes
router.get('/orders', checkPermission('ordenes_compra.ver'), async (req, res) => {
  try {
    const result = await purchaseService.getOrders({ ...req.query, empresa_id: req.empresaId || 1 });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/suppliers/orders/:id — Detalle de orden
router.get('/orders/:id', checkPermission('ordenes_compra.ver'), async (req, res) => {
  try {
    const order = await purchaseService.getOrderDetail(req.params.id, req.empresaId || 1);
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/suppliers/orders/:id/receive — Recibir orden
router.put('/orders/:id/receive', checkPermission('ordenes_compra.recibir'), async (req, res) => {
  try {
    const pvId = req.puntoDeVentaId || null;
    const order = await purchaseService.receiveOrder(req.params.id, req.body.items, req.body.location, pvId, req.empresaId || 1);
    res.json({ ok: true, data: { id: order.id, status: order.status } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/suppliers/orders/:id/cancel — Anular orden
router.put('/orders/:id/cancel', checkPermission('ordenes_compra.anular'), async (req, res) => {
  try {
    const order = await purchaseService.cancelOrder(req.params.id, req.empresaId || 1);
    res.json({ ok: true, data: { id: order.id, status: order.status } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Proveedores ──

// GET /api/suppliers — Listar todos
router.get('/', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({
      where: { empresa_id: req.empresaId || 1 },
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
router.get('/:id', checkPermission('proveedores.ver'), async (req, res) => {
  try {
    const supplier = await Supplier.findOne({
      where: { id: req.params.id, empresa_id: req.empresaId || 1 },
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
router.post('/', checkPermission('proveedores.crear'), async (req, res) => {
  try {
    const supplier = await Supplier.create({ ...req.body, empresa_id: req.empresaId || 1 });
    res.status(201).json({ ok: true, data: supplier });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/suppliers/:id — Actualizar proveedor
router.put('/:id', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ where: { id: req.params.id, empresa_id: req.empresaId || 1 } });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    await supplier.update(req.body);
    res.json({ ok: true, data: supplier });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/suppliers/:id — Eliminar proveedor
router.delete('/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const supplier = await Supplier.findOne({ where: { id: req.params.id, empresa_id: req.empresaId || 1 }, transaction: t });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
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

// POST /api/suppliers/:id/orders — Crear pedido con items
router.post('/:id/orders', checkPermission('ordenes_compra.crear'), async (req, res) => {
  try {
    const order = await purchaseService.createOrder(req.params.id, req.body, req.empresaId || 1);
    res.status(201).json({ ok: true, data: order });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Pagos ──

// POST /api/suppliers/:id/payments — Registrar pago
router.post('/:id/payments', checkPermission('proveedores.crear'), async (req, res) => {
  try {
    const { date, amount, payment_method, notes } = req.body;
    const movement = await SupplierMovement.create({
      supplier_id: req.params.id,
      empresa_id: req.empresaId || 1,
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

// ── Movimientos ──

// PUT /api/suppliers/movements/:id — Editar movimiento
router.put('/movements/:id', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    const movement = await SupplierMovement.findOne({ where: { id: req.params.id, empresa_id: req.empresaId || 1 } });
    if (!movement) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    await movement.update(req.body);
    res.json({ ok: true, data: movement });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/suppliers/movements/:id — Eliminar movimiento
router.delete('/movements/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  try {
    const deleted = await SupplierMovement.destroy({ where: { id: req.params.id, empresa_id: req.empresaId || 1 } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    res.json({ ok: true, message: 'Movimiento eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Documentos ──

// POST /api/suppliers/:id/documents
router.post('/:id/documents', checkPermission('proveedores.editar'), async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ where: { id: req.params.id, empresa_id: req.empresaId || 1 } });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
    const doc = await SupplierDocument.create({ supplier_id: req.params.id, empresa_id: req.empresaId || 1, ...req.body });
    res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/suppliers/documents/:id
router.delete('/documents/:id', checkPermission('proveedores.eliminar'), async (req, res) => {
  try {
    const deleted = await SupplierDocument.destroy({ where: { id: req.params.id, empresa_id: req.empresaId || 1 } });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    res.json({ ok: true, message: 'Documento eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
