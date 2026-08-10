import { test, expect } from '@playwright/test'

// ════════════════════════════════════════════
//  FAVALIO · El marco de las dieciocho pantallas
//
//  Es el paso manual **5** de `docs/specs/011-punto-de-venta/tasks.md`, que
//  pedía abrir tres pantallas a ojo, más la pregunta que quedó abierta cuando
//  el hito 5 introdujo `MarcoDePantalla` (commit `10b5e60`): el contenedor de
//  scroll cambió de lugar en todas y nadie lo había mirado.
//
//  ── Qué se rompió y cómo se ve ──
//
//  Antes scrolleaba `<main>` a ancho completo. Después pasó a scrollear el
//  `<div>` de `mx-auto max-w-[1320px]`, y en un monitor de 1920px eso deja
//  **180px de cada lado** en los que la rueda del mouse no scrollea nada: el
//  puntero está sobre `<main>` pero fuera del contenedor que scrollea. Medido
//  antes del arreglo: con el puntero en x=1880 el `scrollTop` quedaba en 0;
//  con el puntero en el centro, en 500.
//
//  `npm run build` no ve esto, `npm run test:web` tampoco —jsdom devuelve cero
//  en todo lo que mida—, y la guardia estática `tests/marcoDePantalla.test.js`
//  solo puede afirmar que la ruta *aplica* el marco, no qué forma tiene. Es
//  exactamente el caso para el que existe una prueba de navegador.
//
//  ── Por qué todas y no tres ──
//
//  Porque lo que hay que verificar es que no falte **ninguna**, y el error
//  típico al mirar a ojo es dejar bien la primera. Dieciocho `goto` cuestan
//  veinte segundos; la alternativa es no verificarlo nunca.
// ════════════════════════════════════════════

/**
 * Las dieciocho rutas que van adentro de `MarcoDePantalla`.
 *
 * Escritas a mano y NO extraídas de `App.jsx`: una lista derivada del código
 * que se está verificando pasa igual cuando el código se equivoca. Que falte
 * una acá lo detecta `tests/marcoDePantalla.test.js`, que sí lee `App.jsx` y
 * exige que toda ruta que no sea `/pos` esté envuelta.
 *
 * ⚠ `/tiendanube` entra ANTES de que la ruta exista, por el mismo motivo por el
 * que los tres archivos de TiendaNube entran a `guardiasDeDiseno.test.js` antes
 * de escribirse: una guardia que se agrega después se escribe para el código
 * que ya está, y entonces no es una guardia sino una descripción. **Esta prueba
 * queda EN ROJO hasta T1339**, que monta la `<Route>`, y el rojo dice
 * literalmente «`<main>` quedó VACÍO — ninguna `<Route>` de App.jsx matchea
 * esta ruta»: es una pantalla que todavía no se escribió y NO un defecto del
 * marco. Los dos rojos se leen distinto a propósito; ver `abrir()`.
 *
 * Las rutas nuevas se agregan al final y no en el medio: `abrir()` corta el
 * bucle con una excepción, así que lo que va antes se mide igual y el informe
 * conserva las diecisiete que ya funcionaban.
 */
/** El salto de linea, como constante. */
const SALTO = String.fromCharCode(10)

const CON_MARCO = [
  '/ventas', '/inventario', '/recetas', '/produccion', '/clientes', '/caja',
  '/impuestos', '/proveedores', '/ordenes-compra', '/faltantes', '/comparador',
  '/reportes', '/gastos', '/panel', '/facturacion', '/team', '/suscripcion',
  '/tiendanube',
  // 18 → 19 → 20 (ancla 11 de `docs/specs/015-catalogo-de-ventas-online/tasks.md`):
  // `/catalogos` y `/pedidos`. Van **al final y no en el medio**, como las
  // demás: `abrir()` corta el bucle con una excepción, así que lo que va antes
  // se mide igual y el informe conserva las que ya funcionaban.
  '/catalogos',
  '/pedidos',
]

/** El tope del marco, tal cual `MarcoDePantalla.jsx`. */
const ANCHO_DEL_MARCO = 1320

