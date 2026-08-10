const { catalogoPublico, productoPublico, pedidoPublico } = require('../utils/vistaPublica');

// ════════════════════════════════════════════
//  La proyección pública · lo que sale y lo que no
//
//  `tests/proyeccionPublica.test.js` verifica la FORMA —que el archivo no copie
//  objetos ni nombre campos internos—. Esto verifica el RESULTADO: que aunque la
//  fila traiga todo, lo que sale sea lo que se decidió.
//
//  Las dos hacen falta. La guardia de forma sigue en verde si alguien escribe
//  `cost2: p.cost`; este archivo sigue en verde si alguien deja de nombrar el
//  campo pero copia la fila entera con otro nombre.
// ════════════════════════════════════════════

/** Una fila de producto con TODO lo que la tabla tiene, incluido lo interno. */
const FILA_COMPLETA = {
  id: 7,
  empresa_id: 3,
  name: 'Whey Protein Isolate 1kg',
  description: 'Proteína de suero aislada.',
  sku: 'WHEY-1K',
  barcode: '7790000000001',
  cost: 31600,
  brand_id: 1,
  supplier_id: 4,
  margin_override: 42,
  price_override: null,
  wholesale_margin: 20,
  wholesale_price: 39000,
  category: 'Proteínas',
  unit_type: 'unidad',
  taxed: true,
  image_url: '/img/a1/b2/a1b2deadbeef.jpg',
  is_active: true,
  publicable: true,
};

const INTERNOS = [
  'cost', 'margin_override', 'wholesale_margin', 'wholesale_price',
  'supplier_id', 'barcode', 'is_active', 'publicable',
  'empresa_id', 'punto_de_venta_id', 'brand_id', 'sku', 'price_override',
];

/** Todas las claves del JSON, a cualquier profundidad. */
function clavesDe(valor, acumulado = []) {
  if (Array.isArray(valor)) {
    for (const v of valor) clavesDe(v, acumulado);
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.push(k);
      clavesDe(v, acumulado);
    }
  }
  return acumulado;
}

describe('productoPublico', () => {
  it('no lleva cost ni publicable, aunque la fila los traiga', () => {
    const salida = productoPublico(FILA_COMPLETA, { precio: 38868, precioLista: 47400 });
    const claves = clavesDe(salida);

    for (const interno of INTERNOS) {
      expect(claves).not.toContain(interno);
    }
  });

  it('lleva lo que la tarjeta necesita y nada más', () => {
    const salida = productoPublico(FILA_COMPLETA, {
      precio: 38868, precioLista: 47400, mostrarLista: true, marca: 'ENA', agotado: false,
    });

    expect(salida).toEqual({
      id: 7,
      nombre: 'Whey Protein Isolate 1kg',
      descripcion: 'Proteína de suero aislada.',
      precio: 38868,
      agotado: false,
      marca: 'ENA',
      imagen: '/img/a1/b2/a1b2deadbeef.jpg',
      categoria: 'Proteínas',
      unidad: 'unidad',
      precio_lista: 47400,
      ahorro_pct: 18,
    });
  });

  it('un producto sin marca NO lleva la clave marca, y no la lleva en null', () => {
    // El 96 % de los productos migrables no tiene marca: este es el caso normal.
    // Una clave presente con null es cómo se dibuja «undefined» abajo del nombre.
    const salida = productoPublico({ id: 1, name: 'Sin marca' }, { precio: 100 });

    expect('marca' in salida).toBe(false);
    expect('imagen' in salida).toBe(false);
    expect('descripcion' in salida).toBe(false);
  });

  it('el precio tachado sale sólo con el interruptor Y una diferencia real', () => {
    const conInterruptor = { precio: 900, precioLista: 1000, mostrarLista: true };
    const sinInterruptor = { precio: 900, precioLista: 1000, mostrarLista: false };
    const sinDiferencia = { precio: 1000, precioLista: 1000, mostrarLista: true };

    expect(productoPublico(FILA_COMPLETA, conInterruptor).precio_lista).toBe(1000);
    expect('precio_lista' in productoPublico(FILA_COMPLETA, sinInterruptor)).toBe(false);

    // «Antes $1.000, ahora $1.000» es una promesa de descuento que no existe, en
    // una página que ve cualquiera.
    expect('precio_lista' in productoPublico(FILA_COMPLETA, sinDiferencia)).toBe(false);
  });

  it('agotado es siempre booleano, nunca undefined', () => {
    expect(productoPublico({ id: 1, name: 'X' }, { precio: 1 }).agotado).toBe(false);
    expect(productoPublico({ id: 1, name: 'X' }, { precio: 1, agotado: true }).agotado).toBe(true);
  });
});

