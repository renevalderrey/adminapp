// ⚠ baseDePruebas va PRIMERO: `config/database.js` arma la conexión al
// importarse, así que cualquier modelo —o `supertest`, que arrastra la
// aplicación— cargado antes la dejaría apuntando a la base de desarrollo.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  US2 · Los cuatro caminos que SUMAN stock, contra Postgres real
//
//  ── Por qué este archivo no se puede reemplazar con dobles ──
//
//  Los cinco `+` que la Fase 1 corrigió solo se rompen cuando el valor llega
//  como **texto**, y eso lo produce el driver de Postgres y nadie más:
//  `tests/helpers/modelosFalsos.js` devuelve el número de JavaScript que le
//  pusieron, así que los tests rápidos pasan en verde con la aritmética rota. La
//  Fase 1 los cubrió inyectándole el string al doble, que prueba la función; acá
//  se prueba **el camino entero contra la columna**.
//
//  ── Los dos modos de falla, y por qué el peligroso es el mudo ──
//
//  1. **Los dos operandos salen de la base.** Los dos traen la escala puesta, la
//     concatenación tiene dos puntos —`'10.2500' + '0.2500'` es
//     `'10.25000.2500'`— y Postgres rechaza la escritura. Se ve.
//  2. **Uno sale de la base y el otro es un número del request.** Un solo punto,
//     o sea un número **válido**: `'7.0000' + 10` es `'7.000010'`, que como
//     número es 7,00001 cuando lo correcto era 17. Postgres lo acepta sin
//     chistar y el inventario **pierde** la mercadería en silencio.
//
//  El segundo es el que nadie encuentra, y es el de la transferencia, el de la
//  recepción y el de la edición manual. Por eso cada camino tiene su propio caso
//  (FR-028): con un solo test que los cubriera a todos, saber cuál se rompió
//  sería leer un stack trace.
//
//  ── Por qué las fixtures de acá y no las de `fixtures.js` ──
//
//  Porque `fixtures.js` la comparten treinta archivos y varios afirman conteos:
//  sumarle un producto a la empresa A mueve los números del panel, del catálogo
//  y de los listados. Lo que se siembra acá es lo que este archivo necesita, y
//  el encabezado de `fixtures.js` dice dónde vive la fila fraccionaria.
// ════════════════════════════════════════════

const { Sale, SaleItem, Stock, StockMovement, Product } = modelos;

let datos;
/** El producto propio de este archivo, con su fila de stock fraccionaria. */
let queso;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  // ── Un producto propio, para no mover los conteos de la fixture compartida ──
  queso = await Product.create({
    empresa_id: datos.empresaA.id,
    name: 'Queso rallado',
    sku: 'QUE-001',
    cost: 987.65,
    unit_type: 'kg',
  });

  // ⚠ **10,5000 y no 10.** Es la exigencia de `CONVENCIONES.md:373-376` hecha
  // dato: con un entero redondo, «volvió a lo que valía» cierra igual con la
  // suma corregida y con la rota, porque la parte que se pierde al concatenar
  // es justamente la decimal. Con 10,5 el defecto tiene dónde verse.
  await Stock.create({
    empresa_id: datos.empresaA.id,
    product_id: queso.id,
    punto_de_venta_id: datos.centroA.id,
    location: 'centro',
    quantity: 10.5,
    available: 10.5,
    min_stock: 0,
  });

  // ── La fila en CERO ──
  //
  // Es el único caso en que el mensaje de stock insuficiente de una
  // transferencia se lee, y es exactamente donde la expresión vieja
  // —`sourceStock?.quantity || 0`— cambiaba de rama: la cadena `"0.0000"` es
  // *truthy*, así que el `||` dejaba de caer al cero. Contra un doble, esa
  // columna vale el número 0 y el defecto no existe.
  await Stock.create({
    empresa_id: datos.empresaA.id,
    product_id: datos.levadura.id,
    punto_de_venta_id: datos.norteA.id,
    location: 'norte',
    quantity: 0,
    available: 0,
    min_stock: 0,
  });
});

afterAll(async () => {
  await cerrar();
});

/** La fila de stock de un producto en una sucursal. */
function stockDe(productId, puntoDeVentaId) {
  return Stock.findOne({
    where: { empresa_id: datos.empresaA.id, product_id: productId, punto_de_venta_id: puntoDeVentaId },
  });
}

