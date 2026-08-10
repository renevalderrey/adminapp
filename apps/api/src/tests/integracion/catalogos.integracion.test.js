const fs = require('fs');
const os = require('os');
const path = require('path');

// El volumen se apunta a un temporal ANTES de cargar nada: `utils/imagenes`
// resuelve su raíz al requerirse, y `baseDePruebas` arrastra toda la app.
const RAIZ_DE_PRUEBA = fs.mkdtempSync(path.join(os.tmpdir(), 'favalio-cat-int-'));
process.env.RUTA_DE_IMAGENES = RAIZ_DE_PRUEBA;

// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const sharp = require('sharp');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  Catálogos: reglas, productos, previsualización e imágenes
//
//  ── Por qué esto no puede vivir en `npm run test:api` ──
//
//  Con `BYPASS_AUTH=true`, `server.js` clava `req.empresaId = 1`. En esa suite
//  el único id de empresa que existe es el 1, así que «la regla sobre la marca
//  de otra empresa responde 404» pasa en verde **con el `findScoped` del
//  objetivo y sin él**: no hay ninguna marca ajena contra la cual fallar.
//
//  Acá hay dos empresas de verdad, y lo que decide cada caso es **la fila de
//  Postgres**, no la respuesta: un endpoint que contestara 404 y hubiera escrito
//  igual pasaría el primer chequeo y no el `count()`.
//
//  ── La fixture está armada para poder distinguir el defecto ──
//
//  - **Un catálogo en cada empresa.** Sin el de B, «el de B da 404 desde A» no
//    se distingue de «no hay ningún catálogo».
//  - **Dos catálogos en la empresa A.** Es lo que hace detectable «la regla se
//    editó en el catálogo equivocado» y «el producto se agregó al otro»: con uno
//    solo, cualquier consulta que se olvide del `catalogo_id` devuelve lo mismo.
//  - **Una regla de cada ámbito sobre el MISMO producto.** Sin las cuatro
//    apuntando a `whey`, no se puede ver cuál gana y el test pasa con cualquier
//    escala de especificidad — incluida la invertida.
//  - **`creatina` tiene la categoría escrita `proteinas` y `whey` `Proteínas`.**
//    Con las dos iguales, la regla de categoría alcanzaría a las dos igual y
//    `normalizarTexto` no estaría probando nada.
//  - **El margen de la empresa A es 50 %.** Con margen 0, el precio de lista y
//    el costo dan el mismo número y «devolvió el costo de compra» —que en una
//    página pública es lo que la empresa paga— no se distingue de «devolvió el
//    precio de venta».
//  - **Un producto del catálogo con costo $0 y otro no publicable.** Son los dos
//    motivos distintos por los que algo no sale, y se arreglan en pantallas
//    distintas.
// ════════════════════════════════════════════

const {
  Brand, Product, Catalogo, CatalogoProducto, CatalogoReglaPrecio,
} = modelos;

/** Un PNG con fondo transparente. Es lo que la pantalla pide para el logo. */
const pngTransparente = (lado) => sharp({
  create: { width: lado, height: lado, channels: 4, background: { r: 0, g: 180, b: 182, alpha: 0 } },
}).png().toBuffer();

const jpegDe = (ancho, alto) => sharp({
  create: { width: ancho, height: alto, channels: 3, background: { r: 10, g: 120, b: 200 } },
}).jpeg().toBuffer();

/** Todos los archivos que hay hoy en el volumen. */
const archivosDelVolumen = () => {
  const salida = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const completa = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(completa);
      else salida.push(completa);
    }
  };
  recorrer(RAIZ_DE_PRUEBA);
  return salida;
};

const enDisco = (url) => path.join(RAIZ_DE_PRUEBA, url.replace('/img/', ''));

