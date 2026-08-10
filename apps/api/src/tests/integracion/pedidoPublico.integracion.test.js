// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  `POST /api/publico/c/:slug/pedidos` · el único endpoint público que escribe
//
//  ── Por qué acá y no en la suite rápida ──
//
//  Tres de las preguntas de este archivo no se pueden hacer con `BYPASS_AUTH`:
//  «¿un product_id de otra empresa deja alguna fila?» necesita **dos empresas**;
//  «¿dos requests en paralelo crean un pedido o dos?» necesita **Postgres**, con
//  su índice único y su advisory lock; y «¿el pedido tocó el stock?» necesita
//  **las tablas de verdad**.
//
//  ── Lo que la fixture tiene que poder distinguir ──
//
//   · **Dos catálogos en la empresa A.** Sin el segundo, «el pedido cayó en el
//     catálogo equivocado» no es detectable: cualquier catalogo_id sería el
//     correcto.
//   · **Un producto con `quantity > 0` y `available = 0`.** Es lo que separa
//     «mira lo disponible» de «mira la cantidad»: con los dos números iguales,
//     las dos implementaciones dan el mismo resultado.
//   · **Un umbral de envío gratis igual, al peso, al subtotal de un pedido de
//     dos unidades.** Es el único caso que distingue `>=` de `>`.
//   · **Un costo de envío con centavos.** Si algo del camino trunca a entero, el
//     total lo delata.
// ════════════════════════════════════════════

const COMPRADOR = {
  nombre: 'Martina Olivera',
  telefono: '0342 15 5123456',
  entrega: 'retiro_local',
  medio_pago: 'efectivo',
};

/** El cuerpo de un pedido, con la clave de idempotencia que se le pida. */
const cuerpo = (items, clave, extra = {}) => ({
  idempotency_key: clave,
  items,
  comprador: Object.assign({}, COMPRADOR, extra),
});

async function sembrarParaPedidos(datos) {
  const {
    Catalogo, CatalogoProducto, CatalogoReglaPrecio, Product, Setting, Stock, Suscripcion,
  } = modelos;

  // Sin fila de suscripción el camino público contesta `no_disponible`, y todos
  // los casos de abajo estarían probando el apagado por mora.
  const enUnMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  for (const empresa of [datos.empresaA, datos.empresaB]) {
    await Suscripcion.destroy({ where: { empresa_id: empresa.id } });
    await Suscripcion.create({
      empresa_id: empresa.id,
      plan: 'free',
      status: 'trialing',
      trial_starts_at: new Date(),
      trial_ends_at: enUnMes,
      grace_period_ends: enUnMes,
    });
  }

  // Margen 50 sobre costo 1000 da un precio de lista de 1500. Con margen 0 daría
  // 1000, que es el costo: «devolvió el precio» y «devolvió el costo» tienen que
  // dar números distintos o el test no distingue nada.
  await Setting.upsert({ key: 'margin_efectivo', value: 50, empresa_id: datos.empresaA.id });
  await Setting.upsert({ key: 'margin_efectivo', value: 50, empresa_id: datos.empresaB.id });

  await Product.update(
    { publicable: true, cost: 1000 },
    { where: { id: [datos.harina.id, datos.levadura.id, datos.sal.id] } }
  );
  await Product.update({ publicable: true, cost: 2000 }, { where: { id: datos.golosinaB.id } });

  // ⚠ `quantity` en 10 y `available` en 0: hay mercadería contada, pero
  // comprometida. Publicar o vender contra `quantity` acá vende algo que no está.
  await Stock.create({
    empresa_id: datos.empresaA.id,
    product_id: datos.sal.id,
    punto_de_venta_id: datos.centroA.id,
    location: 'centro',
    quantity: 10,
    available: 0,
  });

  const deA = await Catalogo.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    slug: 'pedidos-de-a',
    nombre_visible: 'Tienda de A',
    estado: 'publicado',
    publicado_en: new Date(),
    retiro_local: true,
    retiro_socio: true,
    pide_nro_socio: true,
    envio: true,
    // Con centavos: si algo trunca a entero, el total lo dice.
    envio_costo: 2500.50,
    // Al peso, el subtotal de dos unidades a 1200. Es el borde de FR-143.
    envio_gratis_desde: 2400.00,
  });

  // El segundo catálogo de A. Existe para que «cayó en el catálogo equivocado»
  // sea una pregunta que se puede hacer.
  const otroDeA = await Catalogo.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    slug: 'otra-tienda-de-a',
    nombre_visible: 'Otra tienda de A',
    estado: 'publicado',
    publicado_en: new Date(),
    retiro_local: true,
  });

  const deB = await Catalogo.create({
    empresa_id: datos.empresaB.id,
    punto_de_venta_id: datos.localB.id,
    slug: 'pedidos-de-b',
    nombre_visible: 'Tienda de B',
    estado: 'publicado',
    publicado_en: new Date(),
    retiro_local: true,
  });

  const pausado = await Catalogo.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    slug: 'pausado-de-a',
    nombre_visible: 'Pausado',
    estado: 'pausado',
    publicado_en: new Date(),
    retiro_local: true,
  });

  await CatalogoProducto.bulkCreate([
    { catalogo_id: deA.id, product_id: datos.harina.id, orden: 0 },
    { catalogo_id: deA.id, product_id: datos.levadura.id, orden: 1 },
    { catalogo_id: deA.id, product_id: datos.sal.id, orden: 2 },
    { catalogo_id: otroDeA.id, product_id: datos.harina.id, orden: 0 },
    { catalogo_id: deB.id, product_id: datos.golosinaB.id, orden: 0 },
    { catalogo_id: pausado.id, product_id: datos.harina.id, orden: 0 },
  ]);

  // −20% sobre el catálogo entero: 1500 de lista pasan a 1200. Sin regla, el
  // precio congelado y el de lista serían el mismo número y «se congeló la
  // regla» no se podría afirmar.
  const regla = await CatalogoReglaPrecio.create({
    empresa_id: datos.empresaA.id,
    catalogo_id: deA.id,
    ambito: 'catalogo',
    tipo: 'porcentaje_descuento',
    valor: 20,
    activo: true,
  });

  return { deA, otroDeA, deB, pausado, regla };
}

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
});

