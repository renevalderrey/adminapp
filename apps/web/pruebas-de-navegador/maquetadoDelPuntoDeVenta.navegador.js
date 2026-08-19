import { test, expect } from '@playwright/test'
import { NOMBRE_LARGO } from './preparacion.js'

// ════════════════════════════════════════════
//  FAVALIO · El maquetado del punto de venta
//
//  Son los pasos manuales **1, 2, 3 y 4** de
//  `docs/specs/011-punto-de-venta/tasks.md`, que hasta ahora nadie podía correr.
//  El propio archivo explica por qué no eran tests: `scrollWidth`,
//  `clientWidth` y `getBoundingClientRect` devuelven **cero siempre** en jsdom,
//  así que un test de render que los mirara pasaría con y sin el cambio.
//
//  ⚠ Lo que NO se prueba acá y hay que dejar dicho, porque es la regla de
//  `docs/specs/CONVENCIONES.md`: nada que ya esté cubierto por una función pura
//  o por un test de render. Los atajos son `utils/atajosDelPos.test.js`, los
//  precios son `utils/mediosDePago.test.js`, y que el botón de imprimir
//  desaparezca con la primera línea del ticket siguiente ya lo verifica
//  `tests/renderDelPuntoDeVenta.test.jsx`. Repetirlo en un navegador cuesta
//  diez veces más y se rompe cuando alguien mueve un `<div>`.
//
//  Lo que queda acá es lo que **solo** un motor de maquetado puede contestar:
//  qué scrollea, cuánto mide, y si un texto entra o se recorta.
// ════════════════════════════════════════════

/**
 * Las piezas del punto de venta, ubicadas por su ROL en el maquetado y no por
 * una cadena de `:nth-child`.
 *
 * El ticket es el único `<aside>` de adentro de `<main>` —la barra lateral está
 * afuera—, el catálogo es lo que va antes, y las dos zonas que scrollean se
 * buscan por su `overflow-y` calculado. Así, mover un `<div>` no rompe la
 * prueba, pero sacar el scroll sí, que es exactamente lo que tiene que pasar.
 */
function medir(page) {
  return page.evaluate(() => {
    const caja = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        izq: Math.round(r.left), der: Math.round(r.right),
        arriba: Math.round(r.top), abajo: Math.round(r.bottom),
        ancho: Math.round(r.width), alto: Math.round(r.height),
      }
    }
    // Los nombres NO se pisan con los de `caja` a propósito: cuando `scroll`
    // devolvía `izq` para el `scrollLeft`, el spread le pisaba a `caja` el
    // borde izquierdo y `page.mouse.move` terminaba apuntando a la barra
    // lateral. La prueba fallaba por estar mirando otra cosa.
    const scroll = (el) => (el
      ? {
        desplazadoY: el.scrollTop,
        desplazadoX: el.scrollLeft,
        sobraY: el.scrollHeight - el.clientHeight,
        sobraX: el.scrollWidth - el.clientWidth,
      }
      : null)
    const conScrollVertical = (padre) => [...padre.children].find((e) => getComputedStyle(e).overflowY === 'auto')

    const doc = document.documentElement
    const ticket = document.querySelector('main aside')
    const catalogo = ticket?.previousElementSibling
    const dosColumnas = ticket?.parentElement
    const raizDelPos = dosColumnas?.parentElement

    const zonaDelCatalogo = catalogo && conScrollVertical(catalogo)
    const zonaDelTicket = ticket && conScrollVertical(ticket)
    const buscador = document.querySelector('input[placeholder^="Escaneá"]')
    // El botón dice QUÉ va a pasar —«Cobrar y emitir Factura C»—, así que se lo
    // busca por la parte que no depende del comprobante elegido.
    const botonDeCobro = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Cobrar y emitir'))

    return {
      documento: {
        sobraX: doc.scrollWidth - doc.clientWidth,
        sobraY: doc.scrollHeight - doc.clientHeight,
      },
      raizDelPos: { ...caja(raizDelPos), ...scroll(raizDelPos), overflowX: raizDelPos && getComputedStyle(raizDelPos).overflowX },
      ticket: { ...caja(ticket), ancho: Math.round(ticket.getBoundingClientRect().width) },
      catalogo: caja(catalogo),
      zonaDelCatalogo: { ...caja(zonaDelCatalogo), ...scroll(zonaDelCatalogo) },
      zonaDelTicket: { ...caja(zonaDelTicket), ...scroll(zonaDelTicket) },
      buscador: caja(buscador),
      botonDeCobro: caja(botonDeCobro),
    }
  })
}

