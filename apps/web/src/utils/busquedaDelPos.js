// ════════════════════════════════════════════
//  ADMINAPP · La búsqueda del punto de venta
//
//  El mismo campo lo usan dos cosas que se contradicen: el operador buscando
//  «la creatina esa» y el lector de código de barras escaneando un EAN.
//
//  `Fuse` está configurado con `threshold: 0.4`, que es lo que hace que
//  «colageno» sin tilde encuentre «Colágeno». Sobre un EAN de 13 dígitos que NO
//  existe en el catálogo, ese mismo umbral casi siempre devuelve *algo* —los
//  códigos comparten dígitos— y con `Enter` agregando el primer resultado eso
//  significa **agregar al ticket un producto que nadie escaneó**: un producto
//  vendido que no salió del local, descubierto en un recuento físico.
//
//  Bajar el umbral no sirve: un solo número no puede servir para «Colageno» con
//  typo y para un EAN. Por eso la búsqueda resuelve en tres pasos y la difusa es
//  el último.
//
//  ⚠ Depende de que el catálogo tenga los códigos cargados. Si `barcode` está
//  vacío en la mayoría de los productos, el paso 2 empieza a rechazar escaneos
//  de productos que SÍ están cargados. Por eso el aviso que consume esto dice
//  «ningún producto tiene ese código de barras o SKU»: apunta al dato que falta
//  y no al producto, y el operador puede seguir buscando por nombre en el mismo
//  campo.
// ════════════════════════════════════════════

/**
 * Un código comparable: sin espacios, sin guiones y en mayúsculas.
 *
 * Los SKU se escriben «COL-300» en el sistema y «col 300» a mano, y el lector
 * de algunos códigos mete espacios. Comparar los dos crudos no encuentra nada y
 * el operador no se entera de por qué.
 */
function normalizar(valor) {
  return String(valor ?? '').replace(/[\s-]/g, '').toUpperCase()
}

/** Cuántos dígitos alcanzan para decir «esto es un código, no un nombre». */
const LARGO_MINIMO_DE_CODIGO = 8

/**
 * Si la consulta parece un código escaneado y no un texto buscado.
 *
 * Solo dígitos y ocho o más: un EAN-8, un EAN-13 y los códigos internos entran;
 * «300» —que es parte de un nombre de producto— no.
 */
function pareceUnCodigo(consultaNormalizada) {
  return /^\d+$/.test(consultaNormalizada) && consultaNormalizada.length >= LARGO_MINIMO_DE_CODIGO
}

/**
 * Qué productos ofrece la búsqueda para esa consulta.
 *
 * @param {Array} catalogo Los productos ya filtrados por categoría, marca y stock.
 * @param {string} consulta Lo que hay escrito en el campo.
 * @param {object} fuse La instancia de `Fuse` armada sobre ese mismo catálogo.
 * @returns {{resultados: Array, exacta: boolean, codigoNoEncontrado: boolean}}
 *   `exacta` significa «este es el producto, no un parecido».
 *   `codigoNoEncontrado` significa «se escaneó algo que no está cargado».
 */
export function buscarEnCatalogo(catalogo, consulta, fuse) {
  const lista = Array.isArray(catalogo) ? catalogo : []
  const texto = String(consulta ?? '').trim()

  if (!texto) return { resultados: lista, exacta: false, codigoNoEncontrado: false }

  const buscado = normalizar(texto)

  // ── 1. El código exacto gana ──
  // Aunque haya diez productos con nombre parecido: si el código está, es ese.
  const exacto = lista.find(
    (p) => normalizar(p.barcode) === buscado || normalizar(p.sku) === buscado
  )

  if (exacto) return { resultados: [exacto], exacta: true, codigoNoEncontrado: false }

  // ── 2. Parece un código y no está: no se ofrece un parecido ──
  // Devolver el producto más parecido a un EAN inexistente es venderlo.
  if (pareceUnCodigo(buscado)) {
    return { resultados: [], exacta: false, codigoNoEncontrado: true }
  }

  // ── 3. La difusa de siempre ──
  const resultados = fuse ? fuse.search(texto).map((r) => r.item) : []

  return { resultados, exacta: false, codigoNoEncontrado: false }
}
