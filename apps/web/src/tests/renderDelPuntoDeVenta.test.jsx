import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useStore from '@/store/useStore'
import api from '@/services/api'
import Billing from '@/pages/Billing'
import { MEDIOS } from '@/utils/mediosDePago'
import { printInvoice } from '@/utils/printInvoice'

// ── Los dos únicos módulos doblados de este archivo, y por qué ──
//
// `printInvoice` abre una ventana del navegador y le escribe HTML. En jsdom
// `window.open` devuelve `null` y la función se va por la primera línea, así que
// **lo que se imprime no se puede leer de ningún lado**. Doblarla es la única
// forma de afirmar qué líneas terminaron en el papel — que es exactamente el
// defecto que se está cubriendo: el comprobante salía con los ítems de la
// pantalla y el total del servidor.
vi.mock('@/utils/printInvoice', () => ({ printInvoice: vi.fn() }))

// `llevaVuelto` se dobla SOLO cuando un test lo pide (`dobles.vueltoDe`), y el
// resto del archivo corre contra la función de verdad. El motivo largo está en
// el test que lo usa, en T1130: hoy `ef` es el único medio con vuelto, así que
// `llevaVuelto(c)` y `c === 'ef'` dan lo mismo para los once códigos y **ninguna
// venta sembrada por la pantalla distingue las dos expresiones**. Lo que las
// distingue es QUIÉN decide, y eso se prueba cambiando la respuesta de la
// función.
const dobles = vi.hoisted(() => ({ vueltoDe: null }))

vi.mock('@/utils/mediosDePago', async (importarOriginal) => {
  const real = await importarOriginal()

  return {
    ...real,
    llevaVuelto: (codigo) => (dobles.vueltoDe ? dobles.vueltoDe(codigo) : real.llevaVuelto(codigo)),
  }
})

