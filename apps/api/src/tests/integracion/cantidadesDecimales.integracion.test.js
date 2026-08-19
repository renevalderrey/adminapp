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

// ⚠ Se requiere DESPUÉS de `baseDePruebas`: arrastra `models/index.js`, que
// arrastra `config/database.js`, que arma la conexión al importarse.
const productionService = require('../../services/productionService');

const {
  Sale, SaleItem, Stock, StockMovement, Product, Recipe, RecipeItem,
} = modelos;

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
    // ⚠ Con las columnas ya en `DECIMAL(14,4)` esta comparación **sí** es la que
    // muerde: revertir la validación deja el handler escribiendo 19,6 y la fila
    // queda distinta. Antes de la Fase 3 no distinguía nada, y el motivo estaba
    // mal contado acá: no era que Postgres redondeara `19.6` de vuelta a 20 al
    // asignarlo —medido, `stock.update({ quantity: 19.6 })` viaja como
    // parámetro y contra una columna `INTEGER` respondía
    // `invalid input syntax for type integer`, o sea un 500 y un rollback—.
    // Los conteos se ponen en rojo por su cuenta: la línea en cero la escribe
    // `bulkCreate`, que sí usa literales y sí recibe el cast de asignación.
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

// ════════════════════════════════════════════
//  US1 · La base representa 9,6
//
//  Es el hallazgo `auditoria-frente2-hallazgos.json:335` ejecutado, y ejecutarlo
//  lo corrigió: **el hallazgo describe mal el modo de falla**, y conviene que
//  quede escrito porque el que lo lea va a buscar el síntoma equivocado.
//
//  El hallazgo dice que un consumo de 0,4 sobre 10 dejaba **10** —«se puede
//  producir infinitas veces sin que la harina baje nunca»— porque «el cast de
//  asignación numeric→int4 redondea». Medido contra Postgres 16 y Sequelize
//  6.37.8, con las columnas todavía en `INTEGER`: `stockRecord.update({ quantity:
//  9.6 })` viaja como **parámetro**, y un parámetro no recibe cast de asignación
//  —Postgres parsea el texto directo como entero— así que la respuesta era
//  `invalid input syntax for type integer: "9.6"`. La orden se revertía entera y
//  **no se registraba ninguna producción**: no había stock redondeado, había un
//  módulo que no se podía usar con recetas fraccionarias.
//
//  El redondeo silencioso que el hallazgo describe existe, pero es de otro
//  camino: `bulkCreate` escribe **literales** en el SQL, y ahí sí el cast de
//  asignación convierte 0,4 en 0 sin avisar. Es el defecto de US3, el de arriba,
//  y por eso una línea de venta quedaba en cero mientras una producción moría
//  con un 500.
//
//  Las dos mitades las arregla la misma columna.
//
//  ── Por qué se llama al servicio y no al endpoint ──
//
//  `/api/production` está detrás de `requireSuperadmin` (`server.js:655`) y el
//  usuario de la sesión de estos tests no lo es: por HTTP la respuesta sería un
//  404 y el test fallaría por el motivo equivocado. El servicio **es** el código
//  de producción —la ruta no hace más que llamarlo— y lo que se está afirmando
//  es qué queda escrito en la columna.
// ════════════════════════════════════════════

/**
 * Un elaborado con receta que consume `porUnidad` de harina, y la harina en 10.
 *
 * ⚠ El stock arranca en **10 exactos** porque es el número del hallazgo. Los
 * casos que sí necesitan un valor no redondo para poder distinguir el defecto
 * —las sumas de US2— viven en `sumasDeStock.integracion.test.js` y arrancan de
 * 10,5000: acá el defecto se distingue igual, porque lo que se mira es la parte
 * decimal del resultado y no una suma que cierre.
 */
async function recetaQueConsume(porUnidad) {
  const elaborado = await Product.create({
    empresa_id: datos.empresaA.id,
    name: 'Pan de campo',
    sku: 'PAN-001',
    cost: 0,
    unit_type: 'unidad',
  });

  const receta = await Recipe.create({
    empresa_id: datos.empresaA.id,
    product_id: elaborado.id,
    yield: 1,
    loss_percentage: 0,
  });

  await RecipeItem.create({
    recipe_id: receta.id,
    ingredient_product_id: datos.harina.id,
    quantity: porUnidad,
  });

  await Stock.update(
    { quantity: 10, available: 10 },
    { where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id } }
  );

  return elaborado;
}

/** El stock de harina en la sucursal desde la que produce el test. */
async function harinaEnCentro() {
  return Stock.findOne({
    where: {
      empresa_id: datos.empresaA.id,
      product_id: datos.harina.id,
      punto_de_venta_id: datos.centroA.id,
    },
  });
}

