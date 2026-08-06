import { test, expect } from '@playwright/test'
import { variante } from './siembraDeTiendanube.js'

// ════════════════════════════════════════════
//  ADMINAPP · El maquetado de /tiendanube
//
//  DOS afirmaciones del hito 013, y ninguna más:
//
//   1. el nombre largo de una variante se recorta y **no se mete en la columna
//      de al lado** de la tabla de variantes;
//   2. el panel de mapeo mide **520px de verdad**, después de que opinen el
//      `max-w-[92vw]` de `PanelDeMapeo.jsx` y el
//      `data-[side=right]:sm:max-w-sm` que `ui/sheet.jsx` trae puesto.
//
//  La tercera medida que T1346 nombra —que `/tiendanube` esté adentro del
//  contenedor de 1320px y que el `<body>` no desborde— **ya está escrita y no se
//  duplica acá**: es la ruta dieciocho de `marcoDeLasPantallas.navegador.js`,
//  que T1338 agregó a `CON_MARCO` antes de que la pantalla existiera. Repetirla
//  en este archivo daría dos rojos por el mismo defecto y ninguno de los dos
//  diría dónde mirar.
//
//  ── Lo que NO baja acá, aunque se pueda escribir ──
//
//  El tono de un badge, qué variantes entran en el filtro, el texto del resumen
//  de la corrida y el cálculo del backoff. Los cuatro los contesta una función
//  pura —`utils/tiendanube.js`, `utils/tiendanubeCola.js`— y el dibujo lo cubre
//  `src/tests/renderDeTiendanube.test.jsx`. Repetirlos en Chromium cuesta
//  cincuenta veces más por caso, y **una suite lenta es una suite que alguien
//  termina salteando**.
//
//  ── Los dos motivos por los que esta pantalla podía medirse vacía ──
//
//  Los dos están resueltos en `preparacion.js` y los dos valen la pena escritos,
//  porque el síntoma de cada uno es el mismo —«no encuentro la fila»— y la causa
//  es distinta:
//
//   · **El módulo.** `/tiendanube` cuelga de `RouteGuard
//     requiredModule="tiendanube"` y ninguna empresa lo tiene en
//     `enabled_modules`, así que sin la siembra el navegador termina en `/pos`.
//     Por eso `abrir()` compara el `pathname` y lo dice con esas palabras.
//   · **La tienda.** Sin `TIENDANUBE_CLIENT_ID` en el arranque de la API,
//     `GET /status` responde `sin_configurar` y la pantalla dibuja un estado
//     vacío **por más filas que haya en la base**.
//
//  ⚠ `src/index.css` tiene un `@source not` para esta carpeta, y una guardia en
//  `tests/guardiasDeDiseno.test.js` que lo protege. Sin esa línea, cada clase
//  arbitraria mencionada acá entraría al CSS que baja el navegador del cliente.
// ════════════════════════════════════════════

/**
 * El ancho apretado para esta pantalla.
 *
 * Es el mismo que usa `proveedoresYOrdenes.navegador.js`, y por el mismo motivo:
 * es donde las columnas aprietan sin llegar al apilado de `lg:`. La tabla
 * declara `anchoMinimo={1040}`, así que a 1140 la columna del nombre queda en
 * unos 230px y un nombre de ochenta caracteres no entra ni cerca — que es
 * exactamente la condición que hace falta para que esto pruebe algo.
 */
const ANCHO_APRETADO = 1140

/** La variante sembrada con las dos líneas largas. */
const LARGA = variante('nombre_largo')

/** La variante que el panel abre: sin mapear, para que dibuje el bloque de elección. */
const SIN_MAPEAR = variante('segunda_variante')

/**
 * Deja `/tiendanube` montada, con sus pedidos al servidor terminados.
 *
 * Los tres rojos que distingue son los mismos que `marcoDeLasPantallas`
 * documenta, y el tercero es el que puede pasar **en verde**: si el navegador
 * terminó en `/pos` porque el módulo no está habilitado, todo lo que se mida
 * después es de otra pantalla.
 */
