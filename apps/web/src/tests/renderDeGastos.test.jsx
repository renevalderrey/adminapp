import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import api from '@/services/api'
import Expenses from '@/pages/Expenses'
import { fechaDeHoy } from '@/utils/formato'
import { nombreDelMes } from '@/utils/gastos'

// ════════════════════════════════════════════
//  ADMINAPP · Gastos, renderizado
//
//  Los cuatro defectos que esta pantalla arrastraba y que se ven acá:
//
//   1. **Un gasto sin sucursal no se dibujaba en ninguna parte.** Con una sola
//      sucursal —el caso de Comprafit— el agrupado viejo lo perdía: `'gf0'` no
//      coincidía con nada y `'gf1'` quedaba afuera de «General». La plata seguía
//      moviendo el punto de equilibrio y la pantalla no la mostraba.
//   2. **«General» no tenía tarjeta**, porque los grupos se filtraban por su
//      NOMBRE: la suma de las tarjetas no era el total de gastos fijos.
//   3. **El botón de eliminar se dibujaba sin el permiso.** El rol `gerente`
//      tiene `gastos.crear` y `gastos.editar` pero no `gastos.eliminar`, así que
//      apretaba y recibía 403.
//   4. **Un gasto fijo no se podía corregir**: no había edición, solo borrar y
//      volver a cargar.
//
//  Y uno de la solapa de variables:
//
//   5. **El mes por defecto salía de `toISOString()`**, o sea de UTC: el 31 a
//      las 21:30 hora argentina la pantalla abría en el mes siguiente y el gasto
//      se archivaba donde nadie lo iba a buscar.
//
//  ── El patrón, el mismo de `renderDeInventario.test.jsx` ──
//
//  El store se llena a mano, no se mockea `@/services/api` entero —se espía la
//  instancia de axios— y las filas se buscan por su `grid-template-columns`,
//  porque la tabla es un grid y no hay `role="row"`.
// ════════════════════════════════════════════

const CENTRO = { id: 1, name: 'Ortiz de Ocampo' }
const NORTE = { id: 2, name: 'Uriburu' }

const EMPRESA = { id: 1, name: 'Comprafit', puntosDeVenta: [CENTRO, NORTE] }

/**
 * Tres gastos, y los importes NO son redondos a propósito.
 *
 * `0,10 + 0,20` en punto flotante da `0,30000000000000004`: con importes
 * redondos, sumar en el navegador con `parseFloat` acumulado y sumar en
 * centavos del lado del servidor darían el mismo texto, y el test pasaría con y
 * sin la corrección.
 *
 * El del medio es el que la pantalla vieja perdía: **sin sucursal y con el
 * `group` del legacy**.
 */
const ALQUILER = { id: 1, name: 'Alquiler', amount: '180000.10', punto_de_venta_id: 1, group: 'pv_1' }
const SUELDOS = { id: 2, name: 'Sueldos', amount: '400000.20', punto_de_venta_id: null, group: 'gf1' }
const INTERNET = { id: 3, name: 'Internet', amount: '15000.00', punto_de_venta_id: 2, group: 'pv_2' }

const GASTOS = [ALQUILER, SUELDOS, INTERNET]

/** Los totales tal como los suma el servidor, en centavos y de la misma lectura. */
const TOTALES = {
  general: 595000.3,
  sin_sucursal: 400000.2,
  por_sucursal: { 1: 180000.1, 2: 15000 },
}

const TODOS = ['gastos.ver', 'gastos.crear', 'gastos.editar', 'gastos.eliminar', 'config.editar']

/** Lo que tiene el rol `gerente`: crea y edita, pero NO elimina. */
const GERENTE = ['gastos.ver', 'gastos.crear', 'gastos.editar']

let pedidos = []

const respuesta = (data) => Promise.resolve({ data })

/**
 * Monta `/gastos`.
 *
 * El render va envuelto en `act` porque la pantalla pide los gastos al montar:
 * sin esperar esa resolución React llena la salida de «An update … was not
 * wrapped in act(...)», y una suite que imprime ruido en verde es una que nadie
 * lee cuando se pone en rojo.
 */
