import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import PurchaseOrders from '@/pages/PurchaseOrders'

// ════════════════════════════════════════════
//  ADMINAPP · /ordenes-compra, renderizado
//
//  Lo que se afirma acá es EL DIBUJO Y EL EFECTO, no las reglas: de qué color va
//  la etiqueta, cuántas órdenes entran en un segmento y qué porcentaje llegó ya
//  están en `utils/ordenDeCompra.test.js` y `utils/formato.test.js`, que son
//  cien veces más baratos. Acá se verifica que el encabezado y las filas
//  compartan columnas, que la orden anulada no ofrezca acciones, que apretar
//  «Recibir» no abra ADEMÁS el detalle, y que lo que sale por la red no lleve un
//  parámetro con un espacio adentro.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports de esta pantalla
//  arrastra decenas de exportaciones nombradas y la lista se desactualiza sola.
//  Se espía la instancia de axios, que es lo que manda `CONVENCIONES.md`.
//
//  ── Por qué las filas se buscan por su `grid-template-columns` ──
//
//  La tabla es un grid y no un `<table>`, así que no hay `role="row"`. Subir
//  desde el nombre del proveedor hasta el contenedor que declara columnas es la
//  única forma de agarrar la fila, y de paso es lo que hace que el primer caso
//  de este archivo pueda comparar los dos strings.
//
//  ⚠ Lo que este archivo NO puede afirmar: que la tabla scrollee dentro de su
//  tarjeta y que el `<body>` no desborde. jsdom devuelve CERO en `scrollWidth` y
//  `clientWidth`, así que un test que los mire pasa con y sin el cambio. Eso es
//  P-N1, en el navegador.
// ════════════════════════════════════════════

/** Doce pedidas, seis recibidas: la orden a medias, que tiene que decir 50 %. */
const A_MEDIAS = {
  id: 118,
  supplier_id: 3,
  supplier_name: 'Distribuidora Norte',
  date: '2026-07-31',
  status: 'partial',
  total: '15000.5',
  items: [
    { product_id: 1, product_name: 'Colágeno 300g', quantity: 12, quantity_received: 6, unit_price: '1000' },
  ],
}

const PENDIENTE = {
  id: 112,
  supplier_id: 3,
  supplier_name: 'Suplementos del Sur',
  date: '2026-07-28',
  status: 'pending',
  total: '4200',
  items: [
    { product_id: 2, product_name: 'Whey 1kg', quantity: 10, quantity_received: 0, unit_price: '420' },
  ],
}

const ANULADA = {
  id: 90,
  supplier_id: 4,
  supplier_name: 'Mayorista Oeste',
  date: '2026-07-10',
  status: 'cancelled',
  total: '900',
  items: [
    { product_id: 3, product_name: 'Creatina', quantity: 3, quantity_received: 0, unit_price: '300' },
  ],
}

const RECIBIDA = {
  id: 77,
  supplier_id: 3,
  supplier_name: 'Almacén Central',
  date: '2026-07-01',
  status: 'received',
  total: '1000',
  items: [
    { product_id: 4, product_name: 'Barritas', quantity: 5, quantity_received: 5, unit_price: '200' },
  ],
}

const TODAS_LAS_ORDENES = [A_MEDIAS, PENDIENTE, ANULADA, RECIBIDA]

/**
 * Siete órdenes con un reparto DISTINTO por segmento: 7 · 2 · 1 · 3.
 *
 * Con `TODAS` los tres segmentos de estado valen 1 y el caso de los contadores
 * pasaría igual si los cuatro números salieran del segmento equivocado. Cuatro
 * números distintos son lo que hace que ese test pueda fallar.
 */
const VARIAS = [
  PENDIENTE,
  { ...PENDIENTE, id: 113, supplier_name: 'Insumos del Este' },
  A_MEDIAS,
  RECIBIDA,
  { ...RECIBIDA, id: 78, supplier_name: 'Depósito Sur' },
  { ...RECIBIDA, id: 79, supplier_name: 'Depósito Norte' },
  ANULADA,
]

/** Los tres permisos que la pantalla y el panel miran. */
const TODOS = ['ordenes_compra.ver', 'ordenes_compra.recibir', 'ordenes_compra.anular']

/**
 * Las sucursales, que salen de `empresaActiva.puntosDeVenta` (T1249).
 *
 * Es la misma entrada del store que dibuja el selector del encabezado, y no
 * `sucursales` —la de `/stock/sucursales`—: esa incluye las inactivas y ninguna
 * de las dos pantallas la carga.
 */
const CENTRO = { id: 7, name: 'Centro', code: 'CEN' }
const RUTA = { id: 9, name: 'Depósito Ruta 11', code: 'RUTA11' }

/**
 * El detalle ENRIQUECIDO que devuelve `GET /suppliers/orders/:id` (T1208).
 *
 * El listado no trae `linea`, `costo_actual` ni `propone_costo`: los tres salen
 * del detalle, y son los que hacen que la recepción sepa a qué línea va la
 * mercadería y qué costo proponer. Doblar la API con la fila del listado tal
 * cual dejaría al panel probándose contra datos que el servidor no produce.
 */
function enriquecer(orden) {
  return {
    ...orden,
    items: (orden.items || []).map((item, indice) => ({
      linea: indice,
      costo_actual: null,
      propone_costo: false,
      ...item,
    })),
  }
}

/** Todo lo que salió por la red, en orden. */
let pedidos = []

