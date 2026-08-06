// ════════════════════════════════════════════
//  ADMINAPP · Los indicadores del Panel de control
//
//  Este servicio calcula los números que el dueño mira todos los días para
//  decidir. Hasta el corte 2 de la funcionalidad 014, cinco de ellos estaban
//  mal, y cada uno por su motivo:
//
//   1. **«Por Pagar» nunca restaba los pagos**: sumaba solo los movimientos de
//      tipo `deuda`, así que pagarle a un proveedor no bajaba el número. Había
//      CUATRO implementaciones del mismo saldo en el repositorio y ésta era la
//      única rota; ahora sale de `utils/cuentaDeProveedor.js`, que es la misma
//      que usa la pantalla de Proveedores.
//   2. **«Por Cobrar» y «clientes con deuda» contaban las ventas de contado**,
//      porque les faltaba `is_credit`. Una venta cobrada en el mostrador no es
//      un saldo pendiente aunque tenga cliente asignado.
//   3. **El aging no podía cerrar con el total que tiene arriba**: el total
//      sumaba lo impago y los cuatro tramos sumaban lo facturado. Los dos
//      aging salen ahora de `utils/antiguedad.js`, que reparte el saldo impago
//      y por construcción suma el total.
//   4. **La venta del día 1 se contaba en el mes actual Y en el anterior**,
//      porque los cortes eran `Op.between`, que es inclusivo en los dos
//      extremos. Ahora son semiabiertos `[desde, hasta)`.
//   5. **Las fechas eran las del servidor en UTC** mientras las ventas se
//      guardan con `fechaDelNegocio`. Entre las 21:00 y las 24:00 hora
//      argentina el Panel cortaba un día adelante del historial de ventas.
//
//  ── Y una decisión de forma: los bloques que no se pueden ver NO VIENEN ──
//
//  `dashboard.ver` lo tienen los cinco roles, y la respuesta traía el saldo de
//  caja, las cuentas por cobrar y los gastos fijos a roles que no pueden abrir
//  ninguna de esas tres pantallas. Cada bloque exige ahora el permiso de SU
//  pantalla, y cuando falta **se omite la clave entera**: no viene en `null` ni
//  en cero, porque `null` y `0` se confunden en cuanto alguien escribe
//  `kpis.cashflow?.balance || 0`.
// ════════════════════════════════════════════

const { Op, fn, col } = require('sequelize');
const {
  Sale,
  Product,
  Stock,
  Customer,
  CustomerPayment,
  SupplierMovement,
  FixedExpense,
} = require('../models');
const cashflowService = require('./cashflowService');
const { hoyDelNegocio } = require('../utils/fechas');
const { resumenDeCuenta } = require('../utils/cuentaDeProveedor');
const { repartirPorAntiguedad } = require('../utils/antiguedad');
const { aCentavos, deCentavos } = require('../utils/centavos');
const { esStockBajo } = require('../utils/stockBajo');

const MILISEGUNDOS_POR_DIA = 1000 * 60 * 60 * 24;

/**
 * Qué permiso protege cada bloque de la respuesta.
 *
 * Es el mismo permiso que protege **la pantalla que detalla ese número**: si no
 * lo podés ver allá, no lo ves acá. La alternativa —un permiso nuevo
 * `dashboard.finanzas`— habría que sembrarlo, repartirlo por rol y explicarlo
 * para terminar diciendo lo que `caja.ver` y `clientes.ver` ya dicen.
 */
const PERMISO_DEL_BLOQUE = {
  cashflow: 'caja.ver',
  receivables: 'clientes.ver',
  customers_with_debt: 'clientes.ver',
  payables: 'proveedores.ver',
  fixed_expenses: 'gastos.ver',
};

// ── Aritmética de fechas sobre texto YYYY-MM-DD ──
//
// Las columnas son DATEONLY y viajan como texto. Todo el cálculo se hace en UTC
// a propósito: la zona ya la resolvió `hoyDelNegocio` una sola vez, y volver a
// pasar por la zona local del servidor en cada suma de días es la forma de
// reintroducir el defecto que este corte cierra.

function comoUtc(fechaISO) {
  return new Date(`${fechaISO}T00:00:00Z`);
}

function aISO(fecha) {
  return fecha.toISOString().split('T')[0];
}

/** La fecha `dias` después (o antes, con negativo). */
function sumarDias(fechaISO, dias) {
  return aISO(new Date(comoUtc(fechaISO).getTime() + dias * MILISEGUNDOS_POR_DIA));
}