// ════════════════════════════════════════════
//  FAVALIO · Punto de venta, renderizado
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
  // Clientes es un módulo que todavía no se libera: el buscador de fichas solo
  // se dibuja para un superadmin, y por eso hay que poder montar de las dos
  // formas.
  superadmin = false,
} = {}) {
  useStore.setState({
    products: productos,
    brands: [],
    sucursales: [CENTRO],
    permisos,
    settings,
    usuario: { id: 1, es_superadmin: superadmin },
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

/** El panel de emisión, cuando está abierto. */
const panelDeEmision = () => document.querySelector('[data-slot="sheet-content"]')

/**
 * El circuito completo del cobro con el teclado.
 *
 * Con un comprobante FISCAL son dos disparos y no uno: el primero abre el panel
 * de emisión —donde se ven los datos que ese comprobante pide y el IVA producto
 * por producto— y el segundo emite. Pedir un CAE consume un número correlativo
 * de ARCA que no se devuelve, así que el paso intermedio es la funcionalidad,
 * no un accidente del render.
 *
 * Con un comprobante INTERNO no abre nada y alcanza con el primero: un remito
 * no habla con ARCA.
 */
function cobrarConAtajo() {
  teclear('Enter', { ctrlKey: true })
  if (panelDeEmision()) teclear('Enter', { ctrlKey: true })
}

/**
 * Abre el panel de emisión desde el pie de cobro, como lo hace el operador.
 *
 * Devuelve el `within` del panel: casi todo lo que había en el pie —el CUIT, la
 * condición frente al IVA, el nombre del comprobante— vive ahí adentro, y el
 * ticket de atrás sigue montado, así que buscar por `screen` encuentra dos.
 */
async function abrirPanelDeEmision() {
  await userEvent.click(screen.getByRole('button', { name: /Cobrar y emitir/ }))
  return within(panelDeEmision())
}

/**
 * Pasa el ticket a un comprobante interno, que no habla con ARCA.
 *
 * Es idempotente a propósito: el comprobante se CONSERVA entre una venta y la
 * siguiente (FR-049), así que la segunda vez el botón ya está elegido y otro
 * clic abriría su submenú en vez de no hacer nada.
 */
async function elegirSinFactura() {
  const boton = screen.getByRole('button', { name: /Sin factura/ })
  if (boton.getAttribute('aria-pressed') === 'true') return
  await userEvent.click(boton)
}

/**
 * Abre el panel con un comprobante interno ya elegido.
 *
 * Con «sin factura» el botón grande cobra derecho —un remito no consume
 * numeración de ARCA—, así que la puerta al panel es el submenú del propio
 * botón: es donde se carga el nombre que se imprime en el remito.
 */
async function abrirDatosDelComprobanteInterno() {
  await elegirSinFactura()
  await userEvent.click(screen.getByRole('button', { name: /Sin factura/ }))

  await userEvent.click(await screen.findByRole('menuitem', { name: /Datos del comprador/ }))
  return within(panelDeEmision())
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
  printInvoice.mockClear()
  dobles.vueltoDe = null
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

    cobrarConAtajo()

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
  })

  it('con el ticket vacío, Ctrl+Enter no manda ningún pedido', async () => {
    // Escenario 2.9.
    await montar({ cart: [] })

    cobrarConAtajo()

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

    cobrarConAtajo()

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

    cobrarConAtajo()

    // El panel se lleva el foco al abrirse —es un diálogo—, así que primero se
    // lo deja terminar y recién después se pone el cursor donde lo pondría el
    // operador. Lo que se afirma es lo de DESPUÉS: que una respuesta que llega
    // no se lo lleve de ahí.
    await act(async () => { await Promise.resolve() })

    // El campo de CUIT vive en el panel de emisión, y sigue EDITABLE durante el
    // cobro: es lo que hace posible corregirlo ante un CUIT_REQUERIDO, con la
    // venta ya registrada. Un campo que se deshabilita pierde el foco.
    const cuit = within(panelDeEmision()).getByPlaceholderText('Sin dato: Consumidor final')
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

    await userEvent.click(screen.getByRole('button', { name: 'Vaciar ticket' }))

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

  it('Esc con el panel abierto cierra el panel y NO toca el ticket', async () => {
    // FR-036 se mudó con el campo. El CUIT ya no está en el pie: está en el
    // panel de emisión, que es un diálogo, y ahí `Esc` significa «cerrá esto».
    //
    // Lo que NO puede pasar sigue siendo lo mismo, y es lo que este test
    // sostiene: con la búsqueda vacía —que es el estado normal— la misma tecla
    // NO puede además abrir la confirmación de vaciar el ticket. Cerrar un panel
    // no tira la venta que se está por cobrar.
    await montar({ cart: UNA_LINEA })

    const panel = await abrirPanelDeEmision()
    const cuit = panel.getByPlaceholderText('Sin dato: Consumidor final')

    await userEvent.type(cuit, '20304050607')
    expect(cuit).toHaveValue(20304050607)

    teclear('Escape')

    await waitFor(() => expect(panelDeEmision()).toBeNull())
    expect(screen.queryByText(/Vaciar el ticket/)).not.toBeInTheDocument()
    expect(cart()).toHaveLength(1)
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
    // Y el total sí está: lo que no se nombra es el IVA.
    expect(screen.getByText('Total a cobrar')).toBeInTheDocument()
  })

  it('un responsable inscripto con Factura B SÍ ve el desglose', async () => {
    // La otra mitad del mismo criterio: sin esto, «no se dibuja nada» pasaría
    // igual con el desglose roto para todos.
    await montar({
      cart: [{ id: 10, name: 'Colágeno 300g', price: 1210, qty: 1, method: 'ef' }],
      settings: { ...SETTINGS, tax_condition: 'RI' },
    })

    // El pie NOMBRA el IVA —«IVA 21% incluido · 1 u.»— y los importes del
    // desglose viven en el panel de emisión, que es donde se mira lo que se va
    // a mandar a ARCA producto por producto.
    expect(screen.getByText(/IVA 21% incluido/)).toBeInTheDocument()

    const panel = await abrirPanelDeEmision()
    const neto = panel.getByText('Neto gravado').closest('div')

    expect(within(neto).getByText('$1.000,00')).toBeInTheDocument()
    expect(panel.getByText('IVA 21% incluido')).toBeInTheDocument()
  })

  it('el ticket vacío nombra el atajo dentro de un <kbd>', async () => {
    // Un atajo que no está escrito en ningún lado no lo usa nadie (FR-015).
    await montar({ cart: [] })

    const linea = screen.getByText(/Buscá un producto y presioná/)
    const tecla = linea.querySelector('kbd')

    expect(tecla).not.toBeNull()
    expect(tecla).toHaveTextContent('Enter')
  })

  it('el comprobante se elige con botones, y NO con un <select>', async () => {
    // FR-019: controles que se leen sin abrirlos. Acá se emite el mismo
    // comprobante cincuenta veces seguidas.
    //
    // En el pie la pregunta es la que importa —«¿lleva factura o no?»— con su
    // consecuencia escrita al lado; CUÁL de los cinco comprobantes exactos se
    // termina de elegir en el panel, con el detalle a la vista.
    await montar({ cart: UNA_LINEA })

    expect(screen.getByRole('button', { name: /Con factura/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sin factura/ })).toBeInTheDocument()

    const panel = await abrirPanelDeEmision()

    expect(panel.getByRole('button', { name: /^Factura C/ })).toBeInTheDocument()
    expect(panel.getByRole('button', { name: /^Remito/ })).toBeInTheDocument()
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

    // El primer disparo abre el panel de emisión; los dos que importan son los
    // que salen DE AHÍ, en la misma tanda y sin render en el medio.
    teclear('Enter', { ctrlKey: true })

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

    const panel = await abrirPanelDeEmision()
    const boton = panel.getByRole('button', { name: /Emitir Factura C/ })

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
      cobrarConAtajo()

      // Se dejan correr las microtareas para que `/sales` resuelva y la pantalla
      // pase a esperar el CAE.
      await act(async () => { await Promise.resolve(); await Promise.resolve() })

      // Todavía NO: el aviso desde el primer instante no significa nada.
      expect(screen.queryByText(/ARCA está tardando/)).not.toBeInTheDocument()
      // Los dos botones lo dicen —el del panel y el del pie que quedó atrás—,
      // así que se piden los dos y se mira que estén deshabilitados.
      screen.getAllByRole('button', { name: /Pidiendo el CAE a ARCA/ })
        .forEach((boton) => expect(boton).toBeDisabled())

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

    cobrarConAtajo()
    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))

    // El ticket quedó detrás del panel de emisión, que lo marca `aria-hidden`
    // mientras está abierto: por eso las consultas piden `hidden`. Lo que se
    // afirma es que los controles están deshabilitados, no que se vean.
    const mas = screen.getByRole('button', { name: /Agregar una unidad de Colágeno 300g/, hidden: true })
    const precio = screen.getByRole('spinbutton', { name: /Precio unitario de Colágeno 300g/, hidden: true })
    const medio = within(screen.getByRole('group', { name: 'Medio de pago del ticket', hidden: true }))
      .getByRole('button', { name: /Débito/, hidden: true })

    expect(mas).toBeDisabled()
    expect(precio).toBeDisabled()
    expect(medio).toBeDisabled()

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

    cobrarConAtajo()
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

    cobrarConAtajo()

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

    cobrarConAtajo()

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

    cobrarConAtajo()

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))

    expect(cart()).toHaveLength(1)
  })

  it('el tipo de comprobante NO se resetea después de cada venta', async () => {
    // FR-049: en un mostrador se emite el mismo comprobante cincuenta veces
    // seguidas. Y lo que SÍ se limpia se limpia (FR-048).
    await montar({ cart: UNA_LINEA })

    await elegirSinFactura()
    await userEvent.type(buscador(), 'colageno')

    cobrarConAtajo()

    await waitFor(() => expect(cart()).toHaveLength(0))

    // Conservado: sigue en «sin factura», y con el Remito adentro.
    expect(screen.getByRole('button', { name: /Sin factura/ }))
      .toHaveAttribute('aria-pressed', 'true')
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

    cobrarConAtajo()

    // El panel NO se cierra: la venta ya está registrada y lo único que falta
    // es el comprobante, así que el motivo de ARCA y el campo que hay que
    // corregir quedan juntos.
    const panel = within(await waitFor(() => {
      const caja = panelDeEmision()
      expect(caja).not.toBeNull()
      return caja
    }))

    await panel.findByText(/cargá el CUIT en el panel de emisión/)

    // Se carga el CUIT y se reintenta SOLO la facturación.
    post.mockResolvedValue({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 41 } } })
    await userEvent.type(panel.getByPlaceholderText('Sin dato: Consumidor final'), '20304050607')
    await userEvent.click(panel.getByRole('button', { name: /Reintentar Factura C/ }))

    await waitFor(() =>
      expect(screen.queryByText(/cargá el CUIT en el panel de emisión/)).not.toBeInTheDocument())

    expect(postsDeVenta()).toHaveLength(1)
    expect(post.mock.calls.filter(([url]) => url === '/sales/sale_1/facturar')).toHaveLength(2)
  })

  it('un reintento que el servidor reconoce como ya registrada NO vuelve a pedir el CAE', async () => {
    // La respuesta `200 { yaRegistrada: true }` de la idempotencia del servidor
    // trae la venta con su CAE. Pedirlo de nuevo sería pedir un comprobante
    // para algo que ya lo tiene.
    //
    // ⚠ La respuesta trae también `items`, y no es decoración: es el MISMO
    // ticket, así que la comparación da coincidencia y esto sigue siendo un
    // éxito normal y silencioso. Ver la sección T1132.
    await montar({ cart: UNA_LINEA })

    post.mockResolvedValue({
      data: {
        ok: true,
        yaRegistrada: true,
        data: {
          id: 'sale_1',
          total: '1500.00',
          items: [ITEM_REGISTRADO(1)],
          afip_cae: '75123456789012',
          afip_nro: 41,
          afip_vto: '20260814',
          afip_type: 11,
        },
        warnings: [],
        stock: [],
      },
    })

    cobrarConAtajo()

    await waitFor(() => expect(cart()).toHaveLength(0))

    expect(post.mock.calls.filter(([url]) => String(url).includes('/facturar'))).toHaveLength(0)
  })
})