/**
 * Monta la pantalla con la API doblada.
 *
 * El render va envuelto en `act` porque la pantalla pide las órdenes y los
 * proveedores en un `useEffect` al montar: sin eso React llena la salida de
 * «An update … was not wrapped in act(...)», y una suite que imprime ruido en
 * verde es una que nadie lee cuando se pone en rojo.
 *
 * Los permisos se cargan como códigos en el store, que es de donde los lee
 * `usePermission`: sin ellos `can()` devuelve `false` y el pie del panel sale
 * entero deshabilitado, así que un caso que no los ponga estaría probando la
 * pantalla de alguien sin permiso sin decirlo.
 *
 * ⚠ Las sucursales se ESCRIBEN siempre, aunque el caso no las use. `preparacion.js`
 * no resetea el store entre pruebas —a propósito—, así que un caso que las deje
 * puestas se las presta al siguiente: el de «una sola sucursal» pasaría o
 * fallaría según el orden en que corran los archivos, que es la peor forma de
 * fallar. El valor por defecto es UNA, que es la empresa típica.
 */
async function montar({
  ordenes = TODAS_LAS_ORDENES,
  total = ordenes.length,
  proveedores = [],
  permisos = TODOS,
  sucursales = [CENTRO],
  vigente = sucursales[0] || null,
} = {}) {
  useStore.setState({
    permisos,
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: sucursales },
    puntoDeVentaActivo: vigente,
  })

  vi.spyOn(api, 'get').mockImplementation((url, config) => {
    pedidos.push({ url, params: config?.params })

    if (url === '/suppliers/orders') {
      return Promise.resolve({ data: { ok: true, data: ordenes, total } })
    }

    if (url === '/suppliers') {
      return Promise.resolve({ data: { ok: true, data: proveedores } })
    }

    // El detalle de una orden: `/suppliers/orders/118`.
    const detalle = ordenes.find((o) => url === `/suppliers/orders/${o.id}`)
    if (detalle) return Promise.resolve({ data: { ok: true, data: enriquecer(detalle) } })

    return Promise.resolve({ data: { ok: true, data: [] } })
  })

  let utilidades
  await act(async () => { utilidades = render(<PurchaseOrders />) })

  return utilidades
}

/** El panel lateral, mientras está abierto. */
const panel = () => document.querySelector('[data-slot="sheet-content"]')

/** Abre el panel desde la fila de esa orden, y espera al detalle. */
async function abrirFila(nombreDelProveedor) {
  await act(async () => { fireEvent.click(filaDe(nombreDelProveedor)) })
}

/** Abre el panel con el botón «Recibir mercadería» de esa fila. */
async function abrirRecepcion(nombreDelProveedor) {
  const boton = within(filaDe(nombreDelProveedor)).getByTitle('Recibir mercadería')

  await act(async () => { fireEvent.click(boton) })
}

/** Cierra el panel con su botón de cerrar. */
async function cerrarPanel() {
  await act(async () => {
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }))
  })
}

/** El campo de cantidad de una línea del formulario de recepción. */
function campoDeLinea(nombre, linea) {
  return within(panel()).getByLabelText(`Cantidad recibida de ${nombre} (línea ${linea})`)
}

/** La fila de la tabla que contiene ese texto. */
function filaDe(texto) {
  return screen.getByText(texto).closest('[style*="grid-template-columns"]')
}

/** El `grid-template-columns` declarado en línea, tal cual. */
function columnasDe(elemento) {
  const estilo = elemento?.getAttribute('style') || ''
  const encontrado = estilo.match(/grid-template-columns:\s*([^;]+)/)

  return encontrado ? encontrado[1].trim() : null
}

/** Las llamadas al listado, con sus parámetros. */
const llamadasAlListado = () => pedidos.filter((p) => p.url === '/suppliers/orders')

