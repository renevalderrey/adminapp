// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');
const { fechaDelNegocio } = require('../../utils/fechas');

// ════════════════════════════════════════════
//  Las métricas del catálogo · saber si el QR sirve
//
//  ── Lo que la fixture tiene que poder distinguir ──
//
//   · **Diez aperturas y un pedido**, que dan 10, 1 y 10 %. Con una y una, la
//     conversión daría 100 % y cualquier cuenta equivocada —incluida
//     `visitas/pedidos`— daría el mismo número.
//   · **Un período con el catálogo pausado.** Es lo único que justifica la
//     cuarta columna de la clave única de `catalogo_visitas`: sin poder
//     separarlo, una semana de pausa hunde la conversión del mes y se lee como
//     «la tienda no funciona».
//   · **Un catálogo con cero visitas**, para que `0/0` tenga dónde aparecer.
// ════════════════════════════════════════════

const { Catalogo, CatalogoVisita, Pedido } = modelos;

const hoy = fechaDelNegocio();

async function sembrarMetricas() {
  const base = await sembrarDosEmpresas();

  const catalogo = await Catalogo.create({
    empresa_id: base.empresaA.id,
    punto_de_venta_id: base.centroA.id,
    slug: 'metricas-de-a',
    nombre_visible: 'Tienda de A',
    estado: 'publicado',
    publicado_en: new Date(),
  });

  const vacio = await Catalogo.create({
    empresa_id: base.empresaA.id,
    punto_de_venta_id: base.centroA.id,
    slug: 'sin-visitas',
    nombre_visible: 'Sin visitas',
  });

  const deB = await Catalogo.create({
    empresa_id: base.empresaB.id,
    punto_de_venta_id: base.localB.id,
    slug: 'metricas-de-b',
    nombre_visible: 'Tienda de B',
  });

  // Diez aperturas: siete por QR y tres directas, todas con el catálogo
  // publicado.
  await CatalogoVisita.bulkCreate([
    { catalogo_id: catalogo.id, fecha: hoy, origen: 'qr', estado_catalogo: 'publicado', cantidad: 7 },
    { catalogo_id: catalogo.id, fecha: hoy, origen: 'directo', estado_catalogo: 'publicado', cantidad: 3 },
  ]);

  // Y las de la empresa B, para que «no se mezclan» sea una pregunta que se
  // puede hacer.
  await CatalogoVisita.create({
    catalogo_id: deB.id, fecha: hoy, origen: 'qr', estado_catalogo: 'publicado', cantidad: 99,
  });

  await Pedido.create({
    id: 'cccccccc-1111-2222-3333-444444444444',
    empresa_id: base.empresaA.id,
    catalogo_id: catalogo.id,
    punto_de_venta_id: base.centroA.id,
    numero: 1,
    comprador_nombre: 'Martina Olivera',
    comprador_telefono: '5493425123456',
    entrega: 'retiro_local',
    subtotal: 1000,
    total: 1000,
    medio_pago: 'efectivo',
    idempotency_key: 'metricas-1',
  });

  return { ...base, catalogo, vacio, deB };
}

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
});

describe('las métricas del catálogo', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarMetricas();
  });

  it('diez aperturas y un pedido dan 10, 1 y 10 %', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/metricas`);

    expect(res.status).toBe(200);
    expect(res.body.data.visitas).toBe(10);
    expect(res.body.data.pedidos).toBe(1);
    // El dato crudo: la pantalla decide cómo se ve. Formatearlo acá es lo que
    // termina en un «0 %» donde correspondía un guion.
    expect(res.body.data.conversion).toBeCloseTo(0.1, 5);
  });

  it('con cero visitas la conversión no es NaN ni 0 %', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.vacio.id}/metricas`);

    expect(res.body.data.visitas).toBe(0);
    // `null` y no cero: `0/0` no da cero, no existe. Un cero le dice al comercio
    // que su tienda convierte mal cuando lo que pasó es que nadie la abrió.
    expect(res.body.data.conversion).toBeNull();
  });

  it('las visitas con el catálogo pausado se pueden distinguir de las publicadas', async () => {
    // Es lo único que justifica la cuarta columna de la clave única.
    await CatalogoVisita.create({
      catalogo_id: datos.catalogo.id,
      fecha: hoy,
      origen: 'qr',
      estado_catalogo: 'pausado',
      cantidad: 4,
    });

    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/metricas`);

    expect(res.body.data.visitas).toBe(14);
    expect(res.body.data.por_estado).toEqual({ publicado: 10, pausado: 4 });
    // Sin separarlas, esas cuatro visitas sin pedido posible hunden la
    // conversión del mes y se leen como «la tienda no funciona».
    expect(res.body.data.por_estado.pausado).toBe(4);
  });

  it('el desglose por origen suma lo mismo que el total', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/metricas`);

    expect(res.body.data.por_origen).toEqual({ qr: 7, directo: 3 });

    const suma = Object.values(res.body.data.por_origen).reduce((a, b) => a + b, 0);
    expect(suma).toBe(res.body.data.visitas);
  });

  it('no se mezclan las visitas de otra empresa', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/metricas`);

    // La empresa B tiene 99 visitas. Si se colaran, el total sería 109.
    expect(res.body.data.visitas).toBe(10);
  });

  it('el catálogo de otra empresa responde 404', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.deB.id}/metricas`);

    expect(res.status).toBe(404);
  });

  it('`dias` fuera de rango cae al valor por defecto en vez de escanear la tabla', async () => {
    for (const dias of ['0', '-5', '9999', 'todos', '']) {
      const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/metricas?dias=${dias}`);

      expect(res.status).toBe(200);
      expect(res.body.data.dias).toBe(30);
    }
  });
});
