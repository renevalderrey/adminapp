import { useEffect } from 'react'

// ════════════════════════════════════════════
//  El tema del catálogo · el único archivo de la tienda que nombra un color
//
//  Un catálogo tiene **un** color configurable (`color_marca`, un solo valor en
//  la base) y el color del texto encima **se calcula, no se elige** (FR-060).
//  Al montar, esto escribe dos variables en `document.documentElement`:
//
//      --marca         el color del comercio, ya validado
//      --marca-texto   el que contrasta contra él
//
//  Los componentes usan `var(--marca)` y **nunca** un hexadecimal. Eso es lo que
//  hace verificable «el color aparece solo en lo que se toca» (maqueta, decisión
//  1 de `docs/maqueta/README.md:65-72`): el hexadecimal está prohibido en toda
//  la tienda por `src/tests/guardiaDeLaTienda.test.js`, y este archivo es la
//  **única** excepción de esa regla — está nombrado ahí, uno solo, con su ancla.
//  Un color se define en un archivo o se define en cuarenta; no hay término
//  medio que se sostenga seis meses.
// ════════════════════════════════════════════

/** El turquesa de la maqueta. Es también el `DEFAULT` de `catalogos.color_marca`. */
export const MARCA_POR_DEFECTO = '#00B4B6'

/** Los dos únicos colores de texto posibles. Son los de la maqueta (`:1211-1218`). */
export const TEXTO_OSCURO = '#101418'
export const TEXTO_CLARO = '#FFFFFF'

/**
 * `#abc` y `#AABBCC` valen; cualquier otra cosa cae en el color por defecto.
 *
 * ⚠ La validación no es cosmética: `color_marca` viene de la base, o sea de un
 * formulario, y su valor termina metido tal cual en una propiedad CSS que los
 * componentes usan como `background: var(--marca)`. Escribir ahí una cadena sin
 * revisar es dejar que el contenido de una columna elija qué declara la hoja de
 * estilos. Lo que entra a `--marca` es siempre un `#rrggbb`.
 */
function normalizar(hex) {
  const limpio = String(hex ?? '').trim().replace('#', '')
  const seis = limpio.length === 3 ? limpio.split('').map((c) => c + c).join('') : limpio
  return /^[0-9a-fA-F]{6}$/.test(seis) ? seis.toLowerCase() : MARCA_POR_DEFECTO.slice(1).toLowerCase()
}

/** El color de marca ya validado, listo para entrar a `--marca`. */
export const colorDeMarca = (hex) => `#${normalizar(hex)}`

/**
 * Luminancia relativa (WCAG 2.x). **Portada tal cual de la maqueta**
 * (`docs/maqueta/Catalogo-de-ventas-online.dc.html:1211-1218`): los mismos
 * coeficientes, el mismo corte en 0.03928, el mismo exponente 2.4.
 */
function luminancia(hex) {
  const v = normalizar(hex)
  const r = parseInt(v.slice(0, 2), 16) / 255
  const g = parseInt(v.slice(2, 4), 16) / 255
  const b = parseInt(v.slice(4, 6), 16) / 255
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** La razón de contraste de WCAG entre dos luminancias. */
const contraste = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

// ════════════════════════════════════════════
//  ⚠ La única línea que NO se portó tal cual, y por qué
//
//  La maqueta decide con un umbral: `return L > 0.45 ? oscuro : claro`. Acá la
//  decisión es «cuál de los dos contrasta más», y el motivo es que **el umbral
//  de la maqueta devuelve el color claro para los cuatro colores de prueba**
//  (`:55-58`), incluido el turquesa que es el por defecto:
//
//      turquesa #00B4B6 → L = 0.360 → claro
//      naranja  #F0641E → L = 0.277 → claro
//      negro    #101418 → L = 0.007 → claro
//      azul     #1A1AFF → L = 0.082 → claro
//
//  Una función que devuelve lo mismo para los cuatro casos con los que se la
//  probó no está calculando el contraste: lo está eligiendo, y el criterio de
//  aceptación de FR-060 dice literalmente lo contrario. Sobre el turquesa, el
//  texto blanco da **2.56:1** —reprueba AA, que pide 4.5:1— y el oscuro da
//  **7.23:1**. La maqueta se ve bien igual porque el color aparece en botones
//  chicos, pero el día que un comercio elija un amarillo el botón queda ilegible
//  y nadie lo va a poder arreglar desde el panel: no hay dónde elegirlo.
//
//  ── Qué pasó, casi seguro ──
//
//  0.45 es un umbral razonable para el promedio ponderado **sin linealizar** —
//  el que se calcula sobre los canales tal como vienen—, no para la luminancia
//  relativa, que aplica la curva gamma y da bastante más bajo. Con esa lectura,
//  los cuatro colores de prueba dan turquesa→oscuro, naranja→oscuro,
//  negro→claro, azul→claro: **exactamente lo mismo que devuelve la comparación
//  de contraste de abajo**. O sea que esto no cambia lo que la maqueta quiso
//  decir; corrige el número que la traicionaba. `src/tests/tema.test.js` fija
//  las dos cosas: los cuatro resultados, y que coincidan con la lectura sin
//  linealizar del umbral de la maqueta.
//
//  Y comparar contrastes es, además, la forma que no necesita ningún número
//  mágico: los dos candidatos están acá arriba, se mide contra los dos y gana el
//  que mide más. No hay un 0.45 que quede descalibrado si mañana el texto oscuro
//  deja de ser `#101418`.
// ════════════════════════════════════════════
export function textoSobre(hex) {
  const fondo = luminancia(hex)
  const conOscuro = contraste(fondo, luminancia(TEXTO_OSCURO))
  const conClaro = contraste(fondo, luminancia(TEXTO_CLARO))
  return conOscuro >= conClaro ? TEXTO_OSCURO : TEXTO_CLARO
}

/**
 * Escribe las dos variables. Devuelve lo que escribió, que es lo que le permite
 * a un test afirmar sobre el resultado sin leer el DOM.
 *
 * `raiz` es un parámetro y no `document.documentElement` hardcodeado por un
 * motivo chico y concreto: la previsualización del panel (T1471) usa la **misma**
 * función sobre su propio contenedor, y sin eso terminaría con una copia de
 * `textoSobre` que se desincroniza con ésta.
 */
export function aplicarTema(colorMarca, raiz = document.documentElement) {
  const marca = colorDeMarca(colorMarca)
  const texto = textoSobre(marca)
  raiz.style.setProperty('--marca', marca)
  raiz.style.setProperty('--marca-texto', texto)
  return { marca, texto }
}

/** El tema del catálogo abierto. Se vuelve a aplicar solo si el color cambió. */
export function useTema(colorMarca) {
  useEffect(() => {
    aplicarTema(colorMarca)
  }, [colorMarca])
}