async function abrirElPos(page) {
  await page.goto('/pos')
  await page.waitForLoadState('networkidle')
  // Sin catálogo no hay nada que medir, y una lista vacía dibuja el bloque «Sin
  // resultados», que tiene otra altura y otro ancho.
  await expect(page.getByText('Producto de prueba 01')).toBeVisible()
}

/** Carga `cuantas` líneas distintas en el ticket, con el mouse. */
async function cargarElTicket(page, cuantas) {
  for (let i = 1; i <= cuantas; i++) {
    await page.getByLabel(`Agregar Producto de prueba ${String(i).padStart(2, '0')} al ticket`).click()
  }
  await expect(page.getByText('Vaciar')).toBeVisible()
}

// ════════════════════════════════════════════
//  Paso 1 · El cuerpo de la página no scrollea (escenario 1.3, FR-002)
// ════════════════════════════════════════════

test.describe('El cuerpo de la página no scrollea con el punto de venta abierto', () => {
  // Los dos anchos del paso 1 van en UN solo caso y no en dos, a propósito. A
  // 1920px no hay nada en el punto de venta más ancho que la ventana, así que
  // ese ancho por sí solo no puede ponerse en rojo con ninguna reversión: es
  // red de contención para el día que alguien agregue una columna. El que
  // muerde hoy es el de 1080px. Separados, el de 1920 sería un caso que
  // siempre pasa; juntos, el caso entero se pone en rojo cuando el desborde
  // deja de estar contenido.
  test('el <body> NO tiene barra horizontal ni vertical, ni a 1080px ni a 1920px', async ({ page }) => {
    const problemas = []

    for (const ancho of [1080, 1920]) {
      await page.setViewportSize({ width: ancho, height: 900 })
      await abrirElPos(page)

      const m = await medir(page)

      // Las dos barras del `<body>` son el defecto: una horizontal se lleva la
      // barra lateral y la miga de pan fuera de pantalla al scrollear; una
      // vertical hace que el pie de cobro haya que ir a buscarlo con la rueda,
      // que es lo que los atajos vienen a sacar.
      if (m.documento.sobraX > 0) problemas.push(`a ${ancho}px el <body> desborda ${m.documento.sobraX}px a lo ancho`)
      if (m.documento.sobraY > 0) problemas.push(`a ${ancho}px el <body> desborda ${m.documento.sobraY}px a lo alto`)
    }

    expect(problemas).toEqual([])
  })

  test('por debajo de 1080px el desborde queda ADENTRO del punto de venta y se puede scrollear', async ({ page }) => {
    // La otra mitad de FR-002: el POS no se achica por debajo de los 1080px de
    // la maqueta —a 900px las tres columnas de precio y el ticket no entran—,
    // así que el desborde existe. Lo que importa es DÓNDE: adentro de la
    // pantalla, no en el `<body>`.
    await page.setViewportSize({ width: 1080, height: 900 })
    await abrirElPos(page)

    const m = await medir(page)
    expect(m.raizDelPos.sobraX, 'a 1080px de ventana el POS tiene que desbordar su contenedor').toBeGreaterThan(0)

    // Que desborde no alcanza: tiene que poder scrollearse. Un contenedor sin
    // `overflow-x-auto` desborda igual —y `scrollWidth` lo sigue reportando—,
    // solo que el `<main>` en `overflow-hidden` lo recorta y esas columnas
    // quedan inalcanzables. La diferencia se ve moviendo el scroll de verdad.
    const desplazado = await page.evaluate(() => {
      const raiz = document.querySelector('main aside').parentElement.parentElement
      raiz.scrollLeft = 200
      return raiz.scrollLeft
    })

    expect(desplazado, 'el contenedor del POS no scrollea: las columnas de la derecha quedan inalcanzables').toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════
//  Paso 2 · Las dos zonas scrollean por separado (escenario 1.2, FR-003)
// ════════════════════════════════════════════

test.describe('El catálogo y el ticket scrollean por separado', () => {
  // 900px de alto y no 1080: es la altura útil de un portátil de mostrador, y
  // es la que hace que ocho líneas de ticket desborden. A 1080 el pie y las
  // ocho líneas entran justas y la prueba no probaría nada — con un `expect`
  // abajo que lo dice, para que si eso cambia se vea en vez de pasar en falso.
  test.use({ viewport: { width: 1920, height: 900 } })

  test('la barra de búsqueda NO se va de pantalla cuando corre la lista del catálogo', async ({ page }) => {
    await abrirElPos(page)
    await cargarElTicket(page, 8)

    const antes = await medir(page)
    expect(antes.zonaDelCatalogo.sobraY, 'el catálogo tiene que desbordar para que esto pruebe algo').toBeGreaterThan(100)

    await page.mouse.move(antes.zonaDelCatalogo.izq + 300, antes.zonaDelCatalogo.arriba + 200)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(300)

    const despues = await medir(page)

    expect(despues.zonaDelCatalogo.desplazadoY, 'la lista del catálogo no se movió').toBeGreaterThan(0)
    expect(despues.buscador.arriba, 'la barra de búsqueda se fue con la lista').toBe(antes.buscador.arriba)
    expect(despues.zonaDelTicket.desplazadoY, 'scrollear el catálogo movió también el ticket').toBe(antes.zonaDelTicket.desplazadoY)
    expect(despues.documento.sobraY, 'scrollear el catálogo hizo scrollear la página').toBe(0)
  })

  test('el pie de cobro NO se va de pantalla cuando corren las líneas del ticket', async ({ page }) => {
    await abrirElPos(page)
    await cargarElTicket(page, 8)

    const antes = await medir(page)
    expect(antes.zonaDelTicket.sobraY, 'con ocho líneas el ticket tiene que desbordar para que esto pruebe algo').toBeGreaterThan(0)

    await page.mouse.move(antes.zonaDelTicket.izq + 100, antes.zonaDelTicket.arriba + 100)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(300)

    const despues = await medir(page)

    expect(despues.zonaDelTicket.desplazadoY, 'la lista del ticket no se movió').toBeGreaterThan(0)
    expect(despues.botonDeCobro.arriba, 'el botón de cobrar se fue con las líneas').toBe(antes.botonDeCobro.arriba)
    expect(despues.zonaDelCatalogo.desplazadoY, 'scrollear el ticket movió también el catálogo').toBe(antes.zonaDelCatalogo.desplazadoY)
    expect(despues.documento.sobraY, 'scrollear el ticket hizo scrollear la página').toBe(0)
  })
})

// ════════════════════════════════════════════
//  Paso 3 · Un nombre largo no corre las columnas de precio
// ════════════════════════════════════════════

test.describe('Un nombre de ochenta caracteres no rompe la grilla del catálogo', () => {
  // 1080px de ancho —el mínimo del diseño— y no 1920, y el motivo es medido:
  // a 1920 la columna del producto mide 769px y ochenta caracteres ENTRAN
  // (584px), así que no hay nada que recortar y la prueba no probaría nada. El
  // caso que el paso 3 busca aparece al ancho mínimo, donde esa columna baja a
  // menos de 200px. El `expect` de más abajo lo verifica en vez de darlo por
  // supuesto: si el ancho de la columna cambiara, se pone en rojo diciendo que
  // el texto entra.
  test.use({ viewport: { width: 1080, height: 900 } })

  test('el nombre se recorta y las tres columnas de precio quedan donde estaban', async ({ page }) => {
    await abrirElPos(page)

    const m = await page.evaluate((nombreLargo) => {
      const filaDe = (texto) => {
        const span = [...document.querySelectorAll('span')].find((s) => s.textContent === texto)
        return span?.closest('[style*="grid-template-columns"]')
      }

      const columnas = (fila) => [...fila.children]
        .map((c) => Math.round(c.getBoundingClientRect().left))

      const larga = filaDe(nombreLargo)
      const normal = filaDe('Producto de prueba 01')
      if (!larga || !normal) return { falta: true }

      const nombre = larga.querySelector('span')
      const cajaDelNombre = nombre.getBoundingClientRect()
      // La primera columna de precio de la misma fila: es la que un nombre
      // desbordado se lleva puesta.
      const primerPrecio = larga.children[1].getBoundingClientRect()

      return {
        columnasDeLaLarga: columnas(larga),
        columnasDeLaNormal: columnas(normal),
        altoDeLaLarga: Math.round(larga.getBoundingClientRect().height),
        altoDeLaNormal: Math.round(normal.getBoundingClientRect().height),
        nombreEntra: nombre.scrollWidth <= nombre.clientWidth,
        anchoDelTexto: nombre.scrollWidth,
        anchoDeLaCelda: nombre.clientWidth,
        recorte: getComputedStyle(nombre).textOverflow,
        derechaDelNombre: Math.round(cajaDelNombre.right),
        izquierdaDelPrecio: Math.round(primerPrecio.left),
      }
    }, NOMBRE_LARGO)

    expect(m.falta, 'no se encontró la fila del nombre largo ni la de referencia').toBeFalsy()

    // (1) El texto efectivamente NO entra. Sin esto la prueba pasaría con
    //     cualquier nombre corto y no estaría probando el recorte.
    expect(m.nombreEntra, `el nombre entra en la celda (${m.anchoDelTexto}px en ${m.anchoDeLaCelda}px): no hay nada que recortar`).toBe(false)

    // (2) Y se recorta con elipsis en vez de desbordar.
    expect(m.recorte).toBe('ellipsis')
    expect(m.derechaDelNombre, 'el nombre se mete en la columna de precio').toBeLessThanOrEqual(m.izquierdaDelPrecio)

    // (3) Las cinco columnas de la fila larga arrancan en el MISMO píxel que
    //     las de una fila normal. Es lo que el paso 3 pide comparar: leer un
    //     precio bajo la etiqueta equivocada es el defecto.
    expect(m.columnasDeLaLarga).toEqual(m.columnasDeLaNormal)

    // (4) Y no se fue a dos renglones, que es la otra forma de romper la
    //     lectura de la lista.
    expect(m.altoDeLaLarga).toBe(m.altoDeLaNormal)
  })
})

// ════════════════════════════════════════════
//  Paso 4 · El ticket mide 400px y el total domina el pie (FR-021)
// ════════════════════════════════════════════

test.describe('Las medidas del ticket', () => {
  test('el ticket mide 400px y no los 380 de la barra de carrito anterior', async ({ page }) => {
    await abrirElPos(page)

    const m = await medir(page)
    expect(m.ticket.ancho).toBe(400)
  })

  test('sigue midiendo 400px al ancho MÍNIMO del diseño, con el catálogo apretado', async ({ page }) => {
    // El mismo número al otro extremo del rango. No es el mismo caso: a 1920 el
    // ticket tiene lugar de sobra, y a 1080 el catálogo pelea por cada píxel.
    //
    // ⚠ Lo que este caso NO prueba, y hay que decirlo: el `shrink-0` del
    // `<aside>`. Se intentó sacarlo y la prueba siguió en verde, porque
    // `min-w-[1080px]` en la fila garantiza 1080px de ancho pase lo que pase y
    // el catálogo tiene `min-w-0`: el ticket nunca queda sin sus 400px. El
    // `shrink-0` es redundante, y una prueba que no puede ponerse en rojo no se
    // escribe.
    await page.setViewportSize({ width: 1080, height: 900 })
    await abrirElPos(page)

    const m = await medir(page)
    expect(m.ticket.ancho).toBe(400)
  })

  test('el total es el número más grande del pie de cobro', async ({ page }) => {
    await abrirElPos(page)
    await cargarElTicket(page, 2)

    const m = await page.evaluate(() => {
      const pie = [...document.querySelector('main aside').children].at(-1)
      const tamano = (el) => Math.round(parseFloat(getComputedStyle(el).fontSize))

      const etiquetaTotal = [...pie.querySelectorAll('span')].find((s) => s.textContent === 'Total')
      const total = etiquetaTotal?.nextElementSibling

      // Todo lo que compite con el total en el mismo bloque: el subtotal, el
      // IVA, el vuelto y el texto del botón.
      const competidores = [...pie.querySelectorAll('span, button, p, label')]
        .filter((el) => el !== total && el.textContent.trim() !== '' && el.getBoundingClientRect().height > 0)
        .map((el) => ({ texto: el.textContent.trim().slice(0, 24), px: tamano(el) }))

      return {
        totalPx: total && tamano(total),
        totalEsMono: total && getComputedStyle(total).fontFamily.includes('JetBrains'),
        maximoDeLosDemas: Math.max(...competidores.map((c) => c.px)),
        elMasGrandeDeLosDemas: competidores.sort((a, b) => b.px - a.px)[0],
      }
    })

    // 24px es lo que dice FR-021 y lo que dibuja la maqueta. Se mide el tamaño
    // RENDERIZADO y no la clase: `text-2xl` puede quedar pisado por una regla
    // de `index.css` o por un `font-size` heredado, y eso no lo ve ningún test
    // de render.
    expect(m.totalPx).toBe(24)
    expect(m.totalEsMono, 'el total tiene que ir en la monoespaciada del sistema (.num)').toBe(true)
    expect(
      m.maximoDeLosDemas,
      `«${m.elMasGrandeDeLosDemas?.texto}» compite con el total: ${m.elMasGrandeDeLosDemas?.px}px contra ${m.totalPx}px`
    ).toBeLessThan(m.totalPx)
  })
})
