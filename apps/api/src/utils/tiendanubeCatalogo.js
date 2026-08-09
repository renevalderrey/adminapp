// ════════════════════════════════════════════
//  FAVALIO · TiendaNube · la respuesta del tercero, normalizada
//
//  Dos funciones puras y nada más: acá no hay ni una llamada de red ni una
//  consulta. Lo que hace red —recorrer las páginas, escribir la instantánea—
//  vive en `services/tiendanubeSincronizacion.js`, porque llamar «regla» a un
//  GET contra una API de un tercero es cómo una función pura deja de serlo.
//
//  ── Por qué la fila es la VARIANTE y no el producto ──
//
//  La unidad que tiene stock en TiendaNube es la variante: un producto con
//  talles o colores tiene varias, cada una con su SKU y su número. Agrupar por
//  producto haría que la pantalla mostrara un stock que no es de nada, y que el
//  mapeo apuntara a algo que no se puede actualizar — `PUT /products/variants/{id}`
//  pide el id de la variante.
//
//  ── Por qué la sugerencia por SKU dice CUÁNTAS coincidieron y no cuál ──
//
//  Dos productos del sistema con el mismo SKU no son imposibles en este
//  catálogo, y mapear solo por SKU es exactamente cómo se mapea el producto
//  equivocado sin que nadie lo mire: el stock de la variante empieza a salir de
//  otro producto y el síntoma aparece meses después, en un recuento. Por eso
//  cuando hay más de uno **no se propone ninguno** y la pantalla dice «hay dos».
//  [PENDIENTE N3]: hay sugerencia, no mapeo automático.
// ════════════════════════════════════════════

/**
 * Los largos de las columnas de `tiendanube_variantes`.
 *
 * Se recortan acá y no en la base: un nombre de 400 caracteres llegaría al
 * INSERT y Postgres respondería `value too long for type character varying(300)`,
 * que sale como un 500 sin ningún mensaje que diga qué pasó. El nombre es de un
 * tercero y no hay forma de pedirle que lo acorte.
 */
const LARGO = { nombre: 300, sku: 100 };

/**
 * El idioma que se prefiere cuando TiendaNube devuelve el texto por idioma.
 *
 * La API devuelve `{ es: 'Harina', pt: 'Farinha' }` en las tiendas multi-idioma
 * y un string a secas en las demás. Las dos formas entran.
 */
const IDIOMA_PREFERIDO = 'es';

/**
 * El texto de un campo que puede venir como string o como objeto por idioma.
 *
 * Devuelve `null` —y no `''`— cuando no hay nada: la columna es nullable y un
 * string vacío diría «el nombre es la cadena vacía», que no es lo mismo que «no
 * vino».
 */
function textoDeTiendanube(valor, largo = LARGO.nombre) {
  if (valor === null || valor === undefined) return null;

  if (typeof valor === 'string') return recortar(valor.trim(), largo);

  if (typeof valor === 'object') {
    const preferido = valor[IDIOMA_PREFERIDO];
    if (typeof preferido === 'string' && preferido.trim()) return recortar(preferido.trim(), largo);

    // Una tienda que no publica en castellano igual tiene que poder mapearse:
    // se toma el primer idioma con texto en vez de devolver null.
    for (const otro of Object.values(valor)) {
      if (typeof otro === 'string' && otro.trim()) return recortar(otro.trim(), largo);
    }

    return null;
  }

  return recortar(String(valor).trim(), largo);
}

function recortar(texto, largo) {
  if (!texto) return null;
  return texto.length > largo ? texto.slice(0, largo) : texto;
}

/**
 * El nombre de la variante: «300 g», «Talle M / Azul», o null si no tiene.
 *
 * TiendaNube manda las opciones en `values`, un arreglo por opción y cada una
 * con su texto por idioma. Un producto sin opciones expone igual una variante
 * por defecto, y ésa no tiene nombre: `null` es la respuesta correcta y la
 * pantalla muestra solo el producto.
 */
function nombreDeVariante(variante) {
  const valores = Array.isArray(variante.values) ? variante.values : [];

  const partes = valores
    .map((v) => textoDeTiendanube(v))
    .filter(Boolean);

  if (partes.length) return recortar(partes.join(' / '), LARGO.nombre);

  return textoDeTiendanube(variante.name);
}

