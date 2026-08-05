import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Orders from '@/pages/Orders'

// ════════════════════════════════════════════
//  ADMINAPP · /proveedores, renderizado
//
//  Lo que se afirma acá es EL DIBUJO Y EL EFECTO. Las reglas —cuál de los cuatro
//  estados describe una cuenta, qué tonos le tocan, cómo se escribe un importe y
//  cómo una fecha— ya están en `utils/cuentaDeProveedor.test.js` y
//  `utils/formato.test.js`, que son cien veces más baratos y no se rompen cuando
//  alguien mueve un `<div>`.
//
//  Acá se verifica que el badge esté en la fila del proveedor que corresponde,
//  que el saldo grande sea el MISMO número que la columna de la lista, que el
//  historial se dibuje sin reordenar el arreglo que llegó, y que recibir desde
//  esta pantalla mande el id de la orden que se abrió y no el de otra.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports de esta pantalla
//  arrastra decenas de exportaciones nombradas y la lista se desactualiza sola.
//  Se espía la instancia de axios, que es lo que manda `CONVENCIONES.md`.
//
//  ── Por qué las filas se buscan por su `grid-template-columns` ──
//
//  La lista y las dos tablas son grids y no `<table>`, así que no hay
//  `role="row"`. Subir desde el nombre hasta el contenedor que declara columnas
//  es la única forma de agarrar la fila.
//
//  ⚠ Y el nombre del proveedor elegido se dibuja DOS veces —en su fila y en el
//  encabezado de la cuenta—, así que la búsqueda se hace SIEMPRE dentro de la
//  región «Lista de proveedores». Sin eso, `getByText` encuentra dos elementos y
//  falla por un motivo que no tiene nada que ver con lo que el caso verifica.
//
//  ⚠ Lo que este archivo NO puede afirmar: que la tabla scrollee dentro de su
//  tarjeta, que el saldo grande sea el elemento de más peso visual, ni que la
//  columna derecha entre al lado de la izquierda. jsdom devuelve CERO en
//  `scrollWidth`, `clientWidth` y `getBoundingClientRect`, así que un test que
//  los mire pasa con y sin el cambio. Eso va al navegador.
// ════════════════════════════════════════════

/** Los cuatro estados de una cuenta, uno por proveedor (US5 escenario 2). */
const SIN_MOVIMIENTOS = {
  id: 6,
  name: 'Almacén Central',
  // DECIMAL como texto, que es como lo devuelve Postgres: `'0.00' === 0` es
  // `false` y esa es justo la coerción que `estadoDeProveedor` documenta.
  deuda: '0.00',
  pagado: '0.00',
  saldo: '0.00',
  pendiente_de_recibir: 0,
  movimientos: 0,
  documentos: 0,
}

const CON_DEUDA = {
  id: 3,
  name: 'Distribuidora Norte',
  cuit: '30712345678',
  phone: '1122334455',
  deuda: 12345.6,
  pagado: 0,
  saldo: 12345.6,
  pendiente_de_recibir: 4800,
  movimientos: 3,
  documentos: 0,
}

const PAGO_PARCIAL = {
  id: 4,
  name: 'Mayorista Oeste',
  deuda: 10000,
  pagado: 4000,
  saldo: 6000,
  pendiente_de_recibir: 0,
  movimientos: 5,
  documentos: 2,
}

const SALDADO = {
  id: 5,
  name: 'Suplementos del Sur',
  deuda: 5000,
  pagado: 5000,
  saldo: 0,
  pendiente_de_recibir: 0,
  movimientos: 4,
  documentos: 1,
}

/** En el orden que los manda el servidor: por nombre, ascendente. */
const CUATRO = [SIN_MOVIMIENTOS, CON_DEUDA, PAGO_PARCIAL, SALDADO]

/** Lo que el badge tiene que decir en cada fila. */
const BADGE_ESPERADO = {
  'Almacén Central': 'Sin movimientos',
  'Distribuidora Norte': 'Con deuda',
  'Mayorista Oeste': 'Pago parcial',
  'Suplementos del Sur': 'Saldado',
}

/**
 * Una página del historial, **a propósito en un orden que no es el de ninguna
 * comparación por fecha**.
 *
 * El servidor la manda descendente por fecha, desempatando por id, y la pantalla
 * la dibuja tal cual: FR-053 dice que el orden lo decide el servidor porque el
 * historial pagina, y un orden decidido en el navegador es un orden sobre un
 * subconjunto.
 *
 * ⚠ La fixture viene desordenada **para que el caso pueda ponerse en rojo**: si
 * estuviera ya descendente, volver a poner el `.sort()` sobre el arreglo del
 * estado no cambiaría ni el dibujo ni el arreglo, y el test pasaría con y sin el
 * defecto — que es exactamente lo que no vale.
 */
const MOVIMIENTOS = [
  { id: 7, date: '2026-07-10', type: 'deuda', amount: '1234', notes: 'Orden vieja', saldo: 1234 },
  { id: 9, date: '2026-08-01', type: 'deuda', amount: '9000', notes: 'Recepción de agosto', saldo: 10234 },
  { id: 8, date: '2026-07-28', type: 'pago', amount: '4000', payment_method: 'tr', notes: 'A cuenta', saldo: 6234 },
]

