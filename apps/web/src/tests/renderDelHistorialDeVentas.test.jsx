import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import useStore from '@/store/useStore'
import api from '@/services/api'
import InvoicesList, { filtrosDeLaUrl } from '@/pages/InvoicesList'

// ════════════════════════════════════════════
//  ADMINAPP · Historial de ventas, renderizado
//
//  Dos defectos, y los dos son de los que no fallan solos:
//
//   · **C2 — emitir de un clic.** «Reintentar facturación» hacía
//     `POST /sales/:id/facturar` sin preguntar nada. Un comprobante emitido
//     consume numeración correlativa y para darlo de baja hace falta una nota
//     de crédito, que es un proyecto que no existe. Los `confirm` que el
//     archivo ya tenía eran de anular, que es otra cosa.
//
//   · **D2 — el enlace del Panel.** El aviso «N ventas que AFIP rechazó»
//     llevaba a `/ventas` pelada, y la pantalla arrancaba en `{ page: 1 }` sin
//     mirar la URL: aunque el Panel mandara el filtro, la pantalla lo
//     ignoraba. Y el filtro que había —«Sin comprobante fiscal»— cuenta OTRA
//     población que el número del aviso.
//
//  El molde es `renderDelPuntoDeVenta.test.jsx`: el store se llena a mano y no
//  se mockea `@/services/api` entero, se espía la instancia de axios.
// ════════════════════════════════════════════

const CENTRO = { id: 1, name: 'Centro', code: 'centro', is_active: true }

const SETTINGS = {
  tax_condition: 'Monotributo',
  afip_cuit: '20304050607',
  afip_pv: '5',
  afip_environment: 'homologation',
}

/**
 * Una venta activa que ARCA rechazó: sin CAE y sin `afip_type`.
 *
 * ⚠ La fixture tiene que poder distinguir las dos poblaciones del defecto D2.
 * Ésta cae en las DOS —`afip_type IS NULL` y «rechazada»—, que es justamente
 * por qué el enlace del Panel podía llevar al filtro equivocado sin que se
 * notara mirando una fila. Lo que los separa no es el dato sino el parámetro
 * que la pantalla manda, y eso es lo que se afirma.
 */
const RECHAZADA = {
  id: 'sale_1754000000000_ab12cd34',
  date: '2026-08-04',
  time: '10:15',
  total: '1500.00',
  payment_method: 'ef',
  customer_name: 'Pérez',
  afip_cae: null,
  afip_nro: null,
  afip_pv: null,
  afip_type: null,
  status: 'active',
  estado: { codigo: 'rechazada', etiqueta: 'Rechazada' },
}

/** El detalle que devuelve `GET /api/sales/:id` para esa misma venta. */
const DETALLE_RECHAZADA = {
  ...RECHAZADA,
  items: [],
  afip_ultimo_error: 'Error de AFIP: [{"Code":10015,"Msg":"CUIT inexistente"}]',
  afip_ultimo_intento: '2026-08-04T13:20:00.000Z',
}

let get
let post

/** Los parámetros con los que se pidió el listado, en orden. */
const consultas = () => get.mock.calls
  .filter(([url]) => url === '/sales')
  .map(([, config]) => (config && config.params) || {})

/** Los pedidos que EMITEN un comprobante ante ARCA. */
const emisiones = () => post.mock.calls.filter(([url]) => String(url).includes('/facturar'))

function respuestaDelListado(ventas) {
  return {
    data: {
      ok: true,
      data: ventas,
      total: ventas.length,
      total_periodo: 1500,
      page: 1,
      totalPages: 1,
      rango: { desde: '2026-08-04', hasta: '2026-08-04' },
      sucursales: [CENTRO],
    },
  }
}

/**
 * Monta el historial en una ruta concreta.
 *
 * La ruta es el parámetro que importa: es de donde sale la mitad de D2, y por
 * eso el `MemoryRouter` va con `initialEntries` y no pelado.
 */
