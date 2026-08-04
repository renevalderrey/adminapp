// ════════════════════════════════════════════
//  ADMINAPP · Qué atajo dispara cada tecla en el punto de venta
//
//  Es PURA: recibe una descripción del evento —`{ key, ctrlKey, metaKey,
//  altKey, shiftKey, defaultPrevented, target: { tagName, isContentEditable,
//  dataset } }`— y devuelve el nombre del atajo o `null`. No toca el DOM, no
//  llama a `preventDefault` y no sabe qué hace cada atajo: eso es de la
//  pantalla.
//
//  Está afuera del componente porque FR-030 a FR-039 son una TABLA DE DECISIÓN
//  —tecla × modificadores × dónde está el foco— de unas cuarenta
//  combinaciones. Como función pura se prueban las cuarenta en un archivo que
//  corre en milisegundos; renderizadas, serían cuarenta montajes de la pantalla
//  entera, y la primera que alguien saque por lenta es la que atrapa el defecto.
//
//  ── Enter NO cobra, y no es una preferencia ──
//
//  Un lector de código de barras es un teclado: escribe el código en el campo
//  enfocado y manda `Enter`. Si `Enter` cobrara, **cada escaneo cobraría la
//  venta**. `PLAN-COMPRAFIT.md` 4.1 dice «cobrar con Enter»; la maqueta dice lo
//  contrario en tres lugares distintos y manda la maqueta. Queda escrito acá
//  para que la contradicción sea visible y no una omisión.
// ════════════════════════════════════════════

/**
 * El atributo que marca el campo de búsqueda del catálogo.
 *
 * Se identifica por un `data-*` y no por un `id` ni por una clase: el `id` lo
 * puede duplicar cualquiera y la clase se la lleva el primer rediseño. Lo
 * exporta este archivo para que el campo y la regla no puedan escribir cosas
 * distintas.
 */
export const ATRIBUTO_BUSCADOR = 'data-buscador-del-pos'

/** La misma marca, como la lee `dataset` (`data-buscador-del-pos`). */
const CLAVE_BUSCADOR = 'buscadorDelPos'

/**
 * Dónde se está escribiendo.
 *
 * `SELECT` entra en la lista aunque no sea un campo de texto: el `<select>`
 * nativo usa las letras para saltar a la opción que empieza con esa letra, así
 * que robarle la barra rompe una función del navegador que el usuario ya
 * conoce.
 */
function seEstaEscribiendo(destino) {
  if (!destino) return false
  if (destino.isContentEditable === true) return true

  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(destino.tagName || '').toUpperCase())
}

/** Si el foco está en el campo de búsqueda del catálogo. */
function esElBuscador(destino) {
  return destino?.dataset?.[CLAVE_BUSCADOR] !== undefined
}

/**
 * @param {object} evento Un `KeyboardEvent` o un objeto con su misma forma.
 * @returns {'enfocarBusqueda'|'agregarPrimero'|'cobrar'|'limpiar'|null}
 */
export function atajoDe(evento) {
  if (!evento) return null

  // ── Primer filtro: la tecla ya la usó otro control ──
  //
  // El `Esc` de un diálogo, el `Esc` o las flechas de un `<select>` abierto: si
  // el control la procesó, llamó a `preventDefault` y acá no hay nada que
  // hacer. Es FR-038 SIN enumerar selectores del DOM, que es lo que se rompe la
  // primera vez que alguien cambia la librería de diálogos.
  if (evento.defaultPrevented) return null

  // ── Segundo filtro: Alt y Shift no participan de ningún atajo ──
  //
  // Una combinación del sistema operativo o del navegador no puede terminar
  // cobrando una venta (FR-039).
  if (evento.altKey || evento.shiftKey) return null

  const tecla = evento.key
  const conModificador = evento.ctrlKey === true || evento.metaKey === true
  const destino = evento.target

  if (tecla === 'Enter') {
    // El único atajo que funciona desde adentro de un campo de texto: el
    // operador puede estar tipeando el CUIT y cobrar sin sacar las manos del
    // teclado (FR-035).
    if (conModificador) return 'cobrar'

    // `Enter` a secas agrega el primer resultado, y SOLO desde la búsqueda. En
    // cualquier otro campo confirma ese campo y nada más (FR-034).
    return esElBuscador(destino) ? 'agregarPrimero' : null
  }

  // De acá para abajo, ningún atajo lleva modificador: `Ctrl+/` es un atajo del
  // navegador y `Ctrl+Esc` abre el menú del sistema.
  if (conModificador) return null

  if (tecla === '/') {
    // Con el foco en un campo, `/` escribe una barra y no mueve nada: el atajo
    // no se roba una tecla que el usuario está tipeando (FR-032).
    return seEstaEscribiendo(destino) ? null : 'enfocarBusqueda'
  }

  // `Esc` a secas siempre pide limpiar. QUÉ se limpia —el campo o el ticket— lo
  // decide la pantalla, que es la que sabe si la búsqueda tiene texto.
  // Navegadores viejos mandan `Esc` en vez de `Escape`.
  if (tecla === 'Escape' || tecla === 'Esc') return 'limpiar'

  return null
}
