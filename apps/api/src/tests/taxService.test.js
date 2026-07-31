// ════════════════════════════════════════════
//  taxService · monotributo
//
//  De acá sale la categoría de monotributo del usuario, y por lo tanto cuánto
//  paga por mes. Un error de cálculo acá hace que declare mal ante ARCA.
// ════════════════════════════════════════════

const { crearModelo } = require('./helpers/modelosFalsos');

const mockTaxConfig = crearModelo([]);
const mockTaxPayment = crearModelo([]);
const mockSale = crearModelo([]);

jest.mock('../models', () => ({
  TaxConfig: mockTaxConfig,
  TaxPayment: mockTaxPayment,
  Sale: mockSale,
  sequelize: {},
}));

const taxService = require('../services/taxService');

// El modelo falso resuelve where con igualdad simple. Las consultas reales
// usan Op.between sobre fechas; para estos tests lo que importa es el filtrado
// por empresa y por status, así que se ignoran las claves de rango.
const { coincide } = require('./helpers/modelosFalsos');

function soloIgualdades(where = {}) {
  const limpio = {};
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) continue; // Op.between, etc.
    limpio[k] = v;
  }
  return limpio;
}

/**
 * Evalua los operadores de Sequelize que usan estas consultas.
 *
 * Interesa sobre todo Op.ne: null, que es como se pregunta "tiene CAE". Sin
 * esto el doble ignoraba la condicion y todas las ventas contaban como
 * facturadas.
 */
function cumpleOperadores(fila, where = {}) {
  for (const [campo, valor] of Object.entries(where)) {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) continue;

    for (const sym of Object.getOwnPropertySymbols(valor)) {
      const esperado = valor[sym];
      const nombre = sym.toString();

      if (nombre.includes('ne')) {
        if (fila[campo] === esperado) return false;
      }
      // Op.between sobre fechas: los tests usan un unico anio, se ignora.
    }
  }
  return true;
}

for (const modelo of [mockSale, mockTaxPayment]) {
  modelo.sum = async (campo, opciones = {}) => {
    modelo.llamadas.push({ metodo: 'sum', campo, ...opciones });
    const filas = modelo.filas.filter(
      (f) => coincide(f, soloIgualdades(opciones.where)) && cumpleOperadores(f, opciones.where)
    );
    if (filas.length === 0) return null;
    return String(filas.reduce((acc, f) => acc + parseFloat(f[campo] || 0), 0));
  };
}

const ESCALAS = [
  { category: 'A', max_income: 6454115.09, monthly: 13257.79 },
  { category: 'B', max_income: 9590471.60, monthly: 14800.84 },
  { category: 'C', max_income: 13426718.17, monthly: 17279.66 },
];

beforeEach(() => {
  mockTaxConfig.filas = [
    { id: 1, tax_type: 'monotributo', empresa_id: 7, config: { scales: ESCALAS } },
    // Config de OTRA empresa, con escalas distintas. Si el service no filtra
    // por empresa, puede tomar esta.
    { id: 2, tax_type: 'monotributo', empresa_id: 99, config: { scales: [{ category: 'Z', max_income: 1, monthly: 999999 }] } },
  ];
  mockSale.filas = [];
  mockTaxPayment.filas = [];
  mockSale.llamadas = [];
  mockTaxPayment.llamadas = [];
});

