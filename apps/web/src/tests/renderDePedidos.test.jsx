import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Pedidos from '@/pages/Pedidos'
import { gruposVisibles } from '@/components/navegacion'

// ════════════════════════════════════════════
//  FAVALIO · /pedidos, renderizado
//
//  Lo que se afirma acá es el dibujo y el efecto. Las etiquetas y los tonos de
//  cada estado viven en `utils/pedidos.js` y se prueban aparte.
//
//  Los tres casos que sostienen la pantalla:
//
//   · **el aviso de la bandeja NO tiene botón de cerrar** — un aviso que se
//     cierra es un aviso que se cierra el primer día, y el que entra en marzo es
//     el que más lo necesita;
//   · **los dos vacíos dicen cosas distintas** — «todavía no entró ninguno» y
//     «el filtro no devolvió nada» son dos pantallas, y la segunda tiene una
//     salida que la primera no;
//   · **la columna Canal se dibuja aunque todos digan lo mismo** — está desde el
//     primer día para que el segundo canal no obligue a migrar datos ni a
//     enseñarle una columna nueva a una pantalla en producción.
// ════════════════════════════════════════════

const PEDIDOS = [
  {
    id: 'aaaa-1', numero: 1042, estado: 'pendiente_pago', origen: 'catalogo', catalogo_id: 7,
    comprador_nombre: 'Martina Olivera', entrega: 'retiro_socio', medio_pago: 'transferencia',
    total: 41368, created_at: '2026-08-09T14:05:00.000Z',
  },
  {
    id: 'aaaa-2', numero: 1041, estado: 'pagado', origen: 'catalogo', catalogo_id: 7,
    comprador_nombre: 'Julián Sosa', entrega: 'envio', medio_pago: 'efectivo',
    total: 12500, created_at: '2026-08-09T11:20:00.000Z',
  },
]

const BANDEJA = {
  pedidos: PEDIDOS,
  total: 2,
  pagina: 1,
  hay_mas: false,
  por_estado: {
    pendiente_pago: 1, pagado: 1, en_preparacion: 0, listo: 0, entregado: 0, cancelado: 0,
  },
  hay_filtros: false,
  filtros: {},
};

const CATALOGOS = [{ id: 7, nombre_visible: 'Comprafit / Fitnet', slug: 'comprafit-fitnet' }]

const DETALLE = {
  pedido: {
    ...PEDIDOS[0],
    comprador_telefono: '5493425123456',
    comprador_email: 'martina@ejemplo.test',
    comprador_nro_socio: 'F-4412',
    envio_costo: 0,
    subtotal: 41368,
    notas: 'Timbre 3B',
  },
  lineas: [
    { id: 1, nombre: 'Whey Protein Isolate 1kg', cantidad: 1, precio_unitario: 38868, subtotal: 38868 },
    { id: 2, nombre: 'Shaker', cantidad: 1, precio_unitario: 2500, subtotal: 2500 },
  ],
  catalogo: CATALOGOS[0],
  transiciones: ['pagado', 'en_preparacion', 'cancelado'],
}

/** Todo lo que salió por la red, en orden. */
let pedidosDeRed = []

function respuestasDe(bandeja) {
  return (url, config) => {
    pedidosDeRed.push({ url, params: config?.params })

    if (url === '/pedidos') return Promise.resolve({ data: { ok: true, data: bandeja } })
    if (url === '/catalogos') return Promise.resolve({ data: { ok: true, data: CATALOGOS } })
    if (/^\/pedidos\//.test(url)) return Promise.resolve({ data: { ok: true, data: DETALLE } })

    return Promise.resolve({ data: { ok: true, data: [] } })
  }
}

async function montar({ bandeja = BANDEJA, permisos = ['pedidos.ver', 'pedidos.gestionar', 'catalogo.ver'] } = {}) {
  useStore.setState({ permisos, empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [] } })

  vi.spyOn(api, 'get').mockImplementation(respuestasDe(bandeja))

  let utilidades
  await act(async () => { utilidades = render(<Pedidos />) })
  await act(async () => {})

  return utilidades
}

beforeEach(() => {
  pedidosDeRed = []
  vi.restoreAllMocks()
})

describe('el aviso de lo que «marcar cobrado» NO hace', () => {
  it('el aviso de la bandeja NO tiene botón de cerrar', async () => {
    await montar()

    const aviso = document.querySelector('[data-aviso-bandeja]')
    expect(aviso).not.toBeNull()

    // Por rol, que es como lo cerraría una persona. Un aviso que se cierra es un
    // aviso que se cierra el primer día.
    expect(within(aviso).queryByRole('button')).toBeNull()
    expect(aviso.querySelector('button')).toBeNull()
  })

  it('dice exactamente lo que el sistema hace y lo que no', async () => {
    await montar()

    const texto = document.querySelector('[data-aviso-bandeja]').textContent

    expect(texto).toContain('cambia su estado')
    expect(texto).toContain('no descuenta stock ni registra la venta')
    expect(texto).toContain('a mano desde el punto de venta')
  })
})

