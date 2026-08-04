import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useStore from '@/store/useStore'
import api from '@/services/api'
import Billing from '@/pages/Billing'

// ════════════════════════════════════════════
//  ADMINAPP · Punto de venta, renderizado
//
//  Acá se afirma **el efecto**: que una tecla dispare lo que tiene que
//  disparar, y **solo** eso. La decisión de SI una tecla dispara —tecla ×
//  modificadores × dónde está el foco, unas cuarenta combinaciones— ya está
//  cubierta en `utils/atajosDelPos.test.js`, donde cuesta milisegundos.
//
//  ⚠ Hay un test que verifica una AUSENCIA:
//  «desmontada la pantalla, Ctrl+Enter no llama a api.post». Es el único, y por
//  eso queda dicho acá arriba: un test que verifica que algo *no* pasa es el
//  primero que alguien borra por «no probar nada». Lo que prueba es que el
//  `removeEventListener` del hook existe. Sin él, el escuchador huérfano sigue
//  viendo el store —que es global— y cobra una venta desde otra pantalla.
//
//  El molde es `renderDeInventario.test.jsx`:
//   · el store se llena a mano con `useStore.setState`, incluidas las acciones
//     que la pantalla llama en un `useEffect` al montar;
//   · NO se mockea `@/services/api` entero —el grafo de imports arrastra
//     decenas de exportaciones nombradas y la lista se desactualiza sola—: se
//     espía la instancia de axios.
// ════════════════════════════════════════════

const SETTINGS = {
  margin_efectivo: 0,
  recargo_tarjeta: 20,
  descuento_alianza: 10,
  tax_condition: 'Monotributo',
  // AFIP configurado a propósito: sin CUIT ni punto de venta, el cobro tira
  // «AFIP no está configurado» ANTES de llamar a la API y los tests del cobro
  // pasarían por el motivo equivocado.
  afip_cuit: '20304050607',
  afip_pv: '5',
}

const CENTRO = { id: 1, name: 'Centro', code: 'centro', is_active: true }

/** Con stock en Centro, y con código de barras para probar el escaneo. */
const COLAGENO = {
  id: 10,
  name: 'Colágeno 300g',
  sku: 'COL-300',
  barcode: '7791234567890',
  cost: '1000',
  category: 'colageno',
  brand: { name: 'Star' },
  stock: [{ id: 100, punto_de_venta_id: 1, quantity: 5, available: 5 }],
}

const CREATINA = {
  id: 11,
  name: 'Creatina 300g',
  sku: 'CRE-300',
  barcode: '7791234567891',
  cost: '2000',
  category: 'creatina',
  brand: { name: 'Star' },
  stock: [{ id: 101, punto_de_venta_id: 1, quantity: 3, available: 3 }],
}

/** Sin una sola unidad: lo que el botón no deja agregar, el atajo tampoco. */
const SIN_STOCK = {
  id: 12,
  name: 'Barrita 30g',
  sku: 'BAR-30',
  barcode: '7791234567892',
  cost: '500',
  category: 'alimento',
  brand: { name: 'Star' },
  stock: [{ id: 102, punto_de_venta_id: 1, quantity: 0, available: 0 }],
}

/**
 * Monta la pantalla con el store cargado a mano.
 *
 * ⚠ Es `async` y el render va envuelto en `act`, con un turno de macrotareas
 * adentro: el `ScrollArea` del carrito —el de `@base-ui/react`— se mide desde un
 * `setTimeout` y actualiza su estado ahí, después de que el render terminó. Sin
 * el turno, esa actualización cae fuera de `act`.
 */
async function montar({ productos = [COLAGENO, CREATINA], cart = [] } = {}) {
  useStore.setState({
    products: productos,
    brands: [],
    sucursales: [CENTRO],
    permisos: ['ventas.crear'],
    settings: SETTINGS,
    usuario: { id: 1, es_superadmin: false },
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [CENTRO] },
    puntoDeVentaActivo: CENTRO,
    cart,
    loading: false,
    error: null,
    // La llama un `useEffect` al montar. Con la de verdad, cada test pegaría
    // contra la API.
    initialize: vi.fn(),
  })

  let resultado

  await act(async () => {
    resultado = render(<Billing />)
    await new Promise((seguir) => setTimeout(seguir, 0))
  })

  return resultado
}

/** El campo de búsqueda, por la marca que usan los atajos. */
const buscador = () => document.querySelector('[data-buscador-del-pos]')

