// ════════════════════════════════════════════
//  Un pago no entra en la cuenta corriente de otra empresa cliente
//
//  El agujero tenia dos mitades y hacia falta cerrar las dos:
//
//   1. `POST /api/suppliers/:id/payments` creaba el movimiento sin comprobar
//      que el proveedor fuera de la empresa de quien lo mandaba. La fila salia
//      con el empresa_id del atacante, asi que revisando la tabla no se ve
//      nada raro.
//   2. Los include de `GET /api/suppliers` y `GET /api/suppliers/:id` traian
//      los movimientos sin `where: { empresa_id }`. Sequelize une por
//      supplier_id y nada mas, con lo cual ese movimiento aparecia en la
//      cuenta corriente del proveedor de la OTRA empresa y le movia el saldo.
//
//  Cerrar solo una deja el otro camino abierto para el proximo endpoint que se
//  agregue, asi que hay pruebas de las dos.
//
//  El mismo par existia en `POST /api/suppliers/:id/orders`, que escribe a
//  traves de purchaseService.createOrder.
//
//  Los dobles de `helpers/modelosFalsos` reproducen lo unico de Sequelize que
//  importa aca: que un include une por la clave foranea y aplica ademas el
//  `where` del include si lo hay. Con eso la prueba distingue el codigo con el
//  filtro del codigo sin el, que es lo que tiene que distinguir.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const { crearModelo, coincide } = require('./helpers/modelosFalsos');

const PROPIA = 7;
const AJENA = 9;

/**
 * Los hijos que Sequelize devolveria para este padre.
 *
 * La union es SIEMPRE por supplier_id —eso es lo que hace Sequelize con un
 * hasMany— y el where del include se aplica ademas. Si la ruta no manda where,
 * entran todos los hijos, sean de la empresa que sean: exactamente el defecto.
 */
function hijosDe(modeloHijo, padre, inc = {}) {
  return modeloHijo.filas.filter(
    (f) => f.supplier_id === padre.id && coincide(f, inc.where || {})
  );
}

const mockSupplierMovement = crearModelo([]);
const mockSupplierDocument = crearModelo([]);
const mockSupplierOrder = crearModelo([]);
const mockStock = crearModelo([]);
const mockProduct = crearModelo([]);
const mockSupplier = crearModelo([], {
  movements: (fila, inc) => hijosDe(mockSupplierMovement, fila, inc),
  documents: (fila, inc) => hijosDe(mockSupplierDocument, fila, inc),
  orders: (fila, inc) => hijosDe(mockSupplierOrder, fila, inc),
});

/**
 * La otra regla de Sequelize que hay que reproducir: un include con `where`
 * pasa a INNER JOIN salvo que diga `required: false`, y entonces el padre que
 * no tiene hijos que coincidan DESAPARECE del resultado.
 *
 * Sin esto, la prueba no distinguiria el filtro bien puesto del filtro que
 * arregla la fuga y de paso borra de la pantalla a todo proveedor sin
 * movimientos.
 */
function aplicarJoinInterno(filas, opciones = {}) {
  const incluye = opciones.include || [];
  return filas.filter((fila) =>
    incluye.every((inc) =>
      !inc.where || inc.required === false || ((fila[inc.as] || []).length > 0)));
}

for (const doble of [mockSupplier]) {
  const findAll = doble.findAll.bind(doble);
  const findOne = doble.findOne.bind(doble);

  doble.findAll = async (opciones = {}) => aplicarJoinInterno(await findAll(opciones), opciones);
  doble.findOne = async (opciones = {}) => {
    const fila = await findOne(opciones);
    return fila && aplicarJoinInterno([fila], opciones).length ? fila : null;
  };
}

// findScoped normaliza el id contra la clave primaria del modelo. Los dobles
// tienen que decir que es un INTEGER, si no un id que llega como '10' en la
// URL no coincidiria nunca con el 10 del array y todo daria 404 —incluido el
// caso legitimo, que es como una prueba de aislamiento pasa por el motivo
// equivocado—.
for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

jest.mock('../models', () => ({
  Supplier: mockSupplier,
  SupplierMovement: mockSupplierMovement,
  SupplierDocument: mockSupplierDocument,
  SupplierOrder: mockSupplierOrder,
  Stock: mockStock,
  Product: mockProduct,
  sequelize: { transaction: jest.fn() },
}));