describe('catalogoPublico', () => {
  const FILA = {
    id: 1,
    empresa_id: 3,
    punto_de_venta_id: 2,
    slug: 'comprafit-fitnet',
    nombre_visible: 'Comprafit / Fitnet',
    descripcion: 'Suplementos con precio de socio.',
    logo_url: '/img/aa/bb/logo.png',
    portada_url: null,
    color_marca: '#00B4B6',
    whatsapp_destino: '1144029915',
    email_avisos: 'pedidos@comprafit.com.ar',
    datos_transferencia: { titular: 'Comprafit S.R.L.', cbu: '0720123488000012345678', alias: 'COMPRAFIT.SUPLE' },
    retiro_socio: true,
    retiro_local: true,
    envio: true,
    envio_costo: '2500.00',
    envio_gratis_desde: '50000.00',
    coordinar_whatsapp: true,
    pide_nro_socio: true,
    pide_dni: false,
    mostrar_precio_lista: true,
    mp_habilitado: false,
    estado: 'publicado',
  };

  it('no filtra la identidad del tenant ni la casilla interna', () => {
    const claves = clavesDe(catalogoPublico(FILA));

    expect(claves).not.toContain('empresa_id');
    expect(claves).not.toContain('punto_de_venta_id');
    // El correo al que llegan los avisos es del comercio, no del visitante.
    expect(claves).not.toContain('email_avisos');
    expect(claves).not.toContain('estado');
  });

  it('los importes vuelven como número, no como el string del driver', () => {
    // `DECIMAL` sale de Postgres como texto. Si viajara así, el navegador
    // sumaría «2500.00» + 100 y daría «2500.00100».
    const salida = catalogoPublico(FILA);

    expect(salida.entrega.envio_costo).toBe(2500);
    expect(salida.entrega.envio_gratis_desde).toBe(50000);
  });

  it('sin portada, la clave no está', () => {
    expect('portada' in catalogoPublico(FILA)).toBe(false);
    expect(catalogoPublico(FILA).logo).toBe('/img/aa/bb/logo.png');
  });

  it('los datos bancarios sólo si están completos', () => {
    // Media transferencia es peor que ninguna: el comprador la intenta igual.
    const sinBanco = catalogoPublico({ ...FILA, datos_transferencia: {} });

    expect('transferencia' in sinBanco).toBe(false);
    expect(sinBanco.pagos.transferencia).toBe(false);
    expect(catalogoPublico(FILA).transferencia.alias).toBe('COMPRAFIT.SUPLE');
  });

  it('mercadopago siempre en false en esta etapa', () => {
    // La forma ya existe para que la tienda no haya que tocarla cuando llegue la
    // pasarela; el valor no.
    expect(catalogoPublico({ ...FILA, mp_habilitado: true }).pagos.mercadopago).toBe(true);
    expect(catalogoPublico(FILA).pagos.mercadopago).toBe(false);
  });
});

describe('pedidoPublico', () => {
  it('devuelve el número legible y NO el identificador interno', () => {
    const salida = pedidoPublico(
      { id: 'b3f1c9e0-1111-2222-3333-444455556666', numero: 1042, estado: 'pendiente_pago', total: '82668.00', envio_costo: '0.00', entrega: 'retiro_socio', medio_pago: 'efectivo' },
      [{ nombre: 'Whey', cantidad: 1, precio_unitario: '38868.00', subtotal: '38868.00' }]
    );

    expect(clavesDe(salida)).not.toContain('id');
    expect(JSON.stringify(salida)).not.toContain('b3f1c9e0');
    expect(salida.numero).toBe(1042);
    expect(salida.total).toBe(82668);
    expect(salida.lineas[0].subtotal).toBe(38868);
  });
});
