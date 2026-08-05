// ════════════════════════════════════════════
//  Recibir la orden #118 marca la #118, y ninguna otra
//
//  El defecto era de identidad y era silencioso. `receiveOrder` resolvía la
//  línea con `detail.find((d) => d.product_id === received.product_id)`:
//
//   - dos líneas del mismo producto compartían una sola línea alcanzable;
//   - la deuda se creaba con el `unit_price` de la línea que matcheó, que puede
//     ser de otra orden y de otro precio;
//   - una línea sin `product_id` llegaba al `Stock.create` con `product_id`
//     nulo, chocaba contra la columna y **revertía la transacción entera**: no
//     entraba nada, ni de las otras líneas;
//   - y los cinco `throw new Error` del servicio salían como 500 «Error al
//     recibir la orden de compra», así que «La orden ya fue recibida completa»
//     no llegaba nunca.
//
//  Todo eso mientras la pantalla decía «Mercadería recibida».
//
//  ⚠ Los dobles de `helpers/modelosFalsos` no entienden transacciones: no hay
//  rollback. Por eso las afirmaciones de «no entró nada» miran que la escritura
//  no se haya intentado, que es más fuerte: el código clasifica las líneas
//  ANTES de tocar stock, así que el rechazo ocurre antes de la primera
//  escritura y no depende de que la base deshaga nada.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const { crearModelo } = require('./helpers/modelosFalsos');

const PROPIA = 7;
const AJENA = 9;

const mockSupplier = crearModelo([]);
const mockSupplierOrder = crearModelo([]);
const mockSupplierMovement = crearModelo([]);
const mockStock = crearModelo([]);
const mockProduct = crearModelo([]);
const mockPuntoDeVenta = crearModelo([]);
const mockEmpresa = crearModelo([]);
const mockRecipe = crearModelo([]);
const mockRecipeItem = crearModelo([], {
  recipe: (fila) => mockRecipe.filas.find((r) => r.id === fila.recipe_id) || null,
});
const mockProductCostHistory = crearModelo([]);
const mockSupplierDocument = crearModelo([]);

// `costService.recalculateCascadingCosts` recorre recetas de verdad y no es lo
// que este archivo verifica: lo que se verifica es que **se llame**, con la
// transacción y el `visited` que corta ciclos. El doble anota las llamadas y
// mueve el costo del elaborado, que es el efecto observable.
const recosteosPedidos = [];

jest.mock('../services/costService', () => ({
  recalculateCascadingCosts: jest.fn(async (productId, visited, transaction) => {
    recosteosPedidos.push({ productId, visited, transaction });
    const elaborado = mockProduct.filas.find((p) => p.id === productId);
    if (elaborado) elaborado.cost = Number(elaborado.cost) + 300;
  }),
}));

// El id de la orden llega de la URL como string. Contra Postgres la columna es
// INTEGER y el driver castea; el doble compara con === y no lo haría, así que
// una prueba que pasa por HTTP daría 404 por el motivo equivocado.
const findOneOrden = mockSupplierOrder.findOne.bind(mockSupplierOrder);

mockSupplierOrder.findOne = async (opciones = {}) => {
  const where = { ...opciones.where };
  if (typeof where.id === 'string') where.id = parseInt(where.id, 10);

  const instancia = await findOneOrden({ ...opciones, where });
  if (!instancia) return null;

  const fila = mockSupplierOrder.filas.find((f) => f.id === instancia.id);

  // `save` y `changed` no están en los dobles: los agrega este archivo porque
  // lo que se verifica es que el detalle se persista.
  instancia.changed = () => {};
  instancia.save = async () => {
    fila.detail = instancia.detail;
    fila.status = instancia.status;
    return instancia;
  };

  return instancia;
};

for (const doble of [mockSupplier, mockSupplierOrder, mockProduct, mockPuntoDeVenta]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

jest.mock('../models', () => ({
  Supplier: mockSupplier,
  SupplierOrder: mockSupplierOrder,
  SupplierMovement: mockSupplierMovement,
  SupplierDocument: mockSupplierDocument,
  Stock: mockStock,
  Product: mockProduct,
  PuntoDeVenta: mockPuntoDeVenta,
  Empresa: mockEmpresa,
  RecipeItem: mockRecipeItem,
  Recipe: mockRecipe,
  ProductCostHistory: mockProductCostHistory,
  // Sin transacción de verdad: se ejecuta el callback y se deja subir lo que
  // tire, que es lo que hace falta para mirar el status de la respuesta.
  sequelize: { transaction: (cb) => cb({ LOCK: { UPDATE: 'UPDATE' } }) },
}));

const purchaseService = require('../services/purchaseService');

function levantarApi(empresaId = PROPIA) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.id = 'req-de-prueba';

    // La cabecera `X-Punto-De-Venta-Id` se resuelve igual que en
    // `middleware/auth.js:311-327`: se acepta solo si ese punto de venta es de
    // la empresa activa y está activo, y si no, se ignora. Se reproduce acá en
    // vez de montar el middleware real porque ese arrastra Auth0 y la carga de
    // permisos; que auth.js siga resolviéndola contra la empresa lo cuida su
    // propia guardia en `aislamientoEmpresas.test.js`.
    const pedido = parseInt(req.headers['x-punto-de-venta-id'], 10);
    const sucursal = mockPuntoDeVenta.filas.find(
      (pv) => pv.id === pedido && pv.empresa_id === empresaId && pv.is_active
    );

    if (sucursal) req.puntoDeVentaId = sucursal.id;

    siguiente();
  });
  api.use('/api/suppliers', require('../routes/suppliers'));
  return api;
}

