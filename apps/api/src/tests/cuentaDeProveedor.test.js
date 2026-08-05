// ════════════════════════════════════════════
//  La cuenta corriente de un proveedor: la aritmética y los endpoints
//
//  ⚠ **Este archivo vive en `src/tests/` aunque pruebe funciones puras de
//  `src/utils/`.** El `testMatch` de `jest.config.js` solo levanta `src/tests/`
//  y `__tests__/`: un `src/utils/cuentaDeProveedor.test.js` no lo corre nadie,
//  no falla, no avisa, y alguien lee el nombre del archivo y da por cubierto lo
//  que jamás se ejecutó. Lo protege `tests/todosLosTestsCorren.test.js`.
//
//  Los números que decide este código son plata que el usuario cree. Un error
//  acá no rompe nada: la pantalla abre, se ve bien, y el saldo está mal.
// ════════════════════════════════════════════

const express = require('express');
const request = require('supertest');
const { Op } = require('sequelize');
const { crearModelo } = require('./helpers/modelosFalsos');

const {
  resumenDeCuenta,
  pendienteDeRecibir,
  conSaldoAcumulado,
  filaDeCuentaParaExport,
  sinAcentos,
  ACENTOS,
  SIN_ACENTOS,
} = require('../utils/cuentaDeProveedor');

const PROPIA = 7;
const AJENA = 9;

const mockSupplierMovement = crearModelo([]);
const mockSupplierDocument = crearModelo([]);
const mockSupplierOrder = crearModelo([]);
const mockStock = crearModelo([]);
const mockProduct = crearModelo([]);

/**
 * Los hijos que Sequelize devolvería para este padre.
 *
 * Los dobles saben resolver un `include` —igual que en
 * `aislamientoDeProveedores.test.js`— **a propósito**: sin eso, volver a poner
 * los include que este corte sacó no haría fallar nada, y el caso «el listado NO
 * devuelve los movimientos» pasaría con y sin el cambio.
 */
function hijosDe(modeloHijo, padre, inc = {}) {
  return modeloHijo.filas.filter(
    (f) => f.supplier_id === padre.id
      && Object.entries(inc.where || {}).every(([k, v]) => f[k] === v)
  );
}

const mockSupplier = crearModelo([], {
  movements: (fila, inc) => hijosDe(mockSupplierMovement, fila, inc),
  documents: (fila, inc) => hijosDe(mockSupplierDocument, fila, inc),
  orders: (fila, inc) => hijosDe(mockSupplierOrder, fila, inc),
});

/**
 * Un `where` que puede traer `Op.or`, `Op.lt`, `Op.gte` y `Op.lte`.
 *
 * ⚠ **`coincide` de `modelosFalsos` solo sabe igualdad y arreglos**, y su
 * encabezado lo dice. El historial de cuenta necesita las tres cosas que no
 * sabe: el rango de fechas, el corte «más viejo que esta página» y el orden con
 * desempate. Sin esto, un `where` con símbolos se ignora entero y el doble
 * devuelve **todas** las filas: la página 2 daría lo mismo que la 1 y el test
 * pasaría con y sin el cambio.
 *
 * Se extiende **acá y no en el helper compartido**, igual que
 * `aislamientoDeProveedores.test.js` extiende el doble para reproducir el INNER
 * JOIN de un include con `where`.
 */
function cumple(fila, where = {}) {
  for (const clave of Reflect.ownKeys(where)) {
    const valor = where[clave];

    if (clave === Op.or) {
      if (!valor.some((sub) => cumple(fila, sub))) return false;
      continue;
    }
    if (clave === Op.and) {
      if (!valor.every((sub) => cumple(fila, sub))) return false;
      continue;
    }

    const dato = fila[clave];

    if (Array.isArray(valor)) {
      if (!valor.includes(dato)) return false;
      continue;
    }

    if (valor && typeof valor === 'object') {
      for (const op of Reflect.ownKeys(valor)) {
        const contra = valor[op];
        if (op === Op.gte && !(dato >= contra)) return false;
        if (op === Op.lte && !(dato <= contra)) return false;
        if (op === Op.lt && !(dato < contra)) return false;
        if (op === Op.gt && !(dato > contra)) return false;
      }
      continue;
    }

    if (dato !== valor) return false;
  }

  return true;
}

/** Le agrega al doble lo que la paginación del historial necesita de verdad. */
function conOrdenYPaginacion(doble) {
  doble.findAll = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'findAll', ...opciones });

    let filas = doble.filas.filter((f) => cumple(f, opciones.where || {}));

    // Se ordena de la última clave a la primera, que es lo que hace que un
    // `sort` estable produzca el orden compuesto.
    for (const [campo, direccion] of [...(opciones.order || [])].reverse()) {
      filas = [...filas].sort((a, b) => {
        if (a[campo] === b[campo]) return 0;
        const menor = a[campo] < b[campo] ? -1 : 1;
        return direccion === 'DESC' ? -menor : menor;
      });
    }

    if (opciones.offset) filas = filas.slice(opciones.offset);
    if (opciones.limit !== undefined) filas = filas.slice(0, opciones.limit);

    return filas.map((f) => ({ ...f }));
  };

  doble.count = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'count', ...opciones });
    return doble.filas.filter((f) => cumple(f, opciones.where || {})).length;
  };
}

conOrdenYPaginacion(mockSupplierMovement);

for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
  conDestroy(doble);
}

conCastDeIds(mockSupplier);

// findScoped normaliza el id contra la clave primaria del modelo: sin esto, un
// id que llega como '10' en la URL no coincidiría nunca con el 10 del arreglo y
// todo daría 404, incluido el caso legítimo.
for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

/**
 * El `DELETE /:id` abre una transacción de verdad, y `routes/suppliers.js` la
 * pide a `config/database` y no a `models`. Sin este doble, el test intentaría
 * conectarse a Postgres.
 */
jest.mock('../config/database', () => ({
  transaction: async () => ({ commit: async () => {}, rollback: async () => {} }),
}));

/**
 * Un `where` con el id del texto de la URL casteado, como hace Postgres.
 *
 * ⚠ Los cuatro `destroy` del borrado llevan `req.params.id` **tal cual**, que es
 * el texto de la URL; Postgres lo castea al INTEGER de la columna y por eso el
 * borrado funciona en producción. Si el doble comparara con `===`, los cuatro
 * `destroy` no encontrarían nada y el caso «con saldo cero sigue borrando las
 * cuatro cosas» pasaría **en verde sobre una base que no cambió**, que es
 * exactamente la forma de test que este repositorio ya tuvo diez veces.
 */
function comoEnPostgres(where = {}) {
  const salida = {};

  for (const clave of Reflect.ownKeys(where)) {
    const valor = where[clave];
    salida[clave] = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
  }

  return salida;
}

/**
 * `crearModelo` no tiene `destroy` estático —ningún test lo necesitaba— y el
 * borrado del proveedor usa cuatro. Se agrega acá, no en el helper compartido.
 */
function conDestroy(doble) {
  doble.destroy = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'destroy', ...opciones });
    const antes = doble.filas.length;
    doble.filas = doble.filas.filter((f) => !cumple(f, comoEnPostgres(opciones.where || {})));
    return antes - doble.filas.length;
  };
}

/**
 * Lo mismo para el `findOne` del borrado.
 *
 * `DELETE /:id` no pasa por `findScoped` —abre la transacción y consulta con
 * `id: req.params.id` tal cual— así que el id llega como texto. Sin el casteo,
 * el doble responde 404 en el único camino donde el borrado sí funciona.
 */
function conCastDeIds(doble) {
  const original = doble.findOne;

  doble.findOne = async (opciones = {}) =>
    original.call(doble, { ...opciones, where: comoEnPostgres(opciones.where || {}) });
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

function levantarApi(empresaId = PROPIA) {
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
    { id: 10, empresa_id: PROPIA, name: 'Nutrifit', cuit: '30123456789', phone: '1155' },
    { id: 11, empresa_id: PROPIA, name: 'Molino Norte', cuit: null, phone: null },
    { id: 20, empresa_id: AJENA, name: 'Distribuidora Sur', cuit: null, phone: null },
  ];
  mockSupplierMovement.filas = [];
  mockSupplierDocument.filas = [];
  mockSupplierOrder.filas = [];

  for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
    doble.llamadas = [];
  }
});

// ─────────────────────────────────────────────
//  Parte 1 · La aritmética (funciones puras)
// ─────────────────────────────────────────────

