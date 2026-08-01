// ════════════════════════════════════════════
//  Comparador de proveedores
//
//  Dos partes frágiles, y las dos producen errores caros:
//
//   - El parseo de precios. Un importe argentino se escribe 1.234,50. Leerlo
//     al revés convierte $1.234 en $1,234 y hace que un proveedor parezca mil
//     veces más barato, sin que nada falle.
//   - El emparejamiento. Si junta dos productos que no son el mismo, la
//     comparación miente; si no junta los que sí lo son, no sirve para nada.
// ════════════════════════════════════════════

const {
  normalizar, similitud, mismoSku, parsearTexto, aNumero, comparar,
} = require('../services/comparadorService');

describe('normalizar', () => {
  it('saca acentos, mayúsculas y puntuación', () => {
    expect(normalizar('Proteína  Whey 1Kg.')).toBe('proteina whey 1kg');
    expect(normalizar('CREATINA - MONOHIDRATO (300g)')).toBe('creatina monohidrato 300g');
  });

  it('no rompe con vacío', () => {
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});

describe('similitud', () => {
  it('reconoce el mismo producto escrito distinto', () => {
    // El caso real: cada proveedor lo escribe a su manera.
    const s = similitud('Whey Protein 1kg Vainilla - Star', 'STAR WHEY 1 KG VAINILLA');
    expect(s).toBeGreaterThanOrEqual(0.45);
  });

  it('separa productos distintos de la misma línea', () => {
    // Este es el que importa: si los junta, compara el precio del de 1kg
    // contra el del de 2kg y el resultado es basura.
    const s = similitud('Whey Protein 1kg Vainilla', 'Whey Protein 2kg Chocolate');
    expect(s).toBeLessThan(0.45);
  });

  it('da 0 cuando no hay nada en común', () => {
    expect(similitud('Creatina Monohidrato', 'Shaker Negro')).toBe(0);
  });

  it('penaliza que uno tenga mucho texto de más', () => {
    const limpio = similitud('Whey Protein 1kg', 'Whey Protein 1kg');
    const conRelleno = similitud(
      'Whey Protein 1kg',
      'Whey Protein 1kg mas Creatina 300g de regalo promocion agosto'
    );

    expect(limpio).toBe(1);
    expect(conRelleno).toBeLessThan(limpio);
  });

  it('ignora palabras de menos de tres letras', () => {
    // "de", "x", "1" no dicen nada sobre si es el mismo producto.
    expect(similitud('de x 1', 'de x 2')).toBe(0);
  });
});

describe('mismoSku', () => {
  it('compara sin puntuación ni mayúsculas', () => {
    expect(mismoSku('WHEY-STAR-1KG', 'whey star 1kg')).toBe(true);
  });

  it('sin SKU en alguno de los dos, no afirma nada', () => {
    expect(mismoSku(null, 'ABC')).toBe(false);
    expect(mismoSku('', '')).toBe(false);
  });
});

describe('aNumero', () => {
  it.each([
    ['1.234,50', 1234.5, 'formato argentino completo'],
    ['1.234', 1234, 'punto de miles'],
    ['1234.5', 1234.5, 'punto decimal'],
    ['1234', 1234, 'entero pelado'],
    ['12.345.678', 12345678, 'dos puntos de miles'],
    ['0,99', 0.99, 'solo decimales'],
  ])('%s → %s (%s)', (entrada, esperado) => {
    expect(aNumero(entrada)).toBe(esperado);
  });

  it('NO lee 1.234 como 1,234', () => {
    // El error que arruina la comparación entera sin fallar.
    expect(aNumero('1.234')).toBe(1234);
    expect(aNumero('1.234')).not.toBeCloseTo(1.234);
  });
});

describe('parsearTexto', () => {
  it('lee los formatos con los que mandan las listas', () => {
    const { items } = parsearTexto([
      'Whey Protein 1kg   $12.500',
      'Creatina 300g;8990',
      'Shaker 600ml - 1.500',
      'Barra proteica\t990,50',
    ].join('\n'));

    expect(items).toEqual([
      { nombre: 'Whey Protein 1kg', precio: 12500 },
      { nombre: 'Creatina 300g', precio: 8990 },
      { nombre: 'Shaker 600ml', precio: 1500 },
      { nombre: 'Barra proteica', precio: 990.5 },
    ]);
  });

  it('cuenta las líneas que no pudo leer en vez de inventarlas', () => {
    const { items, ignoradas } = parsearTexto([
      'LISTA DE PRECIOS AGOSTO',
      'Whey 1kg 12500',
      '',
      'Consultar por mayor',
    ].join('\n'));

    expect(items).toHaveLength(1);
    expect(ignoradas).toBe(2);
  });

  it('el número del nombre no se confunde con el precio', () => {
    // "1kg" tiene un número, pero el precio es el último.
    const { items } = parsearTexto('Whey Protein 1kg Vainilla 12500');

    expect(items[0]).toEqual({ nombre: 'Whey Protein 1kg Vainilla', precio: 12500 });
  });

  it('descarta precios en cero', () => {
    const { items, ignoradas } = parsearTexto('Producto sin precio 0');

    expect(items).toHaveLength(0);
    expect(ignoradas).toBe(1);
  });
});

describe('comparar', () => {
  const listas = [
    {
      id: 1,
      nombre: 'Distribuidora Norte',
      items: [
        { nombre: 'Whey Protein 1kg Vainilla - Star', precio: 12500 },
        { nombre: 'Creatina Monohidrato 300g', precio: 9000 },
        { nombre: 'Shaker 600ml', precio: 1500 },
      ],
    },
    {
      id: 2,
      nombre: 'Mayorista Sur',
      items: [
        { nombre: 'STAR WHEY 1 KG VAINILLA', precio: 11800 },
        { nombre: 'Creatina Monohidrato 300 g', precio: 9600 },
      ],
    },
  ];

  it('agrupa el mismo producto de los dos proveedores', () => {
    const { grupos } = comparar(listas);
    const whey = grupos.find(g => /whey/i.test(g.nombre));

    expect(whey.cantidad_proveedores).toBe(2);
    expect(whey.mas_barato).toBe(2);
    expect(whey.precio_minimo).toBe(11800);
    expect(whey.diferencia).toBe(700);
  });

  it('calcula la diferencia porcentual sobre el más barato', () => {
    const { grupos } = comparar(listas);
    const creatina = grupos.find(g => /creatina/i.test(g.nombre));

    // 9600 vs 9000 = 6.7% más caro.
    expect(creatina.mas_barato).toBe(1);
    expect(creatina.diferencia_pct).toBeCloseTo(6.7, 1);
  });

  it('deja aparte lo que solo tiene un proveedor', () => {
    const { grupos, solo_en_uno: soloEnUno } = comparar(listas);
    const shaker = grupos.find(g => /shaker/i.test(g.nombre));

    expect(shaker.cantidad_proveedores).toBe(1);
    expect(shaker.diferencia).toBe(0);
    expect(soloEnUno).toBe(1);
  });

  it('ordena primero lo comparable y lo que más plata mueve', () => {
    const { grupos } = comparar(listas);

    expect(grupos[0].cantidad_proveedores).toBe(2);
    expect(grupos[0].diferencia).toBeGreaterThanOrEqual(grupos[1].diferencia);
    expect(grupos[grupos.length - 1].cantidad_proveedores).toBe(1);
  });

  it('dice en cuántos productos gana cada proveedor', () => {
    const { proveedores } = comparar(listas);

    expect(proveedores.find(p => p.lista_id === 1).gana).toBe(1); // creatina
    expect(proveedores.find(p => p.lista_id === 2).gana).toBe(1); // whey
  });

  it('elige el MEJOR candidato del proveedor, no el primero', () => {
    // El error del sistema anterior: con dos parecidos del mismo proveedor,
    // emparejaba el que estuviera antes en la lista.
    const conRuido = [
      { id: 1, nombre: 'A', items: [{ nombre: 'Whey Protein 1kg Vainilla', precio: 12000 }] },
      {
        id: 2,
        nombre: 'B',
        items: [
          { nombre: 'Whey Protein Vainilla promo', precio: 20000 },
          { nombre: 'Whey Protein 1kg Vainilla', precio: 11000 },
        ],
      },
    ];

    const { grupos } = comparar(conRuido);
    const principal = grupos.find(g => g.cantidad_proveedores === 2);

    expect(principal.precio_minimo).toBe(11000);
    expect(principal.precios.find(p => p.lista_id === 2).nombre)
      .toBe('Whey Protein 1kg Vainilla');
  });

  it('un SKU igual manda sobre el nombre', () => {
    const porSku = [
      { id: 1, nombre: 'A', items: [{ nombre: 'Producto viejo nombre', sku: 'ABC-123', precio: 1000 }] },
      { id: 2, nombre: 'B', items: [{ nombre: 'Otro nombre distinto', sku: 'abc 123', precio: 900 }] },
    ];

    const { grupos } = comparar(porSku);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].cantidad_proveedores).toBe(2);
    expect(grupos[0].precios[0].coincidencia).toBe(1);
  });

  it('nunca junta dos productos del mismo proveedor', () => {
    // Dos presentaciones del mismo proveedor son dos filas, no una.
    const misma = [
      {
        id: 1,
        nombre: 'A',
        items: [
          { nombre: 'Whey Protein 1kg Vainilla', precio: 12000 },
          { nombre: 'Whey Protein 1kg Vainilla', precio: 12500 },
        ],
      },
    ];

    const { grupos } = comparar(misma);

    expect(grupos).toHaveLength(2);
    for (const g of grupos) expect(g.cantidad_proveedores).toBe(1);
  });

  it('descarta items sin precio usable', () => {
    const sucias = [
      { id: 1, nombre: 'A', items: [{ nombre: 'Sin precio', precio: null }, { nombre: 'Bien', precio: 100 }] },
      { id: 2, nombre: 'B', items: [{ nombre: 'Negativo', precio: -5 }] },
    ];

    const { grupos } = comparar(sucias);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].nombre).toBe('Bien');
  });

  it('sin listas devuelve vacío en vez de romper', () => {
    expect(comparar([]).grupos).toEqual([]);
    expect(comparar().total).toBe(0);
  });
});
