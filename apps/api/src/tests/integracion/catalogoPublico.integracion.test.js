// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  El catálogo público · lo único que puede probar el aislamiento
//
//  ── Por qué esto no puede vivir en la suite rápida ──
//
//  Con `BYPASS_AUTH=true`, `server.js` clava `req.empresaId = 1` y
//  `checkSubscription` no corre. Un router público que devolviera los productos
//  de otra empresa pasa en verde ahí: **el único id de empresa que existe en esa
//  suite es el 1**, así que no hay nada ajeno que filtrar.
//
//  Acá hay dos empresas de verdad, cada una con su catálogo, y las preguntas se
//  pueden hacer ejecutándolas.
//
//  ── Y por qué el aislamiento se afirma sobre el JSON entero ──
//
//  No alcanza con mirar la primera página de productos: una clave interna puede
//  colarse anidada, adentro de un objeto de entrega o de una línea. Los casos de
//  abajo recorren la respuesta completa —objetos y arreglos, a cualquier
//  profundidad— y buscan las diez claves prohibidas.
// ════════════════════════════════════════════

/** Todas las claves del JSON, a cualquier profundidad. */
function clavesDe(valor, acumulado = []) {
  if (Array.isArray(valor)) {
    for (const v of valor) clavesDe(v, acumulado);
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.push(k);
      clavesDe(v, acumulado);
    }
  }
  return acumulado;
}

const PROHIBIDAS = [
  'cost', 'margin_override', 'wholesale_margin', 'wholesale_price',
  'supplier_id', 'barcode', 'is_active', 'publicable',
  'empresa_id', 'punto_de_venta_id',
];

/**
 * Un catálogo publicado para la empresa que se le pida, con sus productos.
 *
 * La fixture tiene que poder distinguir el defecto: **las dos empresas tienen
 * catálogo**. Sin el de B, «los productos de B no aparecen» no se distingue de
 * «B no tiene nada».
 */
async function sembrarCatalogos(datos) {
  const { Catalogo, CatalogoProducto, Product, Setting, Suscripcion } = modelos;

  // ⚠ Las dos empresas necesitan suscripción vigente, y descubrirlo costó un
  // rato: `sembrarDosEmpresas` no crea ninguna, y sin fila el camino público
  // contesta `no_disponible` —correctamente—. O sea que sin esto, TODOS los
  // casos de abajo estarían probando el apagado por suscripción y ninguno el
  // catálogo.
  const enUnMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  for (const empresa of [datos.empresaA, datos.empresaB]) {
    await Suscripcion.destroy({ where: { empresa_id: empresa.id } });
    await Suscripcion.create({
      empresa_id: empresa.id,
      plan: 'free',
      status: 'trialing',
      trial_starts_at: new Date(),
      trial_ends_at: enUnMes,
      grace_period_ends: enUnMes,
    });
  }

  // Un margen para que el precio de lista no sea igual al costo: si lo fuera,
  // «devolvió el precio» y «devolvió el costo» darían el mismo número.
  await Setting.upsert({ key: 'margin_efectivo', value: 50, empresa_id: datos.empresaA.id });
  await Setting.upsert({ key: 'margin_efectivo', value: 50, empresa_id: datos.empresaB.id });

  await Product.update(
    { publicable: true, cost: 1000 },
    { where: { id: [datos.harina.id, datos.levadura.id] } }
  );
  await Product.update(
    { publicable: true, cost: 2000 },
    { where: { id: datos.golosinaB.id } }
  );

  const deA = await Catalogo.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    slug: 'tienda-de-a',
    nombre_visible: 'Tienda de A',
    estado: 'publicado',
    publicado_en: new Date(),
  });

  const deB = await Catalogo.create({
    empresa_id: datos.empresaB.id,
    punto_de_venta_id: datos.localB.id,
    slug: 'tienda-de-b',
    nombre_visible: 'Tienda de B',
    estado: 'publicado',
    publicado_en: new Date(),
  });

  const borrador = await Catalogo.create({
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    slug: 'todavia-no-publicado',
    nombre_visible: 'Borrador de A',
    estado: 'borrador',
  });

  await CatalogoProducto.bulkCreate([
    { catalogo_id: deA.id, product_id: datos.harina.id, orden: 0 },
    { catalogo_id: deA.id, product_id: datos.levadura.id, orden: 1 },
    { catalogo_id: deB.id, product_id: datos.golosinaB.id, orden: 0 },
  ]);

  return { deA, deB, borrador };
}

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
});