describe('resumenDeCuenta', () => {
  it('NO devuelve 1234,5600000000002', () => {
    // `0.13 + 1234.43` en punto flotante da exactamente ese residuo. Es el
    // criterio de éxito 8 y es lo que hoy hace `Orders.jsx:95-97` acumulando
    // parseFloat.
    expect(0.13 + 1234.43).not.toBe(1234.56); // el defecto, a la vista

    const { deuda } = resumenDeCuenta([
      { type: 'deuda', amount: 0.13 },
      { type: 'deuda', amount: 1234.43 },
    ]);

    expect(deuda).toBe(1234.56);
  });

  it('una deuda y un pago que se cancelan exactamente dan cero de verdad', () => {
    // De este cero cuelga el badge «Saldado», que compara contra cero. Un
    // residuo de 2e-13 convierte una cuenta cancelada en «Con deuda».
    const { saldo } = resumenDeCuenta([
      { type: 'deuda', amount: 0.13 },
      { type: 'deuda', amount: 1234.43 },
      { type: 'pago', amount: 1234.56 },
    ]);

    expect(saldo).toBe(0);
    expect(Object.is(saldo, 0)).toBe(true);
  });

  it('un pago mayor que la deuda da saldo negativo y eso NO es un error', () => {
    // US6 escenario 6: el proveedor me debe a mí. Pagar por adelantado es
    // legítimo y el saldo negativo es la forma correcta de decirlo.
    const { saldo, deuda, pagado } = resumenDeCuenta([
      { type: 'deuda', amount: '10000.00' },
      { type: 'pago', amount: '15000.00' },
    ]);

    expect(deuda).toBe(10000);
    expect(pagado).toBe(15000);
    expect(saldo).toBe(-5000);
  });

  it('un proveedor sin movimientos da los tres en cero y no NaN', () => {
    expect(resumenDeCuenta([])).toEqual({ deuda: 0, pagado: 0, saldo: 0 });
    expect(resumenDeCuenta()).toEqual({ deuda: 0, pagado: 0, saldo: 0 });
  });

  it('convierte el DECIMAL que llega como string antes de sumar', () => {
    // El driver de Postgres devuelve DECIMAL como texto y el SUM también. Sin
    // la conversión explícita, `'184000.00' + '120000.00'` es una concatenación
    // y nada falla.
    const { deuda, pagado, saldo } = resumenDeCuenta([
      { supplier_id: 7, type: 'deuda', total: '184000.00' },
      { supplier_id: 7, type: 'pago', total: '120000.00' },
    ]);

    expect(deuda).toBe(184000);
    expect(pagado).toBe(120000);
    expect(saldo).toBe(64000);
  });

  it('ignora un type que el ENUM no tiene, en vez de sumarlo a ciegas', () => {
    const { deuda, pagado, saldo } = resumenDeCuenta([
      { type: 'deuda', total: '100.00' },
      { type: 'ajuste', total: '9999.00' },
    ]);

    expect(deuda).toBe(100);
    expect(pagado).toBe(0);
    expect(saldo).toBe(100);
  });
});

describe('pendienteDeRecibir', () => {
  const linea = (quantity, quantity_received, unit_price) =>
    ({ product_id: 1, product_name: 'Colágeno', quantity, quantity_received, unit_price });

  it('suma lo que falta llegar, no lo que se pidió', () => {
    const total = pendienteDeRecibir([
      { status: 'partial', detail: [linea(12, 8, 1200)] },
    ]);

    expect(total).toBe(4800);
  });

  it('una orden anulada NO cuenta como pendiente de recibir', () => {
    // Sin el filtro de estado, anular una orden dejaría su importe sumando para
    // siempre en el número que la pantalla muestra al lado del saldo.
    const total = pendienteDeRecibir([
      { status: 'cancelled', detail: [linea(10, 0, 1000)] },
      { status: 'received', detail: [linea(10, 10, 1000)] },
    ]);

    expect(total).toBe(0);
  });

  it('una orden sin ítems no rompe ni suma', () => {
    expect(pendienteDeRecibir([{ status: 'pending' }])).toBe(0);
    expect(pendienteDeRecibir([{ status: 'pending', detail: [] }])).toBe(0);
    expect(pendienteDeRecibir([])).toBe(0);
  });

  it('una línea de cantidad cero no suma', () => {
    expect(pendienteDeRecibir([{ status: 'pending', detail: [linea(0, 0, 1200)] }])).toBe(0);
  });

  it('una línea totalmente recibida no suma, y una recibida de más tampoco resta', () => {
    const total = pendienteDeRecibir([
      { status: 'partial', detail: [linea(10, 10, 500), linea(4, 6, 500), linea(2, 0, 500)] },
    ]);

    // La segunda línea tiene más recibido que pedido —posible en órdenes
    // viejas— y no puede restarle a la tercera.
    expect(total).toBe(1000);
  });

  it('NO devuelve un residuo de coma flotante al sumar varias líneas', () => {
    const total = pendienteDeRecibir([
      { status: 'pending', detail: [linea(1, 0, 0.13), linea(1, 0, 1234.43)] },
    ]);

    expect(total).toBe(1234.56);
  });
});

describe('conSaldoAcumulado', () => {
  // Del más nuevo al más viejo, que es como los devuelve el endpoint.
  const PAGINA = [
    { id: 91, date: '2026-07-28', type: 'pago', amount: '50000.00' },
    { id: 88, date: '2026-07-14', type: 'deuda', amount: '72000.00' },
  ];

  it('la página 2 NO arranca el saldo acumulado en cero', () => {
    // **El test de esta función.** Sin `saldoInicial`, el acumulado de una
    // página del medio es la suma de un subconjunto, y la última fila del
    // archivo no coincide con el saldo grande de la pantalla. FR-101.
    const conSaldo = conSaldoAcumulado(PAGINA, 42000);

    expect(conSaldo.map((m) => m.saldo)).toEqual([64000, 114000]);
  });

  it('la primera página arranca en el saldo inicial cero y llega al saldo real', () => {
    const conSaldo = conSaldoAcumulado(PAGINA, 0);

    expect(conSaldo[1].saldo).toBe(72000);
    expect(conSaldo[0].saldo).toBe(22000);
  });

  it('devuelve los movimientos en el mismo orden en que llegaron', () => {
    // Se calcula ascendente y se devuelve descendente: si el arreglo saliera
    // dado vuelta, la pantalla dibujaría la cuenta del revés sin avisar.
    const conSaldo = conSaldoAcumulado(PAGINA, 0);

    expect(conSaldo.map((m) => m.id)).toEqual([91, 88]);
  });

  it('sin movimientos devuelve una lista vacía y no falla', () => {
    expect(conSaldoAcumulado([], 5000)).toEqual([]);
    expect(conSaldoAcumulado()).toEqual([]);
  });

  it('NO deja residuo de coma flotante en el acumulado', () => {
    const conSaldo = conSaldoAcumulado([
      { id: 2, type: 'pago', amount: 1234.56 },
      { id: 1, type: 'deuda', amount: 0.13 },
    ], 1234.43);

    expect(conSaldo[0].saldo).toBe(0);
  });
});

describe('filaDeCuentaParaExport', () => {
  const PROVEEDOR = { name: 'Nutrifit', cuit: '30123456789' };

  it('los importes salen como número y no como texto formateado', () => {
    const fila = filaDeCuentaParaExport(
      { date: '2026-01-08', type: 'deuda', amount: '72000.00', notes: 'Recepción orden #103' },
      72000,
      PROVEEDOR
    );

    expect(fila.debe).toBe(72000);
    expect(fila.haber).toBe(0);
    expect(fila.saldo).toBe(72000);
    expect(typeof fila.debe).toBe('number');
    expect(typeof fila.saldo).toBe('number');
  });

  it('un pago va en el Haber y no en el Debe', () => {
    const fila = filaDeCuentaParaExport(
      { date: '2026-07-28', type: 'pago', amount: '50000.00', notes: 'Transferencia' },
      22000,
      PROVEEDOR
    );

    expect(fila.debe).toBe(0);
    expect(fila.haber).toBe(50000);
  });

  it('el CUIT sale como string', () => {
    // FR-099: once dígitos inferidos como número salen en notación científica y
    // pierden los últimos, igual que pasaba con el CAE.
    const fila = filaDeCuentaParaExport({ type: 'pago', amount: 1 }, 1, PROVEEDOR);

    expect(fila.cuit).toBe('30123456789');
    expect(typeof fila.cuit).toBe('string');
  });

  it('un movimiento sin notas igual dice qué es', () => {
    const deuda = filaDeCuentaParaExport({ date: '2026-01-08', type: 'deuda', amount: 100 }, 100, PROVEEDOR);
    const pago = filaDeCuentaParaExport({ date: '2026-01-09', type: 'pago', amount: 100 }, 0, PROVEEDOR);

    expect(deuda.descripcion).toBeTruthy();
    expect(pago.descripcion).toBeTruthy();
    expect(deuda.descripcion).not.toBe(pago.descripcion);
  });

  it('la fecha viaja como el texto del DATEONLY y no pasa por Date', () => {
    // `new Date('2026-08-01')` se interpreta en UTC y en Argentina muestra el
    // 31/07. La fila del archivo no puede tener ese defecto adentro.
    const fila = filaDeCuentaParaExport({ date: '2026-08-01', type: 'deuda', amount: 1 }, 1, PROVEEDOR);

    expect(fila.fecha).toBe('2026-08-01');
  });

  it('un proveedor sin CUIT cargado da una celda vacía y no «undefined»', () => {
    const fila = filaDeCuentaParaExport({ type: 'pago', amount: 1 }, 0, { name: 'Sin CUIT' });

    expect(fila.cuit).toBe('');
  });
});

describe('sinAcentos', () => {
  it('la lista de acentos y la de reemplazos tienen el MISMO largo', () => {
    // El `translate()` de Postgres empareja las dos cadenas por posición: si una
    // fuera más larga, los últimos caracteres se **borrarían** en vez de
    // reemplazarse, y la búsqueda devolvería vacío sin que nada falle.
    expect(ACENTOS).toHaveLength(SIN_ACENTOS.length);
  });

  it('cada acento de la lista tiene su reemplazo, y es el mismo que usa el SQL', () => {
    for (let i = 0; i < ACENTOS.length; i++) {
      expect(sinAcentos(ACENTOS[i])).toBe(SIN_ACENTOS[i].toLowerCase());
    }
  });

  it('«Nutrí» y «NUTRI» normalizan al mismo texto', () => {
    expect(sinAcentos('Nutrí')).toBe('nutri');
    expect(sinAcentos('NUTRI')).toBe('nutri');
    expect(sinAcentos('Ñandú Café')).toBe('nandu cafe');
  });

  it('null y undefined dan cadena vacía y no «null»', () => {
    expect(sinAcentos(null)).toBe('');
    expect(sinAcentos(undefined)).toBe('');
  });
});

// ─────────────────────────────────────────────
//  Parte 2 · GET /api/suppliers — el listado
// ─────────────────────────────────────────────

