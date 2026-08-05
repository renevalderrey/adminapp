// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  El saldo de proveedores: el GROUP BY que ningún test unitario alcanza
//
//  `utils/cuentaDeProveedor.js` lo dice en su encabezado: la agregación la tiene
//  que hacer Postgres, «pero los dobles de `tests/helpers/modelosFalsos.js` no
//  entienden `group`, ni `Op.*`, ni `order`, ni `limit`, así que una suma
//  escrita adentro del handler **no la alcanza ningún test unitario**». La
//  aritmética se probó con arreglos planos; la parte que trae las filas quedó
//  «verificada en un paso manual». Esto reemplaza ese paso manual.
//
//  Lo que solo se puede afirmar ejecutando contra Postgres:
//
//  - Que el `SUM` agrupado **vuelve como string** y que la cadena entera
//    —consulta, `resumenDeCuenta`, respuesta JSON— termina en un NÚMERO. Es el
//    defecto concreto que este proyecto ya pagó: `'0.00' <= 0` es `true` por
//    coerción y `'0.00' === 0` es `false`, así que un proveedor sin compras se
//    pintaba «Saldado» en verde por el motivo equivocado.
//  - Que el conteo sale del `COUNT` agrupado (`n`) y no de contar filas: contra
//    los dobles viene una fila por movimiento y el contador acierta por
//    casualidad; contra Postgres vienen dos filas con `n`, y leerlas mal diría
//    «2» donde hay 23.
//  - Que el `GROUP BY` filtra por empresa. Las dos empresas de la fixture tienen
//    un proveedor con el MISMO nombre, así que una fuga no se ve como una fila
//    de más sino como otros números.
//  - Que `translate()` normaliza los acentos. Es una función de SQL: contra un
//    doble no se ejecuta nunca.
// ════════════════════════════════════════════

const { Supplier, SupplierMovement } = modelos;

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

/** El proveedor del listado, por nombre. */
function porNombre(cuerpo, nombre) {
  return cuerpo.data.find((p) => p.name === nombre);
}

describe('Los tres números salen del GROUP BY y llegan como números', () => {
  it('suma cuatro movimientos y da un saldo de CERO exacto', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    const molino = porNombre(res.body, 'Molino Río de la Plata');

    // 1234,56 + 0,10 + 0,20. Sumado en punto flotante daría 1234,8600000000001.
    expect(molino.deuda).toBe(1234.86);
    expect(molino.pagado).toBe(1234.86);
    expect(molino.saldo).toBe(0);
  });

  it('el saldo es un NÚMERO, no el string que devuelve el SUM de Postgres', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    for (const proveedor of res.body.data) {
      expect(typeof proveedor.deuda).toBe('number');
      expect(typeof proveedor.pagado).toBe('number');
      expect(typeof proveedor.saldo).toBe('number');
    }

    // El caso que se pintaba «Saldado» por coerción: sin un solo movimiento, el
    // GROUP BY no devuelve NINGUNA fila para este proveedor.
    const almacen = porNombre(res.body, 'Almacén Sin Movimientos');
    expect(almacen.saldo).toBe(0);
    expect(typeof almacen.saldo).toBe('number');
  });

  it('tres pagos de 33,33 y 33,34 cancelan una deuda de 100 sin dejar residuo', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    const distribuidora = porNombre(res.body, 'Distribuidora Ñandú');

    expect(distribuidora.pagado).toBe(100);
    expect(distribuidora.saldo).toBe(0);
  });

  it('el único que queda debiendo lo dice en positivo', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    // Positivo = se le debe al proveedor. 500,50 − 100,25.
    expect(porNombre(res.body, 'Zeta Insumos').saldo).toBe(400.25);
  });

  it('la ficha y el listado dicen el MISMO número (FR-101)', async () => {
    const listado = await request(app).get('/api/suppliers').query({ limit: 200 });
    const ficha = await request(app).get(`/api/suppliers/${datos.zeta.id}`);

    const enElListado = porNombre(listado.body, 'Zeta Insumos');

    expect(ficha.body.data.deuda).toBe(enElListado.deuda);
    expect(ficha.body.data.pagado).toBe(enElListado.pagado);
    expect(ficha.body.data.saldo).toBe(enElListado.saldo);
  });
});

