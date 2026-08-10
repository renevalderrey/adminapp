import { test, expect } from '@playwright/test'
import { PRODUCTOS, SLUG } from './preparacion.js'

// ════════════════════════════════════════════
//  FAVALIO · El ancho de la tienda a 390px
//
//  UNA afirmación, en las dos pantallas que existen hoy: **el `<body>` no
//  desborda a lo ancho**. Los cuatro casos que faltan llegan en T1467.
//
//  ── Por qué no puede ser un test de render ──
//
//  Porque `scrollWidth` y `clientWidth` devuelven **cero siempre** en jsdom, así
//  que `0 <= 0` es verdadero con la grilla sana y con la grilla rota: el test
//  pasaría exactamente igual con el defecto puesto. Es el criterio de
//  `CONVENCIONES.md` para bajar acá, y hoy es lo único de esta app que lo cumple.
//
//  ── Lo que NO baja acá, aunque se pueda escribir ──
//
//  Qué dice cada estado, que la casilla arranque desmarcada, que el botón «Sin
//  stock» sea inerte, que el renglón de la marca no se dibuje cuando no hay
//  marca, que el precio se escriba «$38.868». Los cinco los contestan
//  `src/tests/formato.test.js`, `estados.test.jsx`, `renderDelCatalogo.test.jsx`
//  y `renderDeLaFicha.test.jsx` —134 casos— y ninguno necesita un motor de
//  maquetado. Repetirlos acá cuesta cincuenta veces más por caso, y **la regla no
//  se relaja por ser una app nueva**: una app nueva es justamente donde es fácil
//  llenar el nivel caro «ya que estamos».
//
//  ── La mutación, corrida de verdad ──
//
//  Se le puso `min-width: 420px` a `.t-grilla` en `src/tienda.css` y el caso del
//  catálogo se puso en rojo (`el <body> mide 420px de ancho y la ventana 390`);
//  el de la ficha siguió verde, que es lo correcto — esa pantalla no tiene
//  grilla—. Para comprobar que el segundo caso también muerde se repitió con
//  `min-width: 420px` en `.t-ancho`, que es de las dos pantallas, y ahí los dos
//  se pusieron en rojo. Las dos mutaciones se revirtieron.
//
//  Queda escrito porque **tres de las once primeras pruebas de geometría de este
//  repositorio no se pusieron en rojo con su mutación** y nadie se enteró hasta
//  mucho después. Una prueba de maquetado que no se probó al revés es una
//  descripción, no una prueba.
//
//  ── Las dos cosas que hacen que no pueda pasar por el motivo equivocado ──
//
//  1. **La ventana se afirma.** Si el `viewport` del config cambiara, o el
//     `<meta name="viewport">` de `index.html` desapareciera, la página se
//     maquetaría a otro ancho y «no desborda» sería verdad sobre una pantalla que
//     nadie usa. Por eso el ancho visible se compara contra 390 y no se lee.
//  2. **La pantalla se afirma antes de medirla.** `App.jsx` devuelve pantallas
//     enteras —«cargando», «no encontrada», «no disponible»— que **no desbordan**
//     porque no tienen nada adentro. Medir una de ésas es el modo de fallo más
//     probable de este archivo: pasa en verde sin haber mirado el catálogo. Por
//     eso se espera el `data-pantalla` que corresponde y las tres tarjetas.
// ════════════════════════════════════════════

/** El ancho declarado en `playwright.config.js`. Se afirma, no se lee. */
const ANCHO_DEL_TELEFONO = 390

/**
 * Lo que sobra a lo ancho, y quién se está pasando.
 *
 * `scrollWidth − clientWidth` es lo único que dice si sobra algo: es la medida
 * que reporta el navegador después de que el flex, el `min-width` del padre y
 * las reglas de `tienda.css` hayan opinado.
 *
 * ⚠ Los culpables **no** son la afirmación: son para el mensaje de error. Y se
 * filtran los que cuelgan de un contenedor que recorta —la fila de píldoras es
 * `overflow-x: auto`—, porque `getBoundingClientRect` devuelve coordenadas de
 * viewport y una píldora fuera de su scroll sigue reportando un `right` grande
 * sin que la página desborde por ella. Sin ese filtro, el mensaje acusaría
 * siempre a las categorías.
 */
