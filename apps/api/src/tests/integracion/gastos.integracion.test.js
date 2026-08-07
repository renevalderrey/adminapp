// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  Gastos · G2, G4 y G8 ejecutados contra Postgres
//
//  Tres cosas que solo este nivel puede contestar:
//
//  1. **G2 · El total lo suma el servidor, y `amount` vuelve como STRING.**
//     `amount` es `DECIMAL(12,2)` y el driver de Postgres lo entrega como
//     texto. Contra un doble esa forma no existe: `tests/helpers/modelosFalsos.js`
//     devuelve lo que se le sembró, así que un test escrito ahí probaría el
//     doble. Acá el total tiene que cerrar **al centavo** con importes que en
//     punto flotante no cierran.
//
//  2. **G4 · La sucursal de otra empresa no se puede colgar de un gasto.** Una
//     guardia estática ve que se llamó a `findScoped`; lo que no puede ver es
//     que la fila NO haya quedado escrita. Por eso cada caso cuenta las filas
//     antes y después: un 404 con la fila creada igual sería un verde falso.
//
//  3. **G8 · El alcance.** `GET /api/expenses` devuelve la empresa entera y lo
//     dice en la respuesta, a diferencia de `/faltantes`, que cae a
//     `req.puntoDeVentaId`.
//
//  ── La fixture está elegida para poder distinguir el defecto ──
//
//   · **Los importes tienen centavos que no cierran en punto flotante.** Es la
//     trampa que este repositorio ya pagó varias veces: con importes redondos,
//     sumar en centavos y sumar con `parseFloat` dan exactamente lo mismo y la
//     corrección se puede sacar sin que nada se ponga rojo.
//   · **Hay al menos un gasto SIN sucursal.** Sin él, `sin_sucursal` da 0 con y
//     sin la corrección, y «General» no se puede distinguir de un bucket vacío.
//   · **Hay una sucursal de la empresa B**, que es contra la que se intenta
//     colgar el gasto ajeno.
//   · **Un gasto de la empresa B con importe grande**: si el `where` de
//     `empresa_id` se cayera, el total se dispara en vez de quedar parecido.
// ════════════════════════════════════════════

const { FixedExpense, GastoVariable, Empresa } = modelos;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  // 180000,10 + 0,20 + 12345,67 + 42500,10 + 0,20 = 234846,27
  //
  // Sumado con `parseFloat` acumulado, el residuo aparece en el decimotercer
  // decimal: es lo que hace que `toBe(234846.27)` distinga las dos sumas.
  await FixedExpense.bulkCreate([
    { empresa_id: datos.empresaA.id, name: 'Alquiler', amount: 180000.10, punto_de_venta_id: datos.centroA.id, group: 'pv_1' },
    { empresa_id: datos.empresaA.id, name: 'Expensas', amount: 0.20, punto_de_venta_id: datos.centroA.id, group: 'pv_1' },
    { empresa_id: datos.empresaA.id, name: 'Luz de la sucursal', amount: 12345.67, punto_de_venta_id: datos.norteA.id, group: 'pv_2' },
    // Los dos sin sucursal, con el `group` que dejó el legacy: es la fila que
    // la pantalla vieja no dibujaba en ninguna parte.
    { empresa_id: datos.empresaA.id, name: 'Sueldos', amount: 42500.10, punto_de_venta_id: null, group: 'gf1' },
    { empresa_id: datos.empresaA.id, name: 'Contador', amount: 0.20, punto_de_venta_id: null, group: 'gf2' },
    // De la empresa B, y grande: si el filtro por empresa se cayera, el total
    // no se parecería al correcto, se dispararía.
    { empresa_id: datos.empresaB.id, name: 'Alquiler del kiosco', amount: 999999.99, punto_de_venta_id: datos.localB.id, group: 'pv_3' },
  ]);
});

afterAll(async () => {
  await cerrar();
});