describe('el aislamiento del camino público', () => {
  let datos;
  let catalogos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
    catalogos = await sembrarCatalogos(datos);
  });

  it('la tienda de A no muestra ni un producto de B', async () => {
    const res = await request(app).get('/api/publico/c/tienda-de-a');

    expect(res.status).toBe(200);

    const nombres = res.body.data.productos.map((p) => p.nombre);
    expect(nombres).toContain(datos.harina.name);
    expect(nombres).not.toContain(datos.golosinaB.name);

    // Y los ids tampoco: alcanza con que uno se filtre para poder pedirlo.
    const ids = res.body.data.productos.map((p) => p.id);
    expect(ids).not.toContain(datos.golosinaB.id);
  });

  it('el JSON entero no tiene ninguna de las diez claves internas', async () => {
    const res = await request(app).get('/api/publico/c/tienda-de-a');
    const claves = clavesDe(res.body);

    for (const prohibida of PROHIBIDAS) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it('un product_id de otra empresa da 404 sin decir si existía', async () => {
    const ajeno = await request(app).get(`/api/publico/c/tienda-de-a/productos/${datos.golosinaB.id}`);
    const inventado = await request(app).get('/api/publico/c/tienda-de-a/productos/99999');

    expect(ajeno.status).toBe(404);
    // El mismo cuerpo: si el ajeno contestara distinto, probando ids se podría
    // averiguar qué productos existen en otras empresas.
    expect(ajeno.body).toEqual(inventado.body);
  });

  it('un :id negativo, enorme o no numérico da el mismo 404', async () => {
    // Son los casos que un `findByPk` haría pasar de otra forma —o tirar—.
    const cuerpos = [];
    for (const id of ['-1', '0', '99999999999999999999', 'abc', '1;DROP', '1.5']) {
      const res = await request(app).get(`/api/publico/c/tienda-de-a/productos/${id}`);
      expect(res.status).toBe(404);
      cuerpos.push(JSON.stringify(res.body));
    }

    expect(new Set(cuerpos).size).toBe(1);
  });
});

describe('los estados del catálogo', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
    await sembrarCatalogos(datos);
  });

  it('borrador y slug inexistente devuelven el MISMO cuerpo', async () => {
    const borrador = await request(app).get('/api/publico/c/todavia-no-publicado');
    const inventado = await request(app).get('/api/publico/c/no-existe-esto');

    expect(borrador.status).toBe(404);
    expect(inventado.status).toBe(404);

    // Se comparan entre sí, no cada uno contra una constante: si mañana cambia
    // el texto, tienen que cambiar los dos juntos. Que difieran es lo que
    // permitiría enumerar catálogos sin publicar.
    expect(borrador.body).toEqual(inventado.body);
  });

  it('pausado devuelve 200 sin productos ni precios: las claves NO ESTÁN', async () => {
    const { Catalogo } = modelos;
    await Catalogo.update({ estado: 'pausado' }, { where: { slug: 'tienda-de-a' } });

    const res = await request(app).get('/api/publico/c/tienda-de-a');

    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('pausado');

    // Vacías no: ausentes. Una lista vacía se dibuja como «no hay productos»,
    // que es otra cosa que «la tienda está en pausa».
    expect('productos' in res.body.data).toBe(false);
    expect('categorias' in res.body.data).toBe(false);

    // Y la cara del catálogo sí está: el socio tiene que reconocer que llegó al
    // lugar correcto.
    expect(res.body.data.catalogo.nombre).toBe('Tienda de A');
  });

  it('una página vacía es 200 con lista vacía, no un 404', async () => {
    const res = await request(app).get('/api/publico/c/tienda-de-a/productos?q=noexistenada');

    expect(res.status).toBe(200);
    expect(res.body.data.productos).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});