async function abrirTiendanube(page) {
  await page.goto('/tiendanube')
  await page.waitForLoadState('networkidle')

  // `App.jsx` devuelve pantallas enteras —«Validando sesión…», «Redirigiendo…»—
  // sin `<main>` cuando la sesión o el contexto fallan. Sin esta espera, lo que
  // se mide es el cero de un DOM que no es el de ninguna pantalla.
  await expect(page.locator('main > *').first()).toBeVisible()

  const donde = await page.evaluate(() => location.pathname)

  expect(
    donde,
    'el navegador terminó en ' + donde + ' en vez de /tiendanube: el módulo «tiendanube» no está '
    + 'en enabled_modules de la empresa de pruebas, así que RouteGuard redirige a /pos '
    + '(App.jsx:58-62). Lo siembra habilitarLosModulos() de preparacion.js; en producción es el paso manual P4.'
  ).toBe('/tiendanube')

  // Y que la tabla exista de verdad: con `sin_configurar` o sin tienda vinculada
  // la pantalla dibuja un estado vacío, y medir columnas sobre él daría cero sin
  // que nada dijera por qué.
  await expect(
    page.locator('main [style*="grid-template-columns"]').first(),
    'no hay ninguna tabla de variantes en /tiendanube: la pantalla quedó en un estado vacío. '
    + 'Revisar TIENDANUBE_CLIENT_ID en el arranque de la API y la siembra de siembraDeTiendanube.js.'
  ).toBeVisible()
}

// ════════════════════════════════════════════
//  1 · El nombre largo de una variante
// ════════════════════════════════════════════