/** Dos órdenes pendientes del MISMO proveedor: es el defecto 4 de este lado. */
const PRIMERA_PENDIENTE = {
  id: 112,
  supplier_id: 3,
  supplier_name: 'Distribuidora Norte',
  date: '2026-07-28',
  status: 'pending',
  total: '4200',
  items: [{ product_id: 2, product_name: 'Whey 1kg', quantity: 10, quantity_received: 0, unit_price: '420' }],
}

const SEGUNDA_PENDIENTE = {
  id: 118,
  supplier_id: 3,
  supplier_name: 'Distribuidora Norte',
  date: '2026-07-31',
  status: 'pending',
  total: '12000',
  items: [{ product_id: 1, product_name: 'Colágeno 300g', quantity: 12, quantity_received: 0, unit_price: '1000' }],
}

const TODOS = [
  'proveedores.ver',
  'proveedores.editar',
  'proveedores.eliminar',
  'ordenes_compra.ver',
  'ordenes_compra.recibir',
  'ordenes_compra.anular',
]

/**
 * El detalle ENRIQUECIDO de `GET /suppliers/orders/:id` (T1208).
 *
 * El listado no trae `linea`, `costo_actual` ni `propone_costo`, y sin esos tres
 * la recepción no sabe a qué línea va la mercadería. Doblar la API con la fila
 * del listado dejaría al panel probándose contra datos que el servidor no
 * produce.
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

const respuesta = (data) => Promise.resolve({ data })

async function montar({
  proveedores = CUATRO,
  movimientos = MOVIMIENTOS,
  totalDeMovimientos = movimientos.length,
  ordenes = [],
  documentos = [],
  // Lo que devuelve `GET /suppliers/:id/movimientos/export`. Un objeto con
  // `response` adentro se dobla como RECHAZO, que es la forma en que axios
  // entrega un 400: el caso del límite necesita justamente eso.
  exportacion = { ok: true, total: 0, data: [] },
  permisos = TODOS,
} = {}) {
  useStore.setState({ permisos })

  vi.spyOn(api, 'get').mockImplementation((url, config) => {
    pedidos.push({ url, params: config?.params })

    if (url === '/suppliers') {
      return respuesta({ ok: true, total: proveedores.length, data: proveedores })
    }

    if (url === '/suppliers/orders') {
      const delProveedor = ordenes.filter((o) => o.supplier_id === config?.params?.supplier_id)
      return respuesta({ ok: true, total: delProveedor.length, data: delProveedor })
    }

    const detalle = ordenes.find((o) => url === `/suppliers/orders/${o.id}`)
    if (detalle) return respuesta({ ok: true, data: enriquecer(detalle) })

    if (/^\/suppliers\/\d+\/movimientos\/export$/.test(url)) {
      if (exportacion?.response) return Promise.reject(exportacion)
      return respuesta(exportacion)
    }

    if (/^\/suppliers\/\d+\/movimientos$/.test(url)) {
      return respuesta({ ok: true, total: totalDeMovimientos, saldo_inicial: 0, data: movimientos })
    }

    const ficha = proveedores.find((s) => url === `/suppliers/${s.id}`)
    if (ficha) return respuesta({ ok: true, data: { ...ficha, documents: documentos } })

    return respuesta({ ok: true, data: [] })
  })

  let utilidades
  await act(async () => { utilidades = render(<Orders />) })

  return utilidades
}

/** La región de la izquierda, que es donde viven las filas de la lista. */
const lista = () => screen.getByRole('region', { name: 'Lista de proveedores' })

/** La fila de un proveedor, buscada SIEMPRE dentro de la lista. */
const filaDe = (nombre) =>
  within(lista()).getByText(nombre).closest('[style*="grid-template-columns"]')

/** La tarjeta de la derecha que tiene ese título. */
const bloque = (titulo) =>
  screen.getByRole('heading', { level: 2, name: titulo }).closest('section')

/** El `grid-template-columns` declarado en línea, tal cual. */
function columnasDe(elemento) {
  const estilo = elemento?.getAttribute('style') || ''
  const encontrado = estilo.match(/grid-template-columns:\s*([^;]+)/)

  return encontrado ? encontrado[1].trim() : null
}

/** Elige un proveedor de la lista y espera a las tres llamadas que dispara. */
async function elegir(nombre) {
  await act(async () => { fireEvent.click(filaDe(nombre)) })
  await act(async () => {})
}

/** El panel lateral de la orden, mientras está abierto. */
const panel = () => document.querySelector('[data-slot="sheet-content"]')

/** El diálogo abierto, que base-ui dibuja en un portal. */
const dialogo = () => document.querySelector('[data-slot="dialog-content"]')

/**
 * El diálogo que tiene ese título, entre todos los que haya abiertos.
 *
 * ⚠ Hace falta desde T1244: la confirmación de un pago mayor al saldo se abre
 * **encima** del formulario de pago, así que hay DOS `[data-slot="dialog-content"]`
 * en el documento y `dialogo()` devuelve el primero, que es el de atrás.
 */