const purchaseService = require('../services/purchaseService');

function levantarApi(empresaId) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.id = 'req-de-prueba';
    siguiente();
  });
  api.use('/api/suppliers', require('../routes/suppliers'));
  return api;
}

beforeEach(() => {
  mockSupplier.filas = [
    { id: 10, empresa_id: PROPIA, name: 'Molino Norte' },
    { id: 20, empresa_id: AJENA, name: 'Distribuidora Sur' },
  ];
  mockSupplierMovement.filas = [];
  mockSupplierDocument.filas = [];
  mockSupplierOrder.filas = [];

  for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
    doble.llamadas = [];
  }
});

describe('POST /api/suppliers/:id/payments', () => {
  it('NO registra un pago contra un proveedor de otra empresa', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/20/payments')
      .send({ date: '2026-07-31', amount: 1000, payment_method: 'transferencia' });

    expect(res.status).toBe(404);
    expect(mockSupplierMovement.filas).toEqual([]);
  });

  it('responde 404 y no 403: un 403 confirmaria que ese proveedor existe', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/20/payments')
      .send({ date: '2026-07-31', amount: 1000 });

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    // Y el mensaje es el mismo que el de un id que no existe en ningun lado.
    const inexistente = await request(levantarApi(PROPIA))
      .post('/api/suppliers/99999/payments')
      .send({ date: '2026-07-31', amount: 1000 });

    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toBe(res.body.error);
  });

  it('sigue registrando el pago cuando el proveedor SI es de la empresa', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/payments')
      .send({ date: '2026-07-31', amount: 1500, payment_method: 'efectivo' });

    expect(res.status).toBe(201);
    expect(mockSupplierMovement.filas).toHaveLength(1);
    expect(mockSupplierMovement.filas[0]).toMatchObject({
      supplier_id: 10,
      empresa_id: PROPIA,
      type: 'pago',
      amount: 1500,
    });
  });
});

describe('POST /api/suppliers/:id/orders', () => {
  it('NO crea una orden de compra contra un proveedor de otra empresa', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/20/orders')
      .send({ date: '2026-07-31', items: [{ product_name: 'Harina', quantity: 2, unit_price: 100 }] });

    expect(res.status).toBe(404);
    expect(mockSupplierOrder.filas).toEqual([]);
  });

  it('sigue creando la orden cuando el proveedor SI es de la empresa', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/orders')
      .send({ date: '2026-07-31', items: [{ product_name: 'Harina', quantity: 2, unit_price: 100 }] });

    expect(res.status).toBe(201);
    expect(mockSupplierOrder.filas).toHaveLength(1);
    expect(mockSupplierOrder.filas[0]).toMatchObject({ supplier_id: 10, empresa_id: PROPIA, total: 200 });
  });
});