describe('Los conteos salen del COUNT agrupado', () => {
  it('cuenta los CUATRO movimientos, no las dos filas del GROUP BY', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    // El agrupado devuelve dos filas —deuda y pago— con `n` = 3 y 1.
    expect(porNombre(res.body, 'Molino Río de la Plata').movimientos).toBe(4);
    expect(porNombre(res.body, 'Distribuidora Ñandú').movimientos).toBe(4);
    expect(porNombre(res.body, 'Almacén Sin Movimientos').movimientos).toBe(0);
  });

  it('cuenta los DOS documentos, no la única fila que devuelve el COUNT', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    expect(porNombre(res.body, 'Molino Río de la Plata').documentos).toBe(2);
    expect(porNombre(res.body, 'Zeta Insumos').documentos).toBe(0);
  });
});

describe('Lo pendiente de recibir no cuenta las órdenes anuladas', () => {
  it('suma solo lo que falta de la orden abierta', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    // Pedidas 10, recibidas 4, a 12,34: faltan 6 × 12,34 = 74,04.
    // La orden anulada de 99.999,99 NO suma.
    expect(porNombre(res.body, 'Molino Río de la Plata').pendiente_de_recibir).toBe(74.04);
  });
});

describe('El GROUP BY filtra por empresa', () => {
  it('un movimiento de la otra empresa colgado de MI proveedor no entra en el saldo', async () => {
    // ── Por qué esta fila se escribe con el modelo y no por la API ──
    //
    // Hoy ningún endpoint la puede crear: `POST /:id/payments` y
    // `POST /:id/documents` validan el proveedor con `findScoped` antes de
    // escribir, justamente porque ese agujero ya se cerró una vez. Pero el
    // repositorio razona con que puede existir: el comentario de
    // `GET /api/suppliers/:id` dice que sin su `where` «un documento cargado
    // desde otra empresa cliente contra este mismo proveedor aparecería en esta
    // ficha».
    //
    // El `empresa_id` del GROUP BY es la segunda línea de defensa, y una
    // segunda línea de defensa solo se puede verificar poniéndole delante lo
    // que la primera dejaría pasar. Sin esta fila, sacar el filtro de la
    // consulta agregada no cambia ni un número —los ids de proveedor son
    // globales, así que las filas de la otra empresa se indexan bajo un id que
    // esta página no muestra— y el test pasaría con y sin el cambio.
    await SupplierMovement.create({
      empresa_id: datos.empresaB.id,
      supplier_id: datos.molino.id,
      type: 'deuda',
      date: '2026-07-09',
      amount: 66666.66,
    });

    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    const molino = porNombre(res.body, 'Molino Río de la Plata');

    expect(molino.deuda).toBe(1234.86);
    expect(molino.saldo).toBe(0);
    // Y el conteo tampoco la cuenta.
    expect(molino.movimientos).toBe(4);
  });

  it('el proveedor homónimo de la otra empresa no aparece en el listado', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    // Las dos empresas tienen un «Molino Río de la Plata»: si el listado no
    // filtrara, aparecería dos veces con el mismo nombre.
    expect(res.body.data.filter((p) => p.name === 'Molino Río de la Plata')).toHaveLength(1);
    expect(res.body.data).toHaveLength(4);
  });
});