const dialogoTitulado = (titulo) =>
  [...document.querySelectorAll('[data-slot="dialog-content"]')].find((d) =>
    d.querySelector('[data-slot="dialog-title"]')?.textContent?.includes(titulo)
  )

/**
 * El texto de la confirmación de `useConfirmDialog`.
 *
 * Es el ÚNICO `DialogDescription` de la pantalla —los otros cuatro diálogos usan
 * solo `DialogTitle`—, así que el selector no puede agarrar otra cosa. Buscar
 * por texto suelto sí podría: `$12.345,60` se dibuja además en la fila de la
 * lista y en el saldo grande, y un caso que mirara `document.body` pasaría sin
 * que la confirmación existiera.
 */
const textoDeLaConfirmacion = () =>
  document.querySelector('[data-slot="dialog-description"]')?.textContent || ''

/** Abre el formulario de pago del proveedor ya elegido. */
async function abrirPago() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Registrar pago/ }))
  })
}

/** Manda el formulario de un diálogo por su título. */
async function enviar(titulo) {
  await act(async () => {
    fireEvent.submit(dialogoTitulado(titulo).querySelector('form'))
  })
}

beforeEach(() => { pedidos = [] })
afterEach(() => { vi.restoreAllMocks() })

// ════════════════════════════════════════════
//  T1240 · La lista: cada badge en su fila
// ════════════════════════════════════════════

describe('La lista de proveedores dice a quién se le debe (T1240)', () => {
  it('el badge de deuda está en la fila del proveedor que corresponde', async () => {
    // US5 escenario 2. El error clásico del `map` —dibujar el badge con el
    // estado del proveedor anterior— no falla, no avisa, y deja a alguien
    // decidiendo a quién pagar con los colores corridos una fila. Por eso se
    // mira CADA fila con `within` y no se busca el texto suelto en la pantalla.
    await montar()

    for (const [nombre, etiqueta] of Object.entries(BADGE_ESPERADO)) {
      expect(within(filaDe(nombre)).getByText(etiqueta)).toBeInTheDocument()
    }
  })

  it('el badge de «Con deuda» sale de los tokens y NO de un color suelto', async () => {
    // FR-056. Los tres tonos van juntos —línea, fondo y texto—: un color de
    // estado sobre el fondo de la tarjeta, sin fondo suave ni línea, se lee como
    // un error de estilo.
    await montar()

    const badge = within(filaDe('Distribuidora Norte')).getByText('Con deuda')

    expect(badge).toHaveClass('border-danger-line', 'bg-danger-soft', 'text-danger')
  })

  it('un proveedor con movimientos y sin un solo documento se marca «Sin factura»', async () => {
    // FR-086. Sin el aviso, la falta de respaldo de todo lo que se le compró a
    // un proveedor no se ve desde ninguna pantalla.
    await montar()

    expect(within(filaDe('Distribuidora Norte')).getByText('Sin factura')).toBeInTheDocument()

    // Y el que tiene documentos NO lo lleva: sin esta mitad, un badge dibujado
    // en todas las filas pasaría la primera afirmación.
    expect(within(filaDe('Mayorista Oeste')).queryByText('Sin factura')).toBeNull()

    // El que no tiene ni movimientos ni pedidos tampoco: todavía no hay nada de
    // qué guardar factura, y marcarlo sería un aviso que no se puede atender.
    expect(within(filaDe('Almacén Central')).queryByText('Sin factura')).toBeNull()
  })

  it('el saldo grande del seleccionado es el MISMO número que su columna en la lista', async () => {
    // US5 escenario 5. Los dos números salen del servidor —el listado y la
    // ficha los calculan con la misma función (FR-101)— y la pantalla los
    // escribe con el mismo `pesos`. Si alguno se formateara distinto, las dos
    // mitades de la pantalla dirían importes distintos del mismo saldo.
    await montar()
    await elegir('Distribuidora Norte')

    const enLaLista = within(filaDe('Distribuidora Norte')).getByText(/^\$/)
    const enGrande = within(screen.getByText('Saldo pendiente').parentElement).getByText(/^\$/)

    expect(enLaLista).toHaveTextContent('$12.345,60')
    expect(enGrande).toHaveTextContent(enLaLista.textContent)
  })

  it('un error de la API muestra el mensaje del servidor y no «Request failed»', async () => {
    // Criterio 14 y FR-095. `err.message` de axios es «Request failed with
    // status code 400»: no dice qué falló, no dice qué corregir y no se puede
    // dictar por teléfono. El texto que sirve viaja en el cuerpo.
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    vi.spyOn(api, 'post').mockRejectedValue({
      message: 'Request failed with status code 400',
      response: { data: { ok: false, error: 'Ya existe un proveedor con ese nombre.' } },
    })

    await montar()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nuevo proveedor/ }))
    })

    await act(async () => {
      fireEvent.submit(dialogo().querySelector('form'))
    })

    expect(aviso).toHaveBeenCalledWith('Ya existe un proveedor con ese nombre.')
    expect(aviso).not.toHaveBeenCalledWith('Request failed with status code 400')
  })

  it('la búsqueda por nombre la resuelve el servidor, y sin texto no manda el parámetro', async () => {
    // FR-059. La comparación es sin acentos y sin distinguir mayúsculas y está
    // escrita en SQL (`translate` sobre la columna): filtrar en el navegador
    // sería escribirla por segunda vez, y buscar solo dentro de la página
    // cargada. `q` viaja por PRESENCIA, como el resto de los filtros.
    await montar()

    expect(pedidos.filter((p) => p.url === '/suppliers')).toHaveLength(1)
    expect(pedidos[0].params).toEqual({ limit: 200 })

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Buscar proveedores'), { target: { value: 'norte' } })
    })

    // La espera del rebote es real: escribir «Distribuidora» no puede salir como
    // trece consultas.
    await act(async () => { await new Promise((listo) => setTimeout(listo, 400)) })

    const ultima = pedidos.filter((p) => p.url === '/suppliers').pop()

    expect(ultima.params).toEqual({ limit: 200, q: 'norte' })
  })
})

