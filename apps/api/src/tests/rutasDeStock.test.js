// ════════════════════════════════════════════
//  Las tres puertas por las que se escribe stock a mano
//
//  `POST /api/stock`, `POST /api/stock/bulk` y `PUT /api/stock/:id` son las
//  rutas que usa la pantalla de Inventario. Las tres tenían el mismo par de
//  defectos:
//
//   1. **Ubicaban la fila por el texto `location`.** Ese texto lo escribía el
//      cliente y no tiene por qué coincidir con ninguna sucursal: en una
//      empresa sembrada por `seedPuntosDeVenta`, cuyos códigos son
//      general/ortiz/mayo, un `location: 'principal'` no coincide con nada. La
//      fila quedaba con `punto_de_venta_id` en null y la pantalla —que lee por
//      `punto_de_venta_id`— no la mostraba **nunca**. Así nace «una pila
//      anotada dos veces».
//
//   2. **Validaban distinto según si la fila ya existía.** `PUT` rechazaba un
//      stock negativo; `POST` lo creaba. La misma pantalla, con el mismo campo,
//      aceptaba o no según algo que el usuario no puede ver. Es el defecto 4.
//
//  Y `PUT` tenía `location` en su lista blanca: cambiarlo movía la mercadería
//  de sucursal **sin dejar ningún registro**. Mover mercadería es
//  `POST /api/stock/transfer`, que es transaccional y deja constancia.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const GENERAL = fs.readFileSync(path.join(SRC, 'routes', 'general.js'), 'utf8');
const STOCK = fs.readFileSync(path.join(SRC, 'routes', 'stock.js'), 'utf8');

/** El texto entre dos marcas del archivo. */
function entre(fuente, inicio, fin) {
  const i = fuente.indexOf(inicio);
  const j = fuente.indexOf(fin, i);

  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);

  return fuente.slice(i, j);
}

const PUT_STOCK = entre(GENERAL, "router.put('/stock/:id'", "router.post('/stock'");
const POST_STOCK = entre(GENERAL, "router.post('/stock'", "router.post('/stock/bulk'");
const POST_BULK = entre(GENERAL, "router.post('/stock/bulk'", '═══════ MARCAS ═══════');

describe('el stock negativo se rechaza por las dos puertas', () => {
  it('POST /stock valida quantity y available, igual que PUT /stock/:id', () => {
    // Antes solo validaba el PUT. Cargar -5 sobre un producto que ya tenía
    // stock en esa sucursal daba 400; sobre uno que no lo tenía, creaba una
    // fila en -5 sin decir nada.
    expect(POST_STOCK).toMatch(/quantity !== undefined && quantity < 0/);
    expect(POST_STOCK).toMatch(/available !== undefined && available < 0/);
  });

  it('los dos mensajes son EXACTAMENTE los mismos en las dos puertas', () => {
    // Dos textos parecidos escritos en dos lugares empiezan iguales y terminan
    // distintos. Con la constante compartida, el usuario lee lo mismo venga por
    // donde venga.
    expect(PUT_STOCK).toMatch(/error: STOCK_NEGATIVO/);
    expect(PUT_STOCK).toMatch(/error: DISPONIBLE_NEGATIVO/);
    expect(POST_STOCK).toMatch(/error: STOCK_NEGATIVO/);
    expect(POST_STOCK).toMatch(/error: DISPONIBLE_NEGATIVO/);

    expect(GENERAL).toMatch(/const STOCK_NEGATIVO = 'El stock no puede ser negativo'/);
    expect(GENERAL).toMatch(/const DISPONIBLE_NEGATIVO = 'El disponible no puede ser negativo'/);
  });

  it('la validación va ANTES del findOrCreate y no después', () => {
    // Si fuera después, la fila ya existiría cuando se rechaza el valor.
    const validacion = POST_STOCK.indexOf('quantity < 0');
    const escritura = POST_STOCK.indexOf('Stock.findOrCreate');

    expect(validacion).toBeGreaterThanOrEqual(0);
    expect(escritura).toBeGreaterThan(validacion);
  });
});

