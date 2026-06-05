const { Op } = require('sequelize');
const {
  CashFlowEntry,
  Sale,
  CustomerPayment,
  FixedExpense,
  SupplierMovement,
  TaxPayment,
  sequelize,
} = require('../models');

class CashflowService {
  async getBalance(empresaId = 1, puntoDeVentaId = null) {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sixtyDaysFromNow = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const scope = { empresa_id: empresaId };
    if (puntoDeVentaId) scope.punto_de_venta_id = puntoDeVentaId;

    const totalSales = parseFloat(await Sale.sum('total', { where: scope })) || 0;
    const totalCustomerPayments = parseFloat(await CustomerPayment.sum('amount', { where: { empresa_id: empresaId } })) || 0;
    const totalExpenses = parseFloat(await FixedExpense.sum('amount', { where: { empresa_id: empresaId } })) || 0;
    const totalSupplierPayments = parseFloat(
      await SupplierMovement.sum('amount', { where: { empresa_id: empresaId, type: 'pago' } })
    ) || 0;
    const totalSupplierDebts = parseFloat(
      await SupplierMovement.sum('amount', { where: { empresa_id: empresaId, type: 'deuda' } })
    ) || 0;
    const totalTaxPayments = parseFloat(await TaxPayment.sum('amount', { where: { empresa_id: empresaId } })) || 0;

    const manualInflows = parseFloat(
      await CashFlowEntry.sum('amount', { where: { ...scope, type: 'inflow' } })
    ) || 0;
    const manualOutflows = parseFloat(
      await CashFlowEntry.sum('amount', { where: { ...scope, type: 'outflow' } })
    ) || 0;

    const allInflows = totalSales + totalCustomerPayments + manualInflows;
    const allOutflows = totalExpenses + totalSupplierPayments + totalSupplierDebts + totalTaxPayments + manualOutflows;
    const balance = allInflows - allOutflows;

    const sales30d = parseFloat(
      await Sale.sum('total', { where: { ...scope, date: { [Op.gte]: thirtyDaysAgo } } })
    ) || 0;

    const customerPayments30d = parseFloat(
      await CustomerPayment.sum('amount', { where: { empresa_id: empresaId, payment_date: { [Op.gte]: thirtyDaysAgo } } })
    ) || 0;

    const expenses30d = parseFloat(
      await FixedExpense.sum('amount', { where: { empresa_id: empresaId } })
    ) || 0;

    const monthlyTaxPayments = parseFloat(
      await TaxPayment.sum('amount', { where: { empresa_id: empresaId, payment_date: { [Op.gte]: thirtyDaysAgo } } })
    ) || 0;

    const projectedInflows30d = (sales30d + customerPayments30d) * 1.1;
    const projectedOutflows30d = expenses30d + monthlyTaxPayments;
    const projected30d = balance + projectedInflows30d - projectedOutflows30d;
    const projected60d = projected30d + projectedInflows30d - projectedOutflows30d;

    return {
      balance: Math.round(balance * 100) / 100,
      total_inflows_30d: Math.round(projectedInflows30d * 100) / 100,
      total_outflows_30d: Math.round(projectedOutflows30d * 100) / 100,
      projected_30d: Math.round(projected30d * 100) / 100,
      projected_60d: Math.round(projected60d * 100) / 100,
    };
  }

  async getMovements(filters = {}, empresaId = 1, puntoDeVentaId = null) {
    const { limit, offset, type, category, date_from, date_to } = filters;
    const where = { empresa_id: empresaId };
    if (puntoDeVentaId) where.punto_de_venta_id = puntoDeVentaId;
    if (type) where.type = type;
    if (category) where.category = category;
    if (date_from || date_to) {
      where.entry_date = {};
      if (date_from) where.entry_date[Op.gte] = date_from;
      if (date_to) where.entry_date[Op.lte] = date_to;
    }

    const pageLimit = parseInt(limit) || 50;
    const pageOffset = parseInt(offset) || 0;

    const { count, rows } = await CashFlowEntry.findAndCountAll({
      where,
      order: [['entry_date', 'DESC'], ['id', 'DESC']],
      limit: pageLimit,
      offset: pageOffset,
    });

    return { data: rows, total: count };
  }

