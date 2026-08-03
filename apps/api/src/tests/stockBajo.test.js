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

// ════════════════════════════════════════════
//  Que las rutas usen ESTA funcion y no su propia copia del 3
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const GENERAL = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'general.js'),
  'utf8'
);

/** El texto de una ruta, desde su declaracion hasta la siguiente. */
function ruta(fuente, inicio, fin) {
  const i = fuente.indexOf(inicio);
  const j = fuente.indexOf(fin, i);

  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);

  return fuente.slice(i, j);
}

describe('GET /api/faltantes usa la regla compartida', () => {
  const FALTANTES = GENERAL.slice(GENERAL.indexOf("router.get('/faltantes'"));

  it('el 3 literal ya no esta escrito adentro de la ruta', () => {
    // Era el mismo numero repetido en el servidor y en la pantalla. Dos
    // constantes iguales en dos repositorios empiezan iguales y terminan
    // distintas, y ahi Inventario y Faltantes dejan de decir lo mismo (FR-017).
    expect(FALTANTES).not.toMatch(/req\.query\.umbral\) : 3/);
    expect(FALTANTES).toMatch(/: UMBRAL_POR_DEFECTO;/);
  });

  it('decide por esStockBajo y calcula el limite por limiteDeStockBajo', () => {
    expect(FALTANTES).toMatch(/limiteDeStockBajo\(fila, umbral\)/);
    expect(FALTANTES).toMatch(/!esStockBajo\(fila, umbral\)/);
    expect(FALTANTES).not.toMatch(/const limite = minimo > 0 \? minimo : umbral/);
  });

  it('es un refactor: la comparacion sigue siendo la misma', () => {
    // `esStockBajo` es `cantidad <= limite`, o sea el negado exacto del
    // `cantidad > limite` que habia. Si el numero de productos que devuelve la
    // ruta se moviera, la funcion quedo distinta del literal que reemplaza.
    expect(esStockBajo({ quantity: 4, min_stock: 0 }, 3)).toBe(false);
    expect(esStockBajo({ quantity: 3, min_stock: 0 }, 3)).toBe(true);
    expect(esStockBajo({ quantity: 11, min_stock: 10 }, 3)).toBe(false);
    expect(esStockBajo({ quantity: 10, min_stock: 10 }, 3)).toBe(true);
  });

  it('sigue aceptando el umbral por query, como antes', () => {
    expect(FALTANTES).toMatch(/Number\(req\.query\.umbral\)/);
  });
});

describe('GET /api/settings expone el umbral como campo derivado', () => {
  const SETTINGS = ruta(GENERAL, "router.get('/settings'", "router.get('/settings/:key'");

  it('devuelve umbral_stock_bajo', () => {
    expect(SETTINGS).toMatch(/obj\.umbral_stock_bajo = UMBRAL_POR_DEFECTO;/);
  });

  it('es de SOLO LECTURA: una fila guardada con esa clave no lo pisa', () => {
    // `PUT /settings/:key` acepta cualquier clave. Si el campo se asignara
    // antes del bucle, alguien podria guardar `umbral_stock_bajo: 50` y la
    // pantalla mostraria un umbral que /faltantes no usa: dos numeros
    // distintos para la misma pregunta, que es exactamente lo que FR-017 vino
    // a cerrar.
    const bucle = SETTINGS.indexOf('settings.forEach');
    const derivado = SETTINGS.indexOf('obj.umbral_stock_bajo');

    expect(bucle).toBeGreaterThanOrEqual(0);
    expect(derivado).toBeGreaterThan(bucle);
  });

  it('el valor es el mismo que usa /faltantes', () => {
    expect(UMBRAL_POR_DEFECTO).toBe(3);
  });
});
