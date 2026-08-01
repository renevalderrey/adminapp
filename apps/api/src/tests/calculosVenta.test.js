// ════════════════════════════════════════════
//  Calculos de venta
//
//  El total de la venta es el registro contable de la operacion y lo que se
//  declara ante ARCA. Tiene que salir de las lineas, no del body del request.
// ════════════════════════════════════════════

const {
  aCentavos,
  normalizarItem,
  calcularTotal,
  verificarTotal,
  metodoDePago,
  esPagoMixto,
  normalizarNombreDeCliente,
  LARGO_MAXIMO_NOMBRE,
} = require('../utils/calculosVenta');

describe('aCentavos', () => {
  it('redondea a dos decimales', () => {
    expect(aCentavos(10.456)).toBe(10.46);
    expect(aCentavos(10.454)).toBe(10.45);
  });

  it('convierte valores no numericos en cero, sin devolver NaN', () => {
    expect(aCentavos(undefined)).toBe(0);
    expect(aCentavos(null)).toBe(0);
    expect(aCentavos('abc')).toBe(0);
  });

  it('interpreta strings numericos, que es como llegan los DECIMAL de Postgres', () => {
    expect(aCentavos('150.50')).toBe(150.5);
  });
});

describe('normalizarItem', () => {
  it('acepta los nombres de campo nuevos', () => {
    const r = normalizarItem({ product_name: 'Pan', quantity: 3, unit_price: 100 });

    expect(r).toMatchObject({ product_name: 'Pan', quantity: 3, unit_price: 100 });
  });

  // El frontend mando estos nombres en distintas epocas. Se aceptan para no
  // romper clientes viejos.
  it('acepta los alias historicos qty/price y name', () => {
    const r = normalizarItem({ name: 'Pan', qty: 2, price: 50 });

    expect(r).toMatchObject({ product_name: 'Pan', quantity: 2, unit_price: 50 });
  });

  it('un item sin datos no produce NaN', () => {
    const r = normalizarItem({});

    expect(r.quantity).toBe(1);
    expect(r.unit_price).toBe(0);
    expect(r.product_name).toBe('Producto');
  });

  it('cantidad o precio no numericos caen en cero', () => {
    const r = normalizarItem({ qty: 'dos', price: 'gratis' });

    expect(r.quantity).toBe(0);
    expect(r.unit_price).toBe(0);
  });
});

describe('calcularTotal', () => {
  it('suma cantidad por precio de cada linea', () => {
    expect(calcularTotal([
      { quantity: 2, unit_price: 100 },
      { quantity: 1, unit_price: 50.5 },
    ])).toBe(250.5);
  });

  it('un carrito vacio da cero', () => {
    expect(calcularTotal([])).toBe(0);
  });

  it('cantidad cero no aporta', () => {
    expect(calcularTotal([{ quantity: 0, unit_price: 999 }])).toBe(0);
  });

  // Redondear linea por linea es lo que hace el ticket impreso. Sumar en
  // punto flotante y redondear al final da un centavo de diferencia.
  it('redondea cada linea antes de sumar', () => {
    expect(calcularTotal([
      { quantity: 3, unit_price: 0.335 },
      { quantity: 3, unit_price: 0.335 },
    ])).toBe(2.02);
  });

  it('acepta precios como string', () => {
    expect(calcularTotal([{ quantity: '2', unit_price: '99.99' }])).toBe(199.98);
  });
});

describe('verificarTotal', () => {
  it('acepta un total que coincide con las lineas', () => {
    const r = verificarTotal(250.5, [
      { quantity: 2, unit_price: 100 },
      { quantity: 1, unit_price: 50.5 },
    ]);

    expect(r.ok).toBe(true);
    expect(r.total).toBe(250.5);
  });

  it('tolera una diferencia de centavos por redondeo del frontend', () => {
    const r = verificarTotal(250.51, [
      { quantity: 2, unit_price: 100 },
      { quantity: 1, unit_price: 50.5 },
    ]);

    expect(r.ok).toBe(true);
  });

  // El caso que motiva todo esto: el cliente declara un total que no tiene
  // nada que ver con lo que se lleva.
  it('rechaza un total inventado', () => {
    const r = verificarTotal(1, [
      { quantity: 10, unit_price: 1000 },
    ]);

    expect(r.ok).toBe(false);
    expect(r.total).toBe(10000);
    expect(r.declarado).toBe(1);
  });

  it('rechaza una diferencia de un peso, que ya es un error real', () => {
    const r = verificarTotal(101, [{ quantity: 1, unit_price: 100 }]);

    expect(r.ok).toBe(false);
    expect(r.diferencia).toBe(1);
  });

  it('sin total declarado usa el calculado', () => {
    expect(verificarTotal(undefined, [{ quantity: 2, unit_price: 100 }]))
      .toEqual({ ok: true, total: 200 });
    expect(verificarTotal(null, [{ quantity: 2, unit_price: 100 }]).total).toBe(200);
  });

  // El total que se guarda es SIEMPRE el calculado, incluso cuando el
  // declarado entra por tolerancia: es el unico que cierra contra las lineas.
  it('guarda el total calculado, no el declarado', () => {
    const r = verificarTotal(250.51, [
      { quantity: 2, unit_price: 100 },
      { quantity: 1, unit_price: 50.5 },
    ]);

    expect(r.total).toBe(250.5);
  });
});

