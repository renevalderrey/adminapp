const express = require('express');
const router = express.Router();
const { Customer, Sale, CustomerPayment } = require('../models');
const customerService = require('../services/customerService');
const checkPermission = require('../middleware/checkPermission');
const { findScoped, scoped } = require('../utils/tenantScope');
const logger = require('../utils/logger');

// Todas las consultas de este router se filtran por req.empresaId.
// Antes varias usaban Customer.findByPk(req.params.id) directo, con lo cual un
// usuario podia leer, editar o borrar clientes de otra empresa enumerando ids.
//
// Se responde 404 y no 403 cuando el recurso es de otra empresa: un 403
// confirmaria que ese id existe en algun lado, lo que permite mapear la base
// ajena. El 404 no distingue "no existe" de "no es tuyo".

const NO_ENCONTRADO = { ok: false, error: 'Cliente no encontrado' };

router.get('/', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const result = await customerService.listCustomers(req.query, req.empresaId);
    res.json({ ok: true, ...result });
  } catch (err) {
    fallo(req, res, err, 'Error al listar clientes');
  }
});

router.get('/summary', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const summary = await customerService.getSummary(req.empresaId);
    res.json({ ok: true, data: summary });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular el resumen');
  }
});

router.get('/ranking', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const ranking = await customerService.getRanking(req.query.limit, req.empresaId);
    res.json({ ok: true, data: ranking });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular el ranking');
  }
});

router.get('/:id', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const detail = await customerService.getCustomerDetail(req.params.id, req.empresaId);
    if (!detail) return res.status(404).json(NO_ENCONTRADO);
    res.json({ ok: true, data: detail });
  } catch (err) {
    fallo(req, res, err, 'Error al obtener el cliente');
  }
});

router.post('/', checkPermission('clientes.crear'), async (req, res) => {
  try {
    // empresa_id va al final para que no pueda pisarse desde el body.
    const customer = await Customer.create({ ...req.body, empresa_id: req.empresaId });
    res.status(201).json({ ok: true, data: customer });
  } catch (err) {
    fallo(req, res, err, 'Error al crear el cliente');
  }
});

router.put('/:id', checkPermission('clientes.editar'), async (req, res) => {
  try {
    const customer = await findScoped(Customer, req.params.id, req.empresaId);
    if (!customer) return res.status(404).json(NO_ENCONTRADO);

    // No se permite mover un cliente de empresa ni cambiarle el id desde el body.
    const { empresa_id, id, ...cambios } = req.body;
    await customer.update(cambios);

    res.json({ ok: true, data: customer });
  } catch (err) {
    fallo(req, res, err, 'Error al actualizar el cliente');
  }
});

router.delete('/:id', checkPermission('clientes.eliminar'), async (req, res) => {
  try {
    const customer = await findScoped(Customer, req.params.id, req.empresaId);
    if (!customer) return res.status(404).json(NO_ENCONTRADO);

    await customer.update({ is_active: false });
    res.json({ ok: true, message: 'Cliente desactivado' });
  } catch (err) {
    fallo(req, res, err, 'Error al desactivar el cliente');
  }
});

router.get('/:id/debt', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const customer = await findScoped(Customer, req.params.id, req.empresaId);
    if (!customer) return res.status(404).json(NO_ENCONTRADO);

    const balance = await customerService.calculateBalance(customer.id, req.empresaId);
    const aging = await customerService.calculateAging(customer.id, req.empresaId);

    res.json({ ok: true, data: { balance, aging } });
  } catch (err) {
    fallo(req, res, err, 'Error al calcular la deuda');
  }
});

router.post('/:id/payments', checkPermission('caja.crear'), async (req, res) => {
  try {
    const payment = await customerService.registerPayment(
      req.params.id,
      req.body,
      req.empresaId
    );
    res.status(201).json({ ok: true, data: payment });
  } catch (err) {
    if (err.status === 404 || err.message === 'Cliente no encontrado') {
      return res.status(404).json(NO_ENCONTRADO);
    }
    fallo(req, res, err, 'Error al registrar el pago');
  }
});

router.get('/:id/payments', checkPermission('clientes.ver'), async (req, res) => {
  try {
    // Se valida el cliente antes de listar: sin esto, filtrar solo por
    // customer_id devolvia los pagos de un cliente de otra empresa.
    const customer = await findScoped(Customer, req.params.id, req.empresaId);
    if (!customer) return res.status(404).json(NO_ENCONTRADO);

    const payments = await CustomerPayment.findAll({
      where: scoped({ customer_id: customer.id }, req.empresaId),
      order: [['payment_date', 'DESC']],
    });

    res.json({ ok: true, data: payments });
  } catch (err) {
    fallo(req, res, err, 'Error al listar los pagos');
  }
});

router.get('/:id/sales', checkPermission('clientes.ver'), async (req, res) => {
  try {
    const customer = await findScoped(Customer, req.params.id, req.empresaId);
    if (!customer) return res.status(404).json(NO_ENCONTRADO);

    const sales = await Sale.findAll({
      where: scoped({ customer_id: customer.id }, req.empresaId),
      include: [{ all: true }],
      order: [['date', 'DESC']],
    });

    res.json({ ok: true, data: sales });
  } catch (err) {
    fallo(req, res, err, 'Error al listar las ventas');
  }
});

module.exports = router;
