import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ════════════════════════════════════════════
//  El store no puede devolver la tabla al estado inicial en cada guardado
//
//  Hoy `Inventory.jsx:423` llama a `initialize()` después de guardar un
//  producto. Eso dispara tres requests, pone `loading: true` global —la tabla
//  entera parpadea— y devuelve la lista al principio: el usuario pierde la
//  página, la búsqueda, el orden y el scroll en los que estaba. Con doscientos
//  productos y una corrección de stock por fila, es la diferencia entre trabajar
//  y pelearse con la pantalla (FR-035).
//
//  `actualizarProducto` y `quitarProducto` reemplazan UNA fila y no tocan
//  `loading`. `initialize()` sigue siendo lo correcto cuando cambió medio
//  catálogo: una importación o un masivo de precios.
//
//  ⚠ El archivo se llama `storeDeInventario` porque acá está el molde del store
//  doblado —`api` mockeado, el estado rellenado a mano con `useStore.setState`—,
//  pero desde la funcionalidad 011 cubre **también el carrito del punto de
//  venta**: el bloque `setEmpresaActiva · el ticket no cruza de una empresa a
//  otra`. Queda dicho acá porque si no, el próximo que busque ese test no lo
//  encuentra.
// ════════════════════════════════════════════

const { respuestas, llamadas } = vi.hoisted(() => ({
  respuestas: { sucursales: { data: { ok: true, data: [] } } },
  llamadas: [],
}))

vi.mock('../services/api', () => {
  const registrar = (metodo) => (url) => {
    llamadas.push({ metodo, url })
    return Promise.resolve({ data: { ok: true, data: [] } })
  }

  return {
    default: { get: registrar('get'), post: registrar('post'), put: registrar('put') },
    getSucursalesDeStock: () => {
      llamadas.push({ metodo: 'get', url: '/stock/sucursales' })
      return Promise.resolve(respuestas.sucursales)
    },
  }
})

const { default: useStore } = await import('../store/useStore.js')

const PRODUCTO = (campos = {}) => ({ id: 1, name: 'Colágeno 300g', cost: 1200, ...campos })

beforeEach(() => {
  llamadas.length = 0
  respuestas.sucursales = { data: { ok: true, data: [] } }
  useStore.setState({ products: [], sucursales: [], loading: false, error: null })
})

describe('actualizarProducto · reemplaza la fila sin recargar todo', () => {
  it('reemplaza la fila que corresponde y deja las otras intactas', () => {
    useStore.setState({ products: [PRODUCTO(), PRODUCTO({ id: 2, name: 'Whey 1kg' })] })

    useStore.getState().actualizarProducto({ id: 2, name: 'Whey 1kg', cost: 9999 })

    const { products } = useStore.getState()

    expect(products.map((p) => p.cost)).toEqual([1200, 9999])
    expect(products).toHaveLength(2)
  })

  it('NO toca loading: la tabla no parpadea', () => {
    // Es la mitad del defecto: `initialize()` pone `loading: true` global y la
    // pantalla entera se reemplaza por el esqueleto de carga.
    useStore.setState({ products: [PRODUCTO()], loading: false })

    useStore.getState().actualizarProducto({ id: 1, cost: 1500 })

    expect(useStore.getState().loading).toBe(false)
  })

  it('NO dispara ningún request', () => {
    // Si volviera a pedir la lista, se perderían página, búsqueda, orden y
    // scroll, que es exactamente lo que FR-035 pide no perder.
    useStore.setState({ products: [PRODUCTO()] })

    useStore.getState().actualizarProducto({ id: 1, cost: 1500 })

    expect(llamadas).toEqual([])
  })

  it('conserva los campos que la respuesta parcial no trae', () => {
    // `PUT /api/products/:id` devuelve el producto, pero el `stock` incluido no
    // viene en esa respuesta. Reemplazar la fila entera dejaría la columna de
    // stock vacía hasta la próxima recarga.
    useStore.setState({ products: [PRODUCTO({ stock: [{ id: 7, quantity: 12 }] })] })

    useStore.getState().actualizarProducto({ id: 1, cost: 1500 })

    expect(useStore.getState().products[0].stock).toEqual([{ id: 7, quantity: 12 }])
    expect(useStore.getState().products[0].cost).toBe(1500)
  })

  it('un producto que no está en la lista NO se agrega', () => {
    // La lista se carga con `?active=true`: meter uno que no cumple el filtro
    // mostraría una fila que la pantalla no habría traído.
    useStore.setState({ products: [PRODUCTO()] })

    useStore.getState().actualizarProducto({ id: 99, name: 'Otro' })

    expect(useStore.getState().products).toHaveLength(1)
  })

  it('sin producto o sin id no rompe ni vacía la lista', () => {
    useStore.setState({ products: [PRODUCTO()] })

    useStore.getState().actualizarProducto(undefined)
    useStore.getState().actualizarProducto({ name: 'Sin id' })

    expect(useStore.getState().products).toHaveLength(1)
  })
})

