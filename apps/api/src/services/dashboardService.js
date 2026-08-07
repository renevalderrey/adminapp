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

const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const forge = require('node-forge');
const {
  Sale,
  Product,
  Stock,
  Customer,
  CustomerPayment,
  SupplierMovement,
  FixedExpense,
  Setting,
  sequelize,
} = require('../models');
const cashflowService = require('./cashflowService');
const logger = require('../utils/logger');
const { hoyDelNegocio } = require('../utils/fechas');
const { resumenDeCuenta } = require('../utils/cuentaDeProveedor');
const { repartirPorAntiguedad } = require('../utils/antiguedad');
const { aCentavos, deCentavos } = require('../utils/centavos');
const { esStockBajo } = require('../utils/stockBajo');

const MILISEGUNDOS_POR_DIA = 1000 * 60 * 60 * 24;

/** Cuántas barras dibuja un sparkline. La maqueta pone doce (`:247-251`). */
const MESES_DE_SERIE = 12;

/** A cuántos días de vencer el certificado de AFIP empieza a avisarse. */
const DIAS_DE_AVISO_DEL_CERTIFICADO = 30;

/** Cuántas ventas entran en «Últimas ventas». */
const ULTIMAS_VENTAS = 5;

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

// ── Las series de los sparklines ──
//
// Doce períodos REALES. La maqueta dibuja las barras con `Math.sin` (`:1166`) y
// eso, en una tarjeta de plata, es exactamente la familia de error que abre
// `CONVENCIONES.md`: una línea inventada con cara de dato.
//
// Y «real» no es «hay una fila»: es que el negocio tenga historia DETRÁS del
// primer balde. Una empresa que abrió hace cinco meses no tiene doce meses de
// ventas, y rellenar los otros siete con ceros dibuja una caída que nunca pasó.
// Cuando no hay doce, la clave del indicador **no viene** y la tarjeta no dibuja
// sparkline (FR-068).

/** Las doce claves `YYYY-MM` de la serie; la última es el mes de `hoy`. */
function mesesDeLaSerie(hoy) {
  const claves = [];

  for (let i = MESES_DE_SERIE - 1; i >= 0; i--) claves.push(primerDiaDelMes(hoy, -i).slice(0, 7));

  return claves;
}

/**
 * Si hay historia detrás del primer balde.
 *
 * Las filas vienen ordenadas por mes, así que la más vieja es la primera. La
 * comparación es de texto y alcanza: `YYYY-MM` ordena igual como texto que como
 * fecha, que es para lo que se eligió ese formato.
 */
function hayDoceMesesReales(filas, meses) {
  return filas.length > 0 && String(filas[0].mes) <= meses[0];
}

/** El total de cada mes. Un mes sin movimiento es un cero REAL, no un hueco. */
function porMes(filas, meses) {
  const suma = new Map();

  for (const f of filas) suma.set(String(f.mes), (suma.get(String(f.mes)) || 0) + aCentavos(f.monto));

  return meses.map((m) => deCentavos(suma.get(m) || 0));
}

/**
 * El saldo al cierre de cada mes, arrastrando todo lo anterior.
 *
 * Lo fechado **adelante** —un movimiento manual cargado con fecha del mes que
 * viene— se imputa al mes en curso, que es donde el saldo de la tarjeta ya lo
 * cuenta. Sin eso, la última barra y el número de arriba serían dos respuestas
 * distintas a la misma pregunta.
 */
function acumuladaPorMes(filas, meses, { nuncaNegativa = false } = {}) {
  const ultimo = meses[meses.length - 1];
  const porBalde = new Map();
  let arrastre = 0;

  for (const f of filas) {
    const mes = String(f.mes);
    const centavos = aCentavos(f.monto);

    if (mes < meses[0]) {
      arrastre += centavos;
      continue;
    }

    const balde = mes > ultimo ? ultimo : mes;

    porBalde.set(balde, (porBalde.get(balde) || 0) + centavos);
  }

  let acumulado = arrastre;

  return meses.map((m) => {
    acumulado += porBalde.get(m) || 0;

    return deCentavos(nuncaNegativa ? Math.max(0, acumulado) : acumulado);
  });
}

/**
 * Corre la serie entera para que su último punto sea el número de la tarjeta.
 *
 * Hace falta en una sola: el **saldo de caja**. La serie sale de los movimientos
 * QUE TIENEN FECHA, y el saldo además descuenta los gastos fijos, que no la
 * tienen (decisión 18 del plan: «es un estado, no una serie»). El desfase es
 * constante —esos gastos fijos— y sin corregirlo la última barra diría una cosa
 * y el número de arriba otra, a cuarenta píxeles de distancia.
 */