async function montar({
  ruta = '/ventas',
  ventas = [RECHAZADA],
  settings = SETTINGS,
  permisos = ['ventas.ver', 'ventas.crear', 'ventas.anular'],
} = {}) {
  get.mockImplementation((url) => {
    if (url === '/sales') return Promise.resolve(respuestaDelListado(ventas))
    if (String(url).startsWith('/sales/')) {
      return Promise.resolve({ data: { ok: true, data: DETALLE_RECHAZADA } })
    }
    return Promise.resolve({ data: { ok: true, data: [] } })
  })

  useStore.setState({
    settings,
    permisos,
    usuario: { id: 1, es_superadmin: false },
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [CENTRO] },
    puntoDeVentaActivo: null,
    loading: false,
    error: null,
  })

  let resultado

  await act(async () => {
    resultado = render(
      <MemoryRouter initialEntries={[ruta]}>
        <InvoicesList />
      </MemoryRouter>
    )
    await new Promise((seguir) => setTimeout(seguir, 0))
  })

  return resultado
}

/** Abre el panel lateral de la primera fila y espera a que traiga el detalle. */
async function abrirElPanel() {
  const fila = screen.getByText('Pérez').closest('[style*="grid-template-columns"]')
  await userEvent.click(fila)

  return screen.findByRole('button', { name: /Reintentar facturación/ })
}

beforeEach(() => {
  get = vi.spyOn(api, 'get')
  post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true, data: {} } })
})

afterEach(() => {
  // Se desmonta ANTES de tocar el store, por el mismo motivo que en
  // `renderDelPuntoDeVenta.test.jsx`: si no, el `setState` del test siguiente
  // actualiza una pantalla montada y React llena la salida de avisos de `act`.
  cleanup()
  get.mockRestore()
  post.mockRestore()
})

// ════════════════════════════════════════════
//  D2 · La pantalla lee la query
// ════════════════════════════════════════════

describe('El filtro del enlace llega a la consulta', () => {
  it('`/ventas?estado=rechazada` consulta con ese estado y NO el listado completo', async () => {
    // El defecto: `useState({ page: 1 })` sin mirar la URL. El usuario venía
    // del aviso «3 ventas que AFIP rechazó» y aterrizaba en el día entero.
    await montar({ ruta: '/ventas?estado=rechazada' })

    expect(consultas()).toHaveLength(1)
    expect(consultas()[0].estado).toBe('rechazada')
  })

  it('«rechazada» NO se traduce a «sin comprobante fiscal»', async () => {
    // Son DOS poblaciones distintas y ésta es la otra mitad de D2: el contador
    // del Panel cuenta las que tienen un error de AFIP guardado; `tipo=sin_cae`
    // cuenta `afip_type IS NULL`, que incluye todos los remitos de un comercio
    // que no factura electrónicamente. Mandar el segundo mostraría un conjunto
    // que no es el que originó el número.
    await montar({ ruta: '/ventas?estado=rechazada' })

    expect(consultas()[0].tipo).toBeUndefined()
  })

  it('el control muestra el filtro que se aplicó, así se puede quitar', async () => {
    // Un filtro aplicado que ningún control refleja es un listado corto sin
    // explicación, y sin forma de volver atrás.
    await montar({ ruta: '/ventas?estado=rechazada' })

    expect(screen.getByLabelText('Estado')).toHaveValue('rechazada')
  })

  it('un estado que la API no entiende NO viaja', async () => {
    // Un parámetro desconocido no devuelve cero filas: la API lo ignora y
    // devuelve TODAS. La pantalla mostraría el listado entero con un filtro
    // puesto en el control, que es peor que no filtrar.
    await montar({ ruta: '/ventas?estado=cualquier-cosa' })

    expect(consultas()[0].estado).toBeUndefined()
    expect(screen.getByLabelText('Estado')).toHaveValue('')
  })

  it('el tipo de comprobante y el rango de la URL también se aplican', async () => {
    await montar({ ruta: '/ventas?tipo=6&desde=2026-01-01&hasta=2026-01-31' })

    expect(consultas()[0].tipo).toBe('6')
    expect(consultas()[0].desde).toBe('2026-01-01')
    expect(consultas()[0].hasta).toBe('2026-01-31')

    // Y los campos muestran ESAS fechas, no el «hoy» que devolvió el servidor:
    // una pantalla que consulta enero y dibuja agosto en los campos miente.
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-01-01')
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-01-31')
  })

  it('la búsqueda de la URL sobrevive al rebote de 350 ms', async () => {
    // El rebote de la búsqueda corre al montar y copia el campo a `consulta.q`.
    // Sin inicializar el campo con el `q` del enlace, el filtro se aplica y
    // 350 ms después la propia pantalla lo borra — el usuario ve el resultado
    // correcto por un instante y después el listado entero.
    await montar({ ruta: '/ventas?q=P%C3%A9rez' })

    expect(screen.getByPlaceholderText(/Buscar por número/)).toHaveValue('Pérez')

    await act(async () => { await new Promise((seguir) => setTimeout(seguir, 450)) })

    expect(consultas().length).toBeGreaterThan(0)
    for (const params of consultas()) expect(params.q).toBe('Pérez')
  })

  it('sin nada en la URL la pantalla sigue arrancando en la página 1 y sin filtros', async () => {
    // La otra mitad: leer la query no puede inventar filtros donde no los hay.
    await montar({ ruta: '/ventas' })

    expect(consultas()[0].estado).toBeUndefined()
    expect(consultas()[0].tipo).toBeUndefined()
    expect(consultas()[0].page).toBe(1)
  })
})

