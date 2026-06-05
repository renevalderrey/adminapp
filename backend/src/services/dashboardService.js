const { Op, fn, col, literal, and: OpAnd } = require('sequelize');
const {
  Sale,
  SaleItem,
  Product,
  Stock,
  Customer,
  CustomerPayment,
  SupplierMovement,
  FixedExpense,
  sequelize,
} = require('../models');
const cashflowService = require('./cashflowService');

class DashboardService {
  async getKpis(empresaId = 1) {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];

    const [
      sales30d,
      salesCurrentMonth,
      salesPrevMonth,
      salesByMethod,
      cashflow,
      customersStats,
      receivables,
      payables,
      productsStats,
      fixedExpensesTotal,
      lowStockAlerts,
      expiringAlerts,
    ] = await Promise.all([
      this._salesPeriod(thirtyDaysAgo, today, empresaId),
      this._salesPeriod(firstOfMonth, today, empresaId),
      this._salesPeriod(firstOfPrevMonth, firstOfMonth, empresaId),
      this._salesByMethod(thirtyDaysAgo, today, empresaId),
      cashflowService.getBalance(empresaId),
      this._customerStats(empresaId),
      this._receivables(thirtyDaysAgo, empresaId),
      this._payables(empresaId),
      this._productStats(empresaId),
      FixedExpense.sum('amount', { where: { empresa_id: empresaId } }) || 0,
      this._lowStockAlerts(5, empresaId),
      this._expiringAlerts(today, 5, empresaId),
    ]);

