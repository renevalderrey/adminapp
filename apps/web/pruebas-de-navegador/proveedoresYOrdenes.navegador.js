import { test, expect } from '@playwright/test'
import { NOMBRE_LARGO, PROVEEDORES } from './preparacion.js'

// ════════════════════════════════════════════
//  ADMINAPP · El maquetado de Proveedores y de Órdenes de compra
//
//  Las CUATRO afirmaciones del hito 012 que solo contesta un motor de
//  maquetado, y ninguna más:
//
//   1. la tabla de órdenes scrollea DENTRO de su tarjeta y el `<body>` no
//      desborda a lo ancho, a 1140px y a 1920px (FR-013, US1 escenario 13);
//   2. el panel mide 520px de verdad, después de que opinen el `max-w-[92vw]` y
//      el `data-[side=right]:sm:max-w-sm` que `ui/sheet.jsx` trae puesto
//      (US2 escenario 1, FR-014);
//   3. el nombre de proveedor de 80 caracteres no se mete en la columna del
//      saldo (caso de borde de «Proveedores y cuenta»);
//   4. las dos columnas de `/proveedores` conviven a 1140px: ninguna se mete en
//      la otra y ninguna se sale del marco (US5, FR-054).
//
//  ── Lo que NO baja acá, aunque se pueda escribir ──
//
//  El color del badge, qué órdenes entran en cada segmento, el porcentaje de la
//  barra de recepción y el redondeo de un importe. Los cuatro los contesta una
//  función pura —`utils/ordenDeCompra.js`, `utils/cuentaDeProveedor.js`,
//  `utils/formato.js`— y el dibujo lo cubren `renderDeOrdenesDeCompra.test.jsx`
//  y `renderDeProveedores.test.jsx`. Repetirlos en Chromium cuesta cincuenta
//  veces más por caso, y **una suite lenta es una suite que alguien termina
//  salteando**.
//
//  ── La mutación de cada caso, y qué se midió ──
//
//  La 011 aprendió a la mala que una prueba de geometría puede pasar por
//  razones que no tienen nada que ver con lo que dice verificar: tres de sus
//  primeras once no se pusieron en rojo con su mutación. Acá cada caso lleva
//  escrito arriba con qué cambio se lo puso en rojo y **con qué número**, que es
//  lo único que demuestra que mide lo que dice medir.
//
//  ⚠ `src/index.css` tiene un `@source not` para esta carpeta, y una guardia en
//  `tests/guardiasDeDiseno.test.js` que lo protege. Sin esa línea, cada clase
//  arbitraria mencionada acá —`w-[520px]`, `min-w-[1140px]`— entraría al CSS que
//  baja el navegador del cliente. Medido en la 011: +130 bytes con una sola.
// ════════════════════════════════════════════

/**
 * El ancho mínimo del diseño para estas dos pantallas.
 *
 * No es 1080 como en el punto de venta: la tabla de órdenes declara
 * `ANCHO_MINIMO = 1060` y `/proveedores` reparte 340px + el resto. 1140 es el
 * ancho en el que las dos aprietan sin llegar al apilado de `lg:`, que es donde
 * vive el defecto que estas pruebas buscan.
 */
const ANCHO_APRETADO = 1140

/**
 * Un proveedor sembrado, por su estado de cuenta.
 *
 * Se busca por `clave` y no por posición: `preparacion.js` puede reordenar la
 * lista y una prueba anclada en `[2]` empezaría a medir otra fila sin que nada
 * avise.
 */
const proveedor = (clave) => PROVEEDORES.find((p) => p.clave === clave).name

/** Deja la pantalla montada y con sus pedidos al servidor terminados. */
async function abrir(page, ruta) {
  await page.goto(ruta)
  await page.waitForLoadState('networkidle')
  // `App.jsx` devuelve pantallas enteras —«Validando sesión…», «Redirigiendo…»—
  // sin `<main>` cuando la sesión o el contexto fallan. Sin esta espera, lo que
  // se mide es el cero de un DOM que no es el de ninguna pantalla, y la prueba
  // pasa sin haber mirado nada.
  await expect(page.locator('main > *').first()).toBeVisible()
}

