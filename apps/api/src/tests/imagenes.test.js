const fs = require('fs');
const os = require('os');
const path = require('path');

// El volumen de verdad no existe en la máquina de nadie ni en el CI: se apunta
// a un temporal ANTES de requerir el módulo, porque `RAIZ` se resuelve al
// cargarlo. Va acá y no en un `beforeAll` por eso mismo.
const RAIZ_DE_PRUEBA = fs.mkdtempSync(path.join(os.tmpdir(), 'favalio-img-'));
process.env.RUTA_DE_IMAGENES = RAIZ_DE_PRUEBA;

const sharp = require('sharp');
const {
  nombreAleatorio,
  rutaDeImagen,
  esImagenPropia,
  redimensionarYGuardar,
  borrarImagen,
  PREFIJO_PUBLICO,
} = require('../utils/imagenes');

// ════════════════════════════════════════════
//  utils/imagenes · lo que sostiene que una foto no sea un padrón
//
//  Va en `src/tests/` y NO en `src/utils/imagenes.test.js`: jest no levanta los
//  archivos de `utils/`, así que ahí el test existiría y no correría nunca.
// ════════════════════════════════════════════

/** Un JPEG de verdad, del tamaño que se pida. */
const jpegDe = (ancho, alto) => sharp({
  create: { width: ancho, height: alto, channels: 3, background: { r: 200, g: 40, b: 40 } },
}).jpeg().toBuffer();

afterAll(() => {
  fs.rmSync(RAIZ_DE_PRUEBA, { recursive: true, force: true });
});

describe('el nombre del archivo', () => {
  it('no se puede derivar del id del producto ni del de la empresa', () => {
    // Dos llamadas con los mismos argumentos —ninguno— dan nombres distintos.
    // Si el nombre saliera de un id, esto daría lo mismo dos veces y la URL de
    // la foto sería adivinable conociendo el id.
    const unos = new Set(Array.from({ length: 200 }, () => nombreAleatorio()));

    expect(unos.size).toBe(200);
  });

  it('son 32 caracteres hexadecimales: 16 bytes', () => {
    expect(nombreAleatorio()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('la ruta', () => {
  it('abre en dos niveles con los cuatro primeros caracteres', () => {
    expect(rutaDeImagen('a1b2c3d4.jpg')).toBe('a1/b2/a1b2c3d4.jpg');
  });

  it('NO contiene el empresa_id', () => {
    // Es la regla que impide enumerar qué empresas existen probando directorios.
    // Se afirma sobre la forma: la función no recibe la empresa, así que no la
    // puede filtrar ni por descuido.
    expect(rutaDeImagen.length).toBe(1);

    const ruta = rutaDeImagen('ff00aa11.jpg');
    expect(ruta.split('/')).toHaveLength(3);
    expect(ruta).toBe('ff/00/ff00aa11.jpg');
  });

  it('un nombre demasiado corto no pasa en silencio', () => {
    expect(() => rutaDeImagen('ab')).toThrow(/inválido/i);
    expect(() => rutaDeImagen(null)).toThrow(/inválido/i);
  });
});

describe('esImagenPropia', () => {
  it('una image_url del importador de CSV no es imagen propia', () => {
    // Es el caso real: hay productos con una URL de un hosting de terceros
    // cargada por el importador. Esas fotos no se publican.
    expect(esImagenPropia('https://cdn.hostingajeno.com/fotos/whey.jpg')).toBe(false);
    expect(esImagenPropia('http://ejemplo.com/img/whey.jpg')).toBe(false);
    expect(esImagenPropia('')).toBe(false);
    expect(esImagenPropia(null)).toBe(false);
    expect(esImagenPropia(undefined)).toBe(false);
  });

  it('la nuestra sí', () => {
    expect(esImagenPropia('/img/a1/b2/a1b2c3d4.jpg')).toBe(true);
  });
});

describe('redimensionarYGuardar', () => {
  it('achica una foto grande a la medida del uso y la guarda', async () => {
    const { url, ruta, bytes } = await redimensionarYGuardar(await jpegDe(4000, 3000), 'producto');

    expect(url.startsWith(PREFIJO_PUBLICO)).toBe(true);
    expect(bytes).toBeGreaterThan(0);
    expect(fs.existsSync(ruta)).toBe(true);

    const meta = await sharp(ruta).metadata();
    // `fit: 'inside'` conserva la proporción: 4000×3000 entra en 800×800 como
    // 800×600, no como 800×800 deformada.
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    expect(meta.format).toBe('jpeg');
  });

  it('no agranda una foto chica', async () => {
    const { ruta } = await redimensionarYGuardar(await jpegDe(300, 200), 'producto');

    const meta = await sharp(ruta).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });

  it('el logo sale en PNG, para conservar la transparencia', async () => {
    const { ruta, url } = await redimensionarYGuardar(await jpegDe(1000, 1000), 'logo');

    const meta = await sharp(ruta).metadata();
    expect(meta.format).toBe('png');
    expect(url.endsWith('.png')).toBe(true);
  });

  it('un .exe renombrado a .jpg se rechaza: lo que se mira es el contenido', async () => {
    // La cabecera `MZ` de un ejecutable de Windows. Ni la extensión ni el
    // Content-Type entran en esta decisión, porque los dos los declara el
    // cliente.
    const noEsImagen = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 esto es un ejecutable');

    await expect(redimensionarYGuardar(noEsImagen, 'producto')).rejects.toThrow();
  });

  it('no deja temporales tirados', async () => {
    await redimensionarYGuardar(await jpegDe(900, 900), 'producto');

    const sobrantes = [];
    const recorrer = (dir) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completa = path.join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(completa);
        else if (entrada.name.endsWith('.tmp')) sobrantes.push(completa);
      }
    };
    recorrer(RAIZ_DE_PRUEBA);

    expect(sobrantes).toEqual([]);
  });

  it('dos fotos del mismo producto no se pisan', async () => {
    const una = await redimensionarYGuardar(await jpegDe(500, 500), 'producto');
    const otra = await redimensionarYGuardar(await jpegDe(500, 500), 'producto');

    expect(una.url).not.toBe(otra.url);
    expect(fs.existsSync(una.ruta)).toBe(true);
    expect(fs.existsSync(otra.ruta)).toBe(true);
  });

  it('un uso desconocido no escribe nada', async () => {
    await expect(redimensionarYGuardar(await jpegDe(100, 100), 'banner')).rejects.toThrow(/uso desconocido/i);
  });
});

describe('borrarImagen', () => {
  it('borra la nuestra', async () => {
    const { url, ruta } = await redimensionarYGuardar(await jpegDe(400, 400), 'producto');

    expect(await borrarImagen(url)).toBe(true);
    expect(fs.existsSync(ruta)).toBe(false);
  });

  it('no toca una URL externa', async () => {
    expect(await borrarImagen('https://cdn.hostingajeno.com/fotos/whey.jpg')).toBe(false);
  });

  it('que ya no esté no es un error', async () => {
    // El objetivo es que después de llamar a esto el archivo no esté. Si ya no
    // estaba, se cumplió: un producto que no se puede borrar porque su foto
    // faltaba sería un problema del usuario creado por un problema de disco.
    expect(await borrarImagen('/img/00/11/0011deadbeef.jpg')).toBe(false);
  });
});
