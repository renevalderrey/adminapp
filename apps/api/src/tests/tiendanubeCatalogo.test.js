// ════════════════════════════════════════════
//  La respuesta de TiendaNube, normalizada
//
//  El defecto que abre este archivo es `getProducts` trayendo **una sola
//  página**: pedía `/v1/{user_id}/products` sin `page` ni `per_page` y devolvía
//  `response.data` crudo. Una tienda con más productos de los que entran en una
//  página mostraba los primeros y **nada avisaba**: la lista se veía completa.
//
//  ⚠ **Por eso la fixture tiene DOS páginas.** Con una sola, «trae todo» y
//  «trae la primera» dan exactamente el mismo resultado, y este archivo pasaría
//  con y sin el arreglo. Es la trampa que `CONVENCIONES.md` nombra entre las
//  fixtures que dejaron pasar defectos, y acá está del lado del código.
//
//  Lo mismo con lo demás: un producto con **tres** variantes (agrupar por
//  producto se ve), una variante con **SKU vacío** (dos vacíos no pueden
//  coincidir entre sí), un producto **sin variantes** y una respuesta con
//  **`variants: null`** (el refresco entero se caía por un producto a medio
//  cargar).
//
//  ⚠ Este archivo vive en `src/tests/` y no al lado de `utils/`: el `testMatch`
//  de `jest.config.js` solo levanta `src/tests/**` y `__tests__/**`, así que un
//  `src/utils/algo.test.js` jest **no lo corre nunca** — no falla, no avisa. Lo
//  protege `todosLosTestsCorren.test.js`.
// ════════════════════════════════════════════

const { normalizarCatalogo, sugerirPorSku } = require('../utils/tiendanubeCatalogo');

/**
 * La primera página del catálogo de la tienda.
 *
 * `Harina 000` tiene **tres** variantes y las tres tienen que producir su propia
 * fila: la variante es la unidad que tiene stock, y es contra la que se mapea.
 */
const PAGINA_1 = [
  {
    id: 700001,
    // Multi-idioma, como devuelve la API de una tienda con más de un idioma.
    name: { es: 'Harina 000', pt: 'Farinha 000' },
    variants: [
      { id: 5000001, sku: 'HAR-000', stock: 20, values: [{ es: '1 kg' }] },
      // SKU vacío: no puede sugerir nada, y sobre todo no puede coincidir con
      // otro SKU vacío.
      { id: 5000002, sku: '', stock: 4, values: [{ es: '5 kg' }] },
      // Con espacios y en minúscula: es lo que produce un copiar y pegar desde
      // una planilla, y tiene que coincidir con `LEV-001` del sistema.
      { id: 5000003, sku: '  lev-001  ', stock: null, values: [{ es: '25 kg' }] },
    ],
  },
  {
    id: 700002,
    // Sin traducciones: la otra forma en que llega el nombre.
    name: 'Sal fina',
    // Sin opciones: la variante por defecto de un producto sin talles ni
    // colores. No tiene nombre de variante y eso no es un error.
    variants: [{ id: 5000004, sku: 'SAL-001', stock: 0, values: [] }],
  },
];

/** La segunda página. Sin ella, «trae todo» y «trae la primera» son lo mismo. */
const PAGINA_2 = [
  {
    id: 700003,
    name: { es: 'Aceite de girasol' },
    variants: [{ id: 5000005, sku: 'ACE-900', stock: 3, values: [{ es: '900 ml' }] }],
  },
  // Un producto sin ninguna variante: no hay nada que tenga stock, así que no
  // produce ninguna fila.
  { id: 700004, name: { es: 'Combo navideño' }, variants: [] },
  // Y uno a medio cargar desde el panel de TiendaNube: `variants` viene `null`.
  { id: 700005, name: { es: 'Producto a medio cargar' }, variants: null },
];

const CATALOGO = [PAGINA_1, PAGINA_2];