/**
 * Deja la pantalla montada y con sus pedidos al servidor terminados.
 *
 * ── Los tres rojos que esta función tiene que saber distinguir ──
 *
 * Antes había uno solo —el timeout de `main > *`— y adentro entraban tres cosas
 * que no se arreglan igual:
 *
 *  1. **El arnés está roto**: `App.jsx` devuelve pantallas enteras —«Validando
 *     sesión…», «Redirigiendo…»— **sin `<main>`** cuando la sesión o el
 *     contexto fallan. Sin esta espera, lo que se mide abajo es el cero de un
 *     DOM que no es el de ninguna pantalla.
 *  2. **La pantalla todavía no existe**: adentro del shell no hay ninguna ruta
 *     catch-all (`App.jsx:273-300`), así que una ruta sin `<Route>` deja el
 *     `<main>` con **cero hijos**. Es el estado de `/tiendanube` hasta T1339 y
 *     no es un defecto del marco.
 *  3. **La pantalla existe pero el navegador terminó en otra**: `RouteGuard`
 *     redirige a `/pos` cuando el módulo no está habilitado
 *     (`App.jsx:47-62`), que es el riesgo 2 del hito.
 *
 * El tercero es el que puede pasar **en verde**: hoy redirige a `/pos`, que no
 * tiene marco y por eso se ve el rojo, pero el día que alguien cambie ese
 * destino por una pantalla que sí lo tiene, las mediciones darían bien sobre la
 * pantalla equivocada y la prueba diría que `/tiendanube` está impecable sin
 * haberla abierto nunca. Por eso el `pathname` se devuelve y se compara.
 *
 * @returns {Promise<string>} el `pathname` donde terminó el navegador.
 */
async function abrir(page, ruta) {
  await page.goto(ruta)
  await page.waitForLoadState('networkidle')

  await expect(
    page.locator('main'),
    `${ruta}: no llegó a haber <main> — el shell no se montó (sesión o contexto), `
    + 'así que no se midió ninguna pantalla'
  ).toBeAttached()

  const shell = await page.evaluate(() => ({
    hijos: document.querySelector('main').children.length,
    ruta: location.pathname,
  }))

  expect(
    shell.hijos,
    `${ruta}: <main> quedó VACÍO — ninguna <Route> de App.jsx matchea esta ruta, `
    + 'o sea que la pantalla todavía no se escribió. NO es un defecto del marco.'
  ).toBeGreaterThan(0)

  await expect(page.locator('main > *').first()).toBeVisible()

  return shell.ruta
}

/** Las medidas del shell: `<main>` y su hijo, que es el contenedor de scroll. */
function medirElMarco(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    const contenedor = main.firstElementChild
    const centrado = contenedor.firstElementChild
    const doc = document.documentElement

    const caja = (el) => {
      const r = el.getBoundingClientRect()
      return { izq: Math.round(r.left), der: Math.round(r.right), ancho: Math.round(r.width) }
    }

    return {
      ruta: location.pathname,
      documento: {
        desbordeHorizontal: doc.scrollWidth - doc.clientWidth,
        desbordeVertical: doc.scrollHeight - doc.clientHeight,
      },
      main: caja(main),
      contenedor: {
        ...caja(contenedor),
        overflowY: getComputedStyle(contenedor).overflowY,
        scrollea: contenedor.scrollHeight > contenedor.clientHeight,
      },
      centrado: caja(centrado),
    }
  })
}

// ════════════════════════════════════════════
//  ¿Anda en la notebook de 13 pulgadas del contador?
//
//  El informe de coherencia del hito 9 la dejó como pregunta sin contestar: seis
//  pantallas tienen CERO prefijos responsive, `REGLAS-DISENO.md` fija el máximo
//  —1320px— y **nunca el mínimo**, y estas pruebas medían 1080 y 1920.
//
//  Esto la contesta. **No para hacerlas responsive** —es un ERP de escritorio y
//  eso es defendible—, sino para que el ancho mínimo soportado esté MEDIDO en
//  vez de supuesto.
//
//  ── Qué se mide, y por qué no alcanza con el desborde del `<body>` ──
//
//  El desborde horizontal ya está cubierto a 1080px, que es más angosto que
//  1280: si pasa allá, pasa acá. Lo que NO estaba medido es lo otro, y es lo que
//  se ve en una notebook: **que la barra de acciones del encabezado se apile en
//  tres o cuatro renglones**. Todos los encabezados son `flex-wrap`, así que
//  nada se desborda — se apila, y empuja la tabla fuera de la primera pantalla.
//
//  Nadie lo reporta como defecto porque no se rompe nada. Simplemente hay que
//  scrollear para ver la primera fila de la lista que uno vino a mirar.
// ════════════════════════════════════════════