    return {
      sales_30d: {
        total: sales30d.total,
        count: sales30d.count,
        avg_ticket: sales30d.count > 0 ? Math.round(sales30d.total / sales30d.count) : 0,
        by_method: salesByMethod,
      },
      sales_current_month: {
        total: salesCurrentMonth.total,
        count: salesCurrentMonth.count,
      },
      sales_previous_month: {
        total: salesPrevMonth.total,
        count: salesPrevMonth.count,
      },
      cashflow: {
        balance: cashflow.balance,
        projected_30d: cashflow.projected_30d,
        projected_60d: cashflow.projected_60d,
      },
      customers: customersStats,
      receivables,
      payables,
      products: productsStats,
      fixed_expenses: Math.round(parseFloat(fixedExpensesTotal || 0) * 100) / 100,
      alerts: {
        low_stock: lowStockAlerts,
        expiring: expiringAlerts,
      },
    };
  }

  async _salesPeriod(from, to, empresaId = 1) {
    const result = await Sale.findOne({
      attributes: [
        [fn('COALESCE', fn('SUM', col('total')), 0), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { empresa_id: empresaId, date: { [Op.between]: [from, to] } },
      raw: true,
    });
    return {
      total: Math.round(parseFloat(result.total) * 100) / 100,
      count: parseInt(result.count) || 0,
    };
  }

  async _salesByMethod(from, to, empresaId = 1) {
    const rows = await Sale.findAll({
      attributes: [
        'payment_method',
        [fn('SUM', col('total')), 'total'],
      ],
      where: { empresa_id: empresaId, date: { [Op.between]: [from, to] } },
      group: ['payment_method'],
      raw: true,
    });
    const byMethod = {};
    for (const r of rows) {
      byMethod[r.payment_method] = Math.round(parseFloat(r.total) * 100) / 100;
    }
    return byMethod;
  }

  async _customerStats(empresaId = 1) {
    const totalActive = await Customer.count({ where: { is_active: true, empresa_id: empresaId } });

    const customersWithBalance = await Customer.findAll({
      attributes: ['id', 'name'],
      include: [
        {
          model: Sale,
          as: 'sales',
          attributes: [],
          required: true,
        },
      ],
      where: { is_active: true, empresa_id: empresaId },
      raw: true,
    });
    const customerIds = [...new Set(customersWithBalance.map(c => c.id))];

    let withDebt = 0;
    for (const id of customerIds) {
      const salesTotal = await Sale.sum('total', { where: { customer_id: id } }) || 0;
      const paymentsTotal = await CustomerPayment.sum('amount', { where: { customer_id: id } }) || 0;
      if (parseFloat(salesTotal) > parseFloat(paymentsTotal)) {
        withDebt++;
      }
    }

    return {
      active: totalActive,
      with_debt: withDebt,
    };
  }

  async _receivables(thirtyDaysAgo, empresaId = 1) {
    const thirtyDaysAgoDate = thirtyDaysAgo;
    const now = new Date().toISOString().split('T')[0];
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const totalReceivables = await Sale.sum('total', {
      where: { empresa_id: empresaId, customer_id: { [Op.ne]: null } },
    }) || 0;
    const totalPayments = await CustomerPayment.sum('amount', {
      where: { empresa_id: empresaId },
    }) || 0;
    const total = Math.max(0, parseFloat(totalReceivables) - parseFloat(totalPayments));

    const bucket0_30 = await Sale.sum('total', {
      where: { empresa_id: empresaId, customer_id: { [Op.ne]: null }, date: { [Op.between]: [thirtyDaysAgoDate, now] } },
    }) || 0;

    const bucket31_60 = await Sale.sum('total', {
      where: { empresa_id: empresaId, customer_id: { [Op.ne]: null }, date: { [Op.between]: [sixtyDaysAgo, thirtyDaysAgoDate] } },
    }) || 0;

    const bucket61_90 = await Sale.sum('total', {
      where: { empresa_id: empresaId, customer_id: { [Op.ne]: null }, date: { [Op.between]: [ninetyDaysAgo, sixtyDaysAgo] } },
    }) || 0;

    const bucket90plus = await Sale.sum('total', {
      where: { empresa_id: empresaId, customer_id: { [Op.ne]: null }, date: { [Op.lt]: ninetyDaysAgo } },
    }) || 0;

    return {
      total: Math.round(total * 100) / 100,
      aging: {
        '0_30': Math.round(parseFloat(bucket0_30) * 100) / 100,
        '31_60': Math.round(parseFloat(bucket31_60) * 100) / 100,
        '61_90': Math.round(parseFloat(bucket61_90) * 100) / 100,
        '90_plus': Math.round(parseFloat(bucket90plus) * 100) / 100,
      },
    };
  }

  async _payables(empresaId = 1) {
    const debts = await SupplierMovement.findAll({
      where: { empresa_id: empresaId, type: 'deuda' },
      attributes: [
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'],
        'due_date',
      ],
      group: ['due_date'],
      raw: true,
    });

    const now = new Date().toISOString().split('T')[0];
    const thirtyFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sixtyFromNow = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const ninetyFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let totalPayable = 0;
    for (const d of debts) totalPayable += parseFloat(d.total);

    const aging = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };

    for (const d of debts) {
      const amt = parseFloat(d.total);
      if (!d.due_date) {
        aging['90_plus'] += amt;
        continue;
      }
      if (d.due_date <= thirtyFromNow) aging['0_30'] += amt;
      else if (d.due_date <= sixtyFromNow) aging['31_60'] += amt;
      else if (d.due_date <= ninetyFromNow) aging['61_90'] += amt;
      else aging['90_plus'] += amt;
    }

    return {
      total: Math.round(totalPayable * 100) / 100,
      aging: {
        '0_30': Math.round(aging['0_30'] * 100) / 100,
        '31_60': Math.round(aging['31_60'] * 100) / 100,
        '61_90': Math.round(aging['61_90'] * 100) / 100,
        '90_plus': Math.round(aging['90_plus'] * 100) / 100,
      },
    };
  }

  async _productStats(empresaId = 1) {
    const active = await Product.count({ where: { is_active: true, empresa_id: empresaId } });

    const lowStockRows = await Stock.findAll({
      where: {
        [Op.and]: [
          { empresa_id: empresaId },
          literal('quantity <= min_stock AND min_stock > 0'),
        ],
      },
      attributes: [
        [fn('COUNT', col('Stock.id')), 'count'],
      ],
      raw: true,
    });
    const lowStock = parseInt(lowStockRows[0]?.count) || 0;

    return { active, low_stock: lowStock };
  }

  async _lowStockAlerts(limit = 5, empresaId = 1) {
    const rows = await Stock.findAll({
      where: {
        [Op.and]: [
          { empresa_id: empresaId },
          literal('quantity <= min_stock AND min_stock > 0'),
        ],
      },
      include: [{ model: Product, as: 'product', attributes: ['name'] }],
      limit,
      order: [['quantity', 'ASC']],
    });
    return rows.map(r => ({
      id: r.id,
      product_name: r.product?.name || 'Unknown',
      location: r.location,
      punto_de_venta_id: r.punto_de_venta_id,
      quantity: r.quantity,
      min_stock: r.min_stock,
    }));
  }

  async _expiringAlerts(today, limit = 5, empresaId = 1) {
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const rows = await Stock.findAll({
      where: {
        empresa_id: empresaId,
        expiration_date: { [Op.between]: [today, thirtyDaysFromNow] },
      },
      include: [{ model: Product, as: 'product', attributes: ['name'] }],
      limit,
      order: [['expiration_date', 'ASC']],
    });
    return rows.map(r => ({
      id: r.id,
      product_name: r.product?.name || 'Unknown',
      location: r.location,
      punto_de_venta_id: r.punto_de_venta_id,
      expiration_date: r.expiration_date,
    }));
  }
}

module.exports = new DashboardService();
