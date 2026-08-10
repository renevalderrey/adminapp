// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');
const { capturarConsultas } = require('./espiaDeConsultas');

// ════════════════════════════════════════════
//  La bandeja de pedidos
//
//  ── El caso que sostiene el corte ──
//
//  *«Marcar cobrado dejó `stock`, `stock_movements`, `sales`, `sale_items` y la
//  caja COMO ESTABAN.»* Afirma **lo que no pasó**, que es la mitad que se
//  olvida: un `PATCH` que además descontara stock pasaría cualquier test que
//  sólo mire el estado del pedido, y el comercio se enteraría cuando el
//  inventario no cierre.
//
//  La regla es «si toca stock, genera venta; si no genera venta, no toca stock»,
//  y las dos mitades entran juntas en la etapa siguiente. Hasta entonces, marcar
//  cobrado **es cambiar un estado**.
// ════════════════════════════════════════════

const {
  Pedido, PedidoItem, Catalogo, Stock, StockMovement, Sale, SaleItem, CashFlowEntry,
} = modelos;

/** Un pedido listo para insertar, con lo mínimo que exige la tabla. */
const pedidoDe = (campos) => ({
  comprador_nombre: 'Martina Olivera',
  comprador_telefono: '5493425123456',
  entrega: 'retiro_local',
  subtotal: 1000,
  total: 1000,
  medio_pago: 'efectivo',
  ...campos,
});

/** Las cinco tablas que marcar cobrado NO puede tocar. */
async function fotoDeLasCincoTablas() {
  const stock = await Stock.findAll({ order: [['id', 'ASC']], raw: true });

  return {
    stock: stock.map((s) => `${s.product_id}:${s.punto_de_venta_id}:${s.quantity}:${s.available}`),
    movimientos: await StockMovement.count(),
    ventas: await Sale.count(),
    lineasDeVenta: await SaleItem.count(),
    caja: await CashFlowEntry.count(),
  };
}

async function sembrarBandeja() {
  const base = await sembrarDosEmpresas();

  const catalogo = await Catalogo.create({
    empresa_id: base.empresaA.id,
    punto_de_venta_id: base.centroA.id,
    slug: 'bandeja-de-a',
    nombre_visible: 'Tienda de A',
    estado: 'publicado',
    publicado_en: new Date(),
  });

  // El segundo catálogo de A: sin él, «el filtro por catálogo filtra algo» no se
  // distingue de «devolvió todo».
  const otro = await Catalogo.create({
    empresa_id: base.empresaA.id,
    punto_de_venta_id: base.centroA.id,
    slug: 'otra-bandeja-de-a',
    nombre_visible: 'Otra tienda de A',
  });

  const catalogoDeB = await Catalogo.create({
    empresa_id: base.empresaB.id,
    punto_de_venta_id: base.localB.id,
    slug: 'bandeja-de-b',
    nombre_visible: 'Tienda de B',
  });

  const comun = { empresa_id: base.empresaA.id, punto_de_venta_id: base.centroA.id };

  const pendiente = await Pedido.create(pedidoDe({
    ...comun, catalogo_id: catalogo.id, numero: 1, estado: 'pendiente_pago',
    idempotency_key: 'bandeja-1',
  }));

  const pagado = await Pedido.create(pedidoDe({
    ...comun, catalogo_id: catalogo.id, numero: 2, estado: 'pagado',
    idempotency_key: 'bandeja-2', total: 2500,
  }));

  const delOtro = await Pedido.create(pedidoDe({
    ...comun, catalogo_id: otro.id, numero: 3, estado: 'pendiente_pago',
    idempotency_key: 'bandeja-3',
  }));

  const cancelado = await Pedido.create(pedidoDe({
    ...comun, catalogo_id: catalogo.id, numero: 4, estado: 'cancelado',
    idempotency_key: 'bandeja-4',
  }));

  // El de la empresa B, para que «404 desde A» no se confunda con «no existe».
  const deB = await Pedido.create(pedidoDe({
    empresa_id: base.empresaB.id,
    punto_de_venta_id: base.localB.id,
    catalogo_id: catalogoDeB.id,
    numero: 1,
    estado: 'pendiente_pago',
    idempotency_key: 'bandeja-de-b',
  }));

  // Una línea con el precio **congelado** distinto del que daría el catálogo hoy:
  // es lo que hace detectable que el detalle recalcule.
  await PedidoItem.create({
    pedido_id: pendiente.id,
    product_id: base.harina.id,
    nombre: 'Harina 000 (como se llamaba entonces)',
    precio_unitario: 850,
    precio_lista: 1200,
    cantidad: 1,
    subtotal: 850,
  });

  return { ...base, catalogo, otro, catalogoDeB, pendiente, pagado, delOtro, cancelado, deB };
}

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
});