// ════════════════════════════════════════════
//  T1241 · La cuenta: el saldo, los totales y el historial
// ════════════════════════════════════════════

describe('La cuenta del proveedor elegido (T1241)', () => {
  it('el resumen muestra comprado y pagado además del saldo', async () => {
    // US5 escenario 6. Un saldo de $0 no distingue «nunca le compré» de «le
    // compré y le pagué todo», que es lo que mostraba el sistema viejo. Y
    // «pedido pendiente de recibir» es la decisión 2 de la spec hecha número: la
    // deuda es la mercadería recibida, así que lo pedido y no entregado va
    // aparte y con su etiqueta.
    await montar()
    await elegir('Distribuidora Norte')

    const comprado = screen.getByText('Total comprado').parentElement
    const pagado = screen.getByText('Total pagado').parentElement
    const pendiente = screen.getByText('Pedido pendiente').parentElement

    expect(within(comprado).getByText('$12.345,60')).toBeInTheDocument()
    expect(within(pagado).getByText('$0,00')).toBeInTheDocument()
    expect(within(pendiente).getByText('$4.800,00')).toBeInTheDocument()
  })

  it('el historial se dibuja en el orden del servidor SIN que el arreglo cambie de orden', async () => {
    // FR-053 y US5 escenario 8. La línea que había hacía
    // `selectedSupplier.movements?.sort(...)` **sobre el arreglo del estado de
    // React**: una mutación en medio de un render, y un orden decidido sobre una
    // página que es un subconjunto de la cuenta.
    //
    // La copia se guarda ANTES de montar y se compara después: es lo que
    // detecta la mutación aunque el dibujo quedara igual.
    const original = MOVIMIENTOS.map((m) => m.id)

    await montar()
    await elegir('Distribuidora Norte')

    const fechas = within(bloque('Historial de cuenta'))
      .getAllByText(/^\d{2}\/\d{2}\/\d{4}$/)
      .map((e) => e.textContent)

    expect(fechas).toEqual(['10/07/2026', '01/08/2026', '28/07/2026'])
    expect(MOVIMIENTOS.map((m) => m.id)).toEqual(original)
  })

  it('un movimiento del 1 de agosto se ve 01/08 y no 31/07', async () => {
    // Criterio 9 y FR-052. Un DATEONLY viaja como «2026-08-01» y
    // `new Date('2026-08-01')` lo lee como medianoche UTC: en Argentina (UTC−3)
    // eso es el 31 de julio a las 21, así que el movimiento del primero de
    // agosto se muestra en julio y se lee en el mes equivocado de la cuenta.
    await montar()
    await elegir('Distribuidora Norte')

    const historial = bloque('Historial de cuenta')

    expect(within(historial).getByText('01/08/2026')).toBeInTheDocument()
    expect(within(historial).queryByText('31/07/2026')).toBeNull()
  })

  it('un importe entero se ve $1.234,00', async () => {
    // Criterio 10 y FR-051. Con `minimumFractionDigits` sin su máximo, en la
    // misma columna conviven dos decimales y tres según qué traiga el dato, y
    // alinear a la derecha deja de servir para compararlos.
    await montar()
    await elegir('Distribuidora Norte')

    const fila = within(bloque('Historial de cuenta'))
      .getByText('Orden vieja')
      .closest('[style*="grid-template-columns"]')

    expect(within(fila).getByText('$1.234,00')).toBeInTheDocument()
  })

  it('el encabezado y las filas del historial comparten el MISMO grid-template-columns', async () => {
    // FR-058. Cuando difieren, las etiquetas dejan de estar sobre sus datos y se
    // lee un importe bajo «Notas».
    await montar()
    await elegir('Distribuidora Norte')

    const historial = bloque('Historial de cuenta')
    const encabezado = within(historial).getByText('Haber').closest('[style*="grid-template-columns"]')
    // La fila de un PAGO, que es la que lleva el método entre paréntesis pegado
    // a las notas: se busca por el `title`, que es el texto sin ese agregado.
    const fila = within(historial).getByTitle('A cuenta').closest('[style*="grid-template-columns"]')

    // La sexta columna la agregó T1245, con los botones de corregir y eliminar:
    // el string vive en UN solo lugar del archivo, así que agregarla no puede
    // dejar el encabezado con cinco y las filas con seis.
    expect(columnasDe(encabezado)).toBe('96px 116px minmax(0,1fr) 116px 116px 72px')
    expect(columnasDe(fila)).toBe(columnasDe(encabezado))
  })

  it('un proveedor sin movimientos muestra el estado vacío y no una tabla en blanco', async () => {
    // US5 escenario 9. Una tabla con encabezados y sin filas parece un error de
    // carga: se dice qué pasa y qué hacer.
    await montar({ movimientos: [], totalDeMovimientos: 0 })
    await elegir('Almacén Central')

    const historial = bloque('Historial de cuenta')

    expect(within(historial).getByText('Todavía no hay movimientos en esta cuenta.')).toBeInTheDocument()
    expect(within(historial).queryByText('Haber')).toBeNull()
  })

  it('sin ningún proveedor elegido se dice qué hacer, y no queda media pantalla en blanco', async () => {
    // US5 escenario 10.
    await montar()

    expect(screen.getByText('Elegí un proveedor de la lista.')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1242 · Las órdenes del proveedor, en el MISMO panel
// ════════════════════════════════════════════

describe('Las órdenes del proveedor abren el panel compartido (T1242)', () => {
  it('recibir desde Proveedores usa el MISMO componente y manda el id de la orden que se abrió', async () => {
    // ⚠ Es el defecto 4 del lado de esta pantalla. El botón «Confirmar
    // Recepción» resolvía qué orden recibir con
    //
    //     selectedSupplier?.orders?.find(o => o.status === 'pending' || …)
    //
    // o sea **la primera pendiente del proveedor**: recibir la segunda cargaba
    // la mercadería, la deuda —con el precio de la otra orden— y el cambio de
    // estado en la primera, mostrando «Mercadería recibida». Por eso las dos
    // fixtures están pendientes y se abre la SEGUNDA.
    const enviado = vi.spyOn(api, 'put').mockResolvedValue({
      data: { ok: true, data: { recibido: [], avisos: [], costos: [] } },
    })

    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE] })
    await elegir('Distribuidora Norte')

    const fila = within(bloque('Órdenes de compra'))
      .getByText('#118')
      .closest('[style*="grid-template-columns"]')

    await act(async () => {
      fireEvent.click(within(fila).getByTitle('Recibir mercadería'))
    })

    // El panel es el de `/ordenes-compra`: mismo formulario, misma etiqueta por
    // línea —con el número de línea, porque dos líneas del mismo producto tienen
    // el mismo nombre— y mismo botón.
    const campo = within(panel()).getByLabelText('Cantidad recibida de Colágeno 300g (línea 0)')

    await act(async () => { fireEvent.change(campo, { target: { value: '5' } }) })
    await act(async () => {
      fireEvent.click(within(panel()).getByRole('button', { name: /Confirmar recepción/ }))
    })

    expect(enviado).toHaveBeenCalledTimes(1)
    expect(enviado.mock.calls[0][0]).toBe('/suppliers/orders/118/receive')
    expect(enviado.mock.calls[0][1]).toEqual({
      items: [{ linea: 0, product_id: 1, cantidad: 5, actualizar_costo: false }],
    })
  })

  it('sin ordenes_compra.ver el bloque explica el permiso y no dice «sin órdenes»', async () => {
    // ⚠ Riesgo 12 del plan. `GET /suppliers/:id` dejó de traer las órdenes en el
    // include, y el endpoint que las tiene exige otro permiso: quien solo tiene
    // `proveedores.ver` dejó de verlas. «No tenés permiso» y «no hay órdenes»
    // son cosas distintas, y el segundo texto hace concluir que las órdenes del
    // proveedor se perdieron.
    await montar({
      ordenes: [PRIMERA_PENDIENTE],
      permisos: ['proveedores.ver'],
    })
    await elegir('Distribuidora Norte')

    const seccion = bloque('Órdenes de compra')

    expect(within(seccion).getByText('No tenés permiso para ver las órdenes de compra.')).toBeInTheDocument()
    expect(within(seccion).queryByText('Este proveedor no tiene órdenes de compra.')).toBeNull()

    // Y no se pide lo que se sabe que va a responder 403: un `console.error`
    // mudo sobre esa respuesta es cómo el caso terminaría dibujando el estado
    // vacío equivocado.
    expect(pedidos.filter((p) => p.url === '/suppliers/orders')).toHaveLength(0)
  })

  it('el clic en la fila abre el detalle de ESA orden, y una sola vez', async () => {
    // La fila entera abre el panel, así que sin `stopPropagation` apretar
    // «Recibir» dispararía además el handler de la fila: dos aperturas de un
    // clic y el modo que gana es el de la segunda.
    //
    // ⚠ Se abre la SEGUNDA fila, no la primera. Con la primera, un handler que
    // ignorara la fila y abriera siempre `ordenes[0]` pasaría el caso: sería un
    // test que pasa con y sin el defecto, que es lo que no vale.
    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE] })
    await elegir('Distribuidora Norte')

    const fila = within(bloque('Órdenes de compra'))
      .getByText('#118')
      .closest('[style*="grid-template-columns"]')

    await act(async () => { fireEvent.click(fila) })

    expect(pedidos.filter((p) => p.url === '/suppliers/orders/118')).toHaveLength(1)
    expect(pedidos.filter((p) => p.url === '/suppliers/orders/112')).toHaveLength(0)
    expect(within(panel()).getByText(/Colágeno 300g/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1244 · El pago que no llega a la API
// ════════════════════════════════════════════

describe('El formulario de pago se valida ANTES de llamar (T1244)', () => {
  /** El campo, buscado dentro del diálogo de pago. */
  const campoDePago = (etiqueta) =>
    within(dialogoTitulado('Registrar pago')).getByLabelText(etiqueta)

  it('un pago vacío NO dispara ninguna llamada', async () => {
    // US9 escenario 1 y criterio 13. El handler mandaba
    // `amount: parseFloat(payData.amount)` sin mirar nada, y `parseFloat('')` es
    // **NaN**: la fila entraba en una columna DECIMAL(14,2), nada fallaba, y a
    // partir de ahí el saldo del proveedor, el badge de la lista y el archivo
    // del contador decían todos «NaN».
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()
    await enviar('Registrar pago')

    expect(enviado).not.toHaveBeenCalled()
    // Y se dice qué falta: un formulario que no hace nada al apretar el botón se
    // lee como que el sistema se colgó.
    expect(aviso).toHaveBeenCalledWith('Poné cuánto se pagó: tiene que ser un número mayor que cero.')
  })

  it('un pago de cero o negativo tampoco', async () => {
    // `Number('0')` y `Number('-500')` son finitos: sin la comparación con cero
    // los dos pasarían la validación y escribirían un movimiento que suma deuda
    // en vez de restarla, o que no hace nada.
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })
    vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    for (const valor of ['0', '-500', '  ', 'mil pesos']) {
      await act(async () => {
        fireEvent.change(campoDePago('Monto pagado'), { target: { value: valor } })
      })
      await enviar('Registrar pago')
    }

    expect(enviado).not.toHaveBeenCalled()
  })

  it('un pago mayor al saldo abre la confirmación con LOS DOS números', async () => {
    // US9 escenario 3 y FR-089. **Pagar por adelantado es legítimo**, así que
    // esto pregunta y no bloquea; lo que no puede pasar es que pregunte sin
    // decir de qué números habla, porque para ir a mirarlos hay que cerrar el
    // formulario y ahí se pierde lo tipeado.
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '20000' } })
    })
    await enviar('Registrar pago')

    // El saldo de Distribuidora Norte y el monto tipeado, los dos a la vista.
    expect(textoDeLaConfirmacion()).toContain('$12.345,60')
    expect(textoDeLaConfirmacion()).toContain('$20.000,00')

    // Y todavía no se registró nada: preguntar y mandar igual sería no preguntar.
    expect(enviado).not.toHaveBeenCalled()
  })

  it('confirmado, el pago por adelantado SÍ se registra', async () => {
    // La otra mitad del caso anterior. Sin esto, alguien podría «arreglar» el
    // adelanto bloqueándolo y los dos tests seguirían en verde: un saldo
    // negativo es la forma correcta de decir «el proveedor me debe a mí».
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '20000' } })
    })
    await enviar('Registrar pago')

    await act(async () => {
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Confirmar' }))
    })

    expect(enviado).toHaveBeenCalledTimes(1)
    expect(enviado.mock.calls[0][0]).toBe('/suppliers/3/payments')
    expect(enviado.mock.calls[0][1].amount).toBe(20000)
  })

  it('el método cheque se puede elegir, y es el que viaja', async () => {
    // FR-091 y US9 escenario 4. Faltaba: había efectivo, transferencia y QR, así
    // que un pago con cheque —la forma habitual de pagarle a un mayorista— se
    // registraba como otra cosa y el historial mentía sobre con qué se pagó.
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '5000' } })
      fireEvent.change(campoDePago('Método de pago'), { target: { value: 'ch' } })
    })
    await enviar('Registrar pago')

    expect(enviado).toHaveBeenCalledTimes(1)
    expect(enviado.mock.calls[0][1].payment_method).toBe('ch')
  })

  it('la fecha del pago se puede elegir y NO se pisa con la de hoy', async () => {
    // FR-092 y US9 escenario 5. El estado ya guardaba `date` y **no había ningún
    // campo**: un pago de ayer entraba con la fecha de hoy, y en una cuenta
    // corriente eso lo mueve de mes sin que nada avise.
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '1000' } })
      fireEvent.change(campoDePago('Fecha del pago'), { target: { value: '2026-05-20' } })
    })
    await enviar('Registrar pago')

    expect(enviado.mock.calls[0][1].date).toBe('2026-05-20')
  })
})