/** Cuánto mide de alto el encabezado de pantalla, y en cuántos renglones. */
function medirElEncabezado(page) {
  return page.evaluate(() => {
    const contenedor = document.querySelector('main').firstElementChild
    const centrado = contenedor.firstElementChild

    // El `h1` de la pantalla y el bloque que lo contiene: es el encabezado, sea
    // `PageHeader` o hecho a mano.
    const titulo = centrado.querySelector('h1')
    if (!titulo) return null

    // ⚠ La raiz de la PANTALLA, no el contenedor centrado.
    //
    // Entre el `mx-auto max-w-[1320px]` y el encabezado hay un `<div>` mas —el
    // de `anim-subida`— asi que subir hasta que el padre fuera el centrado
    // devolvia la pagina entera: la primera medicion decia que el encabezado de
    // Inventario media 2152px, que es el alto de toda la lista de productos.
    //
    // Un numero que sale de medir otra cosa se lee igual de bien que uno
    // correcto, y ese es el problema.
    const raiz = centrado.firstElementChild
    if (!raiz || !raiz.contains(titulo)) return null

    let encabezado = titulo.parentElement
    while (encabezado && encabezado.parentElement !== raiz) {
      encabezado = encabezado.parentElement
    }
    if (!encabezado || encabezado === raiz) return null

    const alto = Math.round(encabezado.getBoundingClientRect().height)

    // En cuántos renglones quedó: se agrupan los hijos por su borde superior.
    const topes = new Set(
      [...encabezado.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => Math.round(el.getBoundingClientRect().top / 8))
    )

    return { alto, renglones: topes.size, ruta: location.pathname }
  })
}

test.describe('El ancho mínimo soportado: 1280px', () => {
  // No falla: MIDE. El informe pidió contestar la pregunta antes de decidir
  // cuánto trabajo es arreglarlo, así que este caso imprime el mapa y solo se
  // pone en rojo si algo se desborda de verdad —que a 1080 ya no pasa—.
  test('a 1280px ninguna pantalla desborda, y queda medido cuánto se apila cada encabezado', async ({ page }) => {
    const desbordes = []
    const altos = { 1280: {}, 1920: {} }

    // El ancho grande primero: es la referencia contra la que se compara.
    for (const ancho of [1920, 1280]) {
      await page.setViewportSize({ width: ancho, height: 800 })

      for (const ruta of CON_MARCO) {
        const llego = await abrir(page, ruta)
        if (llego !== ruta) continue

        const m = await medirElMarco(page)
        if (m.documento.desbordeHorizontal > 0) {
          desbordes.push(`${ruta} a ${ancho}px: sobran ${m.documento.desbordeHorizontal}px`)
        }

        const e = await medirElEncabezado(page)
        if (e) altos[ancho][ruta] = e.alto
      }
    }

    const filas = Object.keys(altos[1280])
      .map((ruta) => {
        const chico = altos[1280][ruta]
        const grande = altos[1920][ruta] ?? chico

        return { ruta, chico, grande, crece: chico - grande }
      })
      .sort((a, b) => b.crece - a.crece || b.chico - a.chico)
      .map(({ ruta, chico, grande, crece }) => (
        `${String(chico).padStart(4)}px  (a 1920: ${String(grande).padStart(4)}px, `
        + `${crece > 0 ? '+' : ''}${crece})  ${ruta}`
      ))

    // eslint-disable-next-line no-console
    console.log([
      '',
      '-- Alto del encabezado a 1280px vs 1920px, por cuanto crece --',
      ...filas,
      '',
    ].join(SALTO))

    expect(desbordes).toEqual([])
  })
})