describe('GET /api/suppliers', () => {
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '184000.00', date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '120000.00', date: '2026-07-15' },
      // Colgado del proveedor 10 desde la empresa AJENA. El bug estuvo abierto,
      // así que la fila puede existir de antes.
      { id: 3, supplier_id: 10, empresa_id: AJENA, type: 'pago', amount: '999999.00', date: '2026-07-16' },
    ];
    mockSupplierDocument.filas = [
      { id: 1, supplier_id: 10, empresa_id: AJENA, name: 'factura-ajena.pdf' },
    ];
    mockSupplierOrder.filas = [
      {
        id: 1, supplier_id: 10, empresa_id: PROPIA, status: 'partial',
        detail: [{ product_id: 41, product_name: 'Colágeno', quantity: 12, quantity_received: 8, unit_price: 1200 }],
      },
      {
        id: 2, supplier_id: 10, empresa_id: PROPIA, status: 'cancelled',
        detail: [{ product_id: 41, product_name: 'Colágeno', quantity: 10, quantity_received: 0, unit_price: 5000 }],
      },
    ];
  });

  it('el listado NO devuelve los movimientos', async () => {
    // Hallazgo 7 de la spec hecho afirmación: ese arreglo era la contabilidad
    // entera en cada carga de pantalla, y el único uso que tenía era sumarse
    // para mostrar un número.
    const res = await request(levantarApi()).get('/api/suppliers');

    expect(res.status).toBe(200);
    for (const proveedor of res.body.data) {
      expect(proveedor).not.toHaveProperty('movements');
      expect(proveedor).not.toHaveProperty('documents');
    }
  });

  it('devuelve el saldo ya calculado y no el arreglo para sumarlo', async () => {
    const res = await request(levantarApi()).get('/api/suppliers');
    const nutrifit = res.body.data.find((s) => s.id === 10);

    expect(nutrifit.deuda).toBe(184000);
    expect(nutrifit.pagado).toBe(120000);
    expect(nutrifit.saldo).toBe(64000);
    expect(nutrifit.movimientos).toBe(2);
  });

  it('el pago inyectado desde otra empresa NO le mueve el saldo', async () => {
    // Es el caso que cerró `dfd7009` del lado del include. Ahora no hay include:
    // lo que lo sostiene es el `empresa_id` del `where` de la consulta agregada.
    const res = await request(levantarApi()).get('/api/suppliers');
    const nutrifit = res.body.data.find((s) => s.id === 10);

    expect(nutrifit.saldo).toBe(64000);
    expect(nutrifit.documentos).toBe(0);
  });

  it('«pendiente de recibir» sale al lado del saldo, y la orden anulada no cuenta', async () => {
    const res = await request(levantarApi()).get('/api/suppliers');
    const nutrifit = res.body.data.find((s) => s.id === 10);

    // 4 pendientes × $1.200. La anulada aporta cero.
    expect(nutrifit.pendiente_de_recibir).toBe(4800);
  });

  it('un proveedor sin movimientos sigue apareciendo en el listado', async () => {
    // Es lo que protegía el `required: false` de los include, y que ahora
    // protege el no tener include: un proveedor recién creado no puede
    // desaparecer de la pantalla.
    const res = await request(levantarApi()).get('/api/suppliers');

    const nuevo = res.body.data.find((s) => s.id === 11);
    expect(nuevo).toBeDefined();
    expect(nuevo.saldo).toBe(0);
    expect(nuevo.movimientos).toBe(0);
  });

  it('no devuelve proveedores de otra empresa', async () => {
    const res = await request(levantarApi()).get('/api/suppliers');

    expect(res.body.data.map((s) => s.id)).not.toContain(20);
  });

  it('q filtra por nombre sin distinguir acentos', async () => {
    // ⚠ El filtro lo ejecuta Postgres con `translate(lower(name), …)`, y los
    // dobles de `modelosFalsos` no saben evaluar eso: lo que este caso verifica
    // es que el patrón que sale hacia la base esté **normalizado**, que es la
    // mitad de la que depende el resultado. Que Postgres devuelva las filas
    // correctas es el paso manual P1.
    await request(levantarApi()).get('/api/suppliers?q=NUTR%C3%8D');

    const { where } = mockSupplier.llamadas.find((l) => l.metodo === 'findAll');
    const condiciones = Object.getOwnPropertySymbols(where).flatMap((s) => where[s]);

    expect(condiciones).toHaveLength(1);
    // El patrón viaja bajo la clave `Op.like`, que es un Symbol: JSON.stringify
    // lo borra sin avisar, así que se lee por el símbolo.
    expect(condiciones[0].logic[Op.like]).toBe('%nutri%');
    // Y la columna se normaliza con el MISMO par de listas que el texto.
    expect(JSON.stringify(condiciones[0].attribute)).toContain('translate');
    expect(JSON.stringify(condiciones[0].attribute)).toContain(SIN_ACENTOS);
  });

  it('sin q no manda ninguna condición de nombre', async () => {
    // Sin este caso el filtro podría estar aplicándose siempre, y una búsqueda
    // vacía devolvería la lista vacía.
    await request(levantarApi()).get('/api/suppliers');

    const { where } = mockSupplier.llamadas.find((l) => l.metodo === 'findAll');
    expect(Object.getOwnPropertySymbols(where)).toEqual([]);
  });

  it('pagina de a 50 por defecto y recorta un limit absurdo a 200', async () => {
    await request(levantarApi()).get('/api/suppliers');
    expect(mockSupplier.llamadas.find((l) => l.metodo === 'findAll').limit).toBe(50);

    mockSupplier.llamadas = [];
    await request(levantarApi()).get('/api/suppliers?limit=999999');
    expect(mockSupplier.llamadas.find((l) => l.metodo === 'findAll').limit).toBe(200);

    mockSupplier.llamadas = [];
    await request(levantarApi()).get('/api/suppliers?limit=-5');
    expect(mockSupplier.llamadas.find((l) => l.metodo === 'findAll').limit).toBe(50);
  });

  it('page es 1-indexado: la página 2 con limit 50 arranca en el 50', async () => {
    await request(levantarApi()).get('/api/suppliers?page=2&limit=50');

    const llamada = mockSupplier.llamadas.find((l) => l.metodo === 'findAll');
    expect(llamada.offset).toBe(50);
  });

  it('devuelve el total de la búsqueda y no el largo de la página', async () => {
    const res = await request(levantarApi()).get('/api/suppliers?limit=1');

    expect(res.body.total).toBe(2);
  });

  it('las tres consultas agregadas van acotadas a la empresa', async () => {
    await request(levantarApi()).get('/api/suppliers');

    for (const doble of [mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
      const llamada = doble.llamadas.find((l) => l.metodo === 'findAll');
      expect(llamada.where).toMatchObject({ empresa_id: PROPIA });
    }
  });

  it('ninguna de las consultas del listado usa include', async () => {
    // Las cuatro entradas que este endpoint aportaba al detector de
    // `analizarIncludes` desaparecen (T1218), y con ellas la fuga que el
    // include dejaba abierta el día que a alguien se le olvidara el `where`.
    await request(levantarApi()).get('/api/suppliers');

    for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
      for (const llamada of doble.llamadas) {
        expect(llamada.include).toBeUndefined();
      }
    }
  });
});

// ─────────────────────────────────────────────
//  Parte 3 · GET /api/suppliers/:id — la ficha
// ─────────────────────────────────────────────

describe('GET /api/suppliers/:id', () => {
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '184000.00', date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '120000.00', date: '2026-07-15' },
      { id: 3, supplier_id: 10, empresa_id: AJENA, type: 'pago', amount: '999999.00', date: '2026-07-16' },
      // De otro proveedor de la MISMA empresa: no puede entrar en esta cuenta.
      { id: 4, supplier_id: 11, empresa_id: PROPIA, type: 'deuda', amount: '5000.00', date: '2026-07-02' },
    ];
    mockSupplierDocument.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, name: 'Factura 0001-00012345', type: 'factura', url: 'https://drive.google.com/x' },
      { id: 2, supplier_id: 10, empresa_id: AJENA, name: 'factura-ajena.pdf', type: 'factura', url: 'https://drive.google.com/y' },
    ];
    mockSupplierOrder.filas = [
      {
        id: 1, supplier_id: 10, empresa_id: PROPIA, status: 'partial',
        detail: [{ product_id: 41, product_name: 'Colágeno', quantity: 12, quantity_received: 8, unit_price: 1200 }],
      },
    ];
  });

  it('la ficha NO devuelve las órdenes ni los movimientos', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10');

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('orders');
    expect(res.body.data).not.toHaveProperty('movements');
  });

  it('el saldo de la ficha es el MISMO número que el de la lista', async () => {
    // FR-101, del lado del servidor. Los dos salen de `resumenDeCuenta`: si cada
    // uno escribiera su propia suma, el día que difieran en un centavo nadie
    // sabría cuál de los dos está mal.
    const lista = await request(levantarApi()).get('/api/suppliers');
    const ficha = await request(levantarApi()).get('/api/suppliers/10');

    const enLaLista = lista.body.data.find((s) => s.id === 10);

    expect(ficha.body.data.saldo).toBe(enLaLista.saldo);
    expect(ficha.body.data.deuda).toBe(enLaLista.deuda);
    expect(ficha.body.data.pagado).toBe(enLaLista.pagado);
    expect(ficha.body.data.pendiente_de_recibir).toBe(enLaLista.pendiente_de_recibir);
    expect(ficha.body.data.saldo).toBe(64000);
  });

  it('la cuenta del proveedor 10 NO suma los movimientos del 11', async () => {
    // El `supplier_id` del `where` es lo único que separa las dos cuentas
    // ahora que no hay include que las una.
    const res = await request(levantarApi()).get('/api/suppliers/10');

    expect(res.body.data.deuda).toBe(184000);
  });

  it('los documentos siguen viniendo, y filtrados por empresa', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10');

    expect(res.body.data.documents.map((d) => d.id)).toEqual([1]);
  });

  it('un proveedor de otra empresa da 404 y no distingue de uno que no existe', async () => {
    const ajeno = await request(levantarApi()).get('/api/suppliers/20');
    const inexistente = await request(levantarApi()).get('/api/suppliers/99999');

    expect(ajeno.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(ajeno.body.error).toBe(inexistente.body.error);
  });
});

