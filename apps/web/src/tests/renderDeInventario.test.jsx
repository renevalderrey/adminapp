import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Inventory from '@/pages/Inventory'

// ════════════════════════════════════════════
//  FAVALIO · Inventario, renderizado
//
//  El primer archivo de tests de render del repositorio. Existe por un motivo
//  concreto: `sdd-verify` encontró seis incumplimientos en la funcionalidad 010
//  y **cuatro pasaron los 274 tests de la web sin ponerse en rojo**, porque las
//  reglas vivían adentro de los componentes y no había forma de renderizarlos.
//
//  Dos de esos cuatro se verifican acá —el color del badge y el filtro de
//  sucursal—; los otros dos, en `renderDePanelProducto.test.jsx`.
//
//  ── El patrón, para las cuatro pantallas que vienen ──
//
//   1. **El store se llena a mano** con `useStore.setState`, incluidas las
//      acciones. `initialize` y `cargarSucursales` se reemplazan por dobles
//      porque la pantalla las llama en un `useEffect` al montar: sin eso, cada
//      test dispararía pedidos HTTP de verdad.
//   2. **Nada de mockear `@/services/api` entero.** El grafo de imports de una
//      pantalla arrastra veinte exportaciones nombradas y la lista se
//      desactualiza sola. Los paneles hijos van cerrados, así que no piden
//      nada; cuando hace falta interceptar, se espía la instancia de axios
//      (ver el archivo del panel).
//   3. **Las filas se buscan por su `grid-template-columns`.** La tabla es un
//      grid y no un `<table>` —es el patrón de diseño del rediseño—, así que no
//      hay `role="row"`. `filaDe('Colágeno')` sube desde el nombre hasta el
//      contenedor que tiene columnas, y desde ahí se mira con `within`.
//   4. **Lo que se afirma es el dibujo**, no la regla: que el badge esté en la
//      celda de la sucursal que corresponde, que los indicadores se repinten,
//      que el encabezado y las filas compartan columnas. La regla —de qué color
//      va el badge— ya la cubre `utils/inventario.test.js`, y ahí es más barata.
//      Un test de render que verifica una función pura es un test lento que se
//      rompe cuando alguien mueve un `<div>`.
// ════════════════════════════════════════════

/** El umbral general de stock bajo, el mismo que llega por `GET /api/settings`. */
const UMBRAL = 3

const SETTINGS = {
  margin_efectivo: 50,
  recargo_tarjeta: 0,
  descuento_alianza: 0,
  umbral_stock_bajo: UMBRAL,
}

const CENTRO = { id: 1, name: 'Centro', is_active: true }
const DEPOSITO = { id: 2, name: 'Depósito', is_active: true }

/**
 * El producto de las pruebas: cantidad 2, mínimo SIN cargar.
 *
 * Es el caso que la regla vieja del badge no pintaba. Con umbral 3, `2 <= 3`
 * es stock bajo para el indicador, para el filtro y para la hoja impresa.
 */
const COLAGENO = {
  id: 10,
  name: 'Colágeno',
  sku: 'COL-1',
  cost: '1000',
  category: 'colageno',
  brand: { name: 'Star' },
  stock: [{ id: 100, punto_de_venta_id: 1, quantity: 2, min_stock: 0, available: 2 }],
}

const WHEY = {
  id: 11,
  name: 'Whey',
  sku: 'WHE-1',
  cost: '500',
  category: 'proteina',
  brand: { name: 'Star' },
  stock: [{ id: 101, punto_de_venta_id: 2, quantity: 10, min_stock: 0, available: 10 }],
}

/**
 * Monta la pantalla con el store cargado a mano.
 *
 * @param {object} opciones
 * @param {Array} opciones.productos Lo que devolvería `GET /products?active=true`.
 * @param {Array} opciones.sucursales Lo que devolvería `GET /stock/sucursales`.
 * @param {Array} opciones.permisos Los códigos que tiene el usuario.
 */