describe('Una orden de producción que consume una fracción', () => {
  it('consumir 0,4 sobre un stock de 10 deja 9,6 y NO 10', async () => {
    const elaborado = await recetaQueConsume(0.4);

    await productionService.createProductionOrder(
      { product_id: elaborado.id, quantity_produced: 1, batch_code: 'LOTE-1', production_date: '2026-08-20' },
      datos.empresaA.id,
      datos.centroA.id
    );

    const harina = await harinaEnCentro();

    // Igualdad exacta contra 9,6 y no un rango: un `toBeCloseTo` o un
    // `toBeLessThan(10)` daría verde con 9,5999 o con 9, que son justamente los
    // números que este cambio de columna existe para no producir. Con la
    // columna en `INTEGER` esta escritura ni siquiera llegaba: fallaba con
    // `invalid input syntax for type integer: "9.6"` (ver el encabezado).
    expect(Number(harina.quantity)).toBe(9.6);
    expect(Number(harina.available)).toBe(9.6);

    // Y tal como está en la columna, con la escala puesta: es lo que la API le
    // manda al navegador y lo que la Fase 4 tiene que dibujar como «9,6».
    expect(harina.quantity).toBe('9.6000');
  });

  it('consumir 0,6 sobre un stock de 10 deja 9,4 y NO 9', async () => {
    // El segundo número del hallazgo, y no es una repetición: con `INTEGER` el
    // primero redondeaba **para arriba** (10) y éste **para abajo** (9). Un solo
    // caso dejaría media regla sin ejercitar.
    const elaborado = await recetaQueConsume(0.6);

    await productionService.createProductionOrder(
      { product_id: elaborado.id, quantity_produced: 1, batch_code: 'LOTE-1', production_date: '2026-08-20' },
      datos.empresaA.id,
      datos.centroA.id
    );

    const harina = await harinaEnCentro();

    // `10 - 0.6` da 9.4 en punto flotante y `10 - 0.4` da 9.6, los dos exactos;
    // si alguna vez no lo fueran, los 4 decimales de la columna redondean el
    // sobrante y el número que queda escrito sigue siendo éste.
    expect(Number(harina.quantity)).toBe(9.4);
    expect(harina.quantity).toBe('9.4000');
  });

});

describe('Lo que la columna guarda y lo que el driver devuelve', () => {
  it('una línea de venta escrita con 0,4 DIRECTO en el modelo vale 0,4 al releerla', async () => {
    // Por el modelo y no por el endpoint: la 016 deja `POST /api/sales` cerrado
    // a toda fracción (PENDIENTE 2), así que intentarlo por HTTP daría 400 y el
    // test fallaría por el motivo equivocado. Lo que se afirma acá es la
    // **capacidad de la columna**, que es lo que la 017 va a usar cuando abra la
    // puerta; la puerta cerrada la afirman los casos de arriba.
    const linea = await SaleItem.create({
      sale_id: datos.ventaA.id,
      product_id: datos.harina.id,
      product_name: 'Harina 000',
      quantity: 0.4,
      unit_price: 1234.56,
    });

    const releida = await SaleItem.findByPk(linea.id);

    expect(Number(releida.quantity)).toBe(0.4);
    expect(releida.quantity).toBe('0.4000');
  });

  it('una fila de stock en 12 sigue valiendo doce, aunque el driver la entregue como "12.0000"', async () => {
    // Es el hecho del driver escrito y ejecutado, no deducido: `pg` devuelve un
    // `NUMERIC` como **texto con la escala puesta**, así que un stock de doce
    // vuelve `"12.0000"` sin que exista un solo decimal en toda la base. De acá
    // salen los diez puntos de dibujo de la Fase 4 y las cinco sumas de la Fase
    // 1: el valor no cambió, cambió su tipo en JavaScript.
    await Stock.update(
      { quantity: 12, available: 12 },
      { where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id } }
    );

    const harina = await harinaEnCentro();

    expect(typeof harina.quantity).toBe('string');
    expect(harina.quantity).toBe('12.0000');
    expect(Number(harina.quantity)).toBe(12);

    // Las dos trampas que esto abre, fijadas para que nadie las descubra en
    // producción: la comparación estricta contra un número deja de andar, y la
    // suma concatena.
    expect(harina.quantity === 12).toBe(false);
    expect(harina.quantity + 5).toBe('12.00005');
  });

  it('un stock en cero vuelve "0.0000", que es *truthy*: todo `|| 0` cambia de rama', async () => {
    // El caso que rompió `stock.js:142` y que la Fase 2 corrigió. Se fija acá
    // porque es la única forma de ver que el string existe: contra un doble,
    // `quantity` es el número 0 y el `||` cae al cero como siempre.
    await Stock.update(
      { quantity: 0, available: 0 },
      { where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id } }
    );

    const harina = await harinaEnCentro();

    expect(harina.quantity).toBe('0.0000');
    expect(Boolean(harina.quantity)).toBe(true);
  });
});
