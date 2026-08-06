// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  P12 · Dos personas recibiendo la misma orden — riesgo 7
//
//  ⚠⚠ **Este archivo DOCUMENTA un defecto abierto. No lo arregla, y no está en
//  rojo.** Está declarado Fuera de alcance en la spec 012 y el paso manual lo
//  decía con todas las letras: «se corre una vez para tener el comportamiento
//  documentado, no para arreglarlo acá».
//
//  Lo que cambia al bajarlo a test no es el código: cambia que el día que
//  alguien reporte «cargué la recepción y falta la mitad» haya una respuesta
//  escrita —y reproducible— en vez de una investigación desde cero.
//
//  ── Qué pasa, exactamente ──
//
//  `receiveOrder` lee la orden con `SupplierOrder.findOne(...)` **sin `lock`**.
//  Dos recepciones simultáneas leen las dos el mismo `detail` con las mismas
//  cantidades recibidas, cada una le suma lo suyo sobre ESA copia, y la última
//  en commitear pisa a la otra. Es una actualización perdida de manual.
//
//  El stock **no** se duplica y eso no es casualidad: el `Stock.findOne` sí
//  lleva `lock: t.LOCK.UPDATE`, así que la segunda transacción espera y relee la
//  fila ya actualizada. O sea que las dos mitades del sistema quedan diciendo
//  cosas distintas: entraron 10 unidades al depósito, se generaron dos deudas
//  por 10 unidades, y la orden dice que se recibieron 5.
//
//  ── Por qué esto no se puede escribir con dobles ──
//
//  No hay dos transacciones que puedan chocar. `modelosFalsos` guarda en un
//  objeto: la segunda escritura pisa a la primera igual, pero por el motivo
//  equivocado, y el test pasaría también con el `lock` puesto.
//
//  ── ⚠ La mitigación anotada en T1253 NO es la línea que dice ahí ──
//
//  `tasks.md` la describe como «una línea, `lock: t.LOCK.UPDATE` sobre el
//  `SupplierOrder.findOne`». **Escrita así rompe TODAS las recepciones**, y está
//  medido: ese `findOne` lleva un `include` de `Supplier`, que Sequelize traduce
//  a un `LEFT OUTER JOIN`, y Postgres responde
//
//      0A000: FOR UPDATE cannot be applied to the nullable side of an outer join
//
//  o sea un **500 en cada recepción**, no en las simultáneas. La forma que sí
//  funciona es `lock: { level: t.LOCK.UPDATE, of: SupplierOrder }`, que emite
//  `FOR UPDATE OF "SupplierOrder"` y deja el join afuera del lock. Con esa, los
//  dos tests marcados «DEFECTO ABIERTO» pasan a decir 10 en vez de 5 —también
//  medido— y el defecto desaparece.
//
//  Queda escrito acá y no solo en el documento porque una mitigación de una
//  línea que en realidad no compila es peor que ninguna: se aplica apurado el
//  día que alguien reporta el problema, y el 500 aparece en producción.
//
//  Cuando se decida aplicarla, **estos tests se ponen en rojo** —la guardia
//  estática de abajo primero—, y eso es lo buscado: es el recordatorio de que
//  este archivo describe el comportamiento viejo.
// ════════════════════════════════════════════

const { SupplierOrder, SupplierMovement, Stock } = modelos;

const RUTA_DEL_SERVICIO = path.join(__dirname, '..', '..', 'services', 'purchaseService.js');

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

/** Una orden de una sola línea, con margen de sobra para dos recepciones. */
async function ordenDeVeinte() {
  const res = await request(app)
    .post(`/api/suppliers/${datos.molino.id}/orders`)
    .send({
      date: '2026-07-25',
      items: [{
        product_id: datos.harina.id, product_name: 'Harina 000',
        quantity: 20, unit_price: 100.00,
      }],
    });

  expect(res.status).toBe(201);
  return res.body.data.id;
}

function recibir(orderId, cantidad) {
  return request(app)
    .put(`/api/suppliers/orders/${orderId}/receive`)
    .send({ items: [{ linea: 0, cantidad }], punto_de_venta_id: datos.centroA.id });
}