// ════════════════════════════════════════════
//  T1132 · El reintento que trae OTRA venta
//
//  `POST /api/sales` es idempotente por `id` y el id es uno por TICKET
//  (FR-043). El caso que rompe datos no es el reintento —para eso se construyó
//  la idempotencia— sino el reintento del ticket MODIFICADO:
//
//   1. Ticket con 1 unidad. Se cobra. La red se corta DESPUÉS del commit.
//   2. Sale el `catch`, `toast.error`, y el ticket queda entero (FR-053). El
//      operador lee «Error» y entiende que no se registró nada.
//   3. El cliente dice «poneme dos». Sube la cantidad y vuelve a cobrar.
//   4. Mismo id → el servidor responde la venta VIEJA: 1 unidad, $1.500.
//
//  Antes, la pantalla lo trataba como éxito: vaciaba el ticket, ofrecía imprimir
//  y armaba el comprobante con los ítems de la PANTALLA (2 unidades) y el total
//  del SERVIDOR ($1.500). Se entregaban 2, se registró y se descontó 1, y el
//  papel no cerraba consigo mismo.
// ════════════════════════════════════════════

/** Una línea tal como la devuelve el servidor: `quantity` y `unit_price`. */
const ITEM_REGISTRADO = (cantidad, nombre = 'Colágeno 300g') => ({
  product_id: 10,
  product_name: nombre,
  quantity: cantidad,
  unit_price: '1500.00',
})

/** `POST /sales` responde «ya registrada» con las líneas que se le digan. */
function reintentoYaRegistrado(items, total) {
  post.mockImplementation((url) => (
    url === '/sales'
      ? Promise.resolve({
          data: {
            ok: true,
            yaRegistrada: true,
            data: { id: 'sale_1', total, items, afip_cae: '75123456789012', afip_nro: 40, afip_type: 11 },
            warnings: [],
            stock: [],
          },
        })
      : Promise.resolve({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 40 } } })
  ))
}

describe('Un «ya registrada» que no coincide no se da por cobrado', () => {
  it('el ticket al que le subieron la cantidad NO se da por cobrado en silencio', async () => {
    // El operador tiene que ver qué quedó registrado de verdad y qué no.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 2, method: 'ef' }] })

    reintentoYaRegistrado([ITEM_REGISTRADO(1)], '1500.00')

    cobrarConAtajo()

    expect(await screen.findByText(/se registraron 1 y el ticket lleva 2/)).toBeInTheDocument()
    expect(screen.getByText(/El total registrado es \$1\.500,00 y el del ticket \$3\.000,00/))
      .toBeInTheDocument()

    // Y el ticket NO se vacía: nada de lo que hay en pantalla quedó registrado
    // como tal. Vaciarlo tiraría la evidencia de lo que se estaba por cobrar y
    // además renovaría el id, con lo que el intento siguiente registraría las
    // DOS unidades sobre la que ya se descontó.
    expect(cart()).toHaveLength(1)
    expect(cart()[0].qty).toBe(2)
  })

  it('no se pide el CAE ni se ofrece imprimir un comprobante que no cierra', async () => {
    // Un comprobante fiscal por $1.500 mientras la pantalla dice $3.000 es
    // justamente el papel que no cierra consigo mismo.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 2, method: 'ef' }] })

    reintentoYaRegistrado([ITEM_REGISTRADO(1)], '1500.00')

    cobrarConAtajo()

    await screen.findByText(/se registraron 1 y el ticket lleva 2/)

    expect(post.mock.calls.filter(([url]) => String(url).includes('/facturar'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Imprimir el comprobante/ })).not.toBeInTheDocument()
  })

  it('el mismo ticket sin tocar sigue siendo un éxito silencioso', async () => {
    // La otra mitad, y es igual de importante: éste es el caso para el que se
    // construyó la idempotencia. Una comparación que rechaza los reintentos
    // legítimos deja al operador sin poder cobrar después de cada corte de red.
    await montar({ cart: UNA_LINEA })

    reintentoYaRegistrado([ITEM_REGISTRADO(1)], '1500.00')

    cobrarConAtajo()

    await waitFor(() => expect(cart()).toHaveLength(0))
    expect(screen.queryByText(/YA estaba registrada/)).not.toBeInTheDocument()
  })

  it('el comprobante impreso lleva las líneas del SERVIDOR, no las de la pantalla', async () => {
    // Mezclar las dos fuentes es lo que producía el ticket que no cierra. Acá
    // el producto se renombró en el catálogo después de la venta: lo que se
    // imprime tiene que ser lo que quedó asentado, con `quantity`/`unit_price`
    // —la forma del servidor— y no `qty`/`price`, la del carrito.
    await montar({ cart: UNA_LINEA })

    reintentoYaRegistrado([ITEM_REGISTRADO(1, 'Colágeno 300g · envase nuevo')], '1500.00')

    cobrarConAtajo()

    await userEvent.click(await screen.findByRole('button', { name: /Imprimir el comprobante/ }))

    const impreso = printInvoice.mock.calls[0][0]

    expect(impreso.items).toEqual([ITEM_REGISTRADO(1, 'Colágeno 300g · envase nuevo')])
    expect(impreso.items[0].qty).toBeUndefined()
  })
})

// ════════════════════════════════════════════
//  T1133 · El comprobante de la venta anterior no sobrevive a la siguiente
// ════════════════════════════════════════════