describe('metodoDePago', () => {
  // Antes la ruta tomaba el metodo del PRIMER item. Una venta con lineas de
  // distinto metodo quedaba registrada entera bajo el de la primera linea, y
  // el resumen por metodo de pago mentia.
  it('si todas las lineas comparten metodo, devuelve ese', () => {
    expect(metodoDePago([
      { payment_method: 'tarjeta' },
      { payment_method: 'tarjeta' },
    ])).toBe('tarjeta');
  });

  it('acepta el alias historico "method"', () => {
    expect(metodoDePago([{ method: 'tr' }])).toBe('tr');
  });

  // null significa "las lineas no alcanzan para decidir". La ruta cae en ese
  // caso al valor declarado por el cliente, para no inventar una categoria
  // nueva en los reportes.
  it('si las lineas difieren, devuelve null', () => {
    expect(metodoDePago([
      { payment_method: 'ef' },
      { payment_method: 'tarjeta' },
    ])).toBeNull();
  });

  it('sin metodo en las lineas devuelve null', () => {
    expect(metodoDePago([{ quantity: 1 }])).toBeNull();
    expect(metodoDePago([])).toBeNull();
  });

  it('ignora las lineas sin metodo al buscar unanimidad', () => {
    expect(metodoDePago([
      { payment_method: 'tarjeta' },
      { quantity: 1 },
    ])).toBe('tarjeta');
  });
});

describe('esPagoMixto', () => {
  it('detecta lineas con metodos distintos', () => {
    expect(esPagoMixto([{ payment_method: 'ef' }, { payment_method: 'tc1' }])).toBe(true);
  });

  it('no marca como mixta una venta con un solo metodo', () => {
    expect(esPagoMixto([{ payment_method: 'ef' }, { payment_method: 'ef' }])).toBe(false);
    expect(esPagoMixto([])).toBe(false);
  });
});

describe('normalizarNombreDeCliente', () => {
  // Este campo pasa a llenarse con texto tipeado a mano en el mostrador, sin
  // ficha de cliente. Antes solo llegaba desde una ficha, ya validada.
  it('deja pasar un nombre normal', () => {
    expect(normalizarNombreDeCliente('Vega, Marcela')).toBe('Vega, Marcela');
  });

  // El caso caro: la columna es VARCHAR(255). Sin el recorte, un nombre mas
  // largo hace que Postgres rechace el INSERT y LA VENTA NO SE REGISTRE. Un
  // error de tipeo no puede tumbar un cobro.
  it('un nombre de 300 caracteres queda en 255 y no rompe el INSERT', () => {
    const largo = 'a'.repeat(300);
    const r = normalizarNombreDeCliente(largo);

    expect(r).toHaveLength(255);
    expect(r).toHaveLength(LARGO_MAXIMO_NOMBRE);
  });

  it('recorta los espacios de sobra que deja el mostrador', () => {
    expect(normalizarNombreDeCliente('   Vega, Marcela   ')).toBe('Vega, Marcela');
    expect(normalizarNombreDeCliente('\n Perez \t')).toBe('Perez');
  });

  // En la base, «no se anoto ningun nombre» es NULL: la pantalla lo muestra
  // como «Consumidor final». Una cadena vacia se veria como un cliente sin
  // nombre, que es otra cosa.
  it('vacio, espacios y nulos dan null y no cadena vacia', () => {
    expect(normalizarNombreDeCliente('')).toBeNull();
    expect(normalizarNombreDeCliente('    ')).toBeNull();
    expect(normalizarNombreDeCliente(null)).toBeNull();
    expect(normalizarNombreDeCliente(undefined)).toBeNull();
    expect(normalizarNombreDeCliente()).toBeNull();
  });

  it('un valor que no es texto no produce "undefined" ni "[object Object]"', () => {
    expect(normalizarNombreDeCliente(0)).toBeNull();
    expect(normalizarNombreDeCliente(false)).toBeNull();
  });
});
