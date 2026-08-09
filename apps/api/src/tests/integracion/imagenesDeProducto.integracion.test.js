const fs = require('fs');
const os = require('os');
const path = require('path');

// El volumen se apunta a un temporal ANTES de cargar nada: `utils/imagenes`
// resuelve su raíz al requerirse, y `baseDePruebas` arrastra toda la app.
const RAIZ_DE_PRUEBA = fs.mkdtempSync(path.join(os.tmpdir(), 'favalio-img-int-'));
process.env.RUTA_DE_IMAGENES = RAIZ_DE_PRUEBA;

// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const sharp = require('sharp');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  La foto del producto · lo que sólo se puede afirmar con disco y dos empresas
//
//  Cuatro preguntas que ni un doble ni la suite rápida pueden contestar:
//
//   1. **Un `.exe` renombrado a `.jpg` se rechaza.** Lo que decide es el
//      contenido, no la extensión ni el `Content-Type`, que los declara quien
//      sube. Contra un doble de `sharp` esto probaría el doble.
//   2. **Un archivo de 8 MB devuelve un mensaje que dice cuál es el límite**, y
//      no el 500 de multer que nombra el campo del formulario.
//   3. **Borrar la foto la borra del disco Y de la columna.** «Se llamó al
//      borrado» no es «el archivo no está»: acá se mira el archivo.
//   4. **La foto de un producto de otra empresa responde 404 y no toca ningún
//      archivo.** Con `BYPASS_AUTH` la sesión es siempre la empresa 1, así que
//      esto sólo se puede afirmar con las dos empresas sembradas.
// ════════════════════════════════════════════

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

beforeAll(async () => {
  await conectarOFallar();
});

afterAll(async () => {
  await cerrar();
  fs.rmSync(RAIZ_DE_PRUEBA, { recursive: true, force: true });
});

describe('subir la foto de un producto', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
  });

  it('la guarda, la achica y deja la ruta relativa en la columna', async () => {
    const res = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      .attach('imagen', await jpegDe(2400, 1800), 'foto.jpg');

    expect(res.status).toBe(200);

    // Ruta relativa, nunca absoluta: mudarse de dominio no puede exigir migrar
    // datos.
    expect(res.body.data.image_url).toMatch(/^\/img\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}\.jpg$/);
    expect(res.body.data.image_url).not.toMatch(/^https?:/);

    await datos.harina.reload();
    expect(datos.harina.image_url).toBe(res.body.data.image_url);

    const enDisco = path.join(RAIZ_DE_PRUEBA, res.body.data.image_url.replace('/img/', ''));
    expect(fs.existsSync(enDisco)).toBe(true);

    const meta = await sharp(enDisco).metadata();
    expect(meta.width).toBe(800);
  });

  it('un .exe renombrado a .jpg se rechaza: lo que se mira es el contenido', async () => {
    const antes = archivosDelVolumen().length;

    const res = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      // Extensión y Content-Type mienten los dos, que es lo que pasa de verdad.
      .attach('imagen', Buffer.from('MZ\x90\x00\x03 ejecutable de Windows'), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no es una imagen/i);

    // Y no dejó nada escrito.
    expect(archivosDelVolumen()).toHaveLength(antes);
    await datos.harina.reload();
    expect(datos.harina.image_url).toBeNull();
  });

  it('un archivo de 8 MB dice cuál es el límite, y no es un 500', async () => {
    const ocho = Buffer.alloc(8 * 1024 * 1024, 7);

    const res = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      .attach('imagen', ocho, 'gigante.jpg');

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    // El mensaje tiene que traer el número: «demasiado grande» no le sirve a
    // nadie que esté mirando su teléfono.
    expect(res.body.error).toMatch(/5 MB/);
  });

  it('reemplazar la foto borra la anterior', async () => {
    const primera = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      .attach('imagen', await jpegDe(600, 600), 'una.jpg');

    const segunda = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      .attach('imagen', await jpegDe(700, 700), 'otra.jpg');

    expect(segunda.body.data.image_url).not.toBe(primera.body.data.image_url);

    const vieja = path.join(RAIZ_DE_PRUEBA, primera.body.data.image_url.replace('/img/', ''));
    const nueva = path.join(RAIZ_DE_PRUEBA, segunda.body.data.image_url.replace('/img/', ''));

    expect(fs.existsSync(vieja)).toBe(false);
    expect(fs.existsSync(nueva)).toBe(true);
  });

  it('la foto de un producto de otra empresa da 404 y no toca ningún archivo', async () => {
    const antes = archivosDelVolumen().length;

    const res = await request(app)
      .post(`/api/products/${datos.golosinaB.id}/imagen`)
      .attach('imagen', await jpegDe(500, 500), 'foto.jpg');

    // 404 y no 403: un id ajeno no se puede distinguir de uno que no existe.
    expect(res.status).toBe(404);
    expect(archivosDelVolumen()).toHaveLength(antes);

    await datos.golosinaB.reload();
    expect(datos.golosinaB.image_url).toBeNull();
  });
});

describe('borrar la foto', () => {
  let datos;

  beforeEach(async () => {
    await limpiarLaBase();
    datos = await sembrarDosEmpresas();
  });

  it('la saca del disco y de la columna', async () => {
    const subida = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      .attach('imagen', await jpegDe(500, 500), 'foto.jpg');

    const enDisco = path.join(RAIZ_DE_PRUEBA, subida.body.data.image_url.replace('/img/', ''));
    expect(fs.existsSync(enDisco)).toBe(true);

    const res = await request(app).delete(`/api/products/${datos.harina.id}/imagen`);

    expect(res.status).toBe(200);
    expect(fs.existsSync(enDisco)).toBe(false);

    await datos.harina.reload();
    expect(datos.harina.image_url).toBeNull();
  });

  it('desactivar el producto NO borra su foto', async () => {
    // El borrado de `DELETE /api/products/:id` es blando: pone `is_active` en
    // false y se puede revertir desde Inventario. Borrar la foto ahí haría
    // irreversible una acción que no lo es.
    const subida = await request(app)
      .post(`/api/products/${datos.harina.id}/imagen`)
      .attach('imagen', await jpegDe(500, 500), 'foto.jpg');

    const enDisco = path.join(RAIZ_DE_PRUEBA, subida.body.data.image_url.replace('/img/', ''));

    await request(app).delete(`/api/products/${datos.harina.id}`).expect(200);

    expect(fs.existsSync(enDisco)).toBe(true);
    await datos.harina.reload();
    expect(datos.harina.is_active).toBe(false);
    expect(datos.harina.image_url).toBe(subida.body.data.image_url);
  });

  it('una URL externa del importador no se intenta borrar del disco', async () => {
    const { Product } = modelos;
    await Product.update(
      { image_url: 'https://cdn.hostingajeno.com/whey.jpg' },
      { where: { id: datos.harina.id } }
    );

    const res = await request(app).delete(`/api/products/${datos.harina.id}/imagen`);

    expect(res.status).toBe(200);
    await datos.harina.reload();
    expect(datos.harina.image_url).toBeNull();
  });
});
