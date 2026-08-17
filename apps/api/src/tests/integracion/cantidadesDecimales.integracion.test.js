// ⚠ baseDePruebas va PRIMERO: `config/database.js` arma la conexión al
// importarse, así que cualquier modelo —o `supertest`, que arrastra la
// aplicación— cargado antes la dejaría apuntando a la base de desarrollo.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  La mitad de US3 que solo se ve contra Postgres
//
//  Que `motivoDeCantidadInvalida` rechace `0.4` lo prueba una función pura
//  (`tests/cantidades.test.js`), y que el endpoint conteste 400 lo prueba un
//  test con dobles (`tests/rutasDeVentas.test.js`). Lo que **ninguno de los dos
//  puede afirmar** es que después del rechazo la base quedó como estaba: los
//  dobles no tienen transacción, así que el `rollback` de la ruta no borra nada
//  y las filas que el handler alcanzó a escribir siguen ahí.
//
//  Y es justamente la mitad que importa, porque el defecto de hoy no es que el
//  endpoint conteste mal: es que contesta **201** y deja asentada una línea de
//  venta con cantidad CERO —importe intacto, cero descontado de stock— sin que
//  nada avise. Postgres redondea al asignar `0.4` a una columna `INTEGER` y
//  Sequelize 6.37.8 no valida el tipo (`typeValidation` viene en `false`), así
//  que la transacción termina bien.
//
//  ── Por qué el control de la venta normal va en el mismo archivo ──
//
//  «No quedó ninguna fila» es una afirmación que un endpoint completamente roto
//  cumple sin esfuerzo. El caso de las 3 unidades es lo que separa «rechazó lo
//  que había que rechazar» de «no registra nada nunca».
// ════════════════════════════════════════════

const { Sale, SaleItem, Stock, StockMovement } = modelos;

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
 * La fila de stock de la harina en la sucursal desde la que cobra el POS.
 *
 * Es la que `resolverSucursal` elige sin cabecera `X-Punto-De-Venta-Id`: la
 * empresa A no tiene ninguna con código `principal`, así que cae al activo de
 * menor id, que es Centro.
 */
function stockDeLaHarina() {
  return Stock.findOne({
    where: {
      empresa_id: datos.empresaA.id,
      product_id: datos.harina.id,
      punto_de_venta_id: datos.centroA.id,
    },
  });
}

/** Un ticket de una línea de harina, con el id fijo para poder buscarlo. */
function ticket(cantidad, extra = {}) {
  return {
    id: 'VENTA-FRACCIONADA-0001',
    items: [{
      product_id: datos.harina.id,
      product_name: 'Harina 000',
      quantity: cantidad,
      unit_price: 1234.56,
    }],
    ...extra,
  };
}

describe('POST /api/sales con una cantidad que la columna no puede guardar', () => {
  it('NO deja una línea de venta en cero: se rechaza con 400 y la base queda igual', async () => {
    // El valor se lee ANTES y se compara por igualdad exacta contra el de
    // después. Contra un número escrito a mano, el test seguiría pasando si la
    // fixture cambiara de cantidad, y no diría nada sobre lo que hizo el
    // handler.
    const antes = await stockDeLaHarina();
    const ventasAntes = await Sale.count();
    const lineasAntes = await SaleItem.count();
    const movimientosAntes = await StockMovement.count();

    const res = await request(app).post('/api/sales').send(ticket(0.4));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'ITEM_INVALIDO' });

    // La venta no existe, ni con ese id ni como una fila más.
    expect(await Sale.findOne({ where: { id: 'VENTA-FRACCIONADA-0001' } })).toBeNull();
    expect(await Sale.count()).toBe(ventasAntes);
    expect(await SaleItem.count()).toBe(lineasAntes);
    expect(await StockMovement.count()).toBe(movimientosAntes);

    // Y el stock quedó **exactamente** en lo que valía.
    //
    // ⚠ Contra las columnas `INTEGER` de hoy, esta comparación **no** es la que
    // distingue el defecto y hay que decirlo: con la validación vieja el
    // handler escribía `20 - 0.4 = 19.6` y Postgres lo redondeaba de vuelta a
    // 20 al asignarlo, así que la fila quedaba igual. Los que se ponen en rojo
    // hoy son los conteos: la venta, su línea en cero y el movimiento sí
    // quedaban. Después de la Fase 3 la columna guarda 19,6 y entonces esta
    // comparación pasa a ser la que muerde. Van las dos cosas juntas por eso.
    const despues = await stockDeLaHarina();

    expect(despues.quantity).toBe(antes.quantity);
    expect(despues.available).toBe(antes.available);
  });

  it('NO deja ninguna línea con 0.00004 tampoco: el mismo defecto con cuatro ceros más', async () => {
    // Es el caso que la migración a `DECIMAL(14,4)` **no** arregla: la columna
    // pasa a poder guardar `0.4` y `0.00004` se redondearía a `0.0000`. La
    // puerta se cierra sobre la regla de negocio y no sobre la escala de la
    // columna, así que este caso se rechaza igual antes y después de migrar.
    const res = await request(app).post('/api/sales').send(ticket(0.00004));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ITEM_INVALIDO');
    expect(await SaleItem.count({ where: { sale_id: 'VENTA-FRACCIONADA-0001' } })).toBe(0);
  });

  it('el mensaje del rechazo se puede leer: nombra el producto y no la columna', async () => {
    // FR-021. Lo lee quien está cobrando, con el cliente enfrente.
    const res = await request(app).post('/api/sales').send(ticket(0.4));
    const respuesta = JSON.stringify(res.body).toLowerCase();

    expect(res.body.message).toContain('Harina 000');

    for (const filtracion of ['sale_items', 'quantity', 'numeric', 'decimal', 'constraint', 'column']) {
      expect(respuesta).not.toContain(filtracion);
    }
  });

  it('una venta de 3 unidades sigue registrándose y descontando lo mismo que antes', async () => {
    // El control. Sin esto, los tres casos de arriba los pasa un endpoint que
    // no registra ninguna venta.
    const antes = await stockDeLaHarina();

    const res = await request(app).post('/api/sales').send(ticket(3, { total: 3703.68 }));

    expect(res.status).toBe(201);

    const linea = await SaleItem.findOne({ where: { sale_id: 'VENTA-FRACCIONADA-0001' } });
    expect(linea).not.toBeNull();
    expect(Number(linea.quantity)).toBe(3);

    const despues = await stockDeLaHarina();
    expect(Number(despues.quantity)).toBe(Number(antes.quantity) - 3);
    expect(Number(despues.available)).toBe(Number(antes.available) - 3);

    expect(await StockMovement.count({ where: { referencia_id: 'VENTA-FRACCIONADA-0001' } })).toBe(1);
  });
});
