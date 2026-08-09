const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

// ════════════════════════════════════════════
//  Imágenes: dónde se guardan, con qué nombre y de qué tamaño
//
//  Hasta el hito 10 `products.image_url` era una URL de texto que alguien pegaba
//  a mano y que no dibujaba ninguna pantalla. El catálogo público la necesita de
//  verdad, así que las fotos pasan a vivir en un volumen del VPS, servido por
//  Caddy en `/img/`.
//
//  **Las fotos no las sirve la API** (FR-023). Un proceso de Node sirviendo
//  archivos estáticos compite por el mismo *event loop* que las cajas del
//  comercio: una foto de 800 KB que tarda es un punto de venta que tarda.
//
//  ── Tres decisiones que no son estilo ──
//
//  **1 · El `empresa_id` NO va en la ruta.** Sería cómodo —`/img/7/aa/bb/…`— y
//  convertiría el directorio en un padrón: probando `/img/1/`, `/img/2/`, … se
//  puede enumerar qué empresas existen en la plataforma. Es media vuelta al
//  mismo problema que el enlace del catálogo cierra usando un slug y no el id
//  autoincremental. El aislamiento de las fotos lo da que el nombre sea
//  **imposible de adivinar**, no que el directorio lo esconda.
//
//  **2 · El abanico de dos niveles** (`<aa>/<bb>/<nombre>`) existe para que
//  ningún directorio junte cien mil entradas. Con un solo directorio, `ls` y
//  cualquier respaldo empiezan a arrastrarse mucho antes de eso.
//
//  **3 · La escritura es atómica.** Se escribe en un temporal **del mismo
//  volumen** y se hace `rename`, que en POSIX es atómico dentro del mismo
//  sistema de archivos. Sin eso, una subida cortada a la mitad —el proceso se
//  cae, el disco se llena— deja un archivo incompleto que Caddy después sirve
//  roto, y desde afuera se ve como «la foto no carga» sin ninguna pista de por
//  qué. El temporal va al mismo volumen a propósito: un `rename` entre sistemas
//  de archivos distintos no es atómico, es copiar y borrar.
// ════════════════════════════════════════════

/**
 * Dónde está montado el volumen. Absoluta, y de una variable de entorno.
 *
 * No se deriva del `WORKDIR` del contenedor, que cambió cuando el monorepo pasó
 * a workspaces: lo que antes era `/app` hoy es `/app/apps/api`, y una ruta
 * relativa habría movido el directorio de las fotos sin que nadie lo pidiera.
 */
const RAIZ = process.env.RUTA_DE_IMAGENES || '/var/favalio/imagenes';

/** El prefijo público. Es lo que Caddy sirve desde el volumen. */
const PREFIJO_PUBLICO = '/img/';

/**
 * Las tres medidas, por uso.
 *
 * `withoutEnlargement` en las tres: una foto de 300×300 subida a un producto se
 * queda en 300×300. Agrandarla la deja borrosa y ocupa más, que es perder dos
 * veces.
 *
 * El logo va en **PNG** y no en JPEG porque la pantalla lo dibuja sobre un
 * recuadro blanco y necesita el fondo transparente. JPEG no tiene transparencia:
 * el fondo saldría negro.
 */
const USOS = {
  producto: { ancho: 800, alto: 800, formato: 'jpeg', extension: 'jpg', opciones: { quality: 82 } },
  portada: { ancho: 1200, alto: 480, formato: 'jpeg', extension: 'jpg', opciones: { quality: 82 } },
  logo: { ancho: 400, alto: 400, formato: 'png', extension: 'png', opciones: {} },
};

/**
 * Un nombre que no se puede adivinar.
 *
 * 16 bytes de `crypto.randomBytes` — el mismo molde que el token de
 * `models/Invitacion.js:24-29`. **No se deriva del id del producto ni del de la
 * empresa**: si se derivara, cualquiera que conozca un id conoce la URL de la
 * foto, y ahí el directorio vuelve a ser un padrón.
 */
