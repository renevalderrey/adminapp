const { Op } = require('sequelize');
const { assertEmpresaId } = require('../utils/tenantScope');
const { hoyDelNegocio } = require('../utils/fechas');
const {
  CashFlowEntry,
  Sale,
  CustomerPayment,
  FixedExpense,
  SupplierMovement,
  TaxPayment,
  sequelize,
} = require('../models');

const MILISEGUNDOS_POR_DIA = 1000 * 60 * 60 * 24;

/**
 * La fecha `dias` antes de `fechaISO`, en formato YYYY-MM-DD.
 *
 * La cuenta se hace en UTC sobre el texto a propósito, igual que en
 * `dashboardService`: la zona horaria ya la resolvió `hoyDelNegocio` una sola
 * vez, y volver a pasar por la zona local del servidor para restar treinta días
 * es la forma de reintroducir el defecto que este corte cierra.
 */
function restarDias(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00Z`);

  return new Date(fecha.getTime() - dias * MILISEGUNDOS_POR_DIA).toISOString().split('T')[0];
}

class CashflowService {
  /**
   * El saldo de caja y la proyección a 30 y 60 días.
   *
   * @param {number} empresaId
   * @param {number|null} [puntoDeVentaId]
   * @param {object} [opciones]
   * @param {string} [opciones.hoy] La fecha del negocio, YYYY-MM-DD. La pasa el
   *   Panel —que ya la resolvió para sus propios cortes— para que la proyección
   *   mida el mismo período que las tarjetas que tiene al lado. Si no viene, se
   *   resuelve acá.
   */
  async getBalance(empresaId, puntoDeVentaId = null, opciones = {}) {
    // ── El corte de los 30 días es el del NEGOCIO, no el del servidor ──
    //
    // Era `new Date(Date.now() - 30 días).toISOString()`, o sea la fecha del
    // servidor en UTC. Argentina es UTC−3: a las 23:25 hora local UTC ya está en
    // el día siguiente, así que la ventana de la proyección arrancaba un día
    // después que la del resto del Panel. La misma pantalla mostraba dos
    // períodos distintos sin decirlo. Es el defecto que `dashboardService` cerró
    // para sus cortes (FR-048) y este archivo se había quedado afuera.
    const hoy = opciones.hoy || (await hoyDelNegocio(empresaId));
    const hace30Dias = restarDias(hoy, 30);

    const scope = { empresa_id: empresaId };
    if (puntoDeVentaId) scope.punto_de_venta_id = puntoDeVentaId;

    // Las ventas anuladas no ingresaron plata a la caja.
    const totalSales = parseFloat(
      await Sale.sum('total', { where: { ...scope, status: 'active' } })
    ) || 0;
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

    // ── Egresos ──
    //
    // Se suman SOLO los pagos hechos, no las deudas contraidas. Antes se
    // restaban las dos: recibir mercaderia genera un SupplierMovement de tipo
    // 'deuda', y pagarla genera uno de tipo 'pago'. Contar ambos descontaba
    // cada compra a credito dos veces del saldo de caja.
    //
    // Una deuda no es plata que salio: es plata que va a salir. Pertenece a
    // "cuentas por pagar", no al saldo de caja.
    const allOutflows = totalExpenses + totalSupplierPayments + totalTaxPayments + manualOutflows;

    // ── Ingresos ──
    //
    // El saldo es BASE EFECTIVO: cuenta la plata que efectivamente entro, no
    // lo facturado.
    //
    // Antes se sumaban todas las ventas MAS todas las cobranzas de clientes.
    // Una venta a cuenta corriente entra dos veces: al facturarse (como venta)
    // y al cobrarse (como cobranza). El saldo quedaba inflado por el total de
    // lo cobrado en cuenta corriente.
    //
    // Ahora las ventas a credito se excluyen de las ventas y entran recien
    // cuando se cobran, via CustomerPayment. La columna is_credit permite
    // separarlas; antes no habia forma de distinguirlas.
    const ventasContado = parseFloat(
      await Sale.sum('total', { where: { ...scope, status: 'active', is_credit: false } })
    ) || 0;

    const allInflows = ventasContado + totalCustomerPayments + manualInflows;

    const balance = allInflows - allOutflows;

    const sales30d = parseFloat(
      await Sale.sum('total', { where: { ...scope, status: 'active', is_credit: false, date: { [Op.gte]: hace30Dias } } })
    ) || 0;

    const customerPayments30d = parseFloat(
      await CustomerPayment.sum('amount', { where: { empresa_id: empresaId, payment_date: { [Op.gte]: hace30Dias } } })
    ) || 0;

    // OJO: los gastos fijos no tienen columna de fecha en el modelo, asi que
    // "30d" es en realidad el total de gastos fijos mensuales configurados.
    // El nombre inducia a pensar que estaba filtrado por periodo.
    const gastosFijosMensuales = parseFloat(
      await FixedExpense.sum('amount', { where: { empresa_id: empresaId } })
    ) || 0;

    const monthlyTaxPayments = parseFloat(
      await TaxPayment.sum('amount', { where: { empresa_id: empresaId, payment_date: { [Op.gte]: hace30Dias } } })
    ) || 0;

    // Lo que efectivamente entro y salio en los ultimos 30 dias.
    const ingresosReales30d = sales30d + customerPayments30d;
    const egresosReales30d = gastosFijosMensuales + monthlyTaxPayments;

    // La proyeccion asume que el proximo mes se repite el anterior con un 10%
    // de crecimiento. Ese 1.1 estaba hardcodeado y sin explicar, y ademas se
    // devolvia en el campo total_inflows_30d, que la pantalla rotula
    // "Entradas 30d": el usuario leia como dato historico un numero inventado
    // un 10% por encima de la realidad.
    //
    // Ahora los reales y la proyeccion son campos distintos.
    const FACTOR_CRECIMIENTO = 1.1;
    const proyeccionIngresos30d = ingresosReales30d * FACTOR_CRECIMIENTO;

    const projected30d = balance + proyeccionIngresos30d - egresosReales30d;
    const projected60d = projected30d + proyeccionIngresos30d - egresosReales30d;

    const redondear = (n) => Math.round(n * 100) / 100;

    return {
      balance: redondear(balance),

      // Historico real de los ultimos 30 dias.
      total_inflows_30d: redondear(ingresosReales30d),
      total_outflows_30d: redondear(egresosReales30d),

      // Proyeccion, con el supuesto explicito.
      projected_30d: redondear(projected30d),
      projected_60d: redondear(projected60d),
      supuesto_crecimiento: FACTOR_CRECIMIENTO,

      // Componentes del saldo, para que el numero sea auditable desde la UI.
      // Ver la nota de arriba sobre el solapamiento entre ventas y cobranzas.
      detalle: {
        // Base efectivo: solo las ventas cobradas en el momento. Las de cuenta
        // corriente entran en cobranzas_clientes cuando se cobran.
        ventas_contado: redondear(ventasContado),
        ventas_a_credito_facturadas: redondear(totalSales - ventasContado),
        cobranzas_clientes: redondear(totalCustomerPayments),
        ingresos_manuales: redondear(manualInflows),
        gastos_fijos: redondear(totalExpenses),
        pagos_proveedores: redondear(totalSupplierPayments),
        pagos_impuestos: redondear(totalTaxPayments),
        egresos_manuales: redondear(manualOutflows),
        deuda_proveedores_pendiente: redondear(totalSupplierDebts - totalSupplierPayments),
      },
    };
  }

  async getMovements(filters = {}, empresaId, puntoDeVentaId = null) {
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

  async createEntry(data, empresaId, puntoDeVentaId = null) {
    if (!data.amount || parseFloat(data.amount) <= 0) {
      throw new Error('El monto debe ser mayor a 0');
    }
    return await CashFlowEntry.create({
      type: data.type,
      category: data.category || 'otro',
      amount: data.amount,
      // La fecha del NEGOCIO, por el mismo motivo que en `customerService`: un
      // movimiento cargado a las 22:00 en Argentina quedaba fechado mañana, y la
      // proyección —que desde este mismo hito corta con `hoyDelNegocio`— lo
      // dejaba afuera del período que lo tenía que contener.
      entry_date: data.entry_date || (await hoyDelNegocio(empresaId)),
      description: data.description || null,
      reference: data.reference || null,
      is_recurring: data.is_recurring || false,
      recurring_frequency: data.recurring_frequency || null,
      empresa_id: empresaId,
      punto_de_venta_id: puntoDeVentaId,
    });
  }

  async deleteEntry(id, empresaId) {
    assertEmpresaId(empresaId);

    const entry = await CashFlowEntry.findOne({
      where: { id, empresa_id: empresaId },
    });
    if (!entry) throw new Error('Movimiento no encontrado');
    await entry.destroy();
    return true;
  }

  async getAllMovementsUnified(filters = {}, empresaId, puntoDeVentaId = null) {
    const { date_from, date_to, limit } = filters;
    const pageLimit = parseInt(limit) || 100;

    const from = date_from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = date_to || new Date().toISOString().split('T')[0];

    const scope = { empresa_id: empresaId };
    if (puntoDeVentaId) scope.punto_de_venta_id = puntoDeVentaId;

    const movements = [];

    const salesScope = { ...scope, status: 'active', date: { [Op.between]: [from, to] } };
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