test.describe('Ninguna de las dieciocho pantallas scrollea el cuerpo de la página', () => {
  // Los dos anchos del paso 1: el mínimo de la maqueta y el monitor del
  // mostrador. Una barra horizontal en el `<body>` significa que la barra
  // lateral o la miga de pan se van de pantalla al scrollear, que es el defecto
  // que esto protege.
  //
  // Los dos anchos van en UN solo caso: a 1920px ninguna de las dieciocho
  // tiene contenido más ancho que la ventana, así que ese ancho por sí solo no
  // se puede poner en rojo con ninguna reversión —es red de contención para
  // cuando alguien agregue una tabla ancha—. El que muerde hoy es el de 1080px.
  test('a 1080px y a 1920px, ninguna de las dieciocho scrollea el <body> a lo ancho', async ({ page }) => {
    const conBarra = []

    for (const ancho of [1080, 1920]) {
      await page.setViewportSize({ width: ancho, height: 900 })

      for (const ruta of CON_MARCO) {
        const llego = await abrir(page, ruta)
        if (llego !== ruta) {
          conBarra.push(`${ruta} a ${ancho}px: el navegador terminó en ${llego} — no se midió esta pantalla`)
          continue
        }

        const m = await medirElMarco(page)
        if (m.documento.desbordeHorizontal > 0) {
          conBarra.push(`${ruta} a ${ancho}px: sobran ${m.documento.desbordeHorizontal}px`)
        }
      }
    }

    expect(conBarra).toEqual([])
  })
})

test.describe('El contenedor de scroll de las dieciocho llega hasta el borde de la ventana', () => {
  test('ninguna deja franjas muertas donde la rueda del mouse no hace nada', async ({ page }) => {
    const malas = []

    for (const ruta of CON_MARCO) {
      const llego = await abrir(page, ruta)

      // La medición de una pantalla que no es la que se pidió no dice nada de
      // la que se pidió, y en verde se leería como que dijo todo. Ver `abrir()`.
      if (llego !== ruta) {
        malas.push(`${ruta}: el navegador terminó en ${llego} — no se midió esta pantalla`)
        continue
      }

      const m = await medirElMarco(page)

      // ── Lo que se afirma ──
      //
      // (1) el que scrollea es el hijo directo de `<main>` y tiene `overflow-y`
      //     propio —el `<main>` está en `overflow-hidden` desde el hito 5—;
      // (2) su caja coincide con la de `<main>`: mismo borde izquierdo y mismo
      //     borde derecho. Es la única forma de que la rueda funcione en
      //     cualquier punto de la pantalla y de que la barra quede en el borde
      //     de la ventana y no flotando en el medio;
      // (3) el centrado a 1320px lo hace un div de ADENTRO, así que el tope
      //     sigue existiendo y el contenido no se estira a 1680px.
      if (m.contenedor.overflowY !== 'auto') {
        malas.push(`${ruta}: el hijo de <main> tiene overflow-y ${m.contenedor.overflowY}`)
        continue
      }
      if (m.contenedor.izq !== m.main.izq || m.contenedor.der !== m.main.der) {
        malas.push(
          `${ruta}: lo que scrollea va de ${m.contenedor.izq} a ${m.contenedor.der} `
          + `y <main> de ${m.main.izq} a ${m.main.der} — quedan `
          + `${m.contenedor.izq - m.main.izq}px muertos a la izquierda y `
          + `${m.main.der - m.contenedor.der}px a la derecha`
        )
      }
      if (m.centrado.ancho > ANCHO_DEL_MARCO) {
        malas.push(`${ruta}: el contenido mide ${m.centrado.ancho}px y el tope es ${ANCHO_DEL_MARCO}px`)
      }
    }

    expect(malas).toEqual([])
  })

  test('el contenido sigue centrado a 1320px, con el mismo padding de siempre', async ({ page }) => {
    // El paso manual 5 pedía comprobar «el mismo tope de 1320px y el mismo
    // padding que antes del cambio». El tope es geometría; el padding se mide
    // acá y no se lee de una clase, porque `lg:px-9` cambia con el ancho de la
    // ventana y lo que importa es el número que se ve.
    await abrir(page, '/inventario')

    const m = await page.evaluate(() => {
      const centrado = document.querySelector('main').firstElementChild.firstElementChild
      const r = centrado.getBoundingClientRect()
      const estilo = getComputedStyle(centrado)
      const main = document.querySelector('main').getBoundingClientRect()
      return {
        ancho: Math.round(r.width),
        // Lo mismo de sobra a cada lado = está centrado. Se compara con <main>
        // y no con la ventana: la barra lateral corre el origen.
        sobraIzquierda: Math.round(r.left - main.left),
        sobraDerecha: Math.round(main.right - r.right),
        padding: [estilo.paddingLeft, estilo.paddingRight, estilo.paddingTop, estilo.paddingBottom],
      }
    })

    expect(m.ancho).toBe(ANCHO_DEL_MARCO)
    expect(m.sobraIzquierda).toBe(m.sobraDerecha)
    // `lg:px-9 lg:py-8` a 1920px de ancho: 36px de costado y 32px arriba y abajo.
    expect(m.padding).toEqual(['36px', '36px', '32px', '32px'])
  })

  test('la rueda sobre el borde derecho de la ventana scrollea la pantalla', async ({ page }) => {
    // El caso concreto del defecto, ejercitado como lo ejercita una persona.
    // Inventario porque con el catálogo sembrado siempre desborda; si algún día
    // dejara de desbordar, el `expect` de abajo lo dice en vez de pasar en
    // falso.
    await abrir(page, '/inventario')

    const desborde = await page.evaluate(() => {
      const c = document.querySelector('main').firstElementChild
      return c.scrollHeight - c.clientHeight
    })
    expect(desborde, 'Inventario tiene que desbordar para que este caso pruebe algo').toBeGreaterThan(200)

    const alturaDeRueda = 400
    const { width } = page.viewportSize()

    // 40px adentro del borde derecho de la ventana: sobre `<main>`, y sobre la
    // franja que quedaba muerta cuando el contenedor de scroll medía 1320px.
    await page.mouse.move(width - 40, 500)
    await page.mouse.wheel(0, alturaDeRueda)
    await page.waitForTimeout(300)

    const desplazado = await page.evaluate(
      () => document.querySelector('main').firstElementChild.scrollTop
    )

    expect(
      desplazado,
      'La rueda sobre el borde derecho no movió nada: el contenedor de scroll no llega hasta ahí'
    ).toBeGreaterThan(0)
  })
})

