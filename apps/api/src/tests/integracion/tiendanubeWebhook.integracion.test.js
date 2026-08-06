// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const crypto = require('crypto');
const { sembrarDosEmpresas } = require('./fixtures');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════
//  El webhook de TiendaNube contra Postgres: cuerpo crudo, atomicidad y carrera
//
//  ── Por qué este archivo existe ──
//
//  Hasta este hito **todo webhook respondía 401**: `server.js` montaba
//  `express.json()` para toda la aplicación antes del router público, body-parser
//  veía el cuerpo ya parseado y no ejecutaba el `verify` que guarda `req.rawBody`,
//  y `firmaValida` cortaba ahí. Ningún pedido de la tienda online descontó stock
//  jamás. El primer caso de este archivo es la prueba de que eso se arregló, y es
//  verificable contra hoy: devolvía 401.
//
//  ── Y por qué NO alcanza con los dobles ──
//
//  `helpers/modelosFalsos.js` lo dice en su encabezado: no entiende transacciones,
//  ni `lock`, ni restricciones únicas. Las tres garantías que este corte promete
//  son exactamente eso:
//
//   · **La idempotencia** la sostiene `uq_tn_pedido (empresa_id,
//     tiendanube_order_id)`. El INSERT va primero y no hay ningún `findOne`
//     previo: la mitad que de verdad decide es el `SequelizeUniqueConstraintError`,
//     y **un test secuencial no la toca nunca** — cuando el segundo request
//     arranca, el primero ya commiteó.
//   · **La atomicidad**: si el tercer ítem falla se revierte todo, incluida la
//     fila del pedido. Un `rollback` sobre un array en memoria no deshace un
//     `push`, así que con dobles esa afirmación sería sobre el doble.
//   · **La sucursal designada**: la fixture designa `norte` mientras
//     `sucursalPorDefecto` elegiría `centro`. Con las dos siendo la misma, «se
//     descontó de la designada» y «se cayó al escalón por defecto» dan el mismo
//     número.
//
//  ── Lo que este archivo NO contesta, dicho sin adornos ──
//
//  Que TiendaNube firme con la cabecera `x-linkedstore-hmac-sha256`, con este
//  algoritmo y con este cuerpo. **No hay entorno de pruebas del tercero**
//  (supuesto 11): acá AdminApp verifica lo que AdminApp firmó, que es el
//  circuito, no el contrato del otro lado. Eso es el paso manual P2, y ningún
//  test de este hito lo cubre.
// ════════════════════════════════════════════

const {
  Product,
  Stock,
  StockMovement,
  TiendanubeMapping,
  TiendanubePedido,
} = modelos;

/** El secreto con el que se firma en estas pruebas. */
const SECRETO = 'secreto-de-integracion-de-tiendanube';

/**
 * ⚠ Las dos variables se ponen ACÁ y no se heredan del entorno.
 *
 * En la máquina de quien desarrolla, `dotenv` levanta `apps/api/.env` y las dos
 * están; **en CI no hay `.env`** y el job de integración solo define
 * `NODE_ENV` y `DATABASE_URL_TEST` (`.github/workflows/ci.yml:74-77`). Un test
 * que dependa de eso pasa en la máquina y falla en CI, que es la peor forma de
 * fallar: `GET /status` responde `sin_configurar` sin mirar ninguna fila, y el
 * webhook rechaza todo por falta de secreto.
 */
const CLIENT_ID = '4321';

/** Cuántas entregas idénticas se disparan a la vez. */
//
// Con dos, la carrera se gana o se pierde según cómo el planificador reparta dos
// promesas y la rama del choque puede no correr nunca. Con seis, los seis abren
// su transacción y resuelven la sucursal antes de que el ganador commitee, así
// que cinco chocan contra el índice único.
const EN_PARALELO = 6;

const SECRETO_ANTERIOR = process.env.TIENDANUBE_CLIENT_SECRET;
const CLIENT_ID_ANTERIOR = process.env.TIENDANUBE_CLIENT_ID;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  process.env.TIENDANUBE_CLIENT_SECRET = SECRETO;
  process.env.TIENDANUBE_CLIENT_ID = CLIENT_ID;
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (SECRETO_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_SECRET;
  else process.env.TIENDANUBE_CLIENT_SECRET = SECRETO_ANTERIOR;

  if (CLIENT_ID_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_ID;
  else process.env.TIENDANUBE_CLIENT_ID = CLIENT_ID_ANTERIOR;

  await cerrar();
});