function anclarAlUltimo(serie, valorFinal) {
  const desfase = valorFinal - serie[serie.length - 1];

  return serie.map((punto) => Math.round((punto + desfase) * 100) / 100);
}

/**
 * Días entre dos fechas, hacia adelante. Negativo si ya pasó.
 *
 * Se cuenta sobre el día, no sobre el instante: lo que el usuario lee es «vence
 * en 28 días», y una diferencia en horas haría que el mismo certificado dijera
 * 28 a la mañana y 27 a la tarde.
 */
function diasHasta(fechaISO, hoy) {
  return Math.round((comoUtc(fechaISO).getTime() - comoUtc(hoy).getTime()) / MILISEGUNDOS_POR_DIA);
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
   * @param {number|null} [opciones.puntoDeVentaId] La sucursal activa. **Solo
   *   la usan los avisos de «Requiere tu atención»**, y solo los de stock: cada
   *   aviso sigue el alcance de la pantalla a la que lleva, y `GET /api/faltantes`
   *   y `GET /api/stock` caen a `req.puntoDeVentaId`. Si no, el aviso diría 12 y
   *   la pantalla a la que lleva mostraría 7 (ajuste 5(b) del plan). Las cuatro
   *   tarjetas de indicador son de toda la empresa y lo dicen en la etiqueta.
   */
  async getKpis(empresaId, opciones = {}) {
    const permisos = opciones.permisos;
    const recorta = Array.isArray(permisos);
    const puedeVer = (bloque) => !recorta || tienePermiso(permisos, PERMISO_DEL_BLOQUE[bloque]);
    const puedeVerPermiso = (codigo) => !recorta || tienePermiso(permisos, codigo);
    const puntoDeVentaId = opciones.puntoDeVentaId || null;

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
      series,
      requiereAtencion,
      ultimasVentas,
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
      this._series(empresaId, hoy, puedeVer),
      this._requiereAtencion(empresaId, hoy, { puntoDeVentaId, puedeVerPermiso }),
      puedeVerPermiso('ventas.ver') ? this._ultimasVentas(empresaId) : null,
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
      // Lo que hay que mirar hoy. **Un aviso con cero casos no viene** (FR-065):
      // un bloque lleno de renglones que dicen «0» entrena a no leerlo.
      requiere_atencion: requiereAtencion,
    };

    // Se rotula «Últimas ventas» y NO «Actividad reciente» (decisión 19): no hay
    // tabla de auditoría, y de los cuatro tipos de evento que dibuja la maqueta
    // solo las ventas tienen autor guardado. Prometer un registro que no existe
    // es lo mismo que dibujar un sparkline con `Math.sin`.
    if (ultimasVentas) data.ultimas_ventas = ultimasVentas;

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

      // El 10 % de crecimiento que la proyección supone. `cashflowService` lo
      // devuelve explícito desde que se dejó de colar adentro de un campo
      // rotulado como dato histórico, y hasta hoy **la pantalla no lo leía**: el
      // usuario veía un número inflado sin saberlo (FR-060).
      data.supuesto_crecimiento = cashflow.supuesto_crecimiento;

      // La serie de caja sale de los movimientos con fecha; el saldo, además,
      // descuenta los gastos fijos, que no la tienen.
      if (series.cashflow) series.cashflow = anclarAlUltimo(series.cashflow, cashflow.balance);
    }
    if (receivables) data.receivables = receivables;
    if (payables) data.payables = payables;
    if (fixedExpensesTotal !== null) data.fixed_expenses = fixedExpensesTotal;

    // Sin `cashflow` la serie de caja no tiene tarjeta donde dibujarse, y
    // mandarla sería devolver por una puerta lo que el recorte cierra por la
    // otra: el saldo mes a mes ES el saldo.
    if (!cashflow) delete series.cashflow;

    data.series = series;

    return data;
  }

  /**
   * Las cuatro series de doce puntos, **una consulta cada una**.
   *
   * No hay serie de gastos fijos: `fixed_expenses` es un estado, no una serie
   * —no tiene columna de fecha— así que no hay historia que reconstruir. La
   * maqueta dibuja cuatro sparklines y los datos dan para cuatro: Ventas, Saldo
   * de caja, Por cobrar y Por pagar (decisión 18).
   *
   * Cada serie exige el permiso de su tarjeta: si el bloque no viene, la serie
   * tampoco.
   */
  async _series(empresaId, hoy, puedeVer) {
    const meses = mesesDeLaSerie(hoy);

    const [ventas, caja, cobrar, pagar] = await Promise.all([
      this._serieDeVentas(empresaId, meses, sumarDias(hoy, 1)),
      puedeVer('cashflow') ? this._serieDeCaja(empresaId, meses) : null,
      puedeVer('receivables') ? this._serieDeCobrar(empresaId, meses) : null,
      puedeVer('payables') ? this._serieDePagar(empresaId, meses) : null,
    ]);

    const series = {};

    if (ventas) series.ventas = ventas;
    if (caja) series.cashflow = caja;
    if (cobrar) series.receivables = cobrar;
    if (pagar) series.payables = pagar;

    return series;
  }

  /**
   * Lo vendido mes a mes. **Una** consulta con `GROUP BY`, no doce.
   *
   * El último punto es, por construcción, `sales_current_month.total`: misma
   * tabla, mismo filtro, mismo mes.
   */
  async _serieDeVentas(empresaId, meses, hasta) {
    const mesDeLaVenta = fn('date_trunc', 'month', col('date'));

    const filas = await Sale.findAll({
      attributes: [
        [fn('to_char', mesDeLaVenta, 'YYYY-MM'), 'mes'],
        [fn('SUM', col('total')), 'monto'],
      ],
      // El corte superior es el mismo que el de `sales_current_month`: la última
      // barra es el mes EN CURSO, o sea hasta hoy. Sin él, una venta cargada con
      // fecha adelantada haría que la barra dijera más que el número de arriba.
      where: { empresa_id: empresaId, status: 'active', date: { [Op.lt]: hasta } },
      group: [mesDeLaVenta],
      order: [[mesDeLaVenta, 'ASC']],
      raw: true,
    });

    return hayDoceMesesReales(filas, meses) ? porMes(filas, meses) : null;
  }

  /**
   * El saldo de caja mes a mes.
   *
   * ── Por qué esto es SQL crudo y no cinco consultas de Sequelize ──
   *
   * El saldo se compone de cinco tablas con fecha —ventas de contado, cobranzas,
   * movimientos manuales, pagos a proveedores e impuestos pagados—. Escritas por
   * separado son cinco consultas por serie, o sea veinte por carga del Panel
   * encima de las doce que ya hace. Unidas con `UNION ALL` y agrupadas una vez,
   * son **una**. El `empresa_id` va en cada rama y por parámetro: es la misma
   * disciplina de `where: { empresa_id }`, escrita a mano porque acá no hay
   * modelo que la ponga sola.
   *
   * Los gastos fijos NO entran: no tienen fecha. El desfase constante que eso
   * produce lo corrige `anclarAlUltimo` contra el saldo de la tarjeta.
   */
  async _serieDeCaja(empresaId, meses) {
    const filas = await sequelize.query(
      `SELECT to_char(date_trunc('month', "fecha"), 'YYYY-MM') AS "mes",
              SUM("monto") AS "monto"
         FROM (
           SELECT "date" AS "fecha", "total" AS "monto"
             FROM "sales"
            WHERE "empresa_id" = :empresaId AND "status" = 'active' AND "is_credit" = false
           UNION ALL
           SELECT "payment_date", "amount"
             FROM "customer_payments" WHERE "empresa_id" = :empresaId
           UNION ALL
           SELECT "entry_date", CASE WHEN "type" = 'inflow' THEN "amount" ELSE -"amount" END
             FROM "cashflow_entries" WHERE "empresa_id" = :empresaId
           UNION ALL
           SELECT "date", -"amount"
             FROM "supplier_movements"
            WHERE "empresa_id" = :empresaId AND "type" = 'pago'
           UNION ALL
           SELECT "payment_date", -"amount"
             FROM "tax_payments" WHERE "empresa_id" = :empresaId
         ) AS "movimientos"
        GROUP BY 1
        ORDER BY 1`,
      { replacements: { empresaId }, type: QueryTypes.SELECT }
    );

    return hayDoceMesesReales(filas, meses) ? acumuladaPorMes(filas, meses) : null;
  }

  /**
   * Lo que los clientes deben, mes a mes: lo facturado a cuenta corriente hasta
   * cada corte menos lo cobrado hasta cada corte.
   *
   * `nuncaNegativa` por el mismo motivo que en `_receivables`: un cliente con
   * saldo a favor no es plata por cobrar. Con eso, el último punto es exactamente
   * `receivables.total`.
   */
  async _serieDeCobrar(empresaId, meses) {
    const filas = await sequelize.query(
      `SELECT to_char(date_trunc('month', "fecha"), 'YYYY-MM') AS "mes",
              SUM("monto") AS "monto"
         FROM (
           SELECT "date" AS "fecha", "total" AS "monto"
             FROM "sales"
            WHERE "empresa_id" = :empresaId AND "status" = 'active'
              AND "is_credit" = true AND "customer_id" IS NOT NULL
           UNION ALL
           SELECT "payment_date", -"amount"
             FROM "customer_payments" WHERE "empresa_id" = :empresaId
         ) AS "movimientos"
        GROUP BY 1
        ORDER BY 1`,
      { replacements: { empresaId }, type: QueryTypes.SELECT }
    );

    return hayDoceMesesReales(filas, meses)
      ? acumuladaPorMes(filas, meses, { nuncaNegativa: true })
      : null;
  }

  /** Lo que se les debe a los proveedores, mes a mes: deuda menos pagos. */
  async _serieDePagar(empresaId, meses) {
    const mesDelMovimiento = fn('date_trunc', 'month', col('date'));

    const filas = await SupplierMovement.findAll({
      attributes: [
        [fn('to_char', mesDelMovimiento, 'YYYY-MM'), 'mes'],
        // Una sola consulta para los dos tipos: el signo lo pone el `CASE`, que
        // es lo mismo que hace `resumenDeCuenta` con las filas en la mano.
        [fn('SUM', literal(`CASE WHEN "type" = 'deuda' THEN "amount" ELSE -"amount" END`)), 'monto'],
      ],
      where: { empresa_id: empresaId },
      group: [mesDelMovimiento],
      order: [[mesDelMovimiento, 'ASC']],
      raw: true,
    });

    return hayDoceMesesReales(filas, meses)
      ? acumuladaPorMes(filas, meses, { nuncaNegativa: true })
      : null;
  }

  /**
   * «Requiere tu atención»: los hechos, no la presentación.
   *
   * El servidor manda `tipo`, `cantidad`, `alcance` y `ruta`; la severidad, el
   * orden y el texto los decide `utils/panel.js` del lado del navegador. Dos
   * fuentes para la misma etiqueta —una acá y otra allá— se separan sin que nada
   * avise, que es cómo el Panel terminó dibujando las alertas de un endpoint y
   * calculando las de otro (P11).
   *
   * **Cada aviso exige el permiso de la pantalla a la que lleva**, y **sigue su
   * alcance**: los dos de stock caen a la sucursal activa igual que `/faltantes`
   * y `/stock`; los otros dos son de toda la empresa.
   */
  async _requiereAtencion(empresaId, hoy, { puntoDeVentaId, puedeVerPermiso }) {
    const [faltantes, vencimientos, sinCae, certificado] = await Promise.all([
      puedeVerPermiso('stock.ver') ? this._contarFaltantes(empresaId, puntoDeVentaId) : 0,
      puedeVerPermiso('stock.ver') ? this._contarVencimientos(empresaId, hoy, puntoDeVentaId) : 0,
      puedeVerPermiso('ventas.ver') ? this._contarVentasRechazadas(empresaId) : 0,
      puedeVerPermiso('config.ver') ? this._certificadoPorVencer(empresaId, hoy) : null,
    ]);

    const alcanceDeStock = puntoDeVentaId ? 'sucursal' : 'empresa';
    const avisos = [];

    if (faltantes > 0) {
      avisos.push({
        tipo: 'faltantes', cantidad: faltantes, alcance: alcanceDeStock, ruta: '/faltantes',
      });
    }

    if (sinCae > 0) {
      avisos.push({ tipo: 'sin_cae', cantidad: sinCae, alcance: 'empresa', ruta: '/ventas' });
    }

    if (vencimientos > 0) {
      avisos.push({
        tipo: 'vencimientos',
        cantidad: vencimientos,
        alcance: alcanceDeStock,
        ruta: '/inventario',
        dias: 30,
      });
    }

    if (certificado) avisos.push(certificado);

    return avisos;
  }

  /**
   * Cuántas filas de stock están en falta, con la regla de `utils/stockBajo.js`.
   *
   * Es la misma cuenta que devuelve `GET /api/faltantes`, **incluido el alcance**:
   * si hay sucursal activa, la de esa sucursal. Un aviso que dijera 12 y llevara
   * a una pantalla que muestra 7 es el defecto que este hito viene a cerrar.
   */
  async _contarFaltantes(empresaId, puntoDeVentaId) {
    const where = { empresa_id: empresaId };

    if (puntoDeVentaId) where.punto_de_venta_id = puntoDeVentaId;

    const filas = await Stock.findAll({
      attributes: ['quantity', 'min_stock'],
      where,
      include: [{
        model: Product,
        as: 'product',
        attributes: [],
        where: { is_active: true, empresa_id: empresaId },
        required: true,
      }],
      raw: true,
    });

    return filas.filter((fila) => esStockBajo(fila)).length;
  }

  /** Cuántos lotes vencen dentro de 30 días, con el alcance de Inventario. */
  async _contarVencimientos(empresaId, hoy, puntoDeVentaId) {
    const where = {
      empresa_id: empresaId,
      expiration_date: { [Op.between]: [hoy, sumarDias(hoy, 30)] },
    };

    if (puntoDeVentaId) where.punto_de_venta_id = puntoDeVentaId;

    return Stock.count({ where });
  }

  /**
   * Cuántas ventas rechazó AFIP y siguen sin comprobante.
   *
   * ⚠ **No es «las ventas sin CAE».** Una venta activa sin CAE puede ser dos
   * cosas —una venta interna que nadie quiso facturar, o una que ARCA rechazó— y
   * `models/Sale.js` tiene `afip_ultimo_error` escrito justamente para
   * distinguirlas. Contar las dos juntas haría que un comercio que no factura
   * electrónicamente abriera el Panel con «247 comprobantes sin CAE», y un aviso
   * que sale siempre es un aviso que nadie mira.
   *
   * Lo que se cuenta es lo que tiene acción: son las que se reintentan desde el
   * historial de ventas con `POST /api/sales/:id/facturar`.
   */
  async _contarVentasRechazadas(empresaId) {
    return Sale.count({
      where: {
        empresa_id: empresaId,
        status: 'active',
        afip_cae: { [Op.is]: null },
        afip_ultimo_error: { [Op.ne]: null },
      },
    });
  }

  /**
   * El certificado de AFIP, si le quedan 30 días o menos.
   *
   * ⚠ Lee `afip_cert` —el certificado, que es público— y **nunca `afip_key`**.
   * De la lectura sale un solo número, los días que faltan: el PEM no toca la
   * respuesta ni el log. Un certificado vencido corta la facturación de un día
   * para el otro y el trámite en ARCA no es de un rato: avisar tarde es avisar
   * cuando ya no se puede facturar.
   */
  async _certificadoPorVencer(empresaId, hoy) {
    const fila = await Setting.findOne({ where: { key: 'afip_cert', empresa_id: empresaId } });

    if (!fila || !fila.value) return null;

    try {
      const cert = forge.pki.certificateFromPem(fila.value);
      const vence = cert.validity.notAfter.toISOString().split('T')[0];
      const dias = diasHasta(vence, hoy);

      if (dias > DIAS_DE_AVISO_DEL_CERTIFICADO) return null;

      return { tipo: 'certificado_afip', dias, vence, alcance: 'empresa', ruta: '/facturacion' };
    } catch (err) {
      // Un PEM corrupto no puede tumbar el Panel entero: lo que hay que ver es
      // que el certificado no sirve, y eso ya lo dice la pantalla de Facturación.
      logger.warn({ err, empresaId }, 'panel:certificado-afip-ilegible');

      return null;
    }
  }

  /** Las últimas ventas, para el bloque «Últimas ventas». */
  async _ultimasVentas(empresaId, limit = ULTIMAS_VENTAS) {
    const filas = await Sale.findAll({
      attributes: ['id', 'date', 'time', 'seller', 'total'],
      where: { empresa_id: empresaId, status: 'active' },
      // El desempate por `time` no es cosmético: en un día con veinte ventas, sin
      // él el orden lo elige Postgres y el bloque cambia de contenido entre dos
      // cargas iguales.
      order: [['date', 'DESC'], ['time', 'DESC'], ['id', 'DESC']],
      limit,
      raw: true,
    });

    return filas.map((v) => ({
      id: v.id,
      fecha: v.date,
      hora: v.time,
      vendedor: v.seller || null,
      total: deCentavos(aCentavos(v.total)),
    }));
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