function medirElAncho(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body

    const recorta = (el) => {
      for (let padre = el.parentElement; padre && padre !== body; padre = padre.parentElement) {
        const desborde = getComputedStyle(padre).overflowX
        if (desborde === 'auto' || desborde === 'scroll' || desborde === 'hidden') return true
      }
      return false
    }

    const nombrar = (el) => {
      const pantalla = el.getAttribute('data-pantalla')
      const clase = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''
      return `<${el.tagName.toLowerCase()}${pantalla ? `[data-pantalla=${pantalla}]` : ''}${clase}>`
    }

    const culpables = [...body.querySelectorAll('*')]
      .filter((el) => !recorta(el))
      .map((el) => ({ el, derecha: Math.round(el.getBoundingClientRect().right) }))
      // Un píxel de tolerancia: los redondeos de sub-píxel de un `1fr` no son un
      // desborde y no tienen por qué aparecer en el mensaje.
      .filter((x) => x.derecha > body.clientWidth + 1)
      .sort((a, b) => b.derecha - a.derecha)
      .slice(0, 3)
      .map((x) => `${nombrar(x.el)} llega a ${x.derecha}px`)

    return {
      anchoDelCuerpo: body.scrollWidth,
      anchoVisibleDelCuerpo: body.clientWidth,
      anchoDelDocumento: doc.scrollWidth,
      anchoVisible: doc.clientWidth,
      culpables,
    }
  })
}

/** Las dos comparaciones, con el mismo mensaje en las dos pantallas. */
function elCuerpoNoDesborda(medida, pantalla) {
  const detalle = medida.culpables.length
    ? ` Lo que se pasa: ${medida.culpables.join(', ')}.`
    : ' Ningún elemento suelto se pasa del borde: mirá los contenedores con ancho fijo.'

  // La ventana es la que se cree que es. Sin esto, «no desborda» podría ser
  // verdad sobre un ancho que ningún teléfono tiene.
  expect(
    medida.anchoVisible,
    `la ventana mide ${medida.anchoVisible}px y no ${ANCHO_DEL_TELEFONO}: lo que se está midiendo no es un teléfono`
  ).toBe(ANCHO_DEL_TELEFONO)

  expect(
    medida.anchoDelCuerpo,
    `el <body> ${pantalla} mide ${medida.anchoDelCuerpo}px de ancho y la ventana ${medida.anchoVisibleDelCuerpo}.${detalle}`
  ).toBeLessThanOrEqual(medida.anchoVisibleDelCuerpo)

  // Y el documento tampoco: es el que scrollea de verdad, y un desborde que
  // empujara al `<html>` sin empujar al `<body>` seguiría siendo scroll
  // horizontal en el teléfono de quien está comprando.
  expect(
    medida.anchoDelDocumento,
    `el documento ${pantalla} mide ${medida.anchoDelDocumento}px y la ventana ${medida.anchoVisible}.${detalle}`
  ).toBeLessThanOrEqual(medida.anchoVisible)
}

/** Deja el catálogo montado, con su llamada terminada y sus tres tarjetas. */
async function abrirElCatalogo(page) {
  await page.goto(`/c/${SLUG}`)
  await page.waitForLoadState('networkidle')

  await expect(
    page.locator('main[data-pantalla="catalogo"]'),
    'no se dibujó el catálogo: la tienda cayó en «cargando», «no encontrada» o «no disponible»'
  ).toBeVisible()

  await expect(page.locator('article[data-producto]')).toHaveCount(PRODUCTOS.length)
}

test.describe('A 390px la tienda no desborda a lo ancho', () => {
  test('el <body> del catálogo no desborda a lo ancho', async ({ page }) => {
    await abrirElCatalogo(page)

    elCuerpoNoDesborda(await medirElAncho(page), 'del catálogo')
  })

  test('el <body> de la ficha de producto no desborda a lo ancho', async ({ page }) => {
    await abrirElCatalogo(page)

    // Se llega por donde se llega de verdad: tocando la tarjeta. Un `goto`
    // directo a `/p/:id` es otra cosa —el slug sale del `sessionStorage` y el
    // producto de una llamada que todavía no existe (corte F2)— y mediría la
    // pantalla de «no encontrada».
    await page.getByRole('button', { name: `Ver ${PRODUCTOS[0].name}` }).click()

    await expect(
      page.locator('main[data-pantalla="producto"]'),
      'no se dibujó la ficha: el ruteo no resolvió /p/:id'
    ).toBeVisible()

    elCuerpoNoDesborda(await medirElAncho(page), 'de la ficha')
  })
})
