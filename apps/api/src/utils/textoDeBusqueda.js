// ════════════════════════════════════════════
//  FAVALIO · La única comparación de texto del catálogo
//
//  `normalizarTexto` es **la única** forma en que el sistema compara categorías
//  y busca (FR-079), y tiene **tres** consumidores:
//
//   1. el índice de reglas de precio por categoría (`utils/reglasDePrecio.js`),
//   2. las píldoras de categoría de la tienda,
//   3. el buscador.
//
//  ── Por qué una sola y no una por consumidor ──
//
//  Con dos funciones distintas, `Nutremax` y `NUTREMAX` son la misma categoría
//  para una y dos categorías para la otra. La regla «20 % a la categoría
//  Nutremax» alcanza al producto cuando el precio lo calcula un lado y no lo
//  alcanza cuando lo calcula el otro: **el mismo producto aparece en el catálogo
//  con un precio y en la previsualización con otro**, y no hay ningún error en
//  ningún lado que alguien pueda mirar. La categoría es texto libre escrito a
//  mano en la ficha del producto, así que las variantes existen de verdad.
//
//  ⚠ No comparte código con `slugDeCatalogo.js` a propósito, aunque las dos
//  saquen acentos: un slug es un identificador de una URL —los espacios se
//  convierten en guiones y se colapsan— y esto es texto que un humano escribió
//  para comparar contra otro texto que otro humano escribió. Unificarlas
//  obligaría a que un cambio pensado para las URLs cambie qué categorías se
//  consideran iguales.
// ════════════════════════════════════════════

/**
 * Un texto llevado a la forma en la que se compara y se busca.
 *
 * Minúsculas, sin acentos, sin espacios en los bordes. «Proteínas » y
 * «proteinas» dan las dos `proteinas`.
 *
 * Los espacios de adentro **no** se colapsan y las palabras no se parten: lo
 * que se compara sigue siendo la categoría entera —«Suplementos deportivos» es
 * una categoría, no dos—, y el buscador hace `includes` sobre este mismo
 * string.
 *
 * La tilde de la `ñ` se saca igual que los acentos: quien escribe «nino» en el
 * buscador espera encontrar «Niño», y las dos puntas de la comparación pasan
 * por acá, así que el resultado es simétrico.
 *
 * @param {string|number|null|undefined} s Puede llegar `null` desde la base:
 *   `products.category` admite vacío.
 * @returns {string}
 */
function normalizarTexto(s) {
  return (
    String(s ?? '')
      // NFD separa cada letra acentuada en letra + marca combinante, y el
      // replace siguiente se lleva las marcas: «í» queda en «i».
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  );
}

module.exports = { normalizarTexto };