function nombreAleatorio() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * `a1b2c3….jpg` → `a1/b2/a1b2c3….jpg`
 *
 * Los dos niveles salen de los **cuatro primeros caracteres del nombre**, que
 * son aleatorios: el reparto es parejo sin tener que llevar ninguna cuenta.
 *
 * @param {string} nombre El nombre con su extensión.
 */
function rutaDeImagen(nombre) {
  if (typeof nombre !== 'string' || nombre.length < 4) {
    throw new Error(`[imagenes] Nombre de archivo inválido: ${nombre}`);
  }

  return path.posix.join(nombre.slice(0, 2), nombre.slice(2, 4), nombre);
}

/**
 * ¿Esta `image_url` es una foto nuestra, o una URL pegada a mano?
 *
 * El importador de CSV acepta una columna `imagen` con una URL de cualquier
 * hosting, y hay productos con eso cargado. Esas fotos **no se publican**: viven
 * en un servidor de terceros que puede caerse, cambiar la imagen o pedir
 * referer. La pantalla las dibuja con el aviso «foto externa, no se publica».
 *
 * Es una función pura a propósito: es lo que hace verificable la regla sin
 * levantar nada.
 */
function esImagenPropia(url) {
  return typeof url === 'string' && url.startsWith(PREFIJO_PUBLICO);
}

/**
 * Redimensiona y guarda. Es lo único de este archivo que toca el disco.
 *
 * `sharp` es también **la validación**: si `metadata()` tira, el buffer no es
 * una imagen, y no importa qué extensión ni qué `Content-Type` haya declarado
 * el cliente. Un `.exe` renombrado a `.jpg` muere acá.
 *
 * @param {Buffer} buffer Lo que subió el cliente.
 * @param {'producto'|'portada'|'logo'} uso
 * @returns {Promise<{ url: string, ruta: string, bytes: number }>} `url` es la
 *   ruta **relativa** que se guarda en la base (`/img/aa/bb/xxx.jpg`), nunca la
 *   absoluta: mudarse de dominio no puede exigir migrar datos.
 */
async function redimensionarYGuardar(buffer, uso) {
  const config = USOS[uso];
  if (!config) throw new Error(`[imagenes] Uso desconocido: ${uso}`);

  // Valida y transforma en el mismo paso. Si el buffer no es una imagen, esto
  // tira y el handler lo traduce a un mensaje en castellano.
  const procesada = await sharp(buffer)
    .resize(config.ancho, config.alto, { fit: 'inside', withoutEnlargement: true })
    .toFormat(config.formato, config.opciones)
    .toBuffer();

  const nombre = `${nombreAleatorio()}.${config.extension}`;
  const relativa = rutaDeImagen(nombre);
  const destino = path.join(RAIZ, relativa);

  await fs.mkdir(path.dirname(destino), { recursive: true });

  // Temporal en el MISMO directorio —o sea, el mismo sistema de archivos— para
  // que el `rename` sea atómico. Ver el encabezado.
  const temporal = `${destino}.${process.pid}.tmp`;

  try {
    await fs.writeFile(temporal, procesada);
    await fs.rename(temporal, destino);
  } catch (err) {
    // Si el rename falló, el temporal queda: se limpia sin tapar el error
    // original, que es el que dice qué pasó de verdad.
    await fs.unlink(temporal).catch(() => {});
    throw err;
  }

  return {
    url: PREFIJO_PUBLICO + relativa,
    ruta: destino,
    bytes: procesada.length,
  };
}

/**
 * Borra el archivo de una `image_url` nuestra.
 *
 * Una URL externa no se toca: no es nuestra. Y que el archivo no exista **no es
 * un error** — el objetivo es que después de llamar a esto no esté, y si ya no
 * estaba, se cumplió.
 */
async function borrarImagen(url) {
  if (!esImagenPropia(url)) return false;

  const relativa = url.slice(PREFIJO_PUBLICO.length);
  try {
    await fs.unlink(path.join(RAIZ, relativa));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = {
  RAIZ,
  PREFIJO_PUBLICO,
  USOS,
  nombreAleatorio,
  rutaDeImagen,
  esImagenPropia,
  redimensionarYGuardar,
  borrarImagen,
};
