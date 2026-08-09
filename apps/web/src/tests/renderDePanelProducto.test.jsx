import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useStore from '@/store/useStore'
import api from '@/services/api'
import PanelProducto from '@/components/PanelProducto'

// ════════════════════════════════════════════
//  FAVALIO · El panel del producto, renderizado
//
//  Los otros dos de los cuatro incumplimientos que pasaron los 274 tests de la
//  web sin ponerse en rojo (los dos primeros están en
//  `renderDeInventario.test.jsx`):
//
//   · El alta sin cantidad no creaba fila de stock, y el producto quedaba
//     contado en Inventario e invisible en Faltantes.
//   · El panel afirmaba unidades comprometidas inexistentes mientras se editaba
//     la cantidad.
//
//  ── Lo que este archivo agrega al patrón ──
//
//  Acá SÍ hay que interceptar la API, porque guardar es justamente lo que se
//  verifica. Se hace espiando la instancia de axios (`vi.spyOn(api, 'post')`) y
//  **no** con `vi.mock('@/services/api')`: mockear el módulo obliga a declarar
//  todas sus exportaciones nombradas —son más de cien— y la lista se
//  desactualiza sola. El espía intercepta el único método que se usa y deja el
//  resto del módulo intacto.
// ════════════════════════════════════════════

const CENTRO = { id: 1, name: 'Centro', is_active: true }
const DEPOSITO = { id: 2, name: 'Depósito', is_active: true }
const SUCURSALES = [CENTRO, DEPOSITO]

const SETTINGS = { margin_efectivo: 50, recargo_tarjeta: 0, descuento_alianza: 0 }

/** Todos los permisos que el panel mira. */
const TODOS = ['products.crear', 'products.editar', 'products.eliminar', 'stock.editar']

/**
 * Monta el panel abierto.
 *
 * Es `async` y envuelve el render en `act` a propósito: editando un producto
 * existente, `HistorialDeCostos` pide su historial al montar y guarda el
 * resultado en estado. Sin esperar esa resolución, React avisa «An update … was
 * not wrapped in act(...)» en cada prueba. La advertencia no rompe nada, y es
 * exactamente por eso que hay que sacarla: una suite que imprime seis pantallas
 * de ruido en verde es una en la que nadie lee la salida cuando se pone en rojo.
 *
 * @param {object|null} producto `null` es el alta: el panel es uno solo para
 *   las dos cosas, y esa decisión es justo la que hay que poder verificar.
 */
async function montar({ producto = null, permisos = TODOS, ...resto } = {}) {
  useStore.setState({ permisos })

  let resultado

  await act(async () => {
    resultado = render(
      <PanelProducto
        abierto
        onOpenChange={() => {}}
        producto={producto}
        sucursales={SUCURSALES}
        marcas={[]}
        settings={SETTINGS}
        {...resto}
      />
    )
  })

  return resultado
}

/** Los dos `<input type="number">` del renglón de una sucursal: cantidad y mínimo. */
function renglonDeStock(nombreDeSucursal) {
  const grilla = screen.getByTitle(nombreDeSucursal).parentElement
  const [cantidad, minimo] = within(grilla).getAllByRole('spinbutton')

  return { grilla, cantidad, minimo, bloque: grilla.parentElement }
}

/** Los cuerpos con los que se llamó a `POST /stock`, en orden. */
function cuerposDeStockEnviados() {
  return api.post.mock.calls.filter(([ruta]) => ruta === '/stock').map(([, cuerpo]) => cuerpo)
}

beforeEach(() => {
  vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { id: 77 } } })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { data: { id: 77 } } })
  // `HistorialDeCostos` pide el historial al abrir el panel de un producto
  // existente. Sin este doble, el test dispararía un pedido de verdad.
  vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [], meta: {} } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  Defecto 3 · El alta sin cantidad no dejaba fila de stock
//
//  Antes se filtraba por `quantity > 0 || min_stock > 0`, así que un producto
//  dado de alta sin cantidad quedaba con CERO filas de stock. Inventario lo
//  sumaba a «Stock bajo» —para reponer, no tener fila y tener cero es lo mismo—
//  y `GET /api/faltantes`, que recorre `Stock.findAll`, no podía listarlo
//  nunca: el producto que había que comprar era justo el que no aparecía en la
//  pantalla con la que se arma el pedido al proveedor.
// ════════════════════════════════════════════