/** Colágeno en la posición 0 y otra vez en la 2, con precios distintos. */
const detalleConRepetido = () => [
  { product_id: 41, product_name: 'Colágeno 300g', quantity: 12, unit_price: 900, quantity_received: 0 },
  { product_id: 55, product_name: 'Creatina 500g', quantity: 4, unit_price: 8000, quantity_received: 0 },
  { product_id: 41, product_name: 'Colágeno 300g', quantity: 10, unit_price: 1500, quantity_received: 0 },
];

beforeEach(() => {
  mockSupplier.filas = [{ id: 10, empresa_id: PROPIA, name: 'Nutrifit' }];
  mockSupplierOrder.filas = [];
  mockSupplierMovement.filas = [];
  mockStock.filas = [];
  mockRecipeItem.filas = [];
  mockRecipe.filas = [];
  mockProductCostHistory.filas = [];
  recosteosPedidos.length = 0;
  mockProduct.filas = [
    { id: 41, empresa_id: PROPIA, name: 'Colágeno 300g', cost: 900 },
    { id: 55, empresa_id: PROPIA, name: 'Creatina 500g', cost: 7000 },
    { id: 99, empresa_id: AJENA, name: 'Producto de otro cliente', cost: 100 },
  ];
  mockPuntoDeVenta.filas = [
    { id: 1, empresa_id: PROPIA, code: 'principal', name: 'Principal', is_active: true },
  ];
  mockEmpresa.filas = [{ id: PROPIA, timezone: 'America/Argentina/Buenos_Aires' }];

  for (const doble of [mockSupplier, mockSupplierOrder, mockSupplierMovement, mockStock, mockProduct]) {
    doble.llamadas = [];
  }
});

describe('La recepción se aplica a la orden que se abrió', () => {
  beforeEach(() => {
    // Dos órdenes pendientes del mismo proveedor que comparten producto y lo
    // valoran distinto. Es el escenario de la spec: la #112 se cargó primero.
    mockSupplierOrder.filas = [
      {
        id: 112, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-01',
        detail: [
          { product_id: 41, product_name: 'Colágeno 300g', quantity: 20, unit_price: 900, quantity_received: 0 },
        ],
      },
      {
        id: 118, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
        detail: [
          { product_id: 41, product_name: 'Colágeno 300g', quantity: 20, unit_price: 1500, quantity_received: 0 },
        ],
      },
    ];
  });

  it('recibir la orden #118 NO marca la #112', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/118/receive')
      .send({ items: [{ linea: 0, cantidad: 10 }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 118, status: 'partial' });

    const ciento12 = mockSupplierOrder.filas.find((o) => o.id === 112);
    const ciento18 = mockSupplierOrder.filas.find((o) => o.id === 118);

    expect(ciento18.detail[0].quantity_received).toBe(10);
    expect(ciento12.status).toBe('pending');
    expect(ciento12.detail[0].quantity_received).toBeFalsy();
  });

  it('la deuda usa el unit_price de la orden que se recibió', async () => {
    await request(levantarApi())
      .put('/api/suppliers/orders/118/receive')
      .send({ items: [{ linea: 0, cantidad: 10 }] });

    expect(mockSupplierMovement.filas).toHaveLength(1);
    // 10 × 1500, el precio de la #118. Con el `find` viejo la cantidad caía en
    // la #112 y la deuda salía por 10 × 900 = 9000: un importe que nadie acordó.
    expect(mockSupplierMovement.filas[0]).toMatchObject({
      supplier_id: 10,
      empresa_id: PROPIA,
      type: 'deuda',
      amount: 15000,
    });
  });

  it('sale UNA sola llamada y el movimiento nombra la orden que se recibió', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/118/receive')
      .send({ items: [{ linea: 0, cantidad: 10 }] });

    expect(res.body.data.recibido).toHaveLength(1);
    expect(mockSupplierMovement.filas[0].notes).toContain('#118');
    expect(mockSupplierMovement.filas[0].notes).not.toContain('#112');
  });
});