describe('GET /api/expenses · los totales los calcula el servidor, en centavos', () => {
  it('el total general es la suma de las tarjetas, incluida General', async () => {
    const res = await request(app).get('/api/expenses');

    expect(res.status).toBe(200);

    const { totales } = res.body;
    const porSucursal = totales.por_sucursal;

    // Cada tarjeta.
    expect(porSucursal[String(datos.centroA.id)]).toBe(180000.30);
    expect(porSucursal[String(datos.norteA.id)]).toBe(12345.67);
    expect(totales.sin_sucursal).toBe(42500.30);

    // Y el general, que tiene que ser la suma de las tres. Se afirma la
    // igualdad **además** del literal: el literal dice cuánto da, la suma dice
    // que las tarjetas y el total no se pueden separar (FR-023).
    expect(totales.general).toBe(234846.27);

    const suma = Object.values(porSucursal).reduce((a, b) => a + b, 0) + totales.sin_sucursal;
    expect(Math.round(suma * 100)).toBe(Math.round(totales.general * 100));
  });

  it('el SUM de un DECIMAL vuelve como string y el total igual cierra al centavo', async () => {
    // La premisa, escrita para que se vea: lo que llega de la base es TEXTO.
    // Sumarlo con `parseFloat` acumulado deja residuo —180000.1 + 0.2 no da
    // 180000.3 en punto flotante— y ese residuo llega al navegador.
    const res = await request(app).get('/api/expenses');

    const alquiler = res.body.data.find((g) => g.name === 'Alquiler');
    expect(typeof alquiler.amount).toBe('string');
    expect(alquiler.amount).toBe('180000.10');

    // El total NO es un string con residuo ni un número con cola.
    expect(res.body.totales.por_sucursal[String(datos.centroA.id)]).toBe(180000.30);
    expect(String(res.body.totales.general)).toBe('234846.27');
  });

  it('las filas son las de la empresa de la sesión: el gasto de B no entra en ningún total', async () => {
    const res = await request(app).get('/api/expenses');

    expect(res.body.data.map((g) => g.name).sort()).toEqual([
      'Alquiler', 'Contador', 'Expensas', 'Luz de la sucursal', 'Sueldos',
    ]);
    expect(res.body.totales.general).toBe(234846.27);
  });

  it('el alcance es la empresa entera y lo dice (G8, FR-037)', async () => {
    // A diferencia de `/faltantes`, que cae a `req.puntoDeVentaId`: recortar
    // por la sucursal activa dejaría los otros grupos vacíos sin decir por qué.
    const res = await request(app)
      .get('/api/expenses')
      .set('X-Punto-De-Venta-Id', String(datos.norteA.id));

    expect(res.body.alcance).toBe('empresa');
    expect(res.body.data).toHaveLength(5);
    expect(res.body.totales.general).toBe(234846.27);
  });

  it('el filtro ?group= dejó de aceptarse: la columna no significa nada', async () => {
    // Antes, `?group=gf1` devolvía una sola fila. La columna es el resto de la
    // migración del legacy y nadie la lee; que el endpoint la siguiera
    // aceptando como filtro la mantenía viva.
    const res = await request(app).get('/api/expenses').query({ group: 'gf1' });

    expect(res.body.data).toHaveLength(5);
    expect(res.body.totales.general).toBe(234846.27);
  });
});

describe('POST /api/expenses · el padre ajeno y el cuerpo del request', () => {
  it('con la sucursal de otra empresa responde 404 y NO crea ninguna fila', async () => {
    const antes = await FixedExpense.count();

    const res = await request(app)
      .post('/api/expenses')
      .send({ name: 'Gasto colado', amount: 1000, punto_de_venta_id: datos.localB.id });

    // 404 y no 403: un recurso ajeno no existe, y un 403 confirmaría que sí.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Punto de venta no encontrado');

    // Lo que una guardia estática no puede ver: que la fila no quedó escrita.
    expect(await FixedExpense.count()).toBe(antes);
  });

  it('un empresa_id en el cuerpo no cambia de dueño el gasto', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send({ name: 'Seguro', amount: 5000, empresa_id: datos.empresaB.id, id: 999 });

    expect(res.status).toBe(201);

    const creado = await FixedExpense.findOne({ where: { name: 'Seguro' } });

    expect(creado.empresa_id).toBe(datos.empresaA.id);
    expect(creado.id).not.toBe(999);
  });

  it('el `group` del cuerpo se ignora: lo escribe el servidor o lo pone la base', async () => {
    const conSucursal = await request(app)
      .post('/api/expenses')
      .send({ name: 'Wifi', amount: 100, punto_de_venta_id: datos.centroA.id, group: 'inventado' });

    expect(conSucursal.status).toBe(201);
    expect(conSucursal.body.data.group).toBe(`pv_${datos.centroA.id}`);
  });

  it('un alta SIN sucursal se guarda igual: la columna NOT NULL la llena el servidor', async () => {
    // ⚠ **Es el modo de falla que T1368 podía introducir el día del deploy, y
    // `data-model.md` lo describe mal.** Dice que sin `defaultValue` en el
    // modelo el `create` «usa el DEFAULT de la base y no falla». No es cierto:
    // `group` es `allowNull: false` en el modelo, así que Sequelize valida
    // ANTES de armar el INSERT y tira `notNull Violation` — el `DEFAULT 'gf1'`
    // de Postgres no llega a intervenir porque la sentencia no se emite.
    //
    // Verificado ejecutándolo: sin `grupoDe()` en la ruta, este alta responde
    // 500 y el primer gasto fijo que alguien cargue después del deploy falla.
    const res = await request(app)
      .post('/api/expenses')
      .send({ name: 'Monotributo', amount: 33333.33 });

    expect(res.status).toBe(201);
    expect(res.body.data.punto_de_venta_id).toBeNull();
    expect(res.body.data.group).toBe('general');

    const guardado = await FixedExpense.findByPk(res.body.data.id);
    expect(guardado.group).toBe('general');
  });

  it('el modelo YA NO le pone «gf1» a un gasto nuevo', async () => {
    // La otra mitad de T1368: la columna sigue existiendo pero deja de
    // sembrarse con el grupo del legacy, que significa «Ortiz de Ocampo» en
    // Comprafit y nada en cualquier otra empresa.
    const res = await request(app)
      .post('/api/expenses')
      .send({ name: 'ART', amount: 1000, punto_de_venta_id: datos.norteA.id });

    expect(res.body.data.group).toBe(`pv_${datos.norteA.id}`);
    expect(res.body.data.group).not.toBe('gf1');
  });

  it('el gasto sin sucursal entra en el total de General y en el general', async () => {
    await request(app).post('/api/expenses').send({ name: 'Monotributo', amount: 33333.33 });

    const res = await request(app).get('/api/expenses');

    expect(res.body.totales.sin_sucursal).toBe(75833.63);
    expect(res.body.totales.general).toBe(268179.60);
  });
});

