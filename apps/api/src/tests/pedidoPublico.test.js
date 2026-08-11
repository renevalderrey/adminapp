const {
  consolidarLineas, validarComprador, entregasDelCatalogo, entregasSinPago, pagosDeLaEntrega,
} = require('../utils/pedidoPublico');

// ════════════════════════════════════════════
//  Lo que se acepta de un visitante sin sesión
// ════════════════════════════════════════════

const CATALOGO = {
  retiro_socio: true,
  retiro_local: true,
  envio: true,
  coordinar_whatsapp: false,
  pide_nro_socio: true,
  // Con CBU cargado, y hace falta: sin datos de transferencia el envío se queda
  // sin ninguna forma de pago —el efectivo no se ofrece con envío a domicilio—
  // y deja de ser una entrega ofrecida. Sin esta línea, los casos del envío de
  // abajo probarían otra cosa.
  datos_transferencia: { cbu: '0720123488000012345678', alias: 'COMPRAFIT.SUPLE' },
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
      // ⚠ Transferencia y no el efectivo de `COMPRADOR`: con envío a domicilio
      // el efectivo no es un pago posible (FR-142), así que este caso —que es
      // sobre la dirección— se caería por el medio de pago y dejaría de probar
      // lo que dice probar.
      medio_pago: 'transferencia',
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

// ════════════════════════════════════════════
//  Una entrega que no se puede pagar no se ofrece
//
//  El caso real, encontrado probando: un catálogo con **envío encendido y sin
//  CBU cargado**. La única forma de pago que quedaba era efectivo, y con envío a
//  domicilio el efectivo no se ofrece (FR-142). El comprador llegaba al último
//  paso con el formulario lleno y no había nada para elegir.
// ════════════════════════════════════════════

describe('las entregas y sus pagos', () => {
  const SIN_CBU = { ...CATALOGO, datos_transferencia: {} };

  const conEnvio = {
    ...COMPRADOR,
    entrega: 'envio',
    envio_direccion: 'Av. Rivadavia 4821',
    envio_localidad: 'CABA',
    envio_cp: '1424',
  };

  it('sin CBU, el envío no es una entrega ofrecida', () => {
    expect(entregasDelCatalogo(CATALOGO)).toContain('envio');
    expect(entregasDelCatalogo(SIN_CBU)).not.toContain('envio');
    // Y las otras siguen en pie: el retiro se paga en efectivo.
    expect(entregasDelCatalogo(SIN_CBU)).toEqual(['retiro_socio', 'retiro_local']);
  });

  it('`entregasSinPago` nombra exactamente la que quedó sin salida', () => {
    // Es lo que usa el handler de publicar para armar el mensaje.
    expect(entregasSinPago(SIN_CBU)).toEqual(['envio']);
    expect(entregasSinPago(CATALOGO)).toEqual([]);
  });

  it('el efectivo no es un pago posible del envío, con CBU o sin él', () => {
    expect(pagosDeLaEntrega(CATALOGO, 'envio')).toEqual(['transferencia']);
    expect(pagosDeLaEntrega(CATALOGO, 'retiro_local')).toEqual(['transferencia', 'efectivo']);
    expect(pagosDeLaEntrega(SIN_CBU, 'envio')).toEqual([]);
    expect(pagosDeLaEntrega(SIN_CBU, 'retiro_local')).toEqual(['efectivo']);
  });

  it('un pedido con envío + efectivo se rechaza, aunque la tienda no lo ofrezca', () => {
    // La tienda no dibuja esa combinación, pero un `POST` armado a mano la
    // pasaba: el pedido entraba con algo que el comercio no puede cumplir.
    expect(validarComprador({ ...conEnvio, medio_pago: 'efectivo' }, CATALOGO))
      .toMatchObject({ ok: false, error: 'PAGO_INVALIDO' });

    expect(validarComprador({ ...conEnvio, medio_pago: 'transferencia' }, CATALOGO).ok).toBe(true);
  });

  it('sin CBU, el pedido con envío se rechaza por la entrega y no por el pago', () => {
    expect(validarComprador({ ...conEnvio, medio_pago: 'transferencia' }, SIN_CBU))
      .toMatchObject({ ok: false, error: 'ENTREGA_INVALIDA' });
  });

  it('la dirección incompleta se avisa ANTES que el medio de pago', () => {
    // El orden es el de los pasos del checkout: entrega y después pago. Al
    // revés, a quien eligió envío y no completó la dirección le contestaríamos
    // «elegí cómo vas a pagar», que manda a mirar la pantalla equivocada.
    const sinDireccion = { ...COMPRADOR, entrega: 'envio', medio_pago: 'efectivo' };

    expect(validarComprador(sinDireccion, CATALOGO))
      .toMatchObject({ ok: false, error: 'ENVIO_INCOMPLETO' });
  });
});
