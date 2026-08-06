// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, sequelize, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  P1 · El centavo exacto del saldo, contra Postgres
//
//  Es la mitad de **P1** que `tasks.md` seguía marcando como manual: «lo que
//  sigue siendo de una persona es el centavo — que `saldo` responda exactamente
//  1234.56 y no 1234.5600000000002».
//
//  ── Por qué esto no lo cubría `saldoDeProveedores.integracion.test.js` ──
//
//  Ese archivo ya ejercita el `GROUP BY`, pero **con importes que no pueden
//  distinguir el defecto**: los tres saldos que verifica son `0`, `0` y `400.25`,
//  y las tres restas cierran igual sumadas en centavos que sumadas en pesos
//  —`500.5 − 100.25` es exactamente `400.25` en punto flotante—. O sea que la
//  resta en centavos de `resumenDeCuenta` **se puede sacar y esos tests siguen en
//  verde**. Es exactamente la trampa de fixture que este repositorio ya pagó
//  varias veces: importes redondos que cierran con y sin el redondeo.
//
//  Acá la fixture está elegida para que no cierren: `1000.01 − 0.07` da
//  `999.9399999999999` en punto flotante, y eso es lo que la pantalla muestra
//  como saldo y el badge lee como deuda.
//
//  ── Y las tres cosas que llegan al usuario con ese número ──
//
//  El saldo del listado, el de la ficha y el `saldo_final` del archivo del
//  contador salen todos de la misma aritmética (FR-101). Se verifican los tres
//  sobre el MISMO proveedor: si algún día se separan, esto lo dice antes de que
//  la planilla y la pantalla discrepen en un centavo delante de un contador.
//
//  ⚠ **El mensaje del borrado NO se verifica acá y es a propósito**:
//  `enPesos()` formatea con `maximumFractionDigits: 2`, así que redondea el
//  residuo al imprimirlo. Un test sobre ese texto pasaría con y sin la
//  corrección, que es la clase de test que este repositorio junta de a veinte.
// ════════════════════════════════════════════

const { Supplier, SupplierMovement, SupplierOrder } = modelos;

let datos;
/** El proveedor cuyos importes no cierran en punto flotante. */
let ferreteria;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();

  ferreteria = await Supplier.create({
    empresa_id: datos.empresaA.id,
    name: 'Ferretería del Centavo',
    cuit: '30555555554',
  });

  // 1.000,01 de deuda y 0,07 de pago. En centavos: 100001 − 7 = 99994.
  // En pesos: 999.9399999999999.
  //
  // Las dos fechas caen a los lados del 1 de julio a propósito: así el archivo
  // exportado con `?desde=2026-07-01` tiene que arrastrar un saldo anterior, que
  // es la rama del endpoint que sin filtro no se ejecuta nunca.
  await SupplierMovement.bulkCreate([
    { empresa_id: datos.empresaA.id, supplier_id: ferreteria.id, type: 'deuda', date: '2026-06-30', amount: 1000.01 },
    { empresa_id: datos.empresaA.id, supplier_id: ferreteria.id, type: 'pago', date: '2026-07-05', amount: 0.07 },
  ]);
});

afterAll(async () => {
  await cerrar();
});

/** El proveedor del listado, por nombre. */
function porNombre(cuerpo, nombre) {
  return cuerpo.data.find((p) => p.name === nombre);
}

