import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
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
  vi.spyOn(api, 'delete').mockResolvedValue({ data: { ok: true } })
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
//  016 · Las cantidades después de migrar la columna
//
//  `stock.quantity`, `stock.available` y `stock.min_stock` pasaron a
//  `NUMERIC(14,4)` y `pg` las entrega como TEXTO con la escala puesta: una fila
//  de diez llega `{ quantity: '10.0000', available: '10.0000',
//  min_stock: '0.0000' }`.
//
//  ⚠ **Los tres puntos de este panel NO se arreglan igual.** El texto del
//  disponible pasa por el formateador; los dos `<input type="number">` NO: un
//  `value="9,6"` en un control numérico deja el campo **en blanco** —el
//  navegador descarta lo que no parsee como número de punto flotante— y quien
//  guardara escribiría cero. Ésos se normalizan en el origen con `Number(...)`.
//
//  Y los dos inputs se afirman por separado a propósito: `min_stock` es el
//  décimo punto, el que la spec no tenía listado, y es el que se olvida.
// ════════════════════════════════════════════

describe('Las cantidades que llegan como texto se dibujan como antes de migrar', () => {
  /** La fila tal cual la manda la API con las columnas ya en `NUMERIC(14,4)`. */
  const MIGRADO = {
    id: 5,
    name: 'Colágeno',
    cost: '1000',
    stock: [{ id: 50, punto_de_venta_id: 1, quantity: '10.0000', available: '8.0000', min_stock: '0.0000' }],
  }

  it('el campo de cantidad vale 10, y NO «10.0000» ni queda vacío', async () => {
    await montar({ producto: MIGRADO })

    const { cantidad } = renglonDeStock('Centro')

    // `toHaveValue(10)` sobre un `spinbutton` compara el número: con
    // `'10.0000'` el control conserva el string y esto se pone en rojo.
    expect(cantidad).toHaveValue(10)
    expect(cantidad.value).toBe('10')
  })

  it('el campo de MÍNIMO vale 0, y no «0.0000»', async () => {
    // El punto que la spec no listaba: es el gemelo tres líneas más abajo, y
    // migra igual.
    await montar({ producto: MIGRADO })

    const { minimo } = renglonDeStock('Centro')

    expect(minimo).toHaveValue(0)
    expect(minimo.value).toBe('0')
  })

  it('el texto del disponible dice 8 y NO «8.0000»', async () => {
    // Se siembra 10 físicas y 8 disponibles porque el renglón solo dibuja esta
    // frase cuando hay unidades comprometidas: con 10/10 el `<p>` no existe y
    // el caso no verificaría nada.
    await montar({ producto: MIGRADO })

    const { bloque } = renglonDeStock('Centro')
    const texto = within(bloque).getByText(/Disponible para vender/).textContent

    expect(texto).toContain('Disponible para vender: 8.')
    expect(texto).not.toContain('8.0000')
  })

  it('y un disponible fraccionario se escribe «9,6» y no «9.6»', async () => {
    // ⚠ Es el caso que aísla el formateador de este punto, y hace falta.
    //
    // La frase se arma sobre `original.stock[i]`, que es la fila YA normalizada
    // con `Number(...)`: por eso el caso de arriba —`'8.0000'`— pasa igual con
    // el formateador puesto o sacado, y solo se pone en rojo si se revierten
    // las dos mitades a la vez, que es como estaba el código antes de la 016.
    // Lo único que distingue al formateador solo es el separador decimal.
    const fraccionario = {
      ...MIGRADO,
      stock: [{ id: 50, punto_de_venta_id: 1, quantity: '10.0000', available: '9.6000', min_stock: '0.0000' }],
    }

    await montar({ producto: fraccionario })

    const { bloque } = renglonDeStock('Centro')
    const texto = within(bloque).getByText(/Disponible para vender/).textContent

    expect(texto).toContain('Disponible para vender: 9,6.')
    expect(texto).not.toContain('9.6')
  })

  it('un stock FRACCIONARIO no traba el formulario: el campo no queda inválido', async () => {
    // Después de migrar, producción deja stocks en 9,6. Contra `step="1"` el
    // navegador marca ese valor como `stepMismatch` y el panel muestra un
    // número que él mismo considera inválido: no guarda y no dice por qué.
    const fraccionario = {
      ...MIGRADO,
      stock: [{ id: 50, punto_de_venta_id: 1, quantity: '9.6000', available: '9.6000', min_stock: '0.5000' }],
    }

    await montar({ producto: fraccionario })

    const { cantidad, minimo } = renglonDeStock('Centro')

    expect(cantidad).toHaveValue(9.6)
    expect(cantidad.validity.stepMismatch).toBe(false)
    expect(cantidad.validity.valid).toBe(true)

    expect(minimo).toHaveValue(0.5)
    expect(minimo.validity.stepMismatch).toBe(false)
    expect(minimo.validity.valid).toBe(true)
  })

  it('y una cantidad fraccionaria TIPEADA tampoco queda inválida al guardar', async () => {
    // La otra mitad del mismo defecto: no alcanza con que el valor que llega
    // del servidor sea válido, porque el operador corrige el stock a mano. Con
    // `step="1"`, escribir 8,2 deja el campo en `stepMismatch` y el formulario
    // se traba sin decir por qué.
    const fraccionario = {
      ...MIGRADO,
      stock: [{ id: 50, punto_de_venta_id: 1, quantity: '9.6000', available: '9.6000', min_stock: '0.5000' }],
    }

    const usuario = userEvent.setup()
    await montar({ producto: fraccionario })

    const { cantidad } = renglonDeStock('Centro')

    await usuario.clear(cantidad)
    await usuario.type(cantidad, '8.2')

    expect(cantidad.validity.stepMismatch).toBe(false)
    expect(cantidad.validity.valid).toBe(true)

    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    // Y el `PUT` de la fila salió con el número, no con un cero ni con un NaN:
    // ése era el otro final posible del campo en blanco.
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/stock/50', { quantity: 8.2, min_stock: 0.5 })
    })
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

// ════════════════════════════════════════════
//  El interruptor de «página pública» (T1415)
//
//  Contesta «¿este producto PODRÍA salir a una página pública?», y es la
//  pregunta que más fácil se confunde con otras dos:
//
//   · con `is_active`, que dice si se puede vender en el mostrador;
//   · con «está publicado», que no es esto: marcarlo NO publica nada. Un
//     producto sale a una tienda recién cuando se lo agrega a un catálogo.
//
//  Por eso lo que se afirma acá no es solo que el interruptor exista, sino QUÉ
//  dice y CONTRA QUÉ endpoint escribe.
// ════════════════════════════════════════════

describe('El interruptor de página pública dice lo que hace, y lo que no', () => {
  const COLAGENO = { id: 5, name: 'Colágeno', cost: '1000', stock: [] }

  /** El interruptor, por su etiqueta. */
  const interruptor = () =>
    screen.getByRole('checkbox', { name: 'Este producto puede salir a una página pública' })

  it('refleja el valor guardado del producto, en los dos sentidos', async () => {
    await montar({ producto: { ...COLAGENO, publicable: true } })
    expect(interruptor()).toBeChecked()

    cleanup()

    await montar({ producto: { ...COLAGENO, publicable: false } })
    expect(interruptor()).not.toBeChecked()
  })

  it('dice que marcarlo NO publica nada y que no es lo mismo que estar activo', async () => {
    // Es el texto que la pantalla existe para decir. Sin él, el interruptor se
    // lee como «publicar», que es lo que no hace.
    await montar({ producto: COLAGENO })

    expect(screen.getByText(/Marcarlo no publica nada/)).toBeInTheDocument()
    expect(screen.getByText(/se lo agrega a un catálogo/)).toBeInTheDocument()
    expect(screen.getByText(/distinto de estar activo/)).toBeInTheDocument()
  })

  it('marcar publicable no publica nada: el producto sigue sin aparecer en ningún catálogo', async () => {
    // Se afirma sobre LA LLAMADA: guardar el interruptor escribe una columna del
    // producto —`PUT /products/:id`— y no toca ningún catálogo. Si algún día
    // esto empezara a agregar el producto a una tienda, el cambio pasaría por
    // acá.
    const usuario = userEvent.setup()
    await montar({ producto: COLAGENO })

    await usuario.click(interruptor())
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))

    const [ruta, cuerpo] = api.put.mock.calls[0]

    expect(ruta).toBe('/products/5')
    expect(cuerpo.publicable).toBe(true)

    // Ninguna llamada, de ningún método, va contra un catálogo.
    const rutas = [
      ...api.put.mock.calls, ...api.post.mock.calls, ...api.get.mock.calls,
    ].map(([r]) => String(r))

    expect(rutas.filter((r) => /catalog/i.test(r))).toEqual([])

    // Y `publicable` no es `is_active`: el cuerpo no lo menciona, así que
    // marcar el producto como publicable no lo activa ni lo desactiva.
    expect(cuerpo).not.toHaveProperty('is_active')
  })

  it('sin `products.editar` el interruptor está deshabilitado y dice por qué', async () => {
    // Deshabilitado y NO ausente: uno que desaparece deja a la persona sin
    // saber si el producto es publicable ni por qué no puede decidirlo. El
    // motivo va en el `title` —la regla del sistema— y también a la vista.
    await montar({ producto: COLAGENO, permisos: ['stock.editar'] })

    expect(interruptor()).toBeInTheDocument()
    expect(interruptor()).toBeDisabled()
    expect(interruptor()).toHaveAttribute('title', 'Necesitás el permiso «products.editar»')
    expect(
      screen.getByText('Necesitás el permiso «products.editar» para cambiarlo.')
    ).toBeInTheDocument()

    // Y el texto que explica qué es sigue estando: quien no puede cambiarlo
    // igual tiene que poder entender qué dice el interruptor que está mirando.
    expect(screen.getByText(/Marcarlo no publica nada/)).toBeInTheDocument()
  })

  it('en el alta el permiso que pide el interruptor es `products.crear`', async () => {
    // El alta escribe con `POST /products`, que exige `products.crear`. Pedir
    // `products.editar` acá apagaría el interruptor para alguien que la API sí
    // deja marcar.
    await montar({ producto: null, permisos: ['products.editar', 'stock.editar'] })

    expect(interruptor()).toBeDisabled()
    expect(interruptor()).toHaveAttribute('title', 'Necesitás el permiso «products.crear»')

    cleanup()

    await montar({ producto: null, permisos: ['products.crear'] })

    expect(interruptor()).toBeEnabled()
  })
})