test.describe('La tabla de variantes al ancho apretado', () => {
  test.use({ viewport: { width: ANCHO_APRETADO, height: 900 } })

  /**
   * ⚠ **Las tres mutaciones, con sus números.** Todas sobre los dos `truncate`
   * de las dos líneas de la celda del nombre en `pages/Tiendanube.jsx` —el `<p>`
   * de `nombre_producto` y el de `nombre_variante`—, medidas a 1140px, y cada
   * una pone en rojo un `expect` **distinto**:
   *
   *  · `truncate` → `whitespace-nowrap`: el texto se sigue pintando fuera de su
   *    caja. La primera línea llega a **x=876** y la segunda a **x=746**, con la
   *    columna del SKU arrancando en **x=540**. Rojo en (2).
   *  · `truncate` borrado: el texto se parte por los guiones y **ENTRA** en la
   *    celda, así que ya no hay nada que recortar. Rojo en (1) — y por eso el
   *    nombre sembrado lleva guiones: sin ellos no habría dónde partir, el texto
   *    seguiría desbordado y esta mutación no distinguiría nada.
   *  · `truncate` → `overflow-hidden whitespace-nowrap`: `text-overflow` pasa a
   *    `clip` y el nombre se corta a la mitad de una letra. Rojo en (4).
   *
   * ⚠ **Las tres se ejercitaron desde el navegador y no editando la pantalla**
   * —inyectando la regla con `addStyleTag` sobre los dos `<p>`—, porque
   * `pages/Tiendanube.jsx` lo estaba escribiendo otra fase en el mismo momento.
   * Lo que queda afirmado es que estos `expect` **detectan** la falta del
   * recorte; que la línea que hoy lo provee sea ese `truncate` y no otra cosa,
   * lo dice `guardiasDeDiseno.test.js`, que es donde una clase es barata de
   * verificar.
   *
   * ⚠⚠ **Y lo que se probó y NO pone nada en rojo**, escrito para que nadie lo
   * verifique así y concluya que esta prueba no sirve: sacarle `min-w-0` al
   * `<div>` de la celda. La pista es `minmax(0,1.7fr)` y la función de tamaño
   * mínimo de esa pista ya es `0`, así que el mínimo automático del ítem de grid
   * es cero y `min-w-0` no agrega nada. Solo mordería si la pista pasara a
   * `1.7fr` a secas, que es por qué en este repositorio las columnas flexibles
   * se escriben `minmax(0, …)`. Es el mismo hallazgo que dejó escrito
   * `proveedoresYOrdenes.navegador.js`.
   */
  test('un nombre de variante largo se recorta y NO se mete en la columna del SKU', async ({ page }) => {
    await abrirTiendanube(page)
    await expect(page.getByText(LARGA.nombre_producto)).toBeVisible()

    const m = await page.evaluate((nombreLargo) => {
      const rejillas = [...document.querySelectorAll('main [style*="grid-template-columns"]')]

      // La primera es el encabezado; las filas empiezan en la segunda.
      const filas = rejillas.slice(1)
      const fila = filas.find((f) => f.textContent.includes(nombreLargo))
      const normal = filas.find((f) => f !== fila)
      if (!fila || !normal) return { falta: true }

      // ── Dónde termina el texto DIBUJADO, no dónde termina su caja ──
      //
      // `getBoundingClientRect()` de un `<p>` devuelve la caja de maquetado, y
      // esa caja no crece cuando el texto se desborda: con `white-space: nowrap`
      // y sin recorte, el nombre se pinta encima de la columna de al lado y el
      // rectángulo del `<p>` sigue diciendo que todo está en su lugar.
      //
      // Un `Range` sobre el contenido sí devuelve la extensión real del texto.
      // Si el elemento recorta, lo que se ve es la intersección de las dos, que
      // es exactamente lo que hace el navegador al pintar.
      const medirLinea = (el) => {
        const rango = document.createRange()
        rango.selectNodeContents(el)
        const tinta = rango.getBoundingClientRect()
        const caja = el.getBoundingClientRect()
        const recorta = getComputedStyle(el).overflowX !== 'visible'

        return {
          texto: el.textContent.slice(0, 24),
          entra: el.scrollWidth <= el.clientWidth,
          anchoDelTexto: el.scrollWidth,
          anchoDeLaCelda: el.clientWidth,
          recorte: getComputedStyle(el).textOverflow,
          derecha: Math.round(recorta ? Math.min(tinta.right, caja.right) : tinta.right),
        }
      }

      // Las DOS líneas de la celda: `nombre_producto` arriba y `nombre_variante`
      // abajo, cada una con su propio `truncate`. Mirar solo la de arriba dejaría
      // la de abajo sin cubrir, y las dos salen del mismo dato de la tienda.
      const celdaDelNombre = fila.children[0]
      const lineas = [...celdaDelNombre.querySelectorAll('p')].map(medirLinea)

      const columnas = (f) => [...f.children].map((c) => Math.round(c.getBoundingClientRect().left))

      return {
        lineas,
        // La columna de al lado es la del SKU, y es la cota más ajustada: un
        // nombre que llegara hasta la columna de acciones —el otro extremo de la
        // fila— tuvo que pasar por ésta primero. Un `expect` contra la de
        // acciones nunca podría ponerse en rojo por sí solo, así que no se
        // escribe: es la misma disciplina que dejó escrita la 011 con el
        // `shrink-0` redundante.
        izquierdaDelSku: Math.round(fila.children[1].getBoundingClientRect().left),
        izquierdaDeAcciones: Math.round(fila.children[6].getBoundingClientRect().left),
        columnasDeLaLarga: columnas(fila),
        columnasDeLaNormal: columnas(normal),
      }
    }, LARGA.nombre_producto)

    expect(m.falta, 'no se encontró la fila del nombre largo ni una fila de referencia').toBeFalsy()
    expect(m.lineas.length, 'la celda del nombre dejó de tener sus dos líneas').toBe(2)

    // (1) Las dos líneas efectivamente NO entran. Sin esto la prueba pasaría con
    //     cualquier nombre corto y no estaría probando ningún recorte.
    for (const linea of m.lineas) {
      expect(
        linea.entra,
        `«${linea.texto}…» entra en la celda (${linea.anchoDelTexto}px en ${linea.anchoDeLaCelda}px): `
        + 'no hay nada que recortar y esta prueba no está midiendo lo que dice'
      ).toBe(false)
    }

    // (2) Y el texto DIBUJADO no llega a la columna de al lado. Va antes que el
    //     `textOverflow` a propósito: es la afirmación que da nombre al caso, y
    //     con el orden al revés el `expect` de la elipsis se llevaría el rojo y
    //     nadie se enteraría de cuánto se metió el nombre.
    for (const linea of m.lineas) {
      expect(
        linea.derecha,
        `«${linea.texto}…» se pinta hasta ${linea.derecha}, el SKU arranca en ${m.izquierdaDelSku} `
        + `y las acciones en ${m.izquierdaDeAcciones}: se pisan`
      ).toBeLessThanOrEqual(m.izquierdaDelSku)
    }

    // (3) Las columnas de la fila larga arrancan en el MISMO píxel que las de una
    //     fila normal: leer un stock bajo la etiqueta «SKU» es el defecto que la
    //     disciplina del `grid-template-columns` compartido existe para evitar.
    //     Es red de contención —ninguna de las tres mutaciones de arriba lo pone
    //     en rojo por sí sola, porque cada fila es su propia rejilla— y está para
    //     el día que alguien escriba `1.7fr` en vez de `minmax(0,1.7fr)`.
    expect(m.columnasDeLaLarga).toEqual(m.columnasDeLaNormal)

    // (4) Y lo que se corta se corta con elipsis y no a la mitad de una letra.
    for (const linea of m.lineas) {
      expect(linea.recorte, `«${linea.texto}…» se corta sin decir que sigue`).toBe('ellipsis')
    }
  })
})