describe('Dos líneas del mismo producto en la MISMA orden', () => {
  beforeEach(() => {
    mockSupplierOrder.filas = [{
      id: 200, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      detail: detalleConRepetido(),
    }];
  });

  it('recibir la línea 2 no toca la línea 0 del mismo producto', async () => {
    // El `product_id` viaja igual —la pantalla lo manda y el contrato lo
    // acepta— y **no** tiene que decidir nada: si la resolución vuelve a ser
    // por producto, las 10 unidades caen en la línea 0 y la deuda sale por
    // 10 × 900 en vez de 10 × 1500.
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/200/receive')
      .send({ items: [{ linea: 2, cantidad: 10, product_id: 41 }] });

    expect(res.status).toBe(200);

    const orden = mockSupplierOrder.filas[0];
    expect(orden.detail[2].quantity_received).toBe(10);
    expect(orden.detail[0].quantity_received).toBeFalsy();
    // 10 × 1500 y no 10 × 900.
    expect(mockSupplierMovement.filas[0].amount).toBe(15000);
  });

  it('el cuerpo viejo sobre una orden con dos líneas del mismo producto responde LINEA_REQUERIDA', async () => {
    // ⚠ Este caso perdió media afirmación en **T1239** y hay que decir por qué.
    // Hasta entonces el mensaje NOMBRABA el producto repetido —«la orden tiene
    // dos líneas de Colágeno 300g»— porque el rechazo dependía de que la orden
    // fuera ambigua, así que había que recorrer el detalle para decidirlo y de
    // ahí salía el nombre gratis. Desde T1239 `linea` es obligatorio SIEMPRE:
    // no hay ambigüedad que evaluar, no hay detalle que recorrer y no hay
    // producto que nombrar. Conservar el nombre exigiría dejar viva la búsqueda
    // de duplicados solo para redactar el mensaje de un camino que ninguna
    // pantalla ejercita.
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/200/receive')
      .send({ items: [{ product_id: 41, quantity_received: 10 }], location: 'general' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LINEA_REQUERIDA');
    // Y no entró nada: ni stock, ni deuda, ni cambio de estado.
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas).toEqual([]);
    expect(mockSupplierOrder.filas[0].status).toBe('pending');
  });
});

// ════════════════════════════════════════════
//  El respaldo del cuerpo viejo, borrado (T1239)
//
//  ⚠ **Este bloque cambió de signo.** Hasta T1238 afirmaba lo contrario: que un
//  cuerpo `{ product_id, quantity_received }` sobre una orden sin ambigüedad
//  «todavía funciona». Era cierto y era necesario **durante un solo corte**: el
//  corte 1 se desplegó antes que el rediseño de las dos pantallas, y un
//  navegador abierto desde antes del deploy seguía mandando esa forma. Sin el
//  respaldo, esa persona no podía recibir mercadería hasta recargar.
//
//  Con la pantalla nueva desplegada (T1237 y T1238) ya no hay quien lo mande, y
//  el camino se borra en vez de quedarse «por las dudas»: `{ product_id }` no
//  alcanza para distinguir dos líneas del mismo producto ni dos líneas sin
//  producto —es el camino ambiguo que este hito viene a cerrar— y **un camino
//  que nadie usa es un camino que nadie mira cuando cambia**.
// ════════════════════════════════════════════

describe('El cuerpo viejo ya no se acepta (T1239)', () => {
  beforeEach(() => {
    mockSupplierOrder.filas = [{
      id: 300, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      detail: [
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 12, unit_price: 1200, quantity_received: 0 },
        { product_id: 55, product_name: 'Creatina 500g', quantity: 4, unit_price: 8000, quantity_received: 0 },
      ],
    }];
  });

  it('el cuerpo viejo se rechaza aunque la orden no sea ambigua', async () => {
    // Dos productos distintos y ninguna línea sin producto: es exactamente el
    // caso que el respaldo aceptaba. Ahora responde 400 y **no escribe nada**.
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/300/receive')
      .send({ items: [{ product_id: 55, quantity_received: 4 }], location: 'general' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LINEA_REQUERIDA');

    const orden = mockSupplierOrder.filas[0];
    expect(orden.status).toBe('pending');
    expect(orden.detail[1].quantity_received).toBeFalsy();
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas).toEqual([]);
  });

  it('un cuerpo mixto —una línea con posición y otra sin— se rechaza entero', async () => {
    // Sin esta afirmación, la validación podría mirar «alguno trae línea» y el
    // ítem sin posición caería en `aplicarRecepcion` como LINEA_INEXISTENTE:
    // ese mensaje le dice al usuario que su detalle está viejo cuando lo que
    // está mal es el cuerpo que manda su pantalla. Y lo que importa más: no se
    // recibe la mitad de una recepción.
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/300/receive')
      .send({ items: [{ linea: 0, cantidad: 2 }, { product_id: 55, quantity_received: 4 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LINEA_REQUERIDA');
    expect(mockSupplierOrder.filas[0].detail[0].quantity_received).toBeFalsy();
  });

  it('el cuerpo por línea sigue devolviendo id y status', async () => {
    // La otra mitad, y sin ella los dos casos de arriba pasarían con un endpoint
    // que rechaza TODO. `data.id` y `data.status` son los dos campos que la
    // pantalla mira para decir qué pasó.
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/300/receive')
      .send({ items: [{ linea: 1, cantidad: 4 }] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toBe(300);
    expect(res.body.data.status).toBe('partial');

    const orden = mockSupplierOrder.filas[0];
    expect(orden.detail[1].quantity_received).toBe(4);
    expect(orden.detail[0].quantity_received).toBeFalsy();
    expect(mockSupplierMovement.filas[0].amount).toBe(32000);
  });
});

describe('Las líneas que no son un producto del catálogo', () => {
  beforeEach(() => {
    mockSupplierOrder.filas = [{
      id: 400, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      detail: [
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 2, unit_price: 1200, quantity_received: 0 },
        { product_id: null, product_name: 'Flete', quantity: 1, unit_price: 9000, quantity_received: 0 },
      ],
    }];
  });

  it('una línea sin product_id genera deuda, no toca stock y devuelve su aviso', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/400/receive')
      .send({ items: [{ linea: 0, cantidad: 2 }, { linea: 1, cantidad: 1 }] });

    expect(res.status).toBe(200);
    // La deuda incluye el flete: 2 × 1200 + 1 × 9000.
    expect(mockSupplierMovement.filas[0].amount).toBe(11400);
    // Y las OTRAS líneas entraron igual: hoy el Stock.create con product_id
    // nulo revierte la transacción entera y no entra nada.
    expect(mockStock.filas).toHaveLength(1);
    expect(mockStock.filas[0]).toMatchObject({ product_id: 41, quantity: 2 });
    expect(res.body.data.avisos.join(' ')).toContain('Flete');
    expect(res.body.data.avisos.join(' ')).toContain('no está en el catálogo');
  });

  it('un producto borrado del catálogo también genera deuda y no toca stock', async () => {
    mockSupplierOrder.filas[0].detail[1] = {
      product_id: 12345, product_name: 'Producto dado de baja', quantity: 1, unit_price: 500, quantity_received: 0,
    };

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/400/receive')
      .send({ items: [{ linea: 1, cantidad: 1 }] });

    expect(res.status).toBe(200);
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas[0].amount).toBe(500);
  });

  it('un product_id de otra empresa rechaza la recepción entera', async () => {
    mockSupplierOrder.filas[0].detail[1] = {
      product_id: 99, product_name: 'Producto de otro cliente', quantity: 1, unit_price: 500, quantity_received: 0,
    };

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/400/receive')
      .send({ items: [{ linea: 0, cantidad: 2 }, { linea: 1, cantidad: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no son de esta empresa/);
    // Ni siquiera la línea buena entró: el Stock.create habría creado una fila
    // de stock PROPIA para un producto ajeno.
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas).toEqual([]);
    expect(mockSupplierOrder.filas[0].status).toBe('pending');
  });

  it('el producto se resuelve acotado a la empresa y no por clave primaria', async () => {
    await request(levantarApi())
      .put('/api/suppliers/orders/400/receive')
      .send({ items: [{ linea: 0, cantidad: 2 }] });

    const lecturas = mockProduct.llamadas.filter((l) => l.metodo === 'findByPk');
    expect(lecturas).toEqual([]);

    const conEmpresa = mockProduct.llamadas.find(
      (l) => l.metodo === 'findAll' && l.where && l.where.empresa_id === PROPIA
    );
    expect(conEmpresa).toBeDefined();
  });
});

describe('Los errores de cuerpo se leen', () => {
  beforeEach(() => {
    mockSupplierOrder.filas = [{
      id: 500, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      detail: detalleConRepetido(),
    }];
  });

  it('un índice de línea que no existe responde LINEA_INEXISTENTE y no recibe nada', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/500/receive')
      .send({ items: [{ linea: 9, cantidad: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LINEA_INEXISTENTE');
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas).toEqual([]);
  });

  it('una línea que no es de ese producto responde LINEA_INCONSISTENTE', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/500/receive')
      .send({ items: [{ linea: 0, cantidad: 1, product_id: 55 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LINEA_INCONSISTENTE');
    expect(mockStock.filas).toEqual([]);
  });

  it('una orden de otra empresa responde 404 y no recibe nada', async () => {
    const res = await request(levantarApi(AJENA))
      .put('/api/suppliers/orders/500/receive')
      .send({ items: [{ linea: 0, cantidad: 1 }] });

    expect(res.status).toBe(404);
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas).toEqual([]);
  });
});

describe('La fecha del asiento la decide el servidor, en la zona del negocio', () => {
  // `new Date().toISOString().split('T')[0]` devuelve UTC. Argentina es UTC-3:
  // una recepción de las 21:30 del 31 de julio generaba un movimiento de deuda
  // fechado el **1 de agosto**, que se va al mes siguiente del estado de cuenta
  // y del archivo exportado. No falla nada, y por eso hace falta el test.
  //
  // La alternativa descartada —que el navegador mande la fecha— es la misma que
  // rechaza POST /api/sales: la fecha de un asiento la decide el servidor.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T00:30:00Z')); // 31/07 21:30 ART

    mockSupplierOrder.filas = [{
      id: 800, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      detail: [
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 2, unit_price: 1200, quantity_received: 0 },
      ],
    }];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('la deuda de una recepción de las 21:30 NO se fecha mañana', async () => {
    await purchaseService.receiveOrder(800, { items: [{ linea: 0, cantidad: 2 }] }, PROPIA);

    expect(mockSupplierMovement.filas).toHaveLength(1);
    expect(mockSupplierMovement.filas[0].date).toBe('2026-07-31');
    // Lo que devolvía la línea vieja, para que se vea la diferencia:
    expect(new Date().toISOString().split('T')[0]).toBe('2026-08-01');
  });

  it('la fecha por defecto de una orden nueva tampoco se corre un día', async () => {
    const orden = await purchaseService.createOrder(10, {
      items: [{ product_id: 41, product_name: 'Colágeno 300g', quantity: 2, unit_price: 1200 }],
    }, PROPIA);

    expect(orden.date).toBe('2026-07-31');
  });

  it('una fecha explícita del cuerpo se respeta', async () => {
    const orden = await purchaseService.createOrder(10, {
      date: '2026-06-15',
      items: [{ product_id: 41, product_name: 'Colágeno 300g', quantity: 1, unit_price: 100 }],
    }, PROPIA);

    expect(orden.date).toBe('2026-06-15');
  });
});

describe('Los cinco mensajes del servicio son para el usuario, no un 500', () => {
  // `fallo()` solo respeta `err.status` cuando `err.publico` es verdadero
  // (errores.js:60-73), y `ErrorDeNegocio` lo pone en true. Con `throw new
  // Error(...)` los cinco mensajes —los únicos que saben qué pasó— llegaban al
  // usuario como «Error al recibir la orden de compra», con 500.
  //
  // Es el caso de borde de la spec: «tiene que llegar como mensaje legible y no
  // como 500». Hasta este corte no se cumplía **ni siquiera** con la pantalla
  // corregida, porque el problema estaba del lado del servidor.
  beforeEach(() => {
    mockSupplierOrder.filas = [
      { id: 700, empresa_id: PROPIA, supplier_id: 10, status: 'received', date: '2026-07-01', detail: [] },
      { id: 701, empresa_id: PROPIA, supplier_id: 10, status: 'cancelled', date: '2026-07-01', detail: [] },
      { id: 702, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-01', detail: [] },
    ];
  });

  it('recibir una orden ya recibida devuelve 409 con su mensaje, no 500', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/700/receive')
      .send({ items: [{ linea: 0, cantidad: 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('La orden ya fue recibida completa');
    expect(res.body.error).not.toBe('Error al recibir la orden de compra');
  });

  it('recibir una orden anulada devuelve 409 con su mensaje, no 500', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/701/receive')
      .send({ items: [{ linea: 0, cantidad: 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('La orden está anulada');
  });

  it('recibir una orden que no existe devuelve 404 con su mensaje', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/99999/receive')
      .send({ items: [{ linea: 0, cantidad: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Orden no encontrada');
  });

  it('anular una orden ya recibida devuelve 409 y no 500', async () => {
    const res = await request(levantarApi()).put('/api/suppliers/orders/700/cancel');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('No se puede anular una orden ya recibida');
  });

  it('anular una orden ya anulada devuelve 409 y no 500', async () => {
    const res = await request(levantarApi()).put('/api/suppliers/orders/701/cancel');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('La orden ya está anulada');
  });

  it('el detalle de una orden que no existe devuelve 404 y no 500', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/orders/99999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Orden no encontrada');
  });

  it('anular una orden pendiente sigue funcionando', async () => {
    // Sin esto, la conversión podría estar haciendo fallar todo y los cinco
    // tests de arriba pasarían igual.
    const res = await request(levantarApi()).put('/api/suppliers/orders/702/cancel');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });
});

describe('Lo que entró de verdad, y lo que no entra', () => {
  beforeEach(() => {
    mockSupplierOrder.filas = [{
      id: 600, empresa_id: PROPIA, supplier_id: 10, status: 'partial', date: '2026-07-20',
      detail: [
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 12, unit_price: 1200, quantity_received: 8 },
      ],
    }];
  });

  it('la respuesta dice cuánto se cargó realmente cuando el servidor recorta', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/600/receive')
      .send({ items: [{ linea: 0, cantidad: 9 }] });

    expect(res.status).toBe(200);
    // FR-033: se escribieron 9, entraron 4.
    expect(res.body.data.recibido[0]).toMatchObject({
      linea: 0, pedido: 12, recibido_ahora: 4, recibido_total: 12, pendiente: 0,
    });
    expect(res.body.data.avisos.join(' ')).toContain('Colágeno 300g');
    expect(res.body.data.status).toBe('received');
    expect(mockSupplierMovement.filas[0].amount).toBe(4800);
  });

  it('una recepción de cero unidades no crea movimiento ni cambia el estado', async () => {
    // FR-037. La orden está en `pending`: sin la guarda, el estado se recalcula
    // igual y una orden en la que no llegó nada pasa a `partial`, que en la
    // pantalla se lee como «ya llegó parte».
    mockSupplierOrder.filas[0].status = 'pending';

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/600/receive')
      .send({ items: [{ linea: 0, cantidad: 0 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.deuda).toBeNull();
    expect(res.body.data.status).toBe('pending');
    expect(mockSupplierMovement.filas).toEqual([]);
    expect(mockSupplierOrder.filas[0].status).toBe('pending');
  });
});

describe('El costo se actualiza confirmando, y se propaga a las recetas', () => {
  // Comprar a $1.200 lo costeado a $900 dejaba el costo en $900: el margen del
  // POS, el punto de equilibrio del panel y el precio recomendado del
  // Comparador se calculaban sobre un número que dejó de ser cierto, y no
  // fallaba nada. La recepción de una orden de PRODUCCIÓN sí lo actualizaba.
  beforeEach(() => {
    // Colágeno (41) es insumo del Batido elaborado (70).
    mockProduct.filas.push({ id: 70, empresa_id: PROPIA, name: 'Batido proteico', cost: 5000 });
    mockRecipe.filas = [{ id: 1, product_id: 70 }];
    mockRecipeItem.filas = [{ id: 1, recipe_id: 1, ingredient_product_id: 41 }];

    mockSupplierOrder.filas = [{
      id: 1000, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      detail: [
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 10, unit_price: 1200, quantity_received: 0 },
      ],
    }];
  });

  it('recibir más caro NO deja el costo viejo cuando se aceptó la propuesta', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 10, actualizar_costo: true }] });

    expect(res.status).toBe(200);
    expect(mockProduct.filas.find((p) => p.id === 41).cost).toBe(1200);
    expect(res.body.data.costos).toEqual([
      expect.objectContaining({
        linea: 0, product_id: 41, costo_anterior: 900, costo_nuevo: 1200, aplicado: true,
      }),
    ]);

    // Y quedó en el historial con su motivo tipado.
    expect(mockProductCostHistory.filas).toHaveLength(1);
    expect(mockProductCostHistory.filas[0]).toMatchObject({
      product_id: 41,
      old_cost: 900,
      new_cost: 1200,
      reason: 'Actualización por recepción de compra',
      empresa_id: PROPIA,
    });
  });

  it('rechazar la propuesta NO escribe nada en el historial', async () => {
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 10, actualizar_costo: false }] });

    expect(res.status).toBe(200);
    expect(mockProduct.filas.find((p) => p.id === 41).cost).toBe(900);
    expect(mockProductCostHistory.filas).toEqual([]);
    expect(res.body.data.costos).toEqual([]);
    // Pero el stock sí entró: rechazar el costo no rechaza la mercadería.
    expect(mockStock.filas[0]).toMatchObject({ product_id: 41, quantity: 10 });
  });

  it('la casilla del cliente NO alcanza: el servidor reevalúa el umbral', async () => {
    // Menos de un centavo. La columna es DECIMAL(12,2) y no lo puede guardar:
    // una pantalla desactualizada no puede forzar una fila de historial que
    // dice que el costo pasó de 900,00 a 900,00.
    //
    // ⚠ 900,005 NO sirve para este caso: `aCentavos` redondea y medio centavo
    // se convierte en uno entero, así que sí supera el umbral. El umbral se
    // ejercita por debajo del redondeo.
    mockSupplierOrder.filas[0].detail[0].unit_price = 900.002;

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 10, actualizar_costo: true }] });

    expect(res.status).toBe(200);
    expect(mockProduct.filas.find((p) => p.id === 41).cost).toBe(900);
    expect(mockProductCostHistory.filas).toEqual([]);
    expect(res.body.data.costos).toEqual([]);
  });

  it('el elaborado NO se queda costeado con el insumo viejo', async () => {
    // Es el defecto 3 corrido un nivel: el insumo pasa a $1.200 y el producto
    // elaborado que lo usa sigue costeado con $900. El margen que muestra el
    // POS es mentira, y nada avisa.
    const antes = mockProduct.filas.find((p) => p.id === 70).cost;

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 10, actualizar_costo: true }] });

    expect(res.body.data.costos[0].recosteos).toBe(1);
    expect(recosteosPedidos.map((r) => r.productId)).toEqual([70]);
    expect(mockProduct.filas.find((p) => p.id === 70).cost).not.toBe(antes);
  });

  it('la cascada arranca con el insumo ya visitado, para cortar los ciclos', () => {
    // Sin el `visited` que arranca con el insumo, una receta que se usa a sí
    // misma como ingrediente entraría en recursión infinita dentro de la
    // transacción.
    return request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 10, actualizar_costo: true }] })
      .then(() => {
        expect(recosteosPedidos[0].visited.has(41)).toBe(true);
      });
  });

  it('la actualización, el historial y la cascada van en la MISMA transacción que el stock', () => {
    // Fuera de la transacción, un fallo posterior deja el costo cambiado y el
    // stock sin cargar: el producto queda costeado por una mercadería que nunca
    // entró.
    const fs = require('fs');
    const path = require('path');
    const fuente = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'purchaseService.js'),
      'utf8'
    );

    const bloque = fuente.slice(
      fuente.indexOf('await producto.update('),
      fuente.indexOf('costos.push(')
    );

    expect(bloque).toMatch(/producto\.update\(\{ cost: costoNuevo \}, \{ transaction: t \}\)/);
    expect(bloque).toMatch(/registrarCambioDeCosto\(\{[\s\S]*?transaction: t,[\s\S]*?\}\)/);
    expect(fuente).toMatch(/recostearDependientes\(producto\.id, t\)/);
  });

  it('la cascada recibe la transacción y no abre una conexión aparte', async () => {
    // Sin la transacción, `calculateProductCost` lee por otra conexión y, por
    // MVCC, ve los costos ANTERIORES al UPDATE que se acaba de hacer: el
    // recosteo sale igual al viejo y la propagación es un no-op.
    await request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 10, actualizar_costo: true }] });

    expect(recosteosPedidos[0].transaction).toBeDefined();
    expect(recosteosPedidos[0].transaction.LOCK).toBeDefined();
  });

  it('una línea sin producto del catálogo no intenta actualizar ningún costo', async () => {
    mockSupplierOrder.filas[0].detail = [
      { product_id: null, product_name: 'Flete', quantity: 1, unit_price: 9000, quantity_received: 0 },
    ];

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1000/receive')
      .send({ items: [{ linea: 0, cantidad: 1, actualizar_costo: true }] });

    expect(res.status).toBe(200);
    expect(res.body.data.costos).toEqual([]);
    expect(mockProductCostHistory.filas).toEqual([]);
  });
});

