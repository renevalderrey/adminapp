const {
  ESPECIFICIDAD,
  validarRegla,
  aplicarRegla,
  reglaQueGana,
  resolverPrecios,
} = require('../utils/reglasDePrecio');

// ════════════════════════════════════════════
//  El motor de reglas · con los números de la maqueta
//
//  Los ocho productos, las cuatro reglas y los seis precios de la
//  previsualización son **los de `docs/maqueta/Catalogo-de-ventas-online.dc.html`**
//  (`:1524-1550`). No son inventados: si el motor devuelve otra cosa, la
//  pantalla que se dibujó y aprobó estaría mostrando números que el sistema no
//  produce.
//
//  Y las cuatro coberturas —«gana en N de M»— son las mismas de esa pantalla.
//  Es lo que ata las dos mitades: los precios y los contadores salen del mismo
//  recorrido, así que no se pueden contradecir.
// ════════════════════════════════════════════

const MARCAS = { ENA: 1, STAR: 2, GENTECH: 3, ULTRATECH: 4, COMPRAFIT: 5 };

const PRODUCTOS = [
  { id: 1, nombre: 'Whey Protein Isolate 1kg',       brand_id: MARCAS.ENA,       category: 'Proteínas',   precioLista: 47400 },
  { id: 2, nombre: 'Creatina Monohidrato 300g',      brand_id: MARCAS.STAR,      category: 'Creatinas',   precioLista: 29900 },
  { id: 3, nombre: 'Barra proteica chocolate 60g',   brand_id: MARCAS.GENTECH,   category: 'Proteínas',   precioLista: 2800 },
  { id: 4, nombre: 'Pre-entreno Pump 300g',          brand_id: MARCAS.ULTRATECH, category: 'Pre-entreno', precioLista: 34500 },
  { id: 5, nombre: 'BCAA 8:1:1 250g',                brand_id: MARCAS.ENA,       category: 'Aminoácidos', precioLista: 24200 },
  { id: 6, nombre: 'Multivitamínico 60 caps',        brand_id: MARCAS.GENTECH,   category: 'Vitaminas',   precioLista: 15900 },
  { id: 7, nombre: 'Glutamina 300g',                 brand_id: MARCAS.STAR,      category: 'Aminoácidos', precioLista: 26400 },
  { id: 8, nombre: 'Shaker 700ml',                   brand_id: MARCAS.COMPRAFIT, category: 'Accesorios',  precioLista: 7900 },
];

const R1 = { id: 1, ambito: 'producto',  product_id: 2,           tipo: 'precio_fijo',          valor: 21900, activo: true };
const R2 = { id: 2, ambito: 'marca',     brand_id: MARCAS.ENA,    tipo: 'porcentaje_descuento', valor: 18,    activo: true };
const R3 = { id: 3, ambito: 'categoria', categoria: 'Proteínas',  tipo: 'porcentaje_descuento', valor: 12,    activo: true };
const R4 = { id: 4, ambito: 'catalogo',                           tipo: 'porcentaje_descuento', valor: 10,    activo: true };

const REGLAS = [R1, R2, R3, R4];

