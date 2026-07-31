// ════════════════════════════════════════════
//  customerService · cuenta corriente de clientes
//
//  De acá sale cuánto debe cada cliente. Un saldo inflado se traduce en
//  reclamarle plata que no debe; uno deflactado, en no cobrar lo que sí.
// ════════════════════════════════════════════

const { crearModelo, coincide } = require('./helpers/modelosFalsos');

const mockCustomer = crearModelo([]);
const mockCustomerPayment = crearModelo([]);
const mockSale = crearModelo([]);
const mockSupplierMovement = crearModelo([]);

jest.mock('../models', () => ({
  Customer: mockCustomer,
  CustomerPayment: mockCustomerPayment,
  Sale: mockSale,
  SupplierMovement: mockSupplierMovement,
  sequelize: { query: jest.fn() },
}));

const customerService = require('../services/customerService');

// El where real usa operadores de Sequelize (Op.ne, Op.iLike) que el doble no
// interpreta. Para estos tests interesan las igualdades: empresa, cliente y
// status.
function soloIgualdades(where = {}) {
  const limpio = {};
  for (const [k, v] of Object.entries(where)) {
    if (typeof k === 'symbol') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) continue;
    limpio[k] = v;
  }
  return limpio;
}

for (const modelo of [mockSale, mockCustomerPayment, mockSupplierMovement]) {
  modelo.sum = async (campo, opciones = {}) => {
    modelo.llamadas.push({ metodo: 'sum', campo, ...opciones });
    for (const [c, v] of Object.entries(opciones.where || {})) {
      if (v === undefined) throw new Error(`WHERE parameter "${c}" has invalid "undefined" value`);
    }
    const filas = modelo.filas.filter((f) => coincide(f, soloIgualdades(opciones.where)));
    if (filas.length === 0) return null;
    return String(filas.reduce((acc, f) => acc + parseFloat(f[campo] || 0), 0));
  };

  const findAllBase = modelo.findAll;
  modelo.findAll = async (opciones = {}) => {
    modelo.llamadas.push({ metodo: 'findAll', ...opciones });
    for (const [c, v] of Object.entries(opciones.where || {})) {
      if (v === undefined) throw new Error(`WHERE parameter "${c}" has invalid "undefined" value`);
    }
    return modelo.filas.filter((f) => coincide(f, soloIgualdades(opciones.where)));
  };
  void findAllBase;
}

const EMPRESA = 7;

beforeEach(() => {
  mockCustomer.filas = [{ id: 100, empresa_id: EMPRESA, name: 'Panadería Sur', is_active: true }];
  mockSale.filas = [];
  mockCustomerPayment.filas = [];
  mockSupplierMovement.filas = [];
  for (const m of [mockCustomer, mockSale, mockCustomerPayment, mockSupplierMovement]) m.llamadas = [];
});

describe('calculateBalance', () => {
  it('saldo = ventas menos pagos', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '10000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '5000', date: '2026-07-10' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '4000', payment_date: '2026-07-15' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(11000);
  });

  // Una venta anulada no genera deuda. Si se cuenta, se le reclama al cliente
  // plata por una operación que se dio de baja.
  it('no cuenta las ventas anuladas', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '10000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'voided', total: '50000', date: '2026-07-05' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(10000);
  });

  it('no mezcla ventas de otra empresa', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '10000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: 99, status: 'active', total: '77000', date: '2026-07-01' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(10000);
  });

  it('un cliente sin movimientos tiene saldo cero, no NaN', async () => {
    const saldo = await customerService.calculateBalance(100, EMPRESA);

    expect(saldo).toBe(0);
    expect(Number.isNaN(saldo)).toBe(false);
  });

  it('si el cliente pagó de más, el saldo queda negativo (saldo a favor)', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '1000', date: '2026-07-01' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '2500', payment_date: '2026-07-02' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(-1500);
  });

  it('exige empresaId en vez de operar sobre una empresa arbitraria', async () => {
    await expect(customerService.calculateBalance(100, undefined))
      .rejects.toThrow(/Scoping por empresa invalido/);
  });
});

describe('calculateAging', () => {
  const HOY = new Date('2026-07-31T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(HOY);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ubica la deuda en el tramo correcto según la antigüedad', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '1000', date: '2026-07-20' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(aging['0_30']).toBe(1000);
    expect(aging['31_60']).toBe(0);
  });

  it('sin ventas devuelve todos los tramos en cero, no NaN', async () => {
    const aging = await customerService.calculateAging(100, EMPRESA);

    for (const tramo of Object.values(aging)) {
      expect(Number.isNaN(tramo)).toBe(false);
      expect(tramo).toBe(0);
    }
  });

  it('si está todo pagado, no queda deuda en ningún tramo', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '1000', date: '2026-07-20' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '1000', payment_date: '2026-07-21' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(Object.values(aging).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('las ventas anuladas no generan deuda en ningún tramo', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'voided', total: '9000', date: '2026-07-20' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(Object.values(aging).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('reparte el saldo impago proporcionalmente entre los tramos', async () => {
    // Dos ventas de $1000: una de hace 10 días, otra de hace 45.
    // Pagó $1000 de $2000 -> queda 50% impago, prorrateado 50/50.
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '1000', date: '2026-07-21' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'active', total: '1000', date: '2026-06-16' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '1000', payment_date: '2026-07-22' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(aging['0_30']).toBe(500);
    expect(aging['31_60']).toBe(500);
  });
});