/**
 * El número que la tienda dice tener, o `null`.
 *
 * ⚠ **`null` no es cero.** TiendaNube devuelve `stock: null` cuando la variante
 * tiene stock ilimitado —el vendedor apagó el control de inventario— y
 * convertirlo a cero haría que la reconciliación viera una diferencia contra
 * cualquier número y encolara esa variante para siempre. Es un dato informativo:
 * lo que se publica sale de `stock.available`, no de acá.
 */
function stockDeLaTienda(variante) {
  const crudo = variante.stock;
  if (crudo === null || crudo === undefined || crudo === '') return null;

  const numero = Number(crudo);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

/**
 * Todas las páginas del catálogo, aplanadas a una fila por variante.
 *
 * @param {Array<Array<object>>} paginas Lo que devuelve `getProducts`: un
 *   arreglo de páginas, cada una con los productos que trajo esa llamada.
 * @returns {Array<{tiendanube_variant_id: number, tiendanube_product_id: number,
 *   nombre_producto: string|null, nombre_variante: string|null,
 *   sku: string|null, stock_en_tienda: number|null}>}
 */
function normalizarCatalogo(paginas) {
  const filas = [];

  for (const pagina of Array.isArray(paginas) ? paginas : []) {
    for (const producto of Array.isArray(pagina) ? pagina : []) {
      if (!producto || producto.id === null || producto.id === undefined) continue;

      // ⚠ `variants` puede venir `null`: pasa con un producto a medio cargar
      // desde el panel de TiendaNube. Sin esta guarda, `for (… of null)` tira y
      // **el refresco entero se cae por un producto**, dejando la instantánea a
      // medias sin que nada diga cuál fue.
      const variantes = Array.isArray(producto.variants) ? producto.variants : [];

      const nombreProducto = textoDeTiendanube(producto.name);

      for (const variante of variantes) {
        if (!variante || variante.id === null || variante.id === undefined) continue;

        filas.push({
          tiendanube_variant_id: variante.id,
          tiendanube_product_id: producto.id,
          nombre_producto: nombreProducto,
          nombre_variante: nombreDeVariante(variante),
          // El SKU vacío se guarda como `null` y no como `''`: son lo mismo para
          // una persona y **no** para la sugerencia por SKU, donde dos cadenas
          // vacías coincidirían entre sí y propondrían un mapeo al azar.
          sku: textoDeTiendanube(variante.sku, LARGO.sku),
          stock_en_tienda: stockDeLaTienda(variante),
        });
      }
    }
  }

  return filas;
}

/**
 * El SKU comparable: sin espacios de los costados y sin distinguir mayúsculas.
 *
 * Devuelve `null` cuando no queda nada, y ése es el punto: un SKU vacío **no
 * coincide con otro SKU vacío**. Es el caso que la spec nombra entre los de
 * borde y el que convertiría «no tengo código» en «son el mismo producto».
 */
function skuComparable(sku) {
  if (sku === null || sku === undefined) return null;

  const limpio = String(sku).trim().toUpperCase();
  return limpio === '' ? null : limpio;
}

/**
 * Qué producto del sistema propone cada variante, por SKU coincidente.
 *
 * @param {Array<{tiendanube_variant_id: number|string, sku: string|null}>} variantes
 * @param {Array<{id: number, name: string, sku: string|null}>} productos
 * @returns {Map<string, {coincidencias: number, producto: object|null}>} Indexado
 *   por `String(tiendanube_variant_id)` — la columna es BIGINT y el driver la
 *   devuelve como texto, así que comparar por número perdería filas.
 */
function sugerirPorSku(variantes, productos) {
  const porSku = new Map();

  for (const producto of Array.isArray(productos) ? productos : []) {
    const sku = skuComparable(producto && producto.sku);
    if (!sku) continue;

    if (!porSku.has(sku)) porSku.set(sku, []);
    porSku.get(sku).push(producto);
  }

  const sugerencias = new Map();

  for (const variante of Array.isArray(variantes) ? variantes : []) {
    if (!variante) continue;

    const sku = skuComparable(variante.sku);
    const candidatos = sku ? porSku.get(sku) || [] : [];

    sugerencias.set(String(variante.tiendanube_variant_id), {
      coincidencias: candidatos.length,
      // Con dos o más NO se propone ninguno: la pantalla dice «hay dos» y quien
      // mapea elige. Devolver el primero sería elegir por el orden en que
      // Postgres haya devuelto las filas.
      producto: candidatos.length === 1
        ? { id: candidatos[0].id, name: candidatos[0].name, sku: candidatos[0].sku }
        : null,
    });
  }

  return sugerencias;
}

module.exports = { normalizarCatalogo, sugerirPorSku, skuComparable };