describe('la previsualización de la maqueta, número por número', () => {
  const { porProducto, cobertura } = resolverPrecios(PRODUCTOS, REGLAS);

  it('los seis precios de PREVIEW son los que devuelve el motor', () => {
    expect(porProducto.get(2).precio).toBe(21900); // Creatina · regla de producto
    expect(porProducto.get(1).precio).toBe(38868); // Whey · marca ENA −18 %
    expect(porProducto.get(5).precio).toBe(19844); // BCAA · marca ENA −18 %
    expect(porProducto.get(3).precio).toBe(2464);  // Barra · categoría Proteínas −12 %
    expect(porProducto.get(4).precio).toBe(31050); // Pump · todo el catálogo −10 %
    expect(porProducto.get(8).precio).toBe(7110);  // Shaker · todo el catálogo −10 %
  });

  it('un producto alcanzado por cuatro reglas termina con una sola, y las otras quedan pisadas', () => {
    // La Whey la alcanzan tres: marca ENA, categoría Proteínas y todo el
    // catálogo. Gana la marca, que es más específica que la categoría.
    const whey = porProducto.get(1);

    expect(whey.gana.id).toBe(R2.id);
    expect(whey.pisadas.map((r) => r.id).sort()).toEqual([R3.id, R4.id]);

    // Y la Creatina, que además tiene una regla de producto: gana ésa.
    const creatina = porProducto.get(2);
    expect(creatina.gana.id).toBe(R1.id);
    expect(creatina.pisadas.map((r) => r.id)).toEqual([R4.id]);
  });

  it('«gana en N de M» sale del mismo recorrido que los precios y los dos números cierran', () => {
    expect(cobertura.get(R1.id)).toEqual({ alcanza: 1, gana: 1 });
    expect(cobertura.get(R2.id)).toEqual({ alcanza: 2, gana: 2 });
    expect(cobertura.get(R3.id)).toEqual({ alcanza: 2, gana: 1 });
    expect(cobertura.get(R4.id)).toEqual({ alcanza: 8, gana: 4 });

    // La suma de los «gana» es exactamente la cantidad de productos: cada
    // producto lo gana una sola regla, ni cero ni dos.
    const totalGanados = [...cobertura.values()].reduce((a, c) => a + c.gana, 0);
    expect(totalGanados).toBe(PRODUCTOS.length);
  });

  it('la regla del catálogo alcanza a todos, aunque casi nunca gane', () => {
    // Es el número que hace entendible la pantalla: «alcanza 8, gana 4» dice de
    // un vistazo que la mitad está pisada por algo más específico.
    expect(cobertura.get(R4.id).alcanza).toBe(PRODUCTOS.length);
  });
});

describe('la escala de especificidad', () => {
  it('producto gana a marca, marca a categoría y categoría a catálogo', () => {
    expect(ESPECIFICIDAD.producto).toBeGreaterThan(ESPECIFICIDAD.marca);
    expect(ESPECIFICIDAD.marca).toBeGreaterThan(ESPECIFICIDAD.categoria);
    expect(ESPECIFICIDAD.categoria).toBeGreaterThan(ESPECIFICIDAD.catalogo);
  });

  it('con las cuatro candidatas juntas gana la de producto', () => {
    const { gana, pisadas } = reglaQueGana([R4, R3, R2, R1]);

    expect(gana.id).toBe(R1.id);
    expect(pisadas).toHaveLength(3);
  });

  it('sin ninguna candidata no hay ganadora y el precio es el de lista', () => {
    expect(reglaQueGana([])).toEqual({ gana: null, pisadas: [] });

    const { porProducto } = resolverPrecios(PRODUCTOS, []);
    expect(porProducto.get(1).precio).toBe(47400);
    expect(porProducto.get(1).gana).toBeNull();
  });
});

describe('una regla desactivada se comporta como si no existiera', () => {
  it('ni aplica, ni pisa, ni cuenta', () => {
    const apagada = { ...R2, activo: false };
    const { porProducto, cobertura } = resolverPrecios(PRODUCTOS, [apagada, R3, R4]);

    // La Whey pasa a ganarla la categoría, que era la siguiente.
    expect(porProducto.get(1).gana.id).toBe(R3.id);
    expect(porProducto.get(1).precio).toBe(41712); // 47400 × 0,88

    // Y no aparece en la cobertura: no es «0 de 0», directamente no está.
    expect(cobertura.has(apagada.id)).toBe(false);
  });
});

describe('los tres tipos', () => {
  it('porcentaje, monto y precio fijo', () => {
    expect(aplicarRegla(1000, { tipo: 'porcentaje_descuento', valor: 25 })).toBe(750);
    expect(aplicarRegla(1000, { tipo: 'monto_descuento', valor: 300 })).toBe(700);
    expect(aplicarRegla(1000, { tipo: 'precio_fijo', valor: 899 })).toBe(899);
  });

  it('un descuento del 100 % da cero y no un negativo', () => {
    expect(aplicarRegla(1000, { tipo: 'porcentaje_descuento', valor: 100 })).toBe(0);
  });

  it('un monto mayor que el precio da cero y no un negativo', () => {
    // Un precio negativo es peor que uno en cero: el carrito lo sumaría
    // restando, y el total del pedido bajaría al agregar un producto.
    expect(aplicarRegla(500, { tipo: 'monto_descuento', valor: 900 })).toBe(0);
  });
});

