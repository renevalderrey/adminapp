import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import api from '@/services/api'
import useStore from '@/store/useStore'
import { pesos } from '@/utils/formato'
import Orders from '@/pages/Orders'

/**
 * De `xlsx` se reemplaza UNA función: la que toca el disco.
 *
 * ⚠ Es un `vi.mock` y no un `vi.spyOn` por una limitación de ESM, no por gusto:
 * el namespace de un módulo no es configurable y `vi.spyOn(XLSX, 'writeFile')`
 * termina en «Cannot redefine property». `utils` sigue siendo el de verdad, así
 * que la hoja que se inspecciona la armó `armarHoja` y la ensambló `xlsx`: lo
 * único que no pasa es la descarga.
 */
vi.mock('xlsx', async (importarOriginal) => {
  const original = await importarOriginal()

  return { ...original, writeFile: vi.fn() }
})

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

/**
 * Los detalles cuya respuesta queda en el aire hasta que el caso la suelte.
 *
 * Es lo único con lo que se puede reproducir «la respuesta de la orden que ya
 * cerré llega tarde»: con un doble que resuelve siempre en el acto, la carrera
 * no existe y el caso pasaría con y sin el arreglo.
 */
let soltarDetalle = {}

const respuesta = (data) => Promise.resolve({ data })

async function montar({
  proveedores = CUATRO,
  movimientos = MOVIMIENTOS,
  totalDeMovimientos = movimientos.length,
  ordenes = [],
  // Cuántas órdenes hay EN TOTAL para ese proveedor, que no tiene por qué ser
  // lo que entró en la página. `null` = las que trae `ordenes`.
  totalDeOrdenes = null,
  // Los ids cuyo detalle no responde hasta que el caso llame a `soltarDetalle`.
  detallesDemorados = [],
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

      // ⚠ El doble RECORTA por `limit`, como el servidor, y devuelve el total
      // sin recortar. Antes devolvía `total: delProveedor.length` sobre el
      // arreglo entero, así que `total` y `data.length` coincidían SIEMPRE: un
      // contador que mostrara el largo del arreglo pasaba igual, y era
      // exactamente el defecto que había en la pantalla.
      const tope = config?.params?.limit || delProveedor.length

      return respuesta({
        ok: true,
        total: totalDeOrdenes === null ? delProveedor.length : totalDeOrdenes,
        data: delProveedor.slice(0, tope),
      })
    }

    const detalle = ordenes.find((o) => url === `/suppliers/orders/${o.id}`)
    if (detalle) {
      const cuerpo = { ok: true, data: enriquecer(detalle) }

      if (detallesDemorados.includes(detalle.id)) {
        return new Promise((listo) => { soltarDetalle[detalle.id] = () => listo({ data: cuerpo }) })
      }

      return respuesta(cuerpo)
    }

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

/** Cierra el panel con su botón de cerrar. */
async function cerrarPanel() {
  await act(async () => {
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }))
  })
}

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

beforeEach(() => { pedidos = []; soltarDetalle = {} })
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
//  B3 · Un detalle en vuelo no se apodera del panel
//
//  `setOrdenAbierta(res.data.data)` salía sin contador, sin `AbortController` y
//  sin comparar contra el id vigente, acá y en `pages/PurchaseOrders.jsx`. Abrir
//  la A, cerrarla y abrir la B dejaba la B dibujada hasta que llegaba la
//  respuesta de la A —tarde— y el panel se rehacía como A: se pierde lo tipeado,
//  porque el `useEffect` de reseteo del panel borra las cantidades en el mismo
//  commit, y se queda mirando una orden que nadie pidió.
// ════════════════════════════════════════════

