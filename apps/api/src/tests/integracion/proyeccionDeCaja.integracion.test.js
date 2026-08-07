// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const {
  modelos, limpiarLaBase, conectarOFallar, cerrar,
} = require('./baseDePruebas');
const { sembrarDosEmpresas } = require('./fixtures');
const cashflowService = require('../../services/cashflowService');
const dashboardService = require('../../services/dashboardService');
const { fechaDelNegocio } = require('../../utils/fechas');

// ════════════════════════════════════════════
//  «Proyección a 30 días»: dónde empieza el período
//
//  El corte de los 30 días de `cashflowService` era
//  `new Date(Date.now() - 30 días).toISOString()`, o sea la fecha del servidor
//  en UTC, mientras el resto del Panel ya cortaba con la fecha del negocio. A
//  las 23:25 hora argentina la proyección medía un período corrido un día, y la
//  pantalla mostraba los dos números uno al lado del otro sin decirlo (FR-048).
//
//  ── Por qué esto NO puede ser un test con dobles ──
//
//  Lo que hay que ejercitar es el `Op.gte` sobre columnas `DATEONLY`: cuáles
//  filas entran en la ventana y cuáles no. `tests/helpers/modelosFalsos.js` no
//  interpreta los operadores de Sequelize —lo dice su encabezado— así que un
//  test escrito sobre ellos afirmaría lo que hace el doble y no lo que hace la
//  base. Y la mitad del defecto está justamente en el borde de la ventana.
//
//  ── Y por qué las dos fechas del borde no son redondas ──
//
//  Los dos movimientos están **pegados al corte**, uno de cada lado, y con
//  importes que no se cancelan entre sí. Un movimiento en el medio del período
//  entra con las dos fechas y el test pasaría con y sin la corrección.
// ════════════════════════════════════════════

const { Empresa, Customer, CustomerPayment, Sale, SaleItem, SupplierMovement } = modelos;

const MILISEGUNDOS_POR_DIA = 1000 * 60 * 60 * 24;

/** Aritmética de fechas propia: si fuera la del servicio, un error se cancelaría. */
function sumarDias(fechaISO, dias) {
  return new Date(new Date(`${fechaISO}T00:00:00Z`).getTime() + dias * MILISEGUNDOS_POR_DIA)
    .toISOString().split('T')[0];
}

// Los dos movimientos del borde. Elegidos para que los tres números que el
// Panel muestra —saldo, entradas de 30 días y proyección— den valores DISTINTOS
// según qué fecha corte el período:
//
//   con la fecha del negocio  → entra solo la venta:    proyección 10.800,05
//   con la fecha UTC un día antes → entran las dos:     proyección 11.130,08
//   con la fecha UTC un día después → no entra ninguna: proyección  5.300,04
const VENTA_JUSTO_ADENTRO = 5000.01;
const COBRANZA_JUSTO_AFUERA = 300.03;
const SALDO = 5300.04;
const PROYECCION_CORRECTA = 10800.05;

let datos;
let cliente;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  // La fixture trae una venta y varios movimientos de proveedor con fechas fijas
  // de julio de 2026: entran o no en la ventana según el día en que se corra la
  // suite, y el saldo dejaría de ser un número exacto. Cada test siembra lo suyo.
  await SaleItem.destroy({ where: {} });
  await Sale.destroy({ where: {} });
  await SupplierMovement.destroy({ where: {} });

  cliente = await Customer.create({
    empresa_id: datos.empresaA.id,
    name: 'Almacén de la esquina',
  });
});

afterAll(async () => {
  await cerrar();
});

/** Una venta de contado: entra al saldo y a la ventana de 30 días. */
function venta(id, date, total) {
  return Sale.create({
    id,
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    date,
    time: '10:00',
    total,
    payment_method: 'ef',
    status: 'active',
    is_credit: false,
  });
}

/** Una cobranza de cuenta corriente. */
function cobranza(payment_date, amount) {
  return CustomerPayment.create({
    empresa_id: datos.empresaA.id,
    customer_id: cliente.id,
    amount,
    payment_date,
  });
}

describe('El período de la proyección de caja', () => {
  it('arranca en la fecha del NEGOCIO menos 30 días, y no en la UTC del servidor', async () => {
    const fechaUtc = new Date().toISOString().split('T')[0];

    // Una zona cuya fecha de negocio AHORA sea distinta de la fecha UTC. Siempre
    // hay una: UTC+14 va un día adelante cuando en UTC ya pasaron las 10:00, y
    // UTC−11 va un día atrás cuando todavía no llegaron. Sin este par, el test
    // pasaría con y sin la corrección durante la mayor parte del día.
    const zona = ['Pacific/Kiritimati', 'Pacific/Midway']
      .find((z) => fechaDelNegocio(z) !== fechaUtc);

    expect(zona).toBeDefined();

    await Empresa.update({ timezone: zona }, { where: { id: datos.empresaA.id } });

    const hoyDelNegocio = fechaDelNegocio(zona);
    const corte = sumarDias(hoyDelNegocio, -30);

    await venta('V-EN-EL-CORTE', corte, VENTA_JUSTO_ADENTRO);
    await cobranza(sumarDias(corte, -1), COBRANZA_JUSTO_AFUERA);

    const saldo = await cashflowService.getBalance(datos.empresaA.id);

    // Lo que entró en el período: la venta del día del corte, y NADA de lo
    // anterior. Con la fecha UTC entra también la cobranza —o no entra ninguna
    // de las dos, según para qué lado esté corrida la zona—.
    expect(saldo.total_inflows_30d).toBe(VENTA_JUSTO_ADENTRO);
    expect(saldo.projected_30d).toBe(PROYECCION_CORRECTA);

    // Y el saldo NO se mueve: no tiene corte de fecha. Es lo que acota el
    // defecto a la proyección.
    expect(saldo.balance).toBe(SALDO);
  });

  it('el Panel proyecta con SU fecha: la que usa para las tarjetas de al lado', async () => {
    // Cien días atrás. Es una fecha que el servicio no puede adivinar sola: si
    // `getBalance` vuelve a resolver la suya, la ventana queda en otro lado y la
    // proyección deja de ser la del período que el Panel dice estar mostrando.
    const hoyDelPanel = sumarDias(fechaDelNegocio(datos.empresaA.timezone), -100);
    const corte = sumarDias(hoyDelPanel, -30);

    await venta('V-EN-EL-CORTE', corte, VENTA_JUSTO_ADENTRO);
    await cobranza(sumarDias(corte, -1), COBRANZA_JUSTO_AFUERA);

    const kpis = await dashboardService.getKpis(datos.empresaA.id, { hoy: hoyDelPanel });

    expect(kpis.cashflow.projected_30d).toBe(PROYECCION_CORRECTA);
    expect(kpis.cashflow.balance).toBe(SALDO);
  });
});
