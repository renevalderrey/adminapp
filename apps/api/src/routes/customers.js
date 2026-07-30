const express = require('express');
const router = express.Router();
const { Customer, Sale, CustomerPayment } = require('../models');
const customerService = require('../services/customerService');
const checkPermission = require('../middleware/checkPermission');

router.get('/', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const result = await customerService.listCustomers(req.query, req.empresaId || 1);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[customers:list]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/summary', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const summary = await customerService.getSummary();
    res.json({ ok: true, data: summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/ranking', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const ranking = await customerService.getRanking(req.query.limit, req.empresaId || 1);
    res.json({ ok: true, data: ranking });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:id', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const detail = await customerService.getCustomerDetail(req.params.id);
    if (!detail) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, data: detail });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/', checkPermission('clientes.crear'), async (req, res) => {
  try {
    const customer = await Customer.create({ ...req.body, empresa_id: req.empresaId || 1 });
    res.status(201).json({ ok: true, data: customer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:id', checkPermission('clientes.editar'), async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    await customer.update(req.body);
    res.json({ ok: true, data: customer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/:id', checkPermission('clientes.eliminar'), async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    await customer.update({ is_active: false });
    res.json({ ok: true, message: 'Cliente desactivado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:id/debt', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    const balance = await customerService.calculateBalance(req.params.id);
    const aging = await customerService.calculateAging(req.params.id);

    res.json({ ok: true, data: { balance, aging } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/payments', checkPermission('caja.crear'), async (req, res) => {
  try {
    const payment = await customerService.registerPayment(req.params.id, req.body);
    res.status(201).json({ ok: true, data: payment });
  } catch (err) {
    if (err.message === 'Cliente no encontrado') {
      return res.status(404).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:id/payments', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const payments = await CustomerPayment.findAll({
      where: { customer_id: req.params.id },
      order: [['payment_date', 'DESC']],
    });
    res.json({ ok: true, data: payments });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:id/sales', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const sales = await Sale.findAll({
      where: { customer_id: req.params.id },
      include: [{ all: true }],
      order: [['date', 'DESC']],
    });
    res.json({ ok: true, data: sales });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