describe('la bandeja', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarBandeja();
  });

  it('lista los de la empresa y ninguno de la otra', async () => {
    const res = await request(app).get('/api/pedidos');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);

    const numeros = res.body.data.pedidos.map((p) => p.numero).sort();
    expect(numeros).toEqual([1, 2, 3, 4]);
    // El de B también es el número 1: si se hubiera colado, habría dos.
    expect(res.body.data.pedidos.filter((p) => p.numero === 1)).toHaveLength(1);
  });

  it('`por_estado` viene siempre, con los seis estados y con filtro puesto', () => {
    return request(app)
      .get('/api/pedidos?estado=pagado')
      .then((res) => {
        expect(res.body.data.total).toBe(1);
        // Los otros números siguen ahí: si sólo vinieran sin filtrar, al elegir
        // «pagados» las demás píldoras se quedarían en blanco.
        expect(res.body.data.por_estado.pendiente_pago).toBe(2);
        expect(res.body.data.por_estado.cancelado).toBe(1);
        // Con cero, no ausente: una píldora sin número se lee como «no se pudo
        // contar», no como «no hay».
        expect(res.body.data.por_estado.entregado).toBe(0);
        expect(Object.keys(res.body.data.por_estado)).toHaveLength(6);
      });
  });

  it('`por_estado` sale de una sola consulta, no de seis COUNT', async () => {
    const { consultas } = await capturarConsultas(modelos.sequelize, () =>
      request(app).get('/api/pedidos'));

    const conteos = consultas.filter((q) => /COUNT/i.test(q));
    // Uno es el `findAndCountAll` de la página; el otro es el `GROUP BY`. Con
    // un `COUNT` por estado, abrir la bandeja son seis viajes más a la base.
    expect(conteos).toHaveLength(2);
    expect(consultas.some((q) => /GROUP BY/i.test(q))).toBe(true);
  });

  it('el filtro por catálogo filtra, y los números lo acompañan', async () => {
    const res = await request(app).get(`/api/pedidos?catalogo_id=${datos.otro.id}`);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.pedidos[0].numero).toBe(3);
    expect(res.body.data.por_estado.pendiente_pago).toBe(1);
  });

  it('la bandeja sin pedidos y la bandeja filtrada sin resultados se distinguen', async () => {
    // Son dos textos distintos, y el segundo tiene una salida —sacar el filtro—
    // que el primero no.
    const filtrada = await request(app).get('/api/pedidos?estado=entregado');

    expect(filtrada.body.data.total).toBe(0);
    expect(filtrada.body.data.hay_filtros).toBe(true);

    await Pedido.destroy({ where: {} });
    const vacia = await request(app).get('/api/pedidos');

    expect(vacia.body.data.total).toBe(0);
    expect(vacia.body.data.hay_filtros).toBe(false);
  });

  it('un origen o un estado inventado se ignoran en vez de romper', async () => {
    const res = await request(app).get('/api/pedidos?estado=despachado&origen=paloma');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.hay_filtros).toBe(false);
  });
});

describe('el detalle', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarBandeja();
  });

  it('trae las líneas congeladas, no lo que costaría hoy', async () => {
    const res = await request(app).get(`/api/pedidos/${datos.pendiente.id}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.data.lineas[0].precio_unitario)).toBe(850);
    expect(res.body.data.lineas[0].nombre).toBe('Harina 000 (como se llamaba entonces)');
    // Y las transiciones que la pantalla puede ofrecer las decide el servidor.
    expect(res.body.data.transiciones).toContain('pagado');
  });

  it('un pedido de otra empresa responde 404 y su estado no cambió', async () => {
    const res = await request(app).get(`/api/pedidos/${datos.deB.id}`);

    expect(res.status).toBe(404);

    await datos.deB.reload();
    expect(datos.deB.estado).toBe('pendiente_pago');
  });
});

describe('el cambio de estado', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarBandeja();
  });

  it('«Marcar cobrado» dejó `stock`, `stock_movements`, `sales`, `sale_items` y la caja COMO ESTABAN', async () => {
    const antes = await fotoDeLasCincoTablas();

    const res = await request(app)
      .patch(`/api/pedidos/${datos.pendiente.id}/estado`)
      .send({ estado: 'pagado' });

    expect(res.status).toBe(200);
    await datos.pendiente.reload();
    expect(datos.pendiente.estado).toBe('pagado');

    // Lo que NO pasó. Un `PATCH` que además descontara stock pasaría cualquier
    // test que sólo mire el estado, y el comercio se enteraría cuando el
    // inventario no cierre.
    expect(await fotoDeLasCincoTablas()).toEqual(antes);
    // Y `sale_id` sigue en NULL: la venta se registra a mano desde el punto de
    // venta hasta que exista la etapa que las crea.
    expect(datos.pendiente.sale_id).toBeNull();
  });

  it('marcar cobrado dos veces en paralelo da el mismo resultado que una', async () => {
    // Sin clave de idempotencia: `pagado → pagado` no está en la tabla de
    // transiciones, así que el segundo request no tiene desde dónde ser válido.
    const marcar = () => request(app)
      .patch(`/api/pedidos/${datos.pendiente.id}/estado`)
      .send({ estado: 'pagado' });

    const [uno, otro] = await Promise.all([marcar(), marcar()]);

    const estados = [uno.status, otro.status].sort();
    expect(estados).toEqual([200, 409]);

    await datos.pendiente.reload();
    expect(datos.pendiente.estado).toBe('pagado');
  });

  it('de cancelado no se sale, y la respuesta nombra el estado actual', async () => {
    const res = await request(app)
      .patch(`/api/pedidos/${datos.cancelado.id}/estado`)
      .send({ estado: 'pagado' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ESTADO_TERMINAL');
    // Sin el estado actual, la pantalla que perdió la carrera muestra «no se
    // puede» y no puede decir por qué ni refrescarse.
    expect(res.body.estado_actual).toBe('cancelado');
    expect(res.body.transiciones).toEqual([]);
  });

  it('el pedido de otra empresa no se puede mover: 404 y nada cambia', async () => {
    const res = await request(app)
      .patch(`/api/pedidos/${datos.deB.id}/estado`)
      .send({ estado: 'cancelado' });

    expect(res.status).toBe(404);

    await datos.deB.reload();
    expect(datos.deB.estado).toBe('pendiente_pago');
  });

  it('un estado que no existe no llega a escribir nada', async () => {
    const res = await request(app)
      .patch(`/api/pedidos/${datos.pendiente.id}/estado`)
      .send({ estado: 'despachado' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ESTADO_INVALIDO');

    await datos.pendiente.reload();
    expect(datos.pendiente.estado).toBe('pendiente_pago');
  });
});