beforeEach(() => { pedidos = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('La tabla en grid de /ordenes-compra (T1233)', () => {
  it('el encabezado y las filas comparten el MISMO string de grid-template-columns', async () => {
    // Cuando difieren, las etiquetas dejan de estar sobre sus datos y se lee un
    // importe bajo «Recepción». Es el defecto 2 del relevamiento de la 010, que
    // no lo detectó ningún test hasta que se comparó esto.
    await montar()

    const encabezado = filaDe('Recepción')
    const columnas = columnasDe(encabezado)

    expect(columnas).toBe('96px minmax(0,1fr) 112px 96px 148px 132px 120px')

    for (const orden of TODAS_LAS_ORDENES) {
      expect(columnasDe(filaDe(orden.supplier_name))).toBe(columnas)
    }
  })

  it('una orden anulada no ofrece ninguna acción', async () => {
    // FR-006. Ni «Recibir» ni «Anular»: la orden ya no puede recibir mercadería
    // y anular lo anulado no significa nada. Sigue en la lista —al 55 %— porque
    // si desapareciera, el usuario no tendría cómo comprobar que la anuló.
    await montar()

    const anulada = filaDe('Mayorista Oeste')

    expect(within(anulada).queryAllByRole('button')).toHaveLength(0)
    expect(anulada).toHaveClass('opacity-55')

    // Y la de al lado sí las tiene, que es lo que impide que este caso pase por
    // no haber dibujado ningún botón en ninguna fila.
    expect(within(filaDe('Suplementos del Sur')).getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('el clic en la fila abre el detalle y el clic en Recibir NO lo dispara dos veces', async () => {
    // FR-007. La fila entera abre el panel, así que sin `stopPropagation`
    // apretar «Recibir» dispararía ADEMÁS el handler de la fila: dos aperturas
    // de un clic, dos `GET` del mismo detalle, y el modo que gana es el de la
    // segunda —o sea, el usuario aprieta «Recibir» y le queda el detalle—.
    //
    // ⚠ Este caso cambió de forma en T1238 y hay que decir por qué. Hasta
    // entonces «Recibir» abría un diálogo APARTE que no pedía nada, así que la
    // afirmación era «no salió ningún `GET` del detalle». Desde T1238 los dos
    // caminos abren el MISMO panel y los dos piden el detalle enriquecido: lo
    // que se afirma ahora es que sale UNA sola vez.
    await montar()

    await abrirRecepcion('Suplementos del Sur')

    expect(pedidos.filter((p) => p.url === '/suppliers/orders/112')).toHaveLength(1)
    expect(within(panel()).getByRole('button', { name: /Confirmar recepción/ })).toBeInTheDocument()

    await cerrarPanel()

    // Y el clic en la fila sí lo pide: sin esta mitad, el caso pasaría con una
    // pantalla que no abre el detalle desde ningún lado.
    await abrirFila('Distribuidora Norte')

    expect(pedidos.filter((p) => p.url === '/suppliers/orders/118')).toHaveLength(1)
  })

  it('la barra de recepción de una orden a medias no dice 100%', async () => {
    // Seis de doce unidades son la mitad. Decir 100 % de algo que no llegó
    // entero es exactamente el defecto que la barra existe para evitar: el dueño
    // da la orden por cerrada y la mitad que falta no la reclama nadie.
    await montar()

    const barra = within(filaDe('Distribuidora Norte')).getByRole('progressbar')

    expect(barra).toHaveAttribute('aria-valuenow', '50')
    expect(barra.firstChild).toHaveStyle({ width: '50%' })

    // La recibida entera sí llega a 100: sin esta mitad, una barra clavada en
    // cero pasaría el caso de arriba sin dibujar nada.
    const completa = within(filaDe('Almacén Central')).getByRole('progressbar')

    expect(completa).toHaveAttribute('aria-valuenow', '100')
  })
})

/** El botón de un segmento, por su etiqueta. */
const segmento = (etiqueta) => screen.getByRole('button', { name: new RegExp(`^${etiqueta}`) })

describe('Los controles de arriba de /ordenes-compra (T1234)', () => {
  it('los cuatro segmentos muestran su contador', async () => {
    // US1 escenario 9. El contador sale de la MISMA función que arma la lista
    // (`contadoresPorSegmento`): si se contara aparte, un contador que dice 12
    // sobre una lista de 3 hace concluir que la pantalla se come filas.
    await montar({ ordenes: VARIAS })

    const contadorDe = (etiqueta) => within(segmento(etiqueta)).getByText(/^\d+$/).textContent

    expect(contadorDe('Todas')).toBe('7')
    expect(contadorDe('Pendientes')).toBe('2')
    expect(contadorDe('Parciales')).toBe('1')
    expect(contadorDe('Recibidas')).toBe('3')

    // «Todas» incluye la anulada (FR-006): 2 + 1 + 3 son seis, y la séptima es
    // la que se dibuja al 55 %. Si «Todas» dijera 6, anular una orden la haría
    // desaparecer del conteo y el usuario no tendría cómo comprobar que la anuló.
    expect(contadorDe('Todas')).not.toBe('6')
  })

  it('elegir Todos NO manda un parámetro con un espacio', async () => {
    // FR-020, y es el criterio de éxito 7 del lado de la pantalla. El
    // `<SelectItem value=" ">` viejo mandaba `?supplier_id=%20` a una columna
    // INTEGER: Postgres respondía `invalid input syntax`, el `catch` hacía
    // `console.error` y la lista quedaba con lo anterior SIN ningún aviso.
    // «Todos» es la AUSENCIA del parámetro, no un valor centinela.
    await montar()

    // El recorrido exacto con el que aparecía: filtrar y volver a «Todas».
    await act(async () => { fireEvent.click(segmento('Pendientes')) })
    await act(async () => { fireEvent.click(segmento('Todas')) })

    // Sin esto el caso pasaría con una pantalla que no pide nada.
    expect(llamadasAlListado().length).toBeGreaterThan(0)

    for (const { params } of llamadasAlListado()) {
      expect(params).not.toHaveProperty('supplier_id')
      expect(params).not.toHaveProperty('status')
      expect(Object.values(params || {}).map(String)).not.toContain(' ')
    }
  })

  it('la búsqueda encuentra una orden por su número', async () => {
    // FR-009. El número es el dato que el proveedor menciona por teléfono, y
    // sin él hay que recorrer la lista a ojo.
    await montar()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Buscar órdenes'), { target: { value: '112' } })
    })

    expect(screen.getByText('Suplementos del Sur')).toBeInTheDocument()
    expect(screen.queryByText('Distribuidora Norte')).not.toBeInTheDocument()

    // Y no sale una consulta por tecla: la búsqueda filtra la página cargada
    // (US1 escenario 10, «sin recargar»).
    expect(llamadasAlListado()).toHaveLength(1)
  })
})

describe('Los dos estados vacíos de /ordenes-compra (T1235)', () => {
  it('la lista vacía distingue «no hay órdenes» de «el filtro no devolvió ninguna»', async () => {
    // US1 escenario 12, y FR-011. Las dos se ven igual —una tabla sin filas— y
    // significan lo contrario: un solo texto para las dos manda a cargar una
    // orden que ya existe, o hace buscar un filtro que no está puesto.
    const { unmount } = await montar({ ordenes: [], total: 0 })

    expect(screen.getByText('Todavía no hay órdenes de compra.')).toBeInTheDocument()
    expect(screen.queryByText('Ninguna orden coincide con el filtro.')).not.toBeInTheDocument()

    unmount()

    // La misma tabla vacía, con la misma respuesta del servidor detrás, pero con
    // una búsqueda puesta.
    await montar()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Buscar órdenes'), { target: { value: 'Kioscos Patagonia' } })
    })

    expect(screen.getByText('Ninguna orden coincide con el filtro.')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay órdenes de compra.')).not.toBeInTheDocument()

    // Y la salida está a mano: enumerar el problema sin decir cómo se sale es la
    // mitad del aviso.
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  El panel de la orden (T1236, T1237 y T1238)
//
//  ⚠ Es UN SOLO componente para las dos pantallas (FR-034), y lo que se blinda
//  acá es el defecto 4: **la orden que se recibe tiene que ser, por
//  construcción, la que se abrió**. `Orders.jsx` la resolvía con
//  `selectedSupplier?.orders?.find(o => o.status === 'pending' || …)`, o sea la
//  primera pendiente del proveedor: recibir la #118 cargaba la mercadería, la
//  deuda —con el precio de la otra orden— y el cambio de estado en la #112,
//  mostrando «Mercadería recibida». Eso no se repara después.
//
//  Los casos de abajo atacan las tres formas en que eso puede volver: que el
//  botón de la fila abra otra orden que la fila, que el estado del formulario se
//  indexe por producto en vez de por línea, y que el `PUT` salga contra un id
//  que no es el del panel.
// ════════════════════════════════════════════

/**
 * #501: DOS líneas del mismo producto, con precios distintos.
 *
 * Es el defecto 4 hecho fixture. Indexado por `product_id` hay UN solo campo y
 * dos `key` de React repetidos, así que React dibuja una sola línea y lo que se
 * escriba entra en la que el arreglo tenga última.
 *
 * La línea 0 lleva 12 pedidas y 8 recibidas —máximo 4— y la 1 propone costo.
 */
const DOS_LINEAS_IGUALES = {
  id: 501,
  supplier_id: 3,
  supplier_name: 'Distribuidora Norte',
  date: '2026-07-31',
  status: 'partial',
  total: '22800',
  items: [
    {
      linea: 0, product_id: 41, product_name: 'Colágeno 300g',
      quantity: 12, quantity_received: 8, unit_price: '900',
      costo_actual: '900', propone_costo: false,
    },
    {
      linea: 1, product_id: 41, product_name: 'Colágeno 300g',
      quantity: 10, quantity_received: 0, unit_price: '1200',
      costo_actual: '900', propone_costo: true,
    },
  ],
}

/** #502: dos líneas SIN producto —un flete y una descarga—, que no tienen id. */
const DOS_LINEAS_SIN_PRODUCTO = {
  id: 502,
  supplier_id: 4,
  supplier_name: 'Fletes del Litoral',
  date: '2026-07-29',
  status: 'pending',
  total: '13000',
  items: [
    {
      linea: 0, product_id: null, product_name: 'Flete',
      quantity: 1, quantity_received: 0, unit_price: '9000',
      costo_actual: null, propone_costo: false,
    },
    {
      linea: 1, product_id: null, product_name: 'Descarga',
      quantity: 1, quantity_received: 0, unit_price: '4000',
      costo_actual: null, propone_costo: false,
    },
  ],
}

/** Dos órdenes DISTINTAS del mismo producto: el criterio de éxito 2. */
const ORDEN_601 = {
  id: 601,
  supplier_id: 3,
  supplier_name: 'Distribuidora Norte',
  date: '2026-07-31',
  status: 'pending',
  total: '12000',
  items: [{
    linea: 0, product_id: 41, product_name: 'Colágeno 300g',
    quantity: 10, quantity_received: 0, unit_price: '1200',
    costo_actual: '900', propone_costo: true,
  }],
}

const ORDEN_602 = {
  id: 602,
  supplier_id: 4,
  supplier_name: 'Suplementos del Sur',
  date: '2026-07-30',
  status: 'pending',
  total: '9000',
  items: [{
    linea: 0, product_id: 41, product_name: 'Colágeno 300g',
    quantity: 10, quantity_received: 0, unit_price: '900',
    costo_actual: '900', propone_costo: false,
  }],
}

describe('El panel de la orden, en modo detalle (T1236)', () => {
  it('una orden recibida o anulada no ofrece anular ni recibir', async () => {
    // US2 escenario 8 y FR-017. Un botón que la API va a rechazar es una promesa
    // que la pantalla no puede cumplir: el usuario aprieta «Registrar recepción»
    // sobre una orden ya recibida y le vuelve un error que no explica nada.
    await montar()

    await abrirFila('Mayorista Oeste')

    expect(within(panel()).queryByRole('button', { name: /Anular orden/ })).toBeNull()
    expect(within(panel()).queryByRole('button', { name: /Registrar recepción/ })).toBeNull()

    await cerrarPanel()
    await abrirFila('Almacén Central')

    expect(within(panel()).queryByRole('button', { name: /Anular orden/ })).toBeNull()
    expect(within(panel()).queryByRole('button', { name: /Registrar recepción/ })).toBeNull()

    // Y la pendiente sí las tiene: sin esta mitad, el caso pasaría con un pie
    // que no dibuja ninguna acción nunca.
    await cerrarPanel()
    await abrirFila('Suplementos del Sur')

    expect(within(panel()).getByRole('button', { name: /Anular orden/ })).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: /Registrar recepción/ })).toBeInTheDocument()
  })

  it('las dos acciones de WhatsApp siguen estando', async () => {
    // FR-018. Era la función más usada del sistema anterior, y **una función
    // liberada no se pierde por seguir un dibujo**: la maqueta no las dibuja
    // porque no las conocía. Son dos y no una: al proveedor se le manda el
    // pedido sin precios, y los precios acordados solo cuando se los confirma.
    await montar()

    await abrirFila('Suplementos del Sur')

    expect(within(panel()).getByRole('button', { name: /^WhatsApp/ })).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: /Con precios/ })).toBeInTheDocument()
  })

  it('avisa cuando el proveedor no tiene teléfono cargado', async () => {
    // Sin destinatario WhatsApp abre igual, con el texto escrito y sin chat
    // elegido. Decirlo evita que alguien concluya que el envío falló y lo mande
    // tres veces; callarlo es peor que no abrir nada.
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
    const aviso = vi.spyOn(toast, 'info').mockImplementation(() => {})

    await montar({ proveedores: [{ id: 3, name: 'Suplementos del Sur', phone: null }] })

    await abrirFila('Suplementos del Sur')
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /^WhatsApp/ }))
    })

    expect(abrir).toHaveBeenCalled()
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('no tiene teléfono cargado'))
  })

  it('con el teléfono cargado NO avisa nada', async () => {
    // La otra mitad del caso de arriba: sin ella, un aviso disparado siempre
    // pasaría igual y el usuario leería «el proveedor no tiene teléfono» sobre
    // uno que sí lo tiene.
    vi.spyOn(window, 'open').mockReturnValue(null)
    const aviso = vi.spyOn(toast, 'info').mockImplementation(() => {})

    await montar({
      // El id es el `supplier_id` de PENDIENTE, que es la orden que se abre.
      proveedores: [{ id: 3, name: 'Suplementos del Sur', phone: '3425123456' }],
    })

    await abrirFila('Suplementos del Sur')
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /^WhatsApp/ }))
    })

    expect(aviso).not.toHaveBeenCalled()
  })

  it('la nota de stock solo aparece en una orden recibible', async () => {
    // FR-017. Decirle a alguien que el stock se va a actualizar sobre una orden
    // ya recibida describe algo que no va a pasar, y una nota que a veces miente
    // es una nota que se deja de leer.
    await montar()

    await abrirFila('Suplementos del Sur')

    expect(within(panel()).getByText(/el stock se actualiza en el mismo paso/)).toBeInTheDocument()

    await cerrarPanel()
    await abrirFila('Almacén Central')

    expect(within(panel()).queryByText(/el stock se actualiza en el mismo paso/)).toBeNull()
  })
})