describe('PUT /api/expenses/:id · la misma lista blanca y la misma validación', () => {
  it('mover un gasto a la sucursal de otra empresa responde 404 y lo deja como estaba', async () => {
    const gasto = await FixedExpense.findOne({ where: { name: 'Alquiler' } });

    const res = await request(app)
      .put(`/api/expenses/${gasto.id}`)
      .send({ punto_de_venta_id: datos.localB.id });

    expect(res.status).toBe(404);

    await gasto.reload();
    expect(gasto.punto_de_venta_id).toBe(datos.centroA.id);
  });

  it('editar un gasto cambia nombre e importe, y NO el empresa_id del cuerpo', async () => {
    const gasto = await FixedExpense.findOne({ where: { name: 'Sueldos' } });

    const res = await request(app)
      .put(`/api/expenses/${gasto.id}`)
      .send({ name: 'Sueldos y cargas', amount: 50000.55, empresa_id: datos.empresaB.id, group: 'colado' });

    expect(res.status).toBe(200);

    await gasto.reload();
    expect(gasto.name).toBe('Sueldos y cargas');
    expect(gasto.amount).toBe('50000.55');
    expect(gasto.empresa_id).toBe(datos.empresaA.id);
    // El `group` del cuerpo se ignora: el PUT no lo tocó porque tampoco vino
    // `punto_de_venta_id`, así que quedó el del legacy.
    expect(gasto.group).toBe('gf1');
  });

  it('un gasto de otra empresa no se puede editar', async () => {
    const ajeno = await FixedExpense.findOne({ where: { name: 'Alquiler del kiosco' } });

    const res = await request(app)
      .put(`/api/expenses/${ajeno.id}`)
      .send({ amount: 1 });

    expect(res.status).toBe(404);

    await ajeno.reload();
    expect(ajeno.amount).toBe('999999.99');
  });

  it('asignarle una sucursal propia a un gasto de General lo mueve de tarjeta', async () => {
    const gasto = await FixedExpense.findOne({ where: { name: 'Contador' } });

    const res = await request(app)
      .put(`/api/expenses/${gasto.id}`)
      .send({ punto_de_venta_id: datos.norteA.id });

    expect(res.status).toBe(200);

    const listado = await request(app).get('/api/expenses');

    expect(listado.body.totales.sin_sucursal).toBe(42500.10);
    expect(listado.body.totales.por_sucursal[String(datos.norteA.id)]).toBe(12345.87);
    // El total general no se movió: la plata cambió de tarjeta, no de cantidad.
    expect(listado.body.totales.general).toBe(234846.27);
  });
});