function montar({ productos = [], sucursales = [CENTRO, DEPOSITO], permisos = ['products.ver'] } = {}) {
  useStore.setState({
    products: productos,
    brands: [],
    sucursales,
    permisos,
    settings: SETTINGS,
    loading: false,
    error: null,
    // Sin sucursal en el encabezado de la aplicación el filtro arranca en
    // «Todas» (FR-065), que es la vista que compara.
    puntoDeVentaActivo: null,
    // Las dos las llama un `useEffect` al montar. Con las de verdad, cada test
    // pegaría contra la API.
    initialize: vi.fn(),
    cargarSucursales: vi.fn(),
  })

  return render(<Inventory />)
}

/** La fila de la tabla que contiene ese nombre de producto. */
function filaDe(nombre) {
  return screen.getByText(nombre).closest('[style*="grid-template-columns"]')
}

/** El `grid-template-columns` declarado en línea, tal cual. */
function columnasDe(elemento) {
  const estilo = elemento?.getAttribute('style') || ''
  const encontrado = estilo.match(/grid-template-columns:\s*([^;]+)/)

  return encontrado ? encontrado[1].trim() : null
}

/**
 * Los badges de stock de una fila, uno por columna de sucursal, EN ORDEN.
 *
 * Se buscan por `data-slot="tooltip-trigger"` —el que pone
 * `components/ui/tooltip.jsx`— y no por su clase de color: buscar por la clase
 * haría que el test encuentre lo que fue a buscar y no pueda distinguir un
 * badge de otro.
 */
function badgesDeStock(fila) {
  return [...fila.querySelectorAll('[data-slot="tooltip-trigger"]')]
}

/**
 * La tarjeta de los cuatro indicadores.
 *
 * Hace falta acotar la búsqueda porque «Stock bajo» es a la vez el nombre de un
 * indicador y el del botón que filtra por él.
 */
function tarjetaDeIndicadores() {
  return screen.getByText('Valor del stock').parentElement.parentElement
}

/** El número que muestra un indicador. */
function indicador(etiqueta) {
  const bloque = within(tarjetaDeIndicadores()).getByText(etiqueta).parentElement

  return bloque.querySelector('.num').textContent
}

beforeEach(() => {
  useStore.setState({ products: [], sucursales: [], permisos: [] })
})

// Los espías se ponen adentro de cada caso —`api.get` para el historial,
// `api.patch` para la acción masiva— y sin esto quedarían puestos para los que
// siguen: un test que no espía nada terminaría corriendo contra el doble que
// dejó otro, y el orden de los casos pasaría a importar.
afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  Defecto 1 · El badge usaba la regla vieja
//
//  Decía `minimo > 0 && cantidad <= minimo`, que es literalmente la regla de
//  `GET /api/alerts`: un producto sin mínimo cargado no se pintaba nunca.
//  Con cantidad 2, mínimo 0 y umbral 3, el indicador lo contaba, el filtro lo
//  mostraba, la hoja impresa lo marcaba **y el badge quedaba neutro**.
// ════════════════════════════════════════════

describe('El badge de stock pinta con la MISMA regla que el indicador y el filtro', () => {
  it('cantidad 2 con mínimo sin cargar y umbral 3 sale en amarillo, no neutro', async () => {
    montar({ productos: [COLAGENO], sucursales: [CENTRO] })

    const [badge] = badgesDeStock(filaDe('Colágeno'))

    expect(badge).toHaveTextContent('2')
    expect(badge).toHaveClass('text-warn')
    expect(badge).toHaveClass('bg-warn-soft')
  })

  it('en cero gana el rojo sobre el amarillo: son dos urgencias distintas', async () => {
    const sinStock = { ...COLAGENO, stock: [{ ...COLAGENO.stock[0], quantity: 0 }] }

    montar({ productos: [sinStock], sucursales: [CENTRO] })

    const [badge] = badgesDeStock(filaDe('Colágeno'))

    expect(badge).toHaveClass('text-danger')
    expect(badge).not.toHaveClass('text-warn')
  })

  it('por encima del umbral queda neutro', async () => {
    const conStock = { ...COLAGENO, stock: [{ ...COLAGENO.stock[0], quantity: 40 }] }

    montar({ productos: [conStock], sucursales: [CENTRO] })

    const [badge] = badgesDeStock(filaDe('Colágeno'))

    expect(badge).toHaveClass('text-fg-2')
    expect(badge).not.toHaveClass('text-warn')
    expect(badge).not.toHaveClass('text-danger')
  })

  it('el badge cae en la celda de SU sucursal y no en la de al lado', async () => {
    // Es lo único que no puede contestar `utils/inventario.test.js`: la regla
    // podía estar bien y el badge dibujado en la columna equivocada.
    const enAmbas = {
      ...COLAGENO,
      stock: [
        { id: 100, punto_de_venta_id: 1, quantity: 2, min_stock: 0, available: 2 },
        { id: 102, punto_de_venta_id: 2, quantity: 40, min_stock: 0, available: 40 },
      ],
    }

    montar({ productos: [enAmbas] })

    const [centro, deposito] = badgesDeStock(filaDe('Colágeno'))

    expect(centro).toHaveTextContent('2')
    expect(centro).toHaveClass('text-warn')
    expect(deposito).toHaveTextContent('40')
    expect(deposito).toHaveClass('text-fg-2')
  })
})