describe('El saldo cierra en el centavo, no en el decimotercer decimal', () => {
  it('el listado dice 999,94 y NO 999,9399999999999', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    const proveedor = porNombre(res.body, 'Ferretería del Centavo');

    expect(proveedor.deuda).toBe(1000.01);
    expect(proveedor.pagado).toBe(0.07);
    // Restar los dos números YA convertidos a pesos devuelve el residuo que las
    // dos sumas acababan de sacar. La resta también va en centavos.
    expect(proveedor.saldo).toBe(999.94);
  });

  it('la ficha dice el MISMO número que el listado, hasta el último decimal', async () => {
    const listado = await request(app).get('/api/suppliers').query({ limit: 200 });
    const ficha = await request(app).get(`/api/suppliers/${ferreteria.id}`);

    // `toBe` y no `toBeCloseTo`: dos números que se parecen es exactamente lo
    // que FR-101 prohíbe. La pantalla los muestra en dos lugares distintos.
    expect(ficha.body.data.saldo).toBe(porNombre(listado.body, 'Ferretería del Centavo').saldo);
    expect(ficha.body.data.saldo).toBe(999.94);
  });

  it('el archivo del contador cierra en el mismo saldo, arrastrando el período anterior', async () => {
    const res = await request(app)
      .get(`/api/suppliers/${ferreteria.id}/movimientos/export`)
      .query({ desde: '2026-07-01' });

    expect(res.status).toBe(200);

    // ── El filtro se ejercita CON valor, no solo sin él ──
    //
    // Con `desde`, el archivo arranca en la deuda del 30 de junio, que quedó
    // afuera del rango. Acá vivía un `0` literal: el archivo arrancaba la cuenta
    // en cero y cerraba en el neto del período mientras la pantalla mostraba el
    // saldo entero.
    expect(res.body.saldo_inicial).toBe(1000.01);
    // Una sola fila en el archivo —el pago del 5 de julio— y cierra en el saldo
    // que muestran las otras dos pantallas.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.saldo_final).toBe(999.94);
    expect(res.body.data[0].saldo).toBe(999.94);
  });

  it('las celdas de importe del archivo son NÚMEROS, o la columna no suma', async () => {
    const res = await request(app)
      .get(`/api/suppliers/${ferreteria.id}/movimientos/export`)
      .query({ desde: '2026-07-01' });

    const fila = res.body.data[0];

    for (const columna of ['debe', 'haber', 'saldo']) {
      expect(typeof fila[columna]).toBe('number');
    }
    // Y el CUIT es texto: once dígitos inferidos como número salen en notación
    // científica y pierden los últimos.
    expect(typeof fila.cuit).toBe('string');
    expect(fila.cuit).toBe('30555555554');
  });
});

describe('Un DECIMAL de 0,00 no es lo mismo que no tener movimientos', () => {
  // ⚠ **Este describe es una caracterización, no una guardia, y queda dicho.**
  // No encontré ninguna mutación realista del servidor que lo ponga en rojo: el
  // `saldo` sale de una RESTA, y una resta coerciona sus dos lados a número
  // pase lo que pase, así que hoy el string nunca llega al `saldo !== 0` del
  // borrado. La comparación floja que sí muerde —`'0.00' <= 0` es `true`,
  // `'0.00' === 0` es `false`— vive en el badge de la web.
  //
  // Se deja porque cubre una FORMA DE FILA que ninguna otra fixture tiene: la
  // base solo tenía el proveedor sin ningún movimiento, donde el `GROUP BY` no
  // devuelve fila y el string no aparece nunca. El día que alguien devuelva el
  // agregado sin convertir —o agregue un camino que compare el `SUM` crudo—,
  // esta es la única fila del repositorio que puede decirlo.
  let regalos;

  beforeEach(async () => {
    regalos = await Supplier.create({
      empresa_id: datos.empresaA.id,
      name: 'Bonificaciones SA',
    });

    await SupplierMovement.create({
      empresa_id: datos.empresaA.id,
      supplier_id: regalos.id,
      type: 'deuda',
      date: '2026-07-03',
      amount: 0,
    });
  });

  it('un proveedor cuyo SUM da «0.00» tiene saldo cero, cuenta su fila y se puede borrar', async () => {
    const listado = await request(app).get('/api/suppliers').query({ limit: 200 });

    const proveedor = porNombre(listado.body, 'Bonificaciones SA');

    expect(proveedor.saldo).toBe(0);
    expect(typeof proveedor.saldo).toBe('number');
    // El conteo sale del COUNT agrupado: la fila existe aunque su importe sea
    // cero, y el aviso «sin movimientos» de la pantalla cuelga de este número.
    // El proveedor sin ninguna fila, en cambio, cuenta cero.
    expect(proveedor.movimientos).toBe(1);
    expect(porNombre(listado.body, 'Almacén Sin Movimientos').movimientos).toBe(0);

    const borrado = await request(app).delete(`/api/suppliers/${regalos.id}`);

    expect(borrado.status).toBe(200);
    expect(await Supplier.findByPk(regalos.id)).toBeNull();
  });
});