// ════════════════════════════════════════════
//  La foto del producto (T1419)
//
//  Tres cosas que solo se ven renderizando, y una que no se ve nunca:
//
//   · **De dónde viene la foto cambia lo que se dibuja.** `products.image_url`
//     es una columna vieja y el importador de CSV la llena desde una columna
//     `imagen` del archivo, así que en la base hay productos con la URL de un
//     hosting de terceros. Esas fotos NO se publican (FR-030, H6): la tienda
//     dibuja el marcador neutro. Un panel que las muestra como cualquier otra
//     deja al usuario creyendo que su catálogo tiene fotos que no va a tener, y
//     el rojo aparece recién cuando abre la tienda.
//
//   · **La subida va contra el id del producto**, así que en el alta no existe.
//
//   · **Los errores los escribe el servidor.** El límite de 5 MB, el archivo que
//     `sharp` no puede leer y el volumen lleno son tres mensajes distintos, y el
//     que sabe cuál fue es la API.
//
//   · Y la que no se ve: **el object URL de la previsualización se revoca**. Un
//     blob que nadie revoca se queda en memoria mientras la pestaña viva —el
//     navegador no lo suelta cuando deja de estar referenciado—, así que probar
//     seis fotos de 4 MB son 24 MB que no vuelven y nada lo avisa. Por eso se
//     afirma sobre las llamadas a `revokeObjectURL` y no sobre lo dibujado: no
//     hay nada dibujado que mirar.
// ════════════════════════════════════════════