describe('Anular una venta devuelve EXACTAMENTE lo que descontó', () => {
  /**
   * La venta de 0,250 que el endpoint no deja crear.
   *
   * ⚠ Se escribe **directo en el modelo** a propósito: la 016 deja
   * `POST /api/sales` cerrado a toda fracción (PENDIENTE 2 de la spec), así que
   * intentarlo por HTTP daría 400 y el test fallaría por el motivo equivocado.
   * Lo que se está probando es la **anulación**, que sí corre por la ruta real.
   *
   * El descuento se escribe a mano por el mismo motivo: es lo que la venta
   * habría dejado.
   */
  async function ventaDeMedioCuarto(descontadoDe) {
    const venta = await Sale.create({
      id: 'VENTA-FRACCIONARIA-0001',
      empresa_id: datos.empresaA.id,
      punto_de_venta_id: datos.centroA.id,
      date: '2026-08-20',
      time: '11:00',
      total: 246.91,
      payment_method: 'ef',
      status: 'active',
    });

    await SaleItem.create({
      sale_id: venta.id,
      product_id: queso.id,
      product_name: 'Queso rallado',
      quantity: 0.25,
      unit_price: 987.65,
    });

    await Stock.update(
      {
        quantity: Number(descontadoDe.quantity) - 0.25,
        available: Number(descontadoDe.available) - 0.25,
      },
      { where: { id: descontadoDe.id } }
    );

    return venta;
  }

  it('el stock vuelve a 10,5000 exactos, y no a un número mayor', async () => {
    // El valor de referencia se LEE, no se escribe a mano: contra un 10.5
    // tipeado en la aserción, el test seguiría pasando el día que la siembra
    // cambie y no diría nada sobre lo que hizo el handler.
    const antes = await stockDe(queso.id, datos.centroA.id);
    expect(antes.quantity).toBe('10.5000');

    const venta = await ventaDeMedioCuarto(antes);

    const vendido = await stockDe(queso.id, datos.centroA.id);
    expect(vendido.quantity).toBe('10.2500');

    const res = await request(app).put(`/api/sales/${venta.id}/void`);

    expect(res.status).toBe(200);

    const despues = await stockDe(queso.id, datos.centroA.id);

    // Igualdad exacta contra el valor leído antes, y no un `toBeLessThan` ni un
    // `toBeCloseTo`: con `sales.js:722` revertido los dos operandos son texto
    // con escala, la concatenación tiene dos puntos y lo que se intenta escribir
    // es `"10.25000.2500"` — que no es un número más chico ni más grande, es
    // basura que Postgres rechaza. Una aserción de rango se pondría verde con
    // cualquier resultado que quedara «cerca».
    expect(despues.quantity).toBe(antes.quantity);
    expect(despues.available).toBe(antes.available);
    expect(Number(despues.quantity)).toBe(10.5);
  });

  it('el movimiento que queda registrado dice las mismas cantidades fraccionarias', async () => {
    // `stock_movements` es el único registro de qué se movió, y sus cuatro
    // columnas migran en esta misma fase. Si hubieran quedado en `INTEGER`, el
    // historial diría que el stock pasó de 10 a 11 mientras la fila dice 10,5:
    // dos tablas contando distinto el mismo hecho, y la que se audita es ésta.
    const antes = await stockDe(queso.id, datos.centroA.id);
    const venta = await ventaDeMedioCuarto(antes);

    await request(app).put(`/api/sales/${venta.id}/void`);

    const movimiento = await StockMovement.findOne({
      where: { referencia_id: venta.id, tipo: 'sale_void' },
    });

    expect(movimiento).not.toBeNull();
    expect(Number(movimiento.cantidad_anterior)).toBe(10.25);
    expect(Number(movimiento.cantidad_nueva)).toBe(10.5);
    expect(Number(movimiento.disponible_anterior)).toBe(10.25);
    expect(Number(movimiento.disponible_nuevo)).toBe(10.5);
  });
});