// ════════════════════════════════════════════
//  2 · El panel de mapeo
// ════════════════════════════════════════════

test.describe('El panel de mapeo de una variante', () => {
  /**
   * ⚠ **La mutación, corrida, y con sus dos números.** Se cambia el
   * `style={{ width: '520px', maxWidth: '92vw' }}` de `PanelDeMapeo.jsx` por
   * `className="w-[520px]"` y el panel pasa a medir **384px**:
   * `data-[side=right]:sm:max-w-sm` de `ui/sheet.jsx` es `max-width: 24rem` y
   * vive en un media query que gana por orden de hoja.
   *
   * ⚠⚠ **Y una variante de la mutación que se probó y da otro número, escrita
   * porque explica por qué el estilo en línea lleva las DOS propiedades**: si se
   * pasa solo el ancho a clase y se deja el `maxWidth: '92vw'` en línea, el
   * panel mide **1440px** —`w-3/4` de 1920—. `tailwind-merge` no puede unificar
   * `w-[520px]` con `data-[side=right]:w-3/4` porque son grupos distintos —una
   * tiene variante y la otra no—, así que las dos sobreviven y gana la del
   * sheet; y el `max-w-sm` que la habría atado a 384 lo tapa el `maxWidth` en
   * línea. O sea que **el `92vw` inline es lo único que impide que el tope
   * quede a merced del orden de la hoja**.
   *
   * Es exactamente el motivo por el que el ancho va en `style` y no en clases, y
   * es lo que ningún test de render puede contestar: jsdom no aplica CSS, así
   * que `w-[520px]` y el estilo en línea se ven igual de bien. Es el mismo
   * defecto que la 012 midió sobre `PanelOrdenDeCompra`, y está escrito dos
   * veces porque son dos paneles distintos: el ancho de uno no dice nada del
   * otro.
   */
  test('mide 520px de verdad, y no los 384 del max-w-sm que trae el sheet', async ({ page }) => {
    await abrirTiendanube(page)

    // Se abre desde la fila, que es el camino de la persona. Se elige por el
    // nombre de la VARIANTE y no por el del producto: hay dos variantes del
    // mismo producto sembradas a propósito, así que el nombre del producto está
    // en dos filas y no identifica ninguna.
    await page.getByText(SIN_MAPEAR.nombre_variante, { exact: true }).click()

    const panel = page.locator('[data-slot="sheet-content"]')
    await expect(panel).toBeVisible()

    // El panel se abre con una animación y el bloque de elección es lo último
    // que aparece; medir antes mediría la caja a mitad de camino.
    await expect(panel.getByText('Se va a mapear contra')).toBeVisible()

    const m = await panel.evaluate((el) => ({
      ancho: Math.round(el.getBoundingClientRect().width),
      maximo: getComputedStyle(el).maxWidth,
    }))

    // 520px es FR-053 y lo que dice `docs/REGLAS-DISENO.md`. Se mide el ancho
    // RENDERIZADO y no la clase: lo que importa es el número que queda después
    // de que opinen las reglas del componente de shadcn.
    expect(m.ancho).toBe(520)

    // Y el tope relativo sigue puesto, que es lo que salva al panel en una
    // ventana angosta. A 1920px no ata nada —92vw son 1766px—, así que se
    // verifica que exista y no cuánto mide.
    expect(m.maximo).not.toBe('none')
  })
})