  async createEntry(data, empresaId = 1, puntoDeVentaId = null) {
    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new Error('El monto debe ser mayor a 0');
    }
    return await CashFlowEntry.create({
      type: data.type,
      category: data.category || 'otro',
      amount: data.amount,
      entry_date: data.entry_date || new Date().toISOString().split('T')[0],
      description: data.description || null,
      reference: data.reference || null,
      is_recurring: data.is_recurring || false,
      recurring_frequency: data.recurring_frequency || null,
      empresa_id: empresaId,
      punto_de_venta_id: puntoDeVentaId,
    });
  }

  async deleteEntry(id) {
    const entry = await CashFlowEntry.findByPk(id);
    if (!entry) throw new Error('Movimiento no encontrado');
    await entry.destroy();
    return true;
  }

  async getAllMovementsUnified(filters = {}, empresaId = 1, puntoDeVentaId = null) {
    const { date_from, date_to, limit } = filters;
    const pageLimit = parseInt(limit) || 100;

    const from = date_from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = date_to || new Date().toISOString().split('T')[0];

    const scope = { empresa_id: empresaId };
    if (puntoDeVentaId) scope.punto_de_venta_id = puntoDeVentaId;

    const movements = [];

    const salesScope = { ...scope, date: { [Op.between]: [from, to] } };
    const sales = await Sale.findAll({
      where: salesScope,
      attributes: [['id', 'ref_id'], ['date', 'movement_date'], ['total', 'amount']],
      raw: true,
    });
    for (const s of sales) {
      movements.push({
        source: 'Venta',
        type: 'inflow',
        amount: parseFloat(s.amount),
        date: s.movement_date,
        description: `Venta #${s.ref_id}`,
      });
    }

    const expenses = await FixedExpense.findAll({
      where: { empresa_id: empresaId },
      attributes: [['id', 'ref_id'], ['amount', 'amount']],
      raw: true,
    });
    for (const e of expenses) {
      movements.push({
        source: 'Gasto Fijo',
        type: 'outflow',
        amount: parseFloat(e.amount),
        date: null,
        description: `Gasto #${e.ref_id}`,
      });
    }

    const supplierPayments = await SupplierMovement.findAll({
      where: { empresa_id: empresaId, type: 'pago' },
      attributes: [['id', 'ref_id'], ['date', 'movement_date'], ['amount', 'amount'], ['notes', 'description']],
      raw: true,
    });
    for (const p of supplierPayments) {
      movements.push({
        source: 'Pago Proveedor',
        type: 'outflow',
        amount: parseFloat(p.amount),
        date: p.movement_date,
        description: p.description || `Pago #${p.ref_id}`,
      });
    }

    const customerPayments = await CustomerPayment.findAll({
      where: { empresa_id: empresaId, payment_date: { [Op.between]: [from, to] } },
      attributes: [['id', 'ref_id'], ['payment_date', 'movement_date'], ['amount', 'amount'], ['reference', 'description']],
      raw: true,
    });
    for (const cp of customerPayments) {
      movements.push({
        source: 'Cobranza',
        type: 'inflow',
        amount: parseFloat(cp.amount),
        date: cp.movement_date,
        description: cp.description || `Pago cliente #${cp.ref_id}`,
      });
    }

    const taxPayments = await TaxPayment.findAll({
      where: { empresa_id: empresaId, payment_date: { [Op.between]: [from, to] } },
      attributes: [['id', 'ref_id'], ['payment_date', 'movement_date'], ['amount', 'amount'], ['tax_type', 'description']],
      raw: true,
    });
    for (const tp of taxPayments) {
      movements.push({
        source: 'Impuesto',
        type: 'outflow',
        amount: parseFloat(tp.amount),
        date: tp.movement_date,
        description: `${tp.description}`,
      });
    }

    const manualEntries = await CashFlowEntry.findAll({
      where: { ...scope, entry_date: { [Op.between]: [from, to] } },
      attributes: [['id', 'ref_id'], ['entry_date', 'movement_date'], ['amount', 'amount'], ['description', 'description'], ['type', 'type'], ['category', 'category']],
      raw: true,
    });
    for (const me of manualEntries) {
      movements.push({
        source: `Manual (${me.category})`,
        type: me.type,
        amount: parseFloat(me.amount),
        date: me.movement_date,
        description: me.description || '',
      });
    }

    movements.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    return movements.slice(0, pageLimit);
  }
}

module.exports = new CashflowService();
