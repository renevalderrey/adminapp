// ⚠ baseDePruebas va PRIMERO: `config/database.js` arma la conexión al
// importarse, así que cualquier modelo cargado antes la dejaría apuntando a la
// base de desarrollo.
const { sequelize, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  US5 · El `down` de la migración, y la promesa del `up`, ejecutados
//
//  ── Por qué esto no se puede probar con un doble ──
//
//  `reversibilidadDeMigraciones.test.js` prueba con dobles las dos migraciones
//  que se niegan, y tiene razón: ahí la rama se toma **antes** de tocar la base,
//  con un `to_regclass` que un doble puede contestar. Acá no: la negativa
//  depende de un `COUNT(*) WHERE columna <> ROUND(columna)` sobre filas reales,
//  y la promesa del `up` es un `ALTER TYPE` sobre datos. Un doble contestaría lo
//  que se le pida y el test no diría nada.
//
//  Y `scripts/verificar-reversibilidad.js` tampoco alcanza: corre sobre un
//  Postgres **vacío**, donde no hay ninguna fila fraccionaria y la negativa no
//  se ejercita nunca. Que ahí revierta limpio es el resultado correcto, y es
//  justamente el caso que no prueba nada de lo de acá.
//
//  ── Cómo se corre un `down` sin dejar la base de pruebas en INTEGER ──
//
//  Cada caso abre una transacción propia y la **revierte** al terminar, y a la
//  migración se le pasa un `queryInterface` cuyo `sequelize.transaction(fn)`
//  abre un **SAVEPOINT** sobre ella. En Postgres el DDL es transaccional, así
//  que el esquema vuelve solo y los otros archivos de la suite no se enteran.
//  La técnica está en `models/Stock.js:213-227`, con el motivo escrito.
//
//  La alternativa —correr el `down` de verdad y volver a correr el `up`— se
//  descartó porque un fallo a mitad de camino dejaría la base en `INTEGER` y los
//  archivos siguientes fallarían por un motivo que no es el suyo.
//
//  ⚠ **Todas las consultas de este archivo van con `{ transaction }`.** Los
//  `ALTER TABLE` toman un `ACCESS EXCLUSIVE LOCK`, así que cualquier lectura por
//  otra conexión —un `Modelo.findOne()` suelto— se quedaría esperando hasta el
//  timeout en vez de fallar diciendo por qué.
// ════════════════════════════════════════════

const migracion = require('../../migrations/20260820-cantidades-decimales');

const { Catalogo, Pedido, PedidoItem, StockMovement } = modelos;

/** El tipo que la migración escribe, armado desde sus propias constantes. */
const NUMERICO = `numeric(${migracion.PRECISION},${migracion.ESCALA})`;

let datos;
/** La transacción externa: todo pasa adentro y se revierte al terminar. */
let externa;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  // ── Las cuatro tablas con filas ANTES de tocar el esquema ──
  //
  // La fixture deja `stock` y `sale_items` con filas, y `stock_movements` y
  // `pedido_items` **vacías**. Sobre una tabla vacía las dos comprobaciones del
  // `up` pasan siempre y no verifican nada (criterio de éxito 8), así que las
  // dos que faltan se siembran acá: es la diferencia entre «la migración cumplió
  // su promesa» y «la migración no tenía nada sobre qué cumplirla».
  await StockMovement.create({
    empresa_id: datos.empresaA.id,
    product_id: datos.harina.id,
    punto_de_venta_id: datos.centroA.id,
    tipo: 'manual',
    cantidad_anterior: 20,
    cantidad_nueva: 17,
    disponible_anterior: 20,
    disponible_nuevo: 17,
  });

  const catalogo = await Catalogo.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    slug: 'reversion',
    nombre_visible: 'Tienda de A',
  });

  const pedido = await Pedido.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    catalogo_id: catalogo.id,
    numero: 1,
    comprador_nombre: 'Martina Olivera',
    comprador_telefono: '5493425123456',
    entrega: 'retiro_local',
    subtotal: 1000,
    total: 1000,
    medio_pago: 'efectivo',
    idempotency_key: 'reversion-1',
  });

  await PedidoItem.create({
    pedido_id: pedido.id,
    product_id: datos.harina.id,
    nombre: 'Harina 000',
    precio_unitario: 500,
    precio_lista: 500,
    cantidad: 2,
    subtotal: 1000,
  });

  externa = await sequelize.transaction();
});