/** Una tecla sobre el elemento enfocado, como la manda un teclado de verdad. */
function teclear(key, modificadores = {}) {
  act(() => {
    const evento = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modificadores })
    ;(document.activeElement || window).dispatchEvent(evento)
  })
}

const cart = () => useStore.getState().cart

let post

/**
 * Los POST que registran la venta.
 *
 * Con un comprobante fiscal el circuito son DOS pedidos: primero `/sales` y
 * después `/sales/:id/facturar`, en ese orden y nunca al revés. Contar `post`
 * entero contaría también el pedido del CAE; lo que este archivo afirma es que
 * la VENTA se registra una sola vez.
 */
const postsDeVenta = () => post.mock.calls.filter(([url]) => url === '/sales')

beforeEach(() => {
  post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { ok: true, data: { id: 'sale_1', total: '1500.00', date: '2026-08-04' }, warnings: [], stock: [] },
  })
})

afterEach(() => {
  // ⚠ Se desmonta ANTES de tocar el store. El `cleanup()` lo hace igual el
  // archivo de preparación, pero sus hooks corren DESPUÉS que los de acá: sin
  // este desmontaje explícito, el `useStore.setState` de abajo actualiza una
  // pantalla que sigue montada y React imprime «An update to Billing inside a
  // test was not wrapped in act(...)» en CADA prueba del archivo.
  //
  // La suite quedaba en verde con veinte advertencias impresas al lado, que es
  // la peor de las dos opciones: nadie lee la salida cuando se pone en rojo.
  cleanup()
  post.mockRestore()
  useStore.setState({ cart: [], products: [] })
})

// ════════════════════════════════════════════
//  T1117 · Los atajos, sobre la pantalla vieja
// ════════════════════════════════════════════

