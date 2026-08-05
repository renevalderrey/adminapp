// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════
//  La idempotencia de POST /api/sales, con los requests EN PARALELO
//
//  ── Por qué en paralelo y no dos veces seguidas ──
//
//  El endpoint tiene DOS mecanismos, y no son el mismo:
//
//   1. Un `findScoped` antes del insert. Es el camino normal: el operador
//      reintenta el ticket, la venta ya está, se devuelve.
//   2. El `catch (err)` de `SequelizeUniqueConstraintError`, que relee la venta
//      cuando el insert choca contra la clave primaria.
//
//  El segundo es «la otra mitad de la idempotencia, y la que de verdad sostiene
//  la garantía» —lo dice el comentario del propio archivo—, porque el
//  `findScoped` **no es atómico**: dos requests en vuelo al mismo tiempo pasan
//  los dos por el `findOne` y el que pierde choca contra la base.
//
//  Un test secuencial NUNCA ejercita esa rama: cuando el segundo request
//  arranca, el primero ya commiteó y el `findScoped` lo encuentra. Probaría el
//  camino fácil y dejaría sin cubrir el que evita cobrar dos veces.
//
//  Y esto no se puede escribir con los dobles de `modelosFalsos.js`: no
//  entienden transacciones ni restricciones únicas, así que no hay dos requests
//  que puedan chocar. Un test escrito sobre ellos probaría el doble.
//
//  ── Cómo se comprueba que la rama de la restricción CORRIÓ ──
//
//  Las dos ramas responden lo mismo —200 con `yaRegistrada: true`—, así que
//  desde afuera no se distinguen. Lo único que las separa es el
//  `logger.info({ empresaId, saleId }, …)` que la segunda deja a propósito.
//  Por eso el test lo espía: sin esa comprobación, el día que la rama se rompa
//  el test seguiría en verde porque el `findScoped` taparía el hueco cuando la
//  carrera se resuelve rápido.
// ════════════════════════════════════════════

const { Sale, SaleItem, Stock, StockMovement } = modelos;

/** Cuántos requests idénticos se disparan a la vez. */
//
// Con dos, la carrera se gana o se pierde según cómo el planificador reparta
// dos promesas y la rama de la restricción puede no correr nunca. Con seis, los
// seis pasan por el `findScoped` mucho antes de que el ganador commitee —le
// faltan la sucursal, el insert, las líneas, el lock del stock y el
// movimiento—, así que cinco chocan contra la clave primaria.
const EN_PARALELO = 6;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await cerrar();
});

/** El mismo ticket, siempre igual: tres kilos de harina. */
function ticket(id = 'VENTA-PARALELA-0001') {
  return {
    id,
    total: 3703.68,
    items: [
      {
        product_id: datos.harina.id,
        product_name: 'Harina 000',
        quantity: 3,
        unit_price: 1234.56,
      },
    ],
  };
}

describe('Dos cajas mandando el mismo ticket al mismo tiempo', () => {
  it('registra UNA sola venta aunque lleguen seis requests en paralelo', async () => {
    const cuerpo = ticket();

    const respuestas = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => request(app).post('/api/sales').send(cuerpo))
    );

    // Ninguna 500. Es la mitad del bug original: el operador leía «Error al
    // registrar la venta», daba por no registrada una venta que sí estaba, y
    // volvía a cobrar.
    for (const res of respuestas) {
      expect([200, 201]).toContain(res.status);
    }

    const creadas = respuestas.filter((r) => r.status === 201);
    const repetidas = respuestas.filter((r) => r.body.yaRegistrada === true);

    expect(creadas).toHaveLength(1);
    expect(repetidas).toHaveLength(EN_PARALELO - 1);
  });

  it('descuenta el stock UNA vez, no seis', async () => {
    await Promise.all(
      Array.from({ length: EN_PARALELO }, () => request(app).post('/api/sales').send(ticket()))
    );

    const stock = await Stock.findOne({
      where: {
        empresa_id: datos.empresaA.id,
        product_id: datos.harina.id,
        punto_de_venta_id: datos.centroA.id,
      },
    });

    // 20 − 3. Con seis descuentos daría 2, y con el descuento fuera de la
    // transacción podría dar cualquier cosa entre 2 y 17.
    expect(stock.available).toBe(17);
    expect(stock.quantity).toBe(17);

    expect(await StockMovement.count({ where: { referencia_id: 'VENTA-PARALELA-0001' } })).toBe(1);
  });

  it('guarda UNA fila de venta y UNA línea, no seis de cada una', async () => {
    await Promise.all(
      Array.from({ length: EN_PARALELO }, () => request(app).post('/api/sales').send(ticket()))
    );

    expect(await Sale.count({ where: { id: 'VENTA-PARALELA-0001' } })).toBe(1);
    expect(await SaleItem.count({ where: { sale_id: 'VENTA-PARALELA-0001' } })).toBe(1);
  });

  it('la rama del SequelizeUniqueConstraintError es la que atiende a los que pierden', async () => {
    // Ver el encabezado: es lo único que distingue las dos mitades de la
    // idempotencia desde afuera.
    const espia = jest.spyOn(logger, 'info');

    await Promise.all(
      Array.from({ length: EN_PARALELO }, () => request(app).post('/api/sales').send(ticket()))
    );

    const porChoque = espia.mock.calls.filter(
      ([contexto]) => contexto && contexto.saleId === 'VENTA-PARALELA-0001'
    );

    expect(porChoque.length).toBeGreaterThan(0);
  });

  it('todos los que pierden reciben las LÍNEAS de la venta registrada', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => request(app).post('/api/sales').send(ticket()))
    );

    // Sin las líneas, «ya registrada» es una afirmación que el navegador no
    // puede verificar. Es el motivo escrito en `routes/sales.js`.
    for (const res of respuestas.filter((r) => r.body.yaRegistrada === true)) {
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(3);
      // DECIMAL: Postgres lo devuelve como string y así viaja en el JSON.
      expect(res.body.data.total).toBe('3703.68');
    }
  });
});

describe('El reintento de siempre: el mismo ticket, uno después del otro', () => {
  it('el segundo POST no vuelve a descontar el stock', async () => {
    const primero = await request(app).post('/api/sales').send(ticket());
    expect(primero.status).toBe(201);

    const segundo = await request(app).post('/api/sales').send(ticket());

    expect(segundo.status).toBe(200);
    expect(segundo.body.yaRegistrada).toBe(true);

    const stock = await Stock.findOne({
      where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id },
    });
    expect(stock.available).toBe(17);
  });

  it('un reintento con el ticket MODIFICADO devuelve las líneas VIEJAS, para que el POS lo note', async () => {
    await request(app).post('/api/sales').send(ticket());

    const modificado = { ...ticket(), total: 4938.24 };
    modificado.items = [{ ...modificado.items[0], quantity: 4 }];

    const res = await request(app).post('/api/sales').send(modificado);

    expect(res.status).toBe(200);
    expect(res.body.yaRegistrada).toBe(true);
    // Lo entregado fueron 4 unidades y lo registrado 3: la respuesta tiene que
    // permitir darse cuenta.
    expect(res.body.data.items[0].quantity).toBe(3);
    expect(res.body.data.total).toBe('3703.68');
  });
});
