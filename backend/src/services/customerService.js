const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const {
  Customer,
  CustomerPayment,
  Sale,
  SupplierMovement,
  sequelize,
} = require('../models');

class CustomerService {
  async getCustomerDetail(customerId) {
    const customer = await Customer.findByPk(customerId);
    if (!customer) return null;

    const balance = await this.calculateBalance(customerId);
    const aging = await this.calculateAging(customerId);
    const empresaId = customer.empresa_id || 1;

    const recentSales = await Sale.findAll({
      where: { customer_id: customerId, empresa_id: empresaId },
      order: [['date', 'DESC']],
      limit: 20,
    });

    const recentPayments = await CustomerPayment.findAll({
      where: { customer_id: customerId, empresa_id: empresaId },
      order: [['payment_date', 'DESC']],
      limit: 20,
    });

    return {
      customer,
      balance,
      aging,
      recent_sales: recentSales,
      recent_payments: recentPayments,
    };
  }

  async calculateBalance(customerId) {
    const customer = await Customer.findByPk(customerId);
    const empresaId = customer?.empresa_id || 1;
    const totalSales = await Sale.sum('total', {
      where: { customer_id: customerId, empresa_id: empresaId },
    });

    const totalPayments = await CustomerPayment.sum('amount', {
      where: { customer_id: customerId, empresa_id: empresaId },
    });

    return (parseFloat(totalSales) || 0) - (parseFloat(totalPayments) || 0);
  }

  async calculateAging(customerId) {
    const today = new Date();
    const buckets = {
      '0_30': 0,
      '31_60': 0,
      '61_90': 0,
      '90_plus': 0,
    };

    const customer = await Customer.findByPk(customerId);
    const empresaId = customer?.empresa_id || 1;

    const sales = await Sale.findAll({
      where: { customer_id: customerId, empresa_id: empresaId },
      attributes: ['total', 'date'],
      raw: true,
    });

    const totalPayments = parseFloat(
      await CustomerPayment.sum('amount', { where: { customer_id: customerId, empresa_id: empresaId } })
    ) || 0;

    const totalSalesAmount = sales.reduce((sum, s) => sum + parseFloat(s.total || 0), 0);

    const agingSales = { '0_30': [], '31_60': [], '61_90': [], '90_plus': [] };

    for (const sale of sales) {
      const saleDate = new Date(sale.date);
      const diffDays = Math.floor((today - saleDate) / (1000 * 60 * 60 * 24));

      if (diffDays <= 30) agingSales['0_30'].push(parseFloat(sale.total));
      else if (diffDays <= 60) agingSales['31_60'].push(parseFloat(sale.total));
      else if (diffDays <= 90) agingSales['61_90'].push(parseFloat(sale.total));
      else agingSales['90_plus'].push(parseFloat(sale.total));
    }

    const unpaid = totalSalesAmount - totalPayments;

    if (unpaid <= 0) return buckets;

    const unpaidRatio = unpaid / totalSalesAmount;

    for (const key of Object.keys(buckets)) {
      const bucketTotal = agingSales[key].reduce((s, v) => s + v, 0);
      buckets[key] = Math.round(bucketTotal * unpaidRatio * 100) / 100;
    }

    return buckets;
  }

  async getRanking(limit = 20, empresaId = 1) {
    const customers = await Customer.findAll({
      where: { is_active: true, empresa_id: empresaId },
      attributes: [
        'id', 'name', 'tax_id', 'email', 'phone',
        [fn('COALESCE', literal(
          `(SELECT SUM(CAST(total AS DECIMAL)) FROM sales WHERE sales.customer_id = "Customer".id AND sales.empresa_id = '${empresaId}')`
        ), 0), 'total_purchases'],
        [fn('COALESCE', literal(
          `(SELECT COUNT(*) FROM sales WHERE sales.customer_id = "Customer".id AND sales.empresa_id = '${empresaId}')`
        ), 0), 'visit_count'],
        [fn('COALESCE', literal(
          `(SELECT MAX(date) FROM sales WHERE sales.customer_id = "Customer".id AND sales.empresa_id = '${empresaId}')`
        ), null), 'last_purchase'],
      ],
      order: [[literal('total_purchases'), 'DESC']],
      limit,
    });

    return customers.map(c => {
      const data = c.toJSON();
      const firstSale = null;
      return {
        ...data,
        total_purchases: parseFloat(data.total_purchases) || 0,
        visit_count: parseInt(data.visit_count) || 0,
      };
    });
  }