// ─────────────────────────────────────────────
//  Parte 4 · GET /api/suppliers/:id/movimientos — el historial
// ─────────────────────────────────────────────

describe('GET /api/suppliers/:id/movimientos', () => {
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 88, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '72000.00', date: '2026-07-14', payment_method: null, notes: 'Recepción orden #118' },
      { id: 91, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '50000.00', date: '2026-07-28', payment_method: 'tr', notes: 'Transferencia' },
      // De otra empresa, colgado del mismo proveedor: no puede aparecer.
      { id: 95, supplier_id: 10, empresa_id: AJENA, type: 'pago', amount: '999999.00', date: '2026-07-30', notes: 'Ajeno' },
    ];
  });

  it('devuelve los movimientos del más nuevo al más viejo', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos');

    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.id)).toEqual([91, 88]);
  });

  it('el saldo acumulado se lee del más viejo al más nuevo aunque se muestre al revés', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos');

    // 72.000 de deuda, después 50.000 de pago: 72.000 y 22.000.
    expect(res.body.data.map((m) => m.saldo)).toEqual([22000, 72000]);
    // Y la fila más nueva coincide con el saldo de la ficha (FR-101).
    const ficha = await request(levantarApi()).get('/api/suppliers/10');
    expect(res.body.data[0].saldo).toBe(ficha.body.data.saldo);
  });

  it('NO trae el movimiento inyectado desde otra empresa', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos');

    expect(res.body.data.map((m) => m.id)).not.toContain(95);
    expect(res.body.total).toBe(2);
  });

  it('la fecha viaja como texto y no como timestamp', async () => {
    // DATEONLY. Si el servidor la mandara como Date, `new Date(iso)` del
    // navegador la interpretaría en UTC y en Argentina mostraría el día
    // anterior: el 01/08 se ve 31/07.
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos');

    expect(res.body.data[0].date).toBe('2026-07-28');
    expect(typeof res.body.data[0].date).toBe('string');
  });

  it('un proveedor sin movimientos devuelve 200 con la lista vacía', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/11/movimientos');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.saldo_inicial).toBe(0);
  });

  it('el proveedor de otra empresa responde 404 y no una lista vacía', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/20/movimientos');

    expect(res.status).toBe(404);
  });

  it('una fecha con forma inválida responde 400 y no un 500 de Postgres', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos?desde=31/07/2026');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FILTRO_INVALIDO');
  });

  it('la página 2 NO arranca el saldo acumulado en cero', async () => {
    // **El test de esta tarea.** Sin `saldo_inicial`, el acumulado de la página
    // 2 es la suma de un subconjunto: la última fila del archivo no coincide con
    // el saldo grande de la pantalla, que es exactamente lo que FR-101 y el
    // escenario 6 de US8 prohíben.
    mockSupplierMovement.filas.push(
      { id: 80, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '30000.00', date: '2026-06-01', notes: 'Vieja' }
    );

    const pagina1 = await request(levantarApi()).get('/api/suppliers/10/movimientos?page=1&limit=2');
    const pagina2 = await request(levantarApi()).get('/api/suppliers/10/movimientos?page=2&limit=2');

    expect(pagina1.body.data.map((m) => m.id)).toEqual([91, 88]);
    expect(pagina2.body.data.map((m) => m.id)).toEqual([80]);

    // 30.000 + 72.000 − 50.000 = 52.000, que es el saldo de la cuenta.
    expect(pagina1.body.saldo_inicial).toBe(30000);
    expect(pagina1.body.data[0].saldo).toBe(52000);
    expect(pagina2.body.data[0].saldo).toBe(30000);
  });

  it('la fila más nueva de la página 1 dice el saldo de la cuenta entera', async () => {
    mockSupplierMovement.filas.push(
      { id: 80, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '30000.00', date: '2026-06-01' }
    );

    const historial = await request(levantarApi()).get('/api/suppliers/10/movimientos?limit=1');
    const ficha = await request(levantarApi()).get('/api/suppliers/10');

    expect(historial.body.data[0].saldo).toBe(ficha.body.data.saldo);
  });

  it('con un desde, el saldo anterior son los movimientos que el rango deja afuera', async () => {
    // Sin esa consulta, la primera fila del período arrancaría en cero y el
    // estado de cuenta mentiría: el «saldo anterior» es parte de la cuenta.
    mockSupplierMovement.filas.push(
      { id: 80, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '30000.00', date: '2026-06-01' }
    );

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos?desde=2026-07-01');

    expect(res.body.data.map((m) => m.id)).toEqual([91, 88]);
    expect(res.body.saldo_inicial).toBe(30000);
    expect(res.body.data[0].saldo).toBe(52000);
  });

  it('en la última página sin filtro de fecha NO consulta el saldo anterior', async () => {
    // Una consulta menos en el caso común: una cuenta que entra en una página no
    // tiene nada más viejo abajo.
    await request(levantarApi()).get('/api/suppliers/10/movimientos');

    const agregados = mockSupplierMovement.llamadas
      .filter((l) => l.metodo === 'findAll' && l.attributes);

    expect(agregados).toEqual([]);
  });

  it('el orden desempata por id, para que dos movimientos del mismo día no cambien de lugar', async () => {
    mockSupplierMovement.filas.push(
      { id: 92, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '1000.00', date: '2026-07-28' }
    );

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos');

    // 92 y 91 son del mismo día: el id decide, y decide siempre igual.
    expect(res.body.data.map((m) => m.id)).toEqual([92, 91, 88]);
  });

  it('pagina de a 50 por defecto', async () => {
    await request(levantarApi()).get('/api/suppliers/10/movimientos');

    const llamada = mockSupplierMovement.llamadas.find((l) => l.metodo === 'findAll' && !l.attributes);
    expect(llamada.limit).toBe(50);
    expect(llamada.offset).toBe(0);
  });
});

// ─────────────────────────────────────────────
//  Parte 5 · GET /api/suppliers/:id/movimientos/export — el archivo
// ─────────────────────────────────────────────