describe('El detalle de la orden dice qué línea es cuál y qué costo propone', () => {
  beforeEach(() => {
    mockSupplierOrder.filas = [{
      id: 900, empresa_id: PROPIA, supplier_id: 10, status: 'pending', date: '2026-07-20',
      total: 30800,
      detail: [
        // Mismo producto en 0 y en 2, con precios distintos.
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 12, unit_price: 1200, quantity_received: 0 },
        { product_id: null, product_name: 'Flete', quantity: 1, unit_price: 9000, quantity_received: 0 },
        { product_id: 41, product_name: 'Colágeno 300g', quantity: 5, unit_price: 900, quantity_received: 0 },
      ],
    }];
  });

  it('el detalle dice qué línea es cuál, y no obliga a contarlas', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i) => i.linea)).toEqual([0, 1, 2]);
  });

  it('la pantalla vieja sigue encontrando los campos que dibuja', async () => {
    // `PurchaseOrders.jsx` dibuja el formulario de recepción con
    // `item.product_name`, `item.quantity` y `item.quantity_received`, e indexa
    // por `item.product_id`. Los tres campos nuevos son aditivos: si el enriquecido
    // pisara los viejos, la pantalla vieja quedaría sin nombres ni cantidades
    // entre este corte y su reescritura.
    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.body.data.items[0]).toMatchObject({
      product_id: 41,
      product_name: 'Colágeno 300g',
      quantity: 12,
      unit_price: 1200,
      quantity_received: 0,
    });
  });

  it('una línea sin producto NO propone costo', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.body.data.items[1]).toMatchObject({
      product_id: null, costo_actual: null, propone_costo: false,
    });
  });

  it('un producto borrado del catálogo tampoco propone costo', async () => {
    mockSupplierOrder.filas[0].detail[1] = {
      product_id: 12345, product_name: 'Dado de baja', quantity: 1, unit_price: 500, quantity_received: 0,
    };

    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.body.data.items[1]).toMatchObject({ costo_actual: null, propone_costo: false });
  });

  it('propone el costo cuando el precio de compra difiere del costo cargado', async () => {
    // Colágeno está costeado a $900. La línea 0 se compró a $1.200 —propone— y
    // la línea 2 a $900, que es el costo de hoy —no propone—.
    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.body.data.items[0]).toMatchObject({ costo_actual: 900, propone_costo: true });
    expect(res.body.data.items[2]).toMatchObject({ costo_actual: 900, propone_costo: false });
  });

  it('un producto sin costo cargado SÍ propone', async () => {
    // `Product.cost` es 0 por defecto, y esCambioSignificativo(0, 1200) es
    // verdadero: una compra de un producto que nunca tuvo costo es justamente
    // el caso donde hay que proponerlo.
    mockProduct.filas.find((p) => p.id === 41).cost = 0;

    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.body.data.items[0]).toMatchObject({ costo_actual: 0, propone_costo: true });
  });

  it('el costo_actual sale de findScoped y no de findByPk', async () => {
    await request(levantarApi()).get('/api/suppliers/orders/900');

    // findScoped arma un findOne con id + empresa_id. Un findByPk devolvería el
    // costo del producto de otro cliente.
    expect(mockProduct.llamadas.filter((l) => l.metodo === 'findByPk')).toEqual([]);

    const conEmpresa = mockProduct.llamadas.filter(
      (l) => l.metodo === 'findOne' && l.where && l.where.empresa_id === PROPIA
    );
    expect(conEmpresa.length).toBeGreaterThan(0);
  });

  it('el costo de un producto de otra empresa NO se muestra', async () => {
    mockSupplierOrder.filas[0].detail[0] = {
      product_id: 99, product_name: 'Producto de otro cliente', quantity: 1, unit_price: 500, quantity_received: 0,
    };

    const res = await request(levantarApi()).get('/api/suppliers/orders/900');

    expect(res.body.data.items[0].costo_actual).toBeNull();
  });
});