describe('la sucursal no sale del texto que mandó el cliente', () => {
  it.each([
    ['POST /stock', () => POST_STOCK],
    ['POST /stock/bulk', () => POST_BULK],
  ])('%s resuelve la sucursal por utils/sucursalDeStock', (_, obtener) => {
    const handler = obtener();

    expect(handler).toMatch(/resolverSucursal\(/);
    expect(handler).toMatch(/ubicacionDeStock\(/);
  });

  it.each([
    ['POST /stock', () => POST_STOCK],
    ['POST /stock/bulk', () => POST_BULK],
  ])('%s NO busca ni crea la fila por location', (_, obtener) => {
    const handler = obtener();

    // Ni en el `where`, ni en los `defaults`, ni como rama condicional.
    expect(handler).not.toMatch(/location:\s*loc\b/);
    expect(handler).not.toMatch(/location:\s*location\b/);
    expect(handler).not.toMatch(/location:\s*req\.body\.location/);
    expect(handler).not.toMatch(/punto_de_venta_id:\s*[^,\n]*\|\|\s*null/);
  });

  it('el bulk perdió la rama que elegía entre punto de venta y location', () => {
    // Era `const where = pvId ? {…punto_de_venta_id} : {…location}`. Esa rama
    // es la que escribía filas que la pantalla no lee.
    expect(POST_BULK).not.toMatch(/pvId\s*\?/);
    expect(POST_BULK).not.toMatch(/const where =/);
  });
});

describe('PUT /stock/:id no mueve mercadería de sucursal', () => {
  it('location NO está en la lista blanca del update', () => {
    // Cambiar `location` movía la fila de sucursal sin movimiento, sin
    // transferencia y sin nada que lo registre. Eso es `POST /stock/transfer`.
    expect(PUT_STOCK).not.toMatch(/cambios\.location\s*=/);
  });

  it('el resto de la lista blanca sigue entera', () => {
    // El defecto que la lista vino a resolver era `update(req.body)` crudo. Si
    // al sacar `location` se llevara puesto otro campo, editar un mínimo o un
    // lote dejaría de funcionar sin que nada avise.
    for (const campo of ['quantity', 'available', 'min_stock', 'current_batch',
      'expiration_date', 'purchase_date']) {
      expect(PUT_STOCK).toMatch(new RegExp(`cambios\\.${campo} = `));
    }
  });

  it('sigue sincronizando available cuando solo viene quantity', () => {
    expect(PUT_STOCK).toMatch(/Math\.max\(0, oldAvail \+ delta\)/);
  });

  it('sigue dejando el StockMovement', () => {
    expect(PUT_STOCK).toMatch(/StockMovement\.create/);
  });
});

// ════════════════════════════════════════════
//  GET /api/stock/sucursales
// ════════════════════════════════════════════

describe('las sucursales que la tabla necesita para tener columnas', () => {
  const SUCURSALES = entre(STOCK, "router.get('/sucursales'", "router.post('/transfer'");

  it('devuelve TAMBIÉN las inactivas', () => {
    // Es lo que hoy no llega al navegador por ningún camino: los dos endpoints
    // que listan puntos de venta filtran por `is_active`. Cerrar un local no
    // evapora su mercadería, y ese stock es justamente el que hay que poder
    // transferir a otro lado (FR-066, FR-115).
    expect(SUCURSALES).toMatch(/where: \{ empresa_id: req\.empresaId \}/);
    expect(SUCURSALES).not.toMatch(/is_active: true/);
  });

  it('filtra por empresa_id y no lista las sucursales de otro cliente', () => {
    expect(SUCURSALES).toMatch(/empresa_id: req\.empresaId/);
  });

  it('pide stock.ver y no crea un permiso nuevo', () => {
    // La pantalla es para el cliente y los permisos vigentes alcanzan
    // (supuesto 3). `sucursales.ver` —que pide el otro endpoint— es
    // justamente el que esta pantalla NO exige.
    expect(STOCK).toMatch(/router\.get\('\/sucursales', checkPermission\('stock\.ver'\)/);
    expect(SUCURSALES).not.toMatch(/sucursales\.ver/);
  });

  it('ordena activas primero y después por nombre', () => {
    // Es el orden en el que se dibujan las columnas de la tabla: si el
    // navegador ordenara distinto, la columna 3 de una pantalla no sería la
    // columna 3 de la otra.
    expect(SUCURSALES).toMatch(/order: \[\['is_active', 'DESC'\], \['name', 'ASC'\]\]/);
  });

  it('devuelve exactamente los cuatro campos del contrato', () => {
    expect(SUCURSALES).toMatch(/attributes: \['id', 'name', 'code', 'is_active'\]/);
  });
});

describe('GET /api/stock/transfers trae los nombres de las sucursales', () => {
  const TRANSFERS = STOCK.slice(STOCK.indexOf("router.get('/transfers'"));

  it('incluye fromPuntoDeVenta y toPuntoDeVenta con { id, name }', () => {
    expect(TRANSFERS).toMatch(/as: 'fromPuntoDeVenta'/);
    expect(TRANSFERS).toMatch(/as: 'toPuntoDeVenta'/);
    expect(TRANSFERS.match(/attributes: \['id', 'name'\]/g)).toHaveLength(2);
  });

  it('los dos includes son required: false', () => {
    // Una transferencia anterior a esta funcionalidad puede tener los dos ids
    // en `null`. Con un INNER JOIN esas filas desaparecerían del historial: el
    // usuario vería que se le borraron transferencias que sí ocurrieron.
    // Se cuentan las líneas de código y no las menciones: el comentario que
    // explica la decisión también dice `required: false`.
    expect(TRANSFERS.match(/\n\s+required: false,/g)).toHaveLength(2);
    expect(TRANSFERS).not.toMatch(/\n\s+required: true,/);
  });

  it('no cambia limit, offset ni el scoping por empresa', () => {
    expect(TRANSFERS).toMatch(/where: \{ empresa_id: req\.empresaId \}/);
    expect(TRANSFERS).toMatch(/limit,/);
    expect(TRANSFERS).toMatch(/offset,/);
    expect(TRANSFERS).toMatch(/order: \[\['createdAt', 'DESC'\]\]/);
  });
});

describe('general.js no se puede comer /api/stock/sucursales', () => {
  // `server.js:342` monta `routes/general.js` en `/api` **antes** que
  // `/api/stock` (`:354`), así que Express le da a `general.js` la primera
  // oportunidad de contestar `/api/stock/sucursales`. Hoy sale por el router de
  // stock solo porque `general.js` declara `GET /stock` **exacto**. No es un
  // diseño, es una coincidencia: el día que alguien agregue un `GET /stock/:id`
  // allá, se come `/sucursales` y la tabla se queda sin columnas — y nada más
  // falla, así que nadie lo relaciona.
  it('NO declara ninguna ruta GET /stock con parámetro', () => {
    const conParametro = [...GENERAL.matchAll(/router\.get\('\/stock\/([^']*)'/g)]
      .map((m) => m[1])
      .filter((sub) => sub.includes(':'));

    expect(conParametro).toEqual([]);
  });

  it('la única GET /stock de general.js sigue siendo la exacta', () => {
    const rutas = [...GENERAL.matchAll(/router\.get\('(\/stock[^']*)'/g)].map((m) => m[1]);

    expect(rutas).toEqual(['/stock']);
  });
});

// ════════════════════════════════════════════
//  POST /api/stock/transfer
// ════════════════════════════════════════════

describe('la transferencia mueve mercadería entre sucursales de verdad', () => {
  const TRANSFER = entre(STOCK, "router.post('/transfer'", "router.get('/transfers'");

  it('resuelve los dos extremos por utils/sucursalDeStock, antes de tocar nada', () => {
    // Un `code` que no resuelve es un 400 con los códigos válidos —lo tira
    // `resolverSucursal`— y no una caída a buscar por el texto `location`.
    expect(TRANSFER).toMatch(/resolverSucursal\(/);

    const resolucion = TRANSFER.indexOf('resolverSucursal');
    const primeraEscritura = TRANSFER.indexOf('Stock.findOne');

    expect(resolucion).toBeGreaterThanOrEqual(0);
    expect(primeraEscritura).toBeGreaterThan(resolucion);
  });

  it('NO cae a buscar la fila por location', () => {
    // Era `if (fromPv) {…punto_de_venta_id} else {…location}`. Esa caída movía
    // mercadería entre filas que la pantalla no muestra.
    expect(TRANSFER).not.toMatch(/sourceWhere\.location/);
    expect(TRANSFER).not.toMatch(/destWhere\.location/);
    expect(TRANSFER).not.toMatch(/location:\s*from_location/);
  });

  it('acepta los ids además de los códigos', () => {
    expect(TRANSFER).toMatch(/from_punto_de_venta_id/);
    expect(TRANSFER).toMatch(/to_punto_de_venta_id/);
  });

  it('un ítem sin producto o en cantidad cero FALLA, no se saltea', () => {
    // Con el `continue` de antes, una transferencia de un solo ítem en
    // cantidad 0 quedaba registrada **sin ningún ítem**: un registro que dice
    // que se movió mercadería cuando no se movió nada.
    expect(TRANSFER).not.toMatch(/qty <= 0\) continue/);
    expect(TRANSFER).toMatch(/items\.findIndex/);
  });

  it('origen y destino se comparan por id y no por el texto', () => {
    // Mandar el código de una sucursal en un campo y su id en el otro pasaba
    // la comparación de textos y movía mercadería de una sucursal a sí misma.
    expect(TRANSFER).toMatch(/fromPv\.id === toPv\.id/);
    expect(TRANSFER).not.toMatch(/from_location === to_location/);
  });

  it('el destino inactivo se rechaza y el origen inactivo se permite (FR-115)', () => {
    // Sacar mercadería de un local que cerró es justamente lo que hay que
    // poder hacer. Mandarla ahí, no.
    expect(TRANSFER).toMatch(/toPv\.is_active === false/);
    expect(TRANSFER).not.toMatch(/fromPv\.is_active === false/);
  });

  it('la fila de destino se crea SIEMPRE con punto_de_venta_id', () => {
    // Antes iba solo si el destino había resuelto por código.
    const alta = TRANSFER.slice(TRANSFER.indexOf('Stock.create'));

    expect(alta).toMatch(/\.\.\.destino/);
    expect(TRANSFER).not.toMatch(/if \(toPv\) createData\.punto_de_venta_id/);
  });

  it('una transferencia que falla no deja ninguna fila movida', () => {
    // Todo sigue adentro de la misma transacción, con rollback en el catch.
    expect(TRANSFER).toMatch(/sequelize\.transaction\(\)/);
    expect(TRANSFER).toMatch(/await t\.rollback\(\)/);
    expect(TRANSFER).toMatch(/ErrorDeNegocio\(`Stock insuficiente/);
  });
});

// ════════════════════════════════════════════
//  POST /api/import/products
// ════════════════════════════════════════════

describe('la importación escribe en el stock que la pantalla lee', () => {
  const IMPORT = fs.readFileSync(path.join(SRC, 'routes', 'import.js'), 'utf8');

  it('NO queda el string "principal" hardcodeado como sucursal', () => {
    // En una empresa sembrada por `seedPuntosDeVenta`, cuyos códigos son
    // general/ortiz/mayo, ese texto no coincide con **nada**: la importación
    // escribía filas en una sucursal inexistente. Es literalmente el caso con
    // el que el plan explica cómo nace «una pila anotada dos veces».
    const codigo = IMPORT.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

    expect(codigo).not.toMatch(/defaultLocation\s*\|\|\s*'principal'/);
    expect(codigo).not.toMatch(/=\s*'principal'/);
  });

  it('busca y crea la fila por punto_de_venta_id y no por location', () => {
    // Escribía por `location` y la pantalla lee por `punto_de_venta_id`: el
    // usuario importaba 300 productos, veía los stocks viejos y no se enteraba
    // de nada. Es el criterio de éxito 7.
    const alta = entre(IMPORT, 'Stock.findOrCreate', 'if (!stock.isNewRecord)');

    expect(alta).toMatch(/punto_de_venta_id: ubicacion\.punto_de_venta_id/);
    expect(alta).not.toMatch(/where: \{ product_id: product\.id, location/);
  });

  it('un defaultLocation que no resuelve rechaza el archivo ENTERO, antes de escribir', () => {
    // Aplica a todas las filas: descubrirlo en la fila 300 sería tarde, con
    // 299 productos ya escritos en la sucursal equivocada.
    const resolucion = IMPORT.indexOf('sucursalPorDefectoDelArchivo = await resolverSucursal');
    const escritura = IMPORT.indexOf('Stock.findOrCreate');

    expect(resolucion).toBeGreaterThanOrEqual(0);
    expect(escritura).toBeGreaterThan(resolucion);
    expect(IMPORT).toMatch(/return res\.status\(400\)\.json\(\{ ok: false, error: err\.message \}\)/);
  });

  it('una sucursal de fila que no existe informa la línea y los códigos válidos', () => {
    // «Sucursal inválida» a secas no dice qué poner, y después de FR-050 una
    // planilla que «funcionaba» puede informar trescientos errores de fila.
    expect(IMPORT).toMatch(/fila: i \+ 2,/);
    expect(IMPORT).toMatch(/no existe\./);
    expect(IMPORT).toMatch(/Códigos válidos: \$\{codigosValidos\}/);
  });

  it('informa cuántos productos vinieron repetidos en el archivo', () => {
    expect(IMPORT).toMatch(/pisados\+\+/);
    expect(IMPORT).toMatch(/pisados,/);
  });

  it('sigue sin poner el costo en cero cuando la celda viene vacía (FR-099)', () => {
    // Una celda de costo vacía leída como 0 pone en cero el costo de un
    // producto y el margen que muestra el POS pasa a ser mentira.
    expect(IMPORT).toMatch(/if \(cost !== undefined\) productData\.cost = cost/);
    expect(IMPORT).not.toMatch(/cost:\s*toNum\(data\.cost\)\s*\|\|\s*0/);
  });
});

// ════════════════════════════════════════════
//  POST /api/stock con el producto de otra empresa
//
//  El defecto que faltaba en las tres puertas de arriba, y apareció recién en el
//  hito 013 al ensanchar `analizarCreates`: `product_id` viajaba del cuerpo al
//  `findOrCreate` **sin que nadie mirara de quién es ese producto**. La fila de
//  stock salía con el `empresa_id` de quien la mandó —así que revisando la tabla
//  no se ve nada raro— colgada del producto de otro cliente.
//
//  Es la misma forma del defecto 1 de la funcionalidad 012, y la consecuencia ya
//  estaba escrita en `aislamientoDeProveedores.test.js:266`: «el Stock.create
//  crea una fila de stock propia para un producto ajeno».
//
//  ── Por qué ninguna guardia lo veía ──
//
//  El `where` usa la forma corta de ES6 (`{ product_id, … }`) y el extractor de
//  claves de `aislamientoEmpresas.test.js` exigía los dos puntos: contra ese
//  objeto devolvía cero claves y el create no se miraba nunca. Y `findByPk` no
//  aparece por ningún lado, así que la otra guardia tampoco.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const { crearModelo, coincide, validarWhere } = require('./helpers/modelosFalsos');

const PROPIA = 7;
const AJENA = 9;

const mockStockModelo = crearModelo([]);
const mockProductModelo = crearModelo([]);
const mockPuntoDeVentaModelo = crearModelo([]);
const mockStockMovementModelo = crearModelo([]);
const mockBrandModelo = crearModelo([]);
const mockFixedExpenseModelo = crearModelo([]);
const mockSettingModelo = crearModelo([]);
const mockSupplierModelo = crearModelo([]);

// findScoped normaliza el id contra la clave primaria del modelo. Sin esto, un
// id que llega como '501' en el cuerpo no coincidiría nunca con el 501 del
// array y **todo** daría 404 —incluido el caso legítimo—, que es como una
// prueba de aislamiento pasa por el motivo equivocado.
for (const doble of [mockProductModelo, mockPuntoDeVentaModelo, mockStockModelo]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

/**
 * `findOrCreate`, que `modelosFalsos` no trae.
 *
 * Sin él la ruta tira un TypeError, `fallo` lo convierte en un 500 y una prueba
 * que espera «no se creó ninguna fila» pasaría **sin haber ejercitado nada**.
 */
mockStockModelo.findOrCreate = async (opciones = {}) => {
  mockStockModelo.llamadas.push({ metodo: 'findOrCreate', ...opciones });
  validarWhere(opciones.where);

  const existente = mockStockModelo.filas.find((f) => coincide(f, opciones.where));
  if (existente) return [mockStockModelo._hidratar(existente), false];

  const fila = { id: mockStockModelo.filas.length + 1, ...opciones.where, ...opciones.defaults };
  mockStockModelo.filas.push(fila);
  return [mockStockModelo._hidratar(fila), true];
};

jest.mock('../models', () => ({
  Stock: mockStockModelo,
  Product: mockProductModelo,
  PuntoDeVenta: mockPuntoDeVentaModelo,
  StockMovement: mockStockMovementModelo,
  Brand: mockBrandModelo,
  FixedExpense: mockFixedExpenseModelo,
  Setting: mockSettingModelo,
  Supplier: mockSupplierModelo,
}));

function levantarApi(empresaId) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.userId = 'auth0|quien-carga';
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use('/api', require('../routes/general'));
  return api;
}

describe('POST /api/stock no cuelga una fila del producto de otra empresa', () => {
  const SUCURSAL_PROPIA = 31;

  beforeEach(() => {
    mockProductModelo.filas = [
      { id: 501, empresa_id: PROPIA, name: 'Harina propia' },
      { id: 900, empresa_id: AJENA, name: 'Insumo de otro cliente' },
    ];
    mockPuntoDeVentaModelo.filas = [
      { id: SUCURSAL_PROPIA, empresa_id: PROPIA, name: 'Depósito', code: 'principal', is_active: true },
      { id: 41, empresa_id: AJENA, name: 'Kiosco', code: 'kiosco', is_active: true },
    ];
    mockStockModelo.filas = [];
    mockStockModelo.llamadas = [];
  });

  it('con el product_id de otra empresa responde 404 y NO crea ninguna fila de stock', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/stock')
      .send({ product_id: 900, quantity: 12, punto_de_venta_id: SUCURSAL_PROPIA });

    expect(res.status).toBe(404);
    // La mitad que importa: sin el findScoped esto respondía 200 y dejaba una
    // fila de stock de la empresa PROPIA colgada del producto de la AJENA.
    expect(mockStockModelo.filas).toEqual([]);
  });

  it('responde 404 y no 403: un 403 confirmaría que ese producto existe', async () => {
    const ajeno = await request(levantarApi(PROPIA))
      .post('/api/stock')
      .send({ product_id: 900, quantity: 12, punto_de_venta_id: SUCURSAL_PROPIA });

    const inexistente = await request(levantarApi(PROPIA))
      .post('/api/stock')
      .send({ product_id: 999999, quantity: 12, punto_de_venta_id: SUCURSAL_PROPIA });

    expect(ajeno.status).toBe(404);
    expect(ajeno.status).not.toBe(403);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toBe(ajeno.body.error);
  });

  it('sigue cargando stock cuando el producto SÍ es de la empresa', async () => {
    // Sin este caso la validación podría estar rechazando siempre, que es tan
    // inútil como no validar nada: dejaría la pantalla de Inventario sin forma
    // de cargar una fila.
    const res = await request(levantarApi(PROPIA))
      .post('/api/stock')
      .send({ product_id: 501, quantity: 12, punto_de_venta_id: SUCURSAL_PROPIA });

    expect(res.status).toBe(200);
    expect(mockStockModelo.filas).toHaveLength(1);
    expect(mockStockModelo.filas[0]).toMatchObject({
      product_id: 501,
      empresa_id: PROPIA,
      punto_de_venta_id: SUCURSAL_PROPIA,
      quantity: 12,
    });
  });
});

// ════════════════════════════════════════════
//  POST /api/stock/bulk — el hermano que la guardia NO ve
//
//  El mismo defecto que el bloque de arriba, en la carga masiva. Lo dejó
//  anotado la fase que ensanchó `analizarCreates`, porque su detector **sigue
//  sin verlo**: reconoce `product_id: req.body.algo`, y acá el id sale de un
//  elemento del arreglo (`item.product_id`), que es una indirección más.
//
//  O sea que este bloque no es redundante con el anterior: es la única red que
//  existe para esta puerta. Si mañana alguien saca la validación, ninguna
//  guardia estática lo va a nombrar.
//
//  La validación va ANTES del bucle y sobre todos los ids juntos, a propósito:
//  una carga masiva que escribe la mitad de las filas y falla en la otra mitad
//  deja un inventario que nadie puede explicar.
// ════════════════════════════════════════════

describe('POST /api/stock/bulk tampoco cuelga filas de productos ajenos', () => {
  const SUCURSAL_PROPIA = 31;

  beforeEach(() => {
    mockProductModelo.filas = [
      { id: 501, empresa_id: PROPIA, name: 'Harina propia' },
      { id: 502, empresa_id: PROPIA, name: 'Azúcar propia' },
      { id: 900, empresa_id: AJENA, name: 'Insumo de otro cliente' },
    ];
    mockPuntoDeVentaModelo.filas = [
      { id: SUCURSAL_PROPIA, empresa_id: PROPIA, name: 'Depósito', code: 'principal', is_active: true },
    ];
    mockStockModelo.filas = [];
    mockStockModelo.llamadas = [];
  });

  it('un solo product_id ajeno entre varios propios NO escribe NINGUNA fila', async () => {
    // Éste es el caso que importa y el que un `findScoped` adentro del bucle no
    // cubriría: los dos primeros son legítimos, así que una validación por ítem
    // ya habría escrito dos filas antes de llegar al tercero.
    const res = await request(levantarApi(PROPIA))
      .post('/api/stock/bulk')
      .send({
        punto_de_venta_id: SUCURSAL_PROPIA,
        items: [
          { product_id: 501, quantity: 10 },
          { product_id: 502, quantity: 20 },
          { product_id: 900, quantity: 30 },
        ],
      });

    expect(res.status).toBe(404);
    expect(mockStockModelo.filas).toEqual([]);
  });

  it('el mensaje nombra el id ajeno y NO dice nada del producto de la otra empresa', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/stock/bulk')
      .send({
        punto_de_venta_id: SUCURSAL_PROPIA,
        items: [{ product_id: 900, quantity: 30 }],
      });

    // El id ya es del cliente: lo mandó él. El nombre del producto, no.
    expect(res.body.error).toContain('900');
    expect(res.body.error).not.toContain('Insumo de otro cliente');
  });

  it('responde 404 y no 403: un 403 confirmaría que ese producto existe', async () => {
    const ajeno = await request(levantarApi(PROPIA))
      .post('/api/stock/bulk')
      .send({ punto_de_venta_id: SUCURSAL_PROPIA, items: [{ product_id: 900, quantity: 1 }] });

    const inexistente = await request(levantarApi(PROPIA))
      .post('/api/stock/bulk')
      .send({ punto_de_venta_id: SUCURSAL_PROPIA, items: [{ product_id: 999999, quantity: 1 }] });

    expect(ajeno.status).toBe(404);
    expect(ajeno.status).not.toBe(403);
    expect(inexistente.status).toBe(404);

    // Los dos mensajes NO son idénticos, y eso es correcto: cada uno nombra el
    // id que mandó el cliente, que es un dato suyo. Lo que no puede diferir es
    // la FORMA — si el del producto ajeno dijera algo distinto («pertenece a
    // otra empresa», «sin permiso»), el mensaje mismo confirmaría que ese
    // producto existe, que es justo lo que el 404 viene a esconder.
    const sinIds = (texto) => texto.replace(/\d+/g, 'N');
    expect(sinIds(inexistente.body.error)).toBe(sinIds(ajeno.body.error));
  });

  it('sigue cargando la masiva cuando TODOS los productos son de la empresa', async () => {
    // Sin este caso, una validación que rechaza siempre pasaría los tres de
    // arriba y dejaría la importación de inventario sin funcionar.
    const res = await request(levantarApi(PROPIA))
      .post('/api/stock/bulk')
      .send({
        punto_de_venta_id: SUCURSAL_PROPIA,
        items: [
          { product_id: 501, quantity: 10 },
          { product_id: 502, quantity: 20 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(mockStockModelo.filas).toHaveLength(2);
  });

  it('un id repetido no exige que el producto exista dos veces', async () => {
    // La validación consulta ids ÚNICOS y compara cantidades. Sin el `Set`, dos
    // líneas del mismo producto darían «faltan 1 de 2» y la masiva legítima
    // fallaría — el modo de falla más probable de esta corrección.
    const res = await request(levantarApi(PROPIA))
      .post('/api/stock/bulk')
      .send({
        punto_de_venta_id: SUCURSAL_PROPIA,
        items: [
          { product_id: 501, quantity: 10 },
          { product_id: 501, quantity: 25 },
        ],
      });

    expect(res.status).toBe(200);
  });
});