afterEach(async () => {
  // Sin esto el esquema quedaría revertido para los archivos siguientes. Va en
  // `afterEach` y no al final de cada caso justamente para que un test que falla
  // a la mitad tampoco se lo lleve puesto.
  if (externa) await externa.rollback();
  externa = null;
});

afterAll(async () => {
  await cerrar();
});

/**
 * El `queryInterface` que recibe la migración: su `transaction(fn)` abre un
 * SAVEPOINT sobre la transacción del test en vez de una transacción nueva.
 *
 * `sequelize.transaction({ transaction })` es exactamente lo que hace
 * `models/Stock.js:225` para que el fallo de una cola no se lleve puesta la
 * venta: la diferencia es que allá el savepoint protege a lo de afuera y acá
 * deja que lo de adentro se revierta con el test.
 */
function queryInterfaceDelTest() {
  return {
    sequelize: {
      transaction: (fn) => sequelize.transaction({ transaction: externa }, fn),
      query: (sql, opciones) => sequelize.query(sql, opciones),
    },
  };
}

/** Una consulta adentro de la transacción del test. */
async function filas(sql) {
  const [resultado] = await sequelize.query(sql, { transaction: externa });
  return resultado;
}

/** Cómo está declarada hoy cada una de las nueve columnas, según la base. */
async function tiposDeLasNueve() {
  const encontradas = await filas(`
    SELECT table_name || '.' || column_name AS col,
           data_type, numeric_precision AS p, numeric_scale AS e
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
             ${migracion.COLUMNAS.map(({ tabla, columna }) => `('${tabla}', '${columna}')`).join(', ')}
           )
  `);

  return Object.fromEntries(encontradas.map((f) => [
    f.col,
    f.data_type === 'numeric' ? `numeric(${f.p},${f.e})` : f.data_type,
  ]));
}

/** Lo mismo, pero como una sola cadena por columna, para afirmar las nueve juntas. */
function todasEn(tipos, esperado) {
  return migracion.COLUMNAS.map(({ tabla, columna }) => `${tabla}.${columna}=${tipos[`${tabla}.${columna}`]}`)
    .filter((linea) => !linea.endsWith(`=${esperado}`));
}

/**
 * El valor de cada fila de las cuatro tablas, como número.
 *
 * Se comparan **números** y no el texto crudo a propósito: el `20` de una
 * columna `INTEGER` y el `"20.0000"` de una `NUMERIC(14,4)` son el mismo valor
 * escrito distinto, y lo que hay que afirmar es que ningún valor se movió. Un
 * `20` que se volvió `19` sí cambia.
 */
async function fotoDeLosValores() {
  const stock = await filas('SELECT id, quantity, available, min_stock FROM stock ORDER BY id');
  const lineas = await filas('SELECT id, quantity FROM sale_items ORDER BY id');
  const movimientos = await filas(`
    SELECT id, cantidad_anterior, cantidad_nueva, disponible_anterior, disponible_nuevo
      FROM stock_movements ORDER BY id`);
  const items = await filas('SELECT id, cantidad FROM pedido_items ORDER BY id');

  return {
    stock: stock.map((f) => `${f.id}:${Number(f.quantity)}:${Number(f.available)}:${Number(f.min_stock)}`),
    sale_items: lineas.map((f) => `${f.id}:${Number(f.quantity)}`),
    stock_movements: movimientos.map((f) => [
      f.id, Number(f.cantidad_anterior), Number(f.cantidad_nueva),
      Number(f.disponible_anterior), Number(f.disponible_nuevo),
    ].join(':')),
    pedido_items: items.map((f) => `${f.id}:${Number(f.cantidad)}`),
  };
}

