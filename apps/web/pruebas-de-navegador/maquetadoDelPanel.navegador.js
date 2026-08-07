import { test, expect } from '@playwright/test'

// ════════════════════════════════════════════
//  ADMINAPP · El maquetado del Panel de control
//
//  **Dos medidas, y nada más.** Todo lo demás del Panel está cubierto más
//  barato: las alturas del sparkline son `utils/panel.test.js`, que una tarjeta
//  sin serie no dibuje barras es `tests/renderDelPanel.test.jsx`, y que un
//  bloque ausente no salga en `$0,00` también. Repetir cualquiera de esas acá
//  cuesta cincuenta veces más por caso, y una suite lenta es una que alguien
//  termina salteando (`CONVENCIONES.md`, «Pruebas de navegador»).
//
//  Lo que baja a este nivel es lo que jsdom **no puede contestar**, porque
//  `scrollWidth`, `clientWidth` y `getBoundingClientRect` devuelven cero
//  siempre:
//
//   1. **El sparkline de doce barras no desborda su tarjeta.** Doce `div`s con
//      `flex:1` adentro de un contenedor sin `min-w-0` no se encogen por debajo
//      de su contenido: la fila se ensancha, la tarjeta crece y la grilla se
//      desalinea. Lo que se mide es `scrollWidth` contra `clientWidth`, que es
//      la única forma de saber si sobra algo a lo ancho.
//   2. **Las cuatro tarjetas son iguales y arrancan a la misma altura.** Con la
//      primera ensanchada por el sparkline, las otras tres se corren y la
//      grilla de cuatro columnas deja de ser una grilla. Se afirma el ancho y el
//      borde superior de las cuatro cajas, medidos.
//
//  ── La siembra ──
//
//  El sparkline **solo existe si hay doce meses reales de historia** (FR-068), y
//  eso no lo puede dar `preparacion.js`, que siembra un catálogo. Este archivo
//  siembra sus propias ventas —una por mes, doce meses— contra la API
//  descartable, por HTTP y no contra la base: si los datos vinieran de un doble,
//  la prueba diría que el maquetado funciona con datos que el sistema no
//  produce.
//
//  La siembra es **idempotente**: los ids de venta son fijos, así que la segunda
//  corrida recibe el rechazo por id repetido y sigue. Lo que se verifica antes
//  de medir es que la serie exista de verdad —doce barras dibujadas—, y si no
//  existe la prueba falla diciendo eso y no una medida rara.
//
//  ── Las dos mutaciones, corridas ──
//
//  Una prueba de geometría puede pasar por razones que no tienen nada que ver
//  con lo que dice verificar, así que las dos se comprobaron rompiéndolas:
//
//   · **El desborde**: barras con `min-w-[24px]` en vez de `min-w-0`. Doce por
//     24px más los once espacios no entran en una tarjeta de ~280px, y el
//     `sobraX` del sparkline pasó de 0 a **59**. ⚠ Lo que NO alcanza es sacarle
//     el `min-w-0` a la tarjeta y poner trece barras —que es la mutación que
//     sugería `tasks.md`—: con `flex-1` cada barra tiene `flex-basis: 0` y una
//     caja vacía no tiene contenido que la ensanche, así que trece barras
//     simplemente salen más finitas y el desborde no ocurre. La que muerde es
//     la del ancho mínimo.
//   · **La grilla**: dejar la clase de columnas en `sm:grid-cols-2`. Las cuatro
//     tarjetas se acomodan en dos filas y los bordes superiores pasan de UNO a
//     dos. ⚠ Sacarle el `min-w-0` a la tarjeta NO rompe esta prueba: la grilla
//     de Tailwind usa `minmax(0, 1fr)`, así que los cuatro carriles miden lo
//     mismo con o sin él.
// ════════════════════════════════════════════

const API = process.env.ADMINAPP_API_DE_PRUEBAS || 'http://localhost:5099/api'

/** El primer día del mes corrido `meses` hacia atrás, como YYYY-MM-DD. */
function mediadosDelMes(meses) {
  const hoy = new Date()
  const fecha = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - meses, 15))

  return fecha.toISOString().split('T')[0]
}

/**
 * Doce ventas, una por mes, para que `series.ventas` tenga doce puntos reales.
 *
 * Los importes son distintos entre sí y crecientes: con doce importes iguales,
 * las doce barras medirían lo mismo y una escala mal calculada se vería idéntica
 * a una bien calculada.
 */