/**
 * Postea un `order/paid` firmado, por la aplicación real.
 *
 * Entra por `app`, o sea con el montaje de verdad de `server.js`: es el único
 * lugar donde se puede comprobar que `req.rawBody` llega.
 */
function webhook(cuerpo, { evento = 'order/paid', firmar = true } = {}) {
  const texto = JSON.stringify(cuerpo);

  const peticion = request(app)
    .post('/api/tiendanube/webhook')
    .set('Content-Type', 'application/json')
    .set('x-event', evento);

  if (firmar) {
    peticion.set(
      'x-linkedstore-hmac-sha256',
      crypto.createHmac('sha256', SECRETO).update(texto).digest('hex')
    );
  }

  return peticion.send(texto);
}

/** Un pedido de la tienda de la empresa A. */
function pedidoDeA(items, cambios = {}) {
  return {
    id: 3344556,
    number: '1043',
    store_id: Number(datos.tiendaA.tiendanube_user_id),
    products: items,
    ...cambios,
  };
}

/** La fila de stock de un producto en una sucursal. */
const stockDe = (producto, puntoDeVenta) => Stock.findOne({
  where: {
    empresa_id: datos.empresaA.id,
    product_id: producto.id,
    punto_de_venta_id: puntoDeVenta.id,
  },
});

describe('Un order/paid firmado entra por la app real y descuenta', () => {
  it('el webhook responde 200 y baja el stock: req.rawBody llegó', async () => {
    const res = await webhook(pedidoDeA([
      { variant_id: Number(datos.mapeoHarina.tiendanube_variant_id), quantity: 2 },
    ]));

    // Verificable contra hoy: con el montaje viejo esto era 401, sin excepción y
    // para todos los pedidos.
    expect(res.status).toBe(200);

    const norte = await stockDe(datos.harina, datos.norteA);

    expect(norte.quantity).toBe(5);
    expect(norte.available).toBe(3);

    const movimientos = await StockMovement.findAll({
      where: { empresa_id: datos.empresaA.id, referencia_id: 'tn_order_3344556' },
    });

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].tipo).toBe('tiendanube_sale');
    expect(movimientos[0].punto_de_venta_id).toBe(datos.norteA.id);
  });

  it('el descuento baja quantity Y available, y sale de la sucursal DESIGNADA', async () => {
    // ⚠ La fixture designa `norte` y `sucursalPorDefecto` elegiría `centro`. Sin
    // esa diferencia este caso pasa con y sin el arreglo, que es exactamente el
    // defecto que la sucursal designada viene a cerrar: el webhook pasaba `null`
    // y `resolverSucursal` caía al escalón por defecto mientras la sincronización
    // publicaba el stock de otra.
    expect(datos.tiendaA.punto_de_venta_id).toBe(datos.norteA.id);

    await webhook(pedidoDeA([
      { variant_id: Number(datos.mapeoHarina.tiendanube_variant_id), quantity: 2 },
    ]));

    const norte = await stockDe(datos.harina, datos.norteA);
    const centro = await stockDe(datos.harina, datos.centroA);

    // 7 y 5 arrancan distintos a propósito: los ocho caminos que escriben stock
    // los mueven juntos, así que con los dos iguales bajar uno u otro daría el
    // mismo número.
    expect(norte.quantity).toBe(5);
    expect(norte.available).toBe(3);
    // Y la sucursal por defecto no perdió ni una unidad.
    expect(centro.quantity).toBe(20);
    expect(centro.available).toBe(20);

    // El pedido guarda la designada del momento: si mañana cambia, esta fila
    // tiene que seguir diciendo de dónde salió la mercadería.
    const pedido = await TiendanubePedido.findOne({ where: { empresa_id: datos.empresaA.id } });
    expect(pedido.punto_de_venta_id).toBe(datos.norteA.id);
  });

  it('un webhook sin firmar sigue siendo el único camino que no responde 200', async () => {
    // El ancla de todo el archivo: si la firma se aceptara siempre, los casos de
    // arriba pasarían con la verificación borrada.
    const res = await webhook(pedidoDeA([]), { firmar: false });

    expect(res.status).toBe(401);
    expect(await TiendanubePedido.count()).toBe(0);
  });
});

