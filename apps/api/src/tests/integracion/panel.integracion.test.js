// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const {
  app, modelos, sequelize, limpiarLaBase, conectarOFallar, cerrar,
} = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');
const { capturarConsultas } = require('./espiaDeConsultas');
const dashboardService = require('../../services/dashboardService');
const seedPermissions = require('../../seedPermissions');
const { fechaDelNegocio } = require('../../utils/fechas');

// ════════════════════════════════════════════
//  Los cinco números de plata del Panel
//
//  `dashboardService` es el servicio con más aritmética de plata del backend y
//  hasta este corte era el único sin un archivo de test propio. Cinco de sus
//  números estaban mal, y **ninguno de los cinco lo puede contestar un doble**:
//
//   - «Por Pagar» sumaba solo los movimientos de deuda. Que registrar un pago
//     BAJE el número exige dos filas de tipos distintos y un `GROUP BY` que
//     `tests/helpers/modelosFalsos.js` no entiende.
//   - «Por Cobrar» contaba las ventas de contado. El filtro `is_credit` se
//     ejercita con una venta de contado A UN CLIENTE IDENTIFICADO: sin esa fila,
//     el test pasa con y sin la corrección.
//   - El aging sumaba lo facturado mientras el total sumaba lo impago. Que los
//     cuatro tramos cierren con el total exige importes con centavos que no
//     cierren solos.
//   - La venta del día 1 se contaba en dos meses, porque `Op.between` es
//     inclusivo en los dos extremos. Sin una venta EXACTAMENTE el día 1, los
//     cortes semiabiertos y los cerrados dan el mismo número.
//   - Los cortes de fecha eran los del servidor en UTC. Distinguirlo exige una
//     `Empresa.timezone` cuya fecha de negocio NO sea la fecha UTC.
//
//  Y dos cosas más que solo se ven contra Postgres: que los DECIMAL que vuelven
//  como string terminen siendo números en la respuesta, y que veinte clientes no
//  cuesten cuarenta consultas.
// ════════════════════════════════════════════

const {
  Empresa, Customer, CustomerPayment, Sale, SaleItem, SupplierMovement,
  Product, Stock, Permiso, Rol, RolPermiso, UsuarioEmpresa,
} = modelos;

const MILISEGUNDOS_POR_DIA = 1000 * 60 * 60 * 24;

/** Aritmética de fechas independiente de la del servicio: si fuera la misma, un error se cancelaría. */
function sumarDias(fechaISO, dias) {
  return new Date(new Date(`${fechaISO}T00:00:00Z`).getTime() + dias * MILISEGUNDOS_POR_DIA)
    .toISOString().split('T')[0];
}

function primerDiaDelMes(fechaISO, meses = 0) {
  const f = new Date(`${fechaISO}T00:00:00Z`);

  return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + meses, 1))
    .toISOString().split('T')[0];
}

/**
 * La suma de los cuatro tramos, **en centavos**.
 *
 * Sumar cuatro números con decimales en punto flotante da 1500,0500000000002 y
 * eso sería un defecto DEL TEST, no del servicio: los cuatro tramos son exactos
 * de a dos decimales. La afirmación que importa —que cierren con el total— se
 * hace en la unidad en la que la plata es exacta.
 */
function sumaDeTramos(aging) {
  return Object.values(aging).reduce((acc, t) => acc + Math.round(t * 100), 0) / 100;
}

let datos;
let HOY;
let catalogoDePermisos;

beforeAll(async () => {
  await conectarOFallar();

  // El catálogo de permisos se siembra UNA vez con el sembrador real y después
  // se copia con tres `bulkCreate`. `seedPermissions` hace un `findOrCreate` por
  // permiso y por par rol-permiso —unas cuatrocientas consultas—, y correrlo en
  // cada `beforeEach` multiplicaba por tres lo que tarda el archivo.
  await limpiarLaBase();
  await seedPermissions();

  catalogoDePermisos = {
    permisos: await Permiso.findAll({ raw: true }),
    roles: await Rol.findAll({ raw: true }),
    rolPermisos: await RolPermiso.findAll({ raw: true }),
  };
});