describe('GET /api/suppliers/:id/movimientos/export', () => {
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 88, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '72000.00', date: '2026-07-14', notes: 'Recepción orden #118' },
      { id: 91, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '50000.00', date: '2026-07-28', payment_method: 'tr', notes: 'Transferencia' },
      { id: 95, supplier_id: 10, empresa_id: AJENA, type: 'pago', amount: '999999.00', date: '2026-07-30' },
    ];
  });

  it('los importes salen como número y no como texto formateado', () => {
    // **Es la trampa de los importes argentinos vista desde el lado de la
    // escritura**: si la celda dice el texto «1.234,50», Excel la toma como
    // texto en un idioma y como 1234.5 en otro, la columna Total no suma, y el
    // archivo abre, se ve bien y está mal.
    return request(levantarApi()).get('/api/suppliers/10/movimientos/export').then((res) => {
      expect(res.status).toBe(200);

      for (const fila of res.body.data) {
        expect(typeof fila.debe).toBe('number');
        expect(typeof fila.haber).toBe('number');
        expect(typeof fila.saldo).toBe('number');
      }
    });
  });

  it('sale del más viejo al más nuevo, al revés que la pantalla', async () => {
    // Un saldo acumulado que crece hacia abajo es como se lee una cuenta en una
    // planilla. La pantalla lo muestra al revés y las dos cosas son correctas.
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');

    expect(res.body.data.map((f) => f.fecha)).toEqual(['2026-07-14', '2026-07-28']);
    expect(res.body.data.map((f) => f.saldo)).toEqual([72000, 22000]);
  });

  it('el CUIT sale como string', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');

    expect(res.body.data.every((f) => typeof f.cuit === 'string')).toBe(true);
    expect(res.body.data[0].cuit).toBe('30123456789');
  });

  it('el saldo final es el MISMO número que el del listado', async () => {
    const archivo = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');
    const lista = await request(levantarApi()).get('/api/suppliers');

    const enLaLista = lista.body.data.find((s) => s.id === 10);

    expect(archivo.body.saldo_final).toBe(enLaLista.saldo);
    // Y la última fila del archivo cierra en ese mismo número.
    expect(archivo.body.data[archivo.body.data.length - 1].saldo).toBe(enLaLista.saldo);
  });

  it('el saldo final NO se calcula con un segundo reduce', async () => {
    // Con una cuenta que se cancela exactamente, un `reduce` en pesos deja
    // 2.27e-13 y el archivo cierra en «0,0000000000002» mientras la pantalla
    // dice $0,00. Los dos números salen de `resumenDeCuenta` justamente para que
    // no puedan separarse: dos sumas escritas por separado se separan.
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '0.13', date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '1234.43', date: '2026-07-02' },
      { id: 3, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '1234.56', date: '2026-07-03' },
    ];

    const archivo = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');
    const lista = await request(levantarApi()).get('/api/suppliers');

    expect(archivo.body.saldo_final).toBe(0);
    expect(archivo.body.saldo_final).toBe(lista.body.data.find((s) => s.id === 10).saldo);
    expect(archivo.body.data[2].saldo).toBe(0);
  });

  it('NO incluye el movimiento de otra empresa', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');

    expect(res.body.total).toBe(2);
    expect(res.body.data.map((f) => f.fecha)).not.toContain('2026-07-30');
  });

  it('un proveedor sin movimientos devuelve 200 con la lista vacía', async () => {
    // US8 escenario 7: el archivo sale con encabezados y sin filas, y no falla.
    const res = await request(levantarApi()).get('/api/suppliers/11/movimientos/export');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.saldo_final).toBe(0);
  });

  it('por encima del límite responde 400 con el total y el límite', async () => {
    mockSupplierMovement.filas = Array.from({ length: 5001 }, (_, i) => ({
      id: i + 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '1.00', date: '2026-07-01',
    }));

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMITE_EXPORT_SUPERADO');
    expect(res.body.total).toBe(5001);
    expect(res.body.limite).toBe(5000);
    // Y no se cargaron las 5.001 filas para después descartarlas.
    expect(mockSupplierMovement.llamadas.filter((l) => l.metodo === 'findAll')).toEqual([]);
  });

  it('el proveedor de otra empresa responde 404', async () => {
    const res = await request(levantarApi()).get('/api/suppliers/20/movimientos/export');

    expect(res.status).toBe(404);
  });

  it('el proveedor sin CUIT no rompe el archivo', async () => {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 11, empresa_id: PROPIA, type: 'deuda', amount: '100.00', date: '2026-07-01' },
    ];

    const res = await request(levantarApi()).get('/api/suppliers/11/movimientos/export');

    expect(res.status).toBe(200);
    expect(res.body.data[0].cuit).toBe('');
  });

  it('la ruta del export NO la atrapa GET /:id', async () => {
    // `router.get('/:id')` se come cualquier palabra literal declarada después.
    // Esta ruta es de tres segmentos y por eso entra; el caso está para que se
    // note si alguien la mueve a `/suppliers/export`.
    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');

    expect(res.body).toHaveProperty('saldo_final');
    expect(res.body).not.toHaveProperty('documents');
  });

  // ── El rango de fechas ──
  //
  // ⚠ **Los doce casos de arriba van todos sin `desde` ni `hasta`**, y esa es la
  // única razón por la que este defecto llegó hasta acá: con la cuenta entera
  // adentro del archivo, arrancar el acumulado en cero da el número correcto.
  // Apenas el rango deja algo afuera, el archivo del contador cierra en el neto
  // del período y la pantalla muestra otro número.

  /**
   * Tres movimientos ANTERIORES al período que se va a exportar.
   *
   * Los tres hacen falta y ninguno sobra:
   *
   *  · El propio (80) es el que el rango deja afuera. Sin él, un `desde` no
   *    excluye nada y el defecto es indistinguible del código corregido.
   *  · El ajeno (79) y el del proveedor 11 (78) son anteriores también: sin
   *    ellos, un saldo anterior consultado sin `empresa_id` o sin `supplier_id`
   *    daría el mismo número y el caso pasaría en verde sobre una fuga.
   */
  function conMovimientosAnteriores() {
    mockSupplierMovement.filas.push(
      { id: 80, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '100000.00', date: '2026-06-30', notes: 'Factura de junio' },
      { id: 79, supplier_id: 10, empresa_id: AJENA, type: 'deuda', amount: '999999.00', date: '2026-06-15' },
      { id: 78, supplier_id: 11, empresa_id: PROPIA, type: 'deuda', amount: '444444.00', date: '2026-06-20' }
    );
  }

  it('con un desde, el archivo NO cierra en el neto del período sino en el saldo de la cuenta', async () => {
    // **El caso de esta corrección.** `conSaldoAcumulado(descendentes, 0)` —el
    // cero escrito a mano— hacía que el archivo del contador cerrara en $22.000
    // sobre una cuenta que debe $122.000. El contrato lo dice sin condicionar
    // (`contracts/api-endpoints.md:229`) y US8 escenario 6 también: la última
    // fila del archivo y el saldo grande son **el mismo número**.
    conMovimientosAnteriores();

    const archivo = await request(levantarApi()).get('/api/suppliers/10/movimientos/export?desde=2026-07-01');
    const lista = await request(levantarApi()).get('/api/suppliers');
    const enLaLista = lista.body.data.find((s) => s.id === 10);

    expect(enLaLista.saldo).toBe(122000);
    expect(archivo.body.saldo_final).toBe(122000);
    expect(archivo.body.saldo_final).toBe(enLaLista.saldo);
    // Y la última fila del archivo cierra en ese mismo número.
    expect(archivo.body.data[archivo.body.data.length - 1].saldo).toBe(enLaLista.saldo);
  });

  it('las filas del período arrancan en el saldo anterior y no en cero', async () => {
    // El acumulado de la primera fila del archivo tiene que ser el saldo
    // anterior más ese movimiento. Arrancando en cero, la columna Saldo entera
    // sale corrida por el mismo importe.
    conMovimientosAnteriores();

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export?desde=2026-07-01');

    expect(res.body.data.map((f) => f.saldo)).toEqual([172000, 122000]);
  });

  it('el archivo dice con qué saldo anterior arranca el período', async () => {
    // Sin este número, la primera fila del archivo parece el principio de la
    // cuenta y no lo es: el contador ve una columna que arranca en $172.000 sin
    // nada que lo explique. Es el mismo campo que ya devuelve
    // `GET /:id/movimientos`.
    //
    // Que dé exactamente 100.000 es lo que prueba que la consulta del saldo
    // anterior filtra por empresa **y** por proveedor: el ajeno aportaría
    // 999.999 y el del proveedor 11, 444.444.
    conMovimientosAnteriores();

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export?desde=2026-07-01');

    expect(res.body.saldo_inicial).toBe(100000);
  });

  it('el movimiento anterior al desde NO entra en las filas: solo en el saldo inicial', async () => {
    // Lo que impide «arreglar» esto ensanchando la consulta: el archivo es el
    // período que se pidió. Un `desde` que igual trae junio no es un rango.
    conMovimientosAnteriores();

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export?desde=2026-07-01');

    expect(res.body.total).toBe(2);
    expect(res.body.data.map((f) => f.fecha)).toEqual(['2026-07-14', '2026-07-28']);
  });

  it('sin rango el saldo inicial es cero y NO se consulta nada anterior', async () => {
    // Una consulta menos en el caso común, igual que en el historial paginado:
    // sin `desde` no hay nada afuera del archivo que pueda ser saldo anterior.
    conMovimientosAnteriores();

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export');

    expect(res.body.saldo_inicial).toBe(0);
    expect(res.body.saldo_final).toBe(122000);

    const agregados = mockSupplierMovement.llamadas
      .filter((l) => l.metodo === 'findAll' && l.attributes);

    expect(agregados).toEqual([]);
  });

  it('con desde y hasta, arranca en el saldo anterior y cierra en el saldo a la fecha de corte', async () => {
    // Con `hasta`, el archivo cierra en el saldo **a esa fecha** y no en el de
    // hoy: es lo que significa cortar un período. Un archivo que cerrara en el
    // saldo actual sobre filas que terminan el 14 de julio no cuadraría con sus
    // propias filas, que es el número que el contador suma.
    conMovimientosAnteriores();

    const res = await request(levantarApi())
      .get('/api/suppliers/10/movimientos/export?desde=2026-07-01&hasta=2026-07-14');

    expect(res.body.data.map((f) => f.fecha)).toEqual(['2026-07-14']);
    expect(res.body.saldo_inicial).toBe(100000);
    expect(res.body.saldo_final).toBe(172000);
    expect(res.body.data[0].saldo).toBe(172000);
  });

  it('un rango sin movimientos igual dice el saldo anterior, y cierra en él', async () => {
    // El archivo sale vacío pero la cuenta no está en cero: un estado de cuenta
    // de agosto sobre una deuda de julio tiene que decir que se deben $122.000,
    // no que no se debe nada.
    conMovimientosAnteriores();

    const res = await request(levantarApi()).get('/api/suppliers/10/movimientos/export?desde=2026-08-01');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.saldo_inicial).toBe(122000);
    expect(res.body.saldo_final).toBe(122000);
  });
});

// ─────────────────────────────────────────────
//  Parte 6 · DELETE /api/suppliers/:id — borrar el respaldo de una deuda
// ─────────────────────────────────────────────