describe('la bandeja', () => {
  it('dibuja una fila por pedido, con el número en el formato de las seis superficies', async () => {
    await montar()

    expect(screen.getByText('#1042')).toBeTruthy()
    expect(screen.getByText('#1041')).toBeTruthy()
    expect(screen.getByText('Martina Olivera')).toBeTruthy()
  })

  it('la columna Canal se dibuja aunque todos los pedidos digan lo mismo', async () => {
    await montar()

    // Hoy los dos dicen `catalogo`. Está desde el primer día para que el segundo
    // canal no obligue a enseñarle una columna nueva a una pantalla que ya está
    // en producción.
    expect(screen.getByText('Canal')).toBeTruthy()
    expect(document.querySelectorAll('[data-canal]')).toHaveLength(2)
  })

  it('el encabezado y las filas comparten el mismo grid-template-columns', async () => {
    // Si difieren, las etiquetas dejan de estar sobre sus datos y se lee un
    // total bajo «Canal».
    await montar()

    const columnas = (n) => (n?.getAttribute('style') || '').match(/grid-template-columns:\s*([^;]+)/)?.[1].trim()
    const filas = Array.from(document.querySelectorAll('[data-pedido]'))
    const encabezado = filas[0].parentElement.querySelector('div')

    expect(filas).toHaveLength(2)
    for (const fila of filas) expect(columnas(fila)).toBe(columnas(encabezado))
  })

  it('las píldoras llevan el número que manda el servidor', async () => {
    await montar()

    const pendiente = document.querySelector('[data-filtro-estado="pendiente_pago"]')
    expect(pendiente.textContent).toContain('1')

    // Con cero, no en blanco: una píldora sin número se lee como «no se pudo
    // contar».
    expect(document.querySelector('[data-filtro-estado="entregado"]').textContent).toContain('0')
  })

  it('filtrar por estado vuelve a pedir con el filtro puesto', async () => {
    await montar()
    pedidosDeRed = []

    await act(async () => {
      fireEvent.click(document.querySelector('[data-filtro-estado="pagado"]'))
    })
    await act(async () => {})

    const dePedidos = pedidosDeRed.filter((p) => p.url === '/pedidos')
    expect(dePedidos.at(-1).params).toEqual({ estado: 'pagado' })
  })
})

describe('los dos vacíos', () => {
  it('la bandeja sin pedidos dice algo distinto que la bandeja filtrada sin resultados', async () => {
    await montar({ bandeja: { ...BANDEJA, pedidos: [], total: 0, hay_filtros: false } })

    expect(document.querySelector('[data-estado-vacio="sin-pedidos"]')).not.toBeNull()
    expect(screen.getByText(/Todavía no entró ningún pedido/)).toBeTruthy()

    vi.restoreAllMocks()
    await montar({ bandeja: { ...BANDEJA, pedidos: [], total: 0, hay_filtros: true } })

    // La segunda tiene una salida —sacar el filtro— que la primera no tiene, y
    // decirle «todavía no entró ninguno» a alguien que filtró es mentirle.
    expect(document.querySelector('[data-estado-vacio="sin-resultados"]')).not.toBeNull()
    expect(screen.getByText(/Ningún pedido con ese filtro/)).toBeTruthy()
  })
})

describe('el panel lateral', () => {
  it('abre con las líneas congeladas y las transiciones que mandó el servidor', async () => {
    await montar()

    await act(async () => { fireEvent.click(document.querySelector('[data-pedido="1042"]')) })
    await act(async () => {})

    expect(screen.getByText('Whey Protein Isolate 1kg')).toBeTruthy()
    expect(screen.getByText('F-4412')).toBeTruthy()

    // Los botones los decide el servidor: acá sólo se les pone verbo.
    expect(document.querySelector('[data-transicion="pagado"]').textContent).toContain('Marcar cobrado')
    expect(document.querySelector('[data-transicion="listo"]')).toBeNull()
  })

  it('sin `pedidos.gestionar` no hay botones de estado, y se dice por qué', async () => {
    await montar({ permisos: ['pedidos.ver'] })

    await act(async () => { fireEvent.click(document.querySelector('[data-pedido="1042"]')) })
    await act(async () => {})

    expect(document.querySelector('[data-transicion="pagado"]')).toBeNull()
    expect(screen.getByText(/No podés cambiar el estado de un pedido/)).toBeTruthy()
  })

  it('marcar cobrado manda el PATCH y refresca la fila', async () => {
    await montar()
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({
      data: { ok: true, data: { pedido: { ...DETALLE.pedido, estado: 'pagado' }, transiciones: ['en_preparacion', 'cancelado'] } },
    })

    await act(async () => { fireEvent.click(document.querySelector('[data-pedido="1042"]')) })
    await act(async () => {})
    await act(async () => { fireEvent.click(document.querySelector('[data-transicion="pagado"]')) })
    await act(async () => {})

    expect(patch).toHaveBeenCalledWith('/pedidos/aaaa-1/estado', { estado: 'pagado' })
    // Y el botón de «Marcar cobrado» ya no está: la segunda pasada no existe.
    expect(document.querySelector('[data-transicion="pagado"]')).toBeNull()
  })
})

describe('el ítem del menú', () => {
  const rutas = (grupos) => grupos.flatMap((g) => g.items.map((i) => i.to))

  it('no aparece sin `pedidos.ver`', () => {
    const con = gruposVisibles((p) => p === 'pedidos.ver', { modulosHabilitados: ['catalogo'] })
    const sin = gruposVisibles(() => false, { modulosHabilitados: ['catalogo'] })

    expect(rutas(con)).toContain('/pedidos')
    expect(rutas(sin)).not.toContain('/pedidos')
  })

  it('no aparece sin el módulo `catalogo`', () => {
    // El mismo módulo que el ABM: lo que se libera por empresa es la
    // funcionalidad entera, y una bandeja sin catálogo no recibe un pedido.
    const sinModulo = gruposVisibles(() => true, { modulosHabilitados: [] })

    expect(rutas(sinModulo)).not.toContain('/pedidos')
  })
})
