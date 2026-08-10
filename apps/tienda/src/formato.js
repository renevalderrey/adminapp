// ════════════════════════════════════════════
//  Las cuatro funciones puras de las pantallas
//
//  Formatear un importe, normalizar un texto para compararlo, decidir si un
//  producto entra en el filtro y elegir la categoría más parecida a lo que
//  alguien escribió mal. Ninguna dibuja nada y ninguna necesita jsdom: son las
//  reglas que las pantallas aplican, separadas de las pantallas por el mismo
//  motivo por el que `carrito.js` separa las suyas — un test que necesita montar
//  un componente para verificar que «creatnia» sugiere «Creatinas» es un test que
//  se escribe la mitad de las veces.
//
//  ── La tienda no calcula precios: los formatea (H2) ──
//
//  `precioTexto` recibe el número que mandó el servidor y le pone los separadores.
//  No suma, no multiplica por cantidad, no aplica descuentos y no redondea nada
//  que cambie el importe. El precio final, el de lista y el ahorro **ya vienen
//  resueltos** (`utils/vistaPublica.js`): acá solo se eligen los puntos.
// ════════════════════════════════════════════

/**
 * El separador de miles argentino, sin traerse una librería de moneda.
 *
 * ⚠ `style: 'currency'` **no** se usa a propósito: mete un espacio duro entre el
 * signo y el número —y en algunos entornos un espacio fino, U+202F— que cambia
 * según la versión de ICU con la que corra. El resultado es un texto que se ve
 * bien y que un test no puede afirmar sin adivinar qué carácter le tocó. El signo
 * se escribe acá, pegado, como en la maqueta: `$38.868`.
 */
const SEPARADOR = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function precioTexto(importe) {
  const numero = Number(importe)
  return `$${SEPARADOR.format(Number.isFinite(numero) ? numero : 0)}`
}

/**
 * ⚠ **La misma normalización que el servidor**, portada de
 * `apps/api/src/utils/textoDeBusqueda.js`: minúsculas, sin acentos, sin espacios
 * en los bordes, y **sin colapsar los de adentro**.
 *
 * Tiene que ser la misma o el filtrado del navegador y el del servidor dejan de
 * coincidir, y el defecto es de los que no se ven: la píldora «Proteínas» muestra
 * seis productos con la primera página embebida y ocho después de apretar «ver
 * más», porque de un lado «Proteínas » y «proteinas» son la misma categoría y del
 * otro son dos. Nadie lo lee como un error; lo lee como que aparecieron
 * productos.
 *
 * No se importa del paquete de la API porque `apps/tienda` no comparte código con
 * el servidor —ni podría: es CommonJS y corre en Node—. Se porta, con esta nota,
 * y `src/tests/formato.test.js` fija los mismos casos que el test de allá.
 */
export function normalizarTexto(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Si un producto entra en el filtro que está puesto en la pantalla.
 *
 * Es la misma regla del servidor (`catalogoPublico.js:277-285`): la categoría se
 * compara **entera y exacta** una vez normalizada, y el texto se busca con
 * `includes` sobre «nombre marca».
 *
 * ⚠ `'marca' in producto` no se usa acá y `producto.marca || ''` sí: la clave
 * está **ausente** en el 96 % de los productos migrables, y `undefined || ''`
 * da `''`, que es lo que corresponde buscar. Lo que nunca hay que hacer es
 * **dibujar** ese `undefined`; eso lo cuida la tarjeta, no esto.
 */
export function entraEnElFiltro(producto, { q = '', categoria = '' } = {}) {
  const texto = normalizarTexto(q)
  const cat = normalizarTexto(categoria)

  if (cat && normalizarTexto(producto.categoria || '') !== cat) return false
  if (!texto) return true
  return normalizarTexto(`${producto.nombre} ${producto.marca || ''}`).includes(texto)
}

/** La distancia de edición, iterativa y con una sola fila viva. */
function distancia(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let fila = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i += 1) {
    const siguiente = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      siguiente[j] = Math.min(fila[j] + 1, siguiente[j - 1] + 1, fila[j - 1] + costo)
    }
    fila = siguiente
  }

  return fila[b.length]
}

/** Cuánto se parecen dos textos, entre 0 y 1. */
const parecido = (a, b) => (a === b ? 1 : 1 - distancia(a, b) / Math.max(a.length, b.length))

/**
 * ⚠ **El vacío no termina en un cartel** (maqueta, «Búsqueda sin resultados»).
 *
 * Cuando alguien escribe «creatnia» y no sale nada, el estado ofrece la categoría
 * **Creatinas**, que es lo que esa persona venía a buscar. Sin esto, la búsqueda
 * mal escrita —que es la normal, escrita con el pulgar y en la puerta de un
 * gimnasio— termina en una pantalla que dice «no hay nada» y en un socio que
 * cierra la pestaña.
 *
 * Dos criterios, en orden:
 *
 *  1. **Contención.** «prote» contra «Proteínas» no es un error de tipeo, es una
 *     búsqueda a medio escribir; se resuelve por `includes` y no por distancia,
 *     que la castigaría por larga.
 *  2. **Distancia de edición**, con un piso de parecido. «creatnia» contra
 *     «creatinas» da 3 sobre 9 → 0.67, que pasa. «zapatillas» contra
 *     «creatinas» da 0.4, que no: sugerir cualquier cosa es peor que no
 *     sugerir nada, porque manda a alguien a mirar una categoría que no tiene lo
 *     que busca y le confirma que la tienda no lo tiene.
 *
 * @param {string} consulta Lo que se escribió en el buscador.
 * @param {Array<{categoria: string, etiqueta: string}>} categorias Las del catálogo.
 * @returns {object|null} La categoría, o `null` si ninguna se parece lo suficiente.
 */
export const PARECIDO_MINIMO = 0.6

export function categoriaMasParecida(consulta, categorias = []) {
  const busca = normalizarTexto(consulta)
  if (!busca || !categorias.length) return null

  let mejor = null
  let mejorPuntaje = 0

  for (const c of categorias) {
    const nombre = normalizarTexto(c.categoria || c.etiqueta || '')
    if (!nombre) continue

    // La contención gana siempre, y entre dos que contienen gana la más corta:
    // «prote» está en «Proteínas» y en «Proteínas veganas», y la primera es la
    // que abarca a la otra.
    const contiene = nombre.includes(busca) || busca.includes(nombre)
    const puntaje = contiene ? 1 + 1 / nombre.length : parecido(busca, nombre)

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejor = c
    }
  }

  return mejorPuntaje >= PARECIDO_MINIMO ? mejor : null
}