describe('DELETE /api/suppliers/:id', () => {
  /** Las cuatro tablas del proveedor 10, con su saldo de $64.000. */
  function sembrarConDeuda() {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '184000.00', date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '120000.00', date: '2026-07-15' },
    ];
    mockSupplierDocument.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, name: 'Factura 0001-00012345' },
    ];
    mockSupplierOrder.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, status: 'received', detail: [] },
    ];
  }

  it('NO borra un proveedor con saldo distinto de cero', async () => {
    // Hasta este corte el DELETE se llevaba la cuenta entera —órdenes,
    // movimientos y documentos— con una confirmación genérica: **es borrar el
    // respaldo de una deuda**. Después de eso no queda forma de saber cuánto se
    // le debía a ese proveedor ni por qué.
    sembrarConDeuda();

    const res = await request(levantarApi()).delete('/api/suppliers/10');

    expect(res.status).toBe(400);
    // Y las cuatro tablas quedan con exactamente las filas que tenían.
    expect(mockSupplier.filas.map((s) => s.id)).toEqual([10, 11, 20]);
    expect(mockSupplierMovement.filas).toHaveLength(2);
    expect(mockSupplierDocument.filas).toHaveLength(1);
    expect(mockSupplierOrder.filas).toHaveLength(1);
  });

  it('el mensaje dice el saldo, para que se sepa cuánto saldar', async () => {
    // «No se puede eliminar» sin decir cuánto obliga a ir a buscar el número a
    // otra pantalla. Y el importe va escrito como se escribe en Argentina:
    // $64.000,00 —leerlo al revés convierte $64.000 en $64— .
    sembrarConDeuda();

    const res = await request(levantarApi()).delete('/api/suppliers/10');

    expect(res.body.error).toContain('Nutrifit');
    expect(res.body.error).toContain('$64.000,00');
  });

  it('el saldo que bloquea el borrado es el MISMO número que el de la lista', async () => {
    // Sale de `resumenDeCuenta`, igual que el listado, la ficha y el archivo
    // (FR-101). Con una segunda suma escrita acá, el día que difieran en un
    // centavo el borrado se bloquearía sobre un número que la pantalla no
    // muestra y nadie sabría cuál de los dos está mal.
    sembrarConDeuda();

    const lista = await request(levantarApi()).get('/api/suppliers');
    const res = await request(levantarApi()).delete('/api/suppliers/10');

    const enLaLista = lista.body.data.find((s) => s.id === 10);
    expect(enLaLista.saldo).toBe(64000);
    expect(res.body.error).toContain('$64.000,00');
  });

  it('el mensaje dice DOS decimales sobre un saldo que no es redondo', async () => {
    // Las otras fixtures del borrado son enteros, y con enteros el mensaje sale
    // igual esté o no la disciplina de centavos: «$64.000,00» no distingue un
    // `Math.round` de un `Math.trunc` ni una suma en pesos de una en centavos.
    // Con un importe de tres decimales sí (FR-050 + FR-051).
    //
    // ⚠ **Lo que este caso NO puede pinchar es el `maximumFractionDigits: 2` de
    // `enPesos`**, y no por estar mal escrito: `resumenDeCuenta` devuelve el
    // saldo en centavos enteros, así que **ningún** importe alcanzable por este
    // endpoint produce un tercer decimal. Comprobado a fuerza bruta sobre dos
    // millones de valores: cero diferencias entre formatear con el máximo y sin
    // él. Ese tope es la segunda red —la que tapa el residuo si algún día la
    // suma vuelve a hacerse en pesos— y solo se puede verificar desde afuera del
    // servidor. Está anotado para que el próximo no lo intente de nuevo.
    // **Dos** deudas de medio centavo y no una: con una sola, redondear cada
    // importe y redondear el total dan lo mismo, y el caso pasaría igual con la
    // suma hecha en pesos. Con dos, los dos caminos se separan en un centavo.
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '184000.005', date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '88000.005', date: '2026-07-05' },
      { id: 3, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '120000.00', date: '2026-07-15' },
    ];

    const res = await request(levantarApi()).delete('/api/suppliers/10');

    expect(res.status).toBe(400);
    // Cada importe se redondea al centavo antes de sumar, así que el saldo es
    // 152.000,02. Sumado en pesos daría «$152.000,01» y truncando en vez de
    // redondear, «$152.000,00»: un centavo de diferencia con lo que muestra la
    // lista, sobre el número que bloquea el borrado.
    expect(res.body.error).toContain('$152.000,02');
    // Y nunca un tercer decimal, venga de donde venga el importe.
    expect(res.body.error).not.toMatch(/\$[\d.]+,\d{3}/);

    // Es el MISMO número que el listado (FR-101), hasta el centavo.
    const lista = await request(levantarApi()).get('/api/suppliers');
    expect(lista.body.data.find((s) => s.id === 10).saldo).toBe(152000.02);
  });

  it('un saldo a favor tampoco deja borrar: el proveedor me debe a mí', async () => {
    // Saldo negativo es un adelanto sin usar, no una cuenta cerrada. Un
    // `saldo > 0` en vez de `saldo !== 0` dejaría borrar la única constancia de
    // esa plata.
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '5000.00', date: '2026-07-15' },
    ];

    const res = await request(levantarApi()).delete('/api/suppliers/10');

    expect(res.status).toBe(400);
    expect(mockSupplier.filas.map((s) => s.id)).toContain(10);
  });

  it('con saldo cero sigue borrando las cuatro cosas en una transacción', async () => {
    // Lo que impide que la validación quede bloqueando siempre: con la cuenta
    // saldada, el DELETE hace **exactamente** lo que hacía antes.
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '184000.00', date: '2026-07-01' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '184000.00', date: '2026-07-15' },
      { id: 3, supplier_id: 11, empresa_id: PROPIA, type: 'deuda', amount: '5000.00', date: '2026-07-02' },
    ];
    mockSupplierDocument.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, name: 'Factura 0001-00012345' },
    ];
    mockSupplierOrder.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, status: 'received', detail: [] },
    ];

    const res = await request(levantarApi()).delete('/api/suppliers/10');

    expect(res.status).toBe(200);
    expect(mockSupplier.filas.map((s) => s.id)).toEqual([11, 20]);
    expect(mockSupplierDocument.filas).toEqual([]);
    expect(mockSupplierOrder.filas).toEqual([]);
    // El movimiento del proveedor 11 no se lo lleva puesto.
    expect(mockSupplierMovement.filas.map((m) => m.id)).toEqual([3]);

    // Las cuatro escrituras van en la MISMA transacción: un borrado que se
    // corta en la mitad deja el proveedor sin sus movimientos o al revés.
    for (const doble of [mockSupplier, mockSupplierMovement, mockSupplierDocument, mockSupplierOrder]) {
      const borrado = doble.llamadas.find((l) => l.metodo === 'destroy');
      expect(borrado.transaction).toBeDefined();
    }
  });

  it('un proveedor de otra empresa NO se borra ni se distingue de uno que no existe', async () => {
    const ajeno = await request(levantarApi()).delete('/api/suppliers/20');
    const inexistente = await request(levantarApi()).delete('/api/suppliers/99999');

    expect(ajeno.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(ajeno.body.error).toBe(inexistente.body.error);
    expect(mockSupplier.filas.map((s) => s.id)).toContain(20);
  });
});

// ─────────────────────────────────────────────
//  Parte 7 · POST /api/suppliers/:id/payments — el importe del pago
// ─────────────────────────────────────────────

describe('POST /api/suppliers/:id/payments', () => {
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '10000.00', date: '2026-07-01' },
    ];
  });

  it('un pago sin importe NO escribe NaN en la base', async () => {
    // `Orders.jsx:125` mandaba `parseFloat(payData.amount)` sin validar nada,
    // así que un formulario vacío escribía NaN en una columna DECIMAL(14,2). No
    // fallaba nada: la fila entraba y a partir de ahí el saldo, el badge y el
    // archivo del contador decían todos «NaN».
    const res = await request(levantarApi())
      .post('/api/suppliers/10/payments')
      .send({ date: '2026-07-20', payment_method: 'transferencia' });

    expect(res.status).toBe(400);
    expect(mockSupplierMovement.filas).toHaveLength(1);
    expect(mockSupplierMovement.filas.some((m) => m.type === 'pago')).toBe(false);
  });

  it('un pago de cero o negativo se rechaza con un mensaje legible', async () => {
    for (const amount of [0, '0', -500, '-500', '', '  ', 'mil pesos', null]) {
      const res = await request(levantarApi())
        .post('/api/suppliers/10/payments')
        .send({ date: '2026-07-20', amount });

      expect(res.status).toBe(400);
      // Legible: dice qué corregir, no «Error al registrar el pago».
      expect(res.body.error).toBe('El monto del pago tiene que ser un número mayor que cero');
    }

    expect(mockSupplierMovement.filas).toHaveLength(1);
  });

  it('un pago mayor que el saldo SÍ se registra', async () => {
    // FR-089, y es el caso que impide que alguien «arregle» esto bloqueando los
    // adelantos: pagar por adelantado es legítimo y deja el saldo negativo, que
    // es la forma correcta de decir «el proveedor me debe a mí» (US6 esc. 6).
    // La confirmación con los dos números es de la pantalla.
    const res = await request(levantarApi())
      .post('/api/suppliers/10/payments')
      .send({ date: '2026-07-20', amount: 15000, payment_method: 'transferencia' });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(15000);

    const ficha = await request(levantarApi()).get('/api/suppliers/10');
    expect(ficha.body.data.saldo).toBe(-5000);
  });

  it('el importe llega a la base como número y no como el texto del formulario', async () => {
    // `amount: '15000.50'` en una columna DECIMAL entra igual, pero después
    // `resumenDeCuenta` suma sobre lo que guardó el cliente. Convertirlo acá es
    // lo que hace que la validación y la escritura miren el mismo valor.
    await request(levantarApi())
      .post('/api/suppliers/10/payments')
      .send({ date: '2026-07-20', amount: '15000.50' });

    const pago = mockSupplierMovement.filas.find((m) => m.type === 'pago');
    expect(pago.amount).toBe(15000.5);
  });

  it('el pago sobre un proveedor de otra empresa sigue dando 404 y no crea nada', async () => {
    // Es el arreglo de `dfd7009`, y la validación del importe se metió DESPUÉS
    // del findScoped justamente para no moverlo: ese findScoped es lo que ancla
    // la guardia `analizarCreates` a este archivo.
    const res = await request(levantarApi())
      .post('/api/suppliers/20/payments')
      .send({ date: '2026-07-20', amount: 1000 });

    expect(res.status).toBe(404);
    expect(mockSupplierMovement.filas.some((m) => m.type === 'pago')).toBe(false);
  });
});

// ─────────────────────────────────────────────
//  Parte 7 bis · PUT /api/suppliers/movements/:id — corregir un movimiento
//
//  Entre el `findScoped` y el `update` no había NINGUNA validación, y
//  `SupplierMovement.amount` es DECIMAL(14,2) sin `validate`. Es el único camino
//  del módulo que **escribe un número falso y lo deja escrito**: no revierte, no
//  avisa, y el saldo corrupto se propaga al listado, al badge, al bloqueo del
//  borrado y al archivo del contador, porque los cuatro salen de
//  `resumenDeCuenta`.
//
//  La regla ya existía y estaba aplicada en el endpoint hermano —`POST
//  /:id/payments` rechaza con 400 desde T1222—; lo que faltaba era llamarla acá.
// ─────────────────────────────────────────────

