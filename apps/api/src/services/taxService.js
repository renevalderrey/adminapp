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
  /**
   * La configuracion impositiva de esa empresa, creandola con los valores por
   * defecto la primera vez.
   *
   * ⚠ `findOrCreate` y NO `findOne` + `create`.
   *
   * Con los dos pasos separados, dos pedidos que llegan juntos hacen los dos el
   * `findOne`, los dos no encuentran nada, y los dos intentan crear: el segundo
   * choca con el UNIQUE de `(tax_type, empresa_id)` y el endpoint responde
   * **500**. Es un GET —una LECTURA— devolviendo un error de servidor.
   *
   * No es hipotetico: se vio en las pruebas de navegador, la primera vez que se
   * abrio `/impuestos` contra una base limpia. El `useEffect` en desarrollo
   * corre dos veces y alcanzo para reproducirlo. En produccion alcanza con dos
   * pestañas, o con un doble clic en el menu.
   *
   * `updateConfig`, dos funciones mas abajo, ya usaba `findOrCreate` — la
   * correccion estaba escrita al lado del defecto.
   */
  async getConfig(taxType, empresaId) {
    const porDefecto = taxType === 'monotributo'
      ? { scales: DEFAULT_MONOTRIBUTO_SCALES }
      : { rate: 0 };

    const [config] = await TaxConfig.findOrCreate({
      where: { tax_type: taxType, empresa_id: empresaId },
      defaults: { tax_type: taxType, empresa_id: empresaId, config: porDefecto },
    });

    return config;
  }

  async updateConfig(taxType, configData, empresaId) {
    const [config, created] = await TaxConfig.findOrCreate({
      where: { tax_type: taxType, empresa_id: empresaId },
      defaults: { config: configData, empresa_id: empresaId },
    });
    if (!created) {
      await config.update({ config: configData });
    }
    return config;
  }

  async calculateMonotributo(year, empresaId) {
    const targetYear = year || new Date().getFullYear();
    const startDate = `${targetYear}-01-01`;
    const endDate = `${targetYear}-12-31`;

    // ── Qué cuenta como facturación para el monotributo ──
    //
    // La categoría depende de los ingresos declarados ante ARCA, y ante ARCA
    // existe lo que tiene CAE. Dos consecuencias, las dos deliberadas:
    //
    //  - Una venta SIN CAE no entra. No fue facturada, así que no está en la
    //    base imponible. (Que exista o no ese caso es decisión del comercio;
    //    el sistema refleja lo que efectivamente se emitió.)
    //
    //  - Una venta anulada internamente PERO con CAE sí entra. Anular en la
    //    app no da de baja el comprobante: para eso hace falta una nota de
    //    crédito, que el sistema todavía no emite. Mientras el CAE exista,
    //    ARCA lo ve.
    //
    // La versión anterior filtraba por status='active' e ignoraba el CAE, con
    // lo cual sumaba ventas nunca facturadas y descontaba comprobantes que
    // ARCA sigue contando. Podía llevar a declarar de menos.
    const facturadoAnte = parseFloat(
      await Sale.sum('total', {
        where: {
          empresa_id: empresaId,
          afip_cae: { [Op.ne]: null },
          date: { [Op.between]: [startDate, endDate] },
        },
      })
    ) || 0;

    const annualBilling = facturadoAnte;

    // Facturación total del negocio, con y sin comprobante. No define la
    // categoría, pero se devuelve para que el usuario vea la diferencia entre
    // lo que vendió y lo que declaró.
    const ventasTotales = parseFloat(
      await Sale.sum('total', {
        where: {
          empresa_id: empresaId,
          status: 'active',
          date: { [Op.between]: [startDate, endDate] },
        },
      })
    ) || 0;

    // Comprobantes con CAE que se anularon en la app y siguen vigentes ante
    // ARCA porque nunca se les emitió nota de crédito.
    const anuladasConCae = parseFloat(
      await Sale.sum('total', {
        where: {
          empresa_id: empresaId,
          status: 'voided',
          afip_cae: { [Op.ne]: null },
          date: { [Op.between]: [startDate, endDate] },
        },
      })
    ) || 0;

    // Faltaba empresaId. Al quitarse el default `empresaId = 1` en la auditoría
    // de aislamiento, esta llamada quedó pasando undefined, y Sequelize rechaza
    // un where con undefined: el endpoint devolvía 500.
    const config = await this.getConfig('monotributo', empresaId);
    const scales = config.config.scales || DEFAULT_MONOTRIBUTO_SCALES;

    // Las escalas se recorren de menor a mayor, así que se ordenan por las
    // dudas: vienen de una config editable por el usuario y nada garantiza el
    // orden. Sin esto, una lista desordenada asigna una categoría equivocada.
    const escalasOrdenadas = [...scales].sort((a, b) => a.max_income - b.max_income);

    let category = escalasOrdenadas.find((s) => annualBilling <= s.max_income);

    // Si supera la última escala, se toma la más alta disponible.
    if (!category) {
      category = escalasOrdenadas[escalasOrdenadas.length - 1];
    }

    // Los pagos de impuestos de otra empresa no pueden descontarse de la deuda
    // de esta. Sin el filtro, el usuario veía una deuda menor a la real.
    const paymentsThisYear = parseFloat(
      await TaxPayment.sum('amount', {
        where: {
          empresa_id: empresaId,
          tax_type: 'monotributo',
          payment_date: { [Op.between]: [startDate, endDate] },
        },
      })
    ) || 0;

    const annualTotal = category.monthly * 12;
    const remaining = Math.max(0, annualTotal - paymentsThisYear);

    const redondear = (n) => Math.round(n * 100) / 100;

    // La categoría se calcula sobre lo facturado con CAE, pero se devuelven las
    // tres cifras para que el usuario entienda de dónde sale el número. Si
    // factura una fracción de lo que vende, la diferencia es visible en vez de
    // estar escondida en el cálculo.
    return {
      annual_billing: redondear(annualBilling),
      facturado_con_cae: redondear(facturadoAnte),
      ventas_totales: redondear(ventasTotales),
      sin_facturar: redondear(Math.max(0, ventasTotales - facturadoAnte)),

      // Comprobantes anulados en la app que ARCA sigue contando porque nunca
      // se les emitió nota de crédito. La UI debería mostrarlo como pendiente.
      anuladas_con_cae_sin_nc: redondear(anuladasConCae),

      category: category.category,
      monthly_amount: category.monthly,
      annual_total: redondear(annualTotal),
      paid_ytd: redondear(paymentsThisYear),
      remaining_ytd: redondear(remaining),
    };
  }

  async registerPayment(data, empresaId) {
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

  async getPayments(filters = {}, empresaId) {
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
