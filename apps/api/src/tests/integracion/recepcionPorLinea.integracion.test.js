// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, sequelize, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  La recepción por línea, contra Postgres real
//
//  Esto es lo que `tasks.md` llamaba **P2** y **P3**, los dos pasos manuales que
//  nadie corrió nunca. Dejaron de necesitar una persona el día que existió este
//  arnés, y quedan escritos acá.
//
//  ── Por qué NO los cubre ningún test que ya exista ──
//
//  `tests/recepcionDeOrden.test.js` corre sobre `tests/helpers/modelosFalsos.js`,
//  que guarda en memoria el objeto que le pasaron. El defecto de P2 es
//  exactamente lo contrario: el `detail` es una columna **JSONB**, y mutar los
//  objetos que Sequelize devolvió y reasignar la MISMA referencia no marca el
//  campo como modificado, así que el UPDATE salía sin la columna y las
//  cantidades recibidas no se persistían nunca. Un doble no puede ver eso: no
//  hay UPDATE, no hay columna y no hay serialización a JSON.
//
//  Y la siembra de las pruebas de navegador —que sí escribe contra Postgres—
//  **crea** una orden con dos líneas del mismo producto pero **nunca recibe
//  contra ella**: el caso exacto de P2 no lo ejercita nadie.
//
//  ── Lo que se afirma, y por qué en este nivel ──
//
//   - **P2**: recibir la línea 2 deja la línea 0 intacta, y **al revés**. Se lee
//     el JSONB con el mismo `jsonb_array_elements` que pedía el paso manual, o
//     sea contra la columna y no contra la respuesta del handler: si el
//     `changed('detail', true)` se cayera, la respuesta seguiría diciendo la
//     verdad y la base no.
//   - **P3**: una línea sin `product_id` genera deuda, no toca stock y **no
//     revierte las otras líneas**. Antes del hito eso era un 500 con la
//     transacción entera revertida —no entraba nada, ni de las líneas buenas—,
//     y una transacción que se revierte solo se puede observar con una
//     transacción de verdad.
// ════════════════════════════════════════════

const { SupplierOrder, SupplierMovement, Stock, Product } = modelos;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterAll(async () => {
  await cerrar();
});

/**
 * Crea una orden por la API —el camino real— y devuelve su id.
 *
 * Se crea por HTTP y no con `SupplierOrder.create` a propósito: así el `detail`
 * que se recibe es el que arma `createOrder`, con las claves que arma él. Una
 * orden fabricada a mano podría traer un `quantity_received: 0` que el código de
 * producción nunca escribe, y el test estaría probando su propia fixture.
 */
async function crearOrden(items) {
  const res = await request(app)
    .post(`/api/suppliers/${datos.molino.id}/orders`)
    .send({ date: '2026-07-25', items });

  expect(res.status).toBe(201);
  return res.body.data.id;
}

/**
 * Los `quantity_received` tal como quedaron **en la columna**, leídos con el
 * mismo `jsonb_array_elements` del paso manual P2.
 *
 * Devuelve strings y `null`s: es lo que hay en el JSONB, sin normalizar. Un
 * `Number(x) || 0` acá escondería la diferencia entre «esta línea no se tocó» y
 * «esta línea se recibió en cero», que es justamente lo que P2 mira.
 */
async function recibidosEnElJsonb(orderId) {
  const [filas] = await sequelize.query(
    `SELECT jsonb_array_elements(detail)->>'quantity_received' AS recibido
       FROM supplier_orders WHERE id = ${Number(orderId)}`
  );

  return filas.map((f) => f.recibido);
}