beforeEach(async () => {
  await limpiarLaBase();

  // Los roles del catálogo tienen que existir ANTES de sembrar el usuario: el
  // hook `beforeCreate` de UsuarioEmpresa resuelve `rol_id` por el nombre del
  // rol, y sin roles la sesión del bypass queda con CERO permisos — con lo cual
  // el recorte de T1358 escondería todos los bloques y los demás tests dirían
  // que los números están mal cuando lo que falta es el rol.
  await Permiso.bulkCreate(catalogoDePermisos.permisos);
  await Rol.bulkCreate(catalogoDePermisos.roles);
  await RolPermiso.bulkCreate(catalogoDePermisos.rolPermisos);

  datos = await sembrarDosEmpresas();
  HOY = fechaDelNegocio(datos.empresaA.timezone);

  // Las ventas de la fixture tienen fechas fijas de julio de 2026: qué mes les
  // toca depende del día en que se corra la suite. Se borran y cada test siembra
  // las suyas relativas a HOY.
  await SaleItem.destroy({ where: {} });
  await Sale.destroy({ where: {} });
});

afterAll(async () => {
  await cerrar();
});

/** Una venta, con lo mínimo que el modelo exige. */
function venta(id, campos) {
  return Sale.create({
    id,
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    time: '10:00',
    payment_method: 'ef',
    status: 'active',
    ...campos,
  });
}

/** Los permisos de un rol del catálogo, leídos de la base que sembró seedPermissions. */
async function permisosDelRol(nombre) {
  const rol = await Rol.findOne({ where: { nombre, empresa_id: null } });
  const filas = await RolPermiso.findAll({ where: { rol_id: rol.id }, raw: true });

  return filas.map((f) => f.permiso_codigo);
}

// ════════════════════════════════════════════
//  T1354 · «Por Pagar» es deuda MENOS pagos
// ════════════════════════════════════════════

describe('Por Pagar', () => {
  // La fixture tiene tres proveedores con movimientos y **uno con un pago
  // parcial** (Zeta: debe 500,50 y pagó 100,25). Sin ese pago parcial, «deuda» y
  // «deuda − pagado» darían lo mismo en el proveedor que importa.
  //
  //   deuda   = 1234,56 + 0,10 + 0,20 + 100,00 + 500,50 = 1835,36
  //   pagado  = 1234,86 + 33,33 + 33,33 + 33,34 + 100,25 = 1435,11
  //   saldo   =                                            400,25

  it('resta los pagos: no es la suma de las deudas', async () => {
    const { payables } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(payables.total).toBe(400.25);
    // El número que devolvía la versión anterior. Se nombra para que quede
    // escrito de qué se está distinguiendo.
    expect(payables.total).not.toBe(1835.36);
  });

  it('registrar un pago BAJA Por Pagar', async () => {
    const antes = await dashboardService.getKpis(1, { hoy: HOY });

    await SupplierMovement.create({
      empresa_id: datos.empresaA.id,
      supplier_id: datos.zeta.id,
      type: 'pago',
      date: HOY,
      amount: 100.25,
    });

    const despues = await dashboardService.getKpis(1, { hoy: HOY });

    expect(despues.payables.total).toBe(300.00);
    expect(despues.payables.total).toBeLessThan(antes.payables.total);
  });

  it('el total es un NÚMERO, no el string que devuelve el DECIMAL de Postgres', async () => {
    const { payables } = await dashboardService.getKpis(1, { hoy: HOY });

    // `toBeCloseTo` acepta una cadena y la compara como número: sin este
    // `typeof`, un '400.25' que nunca se convirtió pasaría igual.
    expect(typeof payables.total).toBe('number');

    for (const tramo of Object.values(payables.aging)) {
      expect(typeof tramo).toBe('number');
    }
  });

  it('los cuatro tramos del aging suman el total que la tarjeta muestra', async () => {
    const { payables } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(sumaDeTramos(payables.aging)).toBe(payables.total);
  });

  it('no cuenta los movimientos de la otra empresa', async () => {
    // La empresa B debe 77.777,77 y pagó 11,11. Si el `where` se escapara, el
    // total sería otro — y las dos empresas tienen un proveedor con el MISMO
    // nombre, así que la fuga no se vería como una fila de más.
    const { payables } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(payables.total).toBe(400.25);
  });
});