describe('validarRegla, que corre al guardar y no al aplicar', () => {
  it('rechaza el porcentaje fuera de (0, 100]', () => {
    expect(validarRegla({ ...R2, valor: 0 }).ok).toBe(false);
    expect(validarRegla({ ...R2, valor: -5 }).ok).toBe(false);
    expect(validarRegla({ ...R2, valor: 101 }).ok).toBe(false);

    expect(validarRegla({ ...R2, valor: 100 }).ok).toBe(true);
    expect(validarRegla({ ...R2, valor: 1 }).ok).toBe(true);
  });

  it('rechaza el precio fijo de $0: publicaría un producto gratis', () => {
    const rechazo = validarRegla({ ...R1, valor: 0 });

    expect(rechazo.ok).toBe(false);
    expect(rechazo.motivo).toMatch(/mayor que cero/i);
  });

  it('rechaza una regla sin objetivo', () => {
    // Es lo mismo que exige el CHECK de la base, contestado con un mensaje que
    // se puede mostrar en vez de con un error de Postgres.
    expect(validarRegla({ ambito: 'marca', tipo: 'porcentaje_descuento', valor: 10 }).ok).toBe(false);
    expect(validarRegla({ ambito: 'producto', tipo: 'precio_fijo', valor: 100 }).ok).toBe(false);
  });

  it('rechaza ámbitos y tipos que no existen', () => {
    expect(validarRegla({ ambito: 'proveedor', tipo: 'precio_fijo', valor: 1 }).ok).toBe(false);
    expect(validarRegla({ ambito: 'catalogo', tipo: 'dos_por_uno', valor: 1 }).ok).toBe(false);
  });

  it('la regla de catálogo no necesita objetivo', () => {
    expect(validarRegla(R4).ok).toBe(true);
  });
});

describe('los bordes que la base deja pasar', () => {
  it('una regla de marca cuya marca se borró queda «0 de 0» y no se borra sola', () => {
    // `ON DELETE SET NULL`: la fila sigue existiendo con `brand_id` en NULL. El
    // motor la lee como «no alcanza a nadie» y la pantalla la dibuja atenuada.
    const huerfana = { ...R2, brand_id: null };
    const { cobertura, porProducto } = resolverPrecios(PRODUCTOS, [huerfana, R4]);

    expect(cobertura.get(huerfana.id)).toEqual({ alcanza: 0, gana: 0 });
    // Y la Whey pasa a la del catálogo, sin quedar sin precio.
    expect(porProducto.get(1).gana.id).toBe(R4.id);
  });

  it('la categoría se compara normalizada: «Proteínas» y «proteinas» son la misma', () => {
    // Es lo que impide que el mismo producto salga con un precio en el catálogo
    // y con otro en la previsualización.
    const conAcento = { ...R3, categoria: 'proteinas' };
    const { porProducto } = resolverPrecios(PRODUCTOS, [conAcento]);

    expect(porProducto.get(3).precio).toBe(2464);
  });

  it('un producto sin marca no se cuelga de una regla de marca', () => {
    const sinMarca = [{ id: 99, brand_id: null, category: 'Otros', precioLista: 1000 }];
    const { porProducto, cobertura } = resolverPrecios(sinMarca, [R2, R4]);

    expect(porProducto.get(99).gana.id).toBe(R4.id);
    expect(cobertura.get(R2.id)).toEqual({ alcanza: 0, gana: 0 });
  });

  it('un catálogo sin productos no rompe ni inventa cobertura', () => {
    const { porProducto, cobertura } = resolverPrecios([], REGLAS);

    expect(porProducto.size).toBe(0);
    for (const regla of REGLAS) {
      expect(cobertura.get(regla.id)).toEqual({ alcanza: 0, gana: 0 });
    }
  });
});
