// ════════════════════════════════════════════
//  customerService · cuenta corriente de clientes
//
//  De acá sale cuánto debe cada cliente. Un saldo inflado se traduce en
//  reclamarle plata que no debe; uno deflactado, en no cobrar lo que sí.
// ════════════════════════════════════════════

const { crearModelo, coincide } = require('./helpers/modelosFalsos');
const { repartirPorAntiguedad } = require('../utils/antiguedad');
const { fechaDelNegocio } = require('../utils/fechas');

const mockCustomer = crearModelo([]);
const mockCustomerPayment = crearModelo([]);
const mockSale = crearModelo([]);
const mockSupplierMovement = crearModelo([]);
const mockSequelize = { query: jest.fn() };

// La zona de la empresa. `hoyDelNegocio` la lee de la base, y de ella sale la
// fecha con la que se reparte el aging: sin este doble, los tests de tramos
// probarían el reloj del servidor —que es justamente el defecto—.
const ZONA_DE_LA_EMPRESA = 'America/Argentina/Buenos_Aires';
const mockEmpresa = {
  findByPk: jest.fn(async () => ({ timezone: ZONA_DE_LA_EMPRESA })),
};

jest.mock('../models', () => ({
  Customer: mockCustomer,
  CustomerPayment: mockCustomerPayment,
  Sale: mockSale,
  SupplierMovement: mockSupplierMovement,
  Empresa: mockEmpresa,
  sequelize: mockSequelize,
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
  mockSequelize.query.mockReset();
  mockEmpresa.findByPk.mockClear();
  for (const m of [mockCustomer, mockSale, mockCustomerPayment, mockSupplierMovement]) m.llamadas = [];
});

describe('calculateBalance', () => {
  it('saldo = ventas menos pagos', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '10000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '5000', date: '2026-07-10' },
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
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '10000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'voided', is_credit: true, total: '50000', date: '2026-07-05' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(10000);
  });

  it('no mezcla ventas de otra empresa', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '10000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: 99, status: 'active', is_credit: true, total: '77000', date: '2026-07-01' },
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
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '1000', date: '2026-07-01' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '2500', payment_date: '2026-07-02' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(-1500);
  });


  // Decision de producto (31/07/2026): las ventas son al contado salvo que se
  // marquen como cuenta corriente. Antes toda venta con cliente asignado
  // contaba como deuda, y los saldos estaban inflados con operaciones ya
  // cobradas en el mostrador.
  it('una venta al contado no genera deuda, aunque tenga cliente asignado', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: false, total: '9000', date: '2026-07-01' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(0);
  });

  it('solo suman las ventas marcadas como cuenta corriente', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '5000', date: '2026-07-01' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: false, total: '9000', date: '2026-07-02' },
    ];

    await expect(customerService.calculateBalance(100, EMPRESA)).resolves.toBe(5000);
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
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '1000', date: '2026-07-20' },
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
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '1000', date: '2026-07-20' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '1000', payment_date: '2026-07-21' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(Object.values(aging).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('las ventas anuladas no generan deuda en ningún tramo', async () => {
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'voided', is_credit: true, total: '9000', date: '2026-07-20' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(Object.values(aging).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('reparte el saldo impago proporcionalmente entre los tramos', async () => {
    // Dos ventas de $1000: una de hace 10 días, otra de hace 45.
    // Pagó $1000 de $2000 -> queda 50% impago, prorrateado 50/50.
    mockSale.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '1000', date: '2026-07-21' },
      { id: 2, customer_id: 100, empresa_id: EMPRESA, status: 'active', is_credit: true, total: '1000', date: '2026-06-16' },
    ];
    mockCustomerPayment.filas = [
      { id: 1, customer_id: 100, empresa_id: EMPRESA, amount: '1000', payment_date: '2026-07-22' },
    ];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(aging['0_30']).toBe(500);
    expect(aging['31_60']).toBe(500);
  });
});

// ════════════════════════════════════════════
//  El aging corta con la fecha del NEGOCIO, no con la del servidor
//
//  El mismo saldo caía en «0 a 30» en el Panel y en «31 a 60» en Clientes: el
//  Panel reparte con `hoyDelNegocio` y estos dos métodos repartían con
//  `new Date()`, que es el instante del servidor. Un cliente que aparece en un
//  tramo distinto según dónde se lo mire no tiene tramo.
//
//  ⚠ **La hora de la fixture es la mitad del test.** A las 10:00 de Buenos Aires
//  la fecha UTC y la del negocio son la misma, el reparto da igual con y sin la
//  corrección, y el test pasaría siempre. El defecto solo existe entre las 21:00
//  y las 24:00 locales, que es cuando UTC ya está en el día siguiente.
// ════════════════════════════════════════════