describe('La sucursal donde entra la mercadería', () => {
  // US10. Hasta este corte la recepción caía SIEMPRE en la sucursal por defecto
  // de la empresa: recibir el camión en Ortiz obligaba a hacer una transferencia
  // después, y si nadie la hacía la mercadería figuraba en el local equivocado
  // sin que nada fallara.
  //
  // ⚠ La asimetría que ya costó un hito es descontar de una sucursal y
  // registrar en otra. Acá se evita igual que en POST /api/sales: la sucursal se
  // resuelve UNA vez antes del bucle, y esa misma ubicación es la que se usa
  // para BUSCAR la fila y para CREARLA. Por eso el primer test siembra una fila
  // en la sucursal por defecto: si la búsqueda mirara una sucursal y la
  // escritura otra, esa fila crecería.
  const ordenPendiente = (id) => ({
    id,
    empresa_id: PROPIA,
    supplier_id: 10,
    status: 'pending',
    date: '2026-07-20',
    detail: [
      { product_id: 41, product_name: 'Colágeno 300g', quantity: 10, unit_price: 1200, quantity_received: 0 },
    ],
  });

  beforeEach(() => {
    mockPuntoDeVenta.filas.push(
      { id: 2, empresa_id: PROPIA, code: 'ortiz', name: 'Sucursal Ortiz', is_active: true },
      // De OTRA empresa cliente: existe, y elegirlo tiene que no resolver.
      { id: 3, empresa_id: AJENA, code: 'ajena', name: 'Local de otro cliente', is_active: true }
    );
    mockPuntoDeVenta.llamadas = [];

    mockSupplierOrder.filas = [
      ordenPendiente(1300), ordenPendiente(1301), ordenPendiente(1302), ordenPendiente(1303),
    ];
  });

  it('el stock sube en la sucursal elegida y no en la por defecto', async () => {
    // Ya hay Colágeno cargado en la sucursal por defecto. Es la fila que NO se
    // tiene que tocar.
    mockStock.filas = [{
      id: 1,
      product_id: 41,
      empresa_id: PROPIA,
      punto_de_venta_id: 1,
      location: 'principal',
      quantity: 100,
      available: 100,
    }];

    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1300/receive')
      // `location` viaja y NO ubica nada (FR-104): la fila nueva tiene que
      // quedar en Ortiz, no en un lugar llamado «general».
      .send({ items: [{ linea: 0, cantidad: 10 }], punto_de_venta_id: 2, location: 'general' });

    expect(res.status).toBe(200);

    const enOrtiz = mockStock.filas.find((f) => f.punto_de_venta_id === 2);
    expect(enOrtiz).toMatchObject({
      product_id: 41,
      empresa_id: PROPIA,
      location: 'ortiz',
      quantity: 10,
      available: 10,
    });

    // Y la sucursal por defecto quedó exactamente como estaba.
    expect(mockStock.filas.find((f) => f.punto_de_venta_id === 1)).toMatchObject({
      quantity: 100,
      available: 100,
    });
  });

  it('sin punto_de_venta_id cae a la cabecera, y sin cabecera a la sucursal por defecto', async () => {
    // La pantalla vieja no manda sucursal en el cuerpo, y la que está abierta en
    // Ortiz manda la cabecera. Si el segundo escalón se perdiera, esa recepción
    // aterrizaría en la sucursal por defecto sin decirlo.
    await request(levantarApi())
      .put('/api/suppliers/orders/1301/receive')
      .set('X-Punto-De-Venta-Id', '2')
      .send({ items: [{ linea: 0, cantidad: 10 }] });

    expect(mockStock.filas).toEqual([
      expect.objectContaining({ product_id: 41, punto_de_venta_id: 2, quantity: 10 }),
    ]);

    mockStock.filas.length = 0;

    // Sin nada: la sucursal por defecto de la empresa, que es la de código
    // `principal`. Es el comportamiento de siempre y tiene que seguir siendo el
    // de una empresa de una sola sucursal, que es la mayoría.
    await request(levantarApi())
      .put('/api/suppliers/orders/1302/receive')
      .send({ items: [{ linea: 0, cantidad: 10 }] });

    expect(mockStock.filas).toEqual([
      expect.objectContaining({ product_id: 41, punto_de_venta_id: 1, quantity: 10 }),
    ]);
  });

  it('una sucursal de otra empresa no se puede elegir', async () => {
    // Lo garantiza `resolverSucursal` con findScoped, y no puede dejar de
    // garantizarlo: aceptar el id sin validarlo escribe mercadería propia en el
    // local de otro cliente, que es la fuga que cerró el hito 4.
    const res = await request(levantarApi())
      .put('/api/suppliers/orders/1303/receive')
      .send({ items: [{ linea: 0, cantidad: 10 }], punto_de_venta_id: 3 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Punto de venta inválido/);

    // Y no entró nada: ni la fila de stock, ni la deuda, ni el cambio de estado.
    expect(mockStock.filas).toEqual([]);
    expect(mockSupplierMovement.filas).toEqual([]);
    expect(mockSupplierOrder.filas.find((o) => o.id === 1303).status).toBe('pending');

    // findByPk devolvería el punto de venta ajeno tal cual: la sucursal se
    // resuelve acotada a la empresa o no se resuelve.
    expect(mockPuntoDeVenta.llamadas.filter((l) => l.metodo === 'findByPk')).toEqual([]);
  });
});

describe('Lo que receiveOrder ya resolvía y no puede volver', () => {
  const fs = require('fs');
  const path = require('path');

  const fuente = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'purchaseService.js'),
    'utf8'
  );

  it('la fila de stock se lee con lock y con empresa_id en el where', () => {
    // Sin el lock, dos recepciones simultáneas de la misma fila se pisan. Sin
    // empresa_id, la búsqueda encontraba —y le sumaba stock a— la fila de otra
    // empresa cliente.
    const bloque = fuente.slice(fuente.indexOf('const stock = await Stock.findOne'));

    expect(bloque.slice(0, 400)).toMatch(/empresa_id:\s*empresaId/);
    expect(bloque.slice(0, 400)).toMatch(/lock:\s*t\.LOCK\.UPDATE/);
  });

  it('el alta de stock lleva empresa_id y sucursal', () => {
    // Sin empresa_id, la fila caía en la empresa 1 por el default de la columna.
    const bloque = fuente.slice(fuente.indexOf('await Stock.create('));

    expect(bloque.slice(0, 400)).toMatch(/empresa_id:\s*empresaId/);
    expect(bloque.slice(0, 400)).toMatch(/punto_de_venta_id:/);
  });

  it('el detalle se marca como modificado: es una columna JSONB', () => {
    expect(fuente).toMatch(/order\.changed\('detail', true\)/);
  });

  it('resolverSucursal se resuelve UNA vez, fuera del bucle de líneas', () => {
    // Estaba adentro del `for`: una orden de veinte líneas eran veinte
    // resoluciones de la misma sucursal con la transacción abierta.
    const inicioDelBucle = fuente.indexOf('for (const linea of lineas)');
    const resolucion = fuente.indexOf('await resolverSucursal(');

    expect(resolucion).toBeGreaterThan(0);
    expect(resolucion).toBeLessThan(inicioDelBucle);
  });
});