describe('filtrosDeLaUrl valida antes de dejar pasar', () => {
  const leer = (busqueda) => filtrosDeLaUrl(new URLSearchParams(busqueda))

  it('deja pasar solo los estados que la API sabe filtrar', () => {
    expect(leer('estado=rechazada').estado).toBe('rechazada')
    expect(leer('estado=autorizada').estado).toBeUndefined()
    expect(leer('estado=').estado).toBeUndefined()
  })

  it('deja pasar solo los cuatro tipos del filtro', () => {
    for (const tipo of ['1', '6', '11', 'sin_cae']) {
      expect(leer(`tipo=${tipo}`).tipo).toBe(tipo)
    }
    expect(leer('tipo=99').tipo).toBeUndefined()
  })

  it('descarta una fecha que no es una fecha', () => {
    // Va derecho a un `BETWEEN` contra una columna DATEONLY: lo que no tiene
    // forma de fecha no devuelve cero filas, hace abortar la consulta.
    expect(leer('desde=2026-01-01').desde).toBe('2026-01-01')
    expect(leer('desde=ayer').desde).toBeUndefined()
    expect(leer('hasta=01/01/2026').hasta).toBeUndefined()
  })

  it('la sucursal acepta «todas» y un id, y nada más', () => {
    expect(leer('punto_de_venta_id=todas').punto_de_venta_id).toBe('todas')
    expect(leer('punto_de_venta_id=7').punto_de_venta_id).toBe('7')
    expect(leer('punto_de_venta_id=; DROP').punto_de_venta_id).toBeUndefined()
  })

  it('la página NO se lee de la URL', () => {
    // El rebote de la búsqueda vuelve siempre a la página 1: una página en la
    // URL duraría 350 ms y sería una promesa que la pantalla no cumple.
    expect(leer('page=4').page).toBe(1)
  })
})

// ════════════════════════════════════════════
//  C2 · Emitir un comprobante fiscal pide confirmación
// ════════════════════════════════════════════