async function montar({
  gastos = GASTOS,
  totales = TOTALES,
  alcance = 'empresa',
  permisos = TODOS,
  sucursales = [CENTRO, NORTE],
  // Un objeto con `response` adentro se dobla como RECHAZO, que es la forma en
  // que axios entrega un 4xx o un 5xx.
  fallaLaCarga = null,
  variables = { mes: '2026-08', total: 0, personas: [] },
} = {}) {
  useStore.setState({
    permisos,
    empresaActiva: { ...EMPRESA, puntosDeVenta: sucursales },
    settings: { target_sales: 0 },
  })

  vi.spyOn(api, 'get').mockImplementation((url) => {
    pedidos.push({ metodo: 'get', url })

    if (url === '/expenses') {
      if (fallaLaCarga) return Promise.reject(fallaLaCarga)
      return respuesta({ ok: true, data: gastos, totales, alcance })
    }

    if (url === '/gastos-variables') return respuesta({ ok: true, data: variables })

    return respuesta({ ok: true, data: [] })
  })

  vi.spyOn(api, 'post').mockImplementation((url, cuerpo) => {
    pedidos.push({ metodo: 'post', url, cuerpo })
    return respuesta({ ok: true, data: { id: 99 } })
  })

  vi.spyOn(api, 'put').mockImplementation((url, cuerpo) => {
    pedidos.push({ metodo: 'put', url, cuerpo })
    return respuesta({ ok: true, data: { id: 1 } })
  })

  vi.spyOn(api, 'delete').mockImplementation((url) => {
    pedidos.push({ metodo: 'delete', url })
    return respuesta({ ok: true })
  })

  await act(async () => {
    render(<Expenses />)
  })
}

/** La fila de la tabla en grid que contiene ese texto. */
function filaDe(texto) {
  return screen.getByText(texto).closest('[style*="grid-template-columns"]')
}

/** El `grid-template-columns` declarado en línea, tal cual. */
function columnasDe(elemento) {
  const encontrado = (elemento?.getAttribute('style') || '').match(/grid-template-columns:\s*([^;]+)/)

  return encontrado ? encontrado[1].trim() : null
}

/**
 * Un importe argentino leído a centavos enteros: «180.000,10» → 18000010.
 *
 * Se compara en centavos y no en pesos porque comparar en pesos es lo que
 * permite que el residuo del punto flotante se cuele sin que nada falle.
 */
function centavos(texto) {
  const limpio = String(texto).replace(/[^\d,]/g, '').replace(',', '.')

  return Math.round(Number(limpio) * 100)
}

beforeEach(() => {
  pedidos = []
})

afterEach(() => {
  // ⚠ `cleanup()` va ANTES de tocar el store, y no alcanza con el que hace
  // `preparacion.js`: ese `afterEach` se registra primero y por eso corre
  // último, así que el `setState` de acá abajo repintaba componentes todavía
  // montados y React imprimía «An update to Can … was not wrapped in act(...)»
  // al lado de un test en verde. Una suite que imprime ruido en verde es una que
  // nadie lee cuando se pone en rojo.
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ permisos: [], empresaActiva: null, settings: {} })
})

// ════════════════════════════════════════════
//  El defecto 1 y el 2: la plata que no se veía, y la tarjeta que faltaba
// ════════════════════════════════════════════