/** Cuántas filas hay en cada tabla que la migración convierte. */
async function conteos() {
  const [f] = await filas(`
    SELECT (SELECT COUNT(*)::int FROM stock)           AS stock,
           (SELECT COUNT(*)::int FROM sale_items)      AS sale_items,
           (SELECT COUNT(*)::int FROM stock_movements) AS stock_movements,
           (SELECT COUNT(*)::int FROM pedido_items)    AS pedido_items
  `);

  return f;
}

describe('El `down` se niega cuando revertir perdería cantidades', () => {
  /** Deja una fila de stock en 10,5 dentro de la transacción del test. */
  async function unaFilaFraccionaria() {
    await filas(`
      UPDATE stock SET quantity = 10.5, available = 10.5
       WHERE product_id = ${datos.harina.id} AND punto_de_venta_id = ${datos.centroA.id}`);
  }

  it('nombra la TABLA y CUÁNTAS filas, que es lo que hay que ir a mirar', async () => {
    await unaFilaFraccionaria();

    const error = await migracion.down(queryInterfaceDelTest()).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    // Un `rejects.toThrow()` a secas dejaría pasar un `throw new Error('no')`, y
    // el mensaje es la mitad del comportamiento: quien corre un `undo` reflejo
    // después de un deploy raro tiene que saber qué mirar.
    expect(error.message).toContain('stock tiene 1 fila(s) con cantidades fraccionarias');
  });

  it('dice qué hacer si igual hace falta, y que no se aplicó nada', async () => {
    await unaFilaFraccionaria();

    const error = await migracion.down(queryInterfaceDelTest()).catch((e) => e);

    for (const frase of ['a mano', 'inventar inventario', 'No se aplicó nada']) {
      expect(error.message).toContain(frase);
    }
  });

  it('y NO revierte ninguna de las nueve columnas: se niega antes de tocar el esquema', async () => {
    // La otra mitad del «no se aplicó nada». Sin esto, una negativa que primero
    // revirtiera tres columnas y después tirara pasaría este archivo entero.
    await unaFilaFraccionaria();

    await migracion.down(queryInterfaceDelTest()).catch(() => {});

    expect(todasEn(await tiposDeLasNueve(), NUMERICO)).toEqual([]);
  });

  it('una fracción en OTRA tabla también lo detiene, no solo las de `stock`', async () => {
    // Las nueve columnas se cuentan por tabla y por fila. Sin este caso, un
    // `down` que solo mirara `stock` —la tabla obvia— pasaría igual, y la línea
    // de venta fraccionaria se redondearía al revertir.
    await filas(`UPDATE sale_items SET quantity = 0.25 WHERE id = (SELECT MIN(id) FROM sale_items)`);

    const error = await migracion.down(queryInterfaceDelTest()).catch((e) => e);

    expect(error.message).toContain('sale_items tiene 1 fila(s)');
  });
});

describe('Sin fracciones, el `down` revierte limpio', () => {
  it('las nueve columnas vuelven a INTEGER', async () => {
    // Control previo: si ya estuvieran en `integer`, este caso pasaría sin que
    // el `down` hiciera nada.
    expect(todasEn(await tiposDeLasNueve(), NUMERICO)).toEqual([]);

    await migracion.down(queryInterfaceDelTest());

    expect(todasEn(await tiposDeLasNueve(), 'integer')).toEqual([]);
  });

  it('y no se pierde ni se mueve ningún valor', async () => {
    const antes = await fotoDeLosValores();

    // El ancla: sobre tablas vacías esta comparación se cumple sola.
    expect(await conteos()).toEqual({
      stock: 4, sale_items: 2, stock_movements: 1, pedido_items: 1,
    });

    await migracion.down(queryInterfaceDelTest());

    expect(await fotoDeLosValores()).toEqual(antes);
  });

  it('correrlo dos veces no falla: la segunda ve todo en INTEGER y no toca nada', async () => {
    await migracion.down(queryInterfaceDelTest());

    await expect(migracion.down(queryInterfaceDelTest())).resolves.toBeUndefined();

    expect(todasEn(await tiposDeLasNueve(), 'integer')).toEqual([]);
  });
});

