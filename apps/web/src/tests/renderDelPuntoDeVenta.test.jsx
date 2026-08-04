import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useStore from '@/store/useStore'
import api from '@/services/api'
import Billing from '@/pages/Billing'
import { MEDIOS } from '@/utils/mediosDePago'

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
async function montar({
  productos = [COLAGENO, CREATINA],
  cart = [],
  settings = SETTINGS,
  permisos = ['ventas.crear'],
} = {}) {
  useStore.setState({
    products: productos,
    brands: [],
    sucursales: [CENTRO],
    permisos,
    settings,
    usuario: { id: 1, es_superadmin: false },
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [CENTRO] },
    puntoDeVentaActivo: CENTRO,
    cart,
    loading: false,
    error: null,
    // La llama un `useEffect` al montar. Con la de verdad, cada test pegaría
    // contra la API.
    //
    // ⚠ El doble pide `/products` igual que la de verdad —que dispara tres
    // pedidos y vuelve a traer todos los productos con todas sus filas de
    // stock—, y eso es lo que hace verificable el criterio de éxito 10: si
    // alguien vuelve a poner un `initialize()` al terminar el cobro, el espía
    // de `api.get` lo ve. Con un `vi.fn()` pelado, ese test pasaría igual.
    initialize: vi.fn(async () => { await api.get('/products?active=true') }),
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

/**
 * El `grid-template-columns` declarado en un elemento, tal cual está escrito.
 *
 * Se lee del atributo `style` y NO de `getComputedStyle`: jsdom no tiene motor
 * de maquetado, así que lo computado no dice nada. Lo que se compara son los
 * dos strings declarados, que es donde está el defecto que esto atrapa.
 */
const columnasDe = (elemento) =>
  (elemento?.getAttribute('style') || '').match(/grid-template-columns:\s*([^;]+)/)?.[1]?.trim()

/** El bloque de grid que contiene ese texto. */
const gridCon = (texto) => screen.getByText(texto).closest('[style*="grid-template-columns"]')

/** Una tecla sobre el elemento enfocado, como la manda un teclado de verdad. */
function teclear(key, modificadores = {}) {
  act(() => {
    const evento = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modificadores })
    ;(document.activeElement || window).dispatchEvent(evento)
  })
}

const cart = () => useStore.getState().cart

let post
let get