describe('Dos recepciones simultáneas de la misma orden', () => {
  it('las dos responden 200: ninguna se entera de la otra', async () => {
    const orderId = await ordenDeVeinte();

    const [a, b] = await Promise.all([recibir(orderId, 5), recibir(orderId, 5)]);

    // Nadie recibe un error. Es lo que hace que el defecto sea invisible: las
    // dos personas ven «Mercadería recibida» y se van.
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.recibido[0].recibido_ahora).toBe(5);
    expect(b.body.data.recibido[0].recibido_ahora).toBe(5);
  });

  it('⚠ DEFECTO ABIERTO: la orden queda con MENOS recibido del que entró', async () => {
    const orderId = await ordenDeVeinte();

    await Promise.all([recibir(orderId, 5), recibir(orderId, 5)]);

    const orden = await SupplierOrder.findByPk(orderId);

    // Las dos respuestas dijeron «entraron 5». La orden dice 5, no 10: la
    // segunda transacción escribió el detalle que había leído antes de que la
    // primera commiteara.
    //
    // ⚠ Si esto se pone en rojo diciendo 10, no rompiste nada: alguien agregó el
    // `lock: t.LOCK.UPDATE` al `SupplierOrder.findOne` de `receiveOrder` y este
    // archivo entero pasó a describir el comportamiento viejo. Actualizalo.
    expect(orden.detail[0].quantity_received).toBe(5);
  });

  it('el stock NO se duplica ni se pierde: el lock de la fila sí está', async () => {
    const orderId = await ordenDeVeinte();

    await Promise.all([recibir(orderId, 5), recibir(orderId, 5)]);

    const stock = await Stock.findOne({
      where: { product_id: datos.harina.id, punto_de_venta_id: datos.centroA.id },
    });

    // 20 de la fixture + 5 + 5. El `lock: t.LOCK.UPDATE` del `Stock.findOne`
    // hace que la segunda transacción espere y relea la fila ya actualizada.
    // Sin él, las dos leerían 20 y el depósito terminaría con 25.
    expect(Number(stock.quantity)).toBe(30);
    expect(Number(stock.available)).toBe(30);
  });

  it('⚠ DEFECTO ABIERTO: la deuda cobra las DIEZ unidades que la orden no registra', async () => {
    const orderId = await ordenDeVeinte();

    await Promise.all([recibir(orderId, 5), recibir(orderId, 5)]);

    // Solo los de ESTA orden: el Molino ya trae movimientos de la fixture, y un
    // filtro por proveedor a secas los mezclaría.
    const movimientos = await SupplierMovement.findAll({
      where: { supplier_id: datos.molino.id, type: 'deuda', notes: { [Op.like]: `%orden #${orderId}%` } },
      order: [['id', 'ASC']],
    });

    // Dos asientos de $500. La cuenta del proveedor y el stock coinciden entre
    // sí —entraron 10 unidades y se deben 10— y la ORDEN es la que queda
    // mintiendo: dice 5 recibidas y 15 pendientes.
    expect(movimientos.map((m) => m.amount)).toEqual(['500.00', '500.00']);

    const orden = await SupplierOrder.findByPk(orderId);
    const recibidoSegunLaOrden = Number(orden.detail[0].quantity_received);
    const recibidoSegunLaDeuda = movimientos.length * 5;

    // La afirmación es la incoherencia: los dos números tendrían que ser el
    // mismo y no lo son. Escrita así, el día que se agregue el lock esto se
    // vuelve una igualdad y el test dice qué cambió.
    expect(recibidoSegunLaOrden).toBeLessThan(recibidoSegunLaDeuda);
  });
});

describe('La mitigación todavía no está, y esta guardia lo fija', () => {
  it('el findOne de la orden en receiveOrder NO toma lock (riesgo 7, T1253)', () => {
    const fuente = fs.readFileSync(RUTA_DEL_SERVICIO, 'utf8');

    // El bloque del `SupplierOrder.findOne` de `receiveOrder`, del `findOne`
    // hasta su `});`. Se mira el texto y no el comportamiento porque el
    // comportamiento ya está arriba: esto es lo que va a fallar **primero** el
    // día que alguien agregue la línea, con el nombre del riesgo en el título.
    const bloque = fuente.match(/const order = await SupplierOrder\.findOne\(\{[\s\S]*?\n {6}\}\);/);

    expect(bloque).not.toBeNull();
    expect(bloque[0]).not.toContain('lock');
  });
});