describe('La respuesta vieja del detalle no se apodera del panel (B3)', () => {
  /** Las dos filas del bloque de órdenes, agarradas antes de abrir nada. */
  function filasDeOrden() {
    const buscar = (numero) =>
      within(bloque('Órdenes de compra')).getByText(numero).closest('[style*="grid-template-columns"]')

    return { primera: buscar('#112'), segunda: buscar('#118') }
  }

  it('abrir la #112, cerrarla y abrir la #118 deja la #118 aunque la #112 conteste tarde', async () => {
    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE], detallesDemorados: [112] })
    await elegir('Distribuidora Norte')

    const { primera, segunda } = filasDeOrden()

    await act(async () => { fireEvent.click(primera) })   // la #112 queda en el aire
    await cerrarPanel()
    await act(async () => { fireEvent.click(segunda) })    // la #118 contesta en el acto

    expect(within(panel()).getByText('#118')).toBeInTheDocument()

    // Y ahora contesta la #112, tarde.
    await act(async () => { soltarDetalle[112]() })

    expect(within(panel()).getByText('#118')).toBeInTheDocument()
    expect(within(panel()).queryByText('#112')).toBeNull()
  })

  it('la que SÍ se está esperando se dibuja igual que siempre', async () => {
    // La otra mitad: sin ella, descartar todas las respuestas pasaría el caso de
    // arriba y el panel no mostraría nunca ninguna orden.
    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE], detallesDemorados: [112] })
    await elegir('Distribuidora Norte')

    const { primera } = filasDeOrden()

    await act(async () => { fireEvent.click(primera) })

    expect(within(panel()).queryByText('#112')).toBeNull()

    await act(async () => { soltarDetalle[112]() })

    expect(within(panel()).getByText('#112')).toBeInTheDocument()
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
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Registrar el pago' }))
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
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Eliminar movimiento' }))
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
      fireEvent.click(within(dialogoTitulado('Confirmar')).getByRole('button', { name: 'Eliminar proveedor' }))
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

  // ── El archivo que se bajó, y no solo la llamada que salió ──
  //
  // Los dos casos de arriba son los caminos de error, así que ninguno llega a
  // armar la hoja. Lo que faltaba verificar es lo otro: que de la respuesta se
  // use TODO lo que hace falta. `res.data.data` son las filas y
  // `res.data.saldo_inicial` es el saldo con el que abre el período; leyendo
  // solo lo primero, el archivo del contador arrancaba la cuenta en cero y
  // cerraba en el neto del período —$22.000 sobre una cuenta que debía
  // $122.000— mientras la pantalla mostraba el saldo entero.

  /**
   * La cuenta de Distribuidora Norte partida por un rango, tal como la devuelve
   * `GET /suppliers/:id/movimientos/export?desde=…`.
   *
   * ⚠ **`saldo_inicial` no es cero, y es lo único que hace que el caso pueda
   * ponerse en rojo.** Con un período que arranca en cero —que es como iban las
   * doce fixtures del export— la hoja sale idéntica se pase el saldo anterior o
   * se lo tire.
   *
   * 10.000 + 6.345,60 − 4.000 = 12.345,60, que es el `saldo` de la ficha y el
   * número que la pantalla dibuja en grande.
   */
  const CON_RANGO = {
    ok: true,
    total: 2,
    saldo_inicial: 10000,
    saldo_final: 12345.6,
    data: [
      {
        fecha: '2026-07-14',
        tipo: 'Pedido',
        descripcion: 'Recepción orden #118',
        debe: 6345.6,
        haber: 0,
        saldo: 16345.6,
        cuit: '30712345678',
      },
      {
        fecha: '2026-07-28',
        tipo: 'Pago',
        descripcion: 'Transferencia',
        debe: 0,
        haber: 4000,
        saldo: 12345.6,
        cuit: '30712345678',
      },
    ],
  }

  /**
   * La misma cuenta sin filtro de fechas: el archivo es la cuenta entera, así
   * que no hay nada anterior y `saldo_inicial` vale cero.
   */
  const SIN_RANGO = {
    ok: true,
    total: 2,
    saldo_inicial: 0,
    saldo_final: 12345.6,
    data: [
      { ...CON_RANGO.data[0], debe: 16345.6, saldo: 16345.6 },
      CON_RANGO.data[1],
    ],
  }

  // La descarga no llega al disco (ver el `vi.mock` de arriba), pero el libro
  // que se le pasó es el que se habría escrito.
  beforeEach(() => { XLSX.writeFile.mockClear() })

  /** La hoja de la cuenta corriente del libro que la pantalla mandó a bajar. */
  const hojaBajada = () => XLSX.writeFile.mock.calls.at(-1)[0].Sheets['Cuenta corriente']

  /** La columna, de la primera fila de datos —la 3— al final del `!ref`. */
  function columna(hoja, letra) {
    const ultima = XLSX.utils.decode_range(hoja['!ref']).e.r
    const valores = []

    for (let r = 2; r <= ultima; r += 1) valores.push(hoja[`${letra}${r + 1}`]?.v)

    return valores
  }

  /** El saldo grande de la cuenta, tal como se lee en pantalla. */
  const saldoEnPantalla = () =>
    within(screen.getByText('Saldo pendiente').parentElement).getByText(/^\$/)

  it('con rango, el archivo dice el saldo anterior y cierra en el saldo grande de la pantalla', async () => {
    // US8 escenario 6. El archivo tiene que cerrar en el mismo número que la
    // pantalla **y** explicar de dónde arranca: sin la fila de apertura, la
    // primera muestra un saldo acumulado que no se deduce de su propio debe.
    await montar({ exportacion: CON_RANGO })
    await elegir('Distribuidora Norte')
    await abrirExport()

    await act(async () => {
      const dialogo = dialogoTitulado('Exportar la cuenta')
      fireEvent.change(within(dialogo).getByLabelText('Desde'), { target: { value: '2026-07-01' } })
    })
    await enviar('Exportar la cuenta')

    const hoja = hojaBajada()
    const saldos = columna(hoja, 'F')

    // El saldo anterior que calculó la API llegó a la planilla.
    expect(columna(hoja, 'C')[0]).toBe('Saldo anterior')
    expect(saldos[0]).toBe(10000)

    // Y la última fila es el saldo grande de la pantalla, escrito igual.
    expect(saldoEnPantalla()).toHaveTextContent(`$${pesos(saldos.at(-1))}`)
    expect(saldos.at(-1)).toBe(12345.6)
  })

  it('sin rango el archivo cierra en el mismo saldo y NO agrega una apertura', async () => {
    // La otra mitad del escenario 6: la cuenta entera abre con la cuenta, así
    // que una fila «Saldo anterior» acá sería un renglón inventado. Sin este
    // caso, una apertura dibujada siempre pasaría el de arriba.
    await montar({ exportacion: SIN_RANGO })
    await elegir('Distribuidora Norte')
    await abrirExport()
    await enviar('Exportar la cuenta')

    const hoja = hojaBajada()
    const saldos = columna(hoja, 'F')

    expect(columna(hoja, 'C')).not.toContain('Saldo anterior')
    expect(saldoEnPantalla()).toHaveTextContent(`$${pesos(saldos.at(-1))}`)
    expect(saldos.at(-1)).toBe(12345.6)
  })
})

