const { Op, fn, literal, QueryTypes } = require('sequelize');
const {
  Customer,
  CustomerPayment,
  Sale,
  SupplierMovement,
  sequelize,
} = require('../models');
const { assertEmpresaId } = require('../utils/tenantScope');
// ── La fecha de referencia del aging es la del NEGOCIO ──
//
// Los dos aging de este archivo cortaban con `new Date()`: un instante, en la
// zona del servidor. El Panel corta con `hoyDelNegocio`, asi que entre las 21:00
// y las 24:00 hora argentina el MISMO saldo caia en «0 a 30» alla y en «31 a 60»
// aca. Un cliente que aparece en un tramo distinto segun donde se lo mire no
// tiene tramo, y es exactamente el defecto que el hito vino a cerrar —«los
// numeros del Panel son los mismos que muestran las pantallas que los
// detallan»— sobreviviendo en la pantalla del otro lado (FR-048).
const { hoyDelNegocio } = require('../utils/fechas');
// El reparto por antiguedad vivia aca como metodo privado con DOS consumidores
// internos. El Panel de control es el tercero, y mientras la funcion estuvo
// escondida en este servicio el Panel escribio su propio aging: los cuatro
// tramos sumando lo facturado mientras el total de arriba sumaba lo impago.
const { repartirPorAntiguedad } = require('../utils/antiguedad');

// Todos los metodos publicos reciben empresaId de forma obligatoria.
// Antes varios tenian `empresaId = 1` como default y otros directamente no
// filtraban: getSummary agregaba los totales financieros de TODAS las empresas
// cliente y se los mostraba a cualquier usuario.

class CustomerService {
  /** Busca un cliente restringido a la empresa. null si es de otra. */
  async _findCustomer(customerId, empresaId) {
    assertEmpresaId(empresaId);

    const id = parseInt(customerId, 10);
    if (!Number.isInteger(id)) return null;

    return Customer.findOne({ where: { id, empresa_id: empresaId } });
  }