// ════════════════════════════════════════════
//  1 · La tabla de órdenes scrollea dentro de su tarjeta
// ════════════════════════════════════════════

test.describe('La tabla de órdenes de compra scrollea adentro de su tarjeta', () => {
  /**
   * Encuentra qué contiene a lo ancho las filas de la tabla, y de dónde cuelga.
   *
   * ⚠ **Lo que se busca no es «el primer ancestro con `overflow-x: auto`».** El
   * marco de las pantallas (`MarcoDePantalla.jsx`) tiene `overflow-y-auto`, y
   * CSS convierte el `overflow-x: visible` de un elemento así en `auto`: sacarle
   * el `overflow-x-auto` a la tarjeta dejaría al marco como primer ancestro
   * scrolleable y la prueba pasaría igual, midiendo el scroll de la página. Por
   * eso lo que se afirma es **de quién cuelga**: el que scrollea tiene que estar
   * ADENTRO de la `<section>` de la tarjeta.
   */
  function medirLaTabla(page) {
    return page.evaluate(() => {
      const cajaDe = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { izq: Math.round(r.left), der: Math.round(r.right), ancho: Math.round(r.width) }
      }

      const rejillas = [...document.querySelectorAll('main [style*="grid-template-columns"]')]
      const encabezado = rejillas[0]
      if (!encabezado) return { falta: true }

      const tarjeta = encabezado.closest('section')

      // El primer ancestro que NO deja salir el contenido a lo ancho: puede ser
      // el que scrollea (`auto`) o el que recorta (`hidden`, que es lo que hace
      // la tarjeta). Cuál de los dos es, lo dicen los `expect`.
      let contenedor = encabezado.parentElement
      while (contenedor && getComputedStyle(contenedor).overflowX === 'visible') {
        contenedor = contenedor.parentElement
      }

      const doc = document.documentElement
      const marco = document.querySelector('main').firstElementChild

      // Que scrollee de verdad y no solo que lo diga la clase: un contenedor sin
      // scroll reporta el mismo `scrollWidth`, solo que el contenido queda
      // inalcanzable.
      const antes = contenedor ? contenedor.scrollLeft : 0
      if (contenedor) contenedor.scrollLeft = 240
      const seMovio = contenedor ? contenedor.scrollLeft : 0
      if (contenedor) contenedor.scrollLeft = antes

      return {
        desbordeDelDocumento: doc.scrollWidth - doc.clientWidth,
        desbordeDelMarco: marco.scrollWidth - marco.clientWidth,
        contenedor: {
          ...cajaDe(contenedor),
          overflowX: contenedor && getComputedStyle(contenedor).overflowX,
          adentroDeLaTarjeta: !!(tarjeta && contenedor !== tarjeta && tarjeta.contains(contenedor)),
          sobraX: contenedor ? contenedor.scrollWidth - contenedor.clientWidth : 0,
          seMovio,
        },
        tarjeta: cajaDe(tarjeta),
      }
    })
  }

  /**
   * ⚠ **La mutación.** Se le saca `overflow-x-auto` al `<div>` de
   * `components/TablaGrid.jsx:49` y se corre esto: el primer ancestro que
   * contiene la tabla a lo ancho pasa a ser la `<section>` de la tarjeta
   * —`overflow-x: hidden`—, así que la columna de acciones queda cortada y no se
   * puede alcanzar de ninguna manera. Rojo en `adentroDeLaTarjeta`, que es el
   * primero de los tres `expect` del contenedor.
   *
   * **Lo que la mutación NO produce, y por eso no se afirma solo eso**: barra
   * horizontal en el `<body>`. El `<main>` está en `overflow-hidden` desde el
   * hito 5, así que el desborde se recorta en vez de llegar al documento. Una
   * prueba que mirara únicamente `document.scrollWidth` pasaría con y sin el
   * defecto — es exactamente la trampa que la 011 documentó.
   */
  test('a 1140px la tabla scrollea en su tarjeta, y el <body> no gana barra ni a 1140 ni a 1920', async ({ page }) => {
    const problemas = []

    for (const ancho of [ANCHO_APRETADO, 1920]) {
      await page.setViewportSize({ width: ancho, height: 900 })
      await abrir(page, '/ordenes-compra')
      await expect(page.getByText(proveedor('saldado'))).toBeVisible()

      const m = await medirLaTabla(page)
      expect(m.falta, 'no se encontró ninguna rejilla en /ordenes-compra').toBeFalsy()

      // Una barra horizontal en el `<body>` se lleva la barra lateral fuera de
      // pantalla cada vez que alguien mira la última columna de la tabla.
      if (m.desbordeDelDocumento > 0) {
        problemas.push(`a ${ancho}px el <body> desborda ${m.desbordeDelDocumento}px a lo ancho`)
      }
      // Y el marco de la pantalla tampoco: si el scroll horizontal subiera un
      // nivel, se llevaría también el encabezado y los filtros.
      if (m.desbordeDelMarco > 0) {
        problemas.push(`a ${ancho}px el marco de la pantalla desborda ${m.desbordeDelMarco}px a lo ancho`)
      }

      if (ancho !== ANCHO_APRETADO) continue

      // ── Lo que solo se puede afirmar al ancho apretado ──
      //
      // A 1920px el marco deja 1248px de contenido y la tabla pide 1060: no hay
      // nada que scrollear, así que ese ancho por sí solo no puede ponerse en
      // rojo con ninguna reversión. Es red de contención; el que muerde es 1140.
      expect(
        m.contenedor.sobraX,
        `a ${ANCHO_APRETADO}px la tabla tiene que desbordar su tarjeta para que esto pruebe algo`
      ).toBeGreaterThan(0)

      expect(
        m.contenedor.adentroDeLaTarjeta,
        'lo que contiene la tabla a lo ancho no está adentro de la tarjeta: el scroll se fue a la página'
      ).toBe(true)
      expect(m.contenedor.overflowX, 'la tarjeta recorta la tabla en vez de dejarla scrollear').toBe('auto')
      expect(m.contenedor.seMovio, 'la tabla no scrollea: la última columna queda inalcanzable').toBeGreaterThan(0)
    }

    expect(problemas).toEqual([])
  })
})