describe('PUT /api/suppliers/movements/:id', () => {
  // Tres movimientos y no uno: con una sola fila, un importe negativo y un tipo
  // convertido dan saldos que se parecen, y el caso no distinguiría cuál de los
  // dos agujeros quedó abierto. Y los importes son distintos entre sí por lo
  // mismo.
  beforeEach(() => {
    mockSupplierMovement.filas = [
      { id: 1, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '184000.00', date: '2026-07-01', notes: 'Recepción orden #118' },
      { id: 2, supplier_id: 10, empresa_id: PROPIA, type: 'deuda', amount: '88000.00', date: '2026-07-10', notes: 'Recepción orden #121' },
      { id: 3, supplier_id: 10, empresa_id: PROPIA, type: 'pago', amount: '150000.00', date: '2026-07-15', payment_method: 'tr', notes: 'Transferencia' },
      // De otra empresa, colgado del mismo proveedor.
      { id: 9, supplier_id: 10, empresa_id: AJENA, type: 'pago', amount: '999999.00', date: '2026-07-20' },
    ];
  });

  /** El saldo que ve la pantalla: el número que este endpoint podía corromper. */
  async function saldoDeLaFicha() {
    const res = await request(levantarApi()).get('/api/suppliers/10');
    return res.body.data.saldo;
  }

  it('un importe negativo NO se escribe: respondía 200 y le SUMABA plata al saldo', async () => {
    // **El peor defecto del hito.** `PUT /movements/3` con `{amount: -50000}`
    // respondía 200 ok:true, y a partir de ahí el saldo del proveedor estaba mal
    // en las cuatro pantallas que lo muestran.
    expect(await saldoDeLaFicha()).toBe(122000);

    const res = await request(levantarApi())
      .put('/api/suppliers/movements/3')
      .send({ amount: -50000 });

    expect(res.status).toBe(400);
    // Legible: dice qué corregir, y dice «movimiento» y no «pago», porque lo que
    // se está editando puede ser una deuda.
    expect(res.body.error).toBe('El monto del movimiento tiene que ser un número mayor que cero');

    // Y la fila quedó como estaba. Mirar solo el código de respuesta no alcanza:
    // el defecto no revertía nada, así que el daño está en la base y no en la
    // respuesta.
    expect(mockSupplierMovement.filas.find((m) => m.id === 3).amount).toBe('150000.00');
    expect(await saldoDeLaFicha()).toBe(122000);
  });

  it('un importe cero, vacío o ilegible tampoco se escribe', async () => {
    // `Number('')` y `Number(null)` son 0, y `Number('mil pesos')` es NaN: los
    // tres tienen que quedar afuera. Un movimiento de $0 no es una corrección,
    // es una fila que no dice nada; un NaN en DECIMAL(14,2) contagia el saldo
    // entero.
    for (const amount of [0, '0', -500, '-500', '', '  ', 'mil pesos', null]) {
      const res = await request(levantarApi())
        .put('/api/suppliers/movements/1')
        .send({ amount });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('El monto del movimiento tiene que ser un número mayor que cero');
    }

    expect(mockSupplierMovement.filas.find((m) => m.id === 1).amount).toBe('184000.00');
    expect(await saldoDeLaFicha()).toBe(122000);
  });

  it('editar un movimiento NO puede convertir una deuda en un pago', async () => {
    // `type` salió de la lista blanca y es una decisión escrita: el tipo es **de
    // dónde salió la fila**, no un campo que se corrija. Convertida en pago, la
    // fila mueve el saldo por el DOBLE del importe y su nota sigue diciendo
    // «Recepción orden #118», o sea que el asiento no se corresponde con nada.
    const res = await request(levantarApi())
      .put('/api/suppliers/movements/1')
      .send({ type: 'pago', notes: 'Recepción orden #118 — factura A' });

    expect(res.status).toBe(200);

    const fila = mockSupplierMovement.filas.find((m) => m.id === 1);
    expect(fila.type).toBe('deuda');
    // Y lo que SÍ es editable se editó: el endpoint no quedó ignorando el cuerpo
    // entero, que sería otra forma de romperlo.
    expect(fila.notes).toBe('Recepción orden #118 — factura A');

    expect(await saldoDeLaFicha()).toBe(122000);
  });

  it('una corrección legítima del importe sí entra, y mueve el saldo', async () => {
    // Lo que impide «arreglar» esto rechazando todo: un pago cargado por
    // $150.000 en vez de $120.000,50 tiene que poder corregirse, que es
    // exactamente para lo que existe el endpoint (FR-093).
    const res = await request(levantarApi())
      .put('/api/suppliers/movements/3')
      .send({ amount: '120000.50', notes: 'Transferencia corregida' });

    expect(res.status).toBe(200);
    // Número y no el texto del formulario, igual que en el alta del pago: la
    // validación y la escritura tienen que mirar el mismo valor.
    expect(mockSupplierMovement.filas.find((m) => m.id === 3).amount).toBe(120000.5);
    expect(await saldoDeLaFicha()).toBe(151999.5);
  });

  it('corregir solo la nota NO obliga a remandar el importe', async () => {
    // La edición es parcial. Validar `amount` siempre —y no solo cuando vino—
    // pondría un 400 en el camino de una corrección que ni toca la plata.
    const res = await request(levantarApi())
      .put('/api/suppliers/movements/1')
      .send({ notes: 'Factura A 0001-00012345' });

    expect(res.status).toBe(200);

    const fila = mockSupplierMovement.filas.find((m) => m.id === 1);
    expect(fila.amount).toBe('184000.00');
    expect(fila.notes).toBe('Factura A 0001-00012345');
    expect(await saldoDeLaFicha()).toBe(122000);
  });

  it('un movimiento de otra empresa con importe inválido responde 404 y no 400', async () => {
    // El orden importa: la validación va DESPUÉS del `findScoped`. Un 400
    // delante del 404 confirmaría que ese movimiento existe en otra empresa, que
    // es justo lo que permite enumerar ids ajenos.
    const res = await request(levantarApi())
      .put('/api/suppliers/movements/9')
      .send({ amount: -1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Movimiento no encontrado');
    expect(mockSupplierMovement.filas.find((m) => m.id === 9).amount).toBe('999999.00');
  });

  it('el cuerpo NO puede mudar el movimiento a otra empresa ni a otro proveedor', async () => {
    // La lista blanca ya estaba y este caso la ancla: sin ella, un pago propio
    // se reasignaba al proveedor de otro cliente sin crear nada, solo editando.
    const res = await request(levantarApi())
      .put('/api/suppliers/movements/3')
      .send({ amount: 150000, empresa_id: AJENA, supplier_id: 11 });

    expect(res.status).toBe(200);

    const fila = mockSupplierMovement.filas.find((m) => m.id === 3);
    expect(fila.empresa_id).toBe(PROPIA);
    expect(fila.supplier_id).toBe(10);
  });
});

// ─────────────────────────────────────────────
//  Parte 8 · El nombre repetido (T1246)
//
//  `models/Supplier.js:44` tiene un índice único `(empresa_id, name)`, y eso
//  está bien: dos «Nutrifit» en la misma lista son dos cuentas corrientes que
//  nadie sabe cuál es cuál. Lo que estaba mal era lo que se veía al chocar con
//  él —un 500 genérico— y lo que se vería si alguien sacara `fallo` del camino:
//  `err.message` de un SequelizeUniqueConstraintError trae el nombre del índice
//  y de la columna.
// ─────────────────────────────────────────────

describe('POST y PUT /api/suppliers con un nombre que ya existe', () => {
  /** El error tal como lo envuelve Sequelize sobre el 23505 de Postgres. */
  function choqueDeUnicidad() {
    const err = new Error(
      'Validation error: duplicate key value violates unique constraint "suppliers_empresa_id_name"'
    );
    err.name = 'SequelizeUniqueConstraintError';
    err.parent = { code: '23505', constraint: 'suppliers_empresa_id_name', table: 'suppliers' };
    return err;
  }

  // ⚠ Los dos dobles se guardan y se restauran: `crearModelo` los comparte con
  // todo el archivo, así que dejarlos pisados haría que cualquier caso que se
  // agregue después de este describe falle por un motivo que no está escrito en
  // ninguna parte.
  const createOriginal = mockSupplier.create;
  const findOneOriginal = mockSupplier.findOne;

  beforeEach(() => {
    mockSupplier.create = async () => { throw choqueDeUnicidad(); };
  });

  afterEach(() => {
    mockSupplier.create = createOriginal;
    mockSupplier.findOne = findOneOriginal;
  });

  it('un proveedor con el nombre de otro NO devuelve el error de constraint crudo', async () => {
    const res = await request(levantarApi())
      .post('/api/suppliers')
      .send({ name: 'Nutrifit' });

    // Nada de la estructura interna: ni el nombre del índice, ni el de la
    // tabla, ni «SequelizeUniqueConstraintError». Eso le sirve a quien busca
    // dónde apretar y no le dice nada a quien está cargando un proveedor.
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toContain('SequelizeUniqueConstraintError');
    expect(cuerpo).not.toContain('suppliers_empresa_id_name');
    expect(cuerpo).not.toContain('unique constraint');
  });

  it('el mensaje dice que ese nombre ya existe, y no «Error al crear el proveedor»', async () => {
    // Es una condición prevista que el usuario puede corregir solo: taparla con
    // el genérico de `fallo` manda a mirar los logs por un nombre repetido.
    const res = await request(levantarApi())
      .post('/api/suppliers')
      .send({ name: 'Nutrifit' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Nutrifit');
    expect(res.body.error).toContain('Ya existe un proveedor');
  });

  it('renombrar un proveedor con el nombre de otro dice lo mismo', async () => {
    // El índice muerde igual en el UPDATE, y hasta acá el PUT devolvía el mismo
    // 500 genérico que el POST. El doble se interviene en `findOne` y no en la
    // fila: `_hidratar` define su propio `update` **después** de esparcir la
    // fila, así que un `update` puesto en el arreglo no lo ve nadie.
    mockSupplier.findOne = async (opciones) => {
      const instancia = await findOneOriginal.call(mockSupplier, opciones);
      if (!instancia) return null;

      return { ...instancia, update: async () => { throw choqueDeUnicidad(); } };
    };

    const res = await request(levantarApi())
      .put('/api/suppliers/11')
      .send({ name: 'Nutrifit' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Ya existe un proveedor');
  });

  it('un fallo que NO es de unicidad sigue siendo un 500 genérico', async () => {
    // Lo que impide que la traducción se coma cualquier error: una base caída no
    // puede salir como «ese nombre ya existe», que manda a corregir un dato que
    // está bien.
    mockSupplier.create = async () => { throw new Error('connection terminated unexpectedly'); };

    const res = await request(levantarApi())
      .post('/api/suppliers')
      .send({ name: 'Molino Sur' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Error al crear el proveedor');
  });
});

// ─────────────────────────────────────────────
//  Parte 9 · GET /api/suppliers/orders?q= — la búsqueda que no viajaba (FR-009)
//
//  El endpoint aceptaba `supplier_id`, `status`, `from`, `to`, `limit` y
//  `offset`, y **no** `q`. La pantalla de órdenes buscaba entonces sobre las 50
//  filas que tenía cargadas mientras el servidor paginaba: buscar la orden 77
//  —que existe, en la página 2— respondía «ninguna orden coincide con el filtro»
//  y la red ni se tocaba. Es un **falso negativo**, y hace cerrar la búsqueda y
//  dar la orden por perdida.
//
//  ⚠ **Lo que estos casos verifican es la condición que sale hacia la base**, no
//  las filas que vuelven: el `translate()` y el `CAST` los ejecuta Postgres y los
//  dobles de `modelosFalsos` no saben evaluarlos. Es el mismo corte —y el mismo
//  motivo— que el caso «q filtra por nombre sin distinguir acentos» de
//  `GET /api/suppliers`, más arriba en este archivo.
//
//  El SQL que sale de acá se leyó contra el generador de consultas de Postgres,
//  y es lo que estos casos afirman por partes:
//
//    WHERE ((translate(lower("supplier"."name"), 'áàä…', 'aaa…') LIKE '%norte%'
//        OR CAST("SupplierOrder"."id" AS TEXT) LIKE '%norte%'))
//      AND "SupplierOrder"."empresa_id" = 7
// ─────────────────────────────────────────────

describe('GET /api/suppliers/orders', () => {
  beforeEach(() => {
    // `crearModelo` no tiene `findAndCountAll` —ningún test de este archivo lo
    // necesitaba— y es lo único que consulta `getOrders`. Se agrega acá y no en
    // el helper compartido, igual que `conDestroy` y `conOrdenYPaginacion`.
    mockSupplierOrder.findAndCountAll = async (opciones = {}) => {
      mockSupplierOrder.llamadas.push({ metodo: 'findAndCountAll', ...opciones });
      return { count: 0, rows: [] };
    };
  });

  /** El `where` con el que salió la consulta del listado. */
  const whereDelListado = () =>
    mockSupplierOrder.llamadas.find((l) => l.metodo === 'findAndCountAll').where;

  /**
   * Las condiciones que agregó la búsqueda, o `[]` si no agregó ninguna.
   *
   * Viajan bajo `Op.and` → `Op.or`, que son Symbols: `JSON.stringify` los borra
   * sin avisar, así que se leen por el símbolo.
   */
  function condicionesDeBusqueda() {
    const where = whereDelListado();
    if (!Object.getOwnPropertySymbols(where).includes(Op.and)) return [];

    return where[Op.and].flatMap((c) => c[Op.or] || [c]);
  }

  it('q busca por nombre de proveedor Y por número de orden', async () => {
    // FR-009. Son DOS condiciones y no una: el número es el dato que el
    // proveedor menciona por teléfono, y buscar solo por proveedor obliga a
    // recorrer la lista a ojo. Buscar solo por número deja afuera el caso más
    // común, que es acordarse del proveedor.
    const res = await request(levantarApi()).get('/api/suppliers/orders?q=NORT%C3%89');

    expect(res.status).toBe(200);

    const condiciones = condicionesDeBusqueda();
    expect(condiciones).toHaveLength(2);

    const [porNombre, porNumero] = condiciones;

    // El nombre, normalizado en la COLUMNA con el translate del núcleo de
    // Postgres, sobre el alias del include de `getOrders`.
    expect(JSON.stringify(porNombre.attribute)).toContain('translate');
    expect(JSON.stringify(porNombre.attribute)).toContain('supplier.name');
    expect(porNombre.logic[Op.like]).toBe('%norte%');

    // Y el número, comparado como TEXTO: `CAST(id AS TEXT) LIKE '%…%'`. Con
    // `id = Number(texto)` una búsqueda por nombre mandaría NaN a una columna
    // INTEGER, que es el 500 de Postgres que este listado ya cerró una vez.
    expect(JSON.stringify(porNumero.attribute)).toContain('SupplierOrder.id');
    expect(JSON.stringify(porNumero.attribute)).toContain('text');
    expect(porNumero.logic[Op.like]).toBe('%norte%');
  });

  it('«NORTÉ» y «norte» salen con el MISMO patrón: la búsqueda no distingue acentos', async () => {
    // FR-059, y es **el mismo criterio que `GET /suppliers`** a propósito: si
    // cada pantalla normalizara por su cuenta, buscar «Norté» encontraría al
    // proveedor en una y no en la otra, y no fallaría nada.
    await request(levantarApi()).get('/api/suppliers/orders?q=NORT%C3%89');
    const conAcento = condicionesDeBusqueda()[0].logic[Op.like];

    mockSupplierOrder.llamadas = [];
    await request(levantarApi()).get('/api/suppliers/orders?q=norte');
    const sinAcento = condicionesDeBusqueda()[0].logic[Op.like];

    expect(conAcento).toBe('%norte%');
    expect(conAcento).toBe(sinAcento);

    // Y la columna se normaliza con la MISMA lista que el texto: `translate()`
    // empareja las dos cadenas por posición, así que dos listas distintas
    // dejarían el patrón y la columna comparando cosas que no coinciden.
    expect(JSON.stringify(condicionesDeBusqueda()[0].attribute)).toContain(SIN_ACENTOS);
  });

  it('el # que la pantalla dibuja delante del número no se busca dentro del número', async () => {
    // La fila dice «#118» y quien copia el número se lo lleva puesto. Sin
    // sacarlo, `CAST(id AS TEXT) LIKE '%#118%'` no encuentra nunca nada: la
    // búsqueda respondería vacío sobre una orden que está a la vista.
    await request(levantarApi()).get('/api/suppliers/orders?q=%23118');

    expect(condicionesDeBusqueda()[1].logic[Op.like]).toBe('%118%');
  });

  it('un q vacío o de puros espacios NO es un filtro: sale como si no hubiera venido', async () => {
    // FR-020. El valor centinela con un espacio adentro ya rompió esta misma
    // pantalla una vez —`?supplier_id=%20` contra una columna INTEGER, 500 de
    // Postgres y la lista con lo anterior sin ningún aviso—. Un `q` de un
    // espacio no rompería nada: dejaría la lista **vacía**, porque
    // `LIKE '% %'` no matchea un nombre de una sola palabra, y se leería como
    // «no hay órdenes».
    for (const crudo of ['', '%20', '%20%20%20', '%23', '%20%23%20']) {
      mockSupplierOrder.llamadas = [];

      const res = await request(levantarApi()).get(`/api/suppliers/orders?q=${crudo}`);

      expect(res.status).toBe(200);
      expect(condicionesDeBusqueda()).toEqual([]);
      expect(whereDelListado()).toEqual({ empresa_id: PROPIA });
    }
  });

  it('sin q el where queda exactamente como estaba', async () => {
    // Lo que impide «arreglar» esto aplicando el filtro siempre: un listado sin
    // búsqueda no puede llevar una condición de texto encima. Es además la forma
    // exacta que afirma `aislamientoDeProveedores.test.js`.
    await request(levantarApi()).get('/api/suppliers/orders');

    expect(whereDelListado()).toEqual({ empresa_id: PROPIA });
  });

  it('la búsqueda se SUMA al empresa_id y a los demás filtros, no los reemplaza', async () => {
    // ⚠⚠ Es la regla que no se negocia. Un filtro nuevo escrito como
    // `const where = { [Op.and]: [...] }` devuelve las órdenes de TODAS las
    // empresas cliente en la misma respuesta —con el nombre del proveedor
    // adentro, paginadas— y no falla nada.
    await request(levantarApi())
      .get('/api/suppliers/orders?q=norte&status=pending&supplier_id=10&from=2026-07-01&to=2026-07-31');

    const where = whereDelListado();

    expect(where.empresa_id).toBe(PROPIA);
    expect(where.status).toBe('pending');
    expect(where.supplier_id).toBe(10);
    expect(where.date[Op.gte]).toBe('2026-07-01');
    expect(where.date[Op.lte]).toBe('2026-07-31');
    expect(condicionesDeBusqueda()).toHaveLength(2);
  });

  it('la búsqueda no se lleva puesta la paginación', async () => {
    // El `limit` y el `offset` tienen que seguir viajando: la búsqueda acota la
    // lista, no la convierte en una consulta sin paginar. Sin esto, buscar «a»
    // sobre tres años de órdenes pediría la tabla entera.
    await request(levantarApi()).get('/api/suppliers/orders?q=norte&limit=25&offset=50');

    const llamada = mockSupplierOrder.llamadas.find((l) => l.metodo === 'findAndCountAll');

    expect(llamada.limit).toBe(25);
    expect(llamada.offset).toBe(50);
  });

  it('el total que devuelve es el del COUNT de la búsqueda, no el largo de la página', async () => {
    // **Es la mitad que hace que la corrección sirva.** Con la búsqueda del lado
    // del servidor, `total` cuenta todas las que coinciden: de ese número salen
    // el badge del encabezado y la cantidad de páginas, así que la pantalla no
    // puede volver a decir «Órdenes 120» sobre una lista de una fila.
    mockSupplierOrder.findAndCountAll = async (opciones = {}) => {
      mockSupplierOrder.llamadas.push({ metodo: 'findAndCountAll', ...opciones });

      return {
        count: 3,
        rows: [{
          id: 77, supplier_id: 10, date: '2026-07-01', total: '1000',
          status: 'received', notes: null, detail: [],
        }],
      };
    };

    const res = await request(levantarApi()).get('/api/suppliers/orders?q=77&limit=1');

    expect(res.body.total).toBe(3);
    expect(res.body.data.map((o) => o.id)).toEqual([77]);
  });
});