describe('Una transferencia suma en el DESTINO lo que sacó del origen', () => {
  /** La fila del destino, que es la que distingue el defecto. */
  async function destinoCon(cantidad) {
    return Stock.create({
      empresa_id: datos.empresaA.id,
      product_id: queso.id,
      punto_de_venta_id: datos.norteA.id,
      location: 'norte',
      quantity: cantidad,
      available: cantidad,
      min_stock: 0,
    });
  }

  it('20 en el destino más 5 transferidas son 25, y no 20,0001', async () => {
    await destinoCon(20);

    const res = await request(app).post('/api/stock/transfer').send({
      from_punto_de_venta_id: datos.centroA.id,
      to_punto_de_venta_id: datos.norteA.id,
      items: [{ product_id: queso.id, quantity: 5 }],
    });

    expect(res.status).toBe(201);

    const destino = await stockDe(queso.id, datos.norteA.id);

    // Es el modo de falla **mudo**: `qty` es un `parseFloat` del cuerpo, o sea
    // un número, así que `'20.0000' + 5` da `'20.00005'` —un solo punto, o sea
    // un número válido— y la columna lo guarda redondeado a cuatro decimales.
    // Medido revirtiendo la línea: el destino queda en **20,0001**. Cinco kilos
    // que salieron de una sucursal y no llegaron a la otra, sin un solo error.
    expect(Number(destino.quantity)).toBe(25);
    expect(Number(destino.available)).toBe(25);
  });

  it('el ORIGEN no sirve de control: la resta cierra igual con la suma rota', async () => {
    // Va escrito y ejecutado para que nadie «simplifique» el caso de arriba
    // mirando el origen: `'10.5000' - 5` es 5,5 con la corrección y sin ella,
    // porque la resta fuerza a número. Un test que mirara solo esto pasaría con
    // el defecto puesto.
    await destinoCon(20);

    await request(app).post('/api/stock/transfer').send({
      from_punto_de_venta_id: datos.centroA.id,
      to_punto_de_venta_id: datos.norteA.id,
      items: [{ product_id: queso.id, quantity: 5 }],
    });

    const origen = await stockDe(queso.id, datos.centroA.id);

    expect(Number(origen.quantity)).toBe(5.5);
  });

  it('sin fila en el destino se crea una con la cantidad transferida', async () => {
    // La otra rama del mismo `if`. Sin este caso, alguien podría «arreglar» la
    // suma borrando el `else` y nadie se enteraría hasta la primera
    // transferencia a una sucursal nueva.
    const res = await request(app).post('/api/stock/transfer').send({
      from_punto_de_venta_id: datos.centroA.id,
      to_punto_de_venta_id: datos.norteA.id,
      items: [{ product_id: queso.id, quantity: 2.5 }],
    });

    expect(res.status).toBe(201);

    const destino = await stockDe(queso.id, datos.norteA.id);

    expect(Number(destino.quantity)).toBe(2.5);
    expect(Number(destino.available)).toBe(2.5);
  });

  it('el mensaje de stock insuficiente dice «disponible: 0» y no «disponible: 0.0000»', async () => {
    // La fila en cero del `beforeEach`. Es el único caso en que este mensaje se
    // lee, y el único donde la expresión vieja cambiaba de rama: `"0.0000"` es
    // *truthy*, así que `sourceStock?.quantity || 0` dejaba de caer al cero y el
    // mensaje decía «disponible: 0.0000», con una escala que nadie escribió.
    const res = await request(app).post('/api/stock/transfer').send({
      from_punto_de_venta_id: datos.norteA.id,
      to_punto_de_venta_id: datos.centroA.id,
      items: [{ product_id: datos.levadura.id, quantity: 1 }],
    });

    expect(res.status).toBe(400);
    // La frase entera y no un fragmento: lo que se lee es el mensaje completo, y
    // medido con la línea revertida dice «disponible: 0.0000, requerido: 1».
    expect(res.body.error).toContain('(disponible: 0, requerido: 1)');
    expect(res.body.error).not.toContain('0.0000');
  });
});

describe('Recibir una orden de compra suma lo recibido al stock que había', () => {
  it('7 en el depósito más 10 recibidas son 17, y no 7,00001', async () => {
    // La fixture tiene la harina en el Norte con `quantity: 7` y `available: 5`
    // —distintos a propósito—, así que este caso también dice que cada suma tomó
    // el operando que le corresponde: con los dos iguales, cruzarlos daría el
    // mismo número.
    const antes = await stockDe(datos.harina.id, datos.norteA.id);
    expect([antes.quantity, antes.available]).toEqual(['7.0000', '5.0000']);

    const orden = await request(app)
      .post(`/api/suppliers/${datos.molino.id}/orders`)
      .send({
        date: '2026-08-20',
        items: [{ product_id: datos.harina.id, product_name: 'Harina 000', quantity: 10, unit_price: 100.50 }],
      });

    expect(orden.status).toBe(201);

    const res = await request(app)
      .put(`/api/suppliers/orders/${orden.body.data.id}/receive`)
      .send({ items: [{ linea: 0, cantidad: 10 }], punto_de_venta_id: datos.norteA.id });

    expect(res.status).toBe(200);

    const despues = await stockDe(datos.harina.id, datos.norteA.id);

    // El modo mudo otra vez, y acá es total: `'7.0000' + 10` es `'7.000010'`,
    // que la columna redondea a cuatro decimales. Medido revirtiendo la línea,
    // el stock queda en **7,0000 exactos**: recibir diez unidades no mueve el
    // inventario ni un gramo y nada falla. Lo único que lo encuentra es el
    // recuento físico.
    expect(Number(despues.quantity)).toBe(17);
    expect(Number(despues.available)).toBe(15);
  });
});