/** Los `GET` que vuelven a traer el catálogo entero. */
const gets = (parte) => get.mock.calls.filter(([url]) => String(url).includes(parte))

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
  get = vi.spyOn(api, 'get').mockResolvedValue({ data: { ok: true, data: [] } })
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
  get.mockRestore()
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

    // Por su nombre accesible y no por una clase: el botón se identifica por lo
    // que dice que hace, que es lo que no cambia cuando se rediseña la fila.
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    expect(cart()).toHaveLength(1)
    expect(document.activeElement).toBe(buscador())
  })

  it('escribiendo en el CUIT, la respuesta de un pedido en vuelo NO me mueve el foco', async () => {
    // Escenarios 3.3 y 3.7 hablan del mismo instante y piden cosas opuestas:
    // «terminó la venta → el foco vuelve a la búsqueda» y «estoy escribiendo el
    // CUIT y llega la respuesta de un pedido en vuelo → el foco no se me
    // mueve». Se resolvió forzando el foco SOLO al TERMINAR el cobro.
    //
    // La salida «obvia» —un `useEffect` con el estado de la espera en las
    // dependencias— hace lo mismo en apariencia y rompe esto, y vuelve sola.
    // Este es el test que la detiene.
    //
    // ⚠ Este test apuntaba antes al botón de «Factura de Prueba», que era la
    // otra operación de la pantalla que tocaba `loading`. T1122 lo sacó del pie
    // de cobro, así que el pedido en vuelo pasa a ser el del PROPIO cobro: se
    // suelta `/sales` y la pantalla pasa a esperar el CAE, que es un cambio de
    // estado en el medio de la operación. Lo que se afirma es lo mismo —una
    // respuesta que llega no puede llevarse el foco de donde el operador está
    // escribiendo—, sobre la operación que existe.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    // Los dos pedidos del cobro quedan EN VUELO y se sueltan a mano.
    const respuestas = []
    post.mockImplementation((url) => new Promise((resolver) => respuestas.push({ url, resolver })))

    teclear('Enter', { ctrlKey: true })

    // Con comprobante fiscal aparece el campo de CUIT, y sigue editable durante
    // el cobro: es lo que hace posible corregirlo ante un CUIT_REQUERIDO.
    const cuit = screen.getByPlaceholderText('Opcional')
    act(() => cuit.focus())
    expect(document.activeElement).toBe(cuit)

    // Llega la respuesta de `/sales`. La venta quedó registrada y la pantalla
    // pasa a esperar el CAE; el CUIT sigue siendo donde está el cursor.
    await act(async () => {
      respuestas
        .splice(0)
        .forEach(({ resolver }) => resolver({
          data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [], stock: [] },
        }))
      await new Promise((seguir) => setTimeout(seguir, 0))
    })

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

  it('Esc en el CUIT limpia el CUIT y NO abre la confirmación del ticket', async () => {
    // FR-036, y es lo que faltaba de la corrida anterior: el atajo estaba
    // definido SOLO sobre la búsqueda, así que `Esc` en el CUIT no limpiaba
    // nada y —con la búsqueda vacía, que es el estado normal— abría la
    // confirmación de vaciado del ticket. El hook no le pasaba el evento a la
    // acción, así que `limpiar` no tenía cómo saber dónde estaba el foco.
    await montar({ cart: UNA_LINEA })

    const cuit = screen.getByPlaceholderText('Opcional')
    await userEvent.type(cuit, '20304050607')
    expect(cuit).toHaveValue(20304050607)

    teclear('Escape')

    await waitFor(() => expect(cuit).toHaveValue(null))
    expect(screen.queryByText(/Vaciar el ticket/)).not.toBeInTheDocument()
    expect(cart()).toHaveLength(1)
    expect(document.activeElement).toBe(buscador())
  })

  it('Esc en «Paga con» limpia ese campo y deja el ticket entero', async () => {
    // El otro campo del pie de cobro, por el mismo camino.
    await montar({ cart: UNA_LINEA })

    const pagaCon = screen.getByPlaceholderText('0')
    await userEvent.type(pagaCon, '5000')

    teclear('Escape')

    await waitFor(() => expect(screen.getByPlaceholderText('0')).toHaveValue(null))
    expect(screen.queryByText(/Vaciar el ticket/)).not.toBeInTheDocument()
    expect(cart()).toHaveLength(1)
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

// ════════════════════════════════════════════
//  T1120 · El catálogo, la columna izquierda
// ════════════════════════════════════════════

describe('El catálogo dibuja sus columnas y su estado vacío', () => {
  it('ningún precio queda bajo la etiqueta equivocada', async () => {
    // El encabezado y las filas comparten el MISMO string de
    // `grid-template-columns`, comparado como string y no «parecido». Dos
    // declaraciones que empiezan iguales y se separan es cómo un precio de
    // tarjeta termina bajo la etiqueta «Alianza», sin que nada falle.
    await montar()

    const encabezado = columnasDe(gridCon('Producto'))
    const fila = columnasDe(gridCon('Colágeno 300g'))

    expect(encabezado).toBeTruthy()
    expect(fila).toBe(encabezado)
  })

  it('una búsqueda sin resultados NO deja una lista en blanco', async () => {
    await montar()

    await userEvent.type(buscador(), 'zzzzz')

    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    // Y dice qué hacer, incluida la sugerencia de quitar el filtro de stock: el
    // operador que no encuentra un producto no se acuerda de que dejó el
    // conmutador puesto hace dos horas.
    expect(screen.getByText(/quitá el filtro «Solo con stock»/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1121 · El ticket, la columna derecha
// ════════════════════════════════════════════

describe('El ticket dice lo que se va a cobrar, y nada más', () => {
  it('un monotributista NO ve una línea de IVA que no cobró', async () => {
    // Criterio de éxito 14. `afipService` le manda `ImpIVA: 0`, así que
    // mostrarle una línea de IVA es decirle que cobró algo que no cobró. La
    // REGLA la cubre `utils/comprobantes.test.js`; acá se afirma el DIBUJO.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    expect(screen.queryByText(/IVA 21% incluido/)).not.toBeInTheDocument()
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument()
    // Y el total sí está: lo que no se dibuja es el desglose.
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('un responsable inscripto con Factura B SÍ ve el desglose', async () => {
    // La otra mitad del mismo criterio: sin esto, «no se dibuja nada» pasaría
    // igual con el desglose roto para todos.
    await montar({
      cart: [{ id: 10, name: 'Colágeno 300g', price: 1210, qty: 1, method: 'ef' }],
      settings: { ...SETTINGS, tax_condition: 'RI' },
    })

    expect(screen.getByText(/IVA 21% incluido/)).toBeInTheDocument()
    expect(screen.getByText('$1.000,00')).toBeInTheDocument()
  })

  it('el ticket vacío nombra el atajo dentro de un <kbd>', async () => {
    // Un atajo que no está escrito en ningún lado no lo usa nadie (FR-015).
    await montar({ cart: [] })

    const linea = screen.getByText(/Buscá un producto y presioná/)
    const tecla = linea.querySelector('kbd')

    expect(tecla).not.toBeNull()
    expect(tecla).toHaveTextContent('Enter')
  })

  it('el selector de comprobante NO es un <select>', async () => {
    // FR-019: un control segmentado. Con un desplegable hay que abrirlo para
    // saber qué está elegido, y acá se emite el mismo comprobante cincuenta
    // veces seguidas.
    await montar()

    expect(screen.getByRole('button', { name: 'Remito' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Factura C' })).toBeInTheDocument()
    expect(document.querySelector('select option[value="remito"]')).toBeNull()
  })

  it('el ticket declara 400px de ancho, no 380', async () => {
    // Escenario 1.1. La barra de carrito anterior declaraba 380
    // (`Billing.jsx:387`), y 20px de diferencia son la columna de precio
    // unitario de cada línea.
    await montar()

    const columna = screen.getByText('Ticket').closest('aside')

    expect(columna).not.toBeNull()
    expect(columna.className).toContain('w-[400px]')
  })
})

// ════════════════════════════════════════════
//  T1122 · La pantalla, en dos columnas
// ════════════════════════════════════════════

describe('La pantalla es el marco de dos columnas y nada más', () => {
  it('la pantalla NO dibuja su propio encabezado de pantalla', async () => {
    // FR-004: es la única del sistema sin `h1`. La miga de pan del `AppTopbar`
    // ya la nombra, y 60px de alto en la pantalla que se usa ocho horas por día
    // valen más que un título que no informa nada.
    await montar()

    expect(document.querySelector('h1')).toBeNull()
  })

  it('el pie de cobro NO tiene el botón de factura de prueba', async () => {
    // Emitía un comprobante fiscal REAL de $1 en producción, con número
    // correlativo consumido, y estaba a un clic del botón de cobrar (FR-068).
    await montar()

    expect(screen.queryByRole('button', { name: /Factura de Prueba/i })).not.toBeInTheDocument()
  })

  it('el catálogo y el ticket scrollean por separado, y la página no', async () => {
    // La verificación de que el scroll se VE bien es un paso manual —jsdom no
    // tiene motor de maquetado—, pero que las dos zonas declaren su propio
    // `overflow-y-auto` sí se puede afirmar acá. Es lo que quedó roto entre
    // T1116 y esta tarea: el `<main>` pasó a `overflow-hidden` y la pantalla
    // vieja no tenía ninguna zona de scroll propia, así que el catálogo largo
    // se recortaba y no había forma de alcanzarlo.
    await montar()

    const listaDelCatalogo = gridCon('Producto').parentElement
    const listaDelTicket = screen.getByText('Ticket vacío').closest('.overflow-y-auto')

    expect(listaDelCatalogo.className).toContain('overflow-y-auto')
    expect(listaDelTicket).not.toBeNull()
  })
})

// ════════════════════════════════════════════
//  T1123 · Un disparo, una venta — y la espera del CAE, dicha
// ════════════════════════════════════════════

/** Un ticket de una línea, que es con lo que se prueba el cobro. */
const UNA_LINEA = [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }]

/**
 * Dos disparos en la MISMA tanda.
 *
 * ⚠ Los dos eventos van adentro de UN SOLO `act()`, y eso es toda la prueba.
 * Comprobado con la mutación: con un `act()` por evento —o con
 * `userEvent.dblClick`, que espera entre clic y clic— React alcanza a
 * renderizar en el medio, el guardia hecho con estado también funciona, y el
 * test pasa con y sin la corrección. El defecto real es justamente el otro
 * caso: dos eventos que entran al mismo handler antes de que ningún render
 * haya ocurrido, con los dos leyendo la misma copia del estado.
 */
function dosDisparosEnLaMismaTanda(disparar) {
  act(() => {
    disparar()
    disparar()
  })
}

const eventoDeTecla = (key, modificadores = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modificadores })

describe('El cobro sale una sola vez por disparo', () => {
  it('dos Ctrl+Enter seguidos NO registran dos ventas', async () => {
    // Criterio de éxito 6, y es verificable contra la versión anterior: con el
    // guardia en `loading` —estado de React— los dos eventos de la misma tanda
    // leían `false` y salían los dos `POST`, cada uno con su propio id.
    await montar({ cart: UNA_LINEA })

    dosDisparosEnLaMismaTanda(() => {
      (document.activeElement || window).dispatchEvent(eventoDeTecla('Enter', { ctrlKey: true }))
    })

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(postsDeVenta()).toHaveLength(1)
  })

  it('dos clics rápidos en cobrar NO registran dos ventas', async () => {
    // El mismo defecto por la otra puerta: el doble clic del mouse.
    await montar({ cart: UNA_LINEA })

    const boton = screen.getByRole('button', { name: /Confirmar venta/ })

    dosDisparosEnLaMismaTanda(() => {
      boton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(postsDeVenta()).toHaveLength(1)
  })

  it('pasado el umbral, la espera del CAE dice que la venta ya quedó registrada', async () => {
    // Criterio 4.3. Sin fake timers esto no se puede afirmar, y sin afirmarlo el
    // operador aprieta de nuevo — que es exactamente lo que la línea evita.
    await montar({ cart: UNA_LINEA })

    // `/sales` responde; `/facturar` queda colgado, que es el caso real: ARCA
    // puede tardar 30 s.
    post.mockImplementation((url) => (
      url === '/sales'
        ? Promise.resolve({
            data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [], stock: [] },
          })
        : new Promise(() => {})
    ))

    // Los timers se falsean DESPUÉS de montar: el montaje espera un turno de
    // macrotareas de verdad para que el ticket se mida.
    vi.useFakeTimers()

    try {
      teclear('Enter', { ctrlKey: true })

      // Se dejan correr las microtareas para que `/sales` resuelva y la pantalla
      // pase a esperar el CAE.
      await act(async () => { await Promise.resolve(); await Promise.resolve() })

      // Todavía NO: el aviso desde el primer instante no significa nada.
      expect(screen.queryByText(/ARCA está tardando/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Pidiendo el CAE a ARCA/ })).toBeDisabled()

      act(() => { vi.advanceTimersByTime(5000) })

      expect(screen.getByText(/ARCA está tardando/)).toBeInTheDocument()
      expect(screen.getByText(/La venta ya quedó registrada/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ════════════════════════════════════════════
//  T1124 · El ticket queda inerte mientras se cobra
// ════════════════════════════════════════════

describe('El ticket no cambia mientras se está facturando', () => {
  it('con el cobro en curso, tocar el ticket NO lo modifica', async () => {
    // FR-046. Las DOS mitades importan: `disabled` en el DOM no impide que un
    // `keydown` dispare la acción por otro camino, y una acción que sigue viva
    // le cambia las líneas a una venta que ya salió para el servidor.
    await montar({ cart: UNA_LINEA, productos: [COLAGENO, CREATINA] })

    // El cobro queda colgado: es el instante que hay que mirar.
    post.mockImplementation(() => new Promise(() => {}))

    teclear('Enter', { ctrlKey: true })
    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))

    const mas = screen.getByRole('button', { name: /Agregar una unidad de Colágeno 300g/ })
    const precio = screen.getByRole('spinbutton', { name: /Precio unitario de Colágeno 300g/ })
    const segmento = segmentosDe('Colágeno 300g').getByRole('button', { name: /^Tarjeta/ })

    expect(mas).toBeDisabled()
    expect(precio).toBeDisabled()
    expect(segmento).toBeDisabled()

    const antes = JSON.stringify(cart())

    // Y la mitad que el `disabled` no cubre: el atajo del escáner.
    await userEvent.type(buscador(), 'Creatina')
    teclear('Enter')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.stringify(cart())).toBe(antes)
  })
})

// ════════════════════════════════════════════
//  T1125 · El catálogo se actualiza con lo que el servidor descontó
// ════════════════════════════════════════════

describe('Entre una venta y la siguiente no se recarga el catálogo', () => {
  it('después de una venta NO sale ningún GET /products', async () => {
    // Criterio de éxito 10, verificable contra la versión anterior: ahí
    // `initialize()` disparaba tres pedidos, ponía `loading: true` global y la
    // lista parpadeaba entera para actualizar dos o tres productos.
    await montar({ cart: UNA_LINEA })

    const alMontar = gets('/products').length
    expect(alMontar).toBe(1)

    teclear('Enter', { ctrlKey: true })
    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))

    expect(gets('/products')).toHaveLength(alMontar)
  })

  it('el stock del catálogo baja con lo que dijo el servidor, no con una resta del navegador', async () => {
    await montar({ cart: UNA_LINEA, productos: [COLAGENO] })

    post.mockResolvedValue({
      data: {
        ok: true,
        data: { id: 'sale_1', total: '1500.00' },
        warnings: [],
        // El servidor dice 2. La resta del navegador daría 4 (5 − 1): otra caja
        // vendió dos unidades mientras este ticket estaba abierto. Restar por
        // cuenta propia deja el catálogo mostrando el stock de la venta de otro.
        stock: [{ product_id: 10, punto_de_venta_id: 1, quantity: 2, available: 2 }],
      },
    })

    expect(screen.getByText('5 u.')).toBeInTheDocument()

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(screen.getByText('2 u.')).toBeInTheDocument())
    expect(screen.queryByText('4 u.')).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1126 · Los tres finales del cobro
// ════════════════════════════════════════════

/** Una respuesta de la API que rechaza, con el cuerpo que devuelve de verdad. */
const rechazo = (estado, cuerpo) => Object.assign(new Error(cuerpo.error || 'falló'), {
  response: { status: estado, data: cuerpo },
})

/** `/sales` responde bien; `/facturar` rechaza con lo que se le diga. */
function cobroConAfipQueRechaza(cuerpo) {
  post.mockImplementation((url) => (
    url === '/sales'
      ? Promise.resolve({
          data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [], stock: [] },
        })
      : Promise.reject(rechazo(500, cuerpo))
  ))
}

describe('Los tres finales del cobro dejan la pantalla como corresponde', () => {
  it('un rechazo de AFIP NO deja el ticket cargado', async () => {
    // FR-052: la operación EXISTE. Un ticket cargado invita a cobrarla de nuevo.
    await montar({ cart: UNA_LINEA })

    cobroConAfipQueRechaza({ error: 'El CAE no pudo emitirse: 10016 comprobante ya registrado' })

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(cart()).toHaveLength(0))

    // Y el aviso queda FIJO en el ticket, con el mensaje de AFIP tal cual y
    // diciendo que la venta quedó registrada (FR-051).
    expect(screen.getByText(/10016 comprobante ya registrado/)).toBeInTheDocument()
    expect(screen.getByText(/quedó REGISTRADA pero sin comprobante/)).toBeInTheDocument()
  })

  it('un rechazo de la API que no registró nada NO vacía el ticket', async () => {
    // FR-053. La diferencia con el anterior es TODO el criterio: confundir los
    // dos finales es cómo se cobra dos veces, o cómo se pierde un ticket de
    // quince líneas con precios negociados a mano.
    await montar({ cart: UNA_LINEA })

    post.mockRejectedValue(rechazo(400, {
      error: 'Stock insuficiente para "Colágeno 300g": disponible 0, requerido 1',
    }))

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))

    expect(cart()).toHaveLength(1)
  })

  it('el tipo de comprobante NO se resetea después de cada venta', async () => {
    // FR-049: en un mostrador se emite el mismo comprobante cincuenta veces
    // seguidas. Y lo que SÍ se limpia se limpia (FR-048).
    await montar({ cart: UNA_LINEA })

    await userEvent.click(screen.getByRole('button', { name: 'Remito' }))
    await userEvent.type(buscador(), 'colageno')

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(cart()).toHaveLength(0))

    // Conservado.
    expect(screen.getByRole('button', { name: 'Remito' }).className).toContain('bg-brand-soft')
    // Limpiado.
    expect(buscador()).toHaveValue('')
  })

  it('CUIT_REQUERIDO NO vuelve a registrar la venta', async () => {
    // FR-054. Se distingue por el CÓDIGO y no por el texto, y el reintento manda
    // UN solo `POST /sales/:id/facturar` y NINGÚN `POST /sales`.
    await montar({ cart: UNA_LINEA })

    cobroConAfipQueRechaza({
      error: 'CUIT_REQUERIDO',
      message: 'Una Factura A necesita el CUIT del comprador (11 dígitos).',
    })

    teclear('Enter', { ctrlKey: true })

    const reintentar = await screen.findByRole('button', { name: /Reintentar la facturación/ })
    expect(screen.getByText(/cargá el CUIT acá abajo/)).toBeInTheDocument()

    // Se carga el CUIT y se reintenta SOLO la facturación.
    post.mockResolvedValue({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 41 } } })
    await userEvent.type(screen.getByPlaceholderText('Opcional'), '20304050607')
    await userEvent.click(reintentar)

    await waitFor(() =>
      expect(screen.queryByText(/cargá el CUIT acá abajo/)).not.toBeInTheDocument())

    expect(postsDeVenta()).toHaveLength(1)
    expect(post.mock.calls.filter(([url]) => url === '/sales/sale_1/facturar')).toHaveLength(2)
  })

  it('un reintento que el servidor reconoce como ya registrada NO vuelve a pedir el CAE', async () => {
    // La respuesta `200 { yaRegistrada: true }` de la idempotencia del servidor
    // trae la venta con su CAE. Pedirlo de nuevo sería pedir un comprobante
    // para algo que ya lo tiene.
    await montar({ cart: UNA_LINEA })

    post.mockResolvedValue({
      data: {
        ok: true,
        yaRegistrada: true,
        data: {
          id: 'sale_1',
          total: '1500.00',
          afip_cae: '75123456789012',
          afip_nro: 41,
          afip_vto: '20260814',
          afip_type: 11,
        },
        warnings: [],
        stock: [],
      },
    })

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(cart()).toHaveLength(0))

    expect(post.mock.calls.filter(([url]) => String(url).includes('/facturar'))).toHaveLength(0)
  })
})

// ════════════════════════════════════════════
//  T1127 · Lo que se dice ANTES y no después
// ════════════════════════════════════════════

describe('Lo que no se puede hacer se dice antes de intentarlo', () => {
  it('sin ventas.crear el botón de cobrar está deshabilitado y dice por qué', async () => {
    // FR-024. Las dos mitades: `disabled` Y la explicación presente. Un botón
    // deshabilitado sin motivo es un botón roto.
    await montar({ cart: UNA_LINEA, permisos: [] })

    expect(screen.getByRole('button', { name: /Confirmar venta/ })).toBeDisabled()
    expect(screen.getByText(/No tenés el permiso «ventas.crear»/)).toBeInTheDocument()
  })

  it('sin ventas.crear, Ctrl+Enter no manda ningún pedido', async () => {
    // Escenario 2.17, y es la mitad que el `disabled` NO cubre: el atajo no pasa
    // por el botón.
    await montar({ cart: UNA_LINEA, permisos: [] })

    teclear('Enter', { ctrlKey: true })

    await new Promise((r) => setTimeout(r, 0))
    expect(post).not.toHaveBeenCalled()
  })

  it('con AFIP sin configurar los comprobantes fiscales no se pueden elegir, y se dice por qué', async () => {
    // FR-055, decisión 8 de la spec: deshabilitados con explicación, NO
    // ocultos. Un comprobante que no está no se puede pedir; uno deshabilitado
    // que dice por qué, sí. Y el aviso llega ANTES de cobrar, no después de
    // haber registrado la venta.
    await montar({
      cart: UNA_LINEA,
      settings: { ...SETTINGS, afip_cuit: '', afip_pv: '' },
    })

    const facturaC = screen.getByRole('button', { name: 'Factura C' })

    expect(facturaC).toBeInTheDocument()
    expect(facturaC).toBeDisabled()
    expect(screen.getByText(/Configurá el CUIT y el punto de venta de AFIP/)).toBeInTheDocument()

    // Y lo que queda elegido es uno que SÍ se puede emitir: nunca un
    // comprobante deshabilitado (FR-061).
    expect(screen.getByRole('button', { name: 'Remito' }).className).toContain('bg-brand-soft')
  })
})

// ════════════════════════════════════════════
//  T1128 · El segmento con el medio exacto adentro
// ════════════════════════════════════════════

/** El control de medio de pago de una línea del ticket. */
const segmentosDe = (nombre) =>
  within(screen.getByRole('group', { name: `Medio de pago de ${nombre}` }))

describe('El segmento de pago escribe un medio que existe', () => {
  it('elegir Tarjeta NO deja la línea con un medio que no existe', async () => {
    // La pantalla anterior escribía `tc3`, un código que no está en ninguna de
    // las tres listas del sistema: el historial y el archivo exportado lo
    // mostraban crudo y el panel de control lo imprimía tal cual.
    await montar({ cart: UNA_LINEA })

    await userEvent.click(segmentosDe('Colágeno 300g').getByRole('button', { name: /Tarjeta/ }))

    expect(cart()[0].method).toBe('tc3v')
    expect(MEDIOS.map((m) => m.codigo)).toContain(cart()[0].method)
  })

  it('el segmento activo muestra el medio exacto cuando no es el por defecto', async () => {
    // Sin esto, una transferencia y un pago en efectivo se ven idénticos en el
    // ticket, y el operador no tiene cómo verificar lo que está por registrar.
    await montar({ cart: UNA_LINEA })

    const segmentos = segmentosDe('Colágeno 300g')

    // El segundo clic sobre el segmento ya activo abre el medio exacto.
    await userEvent.click(segmentos.getByRole('button', { name: /Efectivo/ }))
    await userEvent.click(await segmentos.findByRole('menuitem', { name: 'Transferencia' }))

    expect(cart()[0].method).toBe('tr')
    expect(segmentos.getByRole('button', { name: /Transf\./ })).toBeInTheDocument()
    expect(segmentos.queryByRole('button', { name: /^Efectivo/ })).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1129 · El medio del ticket, heredado
// ════════════════════════════════════════════

/** El control de medio de pago del pie de cobro. */
const segmentosDelTicket = () =>
  within(screen.getByRole('group', { name: 'Medio de pago del ticket' }))

describe('Las líneas nuevas heredan el medio del ticket', () => {
  it('una línea nueva NO nace en efectivo cuando el ticket va con tarjeta', async () => {
    // Un ticket de ocho productos pagado con tarjeta exigía ocho clics en
    // «Tarjeta», y el precio de las líneas que se olvidaran quedaba mal, porque
    // cada nivel tiene otro precio (decisión 3 de la spec).
    await montar({ productos: [COLAGENO] })

    await userEvent.click(segmentosDelTicket().getByRole('button', { name: /Tarjeta/ }))
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    expect(cart()[0].method).toBe('tc3v')
    // Y el precio es el del nivel que corresponde, no el de efectivo.
    expect(cart()[0].price).toBe(cart()[0].base_card)

    // La venta también se registra con el medio del ticket y no con el de la
    // primera línea: con nueve medios, más tickets quedan mixtos y el servidor
    // cae al declarado.
    teclear('Enter', { ctrlKey: true })
    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    expect(postsDeVenta()[0][1].payment_method).toBe('tc3v')
  })

  it('cambiar el medio de una línea NO cambia el del ticket ni el de las demás', async () => {
    await montar({ productos: [COLAGENO, CREATINA] })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    await userEvent.click(screen.getByRole('button', { name: /Agregar Creatina 300g al ticket/ }))

    await userEvent.click(segmentosDe('Colágeno 300g').getByRole('button', { name: /Alianza/ }))

    expect(cart().find((l) => l.id === 10).method).toBe('al')
    expect(cart().find((l) => l.id === 11).method).toBe('ef')
    expect(segmentosDelTicket().getByRole('button', { name: /^Efectivo/ }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})

// ════════════════════════════════════════════
//  T1130 · El vuelto, solo con billetes de por medio
// ════════════════════════════════════════════

/** Cambia el medio exacto de una línea desde el popover del segmento. */
async function elegirMedioDeLinea(nombre, segmento, medio) {
  const segmentos = segmentosDe(nombre)
  await userEvent.click(segmentos.getByRole('button', { name: segmento }))
  await userEvent.click(await segmentos.findByRole('menuitem', { name: medio }))
}

describe('El vuelto aparece solo cuando hay billetes', () => {
  it('una transferencia NO muestra el bloque de vuelto', async () => {
    // La decisión 1 de la spec entera está acá: el segmento decide el PRECIO y
    // la bandera decide el VUELTO. Una transferencia cotiza como efectivo y no
    // da vuelto, y contarla como billetes es lo que rompía el arqueo de caja.
    //
    // ⚠ El cambio de medio va POR LA PANTALLA y no llenando el carrito con
    // `method: 'tr'` a mano. Comprobado con la mutación: sembrado a mano, la
    // condición vieja —`cart.some(i => i.method === 'ef')`— da lo mismo que
    // `llevaVuelto`, porque hoy `ef` es el único medio con vuelto y las dos
    // expresiones son equivalentes. Lo que este test protege es la CADENA
    // completa: que el control escriba `tr` —y no `ef`, como hacía la pantalla
    // anterior, donde una transferencia se registraba como efectivo— y que el
    // bloque desaparezca en consecuencia. La regla suelta la cubre
    // `utils/mediosDePago.test.js`, recorriendo `MEDIOS` entero.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()

    await elegirMedioDeLinea('Colágeno 300g', /^Efectivo/, 'Transferencia')

    expect(cart()[0].method).toBe('tr')
    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument())
    expect(screen.queryByText('Vuelto')).not.toBeInTheDocument()
  })

  it('el importe de «Paga con» NO reaparece con un valor viejo', async () => {
    // FR-067: se DESCARTA, no se oculta. Antes quedaba guardado y volvía con un
    // valor calculado sobre un total que ya había cambiado.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    await userEvent.type(screen.getByPlaceholderText('0'), '50000')
    expect(screen.getByPlaceholderText('0')).toHaveValue(50000)

    await elegirMedioDeLinea('Colágeno 300g', /^Efectivo/, 'Transferencia')
    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument())

    await elegirMedioDeLinea('Colágeno 300g', /^Transf\./, 'Efectivo')

    const campo = await screen.findByPlaceholderText('0')
    expect(campo).toHaveValue(null)
  })
})

// ════════════════════════════════════════════
//  T1131 · El ticket contra el stock de la sucursal activa
// ════════════════════════════════════════════

describe('El ticket no promete lo que no hay', () => {
  it('agregar de nuevo un producto con precio a mano NO le devuelve el precio de lista', async () => {
    // FR-064. Acordar $18.000 y que la segunda unidad vuelva al de lista es la
    // clase de cosa que se descubre cuando el cliente ya se fue.
    await montar({ productos: [COLAGENO] })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    // Con `fireEvent.change` y no `clear` + `type`: vaciar el campo es
    // justamente cómo se vuelve al precio de lista, así que `clear` deshace la
    // marca antes de que se escriba el precio nuevo.
    const precio = screen.getByRole('spinbutton', { name: /Precio unitario de Colágeno 300g/ })
    fireEvent.change(precio, { target: { value: '18000' } })

    expect(cart()[0].price).toBe(18000)

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    expect(cart()).toHaveLength(1)
    expect(cart()[0].qty).toBe(2)
    expect(cart()[0].price).toBe(18000)
  })

  it('pasar el disponible avisa antes de cobrar, no después del rechazo de la API', async () => {
    // FR-065. Con 5 disponibles y 6 en el ticket, el aviso está en la pantalla
    // ANTES de mandar nada: `api.post` ni siquiera se llamó.
    await montar({
      productos: [COLAGENO],
      cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 6, method: 'ef' }],
    })

    expect(screen.getByText(/hay 5 en esta sucursal y el ticket lleva 6/)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('cambiar de sucursal conserva el ticket y revalida el stock contra la nueva', async () => {
    // FR-063: el producto es el mismo, lo que cambia es de dónde sale.
    const enDos = {
      ...COLAGENO,
      stock: [
        { id: 100, punto_de_venta_id: 1, quantity: 5, available: 5 },
        { id: 200, punto_de_venta_id: 2, quantity: 1, available: 1 },
      ],
    }

    await montar({
      productos: [enDos],
      cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 3, method: 'ef' }],
    })

    // En Centro alcanza y no se avisa nada.
    expect(screen.queryByText(/y el ticket lleva 3/)).not.toBeInTheDocument()

    await act(async () => {
      useStore.getState().setPuntoDeVentaActivo({ id: 2, name: 'Depósito', code: 'deposito' })
    })

    // El ticket sigue entero, y ahora sí se avisa.
    expect(cart()).toHaveLength(1)
    expect(screen.getByText(/hay 1 en esta sucursal y el ticket lleva 3/)).toBeInTheDocument()
  })

  it('el aviso de stock no descontado NO se pierde entre los toast de éxito', async () => {
    // FR-066, decisión 7. El `<Toaster />` no está montado en este test: si el
    // aviso saliera por `toast.warning` —que es lo que hacía la pantalla
    // anterior— no habría NADA en el documento. Que el texto esté es
    // exactamente lo que prueba que va al bloque fijo del ticket.
    const aviso = 'No hay stock cargado para "Colágeno 300g" en este punto de venta: no se descontó inventario.'

    await montar({ cart: UNA_LINEA })

    post.mockResolvedValue({
      data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [aviso], stock: [] },
    })

    teclear('Enter', { ctrlKey: true })

    await waitFor(() => expect(cart()).toHaveLength(0))
    expect(screen.getByText(aviso)).toBeInTheDocument()
  })
})