describe('todos los gastos se dibujan, y las tarjetas cierran', () => {
  it('un gasto sin sucursal se dibuja en General y General tiene su tarjeta', async () => {
    await montar()

    // La fila existe, con «General» en la columna de sucursal. Antes no existía:
    // el gasto de `group='gf1'` sin sucursal no entraba en ningún bucket.
    const fila = filaDe('Sueldos')

    expect(fila).not.toBeNull()
    expect(within(fila).getByText('General')).toBeInTheDocument()

    // Y la tarjeta, que antes se filtraba por el NOMBRE del grupo.
    const tarjeta = screen.getByLabelText('Total del grupo General')

    expect(within(tarjeta).getByText('$400.000,20')).toBeInTheDocument()
  })

  it('con UNA sola sucursal el gasto sin sucursal tampoco desaparece', async () => {
    // Es el caso de Comprafit y el que hacía invisible la plata: con una sola
    // sucursal el agrupado viejo buscaba `'gf0'`, que no coincidía con nada.
    await montar({ sucursales: [CENTRO] })

    expect(filaDe('Sueldos')).not.toBeNull()
    expect(screen.getByLabelText('Total del grupo General')).toBeInTheDocument()
  })

  it('las tarjetas de total suman lo mismo que las filas', async () => {
    await montar()

    // `/^Total del grupo /` y no `/^Total /`: el total de abajo también se llama
    // «Total …», y sumarlo con las tarjetas daría el doble sin que nada avise.
    const tarjetas = screen.getAllByLabelText(/^Total del grupo /)
    const sumaDeTarjetas = tarjetas.reduce(
      (total, tarjeta) => total + centavos(tarjeta.querySelector('.num').textContent),
      0
    )

    const totalDeAbajo = centavos(
      screen.getByLabelText('Total de gastos fijos por mes').textContent
    )

    // Las tres tarjetas —dos sucursales y General— tienen que sumar el total, y
    // el total tiene que ser el de las filas. Con «General» sin tarjeta, la
    // primera igualdad fallaba por 400.000,20.
    expect(tarjetas).toHaveLength(3)
    expect(sumaDeTarjetas).toBe(totalDeAbajo)
    expect(sumaDeTarjetas).toBe(centavos('595.000,30'))
  })

  it('los importes NO se leen al revés en un navegador en inglés', async () => {
    // `toLocaleString()` sin locale escribía «180,000.1». Es el error que
    // convierte $1.234 en $1,234 y no falla nada.
    await montar()

    expect(within(filaDe('Alquiler')).getByText('$180.000,10')).toBeInTheDocument()
  })

  it('el encabezado y las filas comparten el MISMO grid-template-columns', async () => {
    await montar()

    const encabezado = screen.getByText('Descripción').closest('[style*="grid-template-columns"]')

    expect(columnasDe(encabezado)).not.toBeNull()
    expect(columnasDe(filaDe('Alquiler'))).toBe(columnasDe(encabezado))
    expect(columnasDe(filaDe('Sueldos'))).toBe(columnasDe(encabezado))
  })

  it('la pantalla dice que el alcance es la empresa entera, no la sucursal activa', async () => {
    await montar()

    expect(
      screen.getByText(/Todos los gastos fijos de la empresa, sin filtrar por la sucursal activa/)
    ).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  El defecto 3: los botones que la API rechaza
// ════════════════════════════════════════════

describe('las acciones se dibujan según el permiso', () => {
  it('sin gastos.eliminar el botón está deshabilitado y dice por qué', async () => {
    await montar({ permisos: GERENTE })

    const boton = within(filaDe('Alquiler')).getByTitle(/No podés eliminar gastos/)

    expect(boton).toBeDisabled()
    // Deshabilitado y no ausente: quien no lo tiene también tiene que poder ver
    // que la acción existe y por qué no la puede usar.
    expect(boton.getAttribute('title')).toContain('gastos.eliminar')
  })

  it('con gastos.eliminar el botón funciona y llama al endpoint', async () => {
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(within(filaDe('Alquiler')).getByTitle('Eliminar'))
    await usuario.click(screen.getByRole('button', { name: 'Eliminar gasto' }))

    expect(pedidos.filter((p) => p.metodo === 'delete')).toEqual([
      { metodo: 'delete', url: '/expenses/1' },
    ])
  })

  it('sin gastos.crear no se dibuja el botón de alta y se explica', async () => {
    await montar({ permisos: ['gastos.ver'] })

    expect(screen.queryByRole('button', { name: /Nuevo gasto/ })).toBeNull()
    expect(screen.getByText(/te falta el permiso «gastos.crear»/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  El defecto 4: un gasto fijo no se podía corregir
// ════════════════════════════════════════════

describe('editar un gasto fijo', () => {
  it('editar un gasto llama a PUT /expenses/:id y no a POST', async () => {
    const usuario = userEvent.setup()
    await montar()

    // La fila entera abre el panel del gasto, como en Inventario.
    await usuario.click(filaDe('Alquiler'))

    const importe = screen.getByLabelText('Importe mensual')
    await usuario.clear(importe)
    await usuario.type(importe, '195000.55')

    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    // `waitFor` y no `act(...)` a mano: `userEvent` ya envuelve el clic, y lo
    // único que falta es esperar a que la promesa del pedido se resuelva.
    await waitFor(() => expect(pedidos.some((p) => p.metodo === 'put')).toBe(true))

    const escrituras = pedidos.filter((p) => p.metodo === 'put' || p.metodo === 'post')

    // Con `createExpense` siempre —que es lo que hacía la pantalla vieja, porque
    // no había edición— el alquiler viejo quedaría cargado y el punto de
    // equilibrio contaría el gasto dos veces.
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0].metodo).toBe('put')
    expect(escrituras[0].url).toBe('/expenses/1')
    expect(escrituras[0].cuerpo).toMatchObject({ name: 'Alquiler', amount: 195000.55 })
  })

  it('el alta llama a POST y manda la sucursal en null cuando es «General»', async () => {
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(screen.getByRole('button', { name: /Nuevo gasto/ }))
    await usuario.type(screen.getByLabelText('Descripción'), 'Contador')
    await usuario.type(screen.getByLabelText('Importe mensual'), '90000')

    await usuario.click(screen.getByRole('button', { name: 'Agregar gasto' }))
    await waitFor(() => expect(pedidos.some((p) => p.metodo === 'post')).toBe(true))

    const alta = pedidos.find((p) => p.metodo === 'post')

    expect(alta.url).toBe('/expenses')
    // Sin sucursal es un caso legítimo, el que se dibuja en «General». Y `group`
    // NO viaja: lo escribe el servidor (FR-031).
    expect(alta.cuerpo).toEqual({ name: 'Contador', amount: 90000, punto_de_venta_id: null })
  })
})

// ════════════════════════════════════════════
//  El error de la API, que hasta hoy llegaba como «Request failed with…»
// ════════════════════════════════════════════

describe('los errores de la API se leen', () => {
  it('un 500 muestra el mensaje del servidor y no «Request failed with status code 500»', async () => {
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})
    const usuario = userEvent.setup()

    await montar()

    // El rechazo con la forma de axios: `err.message` es el texto inútil y el
    // que sirve viaja en `response.data.error`, que es donde `fallo()` lo deja.
    api.delete.mockRejectedValueOnce({
      message: 'Request failed with status code 500',
      response: { status: 500, data: { ok: false, error: 'Error al eliminar el gasto fijo' } },
    })

    await usuario.click(within(filaDe('Alquiler')).getByTitle('Eliminar'))
    await usuario.click(screen.getByRole('button', { name: 'Eliminar gasto' }))

    await waitFor(() => expect(aviso).toHaveBeenCalled())

    expect(aviso).toHaveBeenCalledWith('Error al eliminar el gasto fijo')
    expect(aviso).not.toHaveBeenCalledWith(expect.stringContaining('Request failed'))
  })

  it('un fallo de carga se ve en la pantalla y no en un console.error', async () => {
    await montar({
      fallaLaCarga: {
        message: 'Request failed with status code 403',
        response: { status: 403, data: { error: 'FORBIDDEN' } },
      },
    })

    // Un 403 dibujaba una lista vacía, indistinguible de una empresa sin gastos.
    // Y «FORBIDDEN» tampoco es un aviso: es un código de máquina.
    const alerta = screen.getByRole('alert')

    expect(alerta).toHaveTextContent(/te falta el permiso «gastos.ver»/)
    expect(alerta).not.toHaveTextContent('FORBIDDEN')
    expect(screen.queryByText('Todavía no cargaste ningún gasto fijo.')).toBeNull()
  })

  it('sin ningún gasto cargado, el estado vacío dice qué falta y para qué sirve', async () => {
    await montar({ gastos: [], totales: { general: 0, sin_sucursal: 0, por_sucursal: {} } })

    expect(screen.getByText('Todavía no cargaste ningún gasto fijo.')).toBeInTheDocument()
    // Y NO es el mismo texto que el de una sucursal sin gastos propios (FR-019).
    expect(screen.getAllByText('Sin gastos propios todavía').length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════
//  El defecto 5: el mes de los variables, calculado en UTC
// ════════════════════════════════════════════

describe('la solapa de variables abre en el mes correcto', () => {
  it('el mes por defecto de la solapa de variables no adelanta el día', async () => {
    // ⚠ **Por qué se envenena `toISOString` en vez de mover el reloj.** El
    // defecto solo se manifiesta cuando la hora local y la UTC caen en meses
    // distintos, o sea que un test que mueve el reloj **pasa en vacío en una
    // máquina en UTC** —que es donde corre CI—: el mes sería el mismo por las
    // dos vías y el rojo nunca llegaría. Envenenar el único método por el que
    // podía entrar UTC lo hace determinista en cualquier zona horaria: si
    // alguien vuelve a `new Date().toISOString().slice(0, 7)`, la pantalla abre
    // en «diciembre 1999». `fechaDeHoy()` no lo usa.
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('1999-12-31T23:59:59.000Z')

    const usuario = userEvent.setup()
    await montar()

    await usuario.click(screen.getByRole('button', { name: 'Variables' }))

    const esperado = nombreDelMes(fechaDeHoy().slice(0, 7))

    expect(await screen.findByText(esperado)).toBeInTheDocument()
    expect(screen.queryByText('diciembre 1999')).toBeNull()
  })

  it('el mes se pide al servidor y el total del mes sale de utils/formato', async () => {
    const usuario = userEvent.setup()

    await montar({
      variables: {
        mes: '2026-08',
        total: 12345.5,
        personas: [{ persona: 'Marina', total: 12345.5, items: [{ id: 7, nombre: 'Nafta', monto: 12345.5 }] }],
      },
    })

    await usuario.click(screen.getByRole('button', { name: 'Variables' }))
    await screen.findByText('Nafta')

    // «12.345,50», no «12.345,5»: `toLocaleString('es-AR')` sin decimales fijos
    // dejaba conviviendo dos formas en la misma columna.
    expect(within(filaDe('Nafta')).getByText('$12.345,50')).toBeInTheDocument()
    expect(pedidos.some((p) => p.url === '/gastos-variables')).toBe(true)
  })
})