describe('Gastos variables · la misma sucursal ajena, por las otras dos puertas', () => {
  it('un gasto variable no se cuelga de la sucursal de otra empresa', async () => {
    const antes = await GastoVariable.count();

    const res = await request(app)
      .post('/api/gastos-variables')
      .send({ persona: 'Rita', nombre: 'Nafta', monto: 5000, mes: '2026-08', punto_de_venta_id: datos.localB.id });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Punto de venta no encontrado');
    expect(await GastoVariable.count()).toBe(antes);
  });

  it('editar un gasto variable tampoco lo puede mover a la sucursal de otra empresa', async () => {
    const creado = await GastoVariable.create({
      empresa_id: datos.empresaA.id, persona: 'Rita', mes: '2026-08',
      nombre: 'Peaje', monto: 1200, punto_de_venta_id: datos.centroA.id,
    });

    const res = await request(app)
      .put(`/api/gastos-variables/${creado.id}`)
      .send({ punto_de_venta_id: datos.localB.id });

    expect(res.status).toBe(404);

    await creado.reload();
    expect(creado.punto_de_venta_id).toBe(datos.centroA.id);
  });

  it('la sucursal propia sí se guarda, y el vacío sigue siendo un caso legítimo', async () => {
    const conSucursal = await request(app)
      .post('/api/gastos-variables')
      .send({ persona: 'Rita', nombre: 'Nafta', monto: 5000, mes: '2026-08', punto_de_venta_id: datos.norteA.id });

    expect(conSucursal.status).toBe(201);
    expect(conSucursal.body.data.punto_de_venta_id).toBe(datos.norteA.id);

    const sinSucursal = await request(app)
      .post('/api/gastos-variables')
      .send({ persona: 'Rita', nombre: 'Café', monto: 800, mes: '2026-08', punto_de_venta_id: '' });

    expect(sinSucursal.status).toBe(201);
    expect(sinSucursal.body.data.punto_de_venta_id).toBeNull();
  });
});

// ════════════════════════════════════════════
//  El mes por defecto sale de la zona del negocio (G6, FR-035)
//
//  `new Date().toISOString().slice(0, 7)` da el mes en UTC. Argentina es UTC−3:
//  el 31 a las 22:00 hora local, en UTC ya es el 1 del mes siguiente. El gasto
//  cargado esa noche quedaba archivado en el mes que viene y el listado abría en
//  un mes vacío — todos los meses, y solo a esa hora, que es cuando nadie mira
//  el campo.
//
//  ⚠ **El reloj se congela a mano y NO con `jest.useFakeTimers()`**: los timers
//  falsos alcanzan al pool de Postgres y a supertest, y un request que espera un
//  timer que nadie avanza se cuelga hasta el timeout. Acá se reemplaza solo el
//  `new Date()` SIN argumentos —que es el único que `fechaDelNegocio` usa— y se
//  restaura en un `finally`, para que el archivo siguiente no herede el reloj.
// ════════════════════════════════════════════

const DateReal = Date;

/** Congela el `new Date()` sin argumentos en un instante, y devuelve cómo deshacerlo. */
function congelarElReloj(iso) {
  const fijo = new DateReal(iso);

  global.Date = class extends DateReal {
    constructor(...args) {
      super(...(args.length === 0 ? [fijo.getTime()] : args));
    }

    static now() {
      return fijo.getTime();
    }
  };

  return () => { global.Date = DateReal; };
}

describe('El mes por defecto de los gastos variables no adelanta el día', () => {
  it('a las 22:00 de Buenos Aires el mes por defecto sigue siendo el de acá y no el de mañana en UTC', async () => {
    // 2026-08-01T01:00:00Z son las 22:00 del 31 de julio en Buenos Aires.
    const descongelar = congelarElReloj('2026-08-01T01:00:00.000Z');

    try {
      // La premisa, para que el test no pase por la razón equivocada.
      expect(new Date().toISOString().slice(0, 7)).toBe('2026-08');

      const res = await request(app).get('/api/gastos-variables');

      expect(res.status).toBe(200);
      expect(res.body.data.mes).toBe('2026-07');
    } finally {
      descongelar();
    }
  });

  it('la zona sale de la empresa, no de la máquina: con otra zona el mes es otro', async () => {
    // Sin esto, el caso de arriba pasaría igual en una máquina configurada en
    // Buenos Aires aunque el servidor leyera la zona del sistema operativo.
    await Empresa.update(
      { timezone: 'Pacific/Kiritimati' }, // UTC+14
      { where: { id: datos.empresaA.id } }
    );

    const descongelar = congelarElReloj('2026-08-01T01:00:00.000Z');

    try {
      const res = await request(app).get('/api/gastos-variables');

      expect(res.body.data.mes).toBe('2026-08');
    } finally {
      descongelar();
    }
  });

  it('el mes que trae la lista de meses es el mismo que el del listado', async () => {
    const descongelar = congelarElReloj('2026-08-01T01:00:00.000Z');

    try {
      const meses = await request(app).get('/api/gastos-variables/meses');

      expect(meses.body.data[0]).toBe('2026-07');
    } finally {
      descongelar();
    }
  });
});