// ════════════════════════════════════════════
//  2 · El panel de la orden mide 520px
// ════════════════════════════════════════════

test.describe('El panel de la orden de compra', () => {
  /**
   * ⚠ **La mutación.** Se cambia el `style={{ width: '520px' }}` de
   * `components/PanelOrdenDeCompra.jsx:451` por `className="w-[520px]"` y el
   * panel pasa a medir **384px**: `data-[side=right]:sm:max-w-sm` de
   * `ui/sheet.jsx` es `max-width: 24rem` y vive en un media query que gana por
   * orden de hoja. El `expect` del ancho se pone en rojo con ese número.
   *
   * Es exactamente el motivo por el que el ancho va en `style` y no en clases, y
   * es lo que ningún test de render puede contestar: jsdom no aplica CSS, así
   * que `w-[520px]` y el estilo en línea se ven igual de bien.
   */
  test('mide 520px de verdad, y no los 384 del max-w-sm que trae el sheet', async ({ page }) => {
    await abrir(page, '/ordenes-compra')

    // Se abre desde la fila, que es el camino de la persona.
    await page.getByText(proveedor('pago_parcial')).click()

    const panel = page.locator('[data-slot="sheet-content"]')
    await expect(panel).toBeVisible()
    // El detalle llega por `GET /suppliers/orders/:id`; medir mientras dice
    // «Cargando la orden…» mediría la caja del estado de carga.
    await expect(panel.getByText('Seguimiento')).toBeVisible()

    const m = await panel.evaluate((el) => ({
      ancho: Math.round(el.getBoundingClientRect().width),
      maximo: getComputedStyle(el).maxWidth,
    }))

    // 520px es FR-014 y lo que dice `docs/REGLAS-DISENO.md`. Se mide el ancho
    // RENDERIZADO y no la clase: lo que importa es el número que queda después
    // de que opinen las reglas del componente de shadcn.
    expect(m.ancho).toBe(520)
    // Y el tope relativo sigue puesto, que es lo que salva al panel en una
    // ventana angosta. A 1920px no ata nada —92vw son 1766px—, así que se
    // verifica que exista y no cuánto mide.
    expect(m.maximo).not.toBe('none')
  })
})