// ════════════════════════════════════════════
//  T1245 · Corregir y borrar un movimiento
// ════════════════════════════════════════════

describe('Los dos endpoints de movimientos por fin tienen botón (T1245)', () => {
  /**
   * La fila del historial cuyas notas dicen eso.
   *
   * ⚠ Se busca por el `title` y no por el texto: la celda de notas lleva pegado
   * el método entre paréntesis —«A cuenta (Transferencia)»— así que
   * `getByText('A cuenta')` no encuentra nada. El `title` es las notas solas, y
   * es la misma razón por la que el caso de las columnas ya lo usaba.
   */
  const filaDeMovimiento = (notas) =>
    within(bloque('Historial de cuenta')).getByTitle(notas).closest('[style*="grid-template-columns"]')

  it('eliminar un movimiento pide confirmación diciendo el importe y el saldo resultante', async () => {
    // US9 escenario 7 y FR-094. «¿Eliminar?» a secas sobre una fila de plata no
    // alcanza para decidir: el número que importa —en qué queda el saldo— no
    // está en ninguna parte de la pantalla, y borrar un pago de $4.000 sube la
    // deuda en $4.000.
    const borrado = vi.spyOn(api, 'delete').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')

    await act(async () => {
      fireEvent.click(within(filaDeMovimiento('A cuenta')).getByTitle('Eliminar el movimiento'))
    })

    expect(textoDeLaConfirmacion()).toContain('$4.000,00')
    expect(textoDeLaConfirmacion()).toContain('$16.345,60')
    expect(borrado).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Confirmar' }))
    })

    expect(borrado).toHaveBeenCalledWith('/suppliers/movements/8')
  })

  it('cancelar la confirmación NO dispara ninguna llamada', async () => {
    // Lo que separa «pide confirmación» de «avisa y borra igual». Sin este caso,
    // llamar al endpoint sin esperar la respuesta del diálogo pasaría el test de
    // arriba entero.
    const borrado = vi.spyOn(api, 'delete').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')

    await act(async () => {
      fireEvent.click(within(filaDeMovimiento('Orden vieja')).getByTitle('Eliminar el movimiento'))
    })

    await act(async () => {
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Cancelar' }))
    })

    expect(borrado).not.toHaveBeenCalled()
  })

  it('corregir un movimiento manda el PUT al endpoint que ya existía', async () => {
    // FR-093 y US9 escenario 6. `PUT /api/suppliers/movements/:id` está desde
    // siempre, con `findScoped` y lista blanca, y no lo llamaba nadie: un pago
    // cargado por $10.000 en vez de $1.000 no se podía corregir desde ninguna
    // pantalla, y la única salida era borrarlo y volver a cargarlo.
    const guardado = vi.spyOn(api, 'put').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')

    await act(async () => {
      fireEvent.click(within(filaDeMovimiento('A cuenta')).getByTitle('Corregir el movimiento'))
    })

    await act(async () => {
      fireEvent.change(
        within(dialogoTitulado('Corregir el pago')).getByLabelText('Importe'),
        { target: { value: '3500' } }
      )
    })
    await enviar('Corregir el pago')

    expect(guardado).toHaveBeenCalledTimes(1)
    expect(guardado.mock.calls[0][0]).toBe('/suppliers/movements/8')
    expect(guardado.mock.calls[0][1]).toMatchObject({ amount: 3500, date: '2026-07-28' })
  })

  it('sin proveedores.eliminar el botón está deshabilitado con su explicación', async () => {
    // FR-087. Deshabilitado **con su explicación** y no ausente: un botón que
    // desaparece deja a quien lo busca sin entender por qué, y termina en un
    // pedido de soporte que dice «no me anda».
    await montar({ permisos: ['proveedores.ver'] })
    await elegir('Distribuidora Norte')

    const fila = filaDeMovimiento('Orden vieja')

    expect(within(fila).getByTitle('Necesitás el permiso «proveedores.eliminar»')).toBeDisabled()
    expect(within(fila).getByTitle('Necesitás el permiso «proveedores.editar»')).toBeDisabled()
  })
})

