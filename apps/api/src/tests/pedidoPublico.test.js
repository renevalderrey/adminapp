const { consolidarLineas, validarComprador, entregasDelCatalogo } = require('../utils/pedidoPublico');

// ════════════════════════════════════════════
//  Lo que se acepta de un visitante sin sesión
// ════════════════════════════════════════════

const CATALOGO = {
  retiro_socio: true,
  retiro_local: true,
  envio: true,
  coordinar_whatsapp: false,
  pide_nro_socio: true,
};

const COMPRADOR = {
  nombre: 'Martina Olivera',
  telefono: '11 5478-2210',
  entrega: 'retiro_socio',
  medio_pago: 'efectivo',
};

describe('consolidarLineas', () => {
  it('el mismo producto dos veces es una línea con la suma', () => {
    // El carrito puede mandarlo repetido por un reintento o por una pantalla que
    // agrega de a uno. No es un error del comprador.
    const r = consolidarLineas([
      { product_id: 7, cantidad: 2 },
      { product_id: 12, cantidad: 1 },
      { product_id: 7, cantidad: 3 },
    ]);

    expect(r.ok).toBe(true);
    expect(r.lineas).toEqual([
      { product_id: 7, cantidad: 5 },
      { product_id: 12, cantidad: 1 },
    ]);
  });

  it('un `precio` en el cuerpo no sobrevive a consolidarLineas', () => {
    // No es que se valide: es que el resto del handler no tiene desde dónde
    // leerlo. Una validación se puede olvidar en una rama nueva; esto no,
    // porque no hay dato que olvidar.
    const r = consolidarLineas([
      { product_id: 7, cantidad: 1, precio: 1, precio_unitario: 1, subtotal: 1, total: 1, nombre: 'gratis' },
    ]);

    expect(Object.keys(r.lineas[0]).sort()).toEqual(['cantidad', 'product_id']);
  });

  it('rechaza cantidades que no son enteros mayores que cero', () => {
    for (const cantidad of [0, -3, 1.5, '2.9', 'dos', null, undefined, NaN]) {
      expect(consolidarLineas([{ product_id: 7, cantidad }])).toMatchObject({ ok: false });
    }
  });

  it('el tope de 999 se mira después de sumar', () => {
    // Mandar 500 y 500 del mismo producto no puede esquivarlo.
    expect(consolidarLineas([{ product_id: 7, cantidad: 999 }]).ok).toBe(true);
    expect(consolidarLineas([{ product_id: 7, cantidad: 1000 }]).ok).toBe(false);
    expect(consolidarLineas([
      { product_id: 7, cantidad: 500 },
      { product_id: 7, cantidad: 500 },
    ])).toMatchObject({ ok: false, error: 'CANTIDAD_INVALIDA' });
  });

  it('un product_id que no es un entero positivo se rechaza', () => {
    for (const product_id of ['1;DROP TABLE pedidos', '1.5', 0, -1, 'siete', null]) {
      expect(consolidarLineas([{ product_id, cantidad: 1 }]).ok).toBe(false);
    }
  });

  it('un pedido vacío no es un pedido', () => {
    expect(consolidarLineas([])).toMatchObject({ ok: false, error: 'PEDIDO_VACIO' });
    expect(consolidarLineas(null)).toMatchObject({ ok: false, error: 'PEDIDO_VACIO' });
    expect(consolidarLineas('7')).toMatchObject({ ok: false, error: 'PEDIDO_VACIO' });
  });
});

describe('validarComprador', () => {
  it('pide nombre y teléfono, y nada más de los datos del comprador', () => {
    expect(validarComprador(COMPRADOR, CATALOGO).ok).toBe(true);

    expect(validarComprador({ ...COMPRADOR, nombre: '  ' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'NOMBRE_REQUERIDO' });
    expect(validarComprador({ ...COMPRADOR, telefono: '11' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'TELEFONO_REQUERIDO' });
  });

  it('el email es opcional: el aviso por mail es un extra, no un requisito', () => {
    const r = validarComprador(COMPRADOR, CATALOGO);

    expect(r.ok).toBe(true);
    expect(r.comprador.comprador_email).toBeNull();
  });

  it('el DNI se descarta aunque venga, y el pedido sigue siendo válido', () => {
    // Pedir un DNI sin Términos ni Política de Privacidad publicados es juntar
    // un dato personal sin base para tenerlo.
    const r = validarComprador({ ...COMPRADOR, dni: '38.412.905', acepta_comunicaciones: true }, CATALOGO);

    expect(r.ok).toBe(true);
    expect(r.comprador.comprador_dni).toBeUndefined();
    expect(r.comprador.acepta_comunicaciones).toBeUndefined();
    expect(JSON.stringify(r.comprador)).not.toContain('38.412.905');
  });

  it('la dirección se exige sólo con entrega = envio', () => {
    // Un formulario que la pide siempre hace que el que retira invente una
    // dirección para poder seguir.
    expect(validarComprador({ ...COMPRADOR, entrega: 'retiro_local' }, CATALOGO).ok).toBe(true);

    expect(validarComprador({ ...COMPRADOR, entrega: 'envio' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'ENVIO_INCOMPLETO' });

    const r = validarComprador({
      ...COMPRADOR,
      entrega: 'envio',
      envio_direccion: 'Av. Rivadavia 4821',
      envio_localidad: 'CABA',
      envio_cp: '1424',
    }, CATALOGO);

    expect(r.ok).toBe(true);
    expect(r.comprador.envio_direccion).toBe('Av. Rivadavia 4821');
  });

  it('no se puede elegir una entrega que el catálogo no ofrece', () => {
    // Existir en el enum no alcanza: el comprador no puede pedir envío en un
    // catálogo que no hace envíos.
    const sinEnvio = { ...CATALOGO, envio: false };

    expect(validarComprador({ ...COMPRADOR, entrega: 'envio' }, sinEnvio))
      .toMatchObject({ ok: false, error: 'ENTREGA_INVALIDA' });
    expect(validarComprador({ ...COMPRADOR, entrega: 'coordinar' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'ENTREGA_INVALIDA' });
    expect(validarComprador({ ...COMPRADOR, entrega: 'teletransporte' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'ENTREGA_INVALIDA' });

    expect(entregasDelCatalogo(sinEnvio)).toEqual(['retiro_socio', 'retiro_local']);
  });

  it('el medio de pago tiene que ser uno de los dos que existen', () => {
    expect(validarComprador({ ...COMPRADOR, medio_pago: 'mp' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'PAGO_INVALIDO' });
    expect(validarComprador({ ...COMPRADOR, medio_pago: undefined }, CATALOGO))
      .toMatchObject({ ok: false, error: 'PAGO_INVALIDO' });
  });

  it('el número de socio sólo se guarda si el catálogo lo pide', () => {
    expect(validarComprador({ ...COMPRADOR, nro_socio: 'F-4412' }, CATALOGO).comprador.comprador_nro_socio)
      .toBe('F-4412');
    expect(validarComprador({ ...COMPRADOR, nro_socio: 'F-4412' }, { ...CATALOGO, pide_nro_socio: false })
      .comprador.comprador_nro_socio).toBeNull();
  });

  it('recorta al largo de la columna en vez de reventar el INSERT', () => {
    const r = validarComprador({ ...COMPRADOR, nombre: 'M'.repeat(400) }, CATALOGO);

    expect(r.comprador.comprador_nombre).toHaveLength(120);
  });
});