/** El día 1 del mes de `fechaISO`, corrido `meses` (negativo = hacia atrás). */
function primerDiaDelMes(fechaISO, meses = 0) {
  const fecha = comoUtc(fechaISO);

  return aISO(new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + meses, 1)));
}

/**
 * Si el usuario tiene un permiso, con la misma regla de comodín que
 * `middleware/checkPermission.js`: `caja.*` habilita `caja.ver`.
 *
 * Escrita acá y no importada del middleware porque el middleware devuelve una
 * respuesta HTTP; lo que hace falta es la pregunta, no el corte.
 */
function tienePermiso(permisos, codigo) {
  if (!Array.isArray(permisos)) return false;

  const comodin = `${codigo.split('.').slice(0, -1).join('.')}.*`;

  return permisos.includes(codigo) || permisos.includes(comodin);
}

class DashboardService {
  /**
   * Los indicadores del Panel.
   *
   * @param {number} empresaId
   * @param {object} [opciones]
   * @param {string[]} [opciones.permisos] Los del usuario. **Si no se pasan, no
   *   se recorta nada**: la ruta siempre los pasa, y un llamador interno que no
   *   los tenga está pidiendo el panel completo a propósito.
   * @param {string} [opciones.hoy] La fecha del negocio, YYYY-MM-DD. Se recibe
   *   ya resuelta —como hace `filtroVentas.js`— para que todos los cortes del
   *   request usen exactamente la misma, y para que un test la pueda fijar.
   */
  async getKpis(empresaId, opciones = {}) {
    const permisos = opciones.permisos;
    const recorta = Array.isArray(permisos);
    const puedeVer = (bloque) => !recorta || tienePermiso(permisos, PERMISO_DEL_BLOQUE[bloque]);

    const hoy = opciones.hoy || (await hoyDelNegocio(empresaId));

    // ── Los cortes, todos semiabiertos [desde, hasta) ──
    //
    // `manana` existe porque el extremo derecho queda AFUERA: sin él, las ventas
    // de hoy no entrarían en «los últimos 30 días» ni en «este mes».
    const manana = sumarDias(hoy, 1);
    const hace30Dias = sumarDias(hoy, -30);
    const primeroDelMes = primerDiaDelMes(hoy);
    const primeroDelMesAnterior = primerDiaDelMes(hoy, -1);

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
      this._salesPeriod(hace30Dias, manana, empresaId),
      this._salesPeriod(primeroDelMes, manana, empresaId),
      // El mes anterior termina donde arranca el actual, sin incluirlo: es el
      // defecto P4, y el arreglo ya estaba escrito 130 líneas más abajo.
      this._salesPeriod(primeroDelMesAnterior, primeroDelMes, empresaId),
      this._salesByMethod(hace30Dias, manana, empresaId),
      puedeVer('cashflow') ? cashflowService.getBalance(empresaId) : null,
      this._customerStats(empresaId, { conDeuda: puedeVer('customers_with_debt') }),
      puedeVer('receivables') ? this._receivables(empresaId, hoy) : null,
      puedeVer('payables') ? this._payables(empresaId, hoy) : null,
      this._productStats(empresaId),
      puedeVer('fixed_expenses') ? this._fixedExpensesTotal(empresaId) : null,
      this._lowStockAlerts(5, empresaId),
      this._expiringAlerts(hoy, 5, empresaId),
    ]);

    const data = {
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
      // El mes en curso está incompleto salvo el último día: comparado contra un
      // mes entero, el día 3 dice −90 % siempre. La pantalla tiene que rotularlo
      // en vez de dejar que se lea como una caída.
      comparacion_parcial: hoy !== sumarDias(primerDiaDelMes(hoy, 1), -1),
      customers: customersStats,
      products: productsStats,
      alerts: {
        low_stock: lowStockAlerts,
        expiring: expiringAlerts,
      },
    };

    // ── El recorte por permiso ──
    //
    // La clave AUSENTE y la clave EN CERO son cosas distintas. Nada de esto
    // devuelve `null`.
    if (cashflow) {
      data.cashflow = {
        balance: cashflow.balance,
        projected_30d: cashflow.projected_30d,
        projected_60d: cashflow.projected_60d,
      };
    }
    if (receivables) data.receivables = receivables;
    if (payables) data.payables = payables;
    if (fixedExpensesTotal !== null) data.fixed_expenses = fixedExpensesTotal;

    return data;
  }

  /**
   * Ventas de un período **semiabierto**: `[from, to)`.
   *
   * `Op.between` es inclusivo en los dos extremos, así que la venta del día que
   * es a la vez fin de un período y comienzo del siguiente se contaba DOS veces.
   */
  async _salesPeriod(from, to, empresaId) {
    const result = await Sale.findOne({
      attributes: [
        [fn('COALESCE', fn('SUM', col('total')), 0), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: {
        empresa_id: empresaId,
        status: 'active',
        date: { [Op.gte]: from, [Op.lt]: to },
      },
      raw: true,
    });

    return {
      // El `SUM` de un DECIMAL vuelve como string: sin convertir, el total del
      // panel viajaría como texto y la pantalla lo concatenaría.
      total: deCentavos(aCentavos(result.total)),
      count: parseInt(result.count, 10) || 0,
    };
  }

  async _salesByMethod(from, to, empresaId) {
    const rows = await Sale.findAll({
      attributes: [
        'payment_method',
        [fn('SUM', col('total')), 'total'],
      ],
      where: {
        empresa_id: empresaId,
        status: 'active',
        date: { [Op.gte]: from, [Op.lt]: to },
      },
      group: ['payment_method'],
      raw: true,
    });

    const byMethod = {};

    for (const r of rows) byMethod[r.payment_method] = deCentavos(aCentavos(r.total));

    return byMethod;
  }

  /**
   * Cuántos clientes activos hay y cuántos deben plata.
   *
   * ── Dos GROUP BY fijos, no dos consultas por cliente ──
   *
   * La versión anterior hacía dos `SUM` **por cada cliente con ventas**, en
   * serie adentro de un `for`: con 500 clientes eran 1.000 consultas
   * secuenciales en cada carga del Panel. El molde de las dos consultas fijas es
   * el de `routes/suppliers.js`, que ya cerró el mismo problema.
   *
   * ── Y la comparación va en centavos enteros ──
   *
   * Antes era `parseFloat(ventas) > parseFloat(pagos)` sobre dos DECIMAL que
   * vuelven como string: un cliente que pagó EXACTAMENTE lo que debía podía
   * quedar del lado equivocado por un residuo de coma flotante.
   */
  async _customerStats(empresaId, { conDeuda = true } = {}) {
    const active = await Customer.count({ where: { is_active: true, empresa_id: empresaId } });

    if (!conDeuda) return { active };

    const ventas = await Sale.findAll({
      attributes: ['customer_id', [fn('SUM', col('Sale.total')), 'total']],
      where: {
        empresa_id: empresaId,
        status: 'active',
        // Solo las ventas a cuenta corriente generan deuda. Una venta cobrada en
        // el mostrador no es un saldo pendiente aunque tenga cliente asignado.
        is_credit: true,
        customer_id: { [Op.ne]: null },
      },
      include: [{
        model: Customer,
        as: 'customer',
        attributes: [],
        // El `empresa_id` del include no es redundante con el de arriba: la
        // unión es por `customer_id` a secas, y sin él una venta de esta empresa
        // contra un cliente de otra entraría igual.
        where: { empresa_id: empresaId },
        required: true,
      }],
      group: ['Sale.customer_id'],
      raw: true,
    });

    const pagos = await CustomerPayment.findAll({
      attributes: ['customer_id', [fn('SUM', col('amount')), 'total']],
      where: { empresa_id: empresaId },
      group: ['customer_id'],
      raw: true,
    });

    const pagadoPorCliente = new Map();

    for (const p of pagos) pagadoPorCliente.set(Number(p.customer_id), aCentavos(p.total));

    let withDebt = 0;

    for (const v of ventas) {
      const saldo = aCentavos(v.total) - (pagadoPorCliente.get(Number(v.customer_id)) || 0);

      if (saldo > 0) withDebt++;
    }

    return { active, with_debt: withDebt };
  }

  /**
   * Lo que los clientes deben, y cómo se reparte por antigüedad.
   *
   * El total y los cuatro tramos salen de **la misma lectura**: si el total
   * saliera de un `SUM` y los tramos de otra consulta, podrían no cerrar, que es
   * exactamente lo que pasaba —el total restaba los pagos y los tramos no—.
   */
  async _receivables(empresaId, hoy) {
    const ventas = await Sale.findAll({
      attributes: ['total', 'date'],
      where: {
        empresa_id: empresaId,
        status: 'active',
        is_credit: true,
        customer_id: { [Op.ne]: null },
      },
      raw: true,
    });

    const pagado = await CustomerPayment.sum('amount', { where: { empresa_id: empresaId } });

    const facturadoEnCentavos = ventas.reduce((acc, v) => acc + aCentavos(v.total), 0);
    // Nunca negativo: un cliente con saldo a favor no es plata por cobrar.
    const saldoEnCentavos = Math.max(0, facturadoEnCentavos - aCentavos(pagado));
    const total = deCentavos(saldoEnCentavos);

    return {
      total,
      aging: repartirPorAntiguedad(ventas, hoy, {
        saldoImpago: total,
        totalFacturado: deCentavos(facturadoEnCentavos),
        fecha: 'date',
        importe: 'total',
      }),
    };
  }

  /**
   * Lo que se les debe a los proveedores: **deuda menos pagado**.
   *
   * Sale de `resumenDeCuenta`, la misma función que calcula el saldo en la
   * pantalla de Proveedores. Antes acá se sumaba solo `type: 'deuda'` y en punto
   * flotante: el número solo podía crecer, y registrar un pago no lo movía.
   */
  async _payables(empresaId, hoy) {
    const movimientos = await SupplierMovement.findAll({
      attributes: ['type', 'amount', 'date'],
      where: { empresa_id: empresaId },
      raw: true,
    });

    const { deuda, saldo } = resumenDeCuenta(movimientos);
    // Nunca negativo: haberle pagado de más a un proveedor no es plata por pagar.
    const total = Math.max(0, saldo);

    return {
      total,
      aging: repartirPorAntiguedad(
        movimientos.filter((m) => m.type === 'deuda'),
        hoy,
        {
          saldoImpago: total,
          totalFacturado: deuda,
          fecha: 'date',
          importe: 'amount',
        }
      ),
    };
  }

  /** La suma real de los gastos fijos, en centavos. */
  async _fixedExpensesTotal(empresaId) {
    const total = await FixedExpense.sum('amount', { where: { empresa_id: empresaId } });

    return deCentavos(aCentavos(total));
  }

  /**
   * Cuántos productos activos hay y cuántas filas de stock están en falta.
   *
   * La regla de «stock bajo» sale de `utils/stockBajo.js` y no de un `literal`
   * de SQL. Traducirla a SQL sería más barato y dejaría **dos escrituras de la
   * misma regla**: el encabezado de ese archivo existe justamente porque eso ya
   * pasó una vez, y el Panel era el que se había quedado con la regla vieja.
   */
  async _productStats(empresaId) {
    const active = await Product.count({ where: { is_active: true, empresa_id: empresaId } });

    const filas = await Stock.findAll({
      attributes: ['quantity', 'min_stock'],
      where: { empresa_id: empresaId },
      include: [{
        model: Product,
        as: 'product',
        attributes: [],
        where: { is_active: true, empresa_id: empresaId },
        required: true,
      }],
      raw: true,
    });

    return { active, low_stock: filas.filter((fila) => esStockBajo(fila)).length };
  }

  /**
   * Las filas de stock en falta, las `limit` más urgentes.
   *
   * ⚠ El `limit` se aplica **después** de filtrar, en JavaScript. No puede ir en
   * la consulta: la base traería las cinco filas con menos cantidad y recién
   * después se sabría cuáles de esas están en falta, así que el Panel podría
   * mostrar dos avisos habiendo doce productos por reponer.
   */
  async _lowStockAlerts(limit = 5, empresaId) {
    const rows = await Stock.findAll({
      where: { empresa_id: empresaId },
      include: [{
        model: Product,
        as: 'product',
        attributes: ['name'],
        where: { is_active: true, empresa_id: empresaId },
        required: true,
      }],
      order: [['quantity', 'ASC']],
    });

    return rows
      .filter((r) => esStockBajo(r))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        product_name: r.product?.name || 'Unknown',
        location: r.location,
        punto_de_venta_id: r.punto_de_venta_id,
        quantity: r.quantity,
        min_stock: r.min_stock,
      }));
  }

  async _expiringAlerts(hoy, limit = 5, empresaId) {
    const dentroDe30Dias = sumarDias(hoy, 30);

    const rows = await Stock.findAll({
      where: {
        empresa_id: empresaId,
        // Acá `Op.between` es correcto: los dos extremos son días que cuentan,
        // no el borde entre dos períodos consecutivos.
        expiration_date: { [Op.between]: [hoy, dentroDe30Dias] },
      },
      include: [{
        model: Product,
        as: 'product',
        attributes: ['name'],
        where: { empresa_id: empresaId },
        required: true,
      }],
      limit,
      order: [['expiration_date', 'ASC']],
    });

    return rows.map((r) => ({
      id: r.id,
      product_name: r.product?.name || 'Unknown',
      location: r.location,
      punto_de_venta_id: r.punto_de_venta_id,
      expiration_date: r.expiration_date,
    }));
  }
}

module.exports = new DashboardService();