describe('La paginación y la búsqueda, con los filtros puestos', () => {
  it('la segunda página de dos trae los DOS últimos y el total sigue siendo el de la búsqueda', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 2, page: 2 });

    expect(res.body.data.map((p) => p.name)).toEqual([
      'Molino Río de la Plata',
      'Zeta Insumos',
    ]);
    // El total es el de la búsqueda, no el de la página: sin él la paginación no
    // sabe cuántas páginas hay.
    expect(res.body.total).toBe(4);
  });

  it('busca «rio» y encuentra «Río» (FR-059: translate() en SQL)', async () => {
    const res = await request(app).get('/api/suppliers').query({ q: 'rio de la plata' });

    expect(res.body.data.map((p) => p.name)).toEqual(['Molino Río de la Plata']);
    expect(res.body.total).toBe(1);
  });

  it('busca «NANDU» en mayúsculas y encuentra «Ñandú»', async () => {
    const res = await request(app).get('/api/suppliers').query({ q: 'NANDU' });

    expect(res.body.data.map((p) => p.name)).toEqual(['Distribuidora Ñandú']);
  });

  it('el total de una búsqueda es el de los resultados, no el de la empresa', async () => {
    const res = await request(app).get('/api/suppliers').query({ q: 'o', limit: 2 });

    // «Molino», «Almacén Sin Movimientos» y «Distribuidora Ñandú» tienen una o;
    // «Zeta Insumos» también. Lo que importa acá es que el total NO sea el
    // tamaño de la página.
    expect(res.body.data.length).toBe(2);
    expect(res.body.total).toBeGreaterThan(2);
  });
});

describe('El saldo acumulado de la cuenta corriente, página por página', () => {
  // `routes/suppliers.js:525` lo dice: «Este camino no lo puede ejercitar ningún
  // test unitario (riesgo 9): los dobles de `modelosFalsos` no entienden `Op.or`
  // ni `Op.lt`, así que devolverían todas las filas y la cuenta daría cualquier
  // cosa. […] Que la consulta traiga las filas correctas es el paso manual P1.»
  // Esto es ese paso manual, ejecutado.
  //
  // Los cuatro movimientos del Molino, del más nuevo al más viejo:
  //   10/07  pago   1234,86
  //   02/07  deuda     0,20   ← el corte de la página cae entre estos dos,
  //   02/07  deuda     0,10   ← que son del MISMO día
  //   01/07  deuda  1234,56

  it('la cuenta entera cierra en CERO exacto en la fila más nueva', async () => {
    const res = await request(app).get(`/api/suppliers/${datos.molino.id}/movimientos`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.saldo_inicial).toBe(0);
    // Acumulando en punto flotante daría −2,27e−13, que la pantalla muestra como
    // «−0,00» y el badge lee como deuda.
    expect(res.body.data[0].saldo).toBe(0);
  });

  it('la segunda página arranca donde terminó la primera, y no en cero', async () => {
    const pagina2 = await request(app)
      .get(`/api/suppliers/${datos.molino.id}/movimientos`)
      .query({ limit: 2, page: 2 });

    // Es la última página: abajo no hay nada, así que arranca en cero.
    expect(pagina2.body.saldo_inicial).toBe(0);
    expect(pagina2.body.data.map((m) => m.saldo)).toEqual([1234.66, 1234.56]);
  });

  it('la primera página trae el saldo de todo lo que quedó abajo', async () => {
    const pagina1 = await request(app)
      .get(`/api/suppliers/${datos.molino.id}/movimientos`)
      .query({ limit: 2, page: 1 });

    // 1234,56 + 0,10: los dos movimientos que quedaron en la página siguiente.
    // Sale del `Op.or` con `Op.lt` sobre fecha e id.
    expect(pagina1.body.saldo_inicial).toBe(1234.66);
    // Y la última fila de la cuenta sigue cerrando en cero, paginada o no.
    expect(pagina1.body.data[0].saldo).toBe(0);
  });
});

describe('El borrado consulta el mismo saldo que la pantalla', () => {
  it('borra un proveedor cuya cuenta cierra en cero por cuatro movimientos', async () => {
    // El `saldo !== 0` del handler compara contra el resultado de un SUM que
    // Postgres devuelve como texto. Con los dobles esa consulta no existe.
    const res = await request(app).delete(`/api/suppliers/${datos.molino.id}`);

    expect(res.status).toBe(200);
    expect(await Supplier.findByPk(datos.molino.id)).toBeNull();
    expect(await SupplierMovement.count({ where: { supplier_id: datos.molino.id } })).toBe(0);
  });

  it('NO borra al que queda debiendo, y dice cuánto', async () => {
    const res = await request(app).delete(`/api/suppliers/${datos.zeta.id}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/400,25/);
    expect(await Supplier.findByPk(datos.zeta.id)).not.toBeNull();
  });
});
