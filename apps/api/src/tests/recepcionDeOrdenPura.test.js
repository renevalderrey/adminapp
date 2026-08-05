// ════════════════════════════════════════════
//  La recepción se aplica a la LÍNEA que se eligió
//
//  Es el defecto 4 de la spec hecho aritmética, sin base y sin transacción.
//
//  El servidor resolvía la línea con
//  `detail.find((d) => d.product_id === received.product_id)`. Una orden con
//  dos líneas del mismo producto —dos presentaciones, dos lotes, o el mismo
//  insumo pedido dos veces— tenía **una sola** línea alcanzable: la primera se
//  llevaba todo. Y dos líneas sin producto colapsaban bajo `undefined`.
//
//  El daño no falla: suma el stock, crea la deuda con el `unit_price` de la
//  línea equivocada, y la pantalla dice «Mercadería recibida».
// ════════════════════════════════════════════

const { aplicarRecepcion } = require('../utils/recepcionDeOrden');

/** Una orden con Colágeno en la posición 0 y otra vez en la 2. */
function detalleConProductoRepetido() {
  return [
    { product_id: 41, product_name: 'Colágeno 300g', quantity: 12, unit_price: 1200, quantity_received: 0 },
    { product_id: 55, product_name: 'Creatina 500g', quantity: 4, unit_price: 8000, quantity_received: 0 },
    { product_id: 41, product_name: 'Colágeno 300g', quantity: 10, unit_price: 1500, quantity_received: 0 },
  ];
}

describe('aplicarRecepcion — la identidad de la línea', () => {
  it('dos líneas del mismo producto son DOS líneas', () => {
    const detail = detalleConProductoRepetido();

    // Se recibe la TERCERA línea (posición 2). El `product_id` viaja igual,
    // porque es lo que manda la pantalla, y no tiene que cambiar el resultado.
    const r = aplicarRecepcion(detail, [{ linea: 2, cantidad: 10, product_id: 41 }]);

    expect(r.detalle[2].quantity_received).toBe(10);
    // La línea 0 es del mismo producto y NO se tocó. Con el `find` viejo se
    // llevaba las 10 unidades, y con ellas el unit_price de 1200 en vez de 1500.
    expect(r.detalle[0].quantity_received).toBe(0);
    expect(r.detalle[1].quantity_received).toBe(0);

    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({ linea: 2, unit_price: 1500, recibido_ahora: 10 });
    // 10 × 1500, y no 10 × 1200: la deuda sale del precio de la línea recibida.
    expect(r.totalRecibido).toBe(15000);
  });

  it('dos líneas sin product_id son DOS líneas', () => {
    // `undefined === undefined` matcheaba la primera con el `find` viejo: dos
    // fletes con importes distintos compartían una sola línea.
    const detail = [
      { product_id: null, product_name: 'Flete', quantity: 1, unit_price: 9000, quantity_received: 0 },
      { product_id: null, product_name: 'Descarga', quantity: 1, unit_price: 4000, quantity_received: 0 },
    ];

    const r = aplicarRecepcion(detail, [{ linea: 1, cantidad: 1 }]);

    expect(r.detalle[0].quantity_received).toBe(0);
    expect(r.detalle[1].quantity_received).toBe(1);
    expect(r.totalRecibido).toBe(4000);
  });

  it('un índice de línea que no existe es un error de cuerpo, no un salteo', () => {
    // Con el `find` viejo esto era un `continue`: el usuario veía «recibido» sin
    // que hubiera entrado nada. Si la pantalla manda una línea que no existe es
    // porque se quedó con un detalle viejo.
    const detail = detalleConProductoRepetido();

    expect(() => aplicarRecepcion(detail, [{ linea: 9, cantidad: 1 }]))
      .toThrow(/posición 9/);

    try {
      aplicarRecepcion(detail, [{ linea: 9, cantidad: 1 }]);
    } catch (err) {
      expect(err.codigo).toBe('LINEA_INEXISTENTE');
      expect(err.status).toBe(400);
      expect(err.publico).toBe(true);
    }

    expect(() => aplicarRecepcion(detail, [{ linea: -1, cantidad: 1 }])).toThrow();
    expect(() => aplicarRecepcion(detail, [{ cantidad: 1 }])).toThrow();
  });
});