/** Los productos del sistema, con los SKU que hacen falta para la sugerencia. */
const PRODUCTOS = [
  { id: 501, name: 'Harina 000 x 1kg', sku: 'HAR-000', is_active: true },
  // ⚠ El MISMO SKU que el anterior, en otro producto. Es lo que hace que
  // «propone el que coincide» y «propone el primero que encuentra» se puedan
  // distinguir: sin esta fila, las dos implementaciones dan el mismo resultado.
  { id: 502, name: 'Harina 000 x 25kg', sku: 'HAR-000', is_active: true },
  { id: 503, name: 'Levadura fresca', sku: 'LEV-001', is_active: true },
  { id: 504, name: 'Sal fina', sku: 'SAL-001', is_active: false },
  // Un producto del sistema SIN SKU. Sin él, «el vacío no coincide con el
  // vacío» no se puede ejercitar de los dos lados.
  { id: 505, name: 'Producto sin código', sku: '', is_active: true },
];

const porVariante = (filas, id) => filas.find((f) => f.tiendanube_variant_id === id);

describe('normalizarCatalogo · una fila por variante, de TODAS las páginas', () => {
  it('trae las variantes de las DOS páginas', () => {
    const filas = normalizarCatalogo(CATALOGO);

    // Cinco variantes: tres de Harina, una de Sal (página 1) y una de Aceite
    // (página 2). Los productos sin variantes no aportan ninguna.
    expect(filas).toHaveLength(5);

    const ids = filas.map((f) => f.tiendanube_variant_id);
    expect(ids).toEqual([5000001, 5000002, 5000003, 5000004, 5000005]);

    // El ancla que muerde: la variante de la segunda página. Devolver solo la
    // primera —que es lo que hacía `getProducts`— deja esto afuera y la tienda
    // muestra un catálogo incompleto sin que nada avise.
    expect(porVariante(filas, 5000005)).toMatchObject({
      tiendanube_product_id: 700003,
      nombre_producto: 'Aceite de girasol',
      nombre_variante: '900 ml',
      sku: 'ACE-900',
    });
  });

  it('un producto con tres variantes produce TRES filas, no una', () => {
    const filas = normalizarCatalogo(CATALOGO);

    const deLaHarina = filas.filter((f) => f.tiendanube_product_id === 700001);

    // Agrupar por producto dejaría una sola fila con un stock que no es de nada,
    // y el mapeo apuntando a algo que `PUT /products/variants/{id}` no puede
    // actualizar.
    expect(deLaHarina).toHaveLength(3);
    expect(deLaHarina.map((f) => f.nombre_variante)).toEqual(['1 kg', '5 kg', '25 kg']);
    // Las tres comparten el producto y el nombre del producto.
    expect(new Set(deLaHarina.map((f) => f.nombre_producto))).toEqual(new Set(['Harina 000']));
  });

  it('la variante sin opciones queda sin nombre de variante, y eso no es un error', () => {
    const filas = normalizarCatalogo(CATALOGO);

    expect(porVariante(filas, 5000004)).toMatchObject({
      nombre_producto: 'Sal fina',
      nombre_variante: null,
      sku: 'SAL-001',
    });
  });

  it('un stock null de la tienda NO se lee como cero', () => {
    // TiendaNube manda `stock: null` cuando la variante tiene stock ilimitado.
    // Convertirlo a cero haría que la reconciliación viera una diferencia contra
    // cualquier número y encolara esa variante para siempre.
    const filas = normalizarCatalogo(CATALOGO);

    expect(porVariante(filas, 5000003).stock_en_tienda).toBeNull();
    // Y el cero de verdad sigue siendo cero: si los dos dieran null, este caso
    // pasaría por colapsarlos en vez de por distinguirlos.
    expect(porVariante(filas, 5000004).stock_en_tienda).toBe(0);
    expect(typeof porVariante(filas, 5000004).stock_en_tienda).toBe('number');
  });

  it('variants null no tira, y el resto de la página entra igual', () => {
    // Un producto a medio cargar desde el panel de TiendaNube tiraba
    // `TypeError: variants is not iterable` y se llevaba puesto el refresco
    // entero: la instantánea quedaba a medias y nada decía cuál fue.
    expect(() => normalizarCatalogo(CATALOGO)).not.toThrow();

    const filas = normalizarCatalogo([PAGINA_2]);

    expect(filas).toHaveLength(1);
    expect(filas[0].tiendanube_variant_id).toBe(5000005);
  });

  it('una respuesta vacía, sin páginas o mal formada devuelve una lista vacía', () => {
    // El refresco de una tienda recién creada trae esto, y no puede tirar.
    for (const entrada of [[], [[]], null, undefined, {}, [null]]) {
      expect(normalizarCatalogo(entrada)).toEqual([]);
    }
  });

  it('un nombre más largo que la columna se recorta acá y no en el INSERT', () => {
    // `nombre_producto` es VARCHAR(300). Sin el recorte, Postgres responde
    // «value too long for type character varying(300)» y sale como un 500 sin
    // ningún mensaje que diga cuál producto lo causó. El nombre es de un tercero.
    const filas = normalizarCatalogo([[
      { id: 1, name: { es: 'M'.repeat(400) }, variants: [{ id: 2, sku: 'S'.repeat(200), stock: 1 }] },
    ]]);

    expect(filas[0].nombre_producto).toHaveLength(300);
    expect(filas[0].sku).toHaveLength(100);
  });
});