describe('Lo pendiente de recibir suma varias líneas sin arrastrar residuo', () => {
  it('tres líneas cuyos importes NO cierran en punto flotante dan 82,39', async () => {
    // Cada línea deja su propio residuo —6 × 12,34 es 74,03999999999999— y la
    // suma de las tres da 82,38999999999999. La orden de la fixture tiene UNA
    // sola línea, así que no puede distinguir un residuo por línea de uno
    // acumulado entre líneas.
    await SupplierOrder.create({
      empresa_id: datos.empresaA.id,
      supplier_id: ferreteria.id,
      date: '2026-07-22',
      status: 'partial',
      total: 500.00,
      detail: [
        { product_name: 'Tornillos', quantity: 10, quantity_received: 4, unit_price: 12.34 },
        { product_name: 'Arandelas', quantity: 3, quantity_received: 0, unit_price: 0.10 },
        { product_name: 'Tarugos', quantity: 7, quantity_received: 0, unit_price: 1.15 },
      ],
    });

    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    expect(porNombre(res.body, 'Ferretería del Centavo').pendiente_de_recibir).toBe(82.39);
  });

  it('la ficha calcula lo pendiente con la misma función que el listado', async () => {
    await SupplierOrder.create({
      empresa_id: datos.empresaA.id,
      supplier_id: ferreteria.id,
      date: '2026-07-22',
      status: 'partial',
      total: 500.00,
      detail: [
        { product_name: 'Tornillos', quantity: 10, quantity_received: 4, unit_price: 12.34 },
        { product_name: 'Arandelas', quantity: 3, quantity_received: 0, unit_price: 0.10 },
        { product_name: 'Tarugos', quantity: 7, quantity_received: 0, unit_price: 1.15 },
      ],
    });

    const ficha = await request(app).get(`/api/suppliers/${ferreteria.id}`);

    expect(ficha.body.data.pendiente_de_recibir).toBe(82.39);
  });
});

describe('Lo que el driver devuelve, escrito para que se vea', () => {
  it('el SUM agrupado vuelve como TEXTO, con una fila por tipo', async () => {
    // ⚠ **Es una caracterización del driver, no una afirmación sobre el código
    // de la aplicación**: ninguna línea de este repositorio se puede mutar para
    // ponerla en rojo. Está igual, y con este comentario, porque es la premisa
    // de la que cuelgan los tres describes de arriba —la que el paso manual P1
    // mandaba comprobar en `psql`— y porque sí se rompe si alguien registra un
    // `pg.types.setTypeParser` global para NUMERIC: ahí los importes empezarían
    // a llegar como `number`, con la pérdida de precisión que el texto evita, y
    // ningún otro test lo diría.
    const [filas] = await sequelize.query(
      `SELECT supplier_id, type, SUM(amount) AS total FROM supplier_movements
        WHERE empresa_id = 1 AND supplier_id = ${Number(ferreteria.id)}
        GROUP BY supplier_id, type ORDER BY type`
    );

    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.type)).toEqual(['deuda', 'pago']);
    expect(filas.map((f) => f.total)).toEqual(['1000.01', '0.07']);
    expect(typeof filas[0].total).toBe('string');
  });
});