describe('P2 · Dos líneas del mismo producto son dos líneas en el JSONB', () => {
  // La orden que el paso manual describe: el mismo producto en la posición 0 y
  // en la 2, con **cantidades distintas** para que una recepción cruzada no dé
  // el mismo número por casualidad, y otro producto en el medio para que un
  // `find(d => d.product_id === …)` no acierte por ser el primero.
  const TRES_LINEAS = (harinaId, levaduraId) => [
    { product_id: harinaId, product_name: 'Harina 000', quantity: 12, unit_price: 100.50 },
    { product_id: levaduraId, product_name: 'Levadura fresca', quantity: 5, unit_price: 33.33 },
    { product_id: harinaId, product_name: 'Harina 000', quantity: 30, unit_price: 100.50 },
  ];

  it('recibir 10 en la línea 2 NO carga nada en la línea 0', async () => {
    const orderId = await crearOrden(TRES_LINEAS(datos.harina.id, datos.levadura.id));

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 2, cantidad: 10 }], punto_de_venta_id: datos.centroA.id });

    expect(res.status).toBe(200);

    // ── La columna, no la respuesta ──
    //
    // `null` y no `'0'` en las dos primeras: `createOrder` no escribe
    // `quantity_received` al armar el detalle, así que una línea que nunca se
    // recibió **no tiene la clave**. Se afirma tal cual queda para que el día
    // que eso cambie el test lo diga en vez de taparlo con un `|| 0`.
    expect(await recibidosEnElJsonb(orderId)).toEqual([null, null, '10']);
  });

  it('y al revés: recibir en la línea 0 NO toca lo que ya tenía la línea 2', async () => {
    const orderId = await crearOrden(TRES_LINEAS(datos.harina.id, datos.levadura.id));

    await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 2, cantidad: 10 }], punto_de_venta_id: datos.centroA.id });

    // Segunda recepción, ahora contra la OTRA línea del mismo producto.
    const segunda = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 0, cantidad: 4 }], punto_de_venta_id: datos.centroA.id });

    expect(segunda.status).toBe(200);

    // Tres valores distintos en tres posiciones: es el defecto 4 hecho columna.
    // Con la resolución vieja —`detail.find(d => d.product_id === …)`— los 4
    // habrían caído otra vez en la línea 0 (que es la primera que coincide) y
    // los 10 de la línea 2 se habrían perdido, o al revés según el orden.
    expect(await recibidosEnElJsonb(orderId)).toEqual(['4', null, '10']);

    // Y la respuesta dice lo mismo que la columna: si dijeran cosas distintas,
    // la pantalla mostraría una recepción que no quedó guardada.
    expect(segunda.body.data.recibido).toEqual([
      expect.objectContaining({ linea: 0, recibido_ahora: 4, recibido_total: 4, pendiente: 8 }),
    ]);
  });

  it('el detalle que devuelve GET dice DOS cantidades recibidas distintas para el mismo producto', async () => {
    const orderId = await crearOrden(TRES_LINEAS(datos.harina.id, datos.levadura.id));

    await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 2, cantidad: 10 }], punto_de_venta_id: datos.centroA.id });

    const detalle = await request(app).get(`/api/suppliers/orders/${orderId}`);

    const harina = detalle.body.data.items.filter((i) => i.product_id === datos.harina.id);

    expect(harina).toHaveLength(2);
    expect(harina.map((i) => i.linea)).toEqual([0, 2]);
    expect(harina.map((i) => i.quantity_received)).toEqual([undefined, 10]);
  });

  it('el stock suma UNA vez lo recibido, no una por línea del producto', async () => {
    const orderId = await crearOrden(TRES_LINEAS(datos.harina.id, datos.levadura.id));

    await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 2, cantidad: 10 }], punto_de_venta_id: datos.centroA.id });

    const stock = await Stock.findOne({
      where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id },
    });

    // La fixture arranca en 20. El `lock: t.LOCK.UPDATE` sobre esta fila es lo
    // que hace que dos líneas del mismo producto en la misma transacción no se
    // pisen: sin él, las dos leerían 20 y la segunda escribiría 20+n.
    expect(Number(stock.quantity)).toBe(30);
    expect(Number(stock.available)).toBe(30);
  });

  it('la deuda usa el precio de la línea que se recibió, no el de la primera del producto', async () => {
    // Las dos líneas del mismo producto con PRECIOS distintos: si la resolución
    // volviera al `find` por `product_id`, el importe saldría del precio de la
    // línea 0 y este test es el que lo dice.
    const orderId = await crearOrden([
      { product_id: datos.harina.id, product_name: 'Harina 000', quantity: 12, unit_price: 100.50 },
      { product_id: datos.levadura.id, product_name: 'Levadura fresca', quantity: 5, unit_price: 33.33 },
      { product_id: datos.harina.id, product_name: 'Harina 000', quantity: 30, unit_price: 7.77 },
    ]);

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 2, cantidad: 10 }], punto_de_venta_id: datos.centroA.id });

    // 10 × 7,77 = 77,70. Con el precio de la línea 0 daría 1.005,00.
    expect(res.body.data.deuda.amount).toBe(77.7);

    const movimiento = await SupplierMovement.findByPk(res.body.data.deuda.id);

    // Leído de la columna DECIMAL, que es donde tiene que haber quedado, y como
    // **string**: es lo que devuelve el driver y lo que después suma el
    // `GROUP BY` del saldo.
    expect(movimiento.amount).toBe('77.70');
    // La orden quedó a medio recibir, y eso se dice en la nota del asiento: el
    // contador ve una deuda parcial y no una orden completa.
    expect(movimiento.notes).toBe(`Recepción orden #${orderId} (parcial)`);
  });

  it('recibir la orden nueva NO toca la que ya existía del mismo proveedor', async () => {
    // La fixture ya trae una orden `pending` del Molino con Harina 000 a medio
    // recibir. Es el criterio de éxito 1 —«recibir la #118 no marca la #112»—
    // ejecutado contra la base: dos órdenes del mismo proveedor que comparten
    // producto.
    const [vieja] = await SupplierOrder.findAll({
      where: { supplier_id: datos.molino.id, status: 'pending' },
      order: [['id', 'ASC']],
    });

    const orderId = await crearOrden(TRES_LINEAS(datos.harina.id, datos.levadura.id));

    await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 2, cantidad: 10 }], punto_de_venta_id: datos.centroA.id });

    const despues = await SupplierOrder.findByPk(vieja.id);

    expect(despues.status).toBe('pending');
    expect(despues.detail[0].quantity_received).toBe(4);
  });
});