// ════════════════════════════════════════════
//  3 y 4 · Las dos columnas de /proveedores
// ════════════════════════════════════════════

test.describe('La lista de proveedores y la cuenta, al ancho apretado', () => {
  test.use({ viewport: { width: ANCHO_APRETADO, height: 900 } })

  /**
   * ⚠ **Las tres mutaciones, con sus números.** Todas sobre `truncate` en el
   * `<span>` del nombre (`pages/Orders.jsx:966`), y cada una pone en rojo un
   * `expect` distinto:
   *
   *  · `truncate` → `whitespace-nowrap`: el nombre se pinta hasta **x=865** y la
   *    columna del saldo arranca en **x=495**. Rojo en (2).
   *  · `truncate` borrado: el nombre se parte por los guiones, entra en la celda
   *    —188px en 188px— y ya no hay nada que recortar. Rojo en (1).
   *  · `truncate` → `overflow-hidden whitespace-nowrap`: `text-overflow` pasa a
   *    `clip` y el nombre se corta a la mitad de una letra. Rojo en (4).
   *
   * ⚠⚠ **Lo que se probó y NO pone nada en rojo, y hay que dejarlo escrito para
   * que nadie lo verifique así y concluya que esta prueba no sirve**: sacarle
   * `min-w-0` al `<span>` de la celda. Es redundante. La pista es
   * `minmax(0,1fr)` y la función de tamaño MÍNIMO de esa pista es `0`, así que
   * el «tamaño mínimo automático» del ítem de grid ya es cero y `min-w-0` no
   * agrega nada. Solo mordería si la pista pasara a `1fr` —o sea
   * `minmax(auto,1fr)`—, que es por qué en este repositorio las columnas
   * flexibles se escriben `minmax(0,1fr)` y no `1fr`.
   */
  test('un nombre de 80 caracteres se recorta y NO se mete en la columna del saldo', async ({ page }) => {
    await abrir(page, '/proveedores')
    await expect(page.getByText(NOMBRE_LARGO)).toBeVisible()

    const m = await page.evaluate((nombreLargo) => {
      const lista = document.querySelector('section[aria-label="Lista de proveedores"]')
      const filas = [...lista.querySelectorAll('[style*="grid-template-columns"]')]

      const fila = filas.find((f) => f.textContent.includes(nombreLargo))
      const normal = filas.find((f) => f !== fila)
      if (!fila || !normal) return { falta: true }

      // El `<span>` del nombre es el que lleva `truncate`; la celda del saldo es
      // el segundo hijo de la rejilla.
      const nombre = [...fila.querySelectorAll('span')].find((s) => s.textContent === nombreLargo)
      const celdaDelSaldo = fila.children[1]

      const columnas = (f) => [...f.children].map((c) => Math.round(c.getBoundingClientRect().left))

      // ── Dónde termina el texto DIBUJADO, no dónde termina su caja ──
      //
      // `nombre.getBoundingClientRect()` devuelve la caja de maquetado, y esa
      // caja no crece cuando el texto se desborda: con `white-space: nowrap` y
      // sin recorte, el nombre se pinta encima de la columna del saldo y el
      // rectángulo del `<span>` sigue diciendo que todo está en su lugar.
      // Medido: la caja terminaba en 232 con y sin el defecto.
      //
      // Un `Range` sobre el contenido sí devuelve la extensión real del texto.
      // Si el elemento recorta, lo que se ve es la intersección de las dos —que
      // es exactamente lo que hace el navegador al pintar—.
      const rango = document.createRange()
      rango.selectNodeContents(nombre)
      const tinta = rango.getBoundingClientRect()
      const cajaDelNombre = nombre.getBoundingClientRect()
      const recorta = getComputedStyle(nombre).overflowX !== 'visible'

      return {
        nombreEntra: nombre.scrollWidth <= nombre.clientWidth,
        anchoDelTexto: nombre.scrollWidth,
        anchoDeLaCelda: nombre.clientWidth,
        recorte: getComputedStyle(nombre).textOverflow,
        derechaDelNombre: Math.round(recorta ? Math.min(tinta.right, cajaDelNombre.right) : tinta.right),
        izquierdaDelSaldo: Math.round(celdaDelSaldo.getBoundingClientRect().left),
        columnasDeLaLarga: columnas(fila),
        columnasDeLaNormal: columnas(normal),
      }
    }, NOMBRE_LARGO)

    expect(m.falta, 'no se encontró la fila del nombre largo ni una de referencia').toBeFalsy()

    // (1) El texto efectivamente NO entra. Sin esto la prueba pasaría con
    //     cualquier nombre corto y no estaría probando ningún recorte.
    expect(
      m.nombreEntra,
      `el nombre entra en la celda (${m.anchoDelTexto}px en ${m.anchoDeLaCelda}px): no hay nada que recortar`
    ).toBe(false)

    // (2) Y el texto DIBUJADO no llega a la columna de al lado. Va antes que el
    //     `textOverflow` a propósito: es la afirmación que da nombre al caso, y
    //     con el orden al revés el `expect` de la elipsis se llevaría el rojo y
    //     nadie se enteraría de cuánto se metió el nombre.
    expect(
      m.derechaDelNombre,
      `el nombre se pinta hasta ${m.derechaDelNombre} y el saldo arranca en ${m.izquierdaDelSaldo}: se pisan`
    ).toBeLessThanOrEqual(m.izquierdaDelSaldo)

    // (3) Las dos columnas de la fila larga arrancan en el MISMO píxel que las
    //     de una fila normal: leer un saldo corrido de columna es el defecto.
    //     Es red de contención —ninguna de las tres mutaciones de arriba lo pone
    //     en rojo por sí sola, porque cada fila es su propia rejilla— y está
    //     para el día que alguien escriba `1fr` en vez de `minmax(0,1fr)`.
    expect(m.columnasDeLaLarga).toEqual(m.columnasDeLaNormal)

    // (4) Y lo que se corta se corta con elipsis y no a la mitad de una letra.
    expect(m.recorte, 'el nombre se corta sin decir que sigue').toBe('ellipsis')

    // ⚠ **Lo que NO se afirma acá, y por qué**: que la fila del nombre largo
    // mida lo mismo de alto que una normal. Se escribió y se sacó: cualquier
    // cambio que deje al nombre partirse en renglones —sacar `truncate`, sacar
    // el `whitespace-nowrap`— hace que el texto ENTRE en la celda, y entonces el
    // `expect` (1) se pone en rojo primero. Un `expect` que no puede ponerse en
    // rojo por sí solo no se escribe: es exactamente el `shrink-0` redundante
    // que la 011 documentó en `maquetadoDelPuntoDeVenta.navegador.js:293-302`.
  })

  /**
   * ⚠ **Las dos mutaciones, con sus números.** Las dos sobre el contenedor de
   * las dos columnas (`pages/Orders.jsx:894`), cambiando
   * `grid … lg:grid-cols-[340px_minmax(0,1fr)]` por un `flex`:
   *
   *  · `flex` solo: la lista se comprime a **288px** en vez de los 340 que
   *    declara la plantilla, así que el nombre del proveedor empieza a
   *    recortarse antes de lo que dice el diseño. Rojo en (3).
   *  · `flex` **y** sin `min-w-0` en la columna derecha: la cuenta se planta en
   *    su ancho mínimo, llega hasta **x=1136** con el marco terminando en
   *    **x=1104**, y la lista queda en **2px**. Rojo en (2).
   *
   * Ese ancho mínimo no es casual: es `ANCHO_MINIMO_DE_MOVIMIENTOS` de
   * `Orders.jsx`. La tabla del historial lo declara para scrollear en vez de
   * comprimirse, y con el `<main>` en `overflow-hidden` lo que se sale del marco
   * **no se recupera con ninguna barra**.
   *
   * Por eso se afirman las dos cosas —que no se pisen y que no se salgan— y no
   * solo el solapamiento: los ítems de flex **no se pisan**, se desbordan, así
   * que una prueba que mirara únicamente el solapamiento pasaría en verde con la
   * columna derecha entera fuera de la pantalla.
   *
   * ⚠ Igual que en el caso de arriba, sacarle `min-w-0` a la columna derecha
   * **sin** tocar el `grid` no pone nada en rojo, y por el mismo motivo: la
   * pista es `minmax(0,1fr)` y su mínimo ya es cero.
   */
  test('la cuenta no se mete en la lista ni se sale del marco', async ({ page }) => {
    await abrir(page, '/proveedores')

    // Con la cuenta abierta y no con el estado vacío: lo que puede empujar la
    // columna derecha es la tabla del historial, que solo existe con un
    // proveedor elegido.
    await page.getByText(NOMBRE_LARGO).click()
    await expect(page.getByText('Historial de cuenta')).toBeVisible()

    const m = await page.evaluate(() => {
      const cajaDe = (el) => {
        const r = el.getBoundingClientRect()
        return { izq: Math.round(r.left), der: Math.round(r.right), ancho: Math.round(r.width) }
      }

      const lista = document.querySelector('section[aria-label="Lista de proveedores"]')
      const cuenta = lista.nextElementSibling
      const contenedor = lista.parentElement
      const doc = document.documentElement

      return {
        lista: cajaDe(lista),
        cuenta: cajaDe(cuenta),
        contenedor: cajaDe(contenedor),
        desbordeDelDocumento: doc.scrollWidth - doc.clientWidth,
      }
    })

    // (1) Están una al lado de la otra y ninguna se mete en la otra.
    expect(
      m.lista.der,
      `la lista termina en ${m.lista.der} y la cuenta arranca en ${m.cuenta.izq}: se pisan`
    ).toBeLessThanOrEqual(m.cuenta.izq)

    // (2) La cuenta termina adentro del marco. Con el `<main>` en
    //     `overflow-hidden`, lo que se sale no se recupera con ninguna barra:
    //     las últimas columnas del historial quedan inalcanzables.
    expect(
      m.cuenta.der,
      `la cuenta llega hasta ${m.cuenta.der} y el marco termina en ${m.contenedor.der}`
    ).toBeLessThanOrEqual(m.contenedor.der)

    // (3) Y la lista mide los 340px que declara la plantilla. Si se comprimiera,
    //     el nombre del proveedor se recortaría antes de lo que el diseño dice.
    expect(m.lista.ancho, 'la lista dejó de medir los 340px de la plantilla').toBe(340)

    // (4) Y el documento no gana barra horizontal por el camino.
    expect(m.desbordeDelDocumento).toBe(0)
  })
})