describe('El panel de la orden, en modo recepción (T1237)', () => {
  it('«Recibir» en la SEGUNDA orden abre el panel de la segunda', async () => {
    // ⚠ **Es el defecto 4 y es lo que hay que blindar** (criterio de éxito 1).
    // La forma vieja recibía contra la primera orden pendiente del proveedor:
    // apretar «Recibir» en la segunda cargaba el stock, la deuda y el cambio de
    // estado en la primera, y la pantalla decía «Mercadería recibida».
    await montar({ ordenes: [ORDEN_601, ORDEN_602] })

    await abrirRecepcion('Suplementos del Sur')

    expect(pedidos.some((p) => p.url === '/suppliers/orders/602')).toBe(true)
    expect(pedidos.some((p) => p.url === '/suppliers/orders/601')).toBe(false)
    expect(within(panel()).getByText('#602')).toBeInTheDocument()
  })

  it('confirmar manda UNA sola api.put, con el id de esa orden y con linea en el cuerpo', async () => {
    // `linea` es lo que hace que la mercadería entre donde se escribió: el
    // cuerpo viejo mandaba `{ product_id, quantity_received }` y no alcanzaba
    // para distinguir dos líneas del mismo producto (FR-031).
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { ok: true, data: { id: 602, status: 'received', recibido: [], avisos: [] } },
    })

    await montar({ ordenes: [ORDEN_601, ORDEN_602] })
    await abrirRecepcion('Suplementos del Sur')

    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '10' } })

    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar recepción/ }))
    })

    expect(put).toHaveBeenCalledTimes(1)

    const [url, cuerpo] = put.mock.calls[0]

    expect(url).toBe('/suppliers/orders/602/receive')
    expect(cuerpo.items).toEqual([
      { linea: 0, product_id: 41, cantidad: 10, actualizar_costo: false },
    ])
    // `location` se fue del cuerpo (FR-104): su valor era el literal 'general',
    // que desde que existe `resolverSucursal` no ubicaba nada.
    expect(cuerpo).not.toHaveProperty('location')
  })

  it('dos órdenes con el mismo producto: escribir en una no cambia el campo de la otra', async () => {
    // Criterio de éxito 2. Con el estado indexado por `product_id` y compartido
    // entre aperturas, escribir 7 en la #602 deja el 7 puesto al abrir la #601
    // —que también es Colágeno— y se confirma una cantidad que nadie escribió.
    await montar({ ordenes: [ORDEN_601, ORDEN_602] })

    await abrirRecepcion('Suplementos del Sur')
    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '7' } })
    expect(campoDeLinea('Colágeno 300g', 0)).toHaveValue(7)

    await cerrarPanel()
    await abrirRecepcion('Distribuidora Norte')

    expect(campoDeLinea('Colágeno 300g', 0)).toHaveValue(null)
  })

  it('una orden con dos líneas del mismo producto tiene DOS campos', async () => {
    // Indexado por `product_id` hay UN campo y dos `key` de React repetidos: se
    // dibuja una sola línea, se carga una sola, y la otra queda pendiente para
    // siempre sin que nada falle.
    await montar({ ordenes: [DOS_LINEAS_IGUALES] })

    await abrirRecepcion('Distribuidora Norte')

    const campos = within(panel()).getAllByLabelText(/^Cantidad recibida de Colágeno 300g/)

    expect(campos).toHaveLength(2)

    // Y son campos INDEPENDIENTES: escribir en el segundo no toca el primero.
    fireEvent.change(campoDeLinea('Colágeno 300g', 1), { target: { value: '10' } })

    expect(campoDeLinea('Colágeno 300g', 1)).toHaveValue(10)
    expect(campoDeLinea('Colágeno 300g', 0)).toHaveValue(null)
  })

  it('una orden con dos líneas sin product_id tiene DOS campos', async () => {
    // Un flete y una descarga no tienen `product_id`: indexado por producto, las
    // dos comparten la clave `undefined` y se pisan entre ellas.
    await montar({ ordenes: [DOS_LINEAS_SIN_PRODUCTO] })

    await abrirRecepcion('Fletes del Litoral')

    expect(campoDeLinea('Flete', 0)).toBeInTheDocument()
    expect(campoDeLinea('Descarga', 1)).toBeInTheDocument()

    fireEvent.change(campoDeLinea('Descarga', 1), { target: { value: '1' } })

    expect(campoDeLinea('Flete', 0)).toHaveValue(null)
  })

  it('una línea con 12 pedidas y 8 recibidas tiene máximo 4', async () => {
    // FR-032. Sin el máximo se cargan 12 sobre una línea que ya tenía 8: el
    // servidor recorta a 4 y la pantalla no dice nada, así que el usuario cree
    // que entraron 12.
    await montar({ ordenes: [DOS_LINEAS_IGUALES] })

    await abrirRecepcion('Distribuidora Norte')

    expect(campoDeLinea('Colágeno 300g', 0)).toHaveAttribute('max', '4')
    // Los dos números, a la vista: sin ellos «cuánto falta» hay que calcularlo
    // de memoria contra el detalle.
    expect(within(panel()).getAllByText(/Pedido:/)[0]).toBeInTheDocument()
    expect(campoDeLinea('Colágeno 300g', 1)).toHaveAttribute('max', '10')
  })

  it('la casilla del costo viene marcada y dice de cuánto a cuánto', async () => {
    // Decisión 2 del plan. HOY no pasa nada al recibir más caro, así que el
    // costo de olvidarse es el defecto 3 de nuevo: la casilla marcada con el
    // número a la vista deja el rechazo a un clic; la vacía deja el olvido a
    // cero clics. El umbral lo decidió el servidor (`propone_costo`): acá no se
    // compara nada, o habría una cuarta implementación que puede discrepar.
    await montar({ ordenes: [DOS_LINEAS_IGUALES] })

    await abrirRecepcion('Distribuidora Norte')

    const casillas = within(panel()).getAllByRole('checkbox')

    expect(casillas).toHaveLength(1)
    expect(casillas[0]).toBeChecked()
    expect(casillas[0]).toHaveAccessibleName('Actualizar el costo · Colágeno 300g: $900,00 → $1.200,00')
  })

  it('confirmar dos veces seguidas produce UNA llamada', async () => {
    // FR-036. Dos `PUT` son dos recepciones de la misma mercadería y dos
    // movimientos de deuda, y eso hay que deshacerlo a mano. El candado es un
    // `ref` y no el estado: React agrupa las actualizaciones, así que dos clics
    // en el mismo tick leen los dos `enviando === false`.
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { ok: true, data: { id: 602, status: 'received', recibido: [], avisos: [] } },
    })

    await montar({ ordenes: [ORDEN_602] })
    await abrirRecepcion('Suplementos del Sur')

    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '10' } })

    const confirmar = within(panel()).getByRole('button', { name: /Confirmar recepción/ })

    await act(async () => {
      fireEvent.click(confirmar)
      fireEvent.click(confirmar)
    })

    expect(put).toHaveBeenCalledTimes(1)
  })

  it('dice cuánto entró de verdad cuando el servidor recortó', async () => {
    // FR-033. Hasta este hito la pantalla decía «Mercadería recibida» y nada
    // más: alguien escribía 9 sobre una línea con 4 pendientes, el servidor
    // cargaba 4, y el sistema respondía que todo salió bien.
    vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        ok: true,
        data: {
          id: 501,
          status: 'partial',
          recibido: [{ linea: 0, product_name: 'Colágeno 300g', recibido_ahora: 4, pendiente: 0 }],
          avisos: ['Se pidieron 12 de «Colágeno 300g» y ya había 8: entraron 4.'],
        },
      },
    })

    await montar({ ordenes: [DOS_LINEAS_IGUALES] })
    await abrirRecepcion('Distribuidora Norte')

    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '9' } })

    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar recepción/ }))
    })

    expect(within(panel()).getByText('Entraron 4')).toBeInTheDocument()
    // Los avisos se muestran como frases y NO se parsean: todo lo que la
    // pantalla necesita por producto ya viene en `recibido[]`.
    expect(within(panel()).getByText(/entraron 4\./)).toBeInTheDocument()
  })

  it('un error del servidor deja el panel abierto con las cantidades escritas y muestra el mensaje del servidor', async () => {
    // FR-035 y FR-095. Cerrar el panel obliga a escribir todo de nuevo justo
    // cuando algo salió mal, y `console.error` deja al usuario apretando un
    // botón que no hace nada. «La orden ya fue recibida completa» es el único
    // mensaje que sabe de qué orden habla.
    vi.spyOn(api, 'put').mockRejectedValue({
      response: { data: { error: 'La orden ya fue recibida completa' } },
    })

    await montar({ ordenes: [ORDEN_602] })
    await abrirRecepcion('Suplementos del Sur')

    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '6' } })

    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar recepción/ }))
    })

    expect(panel()).not.toBeNull()
    expect(within(panel()).getByText('La orden ya fue recibida completa')).toBeInTheDocument()
    expect(campoDeLinea('Colágeno 300g', 0)).toHaveValue(6)
  })

  it('sin ordenes_compra.recibir la acción está deshabilitada CON su explicación, no ausente', async () => {
    // FR-019. Un botón que no está no se distingue de una función que no existe,
    // y el usuario llama para preguntar por qué el sistema «ya no deja recibir».
    await montar({ ordenes: [ORDEN_602], permisos: ['ordenes_compra.ver'] })

    await abrirRecepcion('Suplementos del Sur')

    const confirmar = within(panel()).getByRole('button', { name: /Confirmar recepción/ })

    expect(confirmar).toBeDisabled()
    expect(within(panel()).getByText(/ordenes_compra\.recibir/)).toBeInTheDocument()
  })

  it('sin ordenes_compra.anular la acción está deshabilitada CON su explicación, no ausente', async () => {
    const { unmount } = await montar({
      ordenes: [ORDEN_602],
      permisos: ['ordenes_compra.ver', 'ordenes_compra.recibir'],
    })

    await abrirFila('Suplementos del Sur')

    expect(within(panel()).getByRole('button', { name: /Anular orden/ })).toBeDisabled()
    expect(within(panel()).getByText(/ordenes_compra\.anular/)).toBeInTheDocument()

    // Y con el permiso puesto no queda ninguna explicación de más: una pantalla
    // que explica permisos que sí se tienen enseña a ignorar el texto.
    unmount()
    await montar({ ordenes: [ORDEN_602] })
    await abrirFila('Suplementos del Sur')

    expect(within(panel()).getByRole('button', { name: /Anular orden/ })).toBeEnabled()
    expect(within(panel()).queryByText(/Necesitás el permiso/)).toBeNull()
  })
})

