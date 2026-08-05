// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  Los importes: DECIMAL vuelve como string, y el centavo tiene que cerrar
//
//  El encabezado de `tests/helpers/modelosFalsos.js` nombra este caso como EL
//  ejemplo de lo que los dobles no atrapan: «un bug que solo aparece contra
//  Postgres real —por ejemplo, DECIMAL devuelto como string— NO lo atrapan».
//  Los dobles guardan y devuelven el número de JavaScript que les pasaron; el
//  driver de Postgres devuelve **texto**, siempre, para no perder precisión.
//
//  De ahí salen dos familias de defecto distintas:
//
//   1. **Comparaciones que se coercionan.** `'0.00' <= 0` es `true` y
//      `'0.00' === 0` es `false`: la misma columna contesta que sí y que no
//      según con qué se la compare, y nada falla.
//   2. **Sumas que concatenan.** `Sale.sum('total')` vuelve como string. Sin
//      convertirlo, el encabezado de la pantalla y la columna Total del archivo
//      exportado dejan de coincidir sin que nada avise.
//
//  Lo que estos tests fijan es DÓNDE tiene que estar convertido y dónde no:
//  el `total` de una venta viaja como string —es el valor tal cual está en la
//  base— y todo lo que se suma o se compara llega como número.
// ════════════════════════════════════════════

const { Sale } = modelos;

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

/** El rango que cubre las ventas de la fixture, y todas las sucursales. */
const TODO_JULIO = { desde: '2026-07-01', hasta: '2026-07-31', punto_de_venta_id: 'todas' };

describe('Un DECIMAL que vuelve como string no rompe nada río abajo', () => {
  it('el total de una venta viaja como string, que es lo que hay en la base', async () => {
    const res = await request(app).get(`/api/sales/${datos.ventaA.id}`);

    expect(res.status).toBe(200);
    // Es un hecho del driver, no una preferencia. Queda escrito para que quien
    // agregue una comparación río abajo sepa contra qué compara.
    expect(res.body.data.total).toBe('2469.12');
    expect(typeof res.body.data.total).toBe('string');
  });

  it('el total del período SÍ es un número, y es la suma exacta de las filas', async () => {
    // Dos ventas de centavos sueltos: 0,10 + 0,20 es 0,30000000000000004 en
    // punto flotante. La suma la hace Postgres y la convierte `totalDelPeriodo`.
    await Sale.bulkCreate([
      {
        id: 'VENTA-A-0002', empresa_id: datos.empresaA.id, punto_de_venta_id: datos.centroA.id,
        date: '2026-07-16', time: '09:00', total: 0.10, payment_method: 'ef', status: 'active',
      },
      {
        id: 'VENTA-A-0003', empresa_id: datos.empresaA.id, punto_de_venta_id: datos.norteA.id,
        date: '2026-07-17', time: '09:00', total: 0.20, payment_method: 'ef', status: 'active',
      },
    ]);

    const res = await request(app).get('/api/sales').query(TODO_JULIO);

    expect(res.status).toBe(200);
    expect(typeof res.body.total_periodo).toBe('number');
    expect(res.body.total_periodo).toBe(2469.42);
    expect(res.body.total).toBe(3);
  });

  it('un período SIN ventas dice 0 y no «null»', async () => {
    // `Sale.sum` devuelve `null` cuando no hay filas —no cero—, y ese `null`
    // llegaría al encabezado de la pantalla tal cual. Es el caso que
    // `totalDelPeriodo` existe para cubrir, y el único de este endpoint que
    // solo aparece contra la base: con filas, Sequelize ya entrega un número.
    const res = await request(app).get('/api/sales').query({
      desde: '2026-01-01', hasta: '2026-01-31', punto_de_venta_id: 'todas',
    });

    expect(res.body.data).toHaveLength(0);
    expect(res.body.total_periodo).toBe(0);
  });

  it('la columna Total del archivo exportado es NÚMERO, o la planilla no suma', async () => {
    const res = await request(app).get('/api/sales/export').query(TODO_JULIO);

    expect(res.status).toBe(200);

    for (const fila of res.body.data) {
      expect(typeof fila.total).toBe('number');
    }
    expect(res.body.data.map((f) => f.total)).toEqual([2469.12]);
  });

  it('la suma del encabezado es la suma de la columna Total del archivo', async () => {
    await Sale.create({
      id: 'VENTA-A-0002', empresa_id: datos.empresaA.id, punto_de_venta_id: datos.norteA.id,
      date: '2026-07-16', time: '09:00', total: 1234.56, payment_method: 'ef', status: 'active',
    });

    const listado = await request(app).get('/api/sales').query(TODO_JULIO);
    const archivo = await request(app).get('/api/sales/export').query(TODO_JULIO);

    const sumaDelArchivo = archivo.body.data.reduce((acc, f) => acc + f.total, 0);

    // Si `total_periodo` llegara como string, esto sería '02469.121234.56'.
    expect(listado.body.total_periodo).toBe(sumaDelArchivo);
  });
});