describe('Ningún final del cobro deja a la vista el comprobante de otra venta', () => {
  it('después de un rechazo de AFIP NO se ofrece imprimir el comprobante anterior', async () => {
    // Quedaban uno al lado del otro el aviso rojo «la venta quedó REGISTRADA
    // pero sin comprobante» y el botón verde «Imprimir el comprobante 40», que
    // es de OTRO cliente — justo cuando el operador está resolviendo un
    // problema y busca algo para darle al que tiene enfrente. Un comprobante
    // fiscal ajeno entregado no se deshace sin una nota de crédito.
    await montar({ cart: UNA_LINEA, productos: [COLAGENO] })

    // Venta 1: sale bien y deja su comprobante nº 40.
    post.mockImplementation((url) => (
      url === '/sales'
        ? Promise.resolve({
            data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [], stock: [] },
          })
        : Promise.resolve({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 40 } } })
    ))

    cobrarConAtajo()
    expect(await screen.findByRole('button', { name: /Imprimir el comprobante 40/ })).toBeInTheDocument()

    // Venta 2: ticket nuevo, la venta se registra y ARCA la rechaza.
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    cobroConAfipQueRechaza({ error: 'El CAE no pudo emitirse: 10016 comprobante ya registrado' })

    cobrarConAtajo()

    await screen.findByText(/quedó REGISTRADA pero sin comprobante/)
    expect(cart()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Imprimir el comprobante/ })).not.toBeInTheDocument()
  })

  it('después de un rechazo de la API tampoco, aunque el ticket quede cargado', async () => {
    // El otro final. El ticket queda intacto (FR-053) y el botón está oculto por
    // eso, pero el comprobante viejo tampoco puede seguir en memoria esperando
    // a que el ticket se vacíe.
    await montar({ cart: UNA_LINEA, productos: [COLAGENO] })

    post.mockImplementation((url) => (
      url === '/sales'
        ? Promise.resolve({
            data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [], stock: [] },
          })
        : Promise.resolve({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 40 } } })
    ))

    cobrarConAtajo()
    await screen.findByRole('button', { name: /Imprimir el comprobante 40/ })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    post.mockRejectedValue(rechazo(400, {
      error: 'Stock insuficiente para "Colágeno 300g": disponible 0, requerido 1',
    }))

    cobrarConAtajo()

    await waitFor(() => expect(postsDeVenta()).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))
    expect(cart()).toHaveLength(1)

    // Se vacía el ticket a mano: el botón de imprimir vuelve a ser visible si
    // hubiera algo que imprimir, y no lo hay.
    await act(async () => { useStore.getState().clearCart() })

    expect(screen.queryByRole('button', { name: /Imprimir el comprobante/ })).not.toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: /Cobrar y emitir/ })).toBeDisabled()
    expect(screen.getByText(/No tenés el permiso «ventas.crear»/)).toBeInTheDocument()
  })

  it('sin ventas.crear, Ctrl+Enter no manda ningún pedido', async () => {
    // Escenario 2.17, y es la mitad que el `disabled` NO cubre: el atajo no pasa
    // por el botón.
    await montar({ cart: UNA_LINEA, permisos: [] })

    cobrarConAtajo()

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

    const conFactura = screen.getByRole('button', { name: /Con factura/ })

    expect(conFactura).toBeInTheDocument()
    expect(conFactura).toBeDisabled()
    expect(screen.getByText(/Configurá el CUIT y el punto de venta de AFIP/)).toBeInTheDocument()

    // Y lo que queda elegido es uno que SÍ se puede emitir: nunca un
    // comprobante deshabilitado (FR-061).
    expect(screen.getByRole('button', { name: /Sin factura/ }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})

// ════════════════════════════════════════════
//  T1128 · El medio de pago, elegido UNA vez
// ════════════════════════════════════════════

/** El control de medio de pago del pie de cobro, que es el único que hay. */
const medioDelTicket = () =>
  within(screen.getByRole('group', { name: 'Medio de pago del ticket' }))

/** Elige un medio que no entra en el pie, desde «Otros N». */
async function elegirMedioEscondido(etiqueta) {
  const control = medioDelTicket()
  await userEvent.click(control.getByRole('button', { name: /Otros \d/ }))
  await userEvent.click(await control.findByRole('menuitem', { name: etiqueta }))
}

describe('El medio de pago se elige una vez, y escribe un código que existe', () => {
  it('elegir Débito NO deja la línea con un medio que no existe', async () => {
    // La pantalla anterior escribía `tc3`, un código que no está en ninguna de
    // las tres listas del sistema: el historial y el archivo exportado lo
    // mostraban crudo y el panel de control lo imprimía tal cual.
    await montar({ cart: UNA_LINEA })

    await userEvent.click(medioDelTicket().getByRole('button', { name: /Débito/ }))

    expect(cart()[0].method).toBe('td')
    expect(MEDIOS.map((m) => m.codigo)).toContain(cart()[0].method)
  })

  it('los medios que no entran en el pie se llegan agrupados por su lista', async () => {
    // «¿Por qué una transferencia cobra el precio de efectivo?» era la pregunta
    // que el control anterior no contestaba nunca: los medios estaban escondidos
    // adentro del segmento y con qué lista cotizaba cada uno había que saberlo
    // de memoria. Acá el encabezado del grupo lo dice.
    await montar({ cart: UNA_LINEA })

    const control = medioDelTicket()
    await userEvent.click(control.getByRole('button', { name: /Otros 5/ }))

    expect(await control.findByText('Cotizan con Efectivo')).toBeInTheDocument()
    expect(control.getByText('Cotizan con Tarjeta')).toBeInTheDocument()
    expect(control.getByRole('menuitem', { name: 'Créd. 1 pago' })).toBeInTheDocument()

    await userEvent.click(control.getByRole('menuitem', { name: 'Visa 3c' }))

    expect(cart()[0].method).toBe('tc3v')
    // Y el elegido pasa a estar A LA VISTA, aunque no sea uno de los cuatro
    // destacados: un ticket cobrado con Visa no puede mostrar «Efectivo»
    // resaltado y el medio verdadero escondido atrás de un desplegable.
    expect(medioDelTicket().getByRole('button', { name: /Visa/ }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})

// ════════════════════════════════════════════
//  T1129 · El medio vale para el ticket entero
// ════════════════════════════════════════════

describe('El medio del pie es el del ticket entero', () => {
  it('una línea nueva NO nace en efectivo cuando el ticket va con tarjeta', async () => {
    // Un ticket de ocho productos pagado con tarjeta exigía ocho clics, y el
    // precio de las líneas que se olvidaran quedaba mal, porque cada nivel tiene
    // otro precio (decisión 3 de la spec).
    await montar({ productos: [COLAGENO] })

    await elegirMedioEscondido('Visa 3c')
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    expect(cart()[0].method).toBe('tc3v')
    // Y el precio es el del nivel que corresponde, no el de efectivo.
    expect(cart()[0].price).toBe(cart()[0].base_card)

    // La venta también se registra con el medio del ticket y no con el de la
    // primera línea: con nueve medios, más tickets quedan mixtos y el servidor
    // cae al declarado.
    cobrarConAtajo()
    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    expect(postsDeVenta()[0][1].payment_method).toBe('tc3v')
  })

  it('cambiar el medio REPRECIA las líneas que ya estaban', async () => {
    // El defecto que el rediseño cierra. El control del pie solo alcanzaba a las
    // líneas NUEVAS: con ocho productos ya cargados, pasar a tarjeta las dejaba
    // a las ocho cotizando al precio de efectivo. Y no lo veía nadie, porque el
    // total tampoco decía con qué lista estaba calculado.
    await montar({ productos: [COLAGENO, CREATINA] })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    await userEvent.click(screen.getByRole('button', { name: /Agregar Creatina 300g al ticket/ }))

    await elegirMedioEscondido('Alianza')

    for (const linea of cart()) {
      expect(linea.method).toBe('al')
      expect(linea.price).toBe(linea.base_alliance)
    }
  })

  it('un precio puesto a mano NO vuelve al de lista por cambiar el medio', async () => {
    // Se acordó un precio con el cliente y tocar «Alianza» no puede deshacerlo
    // sin avisar. Para volver al de lista está la franja ámbar de la línea.
    await montar({ productos: [COLAGENO] })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    fireEvent.change(
      screen.getByRole('spinbutton', { name: /Precio unitario de Colágeno 300g/ }),
      { target: { value: '18000' } }
    )

    await elegirMedioEscondido('Alianza')

    expect(cart()[0].method).toBe('al')
    expect(cart()[0].price).toBe(18000)
  })

  it('la excepción se ve, y dice cuánto sería de lista', async () => {
    // «a mano» a secas no decía de cuánto se venía, y sin el precio de lista al
    // lado nadie puede juzgar si el precio negociado está bien.
    await montar({ productos: [COLAGENO] })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    const deLista = cart()[0].price

    fireEvent.change(
      screen.getByRole('spinbutton', { name: /Precio unitario de Colágeno 300g/ }),
      { target: { value: '18000' } }
    )

    expect(screen.getByText(/Precio puesto a mano/).textContent)
      .toContain(deLista.toLocaleString('es-AR', { maximumFractionDigits: 0 }))

    await userEvent.click(screen.getByRole('button', { name: 'volver al de lista' }))

    expect(cart()[0].precio_manual).toBe(false)
    expect(cart()[0].price).toBe(deLista)
  })
})

// ════════════════════════════════════════════
//  T1130 · El vuelto, solo con billetes de por medio
// ════════════════════════════════════════════

describe('El vuelto aparece solo cuando hay billetes', () => {
  it('una transferencia NO muestra el bloque de vuelto', async () => {
    // La decisión 1 de la spec entera está acá: el medio decide con qué LISTA
    // cotiza y la bandera decide el VUELTO. Una transferencia cotiza como
    // efectivo y no da vuelto, y contarla como billetes es lo que rompía el
    // arqueo de caja.
    //
    // Lo que este test protege es la CADENA completa: que el control escriba
    // `tr` —y no `ef`, como hacía la pantalla anterior, donde una transferencia
    // se registraba como efectivo— y que el bloque desaparezca en consecuencia.
    //
    // ⚠ Lo que este test NO prueba: que la pantalla use `llevaVuelto` y no
    // `i.method === 'ef'`. Hoy `ef` es el único medio con `vuelto: true`, así que
    // las dos expresiones son indistinguibles por datos. El que las separa está
    // en T1134, y para eso dobla `llevaVuelto`.
    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' }] })

    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()

    await userEvent.click(medioDelTicket().getByRole('button', { name: /Transf\./ }))

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

    await userEvent.click(medioDelTicket().getByRole('button', { name: /Transf\./ }))
    await waitFor(() => expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument())

    await userEvent.click(medioDelTicket().getByRole('button', { name: /Efectivo/ }))

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

    cobrarConAtajo()

    await waitFor(() => expect(cart()).toHaveLength(0))
    expect(screen.getByText(aviso)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1134 · Los diez criterios que estaban bien y no tenían quién los cuidara
//
//  `sdd-verify` los revirtió uno por uno y las 26 suites se quedaron en verde.
//  Cada test de esta sección lleva escrita, en su comentario, **la mutación
//  exacta** con la que se comprobó que sirve: revertirla tiene que ponerlo en
//  rojo, y si algún día deja de hacerlo el test dejó de valer.
// ════════════════════════════════════════════

describe('Un comprobante interno no habla con ARCA', () => {
  it('con Remito sale UN solo pedido y no se pide ningún CAE', async () => {
    // Escenario 4.5. Mutación: `const isAfip = true` en `Billing.jsx`. Con eso,
    // un Remito cae en `vType = 11` y emite una **Factura C real ante ARCA**,
    // con número correlativo consumido. Es el más grave de los diez: lo que se
    // pierde no es una pantalla, es un comprobante fiscal que ya no se puede
    // devolver sin una nota de crédito.
    await montar({ cart: UNA_LINEA })

    await elegirSinFactura()

    cobrarConAtajo()

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))

    // Y ni siquiera abrió el panel: un remito no consume numeración de ARCA, y
    // agregarle un paso al camino rápido es cobrarle a las cuarenta ventas del
    // día el cuidado que necesitan las diez fiscales.
    expect(panelDeEmision()).toBeNull()
    expect(post.mock.calls.filter(([url]) => String(url).includes('/facturar'))).toHaveLength(0)
    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('Lo que se limpia al terminar una venta se limpia de verdad', () => {
  it('el CUIT del comprador NO se hereda a la venta siguiente', async () => {
    // FR-048. Mutación: borrar `setCustomerDoc('')`, `setCustomerName('')` y
    // `clearCustomer()` de `limpiarDespuesDeCobrar`. El CUIT del cliente
    // anterior en la factura del siguiente es un comprobante mal declarado, y
    // deshacerlo exige una nota de crédito.
    await montar({ cart: UNA_LINEA, productos: [COLAGENO] })

    const panel = await abrirPanelDeEmision()
    const cuit = panel.getByLabelText(/CUIT \/ DNI/)

    await userEvent.type(cuit, '20304050607')
    expect(cuit).toHaveValue(20304050607)

    await userEvent.click(panel.getByRole('button', { name: /Emitir Factura C/ }))
    await waitFor(() => expect(cart()).toHaveLength(0))

    // Ticket nuevo: el panel vuelve a abrirse en blanco.
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    const siguiente = await abrirPanelDeEmision()

    expect(siguiente.getByLabelText(/CUIT \/ DNI/)).toHaveValue(null)
  })

  it('el nombre del cliente tampoco', async () => {
    // La otra mitad: con un comprobante interno el campo es el nombre libre, y
    // es lo que se imprime en el remito del cliente que viene después.
    await montar({ cart: UNA_LINEA, productos: [COLAGENO] })

    const panel = await abrirDatosDelComprobanteInterno()
    await userEvent.type(panel.getByPlaceholderText('Consumidor final'), 'Pérez')

    await userEvent.click(panel.getByRole('button', { name: /Emitir Remito/ }))
    await waitFor(() => expect(cart()).toHaveLength(0))

    expect(postsDeVenta()[0][1].customer_name).toBe('Pérez')

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    const siguiente = await abrirDatosDelComprobanteInterno()

    expect(siguiente.getByPlaceholderText('Consumidor final')).toHaveValue('')
  })

  it('la FICHA de cliente tampoco: la venta siguiente no va a su cuenta corriente', async () => {
    // La mitad que los dos anteriores NO cubren, y es la más cara: `customer_id`
    // es lo único que habilita cuenta corriente (`sales.js`). Heredado, la
    // venta del cliente siguiente queda como deuda del anterior.
    get.mockImplementation((url) => (
      String(url).includes('/customers')
        ? Promise.resolve({ data: { ok: true, data: [{ id: 7, name: 'Pérez', tax_id: '20304050607' }] } })
        : Promise.resolve({ data: { ok: true, data: [] } })
    ))

    await montar({ cart: UNA_LINEA, productos: [COLAGENO], superadmin: true })

    const panel = await abrirDatosDelComprobanteInterno()
    await userEvent.type(panel.getByPlaceholderText('Buscar ficha de cliente…'), 'Pér')
    await userEvent.click(await panel.findByRole('button', { name: /Pérez/ }))

    await userEvent.click(panel.getByRole('button', { name: /Emitir Remito/ }))
    await waitFor(() => expect(cart()).toHaveLength(0))

    expect(postsDeVenta()[0][1].customer_id).toBe(7)

    // Ticket nuevo, otro cliente: sin ficha.
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    cobrarConAtajo()

    await waitFor(() => expect(postsDeVenta()).toHaveLength(2))
    expect(postsDeVenta()[1][1].customer_id).toBeUndefined()
  })
})

describe('Cada comprobante pide los datos que usa, y lo dice', () => {
  it('un Remito no manda CUIT ni condición: los dos campos quedan inertes', async () => {
    // FR-023. El defecto que esto cierra es que el operador cargue el CUIT en un
    // comprobante que no lo manda —o el nombre en uno que no lo imprime— y el
    // dato se pierda sin que nada falle. Deshabilitados y no ausentes: un campo
    // que desaparece deja al operador preguntándose si lo escribió mal.
    await montar({ cart: UNA_LINEA })

    // El inicial de un monotributista es Factura C: comprobante fiscal.
    const panel = await abrirPanelDeEmision()

    expect(panel.getByLabelText(/CUIT \/ DNI/)).toBeEnabled()
    expect(panel.getByLabelText('Condición frente al IVA')).toBeEnabled()

    await userEvent.click(panel.getByRole('button', { name: /^Remito/ }))

    expect(panel.getByLabelText(/CUIT \/ DNI/)).toBeDisabled()
    expect(panel.getByLabelText('Condición frente al IVA')).toBeDisabled()
    // El nombre sirve para los cinco: es lo que se imprime.
    expect(panel.getByPlaceholderText('Consumidor final')).toBeEnabled()
    expect(panel.getByText(/no viajan a ARCA y no discriminan IVA/)).toBeInTheDocument()
  })

  it('una Factura A exige el CUIT ANTES de registrar la venta', async () => {
    // El servidor lo rechaza con `CUIT_REQUERIDO`, pero recién DESPUÉS de que la
    // venta quedó asentada: la operación existe, el cliente está enfrente y lo
    // que falta es un dato. Decirlo acá cuesta un renglón.
    await montar({ cart: UNA_LINEA, settings: { ...SETTINGS, tax_condition: 'RI' } })

    const panel = await abrirPanelDeEmision()
    await userEvent.click(panel.getByRole('button', { name: /^Factura A/ }))

    expect(panel.getByText(/necesita el CUIT del comprador/)).toBeInTheDocument()
    expect(panel.getByRole('button', { name: /Emitir Factura A/ })).toBeDisabled()
    // Y la condición queda fija: ARCA no acepta una Factura A a consumidor final.
    expect(panel.getByLabelText('Condición frente al IVA')).toBeDisabled()

    await userEvent.type(panel.getByPlaceholderText('11 dígitos'), '20304050607')

    expect(panel.getByRole('button', { name: /Emitir Factura A/ })).toBeEnabled()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('El catálogo no deja agregar lo que no hay', () => {
  it('el producto agotado tiene el botón de agregar DESHABILITADO', async () => {
    // FR-010. Mutación: quitar `disabled` del botón de `CatalogoDelPos.jsx`.
    // Prometerle al cliente un producto que no está es lo que ese `disabled`
    // evita; el atajo ya tiene su propio test (escenario 2.6).
    await montar({ productos: [COLAGENO, SIN_STOCK] })

    expect(screen.getByRole('button', { name: /Agregar Barrita 30g al ticket/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ })).toBeEnabled()
  })
})

describe('El comprobante para imprimir vive hasta que empieza el ticket siguiente', () => {
  it('desaparece con la PRIMERA línea del ticket nuevo', async () => {
    // FR-050. Mutación: sacar `lineas.length === 0` de la condición del botón
    // en `TicketDelPos.jsx`. Sin esa mitad, el botón de imprimir la venta
    // anterior convive con el ticket que se está armando, arriba de las líneas
    // y a un clic de distancia: se entrega el comprobante de otro.
    await montar({ cart: UNA_LINEA, productos: [COLAGENO] })

    post.mockImplementation((url) => (
      url === '/sales'
        ? Promise.resolve({
            data: { ok: true, data: { id: 'sale_1', total: '1500.00' }, warnings: [], stock: [] },
          })
        : Promise.resolve({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 40 } } })
    ))

    cobrarConAtajo()
    await screen.findByRole('button', { name: /Imprimir el comprobante 40/ })

    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))

    expect(screen.queryByRole('button', { name: /Imprimir el comprobante/ })).not.toBeInTheDocument()
  })
})

describe('Los atajos están escritos donde se usan', () => {
  it('el de cobrar va ADENTRO del botón que dispara, en un <kbd>', async () => {
    // FR-041. Mutación: borrar el `<kbd>` del botón en `TicketDelPos.jsx`. Un
    // atajo que no está escrito en ningún lado no lo usa nadie, y entonces el
    // hito entero —cobrar sin soltar el lector de código de barras— no pasa de
    // ser una función que existe.
    await montar({ cart: UNA_LINEA })

    const boton = screen.getByRole('button', { name: /Cobrar y emitir/ })
    const tecla = boton.querySelector('kbd')

    expect(tecla).not.toBeNull()
    expect(tecla).toHaveTextContent('Ctrl+Enter')
  })
})

describe('El encabezado del ticket dice cuántos ítems lleva', () => {
  it('la cantidad de líneas va en un chip del encabezado', async () => {
    // FR-014. Mutación: borrar el `<span>` del chip en `TicketDelPos.jsx`. Es
    // el único número que dice cuántas líneas hay sin recorrer la lista: con
    // ocho ítems, el ticket no entra en su propia zona de scroll.
    await montar({
      cart: [
        { id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'ef' },
        { id: 11, name: 'Creatina 300g', price: 3000, qty: 4, method: 'ef' },
      ],
    })

    const encabezado = screen.getByRole('heading', { name: 'Ticket' }).parentElement

    // DOS líneas y CINCO unidades, cada cosa con su palabra. El chip decía solo
    // «2», y «2» a secas se lee como dos unidades: con cinco frascos sobre el
    // mostrador y un ticket que dice 2, lo que falta no se nota.
    expect(within(encabezado).getByText('2 ítems · 5 u.')).toBeInTheDocument()
  })
})

describe('Los filtros del catálogo sobreviven a la venta', () => {
  it('la categoría y «Solo con stock» siguen puestos después de cobrar', async () => {
    // FR-049. Mutación: resetear los filtros en `limpiarDespuesDeCobrar`. En un
    // mostrador con cola se cobran cincuenta ventas seguidas del mismo rubro;
    // volver a elegir el filtro cincuenta veces es exactamente el gesto que
    // este hito vino a sacar.
    await montar({
      productos: [COLAGENO, CREATINA, SIN_STOCK],
      cart: [{ id: 11, name: 'Creatina 300g', price: 3000, qty: 1, method: 'ef' }],
    })

    await userEvent.click(screen.getByRole('button', { name: /Solo con stock/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Creatina' }))

    expect(screen.queryByText('Colágeno 300g')).not.toBeInTheDocument()
    expect(screen.queryByText('Barrita 30g')).not.toBeInTheDocument()

    cobrarConAtajo()
    await waitFor(() => expect(cart()).toHaveLength(0))

    // El catálogo sigue filtrado igual: ni la categoría ni el conmutador se
    // resetearon.
    expect(screen.queryByText('Colágeno 300g')).not.toBeInTheDocument()
    expect(screen.queryByText('Barrita 30g')).not.toBeInTheDocument()
    expect(screen.getByText('Creatina 300g')).toBeInTheDocument()
  })
})

describe('Quién decide si hay vuelto es la bandera del medio, no una comparación', () => {
  // ⚠ Esto NO se puede probar sembrando otro medio ni pasando el cambio por la
  // pantalla, y el comentario que decía lo contrario en T1130 era falso. Hoy
  // `ef` es el ÚNICO medio con `vuelto: true`, así que `llevaVuelto(c)` y
  // `c === 'ef'` devuelven lo mismo para los once códigos del sistema: las dos
  // expresiones son indistinguibles por datos.
  //
  // Lo que las distingue es **quién decide**. Con la bandera doblada, la
  // pantalla que delega en `llevaVuelto` sigue a la bandera y la que compara
  // contra `'ef'` no la ve. Es el único experimento que separa las dos, y es
  // exactamente la decisión 1 de la spec: el segmento decide el PRECIO y la
  // bandera decide el VUELTO, que son dos ejes distintos.
  //
  // Mutación: `cart.some((i) => i.method === 'ef')` en `Billing.jsx`.

  it('un medio marcado con vuelto muestra el bloque aunque NO sea «ef»', async () => {
    dobles.vueltoDe = (codigo) => codigo === 'tr'

    await montar({ cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 1, method: 'tr' }] })

    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()
  })

  it('un «ef» sin la bandera NO muestra el bloque', async () => {
    // La otra mitad, y es la que atrapa el caso que viene: el día que un medio
    // nuevo cotice como efectivo sin billetes de por medio, la pantalla tiene
    // que hacerle caso a la lista y no a un literal escrito acá.
    dobles.vueltoDe = () => false

    await montar({ cart: UNA_LINEA })

    expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('Vuelto')).not.toBeInTheDocument()
  })
})

describe('Las dos medidas que la maqueta fija, tal como están declaradas', () => {
  // ⚠ Acá se afirma la CLASE DECLARADA y nada más. Que el botón mida 32px de
  // verdad y que el cuerpo no scrollee horizontal por debajo de 1080px son los
  // pasos manuales 1 y 2: jsdom no tiene motor de maquetado y
  // `getBoundingClientRect` devuelve cero siempre. Lo que esto atrapa es la
  // edición que cambia el número, que es como el ticket había quedado en 380px.

  it('el botón de agregar declara 32px, no los 29 de BotonDeFila', async () => {
    // FR-011 (`maqueta:378`). Mutación: `h-8 w-8` → `h-6 w-6`.
    await montar({ productos: [COLAGENO] })

    const boton = screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ })

    expect(boton.className).toContain('h-8')
    expect(boton.className).toContain('w-8')
  })

  it('el punto de venta declara el ancho mínimo de la maqueta', async () => {
    // FR-002 (`maqueta:337`). Mutación: sacar `min-w-[1080px]`. Sin el mínimo,
    // por debajo de ese ancho las dos columnas se comprimen en vez de desbordar
    // adentro de la zona que scrollea, y el ticket deja de entrar.
    await montar()

    const dosColumnas = screen.getByText('Ticket').closest('aside').parentElement

    expect(dosColumnas.className).toContain('min-w-[1080px]')
    // Y el desbordamiento queda ADENTRO del POS, no en el cuerpo de la página.
    expect(dosColumnas.parentElement.className).toContain('overflow-x-auto')
  })
})

// ════════════════════════════════════════════
//  Emitir es el único acto irreversible de la pantalla
//
//  Pedir un CAE consume numeración correlativa de ARCA y para darlo de baja
//  hace falta una nota de crédito, que es un proyecto que no existe. Antes eso
//  salía derecho del botón «Confirmar venta», sin mostrar qué líneas llevaba ni
//  qué datos del comprador iban.
//
//  Ahora hay un paso: el panel de emisión. El panel ES la confirmación —dice el
//  ambiente, dice que consume un número, muestra el detalle y el botón nombra el
//  comprobante y el importe—, así que el diálogo encima queda SOLO para
//  producción, que es donde el comprobante tiene validez fiscal. Encimarlo en
//  homologación es el mecanismo por el que la advertencia deja de leerse.
//
//  ⚠ El `confirm` de `Esc` —vaciar el ticket— ya existía y es de otra cosa.
// ════════════════════════════════════════════

/** Deja el POS con una venta registrada, sin comprobante, y el panel abierto. */
async function conUnReintentoPendiente(opciones = {}) {
  await montar({ cart: UNA_LINEA, ...opciones })

  cobroConAfipQueRechaza({
    error: 'CUIT_REQUERIDO',
    message: 'Una Factura A necesita el CUIT del comprador (11 dígitos).',
  })

  cobrarConAtajo()

  return within(await waitFor(() => {
    const caja = panelDeEmision()
    expect(caja).not.toBeNull()
    return caja
  }))
}

/** Los pedidos que EMITEN un comprobante ante ARCA. */
const emisiones = () => post.mock.calls.filter(([url]) => String(url).includes('/facturar'))

describe('El panel es el paso previo, y en producción además pregunta', () => {
  it('el panel NO se cierra cuando ARCA rechaza: el motivo y el reintento quedan juntos', async () => {
    // Antes el rechazo mandaba al historial de ventas: otra pantalla, con el
    // cliente enfrente, para pedir el comprobante de una venta que ya está
    // registrada. Lo que falta casi siempre es un dato del comprador, y está acá.
    const panel = await conUnReintentoPendiente()

    expect(panel.getByText(/necesita el CUIT del comprador/)).toBeInTheDocument()
    expect(panel.getByRole('button', { name: /Reintentar Factura C/ })).toBeInTheDocument()
    // El ticket se vació igual: la operación existe y dejarlo cargado invita a
    // cobrarla de nuevo (FR-052).
    expect(cart()).toHaveLength(0)
  })

  it('un aviso sin cerrar NO secuestra el cobro del ticket siguiente', async () => {
    // El aviso de una venta que quedó sin comprobante es FIJO: se cierra a mano,
    // y el operador puede seguir atendiendo con el aviso todavía en pantalla.
    //
    // Con el panel sabiendo solo «estoy abierto», el cobro siguiente miraba ese
    // aviso, mostraba el detalle de la venta VIEJA y reintentaba ESA emisión: el
    // ticket nuevo no se registraba y quien apretó creía que sí. Por eso el
    // estado guarda PARA QUÉ está abierto el panel y no si lo está.
    await conUnReintentoPendiente({ productos: [COLAGENO] })

    // Se cierra el panel sin resolver nada; el aviso queda fijo en el ticket.
    teclear('Escape')
    await waitFor(() => expect(panelDeEmision()).toBeNull())

    const registradas = postsDeVenta().length

    // Ticket nuevo, con el aviso de la venta anterior todavía a la vista.
    await userEvent.click(screen.getByRole('button', { name: /Agregar Colágeno 300g al ticket/ }))
    expect(screen.getByText(/necesita el CUIT del comprador/)).toBeInTheDocument()

    post.mockResolvedValue({
      data: { ok: true, data: { id: 'sale_2', total: '1500.00', date: '2026-08-04' }, warnings: [], stock: [] },
    })

    const nuevo = await abrirPanelDeEmision()

    // El panel habla del TICKET, no de la venta vieja: ni el motivo de ARCA ni
    // el botón de reintentar.
    expect(nuevo.queryByText(/necesita el CUIT del comprador/)).not.toBeInTheDocument()
    expect(nuevo.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()

    await userEvent.click(nuevo.getByRole('button', { name: /Emitir Factura C/ }))

    // Y lo que sale es un `POST /sales` de verdad: la venta nueva se registra.
    await waitFor(() => expect(postsDeVenta().length).toBe(registradas + 1))
  })

  it('en homologación el reintento emite sin un diálogo encima', async () => {
    // El panel ya dijo el ambiente y lo que va a pasar. Una segunda pregunta
    // donde no pasa nada es lo que hace que la de producción no se lea.
    const panel = await conUnReintentoPendiente()

    expect(emisiones()).toHaveLength(1)
    post.mockResolvedValue({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 41 } } })

    await userEvent.click(panel.getByRole('button', { name: /Reintentar Factura C/ }))

    await waitFor(() => expect(emisiones()).toHaveLength(2))
    expect(emisiones()[1][0]).toBe('/sales/sale_1/facturar')
    expect(screen.queryByRole('button', { name: 'Emitir comprobante' })).not.toBeInTheDocument()
  })

  it('en producción NO manda el pedido hasta confirmar', async () => {
    const panel = await conUnReintentoPendiente({
      settings: { ...SETTINGS, afip_environment: 'production' },
    })

    expect(emisiones()).toHaveLength(1)

    await userEvent.click(panel.getByRole('button', { name: /Reintentar Factura C/ }))

    expect(await screen.findByRole('button', { name: 'Emitir comprobante' })).toBeInTheDocument()
    expect(emisiones()).toHaveLength(1)
  })

  it('cancelar no emite nada, y la venta sin comprobante sigue ahí', async () => {
    const panel = await conUnReintentoPendiente({
      settings: { ...SETTINGS, afip_environment: 'production' },
    })

    await userEvent.click(panel.getByRole('button', { name: /Reintentar Factura C/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    await new Promise((seguir) => setTimeout(seguir, 0))
    expect(emisiones()).toHaveLength(1)
    expect(screen.getByText(/necesita el CUIT del comprador/)).toBeInTheDocument()
  })

  it('confirmar sí emite', async () => {
    // La otra mitad: una confirmación que no deja emitir deja la venta
    // registrada y sin comprobante para siempre.
    const panel = await conUnReintentoPendiente({
      settings: { ...SETTINGS, afip_environment: 'production' },
    })

    post.mockResolvedValue({ data: { ok: true, data: { cae: '75123456789012', voucherNumber: 41 } } })

    await userEvent.click(panel.getByRole('button', { name: /Reintentar Factura C/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Emitir comprobante' }))

    await waitFor(() => expect(emisiones()).toHaveLength(2))
    expect(emisiones()[1][0]).toBe('/sales/sale_1/facturar')
  })

  it('la confirmación de producción dice qué comprobante y contra qué ambiente', async () => {
    // «¿Confirmar?» a secas no le da a nadie con qué decidir. Los dos datos que
    // deciden son cuál es el comprobante y contra qué ambiente sale.
    const panel = await conUnReintentoPendiente({
      settings: { ...SETTINGS, afip_environment: 'production' },
    })

    await userEvent.click(panel.getByRole('button', { name: /Reintentar Factura C/ }))

    const texto = (await screen.findByRole('button', { name: 'Emitir comprobante' }))
      .closest('[role="dialog"]').textContent

    // Monotributo emite Factura C, que es el tipo que viaja en el pedido.
    expect(texto).toContain('Factura C')
    expect(texto).toContain('PRODUCCIÓN')
    expect(texto).toContain('nota de crédito')
  })

  it('el panel dice el ambiente, y en producción no lo dice igual que en pruebas', async () => {
    // ⚠ El valor guardado es `'production'`, en inglés (`afipAuth.js`). Estaba
    // comparado contra `'produccion'` en las dos pantallas que emiten, así que
    // la condición daba `false` SIEMPRE: el ambiente irreversible era justo el
    // que no avisaba.
    await montar({ cart: UNA_LINEA, settings: { ...SETTINGS, afip_environment: 'production' } })

    const enProduccion = await abrirPanelDeEmision()

    expect(enProduccion.getByText('Producción')).toBeInTheDocument()
    expect(enProduccion.getAllByText(/consume un número correlativo/).length).toBeGreaterThan(0)

    cleanup()

    await montar({ cart: UNA_LINEA, settings: { ...SETTINGS, afip_environment: 'homologation' } })

    const enPruebas = await abrirPanelDeEmision()

    expect(enPruebas.getByText('Homologación')).toBeInTheDocument()
    expect(enPruebas.getByText(/no tiene validez fiscal/)).toBeInTheDocument()
  })
})

describe('El panel muestra lo que se va a facturar antes de mandarlo', () => {
  it('el detalle va producto por producto, con su subtotal', async () => {
    await montar({
      cart: [
        { id: 10, name: 'Colágeno 300g', price: 1500, qty: 2, method: 'ef' },
        { id: 11, name: 'Creatina 300g', price: 4000, qty: 1, method: 'ef' },
      ],
    })

    const panel = await abrirPanelDeEmision()

    expect(panel.getByText('2 ítems · 3 unidades')).toBeInTheDocument()
    // El subtotal de la línea, que es precio × cantidad y no el precio suelto.
    expect(panel.getByText('$3.000,00')).toBeInTheDocument()
    expect(panel.getByRole('button', { name: /Emitir Factura C · \$7\.000,00/ })).toBeInTheDocument()
  })

  it('una Factura C NO inventa una columna de IVA', async () => {
    // La maqueta dibuja «Neto u. · IVA 21%» en el panel de una Factura C, y es
    // un error del dibujo: una Factura C no discrimina IVA —el servidor le manda
    // `ImpIVA: 0`— y mostrarle esas columnas a un monotributista es decirle que
    // cobró algo que no cobró. Es el mismo criterio que sostiene `desglosarIva`.
    await montar({ cart: UNA_LINEA })

    const panel = await abrirPanelDeEmision()

    expect(panel.queryByText(/IVA 21%/)).not.toBeInTheDocument()
    expect(panel.getByText(/no discrimina IVA/)).toBeInTheDocument()
  })
})

describe('Cobrar ahora y facturar después es una salida explícita', () => {
  it('registra la venta y NO pide ningún CAE', async () => {
    // Pasaba igual —la venta quedaba registrada y sin comprobante cuando ARCA
    // rechazaba—, pero solo por error: no había forma de elegirlo a propósito
    // cuando el cliente no espera o ARCA está caído.
    await montar({ cart: UNA_LINEA })

    await userEvent.click(screen.getByRole('button', { name: /Cobrar ahora y facturar después/ }))

    await waitFor(() => expect(postsDeVenta()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))

    expect(post.mock.calls.filter(([url]) => String(url).includes('/facturar'))).toHaveLength(0)
    // Y NO se marca como remito: el comprobante todavía no se decidió, y
    // escribirle «REMITO» la haría figurar en el historial como si ya tuviera
    // uno — que es justo lo que hay que poder buscar después para facturarla.
    expect(postsDeVenta()[0][1].notes).toBe('')
    // Tampoco se ofrece imprimir: no hay comprobante que entregar.
    expect(screen.queryByRole('button', { name: /Imprimir el comprobante/ })).not.toBeInTheDocument()
  })

  it('con un comprobante interno la salida no existe: no hay nada que postergar', async () => {
    await montar({ cart: UNA_LINEA })

    await elegirSinFactura()

    expect(screen.queryByRole('button', { name: /Cobrar ahora y facturar después/ }))
      .not.toBeInTheDocument()
  })
})