// ════════════════════════════════════════════
//  Hito 9 · Dos clics en «Registrar pago» escribían dos filas
//
//  El handler no tenía cerrojo: dos envíos de la misma tanda —doble clic, o
//  Enter dos veces— entraban los dos y quedaban **dos pagos en la cuenta
//  corriente, con el saldo bajando el doble**. Es plata, y del lado que peor
//  se detecta: un pago de más no se nota hasta que alguien concilia con el
//  proveedor, y para entonces nadie se acuerda del doble clic.
//
//  Acá muerde más que en otras pantallas porque el handler **cede el hilo antes
//  de escribir**: si el pago supera el saldo hay un `await confirm(...)`, y
//  durante todo ese diálogo la puerta queda abierta de par en par.
//
//  ⚠ **Los dos envíos van adentro de UN SOLO `act`.** Con un `act` por envío
//  React alcanza a renderizar en el medio, y entonces **un cerrojo hecho con
//  estado también pasaría**: el test quedaría verde con y sin la corrección.
//  Es el error exacto que este repositorio ya cometió una vez con el cobro del
//  punto de venta (T1123). Por eso el cerrojo es un `useRef`: el estado se lee
//  actualizado recién en el render siguiente, que acá llega tarde.
// ════════════════════════════════════════════

describe('El pago no se registra dos veces por un doble clic', () => {
  /** El campo, buscado dentro del diálogo de pago. */
  const campoDePago = (etiqueta) =>
    within(dialogoTitulado('Registrar pago')).getByLabelText(etiqueta)

  /** Manda el formulario de pago N veces SIN dejar renderizar en el medio. */
  async function enviarEnLaMismaTanda(veces) {
    const form = dialogoTitulado('Registrar pago').querySelector('form')
    await act(async () => {
      for (let i = 0; i < veces; i++) fireEvent.submit(form)
    })
  }

  it('dos envíos en la misma tanda escriben UN solo pago', async () => {
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    // Menor al saldo de $12.345,60: este camino no pregunta nada, va derecho a
    // escribir. Es el doble clic común, sin confirmación de por medio.
    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '1000' } })
    })
    await enviarEnLaMismaTanda(2)

    expect(enviado).toHaveBeenCalledTimes(1)
    expect(enviado.mock.calls[0][0]).toBe('/suppliers/3/payments')
  })

  it('tampoco mientras el pago anterior todavía viaja', async () => {
    // La otra ventana, y más ancha que la del tick: entre que sale el POST y
    // vuelve la respuesta pasan cientos de milisegundos de red. El diálogo sigue
    // abierto y el botón sigue apretable, así que el segundo clic acá NO es un
    // doble clic accidental —es alguien que esperó, no vio nada y volvió a
    // apretar—. Con el cerrojo tomado hasta el `finally`, no entra.
    let responder
    const enviado = vi.spyOn(api, 'post')
      .mockImplementation(() => new Promise((r) => { responder = () => r({ data: { ok: true } }) }))

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '1000' } })
    })

    // Primer envío: queda esperando la respuesta.
    await enviar('Registrar pago')
    expect(enviado).toHaveBeenCalledTimes(1)

    // Segundo envío, con render de por medio: el cerrojo tiene que seguir puesto.
    await enviar('Registrar pago')
    expect(enviado).toHaveBeenCalledTimes(1)

    await act(async () => { responder() })
  })

  it('y cancelar NO deja el formulario inerte para siempre', async () => {
    // La otra mitad, y la que rompe un cerrojo mal escrito: si el `finally` no
    // cubriera los `return` tempranos, un solo importe inválido dejaría el botón
    // sin efecto por el resto de la sesión, sin ninguna señal de por qué.
    const enviado = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })
    vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()
    await elegir('Distribuidora Norte')
    await abrirPago()

    // Primer intento: importe vacío. Sale por el `return` de la validación.
    await enviar('Registrar pago')
    expect(enviado).not.toHaveBeenCalled()

    // Segundo intento, ahora con importe. Tiene que salir.
    await act(async () => {
      fireEvent.change(campoDePago('Monto pagado'), { target: { value: '1000' } })
    })
    await enviar('Registrar pago')

    expect(enviado).toHaveBeenCalledTimes(1)
  })
})

