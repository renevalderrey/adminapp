// ════════════════════════════════════════════
//  Lo que se escribe en el archivo del historial de ventas
//
//  Estas funciones vivian adentro del handler de GET /api/sales/export, donde
//  ningun test las alcanzaba. La verificacion revirtio tres requisitos —la
//  etiqueta de estado, el CAE como texto, el total como numero— y las pruebas
//  siguieron pasando enteras.
//
//  Los tres fallan en silencio: el archivo se genera, se descarga, abre en
//  Excel y se ve bien. Lo unico que pasa es que el total no da, o que el CAE
//  que hay que dictarle a ARCA termina en 1,2345678901234E+13.
// ════════════════════════════════════════════

const {
  filaDeExport,
  numeroDeComprobanteFormateado,
  totalDelPeriodo,
} = require('../utils/exportVentas');
const { ETIQUETAS } = require('../utils/estadoVenta');

/** Una venta autorizada, con todo cargado. Cada test cambia lo suyo. */
function venta(extra = {}) {
  return {
    id: 'sale_1754321098765',
    date: '2026-07-30',
    time: '14:22',
    total: '18450.50',
    payment_method: 'tc3v',
    customer_id: 12,
    customer_name: 'Vega, Marisa',
    customer: { id: 12, name: 'Vega Marisa SRL' },
    puntoDeVenta: { id: 3, name: 'Ortiz' },
    afip_type: 6,
    afip_pv: 5,
    afip_nro: 14882,
    afip_cae: '75123456789012',
    afip_ultimo_error: null,
    status: 'active',
    ...extra,
  };
}

describe('El total va como NUMERO: una columna de texto no suma en la planilla', () => {
  // El DECIMAL vuelve como string desde el driver de Postgres. Si se copia tal
  // cual, Excel escribe una celda de texto: el archivo abre, se ve bien, y
  // arrastrar la columna Total da cero.
  it('convierte el string del driver a numero', () => {
    const fila = filaDeExport(venta({ total: '18450.50' }));

    expect(typeof fila.total).toBe('number');
    expect(fila.total).toBe(18450.5);
  });

  it('una venta sin total no escribe null ni texto vacio: escribe 0', () => {
    expect(filaDeExport(venta({ total: null })).total).toBe(0);
    expect(filaDeExport(venta({ total: undefined })).total).toBe(0);
    expect(filaDeExport(venta({ total: '' })).total).toBe(0);
  });

  it('la suma de la columna Total da el numero esperado, no una concatenacion', () => {
    const filas = [
      filaDeExport(venta({ total: '1000.10' })),
      filaDeExport(venta({ total: '2000.20' })),
      filaDeExport(venta({ total: '3000.30' })),
    ];

    expect(filas.reduce((acc, f) => acc + f.total, 0)).toBeCloseTo(6000.6, 2);
  });
});

describe('El CAE va como TEXTO: 14 digitos no entran en un numero de Excel', () => {
  // Excel convierte un numero de 14 digitos a notacion cientifica y pierde los
  // ultimos. El CAE es lo que hay que dictarle a ARCA para verificar el
  // comprobante: perder digitos lo vuelve inservible.
  it('el CAE de 14 digitos queda como string, completo', () => {
    const fila = filaDeExport(venta({ afip_cae: '75123456789012' }));

    expect(typeof fila.cae).toBe('string');
    expect(fila.cae).toBe('75123456789012');
    expect(fila.cae).toHaveLength(14);
  });

  it('un CAE con ceros a la izquierda no los pierde', () => {
    expect(filaDeExport(venta({ afip_cae: '00123456789012' })).cae).toBe('00123456789012');
  });

  it('una venta sin CAE deja la celda vacia, no «null»', () => {
    expect(filaDeExport(venta({ afip_cae: null })).cae).toBe('');
  });
});

describe('La columna Estado dice lo mismo que el badge de la pantalla', () => {
  // Si el archivo derivara el estado por su cuenta, terminaria diciendo algo
  // distinto de lo que el usuario ve en la fila. Sale de estadoVenta, que es
  // el unico lugar donde se decide.
  it.each([
    ['una venta activa con CAE', { status: 'active', afip_cae: '75123456789012' }, 'Autorizada'],
    ['una venta activa sin CAE ni error', { status: 'active', afip_cae: null }, 'Registrada'],
    [
      'una venta rechazada por ARCA',
      { status: 'active', afip_cae: null, afip_ultimo_error: 'El CUIT no existe' },
      'Rechazada',
    ],
    ['una venta anulada sin CAE', { status: 'voided', afip_cae: null }, 'Anulada'],
    [
      'una venta anulada CON CAE, que sigue vigente ante ARCA',
      { status: 'voided', afip_cae: '75123456789012' },
      'Anulada · vigente ante ARCA',
    ],
  ])('%s escribe «%s»', (_caso, campos, etiqueta) => {
    expect(filaDeExport(venta(campos)).estado).toBe(etiqueta);
  });

  // No es el `status` crudo de la base: 'active' / 'voided' no le dice nada al
  // usuario y ademas esconde los tres estados que importan.
  it('NO escribe el status crudo de la base', () => {
    const fila = filaDeExport(venta({ status: 'active', afip_cae: null }));

    expect(fila.estado).not.toBe('active');
    expect(Object.values(ETIQUETAS)).toContain(fila.estado);
  });
});