// ════════════════════════════════════════════
//  Defecto 2 · Elegir una sucursal no acotaba nada
//
//  Con 500 productos y una sucursal que maneja 3, la pantalla decía «Productos
//  activos: 500 · Sin stock: 497» para esa sucursal, y la tabla listaba los
//  500. El requisito (FR-064) estaba en la spec y se perdió al bajar a tareas.
// ════════════════════════════════════════════

describe('Elegir una sucursal acota el listado Y los indicadores', () => {
  it('deja fuera de la tabla los productos que esa sucursal no maneja', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY] })

    expect(screen.getByText('Colágeno')).toBeInTheDocument()
    expect(screen.getByText('Whey')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Depósito' }))

    expect(screen.queryByText('Colágeno')).not.toBeInTheDocument()
    expect(screen.getByText('Whey')).toBeInTheDocument()
  })

  it('los cuatro indicadores se repintan con lo de esa sucursal', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY] })

    // Con «Todas»: los dos productos, 2×1000 + 10×500, y Colágeno en stock bajo.
    expect(indicador('Productos activos')).toBe('2')
    expect(indicador('Valor del stock')).toBe('$7.000')
    expect(indicador('Stock bajo')).toBe('1')

    await usuario.click(screen.getByRole('button', { name: 'Depósito' }))

    // En Depósito solo está Whey, con 10 unidades: ni bajo ni sin stock.
    expect(indicador('Productos activos')).toBe('1')
    expect(indicador('Valor del stock')).toBe('$5.000')
    expect(indicador('Stock bajo')).toBe('0')
    expect(indicador('Sin stock')).toBe('0')
  })

  it('con una sucursal elegida queda UNA sola columna de stock, la suya', async () => {
    const usuario = userEvent.setup()
    const { container } = montar({ productos: [COLAGENO, WHEY] })

    expect(badgesDeStock(filaDe('Whey'))).toHaveLength(2)

    await usuario.click(screen.getByRole('button', { name: 'Depósito' }))

    expect(badgesDeStock(filaDe('Whey'))).toHaveLength(1)
    // El encabezado deja de ofrecer la columna de Centro: si quedara, la
    // etiqueta estaría sobre la cantidad de la otra sucursal.
    expect(within(container).queryByTitle('Centro')).not.toBeInTheDocument()
  })

  it('el vacío que produce el filtro de sucursal NO dice «no hay productos cargados»', async () => {
    const usuario = userEvent.setup()
    const soloEnCentro = { ...WHEY, stock: [{ ...WHEY.stock[0], punto_de_venta_id: 1 }] }

    montar({ productos: [COLAGENO, soloEnCentro] })

    await usuario.click(screen.getByRole('button', { name: 'Depósito' }))

    expect(screen.getByText('Ningún producto coincide con los filtros.')).toBeInTheDocument()
    expect(screen.queryByText('No hay productos cargados.')).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Lo que solo se ve renderizando
// ════════════════════════════════════════════

describe('El encabezado y las filas comparten las mismas columnas', () => {
  it('el `grid-template-columns` del encabezado es idéntico al de cada fila', () => {
    montar({ productos: [COLAGENO, WHEY] })

    const encabezado = screen.getByText('Producto').closest('[style*="grid-template-columns"]')
    const columnas = columnasDe(encabezado)

    // La guardia de texto (`guardiasDeDiseno.test.js`) solo verifica que no haya
    // `<table>`. Que las columnas coincidan es lo que hace que la etiqueta esté
    // sobre su dato, y eso solo se puede comprobar renderizando.
    expect(columnas).toBeTruthy()
    expect(columnasDe(filaDe('Colágeno'))).toBe(columnas)
    expect(columnasDe(filaDe('Whey'))).toBe(columnas)
  })

  it('con dos sucursales hay dos columnas de 92px, y con una hay una', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY] })

    const columnasDelEncabezado = () =>
      columnasDe(screen.getByText('Producto').closest('[style*="grid-template-columns"]'))

    // El número de columnas depende de los datos, así que el string se arma en
    // tiempo de render: es el caso en que encabezado y filas se pueden separar.
    expect(columnasDelEncabezado().match(/92px/g)).toHaveLength(2)

    await usuario.click(screen.getByRole('button', { name: 'Depósito' }))

    expect(columnasDelEncabezado().match(/92px/g)).toHaveLength(1)
    expect(columnasDe(filaDe('Whey'))).toBe(columnasDelEncabezado())
  })
})

