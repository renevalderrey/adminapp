// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
//   Ver el comentario del `require.cache` en ese archivo.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  El aislamiento entre empresas, EJECUTADO
//
//  Hasta acá el aislamiento se verificaba con guardias que leen el código
//  fuente (`aislamientoEmpresas.test.js`, `observabilidad.test.js`). Sirven —
//  encontraron veinte endpoints y después ocho más— pero verifican una forma,
//  no un resultado: un `findScoped` escrito correctamente y una asociación mal
//  declarada pasan la guardia y filtran datos igual.
//
//  Acá se pide un recurso de la empresa B con la sesión de la empresa A y se
//  mira qué contesta el sistema. La respuesta correcta es **404 y no 403**: un
//  403 confirma que el id existe en otro cliente y permite enumerarlo.
//
//  ── Cada caso tiene su control ──
//
//  Todos los tests piden lo mismo dos veces: el recurso propio y el ajeno. Sin
//  el control, un endpoint que devolviera 404 SIEMPRE —por un typo en la ruta,
//  por un permiso mal puesto— pasaría el test entero sin aislar nada. Es el
//  mismo error que dejó veinte tests pasando con y sin el cambio.
//
//  ── Y los que MUTAN se verifican por el dato, no por el status ──
//
//  Anular una venta devuelve mercadería al inventario, y borrar un proveedor se
//  lleva su cuenta corriente entera. En esos dos, además del 404, se comprueba
//  que la fila de la empresa B siguió como estaba: un handler que responde 404
//  después de haber escrito es un handler que filtró igual.
// ════════════════════════════════════════════

const { Sale, Stock, Supplier, SupplierMovement } = modelos;

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

describe('La sesión de la empresa A no alcanza los datos de la empresa B', () => {
  it('GET /api/sales/:id devuelve la venta propia y 404 con la de la otra empresa', async () => {
    const propia = await request(app).get(`/api/sales/${datos.ventaA.id}`);
    const ajena = await request(app).get(`/api/sales/${datos.ventaB.id}`);

    expect(propia.status).toBe(200);
    expect(propia.body.data.id).toBe('VENTA-A-0001');

    expect(ajena.status).toBe(404);
    expect(ajena.body.data).toBeUndefined();
  });

  it('GET /api/products/:id devuelve el producto propio y 404 con el de la otra empresa', async () => {
    const propio = await request(app).get(`/api/products/${datos.harina.id}`);
    const ajeno = await request(app).get(`/api/products/${datos.golosinaB.id}`);

    expect(propio.status).toBe(200);
    expect(propio.body.data.name).toBe('Harina 000');

    expect(ajeno.status).toBe(404);
    expect(ajeno.body.data).toBeUndefined();
  });

  it('GET /api/suppliers/:id devuelve el proveedor propio y 404 con el de la otra empresa', async () => {
    // Los dos proveedores se llaman IGUAL. Si el filtro por empresa fallara, la
    // respuesta se vería bien: mismo nombre, otros números.
    const propio = await request(app).get(`/api/suppliers/${datos.molino.id}`);
    const ajeno = await request(app).get(`/api/suppliers/${datos.molinoB.id}`);

    expect(propio.status).toBe(200);
    expect(propio.body.data.cuit).toBe('30333333336');

    expect(ajeno.status).toBe(404);
    expect(ajeno.body.data).toBeUndefined();
  });

  it('GET /api/suppliers NO trae el proveedor homónimo de la otra empresa', async () => {
    const res = await request(app).get('/api/suppliers').query({ limit: 200 });

    expect(res.status).toBe(200);

    const cuits = res.body.data.map((p) => p.cuit);
    expect(cuits).toContain('30333333336');
    expect(cuits).not.toContain('30444444445');
    expect(res.body.total).toBe(4);
  });
});

describe('Los endpoints que ESCRIBEN tampoco alcanzan a la otra empresa', () => {
  it('PUT /api/sales/:id/void da 404 con la venta ajena y NO le devuelve el stock', async () => {
    const stockAntes = await Stock.findOne({
      where: { empresa_id: datos.empresaB.id, product_id: datos.golosinaB.id },
    });

    const res = await request(app).put(`/api/sales/${datos.ventaB.id}/void`);

    expect(res.status).toBe(404);

    // Lo que de verdad importa no es el status: es que no haya pasado nada.
    const ventaB = await Sale.findByPk(datos.ventaB.id);
    expect(ventaB.status).toBe('active');
    expect(ventaB.voided_at).toBeNull();

    const stockDespues = await Stock.findOne({
      where: { empresa_id: datos.empresaB.id, product_id: datos.golosinaB.id },
    });
    expect(stockDespues.quantity).toBe(stockAntes.quantity);
    expect(stockDespues.available).toBe(stockAntes.available);

    // El control: la venta propia SÍ se anula, así que el 404 de arriba no es
    // «este endpoint no anula nada».
    const propia = await request(app).put(`/api/sales/${datos.ventaA.id}/void`);
    expect(propia.status).toBe(200);
    expect((await Sale.findByPk(datos.ventaA.id)).status).toBe('voided');
  });

  it('DELETE /api/suppliers/:id da 404 con el ajeno y NO le borra la cuenta corriente', async () => {
    const res = await request(app).delete(`/api/suppliers/${datos.molinoB.id}`);

    expect(res.status).toBe(404);

    expect(await Supplier.findByPk(datos.molinoB.id)).not.toBeNull();
    expect(await SupplierMovement.count({ where: { supplier_id: datos.molinoB.id } })).toBe(2);

    // El control: el proveedor propio sin movimientos sí se borra.
    const propio = await request(app).delete(`/api/suppliers/${datos.almacen.id}`);
    expect(propio.status).toBe(200);
    expect(await Supplier.findByPk(datos.almacen.id)).toBeNull();
  });

  it('POST /api/sales con la sucursal de la otra empresa no registra la venta', async () => {
    // ⚠ Con `BYPASS_AUTH` la cabecera `X-Punto-De-Venta-Id` NO se valida contra
    // la empresa —`server.js` hace `parseInt` y listo, mientras que
    // `loadEmpresaContext` sí la verifica—. O sea que este id ajeno llega
    // entero hasta la ruta: quien lo corta es el `findScoped` de
    // `resolverSucursal`, y eso es exactamente lo que se está ejercitando.
    const res = await request(app)
      .post('/api/sales')
      .set('X-Punto-De-Venta-Id', String(datos.localB.id))
      .send({
        id: 'VENTA-INTRUSA-0001',
        total: 1234.56,
        items: [{ product_id: datos.harina.id, product_name: 'Harina 000', quantity: 1, unit_price: 1234.56 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Punto de venta inválido/);

    expect(await Sale.findByPk('VENTA-INTRUSA-0001')).toBeNull();

    // Y el stock de la otra empresa quedó intacto.
    const stockB = await Stock.findOne({
      where: { empresa_id: datos.empresaB.id, punto_de_venta_id: datos.localB.id },
    });
    expect(stockB.quantity).toBe(30);
  });
});