// ════════════════════════════════════════════
//  T1355 · «Por Cobrar» y «clientes con deuda»
// ════════════════════════════════════════════

describe('Por Cobrar y clientes con deuda', () => {
  let contado;
  let exacto;
  let deudor;

  beforeEach(async () => {
    contado = await Customer.create({ empresa_id: 1, name: 'Paga en el mostrador' });
    exacto = await Customer.create({ empresa_id: 1, name: 'Pagó justo' });
    deudor = await Customer.create({ empresa_id: 1, name: 'Debe plata' });

    // ⚠ Venta de CONTADO a un cliente identificado. Es la fila sin la cual el
    // filtro `is_credit` no se puede distinguir: con todas las ventas a cuenta
    // corriente, el total da igual con el filtro y sin él.
    await venta('V-CONTADO', {
      customer_id: contado.id, is_credit: false, date: sumarDias(HOY, -3), total: 5000.00,
    });

    // ⚠ Tres ventas a cuenta corriente y UN pago que las cancela exactamente.
    // 0,10 + 0,20 + 1234,56 sumado en punto flotante da 1234,8600000000001: si
    // el saldo se acumulara en pesos y no en centavos, este cliente quedaría
    // debiendo una billonésima de peso y «Por Cobrar» no daría redondo.
    await venta('V-EXACTA-1', {
      customer_id: exacto.id, is_credit: true, date: sumarDias(HOY, -10), total: 0.10,
    });
    await venta('V-EXACTA-2', {
      customer_id: exacto.id, is_credit: true, date: sumarDias(HOY, -10), total: 0.20,
    });
    await venta('V-EXACTA-3', {
      customer_id: exacto.id, is_credit: true, date: sumarDias(HOY, -40), total: 1234.56,
    });
    await CustomerPayment.create({
      empresa_id: 1, customer_id: exacto.id, amount: 1234.86, payment_date: sumarDias(HOY, -1),
    });

    await venta('V-DEUDOR', {
      customer_id: deudor.id, is_credit: true, date: sumarDias(HOY, -70), total: 2000.10,
    });
    await CustomerPayment.create({
      empresa_id: 1, customer_id: deudor.id, amount: 500.05, payment_date: sumarDias(HOY, -2),
    });
  });

  it('una venta de contado a un cliente identificado NO cuenta como por cobrar', async () => {
    const { receivables } = await dashboardService.getKpis(1, { hoy: HOY });

    // (0,10 + 0,20 + 1234,56 + 2000,10) − (1234,86 + 500,05) = 1500,05
    expect(receivables.total).toBe(1500.05);
    // Lo que daba contando el contado: 6500,05.
    expect(receivables.total).not.toBe(6500.05);
  });

  it('el cliente que pagó EXACTAMENTE lo que debía NO figura con deuda', async () => {
    const { customers } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(customers.with_debt).toBe(1);
    expect(customers.active).toBe(3);
  });

  it('el cliente de contado NO figura con deuda aunque tenga la venta sin pagar', async () => {
    const { customers } = await dashboardService.getKpis(1, { hoy: HOY });

    // Sin `is_credit` serían dos: el deudor de verdad y el que pagó en el
    // mostrador. Con el filtro, uno.
    expect(customers.with_debt).toBe(1);
  });

  it('los cuatro tramos del aging suman el total que la tarjeta muestra', async () => {
    const { receivables } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(sumaDeTramos(receivables.aging)).toBe(receivables.total);
    expect(sumaDeTramos(receivables.aging)).toBe(1500.05);
  });

  it('el total y los tramos son NÚMEROS', async () => {
    const { receivables } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(typeof receivables.total).toBe('number');

    for (const tramo of Object.values(receivables.aging)) {
      expect(typeof tramo).toBe('number');
    }
  });

  it('un cliente de la otra empresa con el mismo nombre no entra en el conteo', async () => {
    await Customer.create({ empresa_id: datos.empresaB.id, name: 'Debe plata' });

    const { customers } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(customers.active).toBe(3);
  });

  it('veinte clientes NO cuestan cuarenta consultas', async () => {
    const conTres = await capturarConsultas(sequelize, () => dashboardService._customerStats(1));

    for (let i = 0; i < 20; i++) {
      const cliente = await Customer.create({ empresa_id: 1, name: `Cliente ${i}` });

      await venta(`V-MASIVA-${i}`, {
        customer_id: cliente.id, is_credit: true, date: sumarDias(HOY, -5), total: 100 + i,
      });
    }

    const conVeintitres = await capturarConsultas(sequelize, () => dashboardService._customerStats(1));

    // El número de consultas es FIJO: no depende de cuántos clientes haya. Antes
    // eran dos por cliente, en serie.
    expect(conVeintitres.consultas.length).toBe(conTres.consultas.length);
    expect(conVeintitres.consultas.length).toBeLessThanOrEqual(3);
    expect(conVeintitres.resultado.with_debt).toBe(21);
  });
});