// ════════════════════════════════════════════
//  T1246 · Borrar el proveedor sabiendo qué se lleva
// ════════════════════════════════════════════

describe('Eliminar un proveedor dice qué se borra con él (T1246)', () => {
  const UN_DOCUMENTO = [{
    id: 1,
    name: 'Factura 0001-00043212',
    type: 'factura',
    url: 'https://drive.google.com/file/x',
    date: '2026-07-10',
  }]

  /** Aprieta el botón de borrar de la cabecera de la cuenta. */
  async function pedirBorrado() {
    await act(async () => { fireEvent.click(screen.getByTitle('Eliminar el proveedor')) })
  }

  it('la confirmación de borrado dice cuántas órdenes y movimientos se van', async () => {
    // [PENDIENTE 10]. La confirmación era «¿Eliminar?» y detrás se llevaba la
    // cuenta corriente entera en una transacción: órdenes, movimientos y
    // documentos. Es borrar el respaldo de todo lo que se le compró, y no se
    // repara.
    await montar({
      ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE],
      documentos: UN_DOCUMENTO,
    })
    await elegir('Distribuidora Norte')
    await pedirBorrado()

    const texto = textoDeLaConfirmacion()

    expect(texto).toContain('Distribuidora Norte')
    expect(texto).toContain('3 movimientos')
    expect(texto).toContain('2 órdenes de compra')
    expect(texto).toContain('1 documento')
  })

  it('con saldo, muestra el mensaje del servidor con el número', async () => {
    // US9 escenario 9 y criterio 14. El servidor bloquea el borrado y su mensaje
    // lleva el nombre y el importe adentro: es el único que sabe de qué cuenta
    // habla. Reemplazarlo por «No se pudo eliminar el proveedor» deja a alguien
    // buscando por qué.
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    vi.spyOn(api, 'delete').mockRejectedValue({
      message: 'Request failed with status code 400',
      response: {
        data: {
          ok: false,
          error: 'Distribuidora Norte tiene un saldo de $12.345,60. Saldá la cuenta antes de eliminarlo.',
        },
      },
    })

    await montar()
    await elegir('Distribuidora Norte')
    await pedirBorrado()

    await act(async () => {
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Confirmar' }))
    })

    expect(aviso).toHaveBeenCalledWith(
      'Distribuidora Norte tiene un saldo de $12.345,60. Saldá la cuenta antes de eliminarlo.'
    )
    expect(aviso).not.toHaveBeenCalledWith('Request failed with status code 400')
  })

  it('sin proveedores.eliminar el proveedor tampoco se puede borrar', async () => {
    // ⚠ Se busca DENTRO de la cabecera de la cuenta: sin el permiso, el mismo
    // `title` lo llevan también los tres botones de borrar del historial, y un
    // `screen.getByTitle` suelto encontraría cuatro y fallaría por un motivo que
    // no tiene nada que ver con lo que el caso verifica.
    await montar({ permisos: ['proveedores.ver'] })
    await elegir('Distribuidora Norte')

    const cabecera = bloque('Distribuidora Norte')

    expect(within(cabecera).getByTitle('Necesitás el permiso «proveedores.eliminar»')).toBeDisabled()
  })
})