describe('el conteo de visitas', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
    await sembrarCatalogos(datos);
  });

  it('cuenta una fila por día y no una por visita', async () => {
    const { CatalogoVisita } = modelos;

    await request(app).get('/api/publico/c/tienda-de-a?f=qr');
    await request(app).get('/api/publico/c/tienda-de-a?f=qr');
    await request(app).get('/api/publico/c/tienda-de-a?f=qr');

    const filas = await CatalogoVisita.findAll();
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidad).toBe(3);
  });

  it('dos visitas del mismo día con el catálogo en estados distintos son dos filas', async () => {
    const { Catalogo, CatalogoVisita } = modelos;

    await request(app).get('/api/publico/c/tienda-de-a?f=qr');
    await Catalogo.update({ estado: 'pausado' }, { where: { slug: 'tienda-de-a' } });
    await request(app).get('/api/publico/c/tienda-de-a?f=qr');

    const filas = await CatalogoVisita.findAll({ order: [['estado_catalogo', 'ASC']] });

    // Es lo que permite que la conversión en cero de una semana de pausa no se
    // lea como «la tienda no funciona».
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.estado_catalogo).sort()).toEqual(['pausado', 'publicado']);
  });

  it('un origen inventado cae en «otro» y el catálogo se ve igual', async () => {
    const { CatalogoVisita } = modelos;

    const conBasura = await request(app).get('/api/publico/c/tienda-de-a?f=' + encodeURIComponent('<script>x</script>'));
    const sinNada = await request(app).get('/api/publico/c/tienda-de-a');

    expect(conBasura.status).toBe(200);
    // El parámetro no cambia lo que se ve: es un contador, no un filtro.
    expect(conBasura.body.data.productos).toEqual(sinNada.body.data.productos);

    const origenes = (await CatalogoVisita.findAll()).map((f) => f.origen).sort();
    expect(origenes).toEqual(['directo', 'otro']);
  });
});

describe('la suscripción, en el camino público', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
    await sembrarCatalogos(datos);
  });

  it('la suscripción vencida apaga el catálogo', async () => {
    // ⚠ Es el ÚNICO lugar donde esto se puede probar: `BYPASS_AUTH` saltea
    // `checkSubscription` en la cadena privada.
    const { Suscripcion } = modelos;
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await Suscripcion.destroy({ where: { empresa_id: datos.empresaA.id } });
    await Suscripcion.create({
      empresa_id: datos.empresaA.id,
      plan: 'free',
      status: 'past_due',
      trial_starts_at: ayer,
      trial_ends_at: ayer,
      grace_period_ends: ayer,
    });

    const res = await request(app).get('/api/publico/c/tienda-de-a');

    // 200 y no 402: el 402 es un contrato entre la API y apps/web. Acá el que
    // lee es un socio del gimnasio, y que el comercio esté en mora no es asunto
    // suyo.
    expect(res.status).toBe(200);
    expect(res.body.data.estado).toBe('no_disponible');
    expect('productos' in res.body.data).toBe(false);
  });

  it('el error al consultar la suscripción responde 503 en el público', async () => {
    const { Suscripcion } = modelos;
    const original = Suscripcion.findOne;
    Suscripcion.findOne = jest.fn().mockRejectedValue(new Error('la base no contesta'));

    try {
      const res = await request(app).get('/api/publico/c/tienda-de-a');

      // Cerrar y no abrir. Y 503 y no 402: el 402 afirmaría que la suscripción
      // venció, y lo que pasó es que no se pudo saber.
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('NO_DISPONIBLE_POR_UN_MOMENTO');
    } finally {
      Suscripcion.findOne = original;
    }
  });

  it('el mismo error deja pasar en la cadena privada: la asimetría es deliberada', async () => {
    // La otra mitad, que es la que se olvida. Un hipo de la base no puede
    // tumbar la caja de un comercio que ya pagó.
    const { Suscripcion } = modelos;
    const original = Suscripcion.findOne;
    Suscripcion.findOne = jest.fn().mockRejectedValue(new Error('la base no contesta'));

    try {
      const res = await request(app).get('/api/products');
      expect(res.status).not.toBe(503);
      expect(res.status).toBeLessThan(500);
    } finally {
      Suscripcion.findOne = original;
    }
  });
});