async function sembrarCatalogos() {
  const base = await sembrarDosEmpresas();

  // Sin margen, precio de lista = costo, y las dos cosas son distintas.
  await base.empresaA.update({ settings: { margin_efectivo: 50 } });

  const ena = await Brand.create({ empresa_id: base.empresaA.id, name: 'ENA' });
  const marcaDeB = await Brand.create({ empresa_id: base.empresaB.id, name: 'Marca del kiosco' });

  const nuevo = (campos) => Product.create({
    empresa_id: base.empresaA.id,
    unit_type: 'unidad',
    publicable: true,
    ...campos,
  });

  const whey = await nuevo({
    name: 'Whey Protein 1 kg', sku: 'WHE-001', cost: 8000, brand_id: ena.id, category: 'Proteínas',
  });
  // La categoría escrita distinto A PROPÓSITO: es lo único que ejercita
  // `normalizarTexto` en el índice de reglas de categoría.
  const creatina = await nuevo({
    name: 'Creatina 300 g', sku: 'CRE-001', cost: 5000, brand_id: ena.id, category: 'proteinas',
  });
  const barrita = await nuevo({
    name: 'Barrita de cereal', sku: 'BAR-001', cost: 1000, category: 'Snacks',
  });
  // Costo $0: hoy 376 de los 431 productos de Comprafit están así.
  const sinPrecio = await nuevo({
    name: 'Shaker sin costo cargado', sku: 'SHA-001', cost: 0, category: 'Proteínas',
  });
  // Foto pegada a mano por el importador de CSV: vive en un hosting ajeno.
  const fotoExterna = await nuevo({
    name: 'Multivitamínico', sku: 'MUL-001', cost: 2000, category: 'Snacks',
    image_url: 'https://cdn.hostingajeno.com/multi.jpg',
  });
  const noPublicable = await nuevo({
    name: 'Insumo interno', sku: 'INS-001', cost: 3000, category: 'Snacks', publicable: false,
  });

  const catalogo = await Catalogo.create({
    empresa_id: base.empresaA.id, punto_de_venta_id: base.centroA.id,
    slug: 'comprafit-fitnet', nombre_visible: 'Comprafit / Fitnet',
  });
  const otroCatalogo = await Catalogo.create({
    empresa_id: base.empresaA.id, punto_de_venta_id: base.centroA.id,
    slug: 'comprafit-socios', nombre_visible: 'Comprafit / Socios',
  });
  const catalogoDeB = await Catalogo.create({
    empresa_id: base.empresaB.id, punto_de_venta_id: base.localB.id,
    slug: 'kiosco-de-la-esquina', nombre_visible: 'Kiosco de la Esquina',
  });

  const delCatalogo = [whey, creatina, barrita, sinPrecio, fotoExterna, noPublicable];
  await CatalogoProducto.bulkCreate(delCatalogo.map((p, i) => ({
    catalogo_id: catalogo.id, product_id: p.id, orden: i,
  })));

  await CatalogoProducto.create({
    catalogo_id: otroCatalogo.id, product_id: barrita.id, orden: 0,
  });
  await CatalogoProducto.create({
    catalogo_id: catalogoDeB.id, product_id: base.golosinaB.id, orden: 0,
  });

  // Las cuatro, sobre el mismo producto. Es lo que hace visible cuál gana.
  const regla = (campos) => CatalogoReglaPrecio.create({
    empresa_id: base.empresaA.id, catalogo_id: catalogo.id,
    tipo: 'porcentaje_descuento', ...campos,
  });

  const reglaProducto = await regla({ ambito: 'producto', product_id: whey.id, valor: 10 });
  const reglaMarca = await regla({ ambito: 'marca', brand_id: ena.id, valor: 20 });
  // Se guarda normalizada, que es como la escribe el endpoint.
  const reglaCategoria = await regla({ ambito: 'categoria', categoria: 'proteinas', valor: 30 });
  const reglaCatalogo = await regla({ ambito: 'catalogo', valor: 40 });

  return {
    ...base,
    ena, marcaDeB,
    whey, creatina, barrita, sinPrecio, fotoExterna, noPublicable,
    catalogo, otroCatalogo, catalogoDeB,
    reglaProducto, reglaMarca, reglaCategoria, reglaCatalogo,
  };
}

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
  fs.rmSync(RAIZ_DE_PRUEBA, { recursive: true, force: true });
});

let datos;

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarCatalogos();
});

// ════════════════════════════════════════════
//  T1434 · Las reglas y su cobertura
// ════════════════════════════════════════════