// ════════════════════════════════════════════
//  Hito 9 · El lápiz que no miraba el permiso
//
//  El tacho de al lado se apagaba con su motivo; el lápiz, pegado a él, se
//  dibujaba encendido para cualquiera. Quien no puede editar completaba el CUIT,
//  apretaba Guardar, comía un 403 —y veía el tacho de al lado APAGADO, con su
//  explicación—.
//
//  La conclusión razonable ahí no es «me falta un permiso». Es que **el sistema
//  falló**: si fuera cuestión de permisos, este botón estaría apagado como el
//  otro. Es peor que no poder editar, porque además hace desconfiar de lo que sí
//  se puede.
// ════════════════════════════════════════════

describe('El lápiz mira el permiso, igual que el tacho de al lado', () => {
  /** Los permisos de alguien que entra a la ficha pero no puede tocarla. */
  const MIRON = ['proveedores.ver', 'ordenes_compra.ver']

  /**
   * Los dos botones del encabezado de la ficha.
   *
   * Se busca DENTRO del bloque del nombre y no en toda la pantalla: las filas
   * del historial de movimientos tienen su propio lápiz con el mismo permiso, y
   * `getByTitle` a secas encuentra varios. Que sean varios no es un defecto —el
   * historial también se corrige— pero éste es el del encabezado.
   */
  const encabezadoDeLaFicha = () =>
    screen.getByRole('heading', { name: 'Distribuidora Norte' }).parentElement

  const lapizDeLaFicha = () =>
    within(encabezadoDeLaFicha())
      .getByTitle(/Editar los datos del proveedor|Necesitás el permiso «proveedores.editar»/)

  it('sin el permiso queda apagado, y dice cuál falta', async () => {
    await montar({ permisos: MIRON })
    await elegir('Distribuidora Norte')

    const lapiz = lapizDeLaFicha()

    expect(lapiz).toBeDisabled()
    // Que NOMBRE el permiso: quien lee «no tenés permiso» no puede pedir nada
    // concreto a quien administra la empresa.
    expect(lapiz.getAttribute('title')).toContain('proveedores.editar')
  })

  it('y el motivo se puede leer: no sale del hit-testing', async () => {
    // `disabled:pointer-events-none` hace que el navegador nunca muestre el
    // `title`, o sea que apaga justamente la explicación.
    await montar({ permisos: MIRON })
    await elegir('Distribuidora Norte')

    expect(lapizDeLaFicha().className).not.toContain('pointer-events-none')
  })

  it('no se queda apagado para quien SÍ puede editar', async () => {
    // Sin este caso, apagarlo siempre pasaría los dos anteriores y la ficha
    // quedaría sin forma de corregir un CUIT.
    await montar({ permisos: TODOS })
    await elegir('Distribuidora Norte')

    expect(lapizDeLaFicha()).not.toBeDisabled()
  })

  it('el lápiz y el tacho de al lado se apagan por el MISMO motivo', async () => {
    // El defecto era exactamente el contraste entre los dos: uno apagado con su
    // explicación y el otro encendido. Se afirma que los dos se comportan igual
    // frente a la falta de permiso, que es lo que hace que la pantalla se lea
    // como una sola cosa.
    await montar({ permisos: MIRON })
    await elegir('Distribuidora Norte')

    const tacho = within(encabezadoDeLaFicha())
      .getByTitle(/Eliminar el proveedor|Necesitás el permiso «proveedores.eliminar»/)

    expect(lapizDeLaFicha()).toBeDisabled()
    expect(tacho).toBeDisabled()
    expect(tacho.getAttribute('title')).toContain('proveedores.eliminar')
  })
})