async function sembrarDoceMesesDeVentas(request) {
  for (let i = 0; i < 12; i++) {
    const respuesta = await request.post(`${API}/sales`, {
      data: {
        id: `PANEL-SERIE-${String(i).padStart(2, '0')}`,
        // El mes en curso se siembra HOY: el corte superior de la serie es el
        // mismo que el de «Ventas del mes», así que una venta fechada adelante
        // no entraría en la última barra.
        date: i === 0 ? new Date().toISOString().split('T')[0] : mediadosDelMes(i),
        time: '12:00',
        total: 1000 + i * 350,
        payment_method: 'ef',
        items: [{ product_name: 'Venta de prueba del panel', quantity: 1, unit_price: 1000 + i * 350 }],
      },
    })

    // 200/201 la primera vez; 409 o 400 por id repetido en las siguientes. Lo
    // que NO puede pasar es un 5xx: eso es la API rota y hay que verlo.
    if (respuesta.status() >= 500) {
      throw new Error(
        `POST /sales respondió ${respuesta.status()} al sembrar la serie del panel: `
        + (await respuesta.text()).slice(0, 300)
      )
    }
  }
}

/** Las cajas de las cuatro tarjetas y del sparkline, medidas por el navegador. */
function medirElPanel(page) {
  return page.evaluate(() => {
    const caja = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()

      return {
        izq: Math.round(r.left),
        der: Math.round(r.right),
        arriba: Math.round(r.top),
        ancho: Math.round(r.width),
        sobraX: el.scrollWidth - el.clientWidth,
      }
    }

    const tarjetas = [...document.querySelectorAll('[data-indicador]')]

    return {
      etiquetas: tarjetas.map((t) => t.getAttribute('data-indicador')),
      tarjetas: tarjetas.map(caja),
      // Uno por tarjeta que trajo serie. Se miden TODOS: con el primero solo, un
      // desborde en la cuarta tarjeta pasaría en verde.
      sparklines: [...document.querySelectorAll('[data-sparkline]')].map((s) => ({
        ...caja(s),
        barras: s.querySelectorAll('[data-barra]').length,
        // El ancho útil de la tarjeta que lo contiene, sin su relleno.
        anchoDisponible: Math.round(s.parentElement.clientWidth),
      })),
      documento: {
        sobraX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      },
    }
  })
}

async function abrirElPanel(page) {
  await page.goto('/panel')
  await page.waitForLoadState('networkidle')
  // Por rol y no por texto: «Panel de control» también es el ítem de la barra
  // lateral, y `getByText` matchea los dos.
  await expect(page.getByRole('heading', { name: 'Panel de control' })).toBeVisible()
}

test.describe('El maquetado del Panel', () => {
  test.beforeEach(async ({ page, request }) => {
    await sembrarDoceMesesDeVentas(request)
    await abrirElPanel(page)
  })

  test('el sparkline de doce barras NO desborda su tarjeta', async ({ page }) => {
    const medidas = await medirElPanel(page)

    // Primero la premisa: sin sparklines dibujados esta prueba estaría midiendo
    // tarjetas sin nada que desbordar y pasaría en verde por vacío.
    expect(
      medidas.sparklines.length,
      'No se dibujó ningún sparkline: o la siembra no llegó a doce meses o la serie no vino.'
    ).toBeGreaterThan(0)

    for (const sparkline of medidas.sparklines) {
      expect(sparkline.barras).toBe(12)
      // `scrollWidth − clientWidth` es lo único que dice si sobra algo a lo
      // ancho, y en jsdom da cero siempre.
      expect(sparkline.sobraX).toBe(0)
      // Y entra en el ancho útil de su tarjeta: doce `div`s con `flex:1` sin
      // `min-w-0` no se encogen por debajo de su contenido y ensanchan la fila.
      expect(sparkline.ancho).toBeLessThanOrEqual(sparkline.anchoDisponible)
    }

    // Ninguna tarjeta desborda tampoco.
    for (const tarjeta of medidas.tarjetas) expect(tarjeta.sobraX).toBe(0)
  })

  test('las cuatro tarjetas miden lo mismo y arrancan a la misma altura', async ({ page }) => {
    const medidas = await medirElPanel(page)

    expect(
      medidas.etiquetas,
      'La sesión de estas pruebas es admin, así que los cuatro bloques de plata vienen.'
    ).toEqual(['Ventas del mes', 'Saldo de caja', 'Por cobrar', 'Por pagar']);

    const anchos = medidas.tarjetas.map((t) => t.ancho)
    const arriba = medidas.tarjetas.map((t) => t.arriba)

    // Iguales al píxel salvo el redondeo de la grilla: una tarjeta ensanchada
    // por el sparkline corre a las otras tres y la grilla deja de ser una
    // grilla.
    expect(Math.max(...anchos) - Math.min(...anchos)).toBeLessThanOrEqual(1)
    expect(new Set(arriba).size).toBe(1)

    // Los bordes izquierdos están igual de separados: es la otra mitad de lo
    // mismo, y la que se rompe cuando una tarjeta crece.
    const saltos = medidas.tarjetas.slice(1).map((t, i) => t.izq - medidas.tarjetas[i].izq)

    expect(Math.max(...saltos) - Math.min(...saltos)).toBeLessThanOrEqual(1)

    // Y la página no desborda a lo ancho por culpa del Panel.
    expect(medidas.documento.sobraX).toBe(0)
  })
})