// ════════════════════════════════════════════
//  T1356 · Los cortes de fecha
// ════════════════════════════════════════════

describe('Los cortes de fecha', () => {
  it('la venta del día 1 se cuenta UNA vez, no en el mes actual y en el anterior', async () => {
    const primeroDeEsteMes = primerDiaDelMes(HOY);
    const primeroDelMesAnterior = primerDiaDelMes(HOY, -1);

    await venta('V-DIA-1', { date: primeroDeEsteMes, total: 111.11 });
    await venta('V-MES-ANTERIOR', { date: primeroDelMesAnterior, total: 222.22 });

    const kpis = await dashboardService.getKpis(1, { hoy: HOY });

    // Con `Op.between` el mes anterior terminaba EN el día 1 del actual, así que
    // la venta del día 1 sumaba en los dos: 333,33 acá y 111,11 arriba.
    expect(kpis.sales_previous_month.total).toBe(222.22);
    expect(kpis.sales_previous_month.count).toBe(1);
    expect(kpis.sales_current_month.total).toBe(111.11);
    expect(kpis.sales_current_month.count).toBe(1);
  });

  it('el corte del día usa Empresa.timezone y NO la fecha UTC del servidor', async () => {
    const fechaUtc = new Date().toISOString().split('T')[0];

    // Se elige una zona cuya fecha de negocio AHORA sea distinta de la fecha
    // UTC. Siempre hay una: UTC+14 va un día adelante cuando en UTC ya pasaron
    // las 10:00, y UTC−11 va un día atrás cuando todavía no llegaron.
    const zona = ['Pacific/Kiritimati', 'Pacific/Midway']
      .find((z) => fechaDelNegocio(z) !== fechaUtc);

    expect(zona).toBeDefined();

    await Empresa.update({ timezone: zona }, { where: { id: 1 } });

    const hoyDelNegocioDeLaEmpresa = fechaDelNegocio(zona);

    // Dos ventas: una el «hoy» del negocio y otra el día siguiente. Con la fecha
    // del negocio, entra la primera y no la segunda. Con la fecha UTC entra la
    // otra —según para qué lado esté corrida la zona—, así que este par
    // distingue el defecto en las dos direcciones.
    await venta('V-HOY-DEL-NEGOCIO', { date: hoyDelNegocioDeLaEmpresa, total: 777.77 });
    await venta('V-MANANA', { date: sumarDias(hoyDelNegocioDeLaEmpresa, 1), total: 999.99 });

    // Sin `hoy`: el servicio tiene que resolverlo con `hoyDelNegocio(empresaId)`.
    const kpis = await dashboardService.getKpis(1);

    expect(kpis.sales_30d.total).toBe(777.77);
    expect(kpis.sales_30d.count).toBe(1);
  });

  it('rotula que la comparación es contra un mes parcial', async () => {
    const kpis = await dashboardService.getKpis(1, { hoy: primerDiaDelMes(HOY) });

    // El día 1 el mes está recién empezado: comparar su total contra un mes
    // entero da −99 % y no significa nada si no se dice.
    expect(kpis.comparacion_parcial).toBe(true);

    const ultimoDiaDelMes = sumarDias(primerDiaDelMes(HOY, 1), -1);
    const completo = await dashboardService.getKpis(1, { hoy: ultimoDiaDelMes });

    expect(completo.comparacion_parcial).toBe(false);
  });

  it('las ventas de HOY entran en los últimos 30 días', async () => {
    // El corte superior es semiabierto: sin correrlo un día, arreglar P4 habría
    // dejado de contar las ventas del día en curso.
    await venta('V-DE-HOY', { date: HOY, total: 55.55 });

    const kpis = await dashboardService.getKpis(1, { hoy: HOY });

    expect(kpis.sales_30d.total).toBe(55.55);
  });
});

