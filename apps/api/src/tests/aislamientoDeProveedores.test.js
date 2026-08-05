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
  mockProduct.filas = [
    { id: 501, empresa_id: PROPIA, name: 'Harina propia', cost: 100 },
    { id: 900, empresa_id: AJENA, name: 'Insumo de otro cliente', cost: 50 },
  ];

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

  // ── FR-062: los productos del detalle también son de la empresa ──
  //
  // `dfd7009` cerró el proveedor; el detalle quedó abierto. Se guardaba
  // `item.product_id || null` sin mirar nada, así que una empresa podía dejar en
  // su propio `detail` una línea que apunta al producto de otro cliente. La
  // consecuencia se ve al recibir: el `Stock.findOne` lleva empresa_id, así que
  // no encuentra la fila del otro, pero el `Stock.create` **crea una fila de
  // stock propia para un producto ajeno**.
  it('NO crea una orden con el producto de otra empresa en el detalle', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/orders')
      .send({
        date: '2026-07-31',
        items: [
          { product_id: 501, product_name: 'Harina propia', quantity: 2, unit_price: 100 },
          { product_id: 900, product_name: 'Insumo de otro cliente', quantity: 1, unit_price: 50 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Insumo de otro cliente');
    // Y no quedó ninguna orden: un error que llega DESPUÉS del create es una
    // orden fantasma con una línea ajena adentro.
    expect(mockSupplierOrder.filas).toEqual([]);
  });

  it('el mensaje nombra los productos ajenos y no los propios', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/orders')
      .send({
        date: '2026-07-31',
        items: [
          { product_id: 501, product_name: 'Harina propia', quantity: 2, unit_price: 100 },
          { product_id: 900, product_name: 'Insumo de otro cliente', quantity: 1, unit_price: 50 },
        ],
      });

    expect(res.body.error).not.toContain('Harina propia');
  });

  it('sigue creando la orden cuando todos los productos son propios', async () => {
    // Sin esto la validación podría estar fallando siempre, que es tan inútil
    // como no validar nada.
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/orders')
      .send({
        date: '2026-07-31',
        items: [{ product_id: 501, product_name: 'Harina propia', quantity: 2, unit_price: 100 }],
      });

    expect(res.status).toBe(201);
    expect(mockSupplierOrder.filas).toHaveLength(1);
    expect(mockSupplierOrder.filas[0].detail[0].product_id).toBe(501);
  });

  it('una línea sin producto —un flete— sigue siendo válida', async () => {
    const res = await request(levantarApi(PROPIA))
      .post('/api/suppliers/10/orders')
      .send({
        date: '2026-07-31',
        items: [{ product_name: 'Flete', quantity: 1, unit_price: 9000 }],
      });

    expect(res.status).toBe(201);
    expect(mockSupplierOrder.filas[0].detail[0].product_id).toBeNull();
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

  it('GET /api/suppliers/:id NO cuenta el pago inyectado desde otra empresa', async () => {
    // Desde T1216 la ficha ya no devuelve los movimientos: devuelve el saldo. La
    // fuga es la misma —con el pago ajeno adentro, la deuda de 5000 pasaba a
    // 1000 y el proveedor parecia casi cancelado— y lo que la cierra ahora es el
    // `empresa_id` del `where` de la consulta agregada.
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/10');

    expect(res.status).toBe(200);
    expect(res.body.data.saldo).toBe(5000);
    expect(res.body.data).not.toHaveProperty('movements');
  });

  it('GET /api/suppliers/:id NO trae documentos de otra empresa', async () => {
    // El de documentos es el unico include de hijo que sobrevive en el archivo,
    // asi que su `where` es el unico que sigue sosteniendo esta prueba.
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/10');

    expect(res.body.data.documents).toEqual([]);
    // Las ordenes salen de GET /api/suppliers/orders?supplier_id=, que ya exige
    // ordenes_compra.ver: la ficha no las devuelve mas.
    expect(res.body.data).not.toHaveProperty('orders');
  });

  it('GET /api/suppliers tampoco los cuenta en el saldo del listado', async () => {
    // Desde T1215 el listado ya no devuelve los movimientos: devuelve el saldo
    // hecho. La fuga que había que cerrar es la misma —un pago de la empresa
    // AJENA colgado de un proveedor PROPIO no puede mover ese saldo— pero lo
    // que la cierra cambió de lugar: antes era el `where` del include, ahora es
    // el `where` de la consulta agregada.
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers');

    expect(res.status).toBe(200);
    const propio = res.body.data.find((s) => s.id === 10);

    // Con el pago ajeno adentro, la deuda de 5000 pasaba a 1000 y el proveedor
    // parecia casi cancelado.
    expect(propio.saldo).toBe(5000);
    expect(propio.movimientos).toBe(1);
    expect(propio.documentos).toBe(0);
    expect(propio).not.toHaveProperty('movements');
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
    expect(res.body.data.saldo).toBe(0);
    expect(res.body.data.documents).toEqual([]);
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

  it('el nombre del proveedor del listado sale de un include acotado a la empresa', async () => {
    // FR-067. El include unia por supplier_id y nada mas: `supplier_name` podia
    // venir del proveedor de otro cliente.
    mockSupplierOrder.findAndCountAll = async (opciones = {}) => {
      mockSupplierOrder.llamadas.push({ metodo: 'findAndCountAll', ...opciones });
      return { count: 0, rows: [] };
    };

    await purchaseService.getOrders({ empresa_id: PROPIA });

    const include = mockSupplierOrder.llamadas[0].include[0];
    expect(include.where).toMatchObject({ empresa_id: PROPIA });
  });

  it('el listado sigue mostrando órdenes de un proveedor que ya no está', async () => {
    // Lo que protege el `required: false`. Sequelize convierte el include en
    // INNER JOIN apenas ve un `where`: sin él, las órdenes cuyo proveedor se
    // borró desaparecen del listado, el total las sigue contando, y la pantalla
    // muestra menos filas de las que dice tener.
    mockSupplierOrder.findAndCountAll = async (opciones = {}) => {
      mockSupplierOrder.llamadas.push({ metodo: 'findAndCountAll', ...opciones });
      return { count: 0, rows: [] };
    };

    await purchaseService.getOrders({ empresa_id: PROPIA });

    expect(mockSupplierOrder.llamadas[0].include[0].required).toBe(false);
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

describe('Los filtros del listado no rompen el listado en silencio', () => {
  // `<SelectItem value=" ">` —un espacio— es el valor centinela con el que la
  // pantalla dice «Todos». `if (supplier_id)` lo daba por verdadero, salía
  // `?supplier_id=%20`, y ese espacio llegaba a una columna INTEGER: Postgres
  // respondía `invalid input syntax for type integer`, subía como 500, y el
  // catch de la pantalla hacía console.error. **La lista quedaba con lo anterior
  // y sin ningún aviso**: volver a «Todos» después de filtrar no volvía a
  // «Todos», rompía.
  beforeEach(() => {
    mockSupplierOrder.findAndCountAll = async (opciones = {}) => {
      mockSupplierOrder.llamadas.push({ metodo: 'findAndCountAll', ...opciones });
      return { count: 0, rows: [] };
    };
  });

  it('getOrders con supplier_id de un espacio responde 400 y no un 500 de Postgres', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/orders?supplier_id=%20');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FILTRO_INVALIDO');
    // Y ni siquiera se consultó: el valor malo no llegó a la base.
    expect(mockSupplierOrder.llamadas).toEqual([]);
  });

  it('un status inventado responde 400 y no devuelve la lista entera', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/orders?status=recibida');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FILTRO_INVALIDO');
    expect(res.body.message).toContain('pending');
    expect(mockSupplierOrder.llamadas).toEqual([]);
  });

  it('una fecha con forma inválida responde 400', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/orders?from=31/07/2026');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FILTRO_INVALIDO');
  });

  it('la ausencia del parámetro es «todos», y no falla', async () => {
    // Es la corrección de fondo del lado del servidor: sin el parámetro no hay
    // filtro. Sin este caso, la validación podría estar rechazando siempre.
    const res = await request(levantarApi(PROPIA)).get('/api/suppliers/orders');

    expect(res.status).toBe(200);
    expect(mockSupplierOrder.llamadas[0].where).toEqual({ empresa_id: PROPIA });
  });

  it('los filtros válidos siguen filtrando', async () => {
    const res = await request(levantarApi(PROPIA))
      .get('/api/suppliers/orders?supplier_id=10&status=pending&from=2026-07-01&to=2026-07-31');

    expect(res.status).toBe(200);
    expect(mockSupplierOrder.llamadas[0].where).toMatchObject({
      empresa_id: PROPIA, supplier_id: 10, status: 'pending',
    });
  });

  it('limit=999999 NO pide la tabla entera', async () => {
    await request(levantarApi(PROPIA)).get('/api/suppliers/orders?limit=999999');

    expect(mockSupplierOrder.llamadas[0].limit).toBe(200);
  });

  it('un limit razonable se respeta, y uno absurdo no da cero', async () => {
    await request(levantarApi(PROPIA)).get('/api/suppliers/orders?limit=25');
    expect(mockSupplierOrder.llamadas[0].limit).toBe(25);

    mockSupplierOrder.llamadas = [];
    await request(levantarApi(PROPIA)).get('/api/suppliers/orders?limit=-5');
    expect(mockSupplierOrder.llamadas[0].limit).toBe(50);
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