describe('aplicarRecepcion — las tres reglas que el servidor no decía', () => {
  it('una cantidad mayor a lo pendiente se recorta y lo dice', () => {
    const detail = [
      { product_id: 41, product_name: 'Colágeno 300g', quantity: 12, unit_price: 1200, quantity_received: 8 },
    ];

    const r = aplicarRecepcion(detail, [{ linea: 0, cantidad: 9 }]);

    expect(r.detalle[0].quantity_received).toBe(12);
    expect(r.lineas[0].recibido_ahora).toBe(4);
    expect(r.totalRecibido).toBe(4800);
    // FR-033: la pantalla tiene que poder decir cuánto entró de verdad, y el
    // aviso tiene que nombrar el producto para que se sepa cuál fue.
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('Colágeno 300g');
    expect(r.avisos[0]).toContain('4');
  });

  it('una cantidad cero o negativa se saltea y lo dice', () => {
    const detail = detalleConProductoRepetido();

    const r = aplicarRecepcion(detail, [
      { linea: 0, cantidad: 0 },
      { linea: 1, cantidad: -3 },
    ]);

    expect(r.lineas).toEqual([]);
    expect(r.totalRecibido).toBe(0);
    expect(r.avisos).toHaveLength(2);
    expect(r.avisos[0]).toContain('Colágeno 300g');
    expect(r.avisos[1]).toContain('Creatina 500g');
  });

  it('una línea ya recibida por completo no vuelve a sumar', () => {
    const detail = [
      { product_id: 41, product_name: 'Colágeno 300g', quantity: 5, unit_price: 1000, quantity_received: 5 },
    ];

    const r = aplicarRecepcion(detail, [{ linea: 0, cantidad: 3 }]);

    expect(r.detalle[0].quantity_received).toBe(5);
    expect(r.totalRecibido).toBe(0);
    expect(r.avisos[0]).toContain('Colágeno 300g');
  });

  it('una línea sin product_id se recibe igual y suma al importe', () => {
    // Es el flete, el embalaje, el servicio: no está en el catálogo, no mueve
    // stock, y **se debe igual**. Hoy este caso revierte la transacción entera
    // con un 500 y no entra nada, ni de las otras líneas.
    const detail = [
      { product_id: 41, product_name: 'Colágeno 300g', quantity: 2, unit_price: 1200, quantity_received: 0 },
      { product_id: null, product_name: 'Flete', quantity: 1, unit_price: 9000, quantity_received: 0 },
    ];

    const r = aplicarRecepcion(detail, [
      { linea: 0, cantidad: 2 },
      { linea: 1, cantidad: 1 },
    ]);

    expect(r.totalRecibido).toBe(11400);
    expect(r.lineas[1]).toMatchObject({ linea: 1, product_id: null, recibido_ahora: 1 });
    expect(r.estado).toBe('received');
  });
});

describe('aplicarRecepcion — el estado sale de TODAS las líneas', () => {
  it('recibir una línea de tres NO marca la orden como recibida', () => {
    const r = aplicarRecepcion(detalleConProductoRepetido(), [{ linea: 0, cantidad: 12 }]);

    expect(r.estado).toBe('partial');
  });

  it('recibir todo lo que falta la marca recibida', () => {
    const detail = [
      { product_id: 41, product_name: 'Colágeno', quantity: 12, unit_price: 1200, quantity_received: 8 },
      { product_id: 55, product_name: 'Creatina', quantity: 4, unit_price: 8000, quantity_received: 4 },
    ];

    const r = aplicarRecepcion(detail, [{ linea: 0, cantidad: 4 }]);

    expect(r.estado).toBe('received');
  });

  it('un detail vacío NO marca la orden como recibida', () => {
    // `[].every(...)` es `true` por vacuidad. Una orden sin ítems quedaría
    // marcada como recibida completa sin que hubiera llegado nada, y a partir de
    // ahí la guarda del servicio impide recibirla para siempre.
    expect(aplicarRecepcion([], []).estado).toBe('partial');
  });

  it('una línea de cantidad cero NO marca la orden como recibida', () => {
    // `0 >= 0` es verdadero: una línea cargada con cantidad cero cumple
    // «recibido >= pedido» sin que haya llegado nada.
    const detail = [
      { product_id: 41, product_name: 'Colágeno', quantity: 0, unit_price: 1200, quantity_received: 0 },
    ];

    expect(aplicarRecepcion(detail, []).estado).toBe('partial');
  });
});

describe('aplicarRecepcion es pura', () => {
  it('NO muta el detail que recibe', () => {
    // `detail` es una columna JSONB. Mutar los objetos que devuelve Sequelize y
    // reasignar la MISMA referencia no marca el campo como modificado, y el
    // UPDATE sale sin la columna: las cantidades recibidas nunca se persisten.
    const detail = detalleConProductoRepetido();
    const antes = JSON.parse(JSON.stringify(detail));

    const r = aplicarRecepcion(detail, [{ linea: 2, cantidad: 10 }]);

    expect(detail).toEqual(antes);
    expect(r.detalle).not.toBe(detail);
    expect(r.detalle[2]).not.toBe(detail[2]);
  });

  it('el importe se acumula en centavos', () => {
    // Tres líneas que en punto flotante dejan residuo: el importe de la deuda
    // se guardaría con un centavo que nadie escribió.
    const detail = [
      { product_id: 1, product_name: 'A', quantity: 1, unit_price: 0.11, quantity_received: 0 },
      { product_id: 2, product_name: 'B', quantity: 1, unit_price: 0.29, quantity_received: 0 },
      { product_id: 3, product_name: 'C', quantity: 1, unit_price: 1234.16, quantity_received: 0 },
    ];

    const r = aplicarRecepcion(detail, [
      { linea: 0, cantidad: 1 },
      { linea: 1, cantidad: 1 },
      { linea: 2, cantidad: 1 },
    ]);

    expect(r.totalRecibido).toBe(1234.56);
  });
});