// ════════════════════════════════════════════
//  Hito 9 · El contador que mentía hacia abajo
//
//  La lista de órdenes del proveedor se pide con un tope de cincuenta, y el
//  badge del encabezado contaba el ARREGLO. Un proveedor con sesenta órdenes
//  mostraba «50», sin ninguna señal de que la lista estaba cortada: la única
//  forma de enterarse era contar las filas a mano.
//
//  ⚠ Lo peor no es el número. Es que **el estado con el total ya existía** —lo
//  usa la confirmación del borrado, que tiene que decir cuántas se van de
//  verdad— y su comentario explica exactamente este problema, diez líneas más
//  arriba del badge que lo ignoraba. La corrección estaba escrita al lado del
//  defecto.
// ════════════════════════════════════════════

describe('El contador de órdenes dice cuántas hay, no cuántas entraron', () => {
  /** El badge del encabezado de la sección de órdenes. */
  const contadorDeOrdenes = () => {
    const titulo = screen.getByRole('heading', { name: 'Órdenes de compra' })
    return titulo.parentElement.querySelector('span.num')
  }

  it('con más órdenes que el tope, muestra el TOTAL y no las que llegaron', async () => {
    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE], totalDeOrdenes: 60 })
    await elegir('Distribuidora Norte')

    expect(contadorDeOrdenes().textContent).toBe('60')
    // Y no el largo del arreglo, que es lo que decía.
    expect(contadorDeOrdenes().textContent).not.toBe('2')
  })

  it('y avisa que la lista está cortada, diciendo cuántas se ven', async () => {
    // Sin esta franja, el contador dice 60 y abajo hay 2 filas: dos números que
    // se contradicen a la vista, que es peor que el defecto original.
    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE], totalDeOrdenes: 60 })
    await elegir('Distribuidora Norte')

    const pie = screen.getByText(/Mostrando/)

    expect(pie.textContent).toContain('2')
    expect(pie.textContent).toContain('60')
  })

  it('cuando NO está cortada, no aparece ninguna franja', async () => {
    // El contra-caso. Un pie que dijera siempre «Mostrando 2 de 2» es ruido en
    // el noventa y nueve por ciento de las fichas, y el ruido permanente es
    // cómo un aviso deja de leerse.
    await montar({ ordenes: [PRIMERA_PENDIENTE, SEGUNDA_PENDIENTE] })
    await elegir('Distribuidora Norte')

    expect(contadorDeOrdenes().textContent).toBe('2')
    expect(screen.queryByText(/Mostrando/)).toBeNull()
  })
})