describe('Un botón de acción de la fila no abre además el panel', () => {
  it('«Transferir a otra sucursal» abre la transferencia y NO el panel del producto', async () => {
    const usuario = userEvent.setup()
    montar({
      productos: [COLAGENO, WHEY],
      permisos: ['products.ver', 'stock.transferir'],
    })

    await usuario.click(
      within(filaDe('Colágeno')).getByTitle('Transferir a otra sucursal')
    )

    expect(screen.getByText('Transferir mercadería')).toBeInTheDocument()
    // «Stock por sucursal» es el encabezado de una sección que solo existe en
    // el panel del producto. Sin el `stopPropagation` de `BotonDeFila`, el clic
    // subiría hasta la fila y se abrirían los dos paneles encimados.
    expect(screen.queryByText('Stock por sucursal')).not.toBeInTheDocument()
  })

  it('el clic en la fila SÍ abre el panel del producto', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO], permisos: ['products.ver', 'products.editar'] })

    await usuario.click(screen.getByText('Colágeno'))

    expect(screen.getByText('Stock por sucursal')).toBeInTheDocument()
  })

  it('la casilla de selección tampoco abre el panel', async () => {
    const usuario = userEvent.setup()
    const { container } = montar({ productos: [COLAGENO] })

    const casillaDeLaFila = within(filaDe('Colágeno')).getByRole('checkbox')
    await usuario.click(casillaDeLaFila)

    expect(casillaDeLaFila).toBeChecked()
    expect(screen.queryByText('Stock por sucursal')).not.toBeInTheDocument()
    // La barra de selección aparece: el clic hizo lo suyo, no fue tragado.
    expect(within(container).getByText('1 seleccionado')).toBeInTheDocument()
  })
})