describe('El centavo cierra exacto', () => {
  // ⚠ **Lo que estos cuatro NO protegen, medido por mutación.** Sacarle el
  // redondeo a `calcularTotal` —las dos llamadas a `aCentavos`— los deja a los
  // cuatro en VERDE: `sales.total` es `DECIMAL(12,2)` y Postgres redondea al
  // guardar, así que un residuo de 1e−13 nunca llega a la columna. Lo que sí
  // fijan es el contrato de punta a punta: qué queda guardado, que el total lo
  // decide el servidor, y que un total inventado no escribe nada.
  //
  // El redondeo se vuelve load-bearing donde el número NO pasa por una columna
  // DECIMAL: el saldo acumulado de la cuenta corriente, que se calcula en JS y
  // se devuelve en el JSON. Ahí sí muere con su mutación —da −2,27e−13—, y está
  // cubierto en `saldoDeProveedores.integracion.test.js`.


  it('tres unidades a 33,33 dan 99,99 y NO 99,99000000000001', async () => {
    const res = await request(app).post('/api/sales').send({
      id: 'VENTA-CENTAVOS-0001',
      total: 99.99,
      items: [{
        product_id: datos.levadura.id,
        product_name: 'Levadura fresca',
        quantity: 3,
        unit_price: 33.33,
      }],
    });

    expect(res.status).toBe(201);

    // Lo que quedó guardado, leído de la base y no de la respuesta.
    const guardada = await Sale.findByPk('VENTA-CENTAVOS-0001');
    expect(guardada.total).toBe('99.99');
  });

  it('dos líneas de 0,10 y 0,20 dan 0,30', async () => {
    const res = await request(app).post('/api/sales').send({
      id: 'VENTA-CENTAVOS-0002',
      total: 0.30,
      items: [
        { product_name: 'Servicio A', quantity: 1, unit_price: 0.10 },
        { product_name: 'Servicio B', quantity: 1, unit_price: 0.20 },
      ],
    });

    expect(res.status).toBe(201);
    expect((await Sale.findByPk('VENTA-CENTAVOS-0002')).total).toBe('0.30');
  });

  it('el total lo decide el servidor: un total inventado se rechaza y no se guarda nada', async () => {
    const res = await request(app).post('/api/sales').send({
      id: 'VENTA-CENTAVOS-0003',
      total: 9.99,
      items: [{ product_name: 'Servicio A', quantity: 3, unit_price: 33.33 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TOTAL_INCONSISTENTE');
    expect(await Sale.findByPk('VENTA-CENTAVOS-0003')).toBeNull();
  });

  it('sin total declarado se guarda el calculado', async () => {
    const res = await request(app).post('/api/sales').send({
      id: 'VENTA-CENTAVOS-0004',
      items: [{ product_name: 'Servicio A', quantity: 3, unit_price: 33.33 }],
    });

    expect(res.status).toBe(201);
    expect((await Sale.findByPk('VENTA-CENTAVOS-0004')).total).toBe('99.99');
  });
});

describe('El filtro de sucursal se ejercita CON filtro, no solo sin él', () => {
  it('pedir una sucursal devuelve solo sus ventas y su total', async () => {
    await Sale.create({
      id: 'VENTA-NORTE-0001', empresa_id: datos.empresaA.id, punto_de_venta_id: datos.norteA.id,
      date: '2026-07-18', time: '12:00', total: 1000.00, payment_method: 'ef', status: 'active',
    });

    const norte = await request(app).get('/api/sales').query({
      desde: '2026-07-01', hasta: '2026-07-31', punto_de_venta_id: datos.norteA.id,
    });

    expect(norte.body.data.map((v) => v.id)).toEqual(['VENTA-NORTE-0001']);
    expect(norte.body.total_periodo).toBe(1000);

    // Y «todas» las trae las dos: un filtro que devuelve lo mismo con y sin
    // valor no está filtrando.
    const todas = await request(app).get('/api/sales').query(TODO_JULIO);
    expect(todas.body.data).toHaveLength(2);
    expect(todas.body.total_periodo).toBe(3469.12);
  });
});