describe('Enter en la búsqueda agrega, y no cobra', () => {
  it('Enter en la búsqueda agrega el primer resultado y NO cobra', async () => {
    // Las dos afirmaciones son igual de importantes. Un lector de código de
    // barras termina cada lectura con `Enter`: si `Enter` cobrara, cada escaneo
    // cobraría la venta.
    await montar()

    await userEvent.type(buscador(), 'Colágeno')
    teclear('Enter')

    await waitFor(() => expect(cart()).toHaveLength(1))
    expect(cart()[0].name).toBe('Colágeno 300g')
    expect(post).not.toHaveBeenCalled()
  })

  it('después de agregar, la consulta queda vacía y el foco sigue en la búsqueda', async () => {
    await montar()

    await userEvent.type(buscador(), 'Colágeno')
    teclear('Enter')

    await waitFor(() => expect(buscador()).toHaveValue(''))
    expect(document.activeElement).toBe(buscador())
  })

  it('un código escaneado que no existe NO borra la consulta', async () => {
    // Escenario 2.5. Borrarla obliga a volver a tipear —o a re-escanear— el
    // código que justamente no existe. Y tampoco puede agregar el producto más
    // parecido: la difusa sobre un EAN inexistente casi siempre devuelve algo.
    await montar()

    const inexistente = '7799999999999'
    await userEvent.type(buscador(), inexistente)
    teclear('Enter')

    await waitFor(() => expect(cart()).toHaveLength(0))
    expect(buscador()).toHaveValue(inexistente)
  })

  it('un primer resultado sin stock NO se agrega', async () => {
    // Escenario 2.6: lo que el botón no deja hacer, el atajo tampoco.
    await montar({ productos: [SIN_STOCK] })

    await userEvent.type(buscador(), 'Barrita')
    teclear('Enter')

    await new Promise((r) => setTimeout(r, 0))
    expect(cart()).toHaveLength(0)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('Ctrl+Enter cobra, y una sola vez', () => {
  it('Ctrl+Enter dispara un solo POST /sales', async () => {
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
  })

  it('con el ticket vacío, Ctrl+Enter no manda ningún pedido', async () => {
    // Escenario 2.9.
    await montar({ cart: [] })

    teclear('Enter', { ctrlKey: true })

    await new Promise((r) => setTimeout(r, 0))
    expect(post).not.toHaveBeenCalled()
  })

  it('desmontada la pantalla, Ctrl+Enter no llama a api.post', async () => {
    // ⚠ El test que verifica una ausencia. Si alguien borra el `return` del
    // `useEffect` del hook —el `removeEventListener`—, el escuchador huérfano
    // sigue vivo, sigue viendo el store, y `Ctrl+Enter` desde cualquier otra
    // pantalla cobra la venta que quedó en el ticket.
    const { unmount } = await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    unmount()

    const evento = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => { window.dispatchEvent(evento) })

    // ⚠ La afirmación que importa es `defaultPrevented`, y NO alcanza con mirar
    // `api.post`. Comprobado con la mutación: borrando el `removeEventListener`
    // este test pasaba igual, porque los escuchadores huérfanos que dejan los
    // tests anteriores del archivo se disparan PRIMERO, llaman a
    // `preventDefault()` con el ticket vacío que tenían, y el huérfano que este
    // test quiere atrapar ve `defaultPrevented: true` y no hace nada.
    //
    // Un escuchador vivo es un escuchador que consume la tecla. Si no quedó
    // ninguno, el evento llega al final sin que nadie lo haya tocado.
    expect(evento.defaultPrevented).toBe(false)

    await new Promise((r) => setTimeout(r, 0))
    expect(post).not.toHaveBeenCalled()
  })
})

describe('La barra lleva el foco a la búsqueda, salvo que se esté escribiendo', () => {
  it('/ fuera de todo campo enfoca la búsqueda', async () => {
    await montar()

    // El foco arranca en la búsqueda; se lo saca a propósito para probar el
    // camino del escenario 2.1.
    act(() => buscador().blur())
    expect(document.activeElement).not.toBe(buscador())

    teclear('/')

    expect(document.activeElement).toBe(buscador())
  })

  it('/ dentro de la búsqueda escribe una barra y NO se la roba el atajo', async () => {
    // Escenario 2.2. `userEvent.type` respeta `preventDefault`: si el atajo se
    // robara la tecla, el campo quedaría sin la barra.
    await montar()

    await userEvent.type(buscador(), 'col/ageno')

    expect(buscador()).toHaveValue('col/ageno')
  })
})

// ════════════════════════════════════════════
//  T1118 · El foco vuelve solo a la búsqueda
// ════════════════════════════════════════════

describe('El foco vuelve solo a la búsqueda', () => {
  it('al abrir la pantalla el foco NO se queda en el body', async () => {
    // Escenario 3.1. Sin esto, la primera venta del día arranca con un clic.
    await montar()

    expect(document.activeElement).toBe(buscador())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('después de cobrar el foco vuelve a la búsqueda y la consulta está vacía', async () => {
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    await userEvent.type(buscador(), 'creatina')
    act(() => buscador().blur())

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(post).toHaveBeenCalled())
    await waitFor(() => expect(document.activeElement).toBe(buscador()))
  })

  it('agregar un producto con el MOUSE también devuelve el foco a la búsqueda', async () => {
    // Escenario 3.6: el circuito es el mismo con mouse o sin él.
    await montar({ productos: [COLAGENO] })

    act(() => buscador().blur())

    const [boton] = screen.getAllByRole('button').filter((b) => b.className.includes('bg-brand'))
    await userEvent.click(boton)

    expect(cart()).toHaveLength(1)
    expect(document.activeElement).toBe(buscador())
  })

  it('escribiendo en el CUIT, un pedido que NO es el cobro NO me mueve el foco', async () => {
    // Escenarios 3.3 y 3.7 hablan del mismo instante y piden cosas opuestas:
    // «terminó la venta → el foco vuelve a la búsqueda» y «estoy escribiendo el
    // CUIT y llega la respuesta de un pedido en vuelo → el foco no se me
    // mueve». Se resolvió forzando el foco SOLO al terminar el cobro.
    //
    // La salida «obvia» —`useEffect(() => buscador.current?.focus(),
    // [loading])`— hace lo mismo en apariencia y rompe esto, y vuelve sola.
    // Este es el test que la detiene.
    //
    // ⚠ El pedido que NO es el cobro es hoy el de la factura de prueba, que es
    // la otra operación de esta pantalla que toca `loading`. Cuando ese botón
    // salga del pie de cobro (T1122), este test tiene que apuntar a la
    // operación que lo reemplace: lo que se afirma es «cualquier pedido que no
    // sea el cobro», no ese botón en particular.
    await montar()

    // Con comprobante fiscal aparece el campo de CUIT.
    const cuit = screen.getByPlaceholderText('Opcional')
    await userEvent.type(cuit, '20304050607')

    // El pedido queda EN VUELO: se dispara y el operador vuelve al CUIT
    // mientras la respuesta viaja. Ese es el instante del escenario 3.7, y por
    // eso las respuestas se sueltan a mano y no se dejan resolver solas.
    const respuestas = []
    post.mockImplementation(() => new Promise((resolver) => respuestas.push(resolver)))

    await userEvent.click(screen.getByRole('button', { name: /Factura de Prueba/ }))

    act(() => cuit.focus())
    expect(document.activeElement).toBe(cuit)

    // Ahora sí llegan. El circuito manda dos pedidos, uno detrás del otro.
    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        respuestas.splice(0).forEach((resolver) =>
          resolver({ data: { ok: true, data: { id: 'test_1', voucherNumber: 1, cae: '75123456789012' } } })
        )
        await new Promise((seguir) => setTimeout(seguir, 0))
      })
    }

    expect(document.activeElement).toBe(cuit)
  })
})

// ════════════════════════════════════════════
//  T1119 · Esc: limpia el campo, o pide confirmación
// ════════════════════════════════════════════

describe('Esc limpia el campo antes que el ticket', () => {
  it('Esc con texto en la búsqueda NO vacía el ticket', async () => {
    // El caso que motivó la decisión: en un mostrador `Esc` se aprieta por
    // reflejo para cerrar cualquier cosa, y un ticket de quince líneas con
    // precios negociados a mano no se recupera.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    await userEvent.type(buscador(), 'colageno')
    teclear('Escape')

    await waitFor(() => expect(buscador()).toHaveValue(''))
    expect(cart()).toHaveLength(1)
    expect(document.activeElement).toBe(buscador())
  })

  it('Esc con la búsqueda vacía pide confirmación antes de tirar el ticket', async () => {
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    teclear('Escape')

    // El diálogo aparece y el ticket todavía está entero.
    expect(await screen.findByText(/Vaciar el ticket/)).toBeInTheDocument()
    expect(cart()).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(cart()).toHaveLength(0))
  })

  it('cancelar la confirmación devuelve el foco a la búsqueda, no al body', async () => {
    // `ui/dialog` devuelve el foco al elemento que lo abrió, y acá no hay
    // elemento: lo abrió una tecla. Sin el `focus()` explícito el foco vuelve
    // al `<body>` y el operador tiene que apretar `/` para volver a donde ya
    // estaba.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    // ⚠ El foco se saca de la búsqueda ANTES de apretar `Esc`, y no es un
    // detalle: comprobado con la mutación, con el foco ya puesto en la búsqueda
    // el diálogo se lo devuelve solo —restaura el elemento que estaba enfocado
    // al abrirse— y el test pasa con y sin el `focus()` explícito. El caso real
    // es este: el operador acaba de tocar otra cosa, aprieta `Esc`, y quien
    // abrió el diálogo fue una tecla y no un elemento.
    act(() => buscador().blur())
    expect(document.activeElement).not.toBe(buscador())

    teclear('Escape')

    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    expect(cart()).toHaveLength(1)
    await waitFor(() => expect(document.activeElement).toBe(buscador()))
  })

  it('con el ticket vacío, Esc no abre ningún diálogo', async () => {
    // Confirmar que se borre lo que ya está borrado es ruido.
    await montar({ cart: [] })

    teclear('Escape')

    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/Vaciar el ticket/)).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1109 · El vuelto salió del componente, y la pantalla lo usa
//
//  `utils/vuelto.test.js` prueba la cuenta. Este test prueba que la pantalla
//  llame a esa cuenta: mover una función a `utils/` y dejar la copia vieja
//  dibujando es la forma más común de que el módulo nuevo quede sin usar.
// ════════════════════════════════════════════

describe('El vuelto que se dibuja sale de utils/vuelto', () => {
  it('un «Paga con» menor al total dice cuánto FALTA, y no un vuelto negativo', async () => {
    // Escenario 5.10. La diferencia entre «−$3.200» y «faltan $3.200» es la
    // diferencia entre interpretar un signo con la mano en la caja y leer una
    // frase.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 50500, qty: 1, method: 'ef' }] })

    await userEvent.type(screen.getByPlaceholderText('0'), '47300')

    expect(screen.getByText('Faltan $3.200,00')).toBeInTheDocument()
    expect(screen.queryByText(/-\$/)).not.toBeInTheDocument()
  })

  it('propone billetes que alcanzan, y ninguno por debajo del total', async () => {
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 47300, qty: 1, method: 'ef' }] })

    for (const monto of ['$48.000', '$50.000', '$60.000']) {
      expect(screen.getByRole('button', { name: monto })).toBeInTheDocument()
    }
  })
})