describe('Reintentar la facturación no emite de un clic', () => {
  it('apretar el botón NO manda el pedido hasta confirmar', async () => {
    await montar()

    await userEvent.click(await abrirElPanel())

    // El diálogo está y el pedido NO salió.
    expect(await screen.findByRole('button', { name: 'Emitir comprobante' })).toBeInTheDocument()
    expect(emisiones()).toHaveLength(0)
  })

  it('cancelar deja la venta como estaba', async () => {
    // Un comprobante emitido consume numeración correlativa: «Cancelar» tiene
    // que ser realmente cancelar.
    await montar()

    await userEvent.click(await abrirElPanel())
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    await new Promise((seguir) => setTimeout(seguir, 0))
    expect(emisiones()).toHaveLength(0)
  })

  it('confirmar sí emite, y una sola vez', async () => {
    // La otra mitad: una confirmación que no deja emitir rompe la pantalla.
    await montar()

    await userEvent.click(await abrirElPanel())
    await userEvent.click(await screen.findByRole('button', { name: 'Emitir comprobante' }))

    await waitFor(() => expect(emisiones()).toHaveLength(1))
    expect(emisiones()[0][0]).toBe(`/sales/${RECHAZADA.id}/facturar`)
  })

  it('la confirmación dice qué comprobante y que el ambiente es PRODUCCIÓN', async () => {
    // «¿Confirmar?» a secas no le da a nadie con qué decidir. Los dos datos que
    // deciden son el comprobante que se va a emitir y el ambiente: en
    // producción el número no se devuelve.
    await montar({
      settings: { ...SETTINGS, tax_condition: 'RI', afip_environment: 'production' },
    })

    await userEvent.click(await abrirElPanel())

    const texto = (await screen.findByRole('dialog')).textContent

    // Un RI emite Factura B, que es lo mismo que deduce el servidor cuando el
    // body va vacío. Decir «Factura C» acá sería confirmar una cosa y emitir
    // otra.
    expect(texto).toContain('Factura B')
    expect(texto).toContain('PRODUCCIÓN')
    expect(texto).toContain('nota de crédito')
  })

  it('el «Facturar» del CUIT que faltaba TAMBIÉN pide confirmación', async () => {
    // Son DOS botones que emiten y los dos entran por `reintentarFacturacion`.
    // Puesta la confirmación en el `onClick` de «Reintentar facturación», éste
    // seguiría emitiendo un comprobante fiscal real de un clic — y es el más
    // fácil de olvidar, porque solo aparece después de un rechazo.
    await montar()

    // Primer intento: ARCA pide el CUIT del comprador.
    post.mockRejectedValueOnce({
      response: { status: 400, data: { error: 'CUIT_REQUERIDO' } },
    })

    await userEvent.click(await abrirElPanel())
    await userEvent.click(await screen.findByRole('button', { name: 'Emitir comprobante' }))

    // El panel cambia de forma: ahora pide el CUIT.
    const campo = await screen.findByPlaceholderText('20123456789')
    await userEvent.type(campo, '20304050607')

    await userEvent.click(screen.getByRole('button', { name: 'Facturar' }))

    // El diálogo está y el segundo pedido NO salió: sigue habiendo uno solo,
    // el que ARCA rechazó.
    expect(await screen.findByRole('button', { name: 'Emitir comprobante' })).toBeInTheDocument()
    expect(emisiones()).toHaveLength(1)

    // Y confirmando sí sale, con el CUIT que se acaba de tipear.
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }))

    await waitFor(() => expect(emisiones()).toHaveLength(2))
    expect(emisiones()[1][1]).toEqual({ customerCuit: '20304050607' })
  })

  it('en homologación lo dice, y dice que el comprobante no vale', async () => {
    // La diferencia entre los dos ambientes es exactamente lo que importa: con
    // un solo texto para los dos, el aviso más grave del sistema se lee igual
    // cuando no pasa nada, y entonces deja de leerse.
    await montar({ settings: { ...SETTINGS, tax_condition: 'Monotributo' } })

    await userEvent.click(await abrirElPanel())

    const texto = (await screen.findByRole('dialog')).textContent

    expect(texto).toContain('Factura C')
    expect(texto).toContain('HOMOLOGACIÓN')
    expect(texto).toContain('NO tiene validez fiscal')
  })
})