// ════════════════════════════════════════════
//  T1357 · «Stock bajo» con la regla de utils/stockBajo.js
// ════════════════════════════════════════════

describe('Stock bajo', () => {
  beforeEach(async () => {
    // ⚠ El producto EN CERO SIN mínimo cargado es el que la regla vieja no ve y
    // la nueva sí. Sin él, unificar la regla no cambia ningún número y el test
    // pasaría con el `literal` puesto.
    const azucar = await Product.create({
      empresa_id: 1, name: 'Azúcar', sku: 'AZU-001', cost: 900, unit_type: 'kg',
    });
    await Stock.create({
      empresa_id: 1, product_id: azucar.id, punto_de_venta_id: datos.centroA.id,
      location: 'centro', quantity: 0, available: 0, min_stock: 0,
    });

    // Este lo ven las dos reglas: tiene mínimo cargado y está por debajo.
    const manteca = await Product.create({
      empresa_id: 1, name: 'Manteca', sku: 'MAN-001', cost: 2000, unit_type: 'kg',
    });
    await Stock.create({
      empresa_id: 1, product_id: manteca.id, punto_de_venta_id: datos.centroA.id,
      location: 'centro', quantity: 5, available: 5, min_stock: 10,
    });

    // Discontinuado: en cero y sin mínimo, pero `is_active: false`. No se repone
    // lo que se dejó de vender.
    const discontinuado = await Product.create({
      empresa_id: 1, name: 'Colorante viejo', sku: 'COL-001', cost: 10,
      unit_type: 'unidad', is_active: false,
    });
    await Stock.create({
      empresa_id: 1, product_id: discontinuado.id, punto_de_venta_id: datos.centroA.id,
      location: 'centro', quantity: 0, available: 0, min_stock: 0,
    });
  });

  it('un producto en cero SIN mínimo cargado cuenta como stock bajo, igual que en Faltantes', async () => {
    const { products } = await dashboardService.getKpis(1, { hoy: HOY });

    // Azúcar (0 sin mínimo) y Manteca (5 con mínimo 10). Con la regla vieja
    // —`min_stock > 0`— habría sido uno solo.
    expect(products.low_stock).toBe(2);
  });

  it('un producto dado de baja NO cuenta, aunque esté en cero', async () => {
    const { products } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(products.low_stock).toBe(2);

    const nombres = (await dashboardService._lowStockAlerts(50, 1)).map((a) => a.product_name);

    expect(nombres).toContain('Azúcar');
    expect(nombres).toContain('Manteca');
    expect(nombres).not.toContain('Colorante viejo');
  });

  it('el aviso trae el producto en cero sin mínimo, que es el que la regla vieja escondía', async () => {
    const { alerts } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(alerts.low_stock.map((a) => a.product_name)).toContain('Azúcar');
  });

  it('el stock de la otra empresa no entra', async () => {
    await Stock.update({ quantity: 0, min_stock: 0 }, { where: { empresa_id: datos.empresaB.id } });

    const { products } = await dashboardService.getKpis(1, { hoy: HOY });

    expect(products.low_stock).toBe(2);
  });
});