describe('El mismo pedido dos veces: una sola vez descuenta', () => {
  const unItem = () => pedidoDeA([
    { variant_id: Number(datos.mapeoHarina.tiendanube_variant_id), quantity: 2 },
  ]);

  it('el mismo pedido entregado SEIS VECES EN PARALELO descuenta UNA vez', async () => {
    // **Ésta es la mitad que un test secuencial no toca.** Sin la restricción
    // única —o con un `findOne` previo en su lugar— los seis pasan la
    // comprobación antes de que ninguno haya escrito, y el stock baja seis veces.
    const espia = jest.spyOn(logger, 'info');

    const respuestas = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => webhook(unItem()))
    );

    // Ninguna distinta de 200: TiendaNube deshabilita el webhook ante errores
    // repetidos, y un pedido repetido no es un error.
    for (const res of respuestas) expect(res.status).toBe(200);

    const norte = await stockDe(datos.harina, datos.norteA);

    expect(norte.quantity).toBe(5);
    expect(norte.available).toBe(3);

    expect(await TiendanubePedido.count({ where: { empresa_id: datos.empresaA.id } })).toBe(1);
    expect(await StockMovement.count({ where: { referencia_id: 'tn_order_3344556' } })).toBe(1);

    // Y **por qué** descontó una sola vez: la rama del choque corrió. Sin esta
    // aserción el caso pasaría también si las seis entregas se hubieran
    // serializado por casualidad, que es como una carrera se «prueba» sin
    // haberla corrido.
    const porChoque = espia.mock.calls.filter(
      ([contexto]) => contexto && String(contexto.tiendanubeOrderId) === '3344556'
    );

    expect(porChoque.length).toBeGreaterThan(0);
  });

  it('el mismo pedido dos veces SEGUIDAS tampoco descuenta dos veces', async () => {
    // El reintento normal de TiendaNube. Éste sí lo pasaría un `findOne` previo:
    // por eso los dos casos existen y no uno.
    const primero = await webhook(unItem());
    const segundo = await webhook(unItem());

    expect(primero.status).toBe(200);
    expect(segundo.status).toBe(200);

    const norte = await stockDe(datos.harina, datos.norteA);

    expect(norte.quantity).toBe(5);
    expect(norte.available).toBe(3);
    expect(await TiendanubePedido.count()).toBe(1);
  });
});

describe('Un pedido que falla a la mitad no queda marcado como procesado', () => {
  /** Cinco productos con stock en la sucursal designada, mapeados uno a uno. */
  async function cincoProductosMapeados() {
    const variantes = [];

    for (let i = 1; i <= 5; i++) {
      const producto = await Product.create({
        empresa_id: datos.empresaA.id,
        name: `Producto de cinco ${i}`,
        sku: `CINCO-${i}`,
        cost: 100 + i,
        unit_type: 'unidad',
      });

      await Stock.create({
        empresa_id: datos.empresaA.id,
        product_id: producto.id,
        punto_de_venta_id: datos.norteA.id,
        location: 'norte',
        quantity: 10 + i,
        available: 10 + i,
      });

      const mapeo = await TiendanubeMapping.create({
        empresa_id: datos.empresaA.id,
        product_id: producto.id,
        tiendanube_variant_id: 5100000 + i,
        tiendanube_product_id: 710000 + i,
      });

      variantes.push({ producto, variante: Number(mapeo.tiendanube_variant_id) });
    }

    return variantes;
  }

  it('el tercero de cinco falla y NO queda ninguna fila de tiendanube_pedidos', async () => {
    const cinco = await cincoProductosMapeados();

    // El fallo se provoca en la escritura del movimiento del tercer ítem: es el
    // punto más adentro de la transacción y el que deja los dos primeros ya
    // descontados. Hasta este hito quedaban descontados **para siempre** y el
    // reintento contestaba «pedido ya procesado», así que los tres que faltaban
    // no se descontaban nunca.
    const original = StockMovement.create.bind(StockMovement);
    let escritos = 0;

    jest.spyOn(StockMovement, 'create').mockImplementation(async (valores, opciones) => {
      escritos += 1;
      if (escritos === 3) throw new Error('falla simulada escribiendo el tercer movimiento');
      return original(valores, opciones);
    });

    const res = await webhook(pedidoDeA(
      cinco.map(({ variante }) => ({ variant_id: variante, quantity: 1 }))
    ));

    // 200 igual: el error se registra, no se le devuelve a TiendaNube.
    expect(res.status).toBe(200);

    // Lo que importa: el pedido NO quedó marcado, así que el reintento vuelve a
    // entrar por el camino normal.
    expect(await TiendanubePedido.count()).toBe(0);

    // Y el stock de los dos primeros quedó como estaba.
    for (const { producto } of cinco.slice(0, 2)) {
      const fila = await stockDe(producto, datos.norteA);
      expect(fila.quantity).toBe(fila.available);
      expect(fila.quantity).toBeGreaterThan(10);
    }

    expect(await StockMovement.count({ where: { referencia_id: 'tn_order_3344556' } })).toBe(0);
  });

  it('y el reintento posterior descuenta los cinco', async () => {
    // La otra mitad: sin esto, «no queda marcado» podría cumplirse dejando el
    // pedido sin poder procesarse nunca más.
    const cinco = await cincoProductosMapeados();
    const cuerpo = pedidoDeA(cinco.map(({ variante }) => ({ variant_id: variante, quantity: 1 })));

    const original = StockMovement.create.bind(StockMovement);
    let escritos = 0;
    const espia = jest.spyOn(StockMovement, 'create').mockImplementation(async (valores, opciones) => {
      escritos += 1;
      if (escritos === 3) throw new Error('falla simulada escribiendo el tercer movimiento');
      return original(valores, opciones);
    });

    await webhook(cuerpo);

    espia.mockImplementation(original);

    const res = await webhook(cuerpo);

    expect(res.status).toBe(200);
    expect(await TiendanubePedido.count()).toBe(1);
    expect(await StockMovement.count({ where: { referencia_id: 'tn_order_3344556' } })).toBe(5);

    const pedido = await TiendanubePedido.findOne({ where: { empresa_id: datos.empresaA.id } });
    expect(pedido.items_descontados).toBe(5);
    expect(pedido.items_sin_descontar).toBe(0);
  });
});