  async registerPayment(customerId, data) {
    const customer = await Customer.findByPk(customerId);
    if (!customer) throw new Error('Cliente no encontrado');

    const payment = await CustomerPayment.create({
      customer_id: customerId,
      empresa_id: customer.empresa_id || 1,
      amount: data.amount,
      payment_date: data.payment_date || new Date().toISOString().split('T')[0],
      payment_method: data.payment_method || 'ef',
      reference: data.reference || null,
      notes: data.notes || null,
    });

    return payment;
  }

  async getSummary() {
    const totalReceivable = parseFloat(
      await Customer.findOne({
        attributes: [[literal(`
          (SELECT COALESCE(SUM(CAST(total AS DECIMAL)), 0) FROM sales WHERE customer_id IS NOT NULL)
          -
          (SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0) FROM customer_payments)
        `), 'total']],
        raw: true,
      })
    ) || 0;

    const totalPayable = parseFloat(
      await SupplierMovement.findOne({
        attributes: [[literal(`
          (SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0) FROM supplier_movements WHERE type = 'deuda')
          -
          (SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0) FROM supplier_movements WHERE type = 'pago')
        `), 'total']],
        raw: true,
      })
    ) || 0;

    const today = new Date();
    const supplierMovements = await SupplierMovement.findAll({
      where: { type: 'deuda' },
      attributes: ['amount', 'date'],
      raw: true,
    });

    const totalDebt = supplierMovements.reduce((s, m) => s + parseFloat(m.amount || 0), 0);
    const totalPaid = parseFloat(
      await SupplierMovement.sum('amount', { where: { type: 'pago' } })
    ) || 0;
    const unpaidSupplier = Math.max(0, totalDebt - totalPaid);

    const supplierAging = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };

    if (unpaidSupplier > 0 && totalDebt > 0) {
      const ratio = unpaidSupplier / totalDebt;
      for (const m of supplierMovements) {
        const diffDays = Math.floor((today - new Date(m.date)) / (1000 * 60 * 60 * 24));
        const amt = parseFloat(m.amount) * ratio;
        if (diffDays <= 30) supplierAging['0_30'] += amt;
        else if (diffDays <= 60) supplierAging['31_60'] += amt;
        else if (diffDays <= 90) supplierAging['61_90'] += amt;
        else supplierAging['90_plus'] += amt;
      }
    }

    const customerAging = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };

    const allSales = await Sale.findAll({
      where: { customer_id: { [Op.ne]: null } },
      attributes: ['total', 'date', 'customer_id'],
      raw: true,
    });

    const totalCustomerSales = allSales.reduce((s, sa) => s + parseFloat(sa.total || 0), 0);

    if (totalReceivable > 0 && totalCustomerSales > 0) {
      const ratio = totalReceivable / totalCustomerSales;
      for (const sa of allSales) {
        const diffDays = Math.floor((today - new Date(sa.date)) / (1000 * 60 * 60 * 24));
        const amt = parseFloat(sa.total) * ratio;
        if (diffDays <= 30) customerAging['0_30'] += amt;
        else if (diffDays <= 60) customerAging['31_60'] += amt;
        else if (diffDays <= 90) customerAging['61_90'] += amt;
        else customerAging['90_plus'] += amt;
      }
    }

    return {
      total_receivable: Math.round(totalReceivable * 100) / 100,
      aging: customerAging,
      total_payable: Math.round(totalPayable * 100) / 100,
      supplier_aging: supplierAging,
    };
  }

  async listCustomers(filters = {}, empresaId = 1) {
    const where = { empresa_id: empresaId };
    const { search, active, limit, offset } = filters;

    if (active !== undefined) where.is_active = active === 'true' || active === true;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { tax_id: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const pageLimit = parseInt(limit) || 50;
    const pageOffset = parseInt(offset) || 0;

    const { count, rows } = await Customer.findAndCountAll({
      where,
      order: [['name', 'ASC']],
      limit: pageLimit,
      offset: pageOffset,
    });

    const enriched = await Promise.all(
      rows.map(async (c) => {
        const totalSales = parseFloat(
          await Sale.sum('total', { where: { customer_id: c.id } })
        ) || 0;
        const visitCount = await Sale.count({ where: { customer_id: c.id } });
        const lastSale = await Sale.findOne({
          where: { customer_id: c.id },
          order: [['date', 'DESC']],
        });
        const balance = await this.calculateBalance(c.id);

        return {
          ...c.toJSON(),
          total_purchases: totalSales,
          total_visits: visitCount,
          last_purchase: lastSale ? lastSale.date : null,
          balance,
        };
      })
    );

    return { data: enriched, total: count };
  }
}

module.exports = new CustomerService();