// ════════════════════════════════════════════
//  T1358 · El recorte por permiso
// ════════════════════════════════════════════

describe('El recorte por permiso', () => {
  it('un rol sin caja.ver NO recibe la clave cashflow: no la recibe en cero, no la recibe', async () => {
    const data = await dashboardService.getKpis(1, {
      hoy: HOY,
      permisos: await permisosDelRol('produccion'),
    });

    expect('cashflow' in data).toBe(false);
    expect('receivables' in data).toBe(false);
    expect('payables' in data).toBe(false);
    expect('fixed_expenses' in data).toBe(false);
    expect('with_debt' in data.customers).toBe(false);

    // Lo que sí le corresponde sigue viniendo.
    expect(data.sales_30d).toBeDefined();
    expect(data.products).toBeDefined();
    expect(data.customers.active).toBeDefined();
  });

  it('cada rol del catálogo recibe exactamente los bloques de sus pantallas', async () => {
    const esperado = {
      admin: ['cashflow', 'receivables', 'payables', 'fixed_expenses'],
      gerente: ['cashflow', 'receivables', 'payables', 'fixed_expenses'],
      // vendedor tiene caja.ver y clientes.ver; no tiene proveedores.ver ni gastos.ver.
      vendedor: ['cashflow', 'receivables'],
      produccion: [],
      // compras tiene proveedores.ver y nada más de los cuatro.
      compras: ['payables'],
    };

    for (const [rol, bloques] of Object.entries(esperado)) {
      const data = await dashboardService.getKpis(1, {
        hoy: HOY,
        permisos: await permisosDelRol(rol),
      });

      for (const bloque of ['cashflow', 'receivables', 'payables', 'fixed_expenses']) {
        expect({ rol, bloque, presente: bloque in data })
          .toEqual({ rol, bloque, presente: bloques.includes(bloque) });
      }
    }
  });

  it('sin pasar permisos no se recorta nada: el llamador interno pide el panel entero', async () => {
    const data = await dashboardService.getKpis(1, { hoy: HOY });

    expect('cashflow' in data).toBe(true);
    expect('payables' in data).toBe(true);
    expect('fixed_expenses' in data).toBe(true);
  });
});

// ════════════════════════════════════════════
//  El endpoint, con la sesión de la empresa A
// ════════════════════════════════════════════

describe('GET /api/dashboard/kpis', () => {
  it('con la sesión admin devuelve los bloques completos y en números', async () => {
    const res = await request(app).get('/api/dashboard/kpis');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { data } = res.body;

    expect(typeof data.payables.total).toBe('number');
    expect(data.payables.total).toBe(400.25);
    expect(typeof data.fixed_expenses).toBe('number');
    expect(sumaDeTramos(data.payables.aging)).toBe(data.payables.total);
  });

  it('con la sesión de un rol sin caja.ver, la respuesta llega SIN la clave cashflow', async () => {
    const rolProduccion = await Rol.findOne({ where: { nombre: 'produccion', empresa_id: null } });

    await UsuarioEmpresa.update(
      { rol_id: rolProduccion.id },
      { where: { usuario_id: datos.usuarioA.id, empresa_id: 1 } }
    );

    const res = await request(app).get('/api/dashboard/kpis');

    expect(res.status).toBe(200);
    expect('cashflow' in res.body.data).toBe(false);
    expect('payables' in res.body.data).toBe(false);
    expect(res.body.data.sales_30d).toBeDefined();
  });
});