describe('El aging usa la fecha del negocio y no la del servidor', () => {
  // 23:25 del 31 de julio en Buenos Aires. En UTC ya es el 1 de agosto.
  const ANOCHECER_ARGENTINO = new Date('2026-08-01T02:25:00Z');

  // Exactamente 30 días de antigüedad contra la fecha del negocio (31 de julio),
  // que es el borde del primer tramo: con la fecha del servidor son 31 y cae en
  // el siguiente. Una venta de en medio del tramo no distinguiría nada.
  const VENTA_DE_HACE_30_DIAS = {
    id: 1, customer_id: 100, empresa_id: EMPRESA,
    status: 'active', is_credit: true, total: '1000', date: '2026-07-01',
  };

  /** El reparto tal como lo hace el Panel: misma función, fecha del negocio. */
  function comoLoMuestraElPanel(filas, saldo) {
    return repartirPorAntiguedad(filas, fechaDelNegocio(ZONA_DE_LA_EMPRESA), {
      saldoImpago: saldo,
      totalFacturado: saldo,
      fecha: 'date',
      importe: 'total',
    });
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(ANOCHECER_ARGENTINO);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a las 23:25 de Buenos Aires la fecha del negocio NO es la fecha UTC del servidor', () => {
    // Sin esto, alguien puede correr la hora de la fixture y los dos tests de
    // abajo seguirían en verde sin poder distinguir nada.
    expect(fechaDelNegocio(ZONA_DE_LA_EMPRESA)).toBe('2026-07-31');
    expect(new Date().toISOString().split('T')[0]).toBe('2026-08-01');
  });

  it('calculateAging pone la venta de hace 30 días en «0 a 30», el mismo tramo que el Panel', async () => {
    mockSale.filas = [VENTA_DE_HACE_30_DIAS];

    const aging = await customerService.calculateAging(100, EMPRESA);

    expect(aging).toEqual(comoLoMuestraElPanel([VENTA_DE_HACE_30_DIAS], 1000));
    expect(aging['0_30']).toBe(1000);
    expect(aging['31_60']).toBe(0);
  });

  it('getSummary reparte el saldo de clientes en el mismo tramo que el Panel', async () => {
    mockSale.filas = [VENTA_DE_HACE_30_DIAS];
    // Los dos totales salen de SQL crudo, que acá no corre: el que importa es el
    // de cuentas por cobrar, y es el que los cuatro tramos tienen que sumar.
    mockSequelize.query
      .mockResolvedValueOnce([{ total: '1000' }])
      .mockResolvedValueOnce([{ total: '0' }]);

    const { aging } = await customerService.getSummary(EMPRESA);

    expect(aging).toEqual(comoLoMuestraElPanel([VENTA_DE_HACE_30_DIAS], 1000));
    expect(aging['0_30']).toBe(1000);
    expect(aging['31_60']).toBe(0);
  });
});

// ════════════════════════════════════════════
//  La fecha que se GUARDA es la del negocio, no la del servidor
//
//  El aging pasó a cortar con `hoyDelNegocio` en este mismo hito. Pero la fecha
//  con la que se ESCRIBE una cobranza seguía saliendo de
//  `new Date().toISOString()`, que pasa por UTC: una cobranza cargada a las
//  22:00 en Argentina quedaba fechada MAÑANA.
//
//  Con las dos puntas midiendo con relojes distintos, la fila entra al aging con
//  fecha futura y el corte de mes la cuenta en el mes que no es. Lo encontró la
//  corrección del aging: arreglar el lado de la lectura dejó el de la escritura
//  más expuesto, no menos.
// ════════════════════════════════════════════

describe('La cobranza se fecha con el día del negocio', () => {
  const EMPRESA = 3;

  beforeEach(() => {
    mockCustomer.filas = [{ id: 40, empresa_id: EMPRESA, name: 'Kiosco Rivadavia' }];
    mockCustomerPayment.filas = [];
    mockCustomerPayment.llamadas = [];
  });

  it('a las 22:00 en Argentina NO se fecha mañana', async () => {
    // 2026-08-01T01:30:00Z son las 22:30 del 31/7 en Argentina. Es el instante
    // que DISCRIMINA: con cualquier hora del mediodía las dos fechas coinciden y
    // el caso pasaría con y sin la corrección.
    // Relojes falsos y no un espía sobre `Date.now`: `hoyDelNegocio` construye
    // un `new Date()`, que `Date.now` no intercepta. Con el espía solo, el test
    // se ejecuta contra la fecha real y pasa o falla según qué día se corra —
    // que es peor que no tenerlo.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T01:30:00Z'));

    try {
      await customerService.registerPayment(40, { amount: 5000 }, EMPRESA);

      const guardada = mockCustomerPayment.filas[0].payment_date;

      expect(guardada).toBe('2026-07-31');
      expect(guardada).not.toBe('2026-08-01');

      // Y que sea exactamente lo que la utilidad compartida diría para ese
      // instante: si mañana cambia la forma de resolver el día del negocio, este
      // caso tiene que seguir hablando de lo mismo.
      expect(guardada).toBe(fechaDelNegocio(ZONA_DE_LA_EMPRESA));
    } finally {
      jest.useRealTimers();
    }
  });

  it('una fecha explícita del usuario manda sobre la de hoy', async () => {
    // Sin este caso, una corrección que ignorara `data.payment_date` pasaría el
    // anterior — y cargar una cobranza atrasada quedaría imposible.
    await customerService.registerPayment(40, { amount: 5000, payment_date: '2026-05-02' }, EMPRESA);

    expect(mockCustomerPayment.filas[0].payment_date).toBe('2026-05-02');
  });
});
