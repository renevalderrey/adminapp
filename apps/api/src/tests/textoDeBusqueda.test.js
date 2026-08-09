// ════════════════════════════════════════════
//  La única comparación de categoría y de búsqueda
//
//  `normalizarTexto` la usan tres consumidores: el índice de reglas de precio
//  por categoría, las píldoras de categoría de la tienda y el buscador
//  (FR-079).
//
//  Con dos funciones distintas —una que saca acentos y otra que no— la regla
//  «20 % a Proteínas» alcanza al producto cuando el precio lo calcula un lado y
//  no lo alcanza cuando lo calcula el otro: **el mismo producto aparece en el
//  catálogo con un precio y en la previsualización con otro**, y no hay ningún
//  error que alguien pueda ir a mirar. La categoría es texto libre escrito a
//  mano en la ficha del producto, así que «Proteínas», «proteinas» y
//  «PROTEINAS » conviven de verdad en la misma base.
// ════════════════════════════════════════════

const { normalizarTexto } = require('../utils/textoDeBusqueda');

describe('normalizarTexto', () => {
  it('«Proteínas» y «proteinas» son la misma categoría', () => {
    // Sin el borrado de acentos, la regla de precio de «Proteínas» no alcanza
    // al producto cargado como «proteinas», y el catálogo y la previsualización
    // muestran dos precios distintos para el mismo producto.
    expect(normalizarTexto('Proteínas')).toBe('proteinas');
    expect(normalizarTexto('Proteínas')).toBe(normalizarTexto('proteinas'));
    expect(normalizarTexto('PROTEÍNAS')).toBe(normalizarTexto('proteinas'));
  });

  it('«Nutremax» y «NUTREMAX» son la misma categoría', () => {
    expect(normalizarTexto('Nutremax')).toBe('nutremax');
    expect(normalizarTexto('Nutremax')).toBe(normalizarTexto('NUTREMAX'));
  });

  it('un espacio de más al final no crea una categoría nueva', () => {
    // Pegar el nombre desde una planilla arrastra el espacio, y una píldora
    // «Proteínas» duplicada en la tienda es lo que se ve de este defecto.
    expect(normalizarTexto('  Proteínas  ')).toBe('proteinas');
    expect(normalizarTexto('Proteínas\n')).toBe('proteinas');
    expect(normalizarTexto(' Proteínas')).toBe('proteinas');
  });

  it('NO colapsa los espacios de adentro ni parte las palabras', () => {
    // «Suplementos deportivos» es una categoría, no dos, y el buscador hace
    // includes sobre este mismo string: si acá se partiera, buscar «suplementos
    // deportivos» dejaría de encontrarla.
    expect(normalizarTexto('Suplementos Deportivos')).toBe('suplementos deportivos');
    expect(normalizarTexto('suplementos deportivos')).toContain(' ');
  });

  it('«niño» y «nino» son la misma categoría', () => {
    // La tilde de la ñ se saca igual que los acentos, y las dos puntas de la
    // comparación pasan por acá: quien escribe «nino» en el buscador encuentra
    // «Niño», y el resultado es simétrico.
    expect(normalizarTexto('Niño')).toBe('nino');
    expect(normalizarTexto('NIÑO')).toBe(normalizarTexto('nino'));
  });

  it('null, undefined y un número no revientan', () => {
    // `products.category` admite vacío y llega null desde la base. Un throw acá
    // se lleva puesta la previsualización entera, que recorre todo el catálogo.
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(undefined)).toBe('');
    expect(normalizarTexto('')).toBe('');
    expect(normalizarTexto('   ')).toBe('');
    expect(normalizarTexto(2024)).toBe('2024');
  });

  it('normalizar dos veces da lo mismo que normalizar una', () => {
    // El índice de reglas guarda la clave ya normalizada y el buscador
    // normaliza lo que el visitante escribe: los dos textos pasan por acá un
    // número distinto de veces y tienen que terminar iguales igual.
    for (const entrada of ['  Proteínas  ', 'NIÑO', 'Suplementos Deportivos']) {
      const unaVez = normalizarTexto(entrada);
      expect(normalizarTexto(unaVez)).toBe(unaVez);
    }
  });

  it('un índice por categoría encuentra las tres variantes escritas a mano', () => {
    // El consumidor real: una regla «20 % a Proteínas» indexada por la clave
    // normalizada tiene que alcanzar a los tres productos, que es lo que hace
    // que el catálogo y la previsualización den el mismo precio.
    const indice = new Map([[normalizarTexto('Proteínas'), 20]]);

    const productos = [
      { nombre: 'Whey', categoria: 'Proteínas' },
      { nombre: 'Caseína', categoria: 'proteinas' },
      { nombre: 'Isolate', categoria: ' PROTEINAS ' },
    ];

    const alcanzados = productos.filter((p) => indice.has(normalizarTexto(p.categoria)));

    expect(alcanzados).toHaveLength(3);
  });
});
