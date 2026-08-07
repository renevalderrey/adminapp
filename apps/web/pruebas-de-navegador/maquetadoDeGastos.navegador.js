import { test, expect } from '@playwright/test'
import { PREFIJO, NOMBRE_DE_GASTO_LARGO } from './preparacion.js'

// ════════════════════════════════════════════
//  ADMINAPP · El maquetado de /gastos
//
//  UNA afirmación, y es la única del corte 4 que necesita un motor de
//  maquetado: **el nombre de un gasto largo no se mete en la columna de
//  importe**.
//
//  ── Por qué no puede ser un test de render ──
//
//  Lo que se compara es el `right` de la caja del nombre contra el `left` de la
//  del importe, y en jsdom `getBoundingClientRect` devuelve **cero en las cuatro
//  medidas**: la comparación `0 <= 0` es verdadera con `truncate` y sin
//  `truncate`, así que el test pasaría exactamente igual con el defecto puesto.
//  Es el criterio de `CONVENCIONES.md` para bajar acá, y el único caso de esta
//  pantalla que lo cumple.
//
//  ── Lo que NO baja acá, aunque se pueda escribir ──
//
//  Que el gasto sin sucursal caiga en «General», que las tarjetas sumen el
//  total, que el botón de eliminar esté deshabilitado sin el permiso y que el
//  importe se escriba «1.234,50». Los cuatro los contestan
//  `utils/gastos.test.js` y `tests/renderDeGastos.test.jsx`, que son cincuenta
//  veces más baratos por caso. Una suite lenta es una suite que alguien termina
//  salteando.
//
//  ── La mutación, corrida de verdad, y lo que se aprendió corriéndola ──
//
//  Se le sacó `min-w-0 truncate` a la celda del nombre en `pages/Expenses.jsx` y
//  el caso se puso en rojo. **Pero NO por el `expect` de la invasión**, y eso
//  hay que dejarlo escrito porque cambia qué protege esta prueba:
//
//   · el que muerde es `seCorta` —y detrás, `filaAlta`—: sin `truncate` el
//     nombre no se corta con puntos suspensivos sino que **se envuelve en dos
//     líneas**, la fila crece de alto y la tabla deja de leerse como una grilla;
//   · el `expect` de la invasión **pasa igual con el defecto puesto**, y también
//     pasa si se cambia la columna de `minmax(0,1fr)` a `auto` —probado—: el
//     ancho mínimo cero de la columna y el `overflow-x-auto` de `TablaGrid`
//     hacen que la celda nunca llegue a montarse sobre la de importe; lo que
//     pasa es que la tabla scrollea.
//
//  Se conserva porque es la afirmación de la spec y sigue siendo barata, pero la
//  que distingue el defecto es la del corte del texto. Tres de las once primeras
//  pruebas de geometría del repositorio no se pusieron en rojo con su mutación y
//  nadie se enteró hasta mucho después; ésta se corrió, y esto es lo que dio.
//
//  Por eso el caso mide las CAJAS de dos celdas de la misma fila y no una clase,
//  y por eso compara además contra una fila de nombre corto: si las dos filas se
//  vieran iguales, lo que se está midiendo no es el nombre.
//
//  ⚠ `src/index.css` tiene un `@source not` para esta carpeta, y una guardia en
//  `tests/guardiasDeDiseno.test.js` que lo protege. Sin esa línea, cada clase
//  arbitraria mencionada acá entraría al CSS que baja el navegador del cliente.
// ════════════════════════════════════════════

/**
 * El ancho en el que la tabla aprieta sin llegar al apilado.
 *
 * `pages/Expenses.jsx` declara `ANCHO_MINIMO = 760` para la tabla, y el marco
 * centra a 1320px. 1140 es donde la columna elástica de la descripción se queda
 * corta de verdad, que es donde vive el defecto.
 */
const ANCHO_APRETADO = 1140

const NOMBRE_LARGO_SEMBRADO = `${PREFIJO}${NOMBRE_DE_GASTO_LARGO}`
const NOMBRE_CORTO_SEMBRADO = `${PREFIJO}Contador`