test.describe('El punto de venta es la única pantalla fuera del marco, y lo sigue siendo', () => {
  test('/pos NO tiene el contenedor de 1320px que tienen las otras dieciocho', async ({ page }) => {
    // La contracara del caso de arriba: si alguien «arregla» el marco
    // envolviendo también a `/pos`, el punto de venta pierde el ancho y el alto
    // completos, que es todo lo que el hito 5 vino a resolver.
    //
    // ⚠ La medida se toma sobre las DOS COLUMNAS del POS y sus ancestros, y no
    // sobre `main.firstElementChild`: el marco, ya arreglado, también ocupa el
    // ancho completo de `<main>`, así que mirar el primer hijo no distingue una
    // cosa de la otra. Se probó envolviendo `/pos` en `<MarcoDePantalla>` y la
    // prueba seguía en verde.
    await abrir(page, '/pos')
    await expect(page.locator('main aside')).toBeVisible()

    const m = await page.evaluate(() => {
      const main = document.querySelector('main')
      const dosColumnas = document.querySelector('main aside').parentElement

      // Todo lo que hay entre las dos columnas del POS y `<main>`: si alguna de
      // esas capas tiene tope de ancho, el POS está adentro de un marco.
      const conTope = []
      for (let el = dosColumnas; el && el !== main; el = el.parentElement) {
        const tope = getComputedStyle(el).maxWidth
        if (tope !== 'none') conTope.push(`${el.className.slice(0, 50)} → max-width ${tope}`)
      }

      return {
        conTope,
        ancho: Math.round(dosColumnas.getBoundingClientRect().width),
        anchoDeMain: Math.round(main.getBoundingClientRect().width),
        alto: Math.round(dosColumnas.getBoundingClientRect().height),
        altoDeMain: Math.round(main.getBoundingClientRect().height),
      }
    })

    expect(m.conTope, 'el punto de venta quedó adentro de un contenedor con tope de ancho').toEqual([])
    expect(m.ancho).toBe(m.anchoDeMain)
    expect(m.alto).toBe(m.altoDeMain)
  })
})