describe('El panel se abre desde los dos lugares de la fila (T1238)', () => {
  it('el botón Recibir de la fila abre el MISMO panel que la fila, en modo recepción', async () => {
    // Decisión 7 del plan: los dos caminos pasan por `abrirOrden`, y eso es lo
    // que hace que la orden que se recibe sea, por construcción, la que se
    // abrió. Un diálogo aparte para la recepción es la alternativa descartada:
    // son dos componentes que necesitan la misma orden, las mismas líneas y los
    // mismos permisos.
    await montar({ ordenes: [ORDEN_602] })

    await abrirFila('Suplementos del Sur')

    const desdeLaFila = panel()

    expect(within(desdeLaFila).getByRole('button', { name: /Registrar recepción/ })).toBeInTheDocument()
    expect(within(desdeLaFila).queryByRole('button', { name: /Confirmar recepción/ })).toBeNull()

    await cerrarPanel()
    await abrirRecepcion('Suplementos del Sur')

    // El MISMO panel —el mismo `data-slot`, el mismo encabezado— y en modo
    // recepción: el formulario, no el detalle.
    expect(within(panel()).getByText('#602')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: /Confirmar recepción/ })).toBeInTheDocument()
    expect(campoDeLinea('Colágeno 300g', 0)).toBeInTheDocument()
  })

  it('cerrar el panel deja el filtro, el segmento y la página donde estaban', async () => {
    // Criterio 16 y el «Independent Test» de US2. Es la razón de que sea un
    // panel y no una pantalla: el usuario abre una orden, la mira y vuelve a la
    // lista que tenía. Resetear el filtro al cerrar obliga a filtrar de nuevo
    // después de cada orden, que con veinte por revisar es veinte veces.
    await montar({ ordenes: VARIAS })

    await act(async () => { fireEvent.click(segmento('Pendientes')) })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Buscar órdenes'), { target: { value: 'Este' } })
    })

    expect(screen.getByText('Insumos del Este')).toBeInTheDocument()
    expect(screen.queryByText('Almacén Central')).toBeNull()

    await abrirFila('Insumos del Este')
    await cerrarPanel()

    expect(screen.getByLabelText('Buscar órdenes')).toHaveValue('Este')
    expect(segmento('Pendientes')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Insumos del Este')).toBeInTheDocument()
    expect(screen.queryByText('Almacén Central')).toBeNull()
  })
})