describe('Lo que no descontó queda escrito con su motivo', () => {
  it('un ítem sin mapeo y dos mapeados sin fila de stock en la designada', async () => {
    // Los tres se salteaban con un `continue` y lo único que quedaba era que el
    // inventario estaba mal — el faltante aparecía en un recuento físico meses
    // después.
    //
    // `sal` no tiene ninguna fila de stock y `levadura` tiene stock **solo en
    // centro**, que no es la designada: los dos casos existen en la fixture a
    // propósito, porque «no hay fila» y «hay fila en otra sucursal» son dos
    // caminos distintos hacia el mismo motivo.
    const res = await webhook(pedidoDeA([
      { variant_id: Number(datos.mapeoHarina.tiendanube_variant_id), quantity: 1 },
      { variant_id: 9999999, quantity: 2 },
      { variant_id: Number(datos.mapeoSal.tiendanube_variant_id), quantity: 3 },
      { variant_id: Number(datos.mapeoLevadura.tiendanube_variant_id), quantity: 4 },
    ]));

    expect(res.status).toBe(200);

    const pedido = await TiendanubePedido.findOne({ where: { empresa_id: datos.empresaA.id } });

    expect(pedido.items_descontados).toBe(1);
    expect(pedido.items_sin_descontar).toBe(3);
    expect(pedido.items.map((i) => i.motivo)).toEqual([
      null, 'sin_mapeo', 'sin_stock_en_sucursal', 'sin_stock_en_sucursal',
    ]);

    // La variante viaja en el JSONB: sin ella, «un ítem no descontó» no dice
    // cuál, y la pantalla no puede llevar a ningún lado.
    expect(String(pedido.items[1].variante)).toBe('9999999');
    expect(pedido.items[1].cantidad).toBe(2);

    // El stock de levadura en centro sigue intacto: no se descontó de otra
    // sucursal para «salvar» el ítem.
    const centro = await stockDe(datos.levadura, datos.centroA);
    expect(centro.quantity).toBe(50);
  });

  it('GET /status cuenta ese pedido en pedidos_con_items_sin_descontar', async () => {
    // Es el número que hace visible el escenario 7 de US2 desde la pantalla, y
    // sale de un `count` con `Op.gt` sobre el índice parcial: los dobles de
    // `modelosFalsos.js` no entienden ese operador, así que **este es el único
    // nivel donde se puede afirmar**.
    await webhook(pedidoDeA([
      { variant_id: 9999999, quantity: 1 },
    ]));

    const res = await request(app).get('/api/tiendanube/status');

    expect(res.status).toBe(200);
    expect(res.body.pedidos_con_items_sin_descontar).toBe(1);
  });

  it('un pedido que descontó todo NO cuenta como pedido con problemas', async () => {
    // El ancla del caso de arriba: sin esto, un `count` sin el `Op.gt` —o con la
    // comparación al revés— daría 1 igual.
    await webhook(pedidoDeA([
      { variant_id: Number(datos.mapeoHarina.tiendanube_variant_id), quantity: 1 },
    ]));

    const res = await request(app).get('/api/tiendanube/status');

    expect(res.body.pedidos_con_items_sin_descontar).toBe(0);
  });
});