describe('Editar el stock a mano mueve el disponible el MISMO delta', () => {
  /** Deja la fila del queso en 100/100, que es el número del defecto. */
  async function enCien() {
    const fila = await stockDe(queso.id, datos.centroA.id);
    await fila.update({ quantity: 100, available: 100 });
    return fila.id;
  }

  it('PUT /api/stock/:id · de 100 a 105 deja el disponible en 105', async () => {
    const id = await enCien();

    const res = await request(app).put(`/api/stock/${id}`).send({ quantity: 105 });

    expect(res.status).toBe(200);

    const despues = await stockDe(queso.id, datos.centroA.id);

    // ⚠ Es el peor de los cinco sitios y el que más fácil pasa una revisión:
    // `Math.max(0, "100.0000" + 5)` **convierte después de concatenar** y
    // devuelve 100,00005 sin lanzar nada. Medido revirtiendo la línea, en la
    // columna queda **100,0001**, no 105 — y tampoco 1005, que es lo que daría
    // un `'100'` sin escala: es un número perfectamente creíble, cinco unidades
    // más chico que el correcto, que nadie va a mirar dos veces.
    expect(Number(despues.available)).toBe(105);
    expect(Number(despues.quantity)).toBe(105);
  });

  it('POST /api/stock · el otro camino, con la misma cuenta y el mismo Math.max', async () => {
    // Los dos caminos escriben la misma fila desde la misma pantalla. Hasta la
    // Fase 1 la cuenta estaba escrita dos veces y arreglada en ninguna, así que
    // los dos casos van por separado: corregir uno solo dejaría la mitad de la
    // pantalla rota y ningún test en rojo.
    await enCien();

    const res = await request(app).post('/api/stock').send({
      product_id: queso.id,
      punto_de_venta_id: datos.centroA.id,
      quantity: 105,
    });

    expect(res.status).toBe(200);

    const despues = await stockDe(queso.id, datos.centroA.id);

    expect(Number(despues.available)).toBe(105);
    expect(Number(despues.quantity)).toBe(105);
  });

  it('el movimiento manual guarda el disponible nuevo sin redondear', async () => {
    // El `PUT` escribe además una fila en `stock_movements`, y sus columnas
    // migran en esta misma fase. Se afirma con un valor fraccionario porque con
    // 105 la foto se vería igual en `INTEGER` y en `NUMERIC`.
    //
    // ⚠ Y este es el caso que muestra hasta dónde llega el `Math.max`: con la
    // línea revertida, `"100.0000" + 0.5` tiene DOS puntos, `Math.max` lo
    // convierte a **NaN**, y Postgres lo acepta sin chistar porque `NUMERIC`
    // tiene valor NaN. Medido: el disponible del stock y la foto del movimiento
    // quedan los dos en NaN. No es un número mal calculado, es una fila de
    // inventario que dejó de ser un número.
    const id = await enCien();

    await request(app).put(`/api/stock/${id}`).send({ quantity: 100.5 });

    const movimiento = await StockMovement.findOne({
      where: { product_id: queso.id, tipo: 'manual' },
      order: [['id', 'DESC']],
    });

    expect(Number(movimiento.cantidad_nueva)).toBe(100.5);
    expect(Number(movimiento.disponible_nuevo)).toBe(100.5);
  });
});

describe('Importar una planilla con una cantidad fraccionaria', () => {
  /** Una planilla de una fila, con la columna Stock en el valor que se pase. */
  function planilla(stock) {
    return Buffer.from(`nombre,sku,stock\n"Queso rallado","QUE-001",${stock}\n`, 'utf8');
  }

  it('una cantidad escrita 0,4 guarda 0,4 y NO 0', async () => {
    // `parseInt('0.4')` es 0 y truncar no avisa: una planilla que dice 0,4 kg
    // dejaba el inventario en cero y el importador informaba «1 actualizado».
    const res = await request(app)
      .post('/api/import/products')
      .attach('file', planilla('"0,4"'), 'lista.csv');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const fila = await stockDe(queso.id, datos.centroA.id);

    expect(Number(fila.quantity)).toBe(0.4);
    expect(Number(fila.available)).toBe(0.4);
  });

  it('con la celda VACÍA la fila de stock no se toca', async () => {
    // El gemelo, y es el que no se puede perder de vista al arreglar el otro:
    // el defecto que documenta `import.js:407-409` es que una planilla con la
    // columna en blanco **vaciaba el inventario**. Para `aCantidad` una celda
    // vacía y una celda que dice cero son el mismo cero, así que la distinción
    // la tiene que hacer `aNumero` antes.
    const antes = await stockDe(queso.id, datos.centroA.id);

    const res = await request(app)
      .post('/api/import/products')
      .attach('file', planilla('""'), 'lista.csv');

    expect(res.status).toBe(200);

    const despues = await stockDe(queso.id, datos.centroA.id);

    expect(despues.quantity).toBe(antes.quantity);
    expect(despues.available).toBe(antes.available);
    expect(Number(despues.quantity)).toBe(10.5);
  });
});