describe('calculateMonotributo', () => {
  // Regresión: al quitar el default `empresaId = 1` en la auditoría de
  // aislamiento, la llamada interna a getConfig quedó sin argumento. Sequelize
  // rechaza un where con undefined ("WHERE parameter has invalid undefined
  // value"), así que el endpoint devolvía 500.
  it('no explota: pasa la empresa a la consulta de configuración', async () => {
    mockSale.filas = [{ id: 1, empresa_id: 7, total: '1000000', status: 'active', date: '2026-03-01', afip_cae: '7501' }];

    await expect(taxService.calculateMonotributo(2026, 7)).resolves.toBeDefined();
  });

  it('usa las escalas de la empresa que consulta, no las de otra', async () => {
    mockSale.filas = [{ id: 1, empresa_id: 7, total: '1000000', status: 'active', date: '2026-03-01', afip_cae: '7501' }];

    const r = await taxService.calculateMonotributo(2026, 7);

    // Con las escalas de la empresa 7, un millón cae en categoría A.
    // Si tomara las de la empresa 99, caería en "Z".
    expect(r.category).toBe('A');
  });

  it('elige la categoría por facturación anual', async () => {
    mockSale.filas = [{ id: 1, empresa_id: 7, total: '8000000', status: 'active', date: '2026-05-01', afip_cae: '7501' }];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.category).toBe('B');
    expect(r.monthly_amount).toBe(14800.84);
    expect(r.annual_total).toBeCloseTo(14800.84 * 12, 2);
  });

  // Decision de producto (31/07/2026): anular en la app NO da de baja el
  // comprobante ante ARCA. Para eso hace falta una nota de credito, que el
  // sistema todavia no emite. Lo que define la base imponible es el CAE, no
  // el estado interno de la venta.
  it('una venta anulada SIN CAE no cuenta: nunca fue facturada', async () => {
    mockSale.filas = [
      { id: 1, empresa_id: 7, total: '6000000', status: 'active', date: '2026-02-01', afip_cae: '7501' },
      { id: 2, empresa_id: 7, total: '5000000', status: 'voided', date: '2026-03-01', afip_cae: null },
    ];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.annual_billing).toBe(6000000);
    expect(r.category).toBe('A');
  });

  // El caso inverso, y el que protege al usuario de declarar de menos.
  it('una venta anulada CON CAE sigue contando hasta que se emita la NC', async () => {
    mockSale.filas = [
      { id: 1, empresa_id: 7, total: '6000000', status: 'active', date: '2026-02-01', afip_cae: '7501' },
      { id: 2, empresa_id: 7, total: '5000000', status: 'voided', date: '2026-03-01', afip_cae: '7502' },
    ];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.annual_billing).toBe(11000000);
    expect(r.anuladas_con_cae_sin_nc).toBe(5000000);
  });

  // No todo se factura. Lo no facturado no esta en la base imponible, pero la
  // diferencia tiene que quedar a la vista.
  it('las ventas sin CAE no definen la categoria, pero se informan aparte', async () => {
    mockSale.filas = [
      { id: 1, empresa_id: 7, total: '6000000', status: 'active', date: '2026-02-01', afip_cae: '7501' },
      { id: 2, empresa_id: 7, total: '4000000', status: 'active', date: '2026-03-01', afip_cae: null },
    ];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.annual_billing).toBe(6000000);
    expect(r.ventas_totales).toBe(10000000);
    expect(r.sin_facturar).toBe(4000000);
    expect(r.category).toBe('A');
  });

  // Los pagos de impuestos de otra empresa no pueden descontarse de la deuda
  // de esta.
  it('cuenta solo los pagos de la propia empresa', async () => {
    mockSale.filas = [{ id: 1, empresa_id: 7, total: '1000000', status: 'active', date: '2026-02-01', afip_cae: '7501' }];
    mockTaxPayment.filas = [
      { id: 1, empresa_id: 7, tax_type: 'monotributo', amount: '13257.79', payment_date: '2026-01-10' },
      { id: 2, empresa_id: 99, tax_type: 'monotributo', amount: '50000', payment_date: '2026-01-10' },
    ];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.paid_ytd).toBeCloseTo(13257.79, 2);
    expect(r.remaining_ytd).toBeCloseTo(13257.79 * 12 - 13257.79, 2);
  });

  it('sin ventas devuelve la primera categoría y no NaN', async () => {
    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.annual_billing).toBe(0);
    expect(r.category).toBe('A');
    expect(Number.isNaN(r.remaining_ytd)).toBe(false);
  });

  it('si la facturación supera la última escala, cae en la más alta', async () => {
    mockSale.filas = [{ id: 1, empresa_id: 7, total: '99000000', status: 'active', date: '2026-02-01', afip_cae: '7501' }];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.category).toBe('C');
  });

  it('nunca devuelve un remanente negativo si se pagó de más', async () => {
    mockSale.filas = [{ id: 1, empresa_id: 7, total: '1000', status: 'active', date: '2026-02-01', afip_cae: '7501' }];
    mockTaxPayment.filas = [
      { id: 1, empresa_id: 7, tax_type: 'monotributo', amount: '999999999', payment_date: '2026-01-10' },
    ];

    const r = await taxService.calculateMonotributo(2026, 7);

    expect(r.remaining_ytd).toBe(0);
  });
});