const CON_FOTO_EXTERNA = {
  id: 5,
  name: 'Whey Protein 1kg',
  cost: '1000',
  // Tal cual la deja el importador de CSV: la URL del hosting del proveedor.
  image_url: 'https://cdn.hostingajeno.com/fotos/whey.jpg',
  stock: [],
}

const CON_FOTO_PROPIA = {
  ...CON_FOTO_EXTERNA,
  // La que devuelve `POST /api/products/:id/imagen`: ruta relativa al volumen.
  image_url: '/img/a1/b2/a1b2c3d4e5f6.jpg',
}

const SIN_FOTO = { id: 5, name: 'Whey Protein 1kg', cost: '1000', stock: [] }

/**
 * `URL.createObjectURL` y `URL.revokeObjectURL`, que jsdom no implementa.
 *
 * No es un doble de comodidad: sin él, elegir un archivo tira
 * «createObjectURL is not a function» y el test falla por el entorno y no por el
 * sistema. Y es además lo que hace verificable la liberación, que es justo lo
 * que no deja rastro en el DOM.
 */
function espiarObjectURL() {
  const original = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL }
  let n = 0

  const crear = vi.fn(() => `blob:favalio/${++n}`)
  const revocar = vi.fn()

  URL.createObjectURL = crear
  URL.revokeObjectURL = revocar

  return {
    crear,
    revocar,
    restaurar: () => {
      // ⚠ Se desmonta ACÁ y no se deja para el `cleanup()` de `preparacion.js`.
      // Los `afterEach` de adentro corren antes que los de afuera, así que el
      // desmontaje global ocurriría con el doble ya sacado: el efecto de
      // limpieza del panel llamaría a un `URL.revokeObjectURL` que en jsdom no
      // existe, y tres pruebas fallarían por el entorno y no por el sistema.
      cleanup()

      URL.createObjectURL = original.crear
      URL.revokeObjectURL = original.revocar
    },
  }
}