describe('las reglas de precio con su cobertura', () => {
  it('gana la más específica, y la cobertura sale del mismo recorrido', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/reglas`);

    expect(res.status).toBe(200);
    expect(res.body.data.reglas).toHaveLength(4);
    // El universo son las filas de `catalogo_productos`, las seis.
    expect(res.body.data.productos).toBe(6);

    const porId = new Map(res.body.data.reglas.map((r) => [r.id, r]));

    // whey está alcanzado por las CUATRO y termina con una sola: la de producto.
    // Con la escala invertida —catálogo pisando a producto— este bloque entero
    // cambia de números.
    expect(porId.get(datos.reglaProducto.id).cobertura).toEqual({ alcanza: 1, gana: 1 });
    // Alcanza a whey y a creatina; gana sólo en creatina, porque en whey la pisa
    // la de producto.
    expect(porId.get(datos.reglaMarca.id).cobertura).toEqual({ alcanza: 2, gana: 1 });
    // «Proteínas» y «proteinas» son la misma categoría: alcanza a whey, creatina
    // y el shaker sin precio.
    expect(porId.get(datos.reglaCategoria.id).cobertura).toEqual({ alcanza: 3, gana: 1 });
    // La del catálogo alcanza a los seis y gana en los tres que nadie más toca.
    expect(porId.get(datos.reglaCatalogo.id).cobertura).toEqual({ alcanza: 6, gana: 3 });

    // Cada producto tiene exactamente una ganadora: las reglas no se acumulan.
    const gana = res.body.data.reglas.reduce((n, r) => n + r.cobertura.gana, 0);
    expect(gana).toBe(6);

    // DECIMAL vuelve de Postgres como string. Que llegue número no es cosmético:
    // el panel compara y suma con esto.
    expect(porId.get(datos.reglaProducto.id).valor).toBe(10);
  });

  it('la cobertura cuenta los productos DEL CATÁLOGO, no los que salen', async () => {
    // Son dos números distintos a propósito: si el universo fuera «los que
    // salen», marcar un producto como no publicable movería la cobertura de una
    // regla que nadie tocó.
    const reglas = await request(app).get(`/api/catalogos/${datos.catalogo.id}/reglas`);
    const previa = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);

    const delCatalogo = reglas.body.data.reglas.find((r) => r.ambito === 'catalogo');

    expect(delCatalogo.cobertura.alcanza).toBe(6);
    expect(previa.body.data.productos).toHaveLength(4);
  });

  it('crea una regla de categoría y la guarda normalizada', async () => {
    const res = await request(app)
      .post(`/api/catalogos/${datos.otroCatalogo.id}/reglas`)
      .send({ ambito: 'categoria', categoria: '  Snacks ', tipo: 'monto_descuento', valor: 200 });

    expect(res.status).toBe(201);
    expect(res.body.data.categoria).toBe('snacks');

    const fila = await CatalogoReglaPrecio.findByPk(res.body.data.id);
    expect(fila.categoria).toBe('snacks');
    expect(fila.catalogo_id).toBe(datos.otroCatalogo.id);
    expect(fila.empresa_id).toBe(datos.empresaA.id);
  });

  it('una regla sobre un producto de OTRA empresa da 404 y no deja ninguna fila', async () => {
    const antes = await CatalogoReglaPrecio.count();

    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/reglas`)
      // Un id de otra empresa es exactamente lo que manda quien los adivina:
      // son enteros correlativos.
      .send({ ambito: 'producto', product_id: datos.golosinaB.id, tipo: 'porcentaje_descuento', valor: 15 });

    // 404 y no 403: un id ajeno no se distingue de uno que no existe.
    expect(res.status).toBe(404);

    // Lo que decide es la fila, no la respuesta.
    expect(await CatalogoReglaPrecio.count()).toBe(antes);
    expect(await CatalogoReglaPrecio.count({ where: { product_id: datos.golosinaB.id } })).toBe(0);
  });

  it('una regla sobre una marca de OTRA empresa da 404 y no deja ninguna fila', async () => {
    const antes = await CatalogoReglaPrecio.count();

    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/reglas`)
      .send({ ambito: 'marca', brand_id: datos.marcaDeB.id, tipo: 'porcentaje_descuento', valor: 15 });

    expect(res.status).toBe(404);
    expect(await CatalogoReglaPrecio.count()).toBe(antes);
    expect(await CatalogoReglaPrecio.count({ where: { brand_id: datos.marcaDeB.id } })).toBe(0);
  });

  it('dos reglas del mismo ámbito y objetivo chocan, y el mensaje nombra la que ya estaba', async () => {
    const antes = await CatalogoReglaPrecio.count();

    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/reglas`)
      .send({ ambito: 'marca', brand_id: datos.ena.id, tipo: 'precio_fijo', valor: 999 });

    expect(res.status).toBe(409);
    // Nombra el objetivo y qué dice la regla que ya está: sin eso, «ya existe»
    // deja a alguien buscando cuál entre veinte filas.
    expect(res.body.error).toMatch(/ENA/);
    expect(res.body.error).toMatch(/20 % de descuento/);
    expect(res.body.data.id).toBe(datos.reglaMarca.id);

    expect(await CatalogoReglaPrecio.count()).toBe(antes);
  });

  it('dos reglas de ámbito catálogo también chocan: es el caso que el NULL deja escapar', async () => {
    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/reglas`)
      .send({ ambito: 'catalogo', tipo: 'porcentaje_descuento', valor: 5 });

    expect(res.status).toBe(409);
    expect(await CatalogoReglaPrecio.count({ where: { ambito: 'catalogo' } })).toBe(1);
  });

  it('un porcentaje fuera de (0, 100] se rechaza al guardar y no deja fila', async () => {
    const antes = await CatalogoReglaPrecio.count();

    const res = await request(app)
      .post(`/api/catalogos/${datos.otroCatalogo.id}/reglas`)
      .send({ ambito: 'catalogo', tipo: 'porcentaje_descuento', valor: 120 });

    expect(res.status).toBe(400);
    // «Falló» tiene que significar «no escribió».
    expect(await CatalogoReglaPrecio.count()).toBe(antes);
  });

  // ── La regla huérfana, que nació sin poder existir ──
  //
  // `data-model.md` (tabla 3) describe esto: borrar la marca deja `brand_id` en
  // NULL, la regla se dibuja atenuada, «0 de 0», y **no se borra sola**. La idea
  // es que perder configuración en silencio es peor que dejarla visible y rota:
  // alguien negoció ese descuento, y si desaparece nadie se entera.
  //
  // Contra la base, eso no funcionaba. El CHECK `ck_regla_ambito` exigía
  // `ambito = 'marca' AND brand_id IS NOT NULL`, así que la fila que el
  // `ON DELETE SET NULL` intenta escribir era exactamente la que el CHECK
  // prohibía: el `DELETE FROM brands` abortaba con 23514. O sea que **el CHECK
  // protegía a la marca**, al revés de lo diseñado, y con un mensaje que no
  // nombraba ninguna regla de precio.
  //
  // Lo arregla `20260818-regla-de-marca-huerfana.js`, que relaja el CHECK sólo
  // para ese ámbito. Lo que el CHECK deja de exigir lo sigue exigiendo
  // `validarRegla` al escribir, que es donde corresponde.
  it('borrar la marca deja la regla huérfana con cobertura 0 de 0, y no la borra', async () => {
    await Brand.destroy({ where: { id: datos.ena.id } });

    expect(await Brand.count({ where: { id: datos.ena.id } })).toBe(0);

    // La regla sigue existiendo, apuntando a nada.
    const regla = await CatalogoReglaPrecio.findByPk(datos.reglaMarca.id);
    expect(regla).not.toBeNull();
    expect(regla.brand_id).toBeNull();

    // Y la pantalla la muestra sin alcance, que es la señal de que hay algo que
    // mirar. No desaparece.
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/reglas`);
    const marca = res.body.data.reglas.find((r) => r.id === datos.reglaMarca.id);

    expect(marca).toBeDefined();
    expect(marca.brand_id).toBeNull();
    expect(marca.cobertura).toEqual({ alcanza: 0, gana: 0 });
  });

  it('y los productos de esa marca pasan a la regla que seguía en la escala', async () => {
    // La otra mitad: la huérfana deja de pisar, así que lo que ganaba por marca
    // pasa a ganarlo la categoría o el catálogo. Sin esto, «quedó huérfana»
    // podría convivir con «los precios no se movieron», que sería un error.
    await Brand.destroy({ where: { id: datos.ena.id } });

    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/reglas`);
    const marca = res.body.data.reglas.find((r) => r.id === datos.reglaMarca.id);
    const otras = res.body.data.reglas.filter((r) => r.id !== datos.reglaMarca.id);

    expect(marca.cobertura.gana).toBe(0);
    // Lo que la marca ganaba lo tiene que haber recogido alguna otra.
    expect(otras.reduce((a, r) => a + r.cobertura.gana, 0)).toBeGreaterThan(0);
  });

  it('borrar la regla primero y después la marca también funciona', async () => {
    // El camino ordenado, que es el que va a usar quien esté prolijo. Importa
    // porque el otro —borrar la marca con la regla puesta— dependía de una
    // corrección de la base: si alguien revirtiera `20260818`, este caso
    // seguiría verde y los dos de arriba se pondrían rojos, que es exactamente
    // la separación que hace falta para saber qué se rompió.
    await request(app)
      .delete(`/api/catalogos/${datos.catalogo.id}/reglas/${datos.reglaMarca.id}`)
      .expect(200);

    await Brand.destroy({ where: { id: datos.ena.id } });

    expect(await Brand.count({ where: { id: datos.ena.id } })).toBe(0);

    // Y los productos quedan sin marca —`products.brand_id` sí es SET NULL—, así
    // que la regla de marca que quedaba deja de alcanzar a nadie.
    await datos.whey.reload();
    expect(datos.whey.brand_id).toBeNull();
  });

  it('borrar el producto borra su regla, y no la deja apuntando a un id que no existe', async () => {
    // `ON DELETE CASCADE` desde `products`: sin el producto, la regla no
    // significa nada. Es la otra mitad de las tres columnas con FK.
    await Product.destroy({ where: { id: datos.whey.id } });

    expect(await CatalogoReglaPrecio.count({ where: { id: datos.reglaProducto.id } })).toBe(0);
    expect(await CatalogoReglaPrecio.count({ where: { catalogo_id: datos.catalogo.id } })).toBe(3);
  });

  it('una regla desactivada se comporta como si no existiera, y la fila lo muestra', async () => {
    const res = await request(app)
      .put(`/api/catalogos/${datos.catalogo.id}/reglas/${datos.reglaProducto.id}`)
      .send({ activo: false });

    expect(res.status).toBe(200);
    expect(res.body.data.activo).toBe(false);

    const reglas = await request(app).get(`/api/catalogos/${datos.catalogo.id}/reglas`);
    const apagada = reglas.body.data.reglas.find((r) => r.id === datos.reglaProducto.id);
    expect(apagada.cobertura).toEqual({ alcanza: 0, gana: 0 });

    // Y whey pasa a la siguiente más específica: la de marca, 20 % sobre 12000.
    const previa = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);
    const fila = previa.body.data.productos.find((p) => p.id === datos.whey.id);

    expect(fila.precio).toBe(9600);
    expect(fila.regla.ambito).toBe('marca');
  });

  it('la regla del OTRO catálogo de la misma empresa no se edita ni se borra desde este', async () => {
    const ajena = await CatalogoReglaPrecio.create({
      empresa_id: datos.empresaA.id, catalogo_id: datos.otroCatalogo.id,
      ambito: 'catalogo', tipo: 'porcentaje_descuento', valor: 5,
    });

    const editada = await request(app)
      .put(`/api/catalogos/${datos.catalogo.id}/reglas/${ajena.id}`)
      .send({ valor: 99 });
    expect(editada.status).toBe(404);

    const borrada = await request(app)
      .delete(`/api/catalogos/${datos.catalogo.id}/reglas/${ajena.id}`);
    expect(borrada.status).toBe(404);

    await ajena.reload();
    expect(Number(ajena.valor)).toBe(5);
  });

  it('las reglas del catálogo de la otra empresa no se leen ni se escriben', async () => {
    const leidas = await request(app).get(`/api/catalogos/${datos.catalogoDeB.id}/reglas`);
    expect(leidas.status).toBe(404);

    const antes = await CatalogoReglaPrecio.count();
    const creada = await request(app)
      .post(`/api/catalogos/${datos.catalogoDeB.id}/reglas`)
      .send({ ambito: 'catalogo', tipo: 'porcentaje_descuento', valor: 50 });

    expect(creada.status).toBe(404);
    expect(await CatalogoReglaPrecio.count()).toBe(antes);
  });

  it('DELETE borra la fila y la previsualización deja de aplicarla', async () => {
    const res = await request(app)
      .delete(`/api/catalogos/${datos.catalogo.id}/reglas/${datos.reglaProducto.id}`);

    expect(res.status).toBe(200);
    expect(await CatalogoReglaPrecio.count({ where: { id: datos.reglaProducto.id } })).toBe(0);

    const previa = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);
    const fila = previa.body.data.productos.find((p) => p.id === datos.whey.id);

    expect(fila.regla.ambito).toBe('marca');
  });
});

describe('las categorías que existen hoy en el catálogo', () => {
  it('agrupa «Proteínas» y «proteinas» en una sola y devuelve su etiqueta', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/categorias`);

    expect(res.status).toBe(200);

    const claves = res.body.data.map((c) => c.categoria);
    expect(claves).toEqual(['proteinas', 'snacks']);

    const proteinas = res.body.data.find((c) => c.categoria === 'proteinas');
    // whey, creatina y el shaker sin precio. Sin `normalizarTexto` serían dos
    // categorías y la regla de una no alcanzaría a los productos de la otra.
    expect(proteinas.productos).toBe(3);
    expect(proteinas.etiqueta).toBe('Proteínas');

    // «Insumo interno» es de Snacks pero no es publicable: no se ofrece.
    expect(res.body.data.find((c) => c.categoria === 'snacks').productos).toBe(2);
  });

  it('las del otro catálogo son las suyas, no las de todo el inventario', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.otroCatalogo.id}/categorias`);

    expect(res.body.data.map((c) => c.categoria)).toEqual(['snacks']);
  });
});

// ════════════════════════════════════════════
//  T1435 · Los productos del catálogo y la previsualización
// ════════════════════════════════════════════

describe('la grilla de selección de productos', () => {
  it('trae los del catálogo y los publicables que no están, con sus banderas', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.otroCatalogo.id}/productos`);

    expect(res.status).toBe(200);

    const porId = new Map(res.body.data.map((p) => [p.id, p]));

    // Los cinco publicables de la empresa A. `harina`, `levadura` y `sal` no lo
    // son y no están en este catálogo: no aparecen.
    expect(res.body.data).toHaveLength(5);
    expect(porId.has(datos.harina.id)).toBe(false);

    // El único de este catálogo, y va primero.
    expect(res.body.data[0].id).toBe(datos.barrita.id);
    expect(porId.get(datos.barrita.id).en_el_catalogo).toBe(true);

    // El mismo producto en el OTRO catálogo no cuenta como agregado acá. Sin
    // dos catálogos, esto no se puede afirmar.
    expect(porId.get(datos.whey.id).en_el_catalogo).toBe(false);

    // Precio de lista, no costo: 8000 con margen 50 % son 12000.
    expect(porId.get(datos.whey.id).precio_lista).toBe(12000);
    expect(porId.get(datos.whey.id).publicable).toBe(true);
    expect(porId.get(datos.whey.id).is_active).toBe(true);
  });

  it('los avisos SIN_PRECIO y FOTO_EXTERNA salen donde tienen que salir', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/productos`);
    const porId = new Map(res.body.data.map((p) => [p.id, p]));

    expect(porId.get(datos.sinPrecio.id).avisos).toEqual(['SIN_PRECIO']);
    expect(porId.get(datos.fotoExterna.id).avisos).toEqual(['FOTO_EXTERNA']);
    expect(porId.get(datos.whey.id).avisos).toEqual([]);
  });

  it('un producto del catálogo que dejó de ser publicable sigue en la grilla', async () => {
    // Si desapareciera, no habría forma de sacarlo del catálogo desde la
    // pantalla.
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/productos`);
    const interno = res.body.data.find((p) => p.id === datos.noPublicable.id);

    expect(interno).toBeDefined();
    expect(interno.en_el_catalogo).toBe(true);
    expect(interno.publicable).toBe(false);
  });

  it('la grilla de un catálogo de otra empresa da 404', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogoDeB.id}/productos`);

    expect(res.status).toBe(404);
  });
});

describe('agregar y quitar productos en lote', () => {
  it('agrega los que faltan y respeta el orden que ya había', async () => {
    const res = await request(app)
      .post(`/api/catalogos/${datos.otroCatalogo.id}/productos`)
      .send({ ids: [datos.whey.id, datos.creatina.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.agregados).toBe(2);

    const filas = await CatalogoProducto.findAll({
      where: { catalogo_id: datos.otroCatalogo.id }, order: [['orden', 'ASC']], raw: true,
    });

    expect(filas.map((f) => f.product_id)).toEqual([datos.barrita.id, datos.whey.id, datos.creatina.id]);
    expect(filas.map((f) => f.orden)).toEqual([0, 1, 2]);
  });

  it('agregar dos veces el mismo producto no crea dos filas', async () => {
    await request(app)
      .post(`/api/catalogos/${datos.otroCatalogo.id}/productos`)
      .send({ ids: [datos.whey.id] })
      .expect(200);

    const segunda = await request(app)
      .post(`/api/catalogos/${datos.otroCatalogo.id}/productos`)
      .send({ ids: [datos.whey.id, datos.whey.id] });

    expect(segunda.status).toBe(200);
    expect(segunda.body.data.agregados).toBe(0);
    expect(segunda.body.data.ya_estaban).toBe(1);

    expect(await CatalogoProducto.count({
      where: { catalogo_id: datos.otroCatalogo.id, product_id: datos.whey.id },
    })).toBe(1);
  });

  it('un product_id de otra empresa en el lote no agrega nada', async () => {
    const antes = await CatalogoProducto.count({ where: { catalogo_id: datos.otroCatalogo.id } });

    const res = await request(app)
      .post(`/api/catalogos/${datos.otroCatalogo.id}/productos`)
      .send({ ids: [datos.whey.id, datos.golosinaB.id] });

    expect(res.status).toBe(200);
    // Se pidieron dos y entró uno: el número que devuelve es el que pasó de
    // verdad, no el que se pidió.
    expect(res.body.data.pedidos).toBe(2);
    expect(res.body.data.agregados).toBe(1);
    expect(res.body.data.ajenos).toBe(1);

    expect(await CatalogoProducto.count({ where: { catalogo_id: datos.otroCatalogo.id } })).toBe(antes + 1);
    expect(await CatalogoProducto.count({
      where: { catalogo_id: datos.otroCatalogo.id, product_id: datos.golosinaB.id },
    })).toBe(0);
  });

  it('el lote sobre un catálogo de otra empresa da 404 y no escribe', async () => {
    const antes = await CatalogoProducto.count();

    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogoDeB.id}/productos`)
      .send({ ids: [datos.whey.id] });

    expect(res.status).toBe(404);
    expect(await CatalogoProducto.count()).toBe(antes);
  });

  it('quitar borra la fila, y sólo la de este catálogo', async () => {
    const res = await request(app)
      .delete(`/api/catalogos/${datos.catalogo.id}/productos`)
      .send({ ids: [datos.barrita.id, datos.sinPrecio.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.quitados).toBe(2);

    expect(await CatalogoProducto.count({ where: { catalogo_id: datos.catalogo.id } })).toBe(4);
    // La del otro catálogo sigue: quitar de uno no quita del otro.
    expect(await CatalogoProducto.count({
      where: { catalogo_id: datos.otroCatalogo.id, product_id: datos.barrita.id },
    })).toBe(1);

    // Y el producto no se tocó: quitarlo del catálogo no es borrarlo del
    // inventario.
    expect(await Product.count({ where: { id: datos.barrita.id } })).toBe(1);
  });

  it('una lista vacía no escribe nada, ni agregando ni quitando', async () => {
    const antes = await CatalogoProducto.count();

    const agregando = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/productos`).send({ ids: [] });
    expect(agregando.status).toBe(400);

    const quitando = await request(app)
      .delete(`/api/catalogos/${datos.catalogo.id}/productos`).send({ ids: [] });
    expect(quitando.status).toBe(400);

    expect(await CatalogoProducto.count()).toBe(antes);
  });
});

describe('la previsualización', () => {
  it('un producto con costo $0 aparece en sin_precio y NO en la lista de los que salen', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);

    expect(res.status).toBe(200);

    const queSalen = res.body.data.productos.map((p) => p.id);
    expect(queSalen).not.toContain(datos.sinPrecio.id);

    // El panel dice cuántos son Y CUÁLES: «376 de 431» sin la lista no le sirve
    // a nadie para arreglarlo.
    expect(res.body.data.sin_precio.map((p) => p.id)).toEqual([datos.sinPrecio.id]);
    expect(res.body.data.sin_precio[0].name).toBe('Shaker sin costo cargado');
    expect(res.body.data.totales).toEqual({
      en_el_catalogo: 6, salen: 4, sin_precio: 1, no_publicables: 1,
    });
  });

  it('el que no está marcado publicable sale por su propia lista, que es otro problema', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);

    expect(res.body.data.no_publicables.map((p) => p.id)).toEqual([datos.noPublicable.id]);
    expect(res.body.data.sin_precio.map((p) => p.id)).not.toContain(datos.noPublicable.id);
  });

  it('devuelve el precio de lista, la que gana, las pisadas y el precio final', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);
    const porId = new Map(res.body.data.productos.map((p) => [p.id, p]));

    const whey = porId.get(datos.whey.id);
    // 8000 de costo, margen 50 % → 12000 de lista; gana la de producto, 10 %.
    expect(whey.precio_lista).toBe(12000);
    expect(whey.precio).toBe(10800);
    expect(whey.regla.id).toBe(datos.reglaProducto.id);
    // Las tres pisadas se devuelven: la pantalla las tacha debajo, y es lo que
    // hace entendible por qué el precio es ese.
    expect(whey.pisadas.map((r) => r.ambito).sort()).toEqual(['catalogo', 'categoria', 'marca']);
    expect(whey.avisos).toEqual([]);

    // creatina: la de marca, 20 % sobre 7500.
    expect(porId.get(datos.creatina.id).precio).toBe(6000);
    expect(porId.get(datos.creatina.id).regla.ambito).toBe('marca');

    // barrita: sólo la del catálogo, 40 % sobre 1500.
    expect(porId.get(datos.barrita.id).precio).toBe(900);
    expect(porId.get(datos.barrita.id).regla.ambito).toBe('catalogo');
    expect(porId.get(datos.barrita.id).pisadas).toEqual([]);
  });

  it('avisa QUEDA_EN_CERO cuando una regla deja el precio en $0', async () => {
    // Un monto de descuento mayor que el precio de lista. En el punto de venta
    // eso lo mira una persona antes de cobrar; en una página pública un producto
    // a $0 es una oferta y alguien la va a tomar.
    await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/reglas`)
      .send({ ambito: 'producto', product_id: datos.barrita.id, tipo: 'monto_descuento', valor: 5000 })
      .expect(201);

    const res = await request(app).get(`/api/catalogos/${datos.catalogo.id}/previsualizacion`);
    const barrita = res.body.data.productos.find((p) => p.id === datos.barrita.id);

    expect(barrita.precio).toBe(0);
    expect(barrita.avisos).toEqual(['QUEDA_EN_CERO']);

    // Y el resto no queda marcado: el aviso es del producto, no de la pantalla.
    expect(res.body.data.productos.find((p) => p.id === datos.whey.id).avisos).toEqual([]);
  });

  it('sin ninguna regla los precios son los de lista y nada se rompe', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.otroCatalogo.id}/previsualizacion`);

    expect(res.status).toBe(200);
    expect(res.body.data.productos).toHaveLength(1);

    const barrita = res.body.data.productos[0];
    expect(barrita.precio).toBe(1500);
    expect(barrita.precio_lista).toBe(1500);
    expect(barrita.regla).toBeNull();
    expect(barrita.pisadas).toEqual([]);
  });

  it('la previsualización de un catálogo de otra empresa da 404', async () => {
    const res = await request(app).get(`/api/catalogos/${datos.catalogoDeB.id}/previsualizacion`);

    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════
//  T1436 · El logo y la portada
// ════════════════════════════════════════════

describe('las imágenes del catálogo', () => {
  it('el logo se guarda en PNG y conserva la transparencia', async () => {
    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'logo')
      .attach('imagen', await pngTransparente(900), 'logo.png');

    expect(res.status).toBe(200);

    // ⚠ Lo primero que se mira es el ARCHIVO, no el nombre. Un JPEG guardado con
    // extensión `.png` pasaría cualquier chequeo sobre la URL y perdería la
    // transparencia igual: la pantalla dibuja el logo sobre un recuadro y sin
    // canal alfa sale con un rectángulo detrás.
    const meta = await sharp(enDisco(res.body.data.url)).metadata();

    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(400);

    // Ruta RELATIVA en la columna: mudarse de dominio no puede exigir migrar
    // datos.
    expect(res.body.data.url).toMatch(/^\/img\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}\.png$/);

    await datos.catalogo.reload();
    expect(datos.catalogo.logo_url).toBe(res.body.data.url);
    expect(datos.catalogo.portada_url).toBeNull();
  });

  it('la portada se guarda en JPEG con la medida de la portada', async () => {
    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'portada')
      .attach('imagen', await jpegDe(2400, 1200), 'portada.jpg');

    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/\.jpg$/);

    const meta = await sharp(enDisco(res.body.data.url)).metadata();
    expect(meta.format).toBe('jpeg');
    // 1200×480 con `fit: inside`: la más restrictiva manda.
    expect(meta.width).toBe(960);
    expect(meta.height).toBe(480);

    await datos.catalogo.reload();
    expect(datos.catalogo.portada_url).toBe(res.body.data.url);
    expect(datos.catalogo.logo_url).toBeNull();
  });

  it('reemplazar el logo borra el anterior del disco', async () => {
    const primera = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'logo').attach('imagen', await pngTransparente(300), 'uno.png');

    const segunda = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'logo').attach('imagen', await pngTransparente(320), 'dos.png');

    expect(segunda.body.data.url).not.toBe(primera.body.data.url);
    expect(fs.existsSync(enDisco(primera.body.data.url))).toBe(false);
    expect(fs.existsSync(enDisco(segunda.body.data.url))).toBe(true);
  });

  it('sin tipo, o con un tipo inventado, no escribe nada', async () => {
    const antes = archivosDelVolumen().length;

    const sinTipo = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .attach('imagen', await pngTransparente(300), 'logo.png');
    expect(sinTipo.status).toBe(400);

    const inventado = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'producto')
      .attach('imagen', await pngTransparente(300), 'logo.png');
    expect(inventado.status).toBe(400);

    expect(archivosDelVolumen()).toHaveLength(antes);
    await datos.catalogo.reload();
    expect(datos.catalogo.logo_url).toBeNull();
  });

  it('un .exe renombrado a .png se rechaza: lo que se mira es el contenido', async () => {
    const antes = archivosDelVolumen().length;

    const res = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'logo')
      .attach('imagen', Buffer.from('MZ\x90\x00\x03 ejecutable de Windows'), {
        filename: 'logo.png', contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no es una imagen/i);
    expect(archivosDelVolumen()).toHaveLength(antes);
  });

  it('borrar saca el archivo del disco y la ruta de la columna, y sólo la del tipo pedido', async () => {
    const logo = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'logo').attach('imagen', await pngTransparente(300), 'logo.png');
    const portada = await request(app)
      .post(`/api/catalogos/${datos.catalogo.id}/imagen`)
      .field('tipo', 'portada').attach('imagen', await jpegDe(1400, 600), 'portada.jpg');

    const res = await request(app)
      .delete(`/api/catalogos/${datos.catalogo.id}/imagen?tipo=logo`);

    expect(res.status).toBe(200);
    expect(fs.existsSync(enDisco(logo.body.data.url))).toBe(false);
    // La portada no se toca: son dos columnas distintas.
    expect(fs.existsSync(enDisco(portada.body.data.url))).toBe(true);

    await datos.catalogo.reload();
    expect(datos.catalogo.logo_url).toBeNull();
    expect(datos.catalogo.portada_url).toBe(portada.body.data.url);
  });

  it('la imagen de un catálogo de otra empresa da 404 y no toca ningún archivo', async () => {
    const antes = archivosDelVolumen().length;

    const subida = await request(app)
      .post(`/api/catalogos/${datos.catalogoDeB.id}/imagen`)
      .field('tipo', 'logo')
      .attach('imagen', await pngTransparente(300), 'logo.png');

    expect(subida.status).toBe(404);
    expect(archivosDelVolumen()).toHaveLength(antes);

    const borrada = await request(app)
      .delete(`/api/catalogos/${datos.catalogoDeB.id}/imagen?tipo=logo`);
    expect(borrada.status).toBe(404);

    await datos.catalogoDeB.reload();
    expect(datos.catalogoDeB.logo_url).toBeNull();
  });
});

// ════════════════════════════════════════════
//  T1461 · El catálogo con pedidos no se borra: se pausa
// ════════════════════════════════════════════

describe('borrar un catálogo', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarCatalogos();
  });

  it('un catálogo sin pedidos se borra, y se lleva sus filas dependientes', async () => {
    const res = await request(app).delete(`/api/catalogos/${datos.catalogo.id}`);

    expect(res.status).toBe(200);
    expect(await Catalogo.count({ where: { id: datos.catalogo.id } })).toBe(0);
    expect(await CatalogoProducto.count({ where: { catalogo_id: datos.catalogo.id } })).toBe(0);
    expect(await CatalogoReglaPrecio.count({ where: { catalogo_id: datos.catalogo.id } })).toBe(0);
  });

  it('borrar un catálogo con un pedido responde 409, ofrece pausar, y el catálogo y el pedido siguen ahí', async () => {
    const { Pedido } = modelos;

    await Pedido.create({
      id: '11111111-2222-3333-4444-555555555555',
      empresa_id: datos.empresaA.id,
      catalogo_id: datos.catalogo.id,
      punto_de_venta_id: datos.centroA.id,
      numero: 1,
      comprador_nombre: 'Martina Olivera',
      comprador_telefono: '5493425123456',
      entrega: 'retiro_local',
      subtotal: 1000,
      total: 1000,
      medio_pago: 'efectivo',
      idempotency_key: 'clave-del-pedido-de-prueba',
    });

    const res = await request(app).delete(`/api/catalogos/${datos.catalogo.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TIENE_PEDIDOS');
    // Ofrece la alternativa: pausar deja el catálogo fuera de línea sin perder
    // ni el historial ni el QR impreso, que es lo que el comercio quería.
    expect(res.body.alternativa).toBe('pausar');
    expect(res.body.mensaje.toLowerCase()).toContain('pausa');

    // Las dos filas siguen. Sin el `count` previo, el borrado falla igual —la
    // restricción del motor lo impide— pero falla con un 500 que nombra
    // `pedidos_catalogo_id_fkey`, y el comercio no puede leer eso.
    expect(await Catalogo.count({ where: { id: datos.catalogo.id } })).toBe(1);
    expect(await Pedido.count()).toBe(1);
  });

  it('el pedido de OTRA empresa no impide borrar este catálogo', async () => {
    // El `count` va scopeado: si mirara sólo `catalogo_id`, un choque de ids
    // entre empresas bloquearía un borrado legítimo.
    const { Pedido } = modelos;

    await Pedido.create({
      id: '99999999-8888-7777-6666-555555555555',
      empresa_id: datos.empresaB.id,
      catalogo_id: datos.catalogoDeB.id,
      punto_de_venta_id: datos.localB.id,
      numero: 1,
      comprador_nombre: 'Otro comprador',
      comprador_telefono: '5491154782210',
      entrega: 'retiro_local',
      subtotal: 500,
      total: 500,
      medio_pago: 'efectivo',
      idempotency_key: 'clave-de-la-empresa-b',
    });

    const res = await request(app).delete(`/api/catalogos/${datos.catalogo.id}`);

    expect(res.status).toBe(200);
    expect(await Pedido.count()).toBe(1);
  });
});