describe('el alta pública de pedidos', () => {
  let datos;
  let catalogos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
    catalogos = await sembrarParaPedidos(datos);
  });

  it('un precio en el cuerpo se descarta y el pedido queda con el del servidor', async () => {
    // El cuerpo pide dos harinas a $1 y declara un total de $2. Lo que se guarda
    // sale de `calcularPrecios` + las reglas, contra la base.
    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(Object.assign(
        cuerpo([{ product_id: datos.harina.id, cantidad: 2, precio: 1, precio_unitario: 1, subtotal: 2 }], 'clave-1'),
        { total: 2, subtotal: 2 }
      ));

    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(2400);
    expect(res.body.data.lineas[0].precio_unitario).toBe(1200);

    const { PedidoItem } = modelos;
    const linea = await PedidoItem.findOne();

    expect(Number(linea.precio_unitario)).toBe(1200);
    // El precio de lista y la regla, congelados: son los que contestan «¿por qué
    // este pedido salió a este precio?» seis meses después.
    expect(Number(linea.precio_lista)).toBe(1500);
    expect(linea.regla_id).toBe(catalogos.regla.id);
    expect(linea.nombre).toBe(datos.harina.name);
  });

  it('la respuesta pública no lleva ningún id del pedido', async () => {
    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], 'clave-sin-id'));

    // Lo que el comprador tiene para referirse a su pedido es el número legible.
    // Un identificador opaco en una respuesta pública es una superficie para
    // adivinar.
    expect(res.body.data.numero).toBe(1);
    expect(res.body.data.id).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('empresa_id');
  });

  it('el número arranca en 1 y es correlativo por empresa', async () => {
    for (const clave of ['n-1', 'n-2', 'n-3']) {
      await request(app)
        .post('/api/publico/c/pedidos-de-a/pedidos')
        .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], clave));
    }

    const enB = await request(app)
      .post('/api/publico/c/pedidos-de-b/pedidos')
      .send(cuerpo([{ product_id: datos.golosinaB.id, cantidad: 1 }], 'n-b'));

    const { Pedido } = modelos;
    const deA = await Pedido.findAll({ where: { empresa_id: datos.empresaA.id }, order: [['numero', 'ASC']] });

    expect(deA.map((p) => p.numero)).toEqual([1, 2, 3]);
    // La empresa B arranca de su propio 1: la numeración es por empresa, no
    // global. Un correlativo global le contaría a cada comercio cuántos pedidos
    // hacen los demás.
    expect(enB.body.data.numero).toBe(1);
  });

  it('el pedido cae en el catálogo del slug, no en cualquiera de la empresa', async () => {
    await request(app)
      .post('/api/publico/c/otra-tienda-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], 'clave-otro'));

    const { Pedido } = modelos;
    const pedido = await Pedido.findOne();

    expect(pedido.catalogo_id).toBe(catalogos.otroDeA.id);
    expect(pedido.punto_de_venta_id).toBe(datos.centroA.id);
  });

  it('el mismo pedido mandado dos veces EN PARALELO crea uno solo', async () => {
    // Dos promesas, y no dos `await` seguidos: la mitad que un test secuencial
    // no toca nunca es justo la que importa — los dos pasan por el `findOne` de
    // idempotencia antes de que ninguno haya commiteado, y lo que los separa es
    // el índice único.
    const enviar = () => request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], 'la-misma-clave'));

    const [uno, otro] = await Promise.all([enviar(), enviar()]);

    expect(uno.status).toBe(201);
    expect(otro.status).toBe(201);
    expect(uno.body.data.numero).toBe(otro.body.data.numero);

    const { Pedido, PedidoItem } = modelos;
    expect(await Pedido.count()).toBe(1);
    expect(await PedidoItem.count()).toBe(1);
  });

  it('dos pedidos simultáneos de la misma empresa no comparten número', async () => {
    // Sin el `pg_advisory_xact_lock`, los dos leen el mismo `MAX(numero)` y
    // salen con el mismo número — o el segundo choca contra `uq_pedido_numero` y
    // el comprador ve un error después de apretar «Confirmar».
    const enviar = (clave) => request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], clave));

    const respuestas = await Promise.all([enviar('par-1'), enviar('par-2'), enviar('par-3')]);

    for (const r of respuestas) expect(r.status).toBe(201);

    const numeros = respuestas.map((r) => r.body.data.numero).sort((a, b) => a - b);
    expect(numeros).toEqual([1, 2, 3]);
  });

  it('un product_id de otra empresa no deja ninguna fila', async () => {
    const { Pedido, PedidoItem } = modelos;

    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([
        { product_id: datos.harina.id, cantidad: 1 },
        { product_id: datos.golosinaB.id, cantidad: 1 },
      ], 'clave-ajena'));

    expect(res.status).toBe(404);
    // La línea uno era válida. Si el handler hubiera creado el pedido antes de
    // validar la dos, acá habría un pedido a medias.
    expect(await Pedido.count()).toBe(0);
    expect(await PedidoItem.count()).toBe(0);
  });

  it('si todas las líneas se agotaron no se crea ningún pedido', async () => {
    const { Pedido, PedidoItem } = modelos;

    // `sal` tiene `quantity = 10` y `available = 0`. Mirar `quantity` acá vende
    // algo que no está.
    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.sal.id, cantidad: 1 }], 'clave-agotada'));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SIN_LINEAS_DISPONIBLES');
    expect(await Pedido.count()).toBe(0);
    expect(await PedidoItem.count()).toBe(0);
  });

  it('pedir más de lo que hay devuelve el cuerpo exacto para reintentar', async () => {
    const { Pedido } = modelos;

    // Hay 20 de harina en el centro.
    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 25 }], 'clave-recorte'));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STOCK_INSUFICIENTE');
    expect(res.body.lineas[0]).toMatchObject({ accion: 'recortada', pedida: 25, disponible: 20 });

    // `reintentar_con` es el cuerpo exacto que la tienda vuelve a mandar. Sin
    // él, la tienda tendría que reconstruirlo restando por su cuenta —el cliente
    // recalculando— y se equivocaría justo en el caso que importa.
    expect(res.body.reintentar_con.items).toEqual([{ product_id: datos.harina.id, cantidad: 20 }]);
    expect(await Pedido.count()).toBe(0);

    const segundo = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(res.body.reintentar_con);

    expect(segundo.status).toBe(201);
    expect(segundo.body.data.lineas[0].cantidad).toBe(20);
  });

  it('con el subtotal exactamente igual al umbral el envío es gratis', async () => {
    // Dos harinas a 1200 son 2400, que es el umbral al peso. Es el único caso
    // que distingue `>=` de `>`.
    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 2 }], 'clave-envio-justo', {
        entrega: 'envio',
        envio_direccion: 'Av. Rivadavia 4821',
        envio_localidad: 'CABA',
        envio_cp: '1424',
      }));

    expect(res.status).toBe(201);
    expect(res.body.data.envio_costo).toBe(0);
    expect(res.body.data.total).toBe(2400);
  });

  it('un peso menos que el umbral paga el envío, con sus centavos', async () => {
    const res = await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], 'clave-envio-paga', {
        entrega: 'envio',
        envio_direccion: 'Av. Rivadavia 4821',
        envio_localidad: 'CABA',
        envio_cp: '1424',
      }));

    expect(res.status).toBe(201);
    // Si algo del camino truncara a entero, acá saldría 2500 y 3700.
    expect(res.body.data.envio_costo).toBe(2500.5);
    expect(res.body.data.total).toBe(3700.5);
  });

  it('el pedido no tocó `stock` ni `stock_movements`', async () => {
    const { Stock, StockMovement } = modelos;

    const antes = await Stock.findOne({
      where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id },
    });

    await request(app)
      .post('/api/publico/c/pedidos-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 3 }], 'clave-sin-stock'));

    const despues = await Stock.findOne({
      where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id },
    });

    // Un pedido **no es una venta** (FR-140). El descuento de stock llega con el
    // cobro, en la etapa 3. Que dos personas se lleven la última unidad es la
    // consecuencia aceptada, y se resuelve por WhatsApp.
    expect(Number(despues.available)).toBe(Number(antes.available));
    expect(Number(despues.quantity)).toBe(Number(antes.quantity));
    expect(await StockMovement.count()).toBe(0);
  });

  it('el teléfono se guarda normalizado y el cliente se reusa', async () => {
    const { Customer, Pedido } = modelos;

    for (const clave of ['tel-1', 'tel-2']) {
      await request(app)
        .post('/api/publico/c/pedidos-de-a/pedidos')
        .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], clave));
    }

    const pedidos = await Pedido.findAll({ order: [['numero', 'ASC']] });
    expect(pedidos[0].comprador_telefono).toBe('5493425123456');

    // Dos pedidos del mismo teléfono son **un** cliente. Sin normalizar, «0342
    // 15 5123456» y «+54 9 342 512-3456» serían dos personas distintas.
    const clientes = await Customer.findAll({ where: { empresa_id: datos.empresaA.id, phone: '5493425123456' } });
    expect(clientes).toHaveLength(1);
    expect(pedidos[0].customer_id).toBe(clientes[0].id);
    expect(pedidos[1].customer_id).toBe(clientes[0].id);
  });

  it('un catálogo pausado no recibe pedidos, y el borrador ni existe', async () => {
    const enPausa = await request(app)
      .post('/api/publico/c/pausado-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], 'clave-pausa'));

    expect(enPausa.status).toBe(409);
    expect(enPausa.body.error).toBe('CATALOGO_NO_DISPONIBLE');

    const inventado = await request(app)
      .post('/api/publico/c/no-existe-esto/pedidos')
      .send(cuerpo([{ product_id: datos.harina.id, cantidad: 1 }], 'clave-inventada'));

    expect(inventado.status).toBe(404);

    const { Pedido } = modelos;
    expect(await Pedido.count()).toBe(0);
  });

  it('un producto del catálogo de al lado no se puede pedir desde este', async () => {
    // `levadura` está en `pedidos-de-a` y NO en `otra-tienda-de-a`. Es de la
    // misma empresa, así que `findScoped` lo encuentra: lo que lo frena es la
    // fila de `catalogo_productos`.
    const res = await request(app)
      .post('/api/publico/c/otra-tienda-de-a/pedidos')
      .send(cuerpo([{ product_id: datos.levadura.id, cantidad: 1 }], 'clave-vecina'));

    expect(res.status).toBe(404);

    const { Pedido } = modelos;
    expect(await Pedido.count()).toBe(0);
  });
});