describe('Los dos vacíos dicen cosas distintas', () => {
  it('sin ningún producto cargado ofrece cargar el primero', () => {
    montar({ productos: [] })

    expect(screen.getByText('No hay productos cargados.')).toBeInTheDocument()
    expect(screen.queryByText('Ningún producto coincide con los filtros.')).not.toBeInTheDocument()
    // Sin filtros puestos no hay nada que limpiar, así que el botón no está.
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
  })

  it('con filtros que no dan nada ofrece sacarlos, no cargar productos', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY] })

    await usuario.type(
      screen.getByPlaceholderText('Buscar por nombre, marca, SKU o categoría…'),
      'creatina'
    )

    expect(screen.getByText('Ningún producto coincide con los filtros.')).toBeInTheDocument()
    expect(screen.queryByText('No hay productos cargados.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument()
  })

  it('«Limpiar filtros» devuelve el listado, incluida la sucursal', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY] })

    await usuario.click(screen.getByRole('button', { name: 'Depósito' }))
    expect(screen.queryByText('Colágeno')).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /Limpiar/ }))

    expect(screen.getByText('Colágeno')).toBeInTheDocument()
    expect(screen.getByText('Whey')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Hito 9 · El contador de transferencias mentía hacia abajo
//
//  El historial se pide con un tope de veinte y el badge contaba el ARREGLO. Un
//  comercio con doscientas transferencias mostraba «20», sin ninguna señal de
//  que la lista estaba cortada.
//
//  Es el mismo molde que tenía la lista de órdenes de un proveedor —el endpoint
//  manda `total` y la pantalla cuenta `data.length`— y por eso se corrigen
//  juntos: un defecto que aparece dos veces en dos pantallas distintas no es un
//  descuido, es la forma que tiene de escribirse esta pantalla.
//
//  ⚠ Acá se espía la instancia de axios, que es lo que el encabezado de este
//  archivo dice que hay que hacer cuando hace falta interceptar. El historial
//  llega por `GET /stock/transfers`, que no pasa por el store.
// ════════════════════════════════════════════

describe('El contador de transferencias dice cuántas hay, no cuántas entraron', () => {
  const TRANSFERENCIA = {
    id: 1,
    date: '2026-08-01',
    from_location: 'Centro',
    to_location: 'Depósito',
    items: [{ product_name: 'Colágeno', quantity: 2 }],
  }

  /**
   * Abre el historial con lo que devuelve el endpoint.
   *
   * `total` se pasa aparte de `data` a propósito: si el doble los derivara uno
   * del otro nunca podrían discrepar, y la discrepancia ES el defecto.
   */
  async function abrirHistorial({ data, total }) {
    vi.spyOn(api, 'get').mockImplementation((url) => {
      if (String(url).includes('/stock/transfers')) {
        return Promise.resolve({ data: { ok: true, data, total } })
      }
      return Promise.resolve({ data: { ok: true, data: [] } })
    })

    montar({ productos: [COLAGENO] })

    await userEvent.setup({ delay: null }).click(
      screen.getByRole('button', { name: /Transferencias/ })
    )
  }

  /**
   * La sección del historial.
   *
   * Se acota a ella y no se busca en toda la pantalla: la tabla de productos
   * tiene su propio pie «Mostrando N de M», y `getByText(/Mostrando/)` a secas
   * encuentra los dos. Que existan los dos no es un defecto —son dos listas
   * distintas— pero el que se verifica acá es el del historial.
   */
  const seccion = () => screen.getByRole('heading', { name: 'Transferencias' }).closest('section')

  /** El badge del encabezado de la sección. */
  const contador = () =>
    screen.getByRole('heading', { name: 'Transferencias' }).parentElement.querySelector('span.num')

  it('con más transferencias que el tope, muestra el TOTAL', async () => {
    await abrirHistorial({ data: [TRANSFERENCIA], total: 200 })

    expect(contador().textContent).toBe('200')
    expect(contador().textContent).not.toBe('1')
  })

  it('y avisa que la lista está cortada', async () => {
    // Sin la franja, el contador dice 200 y abajo hay una fila: dos números que
    // se contradicen a la vista, que es peor que el defecto original.
    await abrirHistorial({ data: [TRANSFERENCIA], total: 200 })

    const pie = within(seccion()).getByText(/Mostrando/)

    expect(pie.textContent).toContain('1')
    expect(pie.textContent).toContain('200')
  })

  it('cuando NO está cortada, no aparece ninguna franja', async () => {
    // El contra-caso: un pie permanente es ruido, y el ruido permanente es cómo
    // un aviso deja de leerse.
    await abrirHistorial({ data: [TRANSFERENCIA], total: 1 })

    expect(contador().textContent).toBe('1')
    expect(within(seccion()).queryByText(/Mostrando/)).toBeNull()
  })
})

// ════════════════════════════════════════════
//  La acción masiva de «página pública» (T1415)
//
//  Marca en lote qué productos PODRÍAN salir a una página pública. Las dos
//  cosas que se pueden romper acá no son de dibujo:
//
//   1. **Que marque contra el lugar equivocado.** `publicable` es una columna
//      del producto; agregarlo a un catálogo es otra operación y otra pantalla.
//      Si esto escribiera en un catálogo, marcar diez productos los publicaría
//      —que es exactamente lo que la pantalla promete que NO hace—.
//   2. **Que mienta sobre cuántos se marcaron.** La respuesta trae
//      `actualizados` y `pedidos`, y pueden diferir: los que faltan eran de otra
//      empresa o ya no existen. Un «listo» a secas afirma algo que no pasó.
// ════════════════════════════════════════════

describe('Marcar publicables escribe en el producto, no en un catálogo', () => {
  const CON_PERMISO = ['products.ver', 'products.editar']

  /** La respuesta del endpoint, con los dos números por separado. */
  function responde({ actualizados, pedidos }) {
    return vi.spyOn(api, 'patch').mockResolvedValue({
      data: { ok: true, data: { actualizados, pedidos, publicable: true } },
    })
  }

  /**
   * Selecciona un producto y dispara una de las dos acciones del menú.
   *
   * El menú es el `MenuDesplegable` de la barra de selección: un `<details>`
   * con las dos opciones adentro. Se abre por su `summary` igual que lo haría
   * una persona, y no llamando al handler a mano: lo que se verifica es que la
   * acción esté ALCANZABLE desde la pantalla.
   */
  async function marcarDesdeElMenu(nombreDeLaOpcion, opciones = {}) {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY], permisos: CON_PERMISO, ...opciones })

    await usuario.click(within(filaDe('Colágeno')).getByRole('checkbox'))
    await usuario.click(screen.getByText('Página pública'))
    await usuario.click(screen.getByRole('button', { name: nombreDeLaOpcion }))

    return usuario
  }

  it('marcar publicable no publica nada: el producto sigue sin aparecer en ningún catálogo', async () => {
    const patch = responde({ actualizados: 1, pedidos: 1 })

    await marcarDesdeElMenu('Marcar como publicables')

    // La llamada es la afirmación: un `PATCH` a PRODUCTOS. Marcar cambia una
    // columna del producto y nada más — para que aparezca en una página hay que
    // agregarlo a un catálogo, que es otra operación que esta pantalla no hace.
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))

    const [ruta] = patch.mock.calls[0]

    expect(ruta).toBe('/products/publicables')
    expect(ruta).not.toMatch(/catalog/i)

    // Y ninguna otra llamada, de ningún método, va contra un catálogo.
    const rutas = [
      ...patch.mock.calls,
      ...(api.post.mock?.calls || []),
      ...(api.put.mock?.calls || []),
    ].map(([r]) => String(r))

    expect(rutas.filter((r) => /catalog/i.test(r))).toEqual([])
  })

  it('manda los ids de la selección y el booleano que corresponde', async () => {
    const patch = responde({ actualizados: 1, pedidos: 1 })

    await marcarDesdeElMenu('Marcar como publicables')

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch.mock.calls[0][1]).toEqual({ ids: [COLAGENO.id], publicable: true })
  })

  it('«Quitar de publicables» manda `publicable: false`, no otra ruta', async () => {
    // Es la misma llamada con el booleano al revés. Con dos endpoints —uno para
    // marcar y otro para desmarcar— el día que uno cambie el otro se queda como
    // estaba.
    const patch = responde({ actualizados: 1, pedidos: 1 })

    await marcarDesdeElMenu('Quitar de publicables')

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch.mock.calls[0][0]).toBe('/products/publicables')
    expect(patch.mock.calls[0][1]).toEqual({ ids: [COLAGENO.id], publicable: false })
  })

  it('cuando se marcaron MENOS de los pedidos, la pantalla lo dice', async () => {
    // Callarlo es mentir sobre lo que pasó: el usuario cierra la pantalla
    // creyendo que marcó diez y se entera —si se entera— cuando dos productos
    // no aparecen donde los esperaba.
    const aviso = vi.spyOn(toast, 'warning').mockImplementation(() => {})
    responde({ actualizados: 8, pedidos: 10 })

    await marcarDesdeElMenu('Marcar como publicables')

    await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1))

    const mensaje = aviso.mock.calls[0][0]

    expect(mensaje).toContain('8')
    expect(mensaje).toContain('10')
    expect(mensaje).toMatch(/no exist|de esta empresa/)
  })

  it('sin `products.editar` la acción masiva no se ofrece', async () => {
    const usuario = userEvent.setup()
    montar({ productos: [COLAGENO, WHEY], permisos: ['products.ver'] })

    await usuario.click(within(filaDe('Colágeno')).getByRole('checkbox'))

    // La barra de selección aparece igual —seleccionar no exige permiso— pero
    // sin la acción que no se puede hacer. La API la rechaza de todos modos.
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    expect(screen.queryByText('Página pública')).not.toBeInTheDocument()
  })
})