describe('quitarProducto · saca la fila del producto desactivado', () => {
  it('saca solo esa fila y no toca loading', () => {
    useStore.setState({ products: [PRODUCTO(), PRODUCTO({ id: 2 })], loading: false })

    useStore.getState().quitarProducto(2)

    expect(useStore.getState().products.map((p) => p.id)).toEqual([1])
    expect(useStore.getState().loading).toBe(false)
    expect(llamadas).toEqual([])
  })

  it('un id que no está no vacía la lista', () => {
    useStore.setState({ products: [PRODUCTO()] })

    useStore.getState().quitarProducto(99)
    useStore.getState().quitarProducto(undefined)

    expect(useStore.getState().products).toHaveLength(1)
  })
})

describe('sucursales · de dónde salen las columnas de la tabla', () => {
  it('se cargan desde /stock/sucursales, el único que trae las inactivas', async () => {
    respuestas.sucursales = {
      data: {
        ok: true,
        data: [
          { id: 3, name: 'Sucursal Principal', code: 'principal', is_active: true },
          { id: 7, name: 'Depósito', code: 'deposito', is_active: false },
        ],
      },
    }

    await useStore.getState().cargarSucursales()

    expect(llamadas).toEqual([{ metodo: 'get', url: '/stock/sucursales' }])
    expect(useStore.getState().sucursales.map((s) => s.id)).toEqual([3, 7])
  })

  it('conserva la inactiva: cerrar un local no evapora su mercadería', async () => {
    respuestas.sucursales = {
      data: { ok: true, data: [{ id: 7, name: 'Depósito', is_active: false }] },
    }

    await useStore.getState().cargarSucursales()

    expect(useStore.getState().sucursales).toHaveLength(1)
    expect(useStore.getState().sucursales[0].is_active).toBe(false)
  })

  it('un fallo NO deja sin productos al resto de las pantallas', async () => {
    // Un usuario sin `stock.ver` no puede listar sucursales, y eso no tiene por
    // qué romper la pantalla de ventas.
    respuestas.sucursales = Promise.reject(new Error('403'))

    useStore.setState({ products: [PRODUCTO()], loading: false })

    await useStore.getState().cargarSucursales()

    expect(useStore.getState().products).toHaveLength(1)
    expect(useStore.getState().loading).toBe(false)
    expect(useStore.getState().error).toBeNull()
  })
})

// ════════════════════════════════════════════
//  setEmpresaActiva · el ticket no cruza de una empresa a otra
//
//  `setEmpresaActiva` limpiaba `sucursales` a propósito —«mostrar las columnas
//  de otro cliente en la tabla de este es justo lo que el aislamiento viene a
//  evitar»— y no tocaba `cart`. El carrito es peor que las sucursales, porque no
//  se muestra: se **cobra**. Un superadmin que cambiaba de empresa con el ticket
//  cargado se quedaba con los productos de la empresa A adentro del ticket de la
//  empresa B; al cobrar, `SaleItem` guardaba esos `product_id`, la búsqueda de
//  stock por `empresa_id: B` no encontraba nada, y la venta quedaba registrada
//  **con las líneas de otro cliente y sin descontar nada**, con un aviso que se
//  lee como un problema de stock (FR-062).
// ════════════════════════════════════════════

describe('setEmpresaActiva · el ticket no cruza de una empresa a otra', () => {
  const LINEA = (id) => ({ id, name: `Producto ${id}`, price: 1000, qty: 1, method: 'ef' })

  const initializeOriginal = useStore.getState().initialize

  afterEach(() => {
    useStore.setState({ initialize: initializeOriginal, cart: [] })
  })

  it('NO deja el ticket de una empresa cargado al cambiar a otra', async () => {
    useStore.setState({ cart: [LINEA(1), LINEA(2)], initialize: vi.fn() })

    await useStore.getState().setEmpresaActiva(2)

    expect(useStore.getState().cart).toEqual([])
  })

  it('limpia el carrito ANTES de pedir los datos de la empresa nueva', async () => {
    // Limpiarlo después de `initialize()` deja una ventana —lo que tarden tres
    // requests— en la que la pantalla dibuja las líneas de A con el contexto de
    // B, y el botón de cobrar está habilitado durante toda esa ventana.
    let carritoAlPedir = null

    useStore.setState({
      cart: [LINEA(1), LINEA(2)],
      initialize: vi.fn(async () => { carritoAlPedir = useStore.getState().cart }),
    })

    await useStore.getState().setEmpresaActiva(2)

    expect(carritoAlPedir).toEqual([])
  })
})