  async getCustomerDetail(customerId, empresaId) {
    const customer = await this._findCustomer(customerId, empresaId);
    if (!customer) return null;

    const balance = await this.calculateBalance(customer.id, empresaId);
    const aging = await this.calculateAging(customer.id, empresaId);

    const recentSales = await Sale.findAll({
      where: { customer_id: customer.id, empresa_id: empresaId },
      order: [['date', 'DESC']],
      limit: 20,
    });

    const recentPayments = await CustomerPayment.findAll({
      where: { customer_id: customer.id, empresa_id: empresaId },
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

  async calculateBalance(customerId, empresaId) {
    assertEmpresaId(empresaId);

    const where = { customer_id: customerId, empresa_id: empresaId };

    // Una venta anulada no genera deuda. Sin el filtro por status se le
    // reclamaba al cliente plata por operaciones dadas de baja.
    // Solo las ventas a cuenta corriente generan deuda. Una venta cobrada en
    // el mostrador no es un saldo pendiente aunque tenga cliente asignado.
    const totalSales = await Sale.sum('total', {
      where: { ...where, status: 'active', is_credit: true },
    });
    const totalPayments = await CustomerPayment.sum('amount', { where });

    return (parseFloat(totalSales) || 0) - (parseFloat(totalPayments) || 0);
  }

  /**
   * El saldo del cliente repartido por antiguedad.
   *
   * @param {number} customerId
   * @param {number} empresaId
   * @param {string} [hoy] La fecha del negocio, YYYY-MM-DD. Se puede pasar ya
   *   resuelta para que todos los cortes de un mismo request usen la misma; si
   *   no viene, se resuelve aca.
   */
  async calculateAging(customerId, empresaId, hoy = null) {
    assertEmpresaId(empresaId);

    const buckets = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
    const where = { customer_id: customerId, empresa_id: empresaId };

    // Mismo criterio que calculateBalance: las anuladas no son deuda.
    const sales = await Sale.findAll({
      where: { ...where, status: 'active', is_credit: true },
      attributes: ['total', 'date'],
      raw: true,
    });

    const totalPayments = parseFloat(
      await CustomerPayment.sum('amount', { where })
    ) || 0;

    const totalSalesAmount = sales.reduce((sum, s) => sum + parseFloat(s.total || 0), 0);
    const unpaid = totalSalesAmount - totalPayments;

    // Guard contra division por cero: un cliente sin ventas daba NaN en cada
    // bucket, que serializado a JSON sale como null.
    if (unpaid <= 0 || totalSalesAmount <= 0) return buckets;

    // La consulta a la empresa va DESPUES del guard: un cliente sin deuda
    // devuelve los cuatro tramos en cero sin necesidad de saber en que dia esta
    // parado el negocio, y esa es la mayoria de los clientes.
    const referencia = hoy || (await hoyDelNegocio(empresaId));

    return repartirPorAntiguedad(sales, referencia, {
      saldoImpago: unpaid,
      totalFacturado: totalSalesAmount,
      fecha: 'date',
      importe: 'total',
    });
  }

  async getRanking(limit = 20, empresaId) {
    assertEmpresaId(empresaId);

    const pageLimit = parseInt(limit, 10) || 20;

    // Las subconsultas usan bind params (:empresaId) en lugar de interpolacion
    // de string. El valor viene de la base y no del cliente, pero interpolar en
    // SQL crudo es un patron que tarde o temprano se copia a un lugar donde el
    // valor si viene del cliente.
    const customers = await Customer.findAll({
      where: { is_active: true, empresa_id: empresaId },
      attributes: [
        'id', 'name', 'tax_id', 'email', 'phone',
        [fn('COALESCE', literal(
          `(SELECT SUM(CAST(total AS DECIMAL)) FROM sales
             WHERE sales.customer_id = "Customer".id
               AND sales.status = 'active'
               AND sales.empresa_id = :empresaId)`
        ), 0), 'total_purchases'],
        [fn('COALESCE', literal(
          `(SELECT COUNT(*) FROM sales
             WHERE sales.customer_id = "Customer".id
               AND sales.status = 'active'
               AND sales.empresa_id = :empresaId)`
        ), 0), 'visit_count'],
        [fn('COALESCE', literal(
          `(SELECT MAX(date) FROM sales
             WHERE sales.customer_id = "Customer".id
               AND sales.status = 'active'
               AND sales.empresa_id = :empresaId)`
        ), null), 'last_purchase'],
      ],
      replacements: { empresaId },
      order: [[literal('total_purchases'), 'DESC']],
      limit: pageLimit,
    });

    return customers.map((c) => {
      const data = c.toJSON();
      return {
        ...data,
        total_purchases: parseFloat(data.total_purchases) || 0,
        visit_count: parseInt(data.visit_count, 10) || 0,
      };
    });
  }

  async registerPayment(customerId, data, empresaId) {
    const customer = await this._findCustomer(customerId, empresaId);

    if (!customer) {
      const err = new Error('Cliente no encontrado');
      err.status = 404;
      throw err;
    }

    return CustomerPayment.create({
      customer_id: customer.id,
      empresa_id: empresaId,
      amount: data.amount,
      // La fecha del NEGOCIO, no la del servidor.
      //
      // `new Date().toISOString()` pasa por UTC: una cobranza cargada a las
      // 22:00 en Argentina quedaba fechada MAÑANA. En un pago eso no es solo
      // cosmético — la fila entra al aging con fecha futura, y el corte de mes
      // la cuenta en el mes que no es.
      //
      // Molesta más desde que el aging corta con `hoyDelNegocio`: la fecha con
      // la que se compara pasó a ser la del negocio y la que se guardaba seguía
      // siendo la del servidor, así que las dos puntas medían con relojes
      // distintos.
      payment_date: data.payment_date || (await hoyDelNegocio(empresaId)),
      payment_method: data.payment_method || 'ef',
      reference: data.reference || null,
      notes: data.notes || null,
    });
  }

  /**
   * Totales de cuentas por cobrar y por pagar de UNA empresa.
   *
   * La version anterior corria SQL crudo sin ninguna clausula de empresa:
   * sumaba las ventas, los pagos y los movimientos de proveedores de todas las
   * empresas cliente de la base y devolvia el total a cualquier usuario que
   * abriera la pantalla de clientes. No hacia falta enumerar ids para verlo.
   */
  async getSummary(empresaId) {
    assertEmpresaId(empresaId);

    const [receivableRow] = await sequelize.query(
      `SELECT
         COALESCE((SELECT SUM(CAST(total AS DECIMAL))
                   FROM sales
                   WHERE customer_id IS NOT NULL
                     AND status = 'active'
                     AND is_credit = true
                     AND empresa_id = :empresaId), 0)
         -
         COALESCE((SELECT SUM(CAST(amount AS DECIMAL))
                   FROM customer_payments
                   WHERE empresa_id = :empresaId), 0)
         AS total`,
      { replacements: { empresaId }, type: QueryTypes.SELECT }
    );

    const totalReceivable = parseFloat(receivableRow?.total) || 0;

    const [payableRow] = await sequelize.query(
      `SELECT
         COALESCE((SELECT SUM(CAST(amount AS DECIMAL))
                   FROM supplier_movements
                   WHERE type = 'deuda' AND empresa_id = :empresaId), 0)
         -
         COALESCE((SELECT SUM(CAST(amount AS DECIMAL))
                   FROM supplier_movements
                   WHERE type = 'pago' AND empresa_id = :empresaId), 0)
         AS total`,
      { replacements: { empresaId }, type: QueryTypes.SELECT }
    );

    const totalPayable = parseFloat(payableRow?.total) || 0;

    // Una sola lectura de la fecha para los DOS aging: si cada uno resolviera la
    // suya, la pantalla podria repartir el saldo de clientes con un dia y el de
    // proveedores con otro.
    const hoy = await hoyDelNegocio(empresaId);

    // ── Aging de proveedores ──
    const supplierMovements = await SupplierMovement.findAll({
      where: { type: 'deuda', empresa_id: empresaId },
      attributes: ['amount', 'date'],
      raw: true,
    });

    const totalDebt = supplierMovements.reduce((s, m) => s + parseFloat(m.amount || 0), 0);
    const totalPaid = parseFloat(
      await SupplierMovement.sum('amount', {
        where: { type: 'pago', empresa_id: empresaId },
      })
    ) || 0;
    const unpaidSupplier = Math.max(0, totalDebt - totalPaid);

    const supplierAging = repartirPorAntiguedad(supplierMovements, hoy, {
      saldoImpago: unpaidSupplier,
      totalFacturado: totalDebt,
      fecha: 'date',
      importe: 'amount',
    });

    // ── Aging de clientes ──
    const allSales = await Sale.findAll({
      where: { customer_id: { [Op.ne]: null }, empresa_id: empresaId, status: 'active', is_credit: true },
      attributes: ['total', 'date', 'customer_id'],
      raw: true,
    });

    const totalCustomerSales = allSales.reduce((s, sa) => s + parseFloat(sa.total || 0), 0);

    const customerAging = repartirPorAntiguedad(allSales, hoy, {
      saldoImpago: totalReceivable,
      totalFacturado: totalCustomerSales,
      fecha: 'date',
      importe: 'total',
    });

    return {
      total_receivable: Math.round(totalReceivable * 100) / 100,
      aging: customerAging,
      total_payable: Math.round(totalPayable * 100) / 100,
      supplier_aging: supplierAging,
    };
  }

  async listCustomers(filters = {}, empresaId) {
    assertEmpresaId(empresaId);

    const where = { empresa_id: empresaId };
    const { search, active, limit, offset } = filters;

    if (active !== undefined) where.is_active = active === 'true' || active === true;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { tax_id: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const pageLimit = parseInt(limit, 10) || 50;
    const pageOffset = parseInt(offset, 10) || 0;

    const { count, rows } = await Customer.findAndCountAll({
      where,
      order: [['name', 'ASC']],
      limit: pageLimit,
      offset: pageOffset,
    });

    // TODO(perf): esto hace 4 consultas por cliente (N+1). Con 50 clientes por
    // pagina son 200 consultas por request. Resolver con un GROUP BY unico.
    const enriched = await Promise.all(
      rows.map(async (c) => {
        // status active en todo: "cuanto me compro" y "cuantas veces vino" no
        // deben contar operaciones anuladas.
        const scopeVentas = { customer_id: c.id, empresa_id: empresaId, status: 'active' };

        const totalSales = parseFloat(await Sale.sum('total', { where: scopeVentas })) || 0;
        const visitCount = await Sale.count({ where: scopeVentas });
        const lastSale = await Sale.findOne({
          where: scopeVentas,
          order: [['date', 'DESC']],
        });
        const balance = await this.calculateBalance(c.id, empresaId);

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