describe('P3 · La línea sin producto genera deuda y no revierte las otras', () => {
  /** Una línea normal y una de flete, que es una línea sin `product_id`. */
  const CON_FLETE = (harinaId) => [
    { product_id: harinaId, product_name: 'Harina 000', quantity: 10, unit_price: 100.50 },
    { product_name: 'Fletes', quantity: 1, unit_price: 4500.25 },
  ];

  it('recibir las dos líneas responde 200 y NO un 500', async () => {
    const orderId = await crearOrden(CON_FLETE(datos.harina.id));

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({
        items: [{ linea: 0, cantidad: 10 }, { linea: 1, cantidad: 1 }],
        punto_de_venta_id: datos.centroA.id,
      });

    // Antes del hito esto respondía 500 «Error al recibir la orden de compra»
    // porque el `Stock.create` con `product_id: null` chocaba contra la columna.
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('received');
  });

  it('la deuda incluye la línea sin producto', async () => {
    const orderId = await crearOrden(CON_FLETE(datos.harina.id));

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({
        items: [{ linea: 0, cantidad: 10 }, { linea: 1, cantidad: 1 }],
        punto_de_venta_id: datos.centroA.id,
      });

    // 10 × 100,50 + 1 × 4.500,25 = 5.505,25. Los centavos no cierran solos en
    // punto flotante y por eso los precios no son redondos.
    expect(res.body.data.deuda.amount).toBe(5505.25);
    expect((await SupplierMovement.findByPk(res.body.data.deuda.id)).amount).toBe('5505.25');
  });

  it('la línea normal SÍ movió stock, aunque la otra no tenga producto', async () => {
    const orderId = await crearOrden(CON_FLETE(datos.harina.id));

    await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({
        items: [{ linea: 0, cantidad: 10 }, { linea: 1, cantidad: 1 }],
        punto_de_venta_id: datos.centroA.id,
      });

    const stock = await Stock.findOne({
      where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id },
    });

    // 20 de la fixture + 10. Esto es lo que el 500 se llevaba puesto: la línea
    // buena tampoco entraba, porque la transacción se revertía entera.
    expect(Number(stock.quantity)).toBe(30);
  });

  it('NO se creó ninguna fila de stock para el flete', async () => {
    const orderId = await crearOrden(CON_FLETE(datos.harina.id));

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({
        items: [{ linea: 0, cantidad: 10 }, { linea: 1, cantidad: 1 }],
        punto_de_venta_id: datos.centroA.id,
      });

    // ⚠ **Las dos mitades van juntas y por eso el `deuda` está acá.** «No hay
    // fila de stock del flete» es cierto también cuando la recepción se
    // revirtió entera —que es el defecto—, así que sola no distingue nada. Lo
    // que la vuelve una afirmación es que la recepción haya entrado igual.
    expect(res.body.data.deuda).not.toBeNull();

    // La fixture siembra tres filas de stock para la empresa A. Si el flete
    // hubiera creado una, serían cuatro. Se cuenta en vez de buscar
    // `product_id: null` porque la columna no admite nulos: el defecto no se ve
    // como una fila rara, se ve como un 500.
    expect(await Stock.count({ where: { empresa_id: datos.empresaA.id } })).toBe(3);
    expect(await Product.count({ where: { name: 'Fletes' } })).toBe(0);
  });

  it('el aviso nombra el ítem que no está en el catálogo', async () => {
    const orderId = await crearOrden(CON_FLETE(datos.harina.id));

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({
        items: [{ linea: 0, cantidad: 10 }, { linea: 1, cantidad: 1 }],
        punto_de_venta_id: datos.centroA.id,
      });

    // «se registró la deuda y no se movió stock» es la frase que la pantalla
    // dibuja. Sin ella el usuario ve una recepción completa y un stock que no
    // subió por una de las líneas, sin ninguna explicación.
    expect(res.body.data.avisos).toEqual([
      expect.stringContaining('«Fletes» no está en el catálogo'),
    ]);
  });

  it('una orden que es TODA flete no necesita sucursal y se recibe igual', async () => {
    // Sin `punto_de_venta_id` y sin ninguna línea con producto: `resolverSucursal`
    // no se llama. Es la rama que protege a una empresa sin sucursales cargadas
    // de no poder registrar un servicio.
    const orderId = await crearOrden([
      { product_name: 'Fletes', quantity: 1, unit_price: 4500.25 },
      { product_name: 'Descarga', quantity: 2, unit_price: 750.13 },
    ]);

    const res = await request(app)
      .put(`/api/suppliers/orders/${orderId}/receive`)
      .send({ items: [{ linea: 0, cantidad: 1 }, { linea: 1, cantidad: 2 }] });

    expect(res.status).toBe(200);
    // 4.500,25 + 2 × 750,13 = 6.000,51.
    expect(res.body.data.deuda.amount).toBe(6000.51);
    expect(await Stock.count({ where: { empresa_id: datos.empresaA.id } })).toBe(3);
  });
});