describe('La promesa del `up`, verificada sobre filas de verdad', () => {
  it('convierte las nueve y ninguna fila cambia de valor', async () => {
    // ⚠ El orden importa y es lo que hace que este caso valga: se revierte
    // primero para poder correr el `up` de verdad, **con las filas ya
    // sembradas**. Sobre una base vacía las dos comprobaciones del `up` pasan
    // siempre y no verifican nada (criterio de éxito 8).
    const antes = await fotoDeLosValores();

    expect(await conteos()).toEqual({
      stock: 4, sale_items: 2, stock_movements: 1, pedido_items: 1,
    });

    await migracion.down(queryInterfaceDelTest());
    expect(todasEn(await tiposDeLasNueve(), 'integer')).toEqual([]);

    await migracion.up(queryInterfaceDelTest());

    expect(todasEn(await tiposDeLasNueve(), NUMERICO)).toEqual([]);
    expect(await fotoDeLosValores()).toEqual(antes);
  });

  it('corrido dos veces seguidas, la segunda no toca nada', async () => {
    await migracion.down(queryInterfaceDelTest());
    await migracion.up(queryInterfaceDelTest());

    // La segunda corrida sale por «ya estaban las nueve» y ni siquiera crea la
    // foto de control: es lo que hace que un `ALTER TYPE` no reescriba cuatro
    // tablas para nada, y lo que evita que FR-005 aborte una migración por hacer
    // bien su trabajo sobre una base que ya tiene fracciones legítimas.
    await expect(migracion.up(queryInterfaceDelTest())).resolves.toBeUndefined();

    expect(todasEn(await tiposDeLasNueve(), NUMERICO)).toEqual([]);
  });

  it('si una columna quedó fraccionaria, ABORTA y no deja nada aplicado', async () => {
    // El caso que FR-005 existe para atajar, construido a propósito: se revierte
    // todo a `INTEGER`, se deja **una sola** columna en `numeric(12,4)` —o sea
    // pendiente para la migración, porque la escala no es la suya— y se le mete
    // una fracción. Antes de convertir, las nueve columnas eran enteras; que
    // después haya una fracción significa que algo pasó que no tenía que pasar.
    await migracion.down(queryInterfaceDelTest());

    await filas('ALTER TABLE stock ALTER COLUMN quantity TYPE NUMERIC(12,4)');
    await filas(`
      UPDATE stock SET quantity = 10.5
       WHERE product_id = ${datos.harina.id} AND punto_de_venta_id = ${datos.centroA.id}`);

    const error = await migracion.up(queryInterfaceDelTest()).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('stock.quantity (1 fila(s))');
    expect(error.message).toContain('No se aplicó nada');

    // Y «no se aplicó nada» es literal: las otras ocho siguen en `integer` y la
    // que estaba en 12,4 sigue en 12,4. Sin esta mitad, una migración que
    // convirtiera ocho columnas y después tirara pasaría el caso de arriba.
    const tipos = await tiposDeLasNueve();

    expect(tipos['stock.quantity']).toBe('numeric(12,4)');
    expect(tipos['sale_items.quantity']).toBe('integer');
    expect(tipos['pedido_items.cantidad']).toBe('integer');
    expect(tipos['stock_movements.cantidad_anterior']).toBe('integer');
  });
});