describe('La cuenta corriente no muestra movimientos de otra empresa', () => {
  // Este es el escenario completo: la empresa AJENA logro colgar un pago del
  // proveedor 10, que es de la empresa PROPIA. Aunque la escritura ya no se
  // pueda hacer por la API, la fila puede existir de antes —el bug estuvo
  // abierto— y el include tiene que dejarla afuera igual.
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: 5000, date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: AJENA, type: 'pago', amount: 4000, date: '2026-07-15' },
    ];
    mockSupplierDocument.filas = [
      { id: 1, supplier_id: 10, empresa_id: AJENA, name: 'factura-ajena.pdf' },
    ];
    mockSupplierOrder.filas = [
      { id: 1, supplier_id: 10, empresa_id: AJENA, total: 9999, date: '2026-07-10' },
    ];
  });

  it('GET /api/suppliers/:id NO trae el pago inyectado desde otra empresa', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/10');

    expect(res.status).toBe(200);
    expect(res.body.data.movements.map((m) => m.id)).toEqual([1]);
    // El saldo se calcula con estos movimientos: con el ajeno adentro, la deuda
    // de 5000 pasaba a 1000 y el proveedor parecia casi cancelado.
    const saldo = res.body.data.movements.reduce(
      (acc, m) => acc + (m.type === 'deuda' ? m.amount : -m.amount), 0
    );
    expect(saldo).toBe(5000);
  });

  it('GET /api/suppliers/:id NO trae documentos ni ordenes de otra empresa', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/10');

    expect(res.body.data.documents).toEqual([]);
    expect(res.body.data.orders).toEqual([]);
  });

  it('GET /api/suppliers tampoco los trae en el listado', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers');

    expect(res.status).toBe(200);
    const propio = res.body.data.find((s) => s.id === 10);
    expect(propio.movements.map((m) => m.id)).toEqual([1]);
    expect(propio.documents).toEqual([]);
  });

  it('el listado sigue mostrando a los proveedores sin movimientos', async () => {
    // El `where` del include convierte el LEFT JOIN en INNER JOIN salvo que se
    // ponga `required: false`. Sin eso, filtrar por empresa hace desaparecer a
    // todo proveedor que todavia no tenga movimientos: se arregla la fuga y se
    // rompe la pantalla.
    mockSupplier.filas.push({ id: 11, empresa_id: PROPIA, name: 'Proveedor nuevo' });

    const res = await request(levantarApi(PROPIA)).get('/api/suppliers');

    expect(res.body.data.map((s) => s.id)).toContain(11);
  });

  it('la ficha de un proveedor sin movimientos sigue abriendo', async () => {
    mockSupplier.filas.push({ id: 11, empresa_id: PROPIA, name: 'Proveedor nuevo' });

    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/11');

    expect(res.status).toBe(200);
    expect(res.body.data.movements).toEqual([]);
  });
});

describe('purchaseService no contesta sin saber de que empresa', () => {
  it('getOrders sin empresa resuelta falla en vez de devolver las de todas', async () => {
    // Con `if (empresa_id)`, una llamada sin empresa devolvia las ordenes de
    // TODAS las empresas cliente, paginadas y con el nombre del proveedor.
    await expect(purchaseService.getOrders({ status: 'pending' }))
      .rejects.toThrow(/Scoping por empresa invalido/);

    expect(mockSupplierOrder.llamadas).toEqual([]);
  });

  it('getOrders con empresa acota el where a esa empresa', async () => {
    mockSupplierOrder.findAndCountAll = async (opciones = {}) => {
      mockSupplierOrder.llamadas.push({ metodo: 'findAndCountAll', ...opciones });
      return { count: 0, rows: [] };
    };

    await purchaseService.getOrders({ empresa_id: PROPIA });

    expect(mockSupplierOrder.llamadas[0].where).toMatchObject({ empresa_id: PROPIA });
  });

  it('cancelOrder sin empresa resuelta falla antes de tocar la orden', async () => {
    await expect(purchaseService.cancelOrder(1, undefined))
      .rejects.toThrow(/Scoping por empresa invalido/);

    expect(mockSupplierOrder.llamadas).toEqual([]);
  });

  it('getOrderDetail sin empresa resuelta falla antes de tocar la orden', async () => {
    await expect(purchaseService.getOrderDetail(1, undefined))
      .rejects.toThrow(/Scoping por empresa invalido/);

    expect(mockSupplierOrder.llamadas).toEqual([]);
  });
});

describe('El cuerpo del request no elige la empresa', () => {
  it('POST /:id/documents ignora el empresa_id y el supplier_id que vengan en el cuerpo', async () => {
    // El spread `...req.body` iba DESPUES de las claves de scoping y las
    // pisaba: el documento terminaba en la empresa que dijera el cliente.
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/documents')
      .send({ name: 'remito.pdf', empresa_id: AJENA, supplier_id: 20 });

    expect(res.status).toBe(201);
    expect(mockSupplierDocument.filas[0]).toMatchObject({
      supplier_id: 10,
      empresa_id: PROPIA,
      name: 'remito.pdf',
    });
  });

  it('PUT /:id no mueve el proveedor a otra empresa', async () => {
    const res = await request(levantarApi(PROPIA))
      .put('/api/suppliers/10')
      .send({ name: 'Molino Norte SA', empresa_id: AJENA });

    expect(res.status).toBe(200);
    expect(mockSupplier.filas.find((s) => s.id === 10)).toMatchObject({
      empresa_id: PROPIA,
      name: 'Molino Norte SA',
    });
  });
});