/** Deja la pantalla montada y con sus pedidos al servidor terminados. */
async function abrirGastos(page) {
  await page.goto('/gastos')
  await page.waitForLoadState('networkidle')

  // `App.jsx` devuelve pantallas enteras —«Validando sesión…», «Redirigiendo…»—
  // sin `<main>` cuando la sesión o el contexto fallan. Sin esta espera, lo que
  // se mide es el cero de un DOM que no es el de ninguna pantalla, y la prueba
  // pasa sin haber mirado nada.
  await expect(page.locator('main > *').first()).toBeVisible()
  await expect(page.getByText(NOMBRE_LARGO_SEMBRADO)).toBeVisible()
}

/**
 * Las cajas de las celdas de descripción y de importe de una fila.
 *
 * La fila se ubica por su texto y se sube al contenedor que declara
 * `grid-template-columns`, igual que en los tests de render: la tabla es un grid
 * y no hay `role="row"`.
 */
function medirLaFila(page, nombre) {
  return page.evaluate((texto) => {
    const celda = [...document.querySelectorAll('main span')].find((s) => s.textContent === texto)
    if (!celda) return { falta: true }

    const fila = celda.closest('[style*="grid-template-columns"]')
    if (!fila) return { falta: true }

    const caja = (el) => {
      const r = el.getBoundingClientRect()
      return { izq: Math.round(r.left), der: Math.round(r.right), ancho: Math.round(r.width) }
    }

    // El importe es la tercera celda del grid; se busca por su clase `.num`, que
    // es la que el sistema le pone a todo lo que es un número alineado.
    const importe = fila.querySelector('.num')

    return {
      falta: false,
      nombre: caja(celda),
      importe: importe ? caja(importe) : null,
      // Lo que el usuario ve escrito: con `truncate` el texto se corta con
      // puntos suspensivos y `scrollWidth` supera al `clientWidth`.
      seCorta: celda.scrollWidth > celda.clientWidth,
      filaAlta: Math.round(fila.getBoundingClientRect().height),
      anchoDelCuerpo: document.documentElement.scrollWidth,
      anchoVisible: document.documentElement.clientWidth,
    }
  }, nombre)
}

test.describe('El nombre de un gasto largo no invade la columna de importe', () => {
  test('«Alquiler del depósito de Ortiz de Ocampo y expensas» no invade la columna de importe', async ({ page }) => {
    await page.setViewportSize({ width: ANCHO_APRETADO, height: 900 })
    await abrirGastos(page)

    const largo = await medirLaFila(page, NOMBRE_LARGO_SEMBRADO)
    const corto = await medirLaFila(page, NOMBRE_CORTO_SEMBRADO)

    expect(largo.falta, 'no se encontró la fila del gasto de nombre largo').toBe(false)
    expect(corto.falta, 'no se encontró la fila del gasto de nombre corto').toBe(false)
    expect(largo.importe, 'la fila no tiene celda de importe (.num)').not.toBeNull()

    // ── La afirmación de la spec ──
    //
    // El borde derecho del nombre queda a la izquierda del borde izquierdo del
    // importe.
    //
    // ⚠ Es la que la spec pide y **no es la que distingue el defecto**: probado,
    // pasa igual sin `truncate` y con la columna en `auto`. La que muerde es la
    // de abajo. Está escrito arriba, en el encabezado.
    expect(
      largo.nombre.der,
      `el nombre llega a ${largo.nombre.der}px y el importe arranca en ${largo.importe.izq}px`
    ).toBeLessThanOrEqual(largo.importe.izq)

    // Y el texto SE CORTA de verdad: si no se cortara, la comparación de arriba
    // podría estar pasando porque la ventana es más ancha de lo que la prueba
    // cree y el nombre entra entero.
    expect(largo.seCorta, 'el nombre largo entra entero: la ventana no está apretando').toBe(true)
    expect(corto.seCorta).toBe(false)

    // Las dos filas miden lo mismo de alto: si el nombre largo se envolviera en
    // dos líneas, la fila sería más alta y la tabla dejaría de leerse como una
    // grilla. Es lo que distingue «se cortó» de «se acomodó».
    expect(largo.filaAlta).toBe(corto.filaAlta)

    // Y el `<body>` no desborda a lo ancho por culpa de la tabla: el scroll
    // horizontal vive adentro de la tarjeta, no en la página.
    expect(largo.anchoDelCuerpo).toBeLessThanOrEqual(largo.anchoVisible)
  })
})
