const { Op } = require('sequelize');
const { TaxConfig, TaxPayment, Sale, sequelize } = require('../models');

const DEFAULT_MONOTRIBUTO_SCALES = [
  { category: 'A', max_income: 6454115.09, monthly: 13257.79 },
  { category: 'B', max_income: 9590471.60, monthly: 14800.84 },
  { category: 'C', max_income: 13426718.17, monthly: 17279.66 },
  { category: 'D', max_income: 18684336.42, monthly: 32647.90 },
  { category: 'E', max_income: 26340587.63, monthly: 41705.74 },
  { category: 'F', max_income: 32969115.09, monthly: 51974.90 },
  { category: 'G', max_income: 39562932.71, monthly: 60734.00 },
  { category: 'H', max_income: 52977246.30, monthly: 99242.52 },
];

class TaxService {
  async getConfig(taxType, empresaId = 1) {
    let config = await TaxConfig.findOne({ where: { tax_type: taxType, empresa_id: empresaId } });
    if (!config) {
      if (taxType === 'monotributo') {
        config = await TaxConfig.create({
          tax_type: 'monotributo',
          empresa_id: empresaId,
          config: { scales: DEFAULT_MONOTRIBUTO_SCALES },
        });
      } else {
        config = await TaxConfig.create({
          tax_type: taxType,
          empresa_id: empresaId,
          config: { rate: 0 },
        });
      }
    }
    return config;
  }

  async updateConfig(taxType, configData, empresaId = 1) {
    const [config, created] = await TaxConfig.findOrCreate({
      where: { tax_type: taxType, empresa_id: empresaId },
      defaults: { config: configData, empresa_id: empresaId },
    });
    if (!created) {
      await config.update({ config: configData });
    }
    return config;
  }

  async calculateMonotributo(year, empresaId = 1) {
    const targetYear = year || new Date().getFullYear();
    const startDate = `${targetYear}-01-01`;
    const endDate = `${targetYear}-12-31`;

    const annualBilling = parseFloat(
      await Sale.sum('total', {
        where: { empresa_id: empresaId, date: { [Op.between]: [startDate, endDate] } },
      })
    ) || 0;

    const config = await this.getConfig('monotributo');
    const scales = config.config.scales || DEFAULT_MONOTRIBUTO_SCALES;

    let category = null;
    for (const s of scales) {
      if (annualBilling <= s.max_income) {
        category = s;
        break;
      }
    }

    if (!category) {
      category = scales[scales.length - 1];
    }

    const paymentsThisYear = parseFloat(
      await TaxPayment.sum('amount', {
        where: {
          tax_type: 'monotributo',
          payment_date: { [Op.between]: [startDate, endDate] },
        },
      })
    ) || 0;

    const annualTotal = category.monthly * 12;
    const remaining = Math.max(0, annualTotal - paymentsThisYear);

    return {
      annual_billing: Math.round(annualBilling * 100) / 100,
      category: category.category,
      monthly_amount: category.monthly,
      annual_total: Math.round(annualTotal * 100) / 100,
      paid_ytd: Math.round(paymentsThisYear * 100) / 100,
      remaining_ytd: Math.round(remaining * 100) / 100,
    };
  }

  async registerPayment(data, empresaId = 1) {
    return await TaxPayment.create({
      tax_type: data.tax_type,
      empresa_id: empresaId,
      amount: data.amount,
      payment_date: data.payment_date || new Date().toISOString().split('T')[0],
      period_from: data.period_from || null,
      period_to: data.period_to || null,
      notes: data.notes || null,
    });
  }

  async getPayments(filters = {}, empresaId = 1) {
    const where = { empresa_id: empresaId };
    const { tax_type, date_from, date_to } = filters;
    if (tax_type) where.tax_type = tax_type;
    if (date_from || date_to) {
      where.payment_date = {};
      if (date_from) where.payment_date[Op.gte] = date_from;
      if (date_to) where.payment_date[Op.lte] = date_to;
    }
    return await TaxPayment.findAll({
      where,
      order: [['payment_date', 'DESC']],
    });
  }
}

module.exports = new TaxService();