/** Un JPEG cualquiera. El contenido no importa: quien lo mira es `sharp`, en la API. */
const jpeg = (nombre = 'whey.jpg') => new File(['bytes'], nombre, { type: 'image/jpeg' })

/** El bloque «Foto» entero, para no afirmar sobre el `<img>` de otra sección. */
const seccionDeLaFoto = () => screen.getByRole('heading', { name: 'Foto' }).parentElement

/** La entrada de archivo, que es donde vive el `accept`. */
const entradaDeFoto = () => screen.getByLabelText('Foto del producto')

describe('La foto: de dónde viene cambia lo que se dibuja', () => {
  it('un producto con `image_url` del importador de CSV se dibuja con el aviso de foto externa y no como si tuviera foto', async () => {
    await montar({ producto: CON_FOTO_EXTERNA })

    // El aviso, y con el motivo escrito: «no se publica» a secas deja al
    // usuario sin saber qué hacer al respecto.
    expect(screen.getByText('Foto externa: no se publica')).toBeInTheDocument()
    expect(screen.getByText(/apunta a un servidor de otro/)).toBeInTheDocument()

    // Y NO la miniatura. Es la mitad que importa: dibujarla haría ver esta foto
    // igual que una del volumen propio, y la tienda no la va a mostrar.
    expect(seccionDeLaFoto().querySelector('img')).toBeNull()

    // La salida existe y está a mano: subir la propia, o sacar la que hay.
    expect(screen.getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeInTheDocument()
  })

  it('una foto del volumen propio sí se dibuja, y sin ningún aviso', async () => {
    await montar({ producto: CON_FOTO_PROPIA })

    const miniatura = seccionDeLaFoto().querySelector('img')

    expect(miniatura).not.toBeNull()
    expect(miniatura).toHaveAttribute('src', '/img/a1/b2/a1b2c3d4e5f6.jpg')
    expect(screen.queryByText('Foto externa: no se publica')).not.toBeInTheDocument()
  })

  it('sin foto no hay miniatura ni aviso, y el panel dice qué se ve en la tienda', async () => {
    await montar({ producto: SIN_FOTO })

    expect(seccionDeLaFoto().querySelector('img')).toBeNull()
    expect(screen.queryByText('Foto externa: no se publica')).not.toBeInTheDocument()
    expect(screen.getByText(/marcador neutro del mismo tamaño/)).toBeInTheDocument()

    // Sin foto no hay nada que quitar: el botón destructivo no está.
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quitar foto' })).not.toBeInTheDocument()
  })
})

describe('Subir la foto', () => {
  let objectURL

  beforeEach(() => { objectURL = espiarObjectURL() })
  afterEach(() => { objectURL.restaurar() })

  it('el input declara los formatos que el servidor sabe guardar', async () => {
    await montar({ producto: SIN_FOTO })

    // El `accept` no valida nada —eso lo hace `sharp` mirando el contenido— pero
    // es lo que hace que el selector del sistema muestre las fotos y no la
    // carpeta entera, en el teléfono con el que se saca la foto del producto.
    expect(entradaDeFoto()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
  })

  it('la foto viaja como `multipart/form-data` en el campo `imagen`, contra el id del producto', async () => {
    const usuario = userEvent.setup()
    api.post.mockResolvedValue({ data: { ok: true, data: { image_url: '/img/aa/bb/nueva.jpg' } } })

    await montar({ producto: SIN_FOTO })

    const archivo = jpeg()
    await usuario.upload(entradaDeFoto(), archivo)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/products/5/imagen', expect.anything()))

    const [, cuerpo] = api.post.mock.calls.find(([ruta]) => ruta === '/products/5/imagen')

    // `FormData` y no un JSON con el base64 adentro: el nombre del campo es
    // parte del contrato —multer escucha `imagen`— y el `boundary` lo pone el
    // navegador solo.
    expect(cuerpo).toBeInstanceOf(FormData)
    expect(cuerpo.get('imagen')).toBe(archivo)
  })

  it('la foto subida NO deja el panel pidiendo guardar de nuevo', async () => {
    // El endpoint escribe la columna en el momento. Si el panel moviera solo su
    // formulario, «Guardar cambios» quedaría habilitado y cerrar preguntaría
    // «hay cambios sin guardar» por algo que ya está guardado — que es como se
    // enseña a apretar «Descartar» sin leer.
    const usuario = userEvent.setup()
    api.post.mockResolvedValue({ data: { ok: true, data: { image_url: '/img/aa/bb/nueva.jpg' } } })

    await montar({ producto: SIN_FOTO })

    await usuario.upload(entradaDeFoto(), jpeg())

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/products/5/imagen', expect.anything()))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled())
  })

  it('en el alta no se ofrece subir, y el panel dice por qué', async () => {
    // La URL de la subida lleva el id del producto y en el alta no hay ninguno.
    // La sección aparece igual: esconderla dejaría a alguien buscando dónde se
    // carga la foto.
    await montar({ producto: null })

    expect(screen.getByRole('heading', { name: 'Foto' })).toBeInTheDocument()
    expect(screen.getByText(/La foto se sube después de crear el producto/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Foto del producto')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subir foto' })).not.toBeInTheDocument()
  })

  it('sin `products.editar` los botones de la foto están apagados y dicen qué permiso falta', async () => {
    // Apagados y no ausentes, con el permiso NOMBRADO: quien lee «no tenés
    // permiso» no puede pedir nada concreto.
    await montar({ producto: CON_FOTO_PROPIA, permisos: ['stock.editar'] })

    const subir = screen.getByRole('button', { name: 'Cambiar foto' })
    const quitar = screen.getByRole('button', { name: 'Quitar foto' })

    expect(subir).toBeDisabled()
    expect(subir).toHaveAttribute('title', 'Necesitás el permiso «products.editar»')
    expect(quitar).toBeDisabled()
    expect(quitar).toHaveAttribute('title', 'Necesitás el permiso «products.editar»')
  })
})

describe('Los object URL de la previsualización se liberan', () => {
  let objectURL

  beforeEach(() => { objectURL = espiarObjectURL() })
  afterEach(() => { objectURL.restaurar() })

  it('elegir una segunda foto libera el blob de la primera', async () => {
    const usuario = userEvent.setup()
    api.post.mockResolvedValue({ data: { ok: true, data: { image_url: '/img/aa/bb/nueva.jpg' } } })

    await montar({ producto: SIN_FOTO })

    await usuario.upload(entradaDeFoto(), jpeg('primera.jpg'))
    await waitFor(() => expect(objectURL.crear).toHaveBeenCalledTimes(1))

    const primera = objectURL.crear.mock.results[0].value

    await usuario.upload(entradaDeFoto(), jpeg('segunda.jpg'))
    await waitFor(() => expect(objectURL.crear).toHaveBeenCalledTimes(2))

    // La primera se revoca; la segunda es la que se está mirando y sigue viva.
    expect(objectURL.revocar).toHaveBeenCalledWith(primera)
    expect(objectURL.revocar).not.toHaveBeenCalledWith(objectURL.crear.mock.results[1].value)
  })

  it('desmontar el panel libera el blob que quedaba vivo', async () => {
    const usuario = userEvent.setup()
    api.post.mockResolvedValue({ data: { ok: true, data: { image_url: '/img/aa/bb/nueva.jpg' } } })

    const { unmount } = await montar({ producto: SIN_FOTO })

    await usuario.upload(entradaDeFoto(), jpeg())
    await waitFor(() => expect(objectURL.crear).toHaveBeenCalledTimes(1))

    const url = objectURL.crear.mock.results[0].value
    expect(objectURL.revocar).not.toHaveBeenCalledWith(url)

    unmount()

    // Después del desmontaje ya no hay ningún estado desde donde revocarla: si
    // no se hace acá, no se hace nunca.
    expect(objectURL.revocar).toHaveBeenCalledWith(url)
  })

  it('una subida que falla no deja el blob colgado ni la foto a la vista', async () => {
    const usuario = userEvent.setup()
    vi.spyOn(toast, 'error').mockImplementation(() => {})
    api.post.mockRejectedValue({
      response: { status: 400, data: { ok: false, error: 'La foto no puede pesar más de 5 MB.' } },
    })

    await montar({ producto: SIN_FOTO })

    await usuario.upload(entradaDeFoto(), jpeg())

    await waitFor(() => expect(objectURL.revocar).toHaveBeenCalledWith(objectURL.crear.mock.results[0].value))

    // Y la previsualización se va: dejarla afirma que la foto quedó cargada,
    // que es justo lo que no pasó.
    await waitFor(() => expect(seccionDeLaFoto().querySelector('img')).toBeNull())
  })
})

describe('Los errores de la foto los escribe el servidor', () => {
  let objectURL

  beforeEach(() => { objectURL = espiarObjectURL() })
  afterEach(() => { objectURL.restaurar() })

  /** Sube una foto contra una API que contesta `respuesta`. */
  async function subirContra(respuesta) {
    const usuario = userEvent.setup()
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    api.post.mockRejectedValue({ response: respuesta })

    await montar({ producto: SIN_FOTO })
    await usuario.upload(entradaDeFoto(), jpeg())

    await waitFor(() => expect(aviso).toHaveBeenCalled())

    return aviso
  }

  it('el archivo de más de 5 MB muestra el mensaje que dice cuál es el límite', async () => {
    // El que sube una foto de 8 MB desde el teléfono tiene que leer cuánto pesa
    // de más, no «Request failed with status code 400».
    const aviso = await subirContra({
      status: 400,
      data: { ok: false, error: 'La foto no puede pesar más de 5 MB.' },
    })

    expect(aviso).toHaveBeenCalledWith('La foto no puede pesar más de 5 MB.')
  })

  it('un `.exe` renombrado a `.jpg` vuelve con el motivo, y el `accept` no lo tapa', async () => {
    // El `accept` del input filtra el diálogo del sistema y nada más: el tipo lo
    // declara el cliente. Lo que mira el contenido es `sharp`, en la API, y su
    // mensaje es el que tiene que llegar hasta acá.
    const aviso = await subirContra({
      status: 400,
      data: { ok: false, error: 'El archivo no es una imagen que podamos leer. Probá con un JPG o un PNG.' },
    })

    expect(aviso).toHaveBeenCalledWith(
      'El archivo no es una imagen que podamos leer. Probá con un JPG o un PNG.'
    )
  })

  it('el volumen lleno se muestra tal cual: es del sistema, no del usuario', async () => {
    // 507 `SIN_ESPACIO`. El mensaje ya viene escrito y dice a quién avisarle;
    // reescribirlo acá le echaría la culpa a quien subió la foto.
    const aviso = await subirContra({
      status: 507,
      data: {
        ok: false,
        codigo: 'SIN_ESPACIO',
        error: 'No queda espacio para guardar más fotos. Avisale al administrador del sistema.',
      },
    })

    expect(aviso).toHaveBeenCalledWith(
      'No queda espacio para guardar más fotos. Avisale al administrador del sistema.'
    )
  })
})

describe('Quitar la foto', () => {
  it('llama al DELETE de la foto y no al del producto', async () => {
    // Son dos endpoints parecidos y uno de los dos desactiva el producto entero:
    // `DELETE /products/5` en vez de `DELETE /products/5/imagen` sacaría el
    // producto del punto de venta por haber querido cambiarle la foto.
    const usuario = userEvent.setup()
    vi.spyOn(toast, 'success').mockImplementation(() => {})

    await montar({ producto: CON_FOTO_PROPIA })

    await usuario.click(screen.getByRole('button', { name: 'Quitar foto' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/products/5/imagen'))
    expect(api.delete.mock.calls.map(([ruta]) => ruta)).toEqual(['/products/5/imagen'])
  })

  it('deja el panel sin miniatura y sin pedir guardar de nuevo', async () => {
    const usuario = userEvent.setup()
    vi.spyOn(toast, 'success').mockImplementation(() => {})

    await montar({ producto: CON_FOTO_PROPIA })

    expect(seccionDeLaFoto().querySelector('img')).not.toBeNull()

    await usuario.click(screen.getByRole('button', { name: 'Quitar foto' }))

    await waitFor(() => expect(seccionDeLaFoto().querySelector('img')).toBeNull())
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('también sirve para sacar la foto externa que dejó el importador', async () => {
    // Es la única forma que tiene el usuario de limpiar una `image_url` que
    // apunta afuera sin editar la dirección a mano. La API borra la columna y no
    // toca ningún archivo ajeno.
    const usuario = userEvent.setup()
    vi.spyOn(toast, 'success').mockImplementation(() => {})

    await montar({ producto: CON_FOTO_EXTERNA })

    await usuario.click(screen.getByRole('button', { name: 'Quitar foto' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/products/5/imagen'))
    await waitFor(() => expect(screen.queryByText('Foto externa: no se publica')).not.toBeInTheDocument())
  })
})