// ════════════════════════════════════════════
//  La sucursal de destino de la recepción (T1249)
//
//  US10, FR-103. Hasta acá la mercadería entraba SIEMPRE en la sucursal por
//  defecto de la empresa: quien recibía un camión en el depósito tenía que hacer
//  una transferencia después de cada recepción, y si se la olvidaba el sistema
//  decía que el stock estaba en el local que vende.
//
//  Lo que se afirma es el DIBUJO y el EFECTO —que el desplegable aparezca solo
//  cuando hay algo que elegir, con cuál viene puesto, y qué sale por la red—. En
//  qué fila de `Stock` termina la mercadería es de la API y ya está en
//  `apps/api/src/tests/recepcionDeOrden.test.js` (T1248).
//
//  ⚠ Las dos sucursales vienen de `empresaActiva.puntosDeVenta`, que es la misma
//  entrada del store que dibuja el selector del encabezado y la misma de la que
//  sale la cabecera `X-Punto-De-Venta-Id`.
// ════════════════════════════════════════════

describe('La sucursal de destino de la recepción (T1249)', () => {
  it('con una sola sucursal NO hay selector', async () => {
    // US10 escenario 2, y no es un detalle: un control con una sola opción no
    // decide nada y hace dudar de si había algo que elegir. La empresa de una
    // sola sucursal es la mayoría, así que es la pantalla que más se ve.
    await montar({ ordenes: [ORDEN_602], sucursales: [CENTRO] })

    await abrirRecepcion('Suplementos del Sur')

    expect(within(panel()).queryByLabelText('Sucursal de destino')).toBeNull()

    // Y el formulario sí está: sin esta mitad el caso pasaría con un panel que
    // no dibujó nada, que es como se archivan los tests que no prueban nada.
    expect(campoDeLinea('Colágeno 300g', 0)).toBeInTheDocument()
  })

  it('con dos, la vigente viene preseleccionada', async () => {
    // FR-103. La vigente es la que el servidor iba a usar igual —viaja en la
    // cabecera `X-Punto-De-Venta-Id`—, así que arrancar en blanco obligaría a
    // elegir en el 90 % de las recepciones, que son a la sucursal en la que la
    // persona ya está parada.
    //
    // La vigente es la SEGUNDA de la lista a propósito: preseleccionar «la
    // primera» pasaría igual si fuera la primera, y esa es justo la confusión
    // que hace que la mercadería entre en el local equivocado sin que se note.
    await montar({ ordenes: [ORDEN_602], sucursales: [CENTRO, RUTA], vigente: RUTA })

    await abrirRecepcion('Suplementos del Sur')

    const selector = within(panel()).getByLabelText('Sucursal de destino')

    expect(selector).toHaveValue(String(RUTA.id))
    expect(within(selector).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Centro', 'Depósito Ruta 11'])
  })

  it('la sucursal elegida viaja en el cuerpo de la recepción', async () => {
    // US10 escenario 3. Sin el campo en el cuerpo, el desplegable es un control
    // que se mueve y no cambia nada: el usuario elige el depósito, el servidor
    // recibe en el local por defecto y la pantalla dice que todo salió bien. Es
    // el mismo defecto que `location: 'general'`, que tampoco ubicaba nada.
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { ok: true, data: { id: 602, status: 'received', recibido: [], avisos: [] } },
    })

    await montar({ ordenes: [ORDEN_602], sucursales: [CENTRO, RUTA], vigente: CENTRO })
    await abrirRecepcion('Suplementos del Sur')

    fireEvent.change(within(panel()).getByLabelText('Sucursal de destino'), {
      target: { value: String(RUTA.id) },
    })
    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '10' } })

    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar recepción/ }))
    })

    const [, cuerpo] = put.mock.calls[0]

    // NÚMERO y no texto: el `value` de un `<option>` es un string, y
    // `resolverSucursal` lo pasa por `findScoped`. Un `'9'` resuelve igual, pero
    // el contrato dice número y el día que alguien compare con `===` contra el
    // id de la empresa, un string deja de resolver sin que nada falle acá.
    expect(cuerpo.punto_de_venta_id).toBe(RUTA.id)
    // Y NO es la vigente que venía puesta: sin esta mitad, mandar siempre la
    // vigente e ignorar el desplegable pasaría el caso.
    expect(cuerpo.punto_de_venta_id).not.toBe(CENTRO.id)
  })

  it('con una sola sucursal el cuerpo NO lleva punto_de_venta_id', async () => {
    // La otra mitad del primero. Con una sola sucursal no hay nada que elegir,
    // así que el cuerpo sale como salía y el servidor la resuelve por la
    // cabecera o por la sucursal por defecto —el camino de siempre—. Mandar el
    // id «por las dudas» agrega un valor que nadie eligió a un camino que ya
    // funcionaba, y con él un 400 nuevo: `resolverSucursal` responde «Punto de
    // venta inválido» ante cualquier id que no sea de la empresa.
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { ok: true, data: { id: 602, status: 'received', recibido: [], avisos: [] } },
    })

    await montar({ ordenes: [ORDEN_602], sucursales: [CENTRO] })
    await abrirRecepcion('Suplementos del Sur')

    fireEvent.change(campoDeLinea('Colágeno 300g', 0), { target: { value: '10' } })

    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar recepción/ }))
    })

    expect(put.mock.calls[0][1]).not.toHaveProperty('punto_de_venta_id')
  })
})