describe('El alta crea una fila de stock por sucursal, aunque vaya en cero', () => {
  it('un producto nuevo SIN cantidad deja igual su fila en las dos sucursales', async () => {
    const usuario = userEvent.setup()
    await montar()

    // El nombre es lo único obligatorio; las cantidades quedan en 0, que es como
    // se da de alta el producto que todavía no llegó del proveedor.
    const nombre = within(screen.getByText('Nombre').closest('label')).getByRole('textbox')
    await usuario.type(nombre, 'Creatina')

    await usuario.click(screen.getByRole('button', { name: 'Crear producto' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/products', expect.anything()))

    const cuerpos = await waitFor(() => {
      const enviados = cuerposDeStockEnviados()
      expect(enviados).toHaveLength(2)
      return enviados
    })

    expect(cuerpos).toEqual([
      { product_id: 77, punto_de_venta_id: 1, quantity: 0, min_stock: 0 },
      { product_id: 77, punto_de_venta_id: 2, quantity: 0, min_stock: 0 },
    ])
  })

  it('cada cuerpo lleva su `punto_de_venta_id`: una fila sin sucursal no se ve nunca', async () => {
    const usuario = userEvent.setup()
    await montar()

    const nombre = within(screen.getByText('Nombre').closest('label')).getByRole('textbox')
    await usuario.type(nombre, 'Creatina')

    const { cantidad } = renglonDeStock('Depósito')
    await usuario.clear(cantidad)
    await usuario.type(cantidad, '12')

    await usuario.click(screen.getByRole('button', { name: 'Crear producto' }))

    const cuerpos = await waitFor(() => {
      const enviados = cuerposDeStockEnviados()
      expect(enviados).toHaveLength(2)
      return enviados
    })

    // La sucursal con cantidad y la que quedó en cero: las dos, y cada una con
    // la suya. Sin `punto_de_venta_id` la fila es mercadería que la pantalla no
    // muestra en ninguna columna (FR-049).
    expect(cuerpos).toEqual([
      { product_id: 77, punto_de_venta_id: 1, quantity: 0, min_stock: 0 },
      { product_id: 77, punto_de_venta_id: 2, quantity: 12, min_stock: 0 },
    ])
  })
})

// ════════════════════════════════════════════
//  Defecto 4 · El panel inventaba unidades comprometidas
//
//  `quantity` está atado al `<input>` y `available` es de solo lectura, así que
//  calcular la diferencia sobre lo que se está tipeando hacía que escribir 15 en
//  un renglón de 10/10 mostrara «Hay 5 unidades comprometidas en ventas o
//  producción» —no había ninguna—, y que bajar la cantidad mostrara el mensaje
//  contrario sobre una fila sana. El panel afirmaba un hecho del servidor a
//  partir de una tecla del usuario.
// ════════════════════════════════════════════

describe('Las unidades comprometidas salen de la fila guardada, no del teclado', () => {
  const SANO = {
    id: 5,
    name: 'Colágeno',
    cost: '1000',
    stock: [{ id: 50, punto_de_venta_id: 1, quantity: 10, available: 10, min_stock: 0 }],
  }

  it('escribir 15 sobre un renglón de 10/10 NO hace aparecer el aviso', async () => {
    const usuario = userEvent.setup()
    await montar({ producto: SANO })

    const { cantidad, bloque } = renglonDeStock('Centro')

    expect(within(bloque).queryByText(/comprometida/)).not.toBeInTheDocument()

    await usuario.clear(cantidad)
    await usuario.type(cantidad, '15')

    expect(cantidad).toHaveValue(15)
    expect(within(bloque).queryByText(/comprometida/)).not.toBeInTheDocument()
    expect(within(bloque).queryByText(/por encima de la cantidad física/)).not.toBeInTheDocument()
  })

  it('bajar la cantidad tampoco inventa el aviso contrario', async () => {
    const usuario = userEvent.setup()
    await montar({ producto: SANO })

    const { cantidad, bloque } = renglonDeStock('Centro')

    await usuario.clear(cantidad)
    await usuario.type(cantidad, '4')

    expect(within(bloque).queryByText(/por encima de la cantidad física/)).not.toBeInTheDocument()
  })

  it('cuando las unidades comprometidas EXISTEN, el aviso aparece bajo su renglón', async () => {
    // 10 físicas y 6 disponibles: hay 4 comprometidas de verdad, y el aviso
    // tiene que estar —y estar debajo de la sucursal que corresponde, no de la
    // de al lado—.
    const conReservas = {
      ...SANO,
      stock: [{ id: 50, punto_de_venta_id: 2, quantity: 10, available: 6, min_stock: 0 }],
    }

    await montar({ producto: conReservas })

    const deposito = renglonDeStock('Depósito')
    const centro = renglonDeStock('Centro')

    expect(within(deposito.bloque).getByText(/Hay 4 unidades comprometidas/)).toBeInTheDocument()
    expect(within(centro.bloque).queryByText(/comprometida/)).not.toBeInTheDocument()
  })

  it('el aviso sigue diciendo 4 aunque se escriba otra cantidad', async () => {
    const usuario = userEvent.setup()
    const conReservas = {
      ...SANO,
      stock: [{ id: 50, punto_de_venta_id: 2, quantity: 10, available: 6, min_stock: 0 }],
    }

    await montar({ producto: conReservas })

    const { cantidad, bloque } = renglonDeStock('Depósito')

    await usuario.clear(cantidad)
    await usuario.type(cantidad, '30')

    // Las comprometidas las mueve el servidor, no el `<input>`: 4 antes de
    // escribir y 4 después.
    expect(within(bloque).getByText(/Hay 4 unidades comprometidas/)).toBeInTheDocument()
  })

  it('una unidad comprometida se dice en singular', async () => {
    const unaSola = {
      ...SANO,
      stock: [{ id: 50, punto_de_venta_id: 1, quantity: 10, available: 9, min_stock: 0 }],
    }

    await montar({ producto: unaSola })

    expect(screen.getByText(/1 unidad comprometida en ventas/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Lo que solo se ve renderizando: los permisos
// ════════════════════════════════════════════

describe('Sin permiso los campos quedan deshabilitados, no ausentes', () => {
  it('sin `products.editar` no se puede tocar ningún dato del producto', async () => {
    await montar({ producto: { id: 5, name: 'Colágeno', cost: '1000', stock: [] }, permisos: ['stock.editar'] })

    const nombre = within(screen.getByText('Nombre').closest('label')).getByRole('textbox')
    const costo = within(screen.getByText('Costo').closest('label')).getByRole('spinbutton')
    const marca = within(screen.getByText('Marca').closest('label')).getByRole('combobox')

    expect(nombre).toBeDisabled()
    expect(costo).toBeDisabled()
    expect(marca).toBeDisabled()

    // Deshabilitado CON la explicación y no ausente: ausente deja al usuario
    // sin entender por qué no puede hacer nada.
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(guardar).toBeDisabled()
    expect(guardar).toHaveAttribute('title', 'Necesitás el permiso «products.editar»')
  })

  it('en el alta el permiso que se pide es `products.crear`, no `products.editar`', async () => {
    await montar({ producto: null, permisos: ['products.editar', 'stock.editar'] })

    const crear = screen.getByRole('button', { name: 'Crear producto' })

    expect(crear).toBeDisabled()
    expect(crear).toHaveAttribute('title', 'Necesitás el permiso «products.crear»')
  })

  it('sin `stock.editar` las cantidades quedan bloqueadas y el panel dice por qué', async () => {
    await montar({ producto: { id: 5, name: 'Colágeno', cost: '1000', stock: [] }, permisos: ['products.editar'] })

    const { cantidad, minimo } = renglonDeStock('Centro')

    expect(cantidad).toBeDisabled()
    expect(minimo).toBeDisabled()
    expect(
      screen.getByText('Necesitás el permiso «stock.editar» para cambiar estas cantidades.')
    ).toBeInTheDocument()

    // Los datos del producto SÍ se pueden tocar: son dos permisos distintos y
    // bloquear los dos juntos es como se pierde media pantalla por un permiso
    // que no correspondía.
    const nombre = within(screen.getByText('Nombre').closest('label')).getByRole('textbox')
    expect(nombre).toBeEnabled()
  })

  it('con `stock.editar` no aparece la explicación de más', async () => {
    await montar({ producto: { id: 5, name: 'Colágeno', cost: '1000', stock: [] } })

    expect(
      screen.queryByText('Necesitás el permiso «stock.editar» para cambiar estas cantidades.')
    ).not.toBeInTheDocument()
  })

  it('sin `products.eliminar` no se ofrece desactivar', async () => {
    await montar({ producto: { id: 5, name: 'Colágeno', cost: '1000', stock: [] }, permisos: ['products.editar'] })

    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
  })
})