// ════════════════════════════════════════════
//  T1247 · La exportación para el contador
// ════════════════════════════════════════════

describe('Exportar la cuenta corriente (T1247)', () => {
  /** El 400 de `LIMITE_EXPORT_SUPERADO`, tal como lo arma el servidor. */
  const PASADO_DE_LIMITE = {
    message: 'Request failed with status code 400',
    response: {
      data: {
        ok: false,
        error: 'LIMITE_EXPORT_SUPERADO',
        message: 'La cuenta tiene 6200 movimientos y el máximo por archivo es 5000. Acotá el rango de fechas.',
        total: 6200,
        limite: 5000,
      },
    },
  }

  /** Abre el diálogo de exportación del proveedor ya elegido. */
  async function abrirExport() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Exportar cuenta/ }))
    })
  }

  it('pasado el límite dice el total y qué acotar, y no «error al exportar»', async () => {
    // El aviso tiene que llegar con los dos números y con qué hacer. Los manda
    // el servidor en `message`, y lo que hace falta acá es no taparlos: un
    // `toast.error('No se pudo exportar')` en el catch los pierde y deja a
    // alguien reintentando la misma exportación que no puede salir.
    //
    // ⚠ El código de máquina viaja en `error` —`LIMITE_EXPORT_SUPERADO`— y
    // `mensajeDeError` lo descarta a propósito: un toast con un código adentro
    // no es «Request failed», pero es igual de ilegible.
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar({ exportacion: PASADO_DE_LIMITE })
    await elegir('Distribuidora Norte')
    await abrirExport()

    await act(async () => {
      const dialogo = dialogoTitulado('Exportar la cuenta')
      fireEvent.change(within(dialogo).getByLabelText('Desde'), { target: { value: '2026-07-01' } })
      fireEvent.change(within(dialogo).getByLabelText('Hasta'), { target: { value: '2026-07-31' } })
    })
    await enviar('Exportar la cuenta')

    // El rango que eligió la persona es el que sale por la red: sin eso, el
    // aviso de «acotá el rango» pediría algo que la pantalla ignora.
    const pedido = pedidos.filter((p) => p.url === '/suppliers/3/movimientos/export').pop()
    expect(pedido.params).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' })

    const texto = aviso.mock.calls.at(-1)[0]
    expect(texto).toContain('6200')
    expect(texto).toContain('5000')
    expect(texto).toContain('Acotá el rango de fechas')
    expect(texto).not.toContain('LIMITE_EXPORT_SUPERADO')
    expect(texto).not.toContain('No se pudo exportar')
  })

  it('sin fechas NO manda el rango vacío, y el aviso genérico nombra al proveedor', async () => {
    // Los dos extremos viajan por PRESENCIA, igual que el `q` del buscador: un
    // `desde=` vacío es un filtro que el servidor tiene que validar para
    // descartarlo. Y un fallo cualquiera —la red caída, un 500— no puede quedar
    // en «no se pudo completar la operación»: sin el nombre no se sabe qué
    // cuenta no se bajó.
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar({ exportacion: { message: 'Network Error', response: { data: null } } })
    await elegir('Distribuidora Norte')
    await abrirExport()
    await enviar('Exportar la cuenta')

    const pedido = pedidos.filter((p) => p.url === '/suppliers/3/movimientos/export').pop()
    expect(pedido.params).toEqual({})

    expect(aviso).toHaveBeenCalledWith('No se pudo exportar la cuenta de Distribuidora Norte.')
  })
})