describe('sugerirPorSku · propone, no mapea, y con dos coincidencias no propone', () => {
  const sugerencias = () => sugerirPorSku(normalizarCatalogo(CATALOGO), PRODUCTOS);

  it('una variante con SKU vacío no rompe y no sugiere nada', () => {
    // ⚠ El sistema tiene un producto SIN SKU (505). Si el vacío coincidiera con
    // el vacío, esta variante propondría ese producto al azar.
    const sugerida = sugerencias().get('5000002');

    expect(sugerida).toEqual({ coincidencias: 0, producto: null });
  });

  it('SKU repetido en DOS productos del sistema no sugiere: dice que hay dos', () => {
    // Es el daño concreto: con «propone el primero», la variante de 1 kg queda
    // mapeada al producto de 25 kg según el orden en que Postgres haya devuelto
    // las filas, y el síntoma aparece en un recuento meses después.
    const sugerida = sugerencias().get('5000001');

    expect(sugerida.coincidencias).toBe(2);
    expect(sugerida.producto).toBeNull();
  });

  it('el SKU se compara sin distinguir capitalización ni espacios', () => {
    // La variante trae '  lev-001  ' y el producto del sistema 'LEV-001'.
    const sugerida = sugerencias().get('5000003');

    expect(sugerida.coincidencias).toBe(1);
    expect(sugerida.producto).toEqual({ id: 503, name: 'Levadura fresca', sku: 'LEV-001' });
  });

  it('con una sola coincidencia propone ese producto, aunque esté inactivo', () => {
    // El ancla: si la función nunca propusiera nada, los dos casos de arriba
    // seguirían en verde. Y un producto inactivo se propone igual —[PENDIENTE
    // N10]: se publica el stock que tiene y la pantalla marca la fila—.
    const sugerida = sugerencias().get('5000004');

    expect(sugerida.coincidencias).toBe(1);
    expect(sugerida.producto.id).toBe(504);
  });

  it('una variante sin ningún SKU coincidente queda en cero y no en undefined', () => {
    // `ACE-900` no existe en el sistema. La pantalla lee `coincidencias` sin
    // preguntar si la clave está: una entrada faltante haría que el badge de la
    // sugerencia se dibujara como si hubiera una.
    const sugerida = sugerencias().get('5000005');

    expect(sugerida).toEqual({ coincidencias: 0, producto: null });
    // Y hay una entrada por CADA variante, no solo por las que coincidieron.
    expect(sugerencias().size).toBe(5);
  });

  it('la clave es el id como texto: el BIGINT vuelve como string desde Postgres', () => {
    // `tiendanube_variant_id` es BIGINT y el driver lo devuelve como string.
    // Indexar por número dejaría la sugerencia sin encontrarse justo cuando los
    // datos vienen de la base y no de la API.
    const sugerida = sugerirPorSku(
      [{ tiendanube_variant_id: '5000003', sku: 'LEV-001' }],
      PRODUCTOS
    );

    expect(sugerida.get('5000003').producto.id).toBe(503);
  });

  it('sin productos y sin variantes no tira', () => {
    expect(sugerirPorSku(null, null).size).toBe(0);
    expect(sugerirPorSku([{ tiendanube_variant_id: 1, sku: 'X' }], []).get('1').coincidencias).toBe(0);
  });
});
