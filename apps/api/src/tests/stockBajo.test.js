// ════════════════════════════════════════════
//  La regla unica de "stock bajo"
//
//  Lo que estos tests protegen es que Inventario y Faltantes contesten lo
//  mismo cuando el usuario pregunta que le falta. Hoy no lo hacen: /faltantes
//  usa un umbral de 3 para los productos sin minimo cargado y /alerts exige
//  `min_stock > 0`, con lo cual un producto sin minimo en cero unidades no
//  aparece en ningun lado.
// ════════════════════════════════════════════

const {
  UMBRAL_POR_DEFECTO,
  limiteDeStockBajo,
  esStockBajo,
} = require('../utils/stockBajo');

describe('esStockBajo · con el minimo cargado manda el minimo', () => {
  it('por encima del minimo NO esta bajo', () => {
    expect(esStockBajo({ quantity: 12, min_stock: 10 })).toBe(false);
  });

  it('por debajo del minimo SI esta bajo', () => {
    expect(esStockBajo({ quantity: 4, min_stock: 10 })).toBe(true);
  });

  it('justo en el minimo cuenta como bajo: ya hay que reponerlo', () => {
    expect(esStockBajo({ quantity: 10, min_stock: 10 })).toBe(true);
  });

  it('con minimo alto, una cantidad mayor que el umbral general igual esta baja', () => {
    // Si la funcion mirara el umbral en vez del minimo, esto daria false.
    expect(esStockBajo({ quantity: 8, min_stock: 20 })).toBe(true);
  });
});

describe('esStockBajo · sin minimo cargado cae al umbral general', () => {
  // Este es el caso que GET /api/alerts NO cubre —exige min_stock > 0— y por
  // eso un producto sin minimo no alerta nunca aunque este en cero.
  it('min_stock en 0 significa "no lo cargaron", no "el minimo es cero"', () => {
    expect(esStockBajo({ quantity: 2, min_stock: 0 })).toBe(true);
    expect(esStockBajo({ quantity: 3, min_stock: 0 })).toBe(true);
    expect(esStockBajo({ quantity: 4, min_stock: 0 })).toBe(false);
  });

  it('sin la propiedad min_stock se comporta igual que con 0', () => {
    expect(esStockBajo({ quantity: 2 })).toBe(true);
    expect(esStockBajo({ quantity: 9 })).toBe(false);
  });

  it('un minimo negativo es dato roto y cae al umbral, no invierte la regla', () => {
    // Con min_stock = -5, comparar contra el minimo daria false para todo y el
    // producto desapareceria de faltantes para siempre.
    expect(esStockBajo({ quantity: 2, min_stock: -5 })).toBe(true);
    expect(esStockBajo({ quantity: 40, min_stock: -5 })).toBe(false);
  });
});

describe('esStockBajo · los bordes que importan', () => {
  it('cantidad en 0 siempre esta baja', () => {
    expect(esStockBajo({ quantity: 0, min_stock: 0 })).toBe(true);
    expect(esStockBajo({ quantity: 0, min_stock: 25 })).toBe(true);
  });

  it('cantidad negativa esta baja: una sobreventa no es stock disponible', () => {
    expect(esStockBajo({ quantity: -3, min_stock: 0 })).toBe(true);
  });

  it('lee los numeros que vienen como string desde la base', () => {
    // El driver de Postgres devuelve algunos numericos como string; comparar
    // '10' > 3 sin convertir da resultados al azar.
    expect(esStockBajo({ quantity: '2', min_stock: '0' })).toBe(true);
    expect(esStockBajo({ quantity: '10', min_stock: '0' })).toBe(false);
  });

  it('sin fila no rompe', () => {
    expect(esStockBajo(null)).toBe(true);
    expect(esStockBajo(undefined)).toBe(true);
  });
});

describe('el umbral entra por parametro y NO esta hardcodeado', () => {
  // Sin este test, portar la funcion al navegador con el 3 adentro pasa
  // inadvertido y FR-017 queda incumplido sin que nada falle.
  it('la misma fila contesta distinto con umbral 3 que con umbral 10', () => {
    const fila = { quantity: 5, min_stock: 0 };

    expect(esStockBajo(fila, 3)).toBe(false);
    expect(esStockBajo(fila, 10)).toBe(true);
  });

  it('un umbral de 0 desactiva el escalon general en vez de usar el 3', () => {
    expect(esStockBajo({ quantity: 1, min_stock: 0 }, 0)).toBe(false);
    expect(esStockBajo({ quantity: 0, min_stock: 0 }, 0)).toBe(true);
  });

  it('sin umbral usa el por defecto, que es el de GET /api/faltantes', () => {
    expect(UMBRAL_POR_DEFECTO).toBe(3);
    expect(esStockBajo({ quantity: 3, min_stock: 0 })).toBe(true);
    expect(esStockBajo({ quantity: 4, min_stock: 0 })).toBe(false);
  });

  it('un umbral basura cae al por defecto en vez de dejar pasar todo', () => {
    // `req.query.umbral` puede llegar con cualquier cosa.
    expect(esStockBajo({ quantity: 4, min_stock: 0 }, NaN)).toBe(false);
    expect(esStockBajo({ quantity: 2, min_stock: 0 }, 'ocho')).toBe(true);
  });
});

describe('limiteDeStockBajo · el numero que se muestra y con el que se repone', () => {
  // GET /api/faltantes lo necesita aparte para calcular cuanto sugerir.
  it('devuelve el minimo cargado', () => {
    expect(limiteDeStockBajo({ min_stock: 12 })).toBe(12);
  });

  it('devuelve el umbral cuando no hay minimo', () => {
    expect(limiteDeStockBajo({ min_stock: 0 })).toBe(3);
    expect(limiteDeStockBajo({ min_stock: 0 }, 7)).toBe(7);
  });
});