describe('Al arrancar, un despliegue sin secreto se avisa con todas las letras', () => {
  // Riesgo 10: `firmaValida` devuelve `false` cuando falta el secreto, así que
  // sin este aviso la única pista de que falta una variable de entorno es una
  // tienda que dejó de descontar stock y nadie sabe desde cuándo. Corre dentro de
  // `start()`, que ningún test llama, y por eso la función se exporta.
  const { avisarSiFaltaElSecretoDeTiendanube } = require('../../server');

  it('con tiendas vinculadas y sin secreto deja un error que las cuenta', async () => {
    delete process.env.TIENDANUBE_CLIENT_SECRET;
    const errores = jest.spyOn(logger, 'error');

    await avisarSiFaltaElSecretoDeTiendanube();

    expect(errores).toHaveBeenCalled();
    // Las dos tiendas de la fixture: el número es lo que distingue «no está
    // configurado y no importa» de «hay clientes con la integración muerta».
    expect(errores.mock.calls[0][0].tiendasVinculadas).toBe(2);
    expect(errores.mock.calls[0][1]).toContain('TIENDANUBE_CLIENT_SECRET');
  });

  it('con el secreto puesto no dice nada', async () => {
    // El ancla: un aviso que sale siempre es un aviso que se ignora siempre.
    const errores = jest.spyOn(logger, 'error');

    await avisarSiFaltaElSecretoDeTiendanube();

    expect(errores).not.toHaveBeenCalled();
  });

  it('sin ninguna tienda vinculada tampoco dice nada, aunque falte el secreto', async () => {
    // Una empresa que no usa TiendaNube no tiene por qué ver un error en cada
    // arranque, y por eso esto **no corta el arranque**: es una integración
    // opcional.
    delete process.env.TIENDANUBE_CLIENT_SECRET;
    await modelos.TiendanubeTienda.destroy({ where: {} });
    const errores = jest.spyOn(logger, 'error');

    await avisarSiFaltaElSecretoDeTiendanube();

    expect(errores).not.toHaveBeenCalled();
  });
});

describe('El pedido de una tienda es de UNA empresa, resuelta por el índice único', () => {
  it('el pedido de la tienda de B no toca el stock de A', async () => {
    // `tiendanube_user_id` tiene un UNIQUE, así que la respuesta es una empresa o
    // ninguna. Hasta hoy la empresa salía de `settings` —PK `(key, empresa_id)`,
    // sin unicidad del id de tienda— quedándose con el primer match que
    // devolviera Postgres, en un orden que nadie definió.
    const res = await webhook({
      id: 7788990,
      number: '55',
      store_id: Number(datos.tiendaB.tiendanube_user_id),
      products: [{ variant_id: Number(datos.mapeoB.tiendanube_variant_id), quantity: 3 }],
    });

    expect(res.status).toBe(200);

    const pedido = await TiendanubePedido.findOne({ where: { tiendanube_order_id: 7788990 } });

    expect(pedido.empresa_id).toBe(datos.empresaB.id);
    expect(await TiendanubePedido.count({ where: { empresa_id: datos.empresaA.id } })).toBe(0);

    // El stock de A quedó como estaba, incluso el de la variante con el mismo
    // producto de por medio.
    const norte = await stockDe(datos.harina, datos.norteA);
    expect(norte.quantity).toBe(7);
    expect(norte.available).toBe(5);
  });

  it('un pedido de una tienda que no está vinculada responde 200 y no escribe nada', async () => {
    const res = await webhook({ id: 111222, store_id: 123456789, products: [] });

    expect(res.status).toBe(200);
    expect(await TiendanubePedido.count()).toBe(0);
  });
});
