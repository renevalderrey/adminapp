// ════════════════════════════════════════════
//  Actualizacion de precios en masa
//
//  Lo que se prueba aca es la aritmetica y las reglas de decision: que campo
//  se toca segun el modo, que pasa cuando el valor no cambia nada, y el caso
//  que rompe todo — que un precio fijo y un margen manual conviven y uno tapa
//  al otro.
// ════════════════════════════════════════════

const { calcularCambio, fotoDe, MODOS } = require('../services/preciosService');

const producto = (campos = {}) => ({
  name: 'Whey Protein 1kg',
  cost: 10000,
  margin_override: null,
  price_override: null,
  ...campos,
});

describe('fotoDe', () => {
  it('guarda los tres campos que definen el precio', () => {
    expect(fotoDe(producto({ margin_override: 40 }))).toEqual({
      cost: 10000,
      margin_override: 40,
      price_override: null,
    });
  });

  it('conserva el null y no lo convierte en cero', () => {
    // Un margen null (usa el de la empresa) y un margen 0 (vende al costo) son
    // cosas distintas. Si el deshacer los confundiera, restauraria un precio
    // que no es el que habia.
    const foto = fotoDe(producto({ margin_override: null, price_override: null }));

    expect(foto.margin_override).toBeNull();
    expect(foto.price_override).toBeNull();
  });

  it('normaliza los DECIMAL que Postgres devuelve como texto', () => {
    const foto = fotoDe(producto({ cost: '1234.50', margin_override: '40.00' }));

    expect(foto.cost).toBe(1234.5);
    expect(foto.margin_override).toBe(40);
  });
});

describe('modo margen', () => {
  it('escribe el margen y limpia el precio fijo', () => {
    // Sin limpiarlo, el precio fijo sigue mandando y la actualizacion no
    // tendria ningun efecto visible: el usuario ve "200 productos
    // actualizados" y los precios no se mueven.
    const cambio = calcularCambio(producto({ price_override: 25000 }), MODOS.MARGEN, 40);

    expect(cambio).toEqual({ margin_override: 40, price_override: null });
  });

  it('no genera cambio si el margen ya era ese', () => {
    expect(calcularCambio(producto({ margin_override: 40 }), MODOS.MARGEN, 40)).toBeNull();
  });

  it('trata el margen en texto igual que en numero', () => {
    expect(calcularCambio(producto({ margin_override: '40.00' }), MODOS.MARGEN, 40)).toBeNull();
  });
});

describe('modo precio', () => {
  it('escribe el precio fijo', () => {
    expect(calcularCambio(producto(), MODOS.PRECIO, 19999.99))
      .toEqual({ price_override: 19999.99 });
  });

  it('redondea a centavos', () => {
    expect(calcularCambio(producto(), MODOS.PRECIO, 1000.126))
      .toEqual({ price_override: 1000.13 });
  });

  it('no genera cambio si el precio ya era ese', () => {
    expect(calcularCambio(producto({ price_override: 19999.99 }), MODOS.PRECIO, 19999.99)).toBeNull();
  });
});

describe('modo costo', () => {
  it('aplica el porcentaje sobre el costo actual', () => {
    expect(calcularCambio(producto({ cost: 10000 }), MODOS.COSTO, 15))
      .toEqual({ cost: 11500 });
  });

  it('acepta porcentajes negativos, para una baja de lista', () => {
    expect(calcularCambio(producto({ cost: 10000 }), MODOS.COSTO, -10))
      .toEqual({ cost: 9000 });
  });

  it('redondea a centavos y no arrastra decimales', () => {
    expect(calcularCambio(producto({ cost: 1333.33 }), MODOS.COSTO, 7))
      .toEqual({ cost: 1426.66 });
  });

  it('corta si el ajuste deja el costo en negativo', () => {
    // -150% sobre un costo positivo da negativo. Es un error de tipeo
    // (alguien quiso poner -15) y tiene que frenar antes de escribir.
    expect(() => calcularCambio(producto({ cost: 10000 }), MODOS.COSTO, -150))
      .toThrow(/negativo/i);
  });

  it('no genera cambio con 0%', () => {
    expect(calcularCambio(producto({ cost: 10000 }), MODOS.COSTO, 0)).toBeNull();
  });

  it('un producto sin costo cargado queda en cero, no rompe', () => {
    expect(calcularCambio(producto({ cost: 0 }), MODOS.COSTO, 20)).toBeNull();
  });
});

describe('modo desconocido', () => {
  it('no escribe nada ante un modo que no existe', () => {
    expect(() => calcularCambio(producto(), 'inventado', 10)).toThrow(/desconocido/i);
  });
});

describe('el par foto → deshacer cierra', () => {
  it('la foto anterior alcanza para volver al estado exacto', () => {
    // Esta es la propiedad de la que depende todo el "deshacer": lo que se
    // guarda tiene que ser suficiente para reconstruir el estado, sin
    // depender de en que orden se aplicaron las actualizaciones.
    const p = producto({ cost: 10000, margin_override: 35, price_override: null });

    const antes = fotoDe(p);
    Object.assign(p, calcularCambio(p, MODOS.MARGEN, 50));

    expect(fotoDe(p)).not.toEqual(antes);

    Object.assign(p, antes);

    expect(fotoDe(p)).toEqual(antes);
  });
});