describe('El tipo de comprobante se escribe con su nombre', () => {
  it.each([
    [1, 'Factura A'],
    [6, 'Factura B'],
    [11, 'Factura C'],
  ])('afip_type %i → «%s»', (tipo, etiqueta) => {
    expect(filaDeExport(venta({ afip_type: tipo })).tipo).toBe(etiqueta);
  });

  // Los remitos, recibos X y todo lo que se registro sin pedir CAE. Escribir
  // el numero crudo —o vacio— deja una columna que no se puede filtrar.
  it('una venta sin comprobante fiscal lo dice, no deja el codigo ni un vacio', () => {
    expect(filaDeExport(venta({ afip_type: null })).tipo).toBe('Sin comprobante fiscal');
    expect(filaDeExport(venta({ afip_type: 99 })).tipo).toBe('Sin comprobante fiscal');
  });
});

describe('El numero de comprobante identifica ante ARCA', () => {
  // La numeracion es correlativa POR punto de venta: el numero suelto no
  // identifica nada.
  it('lleva el punto de venta y el numero, con ceros: «0005-00014882»', () => {
    expect(numeroDeComprobanteFormateado(venta())).toBe('0005-00014882');
  });

  it('una venta sin CAE no tiene numero de comprobante: va el id de la operacion', () => {
    const sinCae = venta({ afip_cae: null });

    expect(numeroDeComprobanteFormateado(sinCae)).toBe(sinCae.id);
  });

  it('una venta con CAE pero sin numero tampoco lo inventa', () => {
    const sinNro = venta({ afip_nro: null });

    expect(numeroDeComprobanteFormateado(sinNro)).toBe(sinNro.id);
  });

  it('la fila usa el mismo numero que se dicta por telefono', () => {
    expect(filaDeExport(venta()).comprobante).toBe('0005-00014882');
  });
});

describe('Cliente, sucursal y medio de pago', () => {
  it('el nombre sale de la ficha antes que del nombre libre de la venta', () => {
    expect(filaDeExport(venta()).cliente).toBe('Vega Marisa SRL');
  });

  it('sin ficha, sale el nombre libre escrito en la venta', () => {
    expect(filaDeExport(venta({ customer: null })).cliente).toBe('Vega, Marisa');
  });

  it('sin ficha ni nombre libre, es consumidor final', () => {
    expect(filaDeExport(venta({ customer: null, customer_name: null })).cliente)
      .toBe('Consumidor final');
  });

  it('la sucursal sale de la relacion, y sin sucursal queda un guion', () => {
    expect(filaDeExport(venta()).sucursal).toBe('Ortiz');
    expect(filaDeExport(venta({ puntoDeVenta: null })).sucursal).toBe('—');
  });

  // Las etiquetas son las del sistema anterior: es lo que el usuario leyo
  // durante años en sus planillas y lo que le permite comparar dos archivos.
  it.each([
    ['ef', 'Efectivo'],
    ['tr', 'Transferencia'],
    ['qr', 'QR'],
    ['td', 'T. Débito'],
    ['tc1', 'Créd. 1 pago'],
    ['tc3v', 'Visa 3c'],
    ['tc3m', 'Master 3c'],
    ['tc3n', 'Naranja 3c'],
    ['al', 'Alianza'],
    ['tc', 'T. Crédito'],
    ['tc3', 'T. Crédito 3c'],
  ])('«%s» se escribe «%s»', (codigo, etiqueta) => {
    expect(filaDeExport(venta({ payment_method: codigo })).medio_de_pago).toBe(etiqueta);
  });

  it('el historial NO muestra un codigo de pago sin etiqueta', () => {
    // `tc3` es el codigo que el propio punto de venta escribio en ventas
    // reales durante meses y que no estaba en ninguna lista de etiquetas: se
    // exportaba crudo por el `|| venta.payment_method`, y como eso no hace
    // fallar nada, la planilla decia «tc3» donde tenia que decir una tarjeta.
    expect(filaDeExport(venta({ payment_method: 'tc3' })).medio_de_pago).toBe('T. Crédito 3c');
    expect(filaDeExport(venta({ payment_method: 'tc3' })).medio_de_pago).not.toBe('tc3');
  });

  it('un medio de pago desconocido se escribe tal cual, no se pierde', () => {
    expect(filaDeExport(venta({ payment_method: 'cripto' })).medio_de_pago).toBe('cripto');
  });
});

describe('Las diez columnas, en orden', () => {
  // El orden de las claves es el orden de las columnas del .xlsx. Cambiarlo
  // corre los encabezados sobre datos que no les corresponden: es el defecto 2
  // del relevamiento, el mismo por el que se leia un importe bajo «Estado».
  it('estan las diez y en el orden en que se escriben', () => {
    expect(Object.keys(filaDeExport(venta()))).toEqual([
      'fecha', 'hora', 'tipo', 'comprobante', 'cae',
      'cliente', 'sucursal', 'estado', 'medio_de_pago', 'total',
    ]);
  });
});

describe('El total del periodo llega como numero', () => {
  // Mismo problema que la columna Total: el DECIMAL vuelve como string y la
  // pantalla lo concatena en vez de sumarlo, sin que nada falle.
  it('el string del driver se convierte a numero', () => {
    expect(totalDelPeriodo('184305.75')).toBe(184305.75);
    expect(typeof totalDelPeriodo('184305.75')).toBe('number');
  });

  // Sequelize devuelve null cuando no hay filas que sumar.
  it('un periodo sin ventas es 0, no null ni NaN', () => {
    expect(totalDelPeriodo(null)).toBe(0);
    expect(totalDelPeriodo(undefined)).toBe(0);
    expect(totalDelPeriodo('')).toBe(0);
    expect(totalDelPeriodo(NaN)).toBe(0);
  });

  it('un numero pasa sin tocarse', () => {
    expect(totalDelPeriodo(1234.5)).toBe(1234.5);
  });
});
