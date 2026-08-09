import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, fireEvent, cleanup } from '@testing-library/react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import api from '@/services/api'

// ⚠ `xlsx` se dobla con `vi.mock` y no con `vi.spyOn`.
//
// En ESM el namespace de un módulo no es configurable, así que `spyOn(XLSX,
// 'writeFile')` falla con «Module namespace is not configurable». Lo que se
// necesita verificar es que el archivo se escriba —y con qué nombre—, así que
// se dobla el módulo entero conservando el resto de sus funciones.
vi.mock('xlsx', async (original) => {
  const real = await original()

  return { ...real, writeFile: vi.fn() }
})
import useStore from '@/store/useStore'
import { ESPERA_DE_BUSQUEDA } from '@/utils/busqueda'
import Faltantes from '@/pages/Faltantes'

// ════════════════════════════════════════════
//  ADMINAPP · Faltantes → pedido, renderizado
//
//  ── Por qué este archivo existe antes que cualquier corrección ──
//
//  `pages/Faltantes.jsx` son 360 líneas que **crean órdenes de compra, mandan
//  WhatsApp y exportan a Excel**, y hasta acá no tenían UNA SOLA prueba. Es la
//  pantalla con más hallazgos del informe de coherencia —diez de cuarenta y
//  nueve sobre el 2,5 % del código— y la única de las doce que nunca entró a un
//  hito de rediseño: no es una pantalla que se desalineó, es una que nunca se
//  alineó.
//
//  El informe fija el orden y no es negociable: **primero la guardia, después
//  este archivo, y recién después la reescritura.** Reescribir presentación sin
//  una red que diga qué hacía la pantalla es cómo se pierde una regla de
//  negocio sin que nadie se entere — y acá las reglas de negocio son «cuánto
//  pedirle a quién» y «qué importe tiene ese pedido».
//
//  ── Qué se afirma acá ──
//
//  Lo que la pantalla HACE, no cómo se ve: qué agrupa, qué cuenta, qué manda al
//  servidor y qué manda a WhatsApp. El dibujo lo cubre
//  `guardiasDeDiseno.test.js`, que ya la incluye.
//
//  ⚠ Los importes se afirman con el número exacto y en formato argentino. Un
//  importe mal formateado no rompe nada: la pantalla abre, se ve bien, y dice
//  otro número.
// ════════════════════════════════════════════

const CENTRO = { id: 1, name: 'Ortiz de Ocampo' }

/**
 * Dos proveedores y un grupo sin proveedor, que es el caso que rompe.
 *
 * `sin_proveedor` no tiene `supplier_id`, así que no puede generar una orden de
 * compra: es el grupo cuyo botón NO se dibuja.
 */
const RESPUESTA = {
  umbral: 3,
  total_items: 4,
  total_estimado: 20500,
  proveedores: [
    {
      supplier_id: 7,
      proveedor: { id: 7, nombre: 'Distribuidora Norte', telefono: '1155667788' },
      total_estimado: 18000,
      items: [
        {
          product_id: 101,
          nombre: 'Colágeno 300g',
          marca: 'Star',
          stock: 1,
          min_stock: 6,
          sugerido: 5,
          costo: 3000,
        },
        {
          product_id: 102,
          nombre: 'Whey 1kg',
          marca: null,
          stock: 0,
          min_stock: 0,
          sugerido: 1,
          costo: 3000,
        },
      ],
    },
    {
      supplier_id: 9,
      proveedor: { id: 9, nombre: 'Almacén Sur', telefono: null },
      total_estimado: 2500,
      items: [
        {
          product_id: 201,
          nombre: 'Barra de cereal',
          marca: 'Cereal Co',
          stock: 2,
          min_stock: 10,
          sugerido: 5,
          costo: 500,
        },
      ],
    },
    {
      supplier_id: null,
      proveedor: null,
      total_estimado: 0,
      items: [
        {
          product_id: 301,
          nombre: 'Producto huérfano',
          marca: null,
          stock: 0,
          min_stock: 4,
          sugerido: 4,
          costo: 0,
        },
      ],
    },
  ],
}

/** Sin nada que reponer. */
const VACIA = { umbral: 3, total_items: 0, total_estimado: 0, proveedores: [] }

let get
let post
let abrirVentana

/**
 * Monta la pantalla con la API doblada.
 *
 * `respuestaPendiente` deja la promesa SIN resolver: es lo único que permite
 * mirar el render intermedio, que es donde vive el defecto de «afirmar un vacío
 * que todavía no se sabe».
 */
async function montar({ datos = RESPUESTA, sucursal = CENTRO, respuestaPendiente = false } = {}) {
  get = vi.spyOn(api, 'get').mockImplementation((url) => {
    if (String(url).startsWith('/faltantes')) {
      if (respuestaPendiente) return new Promise(() => {})
      return Promise.resolve({ data: { ok: true, data: datos } })
    }
    return Promise.resolve({ data: { ok: true, data: [] } })
  })

  post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true, data: { id: 55 } } })

  useStore.setState({
    puntoDeVentaActivo: sucursal,
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [CENTRO] },
    permisos: ['stock.ver', 'ordenes_compra.crear', 'proveedores.ver'],
  })

  await act(async () => { render(<Faltantes />) })
}

/**
 * La tarjeta de ese proveedor.
 *
 * ⚠ Se busca por el ENCABEZADO y su `<section>`, no por una clase de Tailwind.
 * La primera versión de este ayudante decía `closest('[data-slot="card"]')`
 * —el componente `Card` de shadcn que la pantalla usaba antes— y la reescritura
 * de presentación lo rompió entero. Un selector atado a cómo se ve es un
 * selector que se rompe cada vez que alguien acomoda la pantalla, y entonces
 * el test deja de proteger lo que hace y pasa a proteger cómo se ve.
 */
function tarjetaDe(nombre) {
  return screen.getByRole('heading', { name: nombre }).closest('section')
}

/**
 * La fila de ese producto.
 *
 * Sale de su casilla, que lleva `aria-label="Pedir <producto>"`: es la única
 * referencia de la fila que existe por un motivo de accesibilidad y no de
 * dibujo, así que sobrevive a que la fila cambie de forma.
 */
function filaDe(nombre) {
  return screen.getByLabelText(`Pedir ${nombre}`).closest('div')
}

beforeEach(() => {
  abrirVentana = vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useStore.setState({ permisos: [], puntoDeVentaActivo: null })
})

// ════════════════════════════════════════════
//  Lo que trae y cómo lo agrupa
// ════════════════════════════════════════════

describe('Los faltantes llegan agrupados por proveedor', () => {
  it('pide los faltantes con el umbral y la sucursal activa', async () => {
    // La sucursal importa: el stock es por sucursal, y pedir sin ella devuelve
    // los faltantes de toda la empresa — que en un comercio con depósito es una
    // lista completamente distinta.
    await montar()

    const url = String(get.mock.calls.find(([u]) => String(u).startsWith('/faltantes'))[0])

    expect(url).toContain('umbral=3')
    expect(url).toContain('punto_de_venta_id=1')
  })

  it('dibuja una tarjeta por proveedor, con su nombre', async () => {
    await montar()

    expect(screen.getByText('Distribuidora Norte')).toBeInTheDocument()
    expect(screen.getByText('Almacén Sur')).toBeInTheDocument()
  })

  it('el grupo sin proveedor se dibuja igual, y se nombra', async () => {
    // Es el caso que se pierde si alguien filtra por `supplier_id`: son
    // productos que hay que reponer y que nadie asignó a un proveedor. Ocultarlos
    // los deja fuera de la reposición sin ninguna señal.
    await montar()

    expect(screen.getByText('Sin proveedor asignado')).toBeInTheDocument()
    expect(screen.getByText('Producto huérfano')).toBeInTheDocument()
  })

  it('cada fila dice el stock y el mínimo, y distingue el que no tiene mínimo', async () => {
    // «stock 0» a secas no dice si falta: lo que falta se define contra el
    // mínimo. Y el producto SIN mínimo cargado entró por el umbral, que es otra
    // regla: decir «/ mín. 0» ahí sería mentir.
    await montar()

    // El texto viene partido por los `<span class="num">` de los números —los
    // importes y las cantidades van en la variante tabular—, así que se lee el
    // renglón entero en vez de buscar un nodo con el texto completo.
    const renglon = (producto) =>
      within(filaDe(producto)).getByText(/stock/).textContent.replace(/\s+/g, ' ')

    expect(renglon('Colágeno 300g')).toContain('stock 1')
    expect(renglon('Colágeno 300g')).toContain('mín. 6')
    expect(renglon('Whey 1kg')).toContain('sin mínimo cargado')
  })

  it('el producto sin marca dice «Sin marca» y no deja el renglón cortado', async () => {
    await montar()

    expect(within(filaDe('Whey 1kg')).getByText(/Sin marca/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Las cantidades, que son lo que se pide
// ════════════════════════════════════════════

describe('Las cantidades arrancan en la sugerida y se pueden cambiar', () => {
  /** El campo de cantidad de esa fila. */
  const cantidadDe = (producto) =>
    within(filaDe(producto)).getByRole('spinbutton')

  it('arrancan en lo que sugirió el servidor', async () => {
    // La sugerencia es `mínimo − stock` redondeado hacia arriba: es la cuenta
    // que esta pantalla existe para no tener que hacer a mano.
    await montar()

    expect(cantidadDe('Colágeno 300g')).toHaveValue(5)
    expect(cantidadDe('Barra de cereal')).toHaveValue(5)
  })

  it('el botón «+» suma uno y el «−» resta uno', async () => {
    await montar()

    const fila = filaDe('Colágeno 300g')
    const [menos, mas] = within(fila).getAllByRole('button')

    await act(async () => { fireEvent.click(mas) })
    expect(cantidadDe('Colágeno 300g')).toHaveValue(6)

    await act(async () => { fireEvent.click(menos) })
    await act(async () => { fireEvent.click(menos) })
    expect(cantidadDe('Colágeno 300g')).toHaveValue(4)
  })

  it('NO baja de cero', async () => {
    // Una cantidad negativa viajaría al servidor como una orden de compra de
    // menos-tres unidades, que en la cuenta corriente del proveedor es plata al
    // revés.
    await montar()

    const [menos] = within(filaDe('Whey 1kg')).getAllByRole('button')

    for (let i = 0; i < 5; i++) {
      await act(async () => { fireEvent.click(menos) })
    }

    expect(cantidadDe('Whey 1kg')).toHaveValue(0)
  })

  it('escribir un número lo toma', async () => {
    await montar()

    await act(async () => {
      fireEvent.change(cantidadDe('Colágeno 300g'), { target: { value: '12' } })
    })

    expect(cantidadDe('Colágeno 300g')).toHaveValue(12)
  })
})

// ════════════════════════════════════════════
//  Los dos totales del encabezado
// ════════════════════════════════════════════

describe('Los totales cuentan lo que de verdad se va a pedir', () => {
  /** El número que está debajo de esa etiqueta. */
  const indicador = (etiqueta) =>
    screen.getByText(etiqueta).parentElement.querySelector('.num')

  it('cuenta los productos y suma el importe', async () => {
    // 5 × $3.000 + 1 × $3.000 + 5 × $500 + 4 × $0 = $20.500, sobre cuatro
    // productos.
    await montar()

    expect(indicador('Productos a pedir').textContent).toBe('4')
    expect(indicador('Costo estimado').textContent).toContain('20.500')
  })

  it('destildar un producto lo saca de los DOS números', async () => {
    // Es la mitad que se olvida: sacar una fila de la lista y dejarla contada en
    // el total hace que el importe del pedido no coincida con el pedido.
    await montar()

    await act(async () => {
      fireEvent.click(within(filaDe('Colágeno 300g')).getByRole('checkbox'))
    })

    expect(indicador('Productos a pedir').textContent).toBe('3')
    expect(indicador('Costo estimado').textContent).toContain('5.500')
  })

  it('poner una cantidad en cero también lo saca', async () => {
    // Cero unidades no es un producto pedido. Contarlo dejaría el contador
    // diciendo cuatro sobre un pedido de tres.
    await montar()

    await act(async () => {
      fireEvent.change(
        within(filaDe('Barra de cereal')).getByRole('spinbutton'),
        { target: { value: '0' } }
      )
    })

    expect(indicador('Productos a pedir').textContent).toBe('3')
  })

  it('el subtotal de la fila sigue a la cantidad', async () => {
    await montar()

    await act(async () => {
      fireEvent.change(
        within(filaDe('Colágeno 300g')).getByRole('spinbutton'),
        { target: { value: '10' } }
      )
    })

    expect(within(filaDe('Colágeno 300g')).getByText(/30\.000/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Los tres caminos de salida
// ════════════════════════════════════════════

describe('El pedido por WhatsApp', () => {
  /** El botón de esa tarjeta, por su texto. */
  const botonDe = (proveedor, texto) =>
    within(tarjetaDe(proveedor)).getByRole('button', { name: new RegExp(texto) })

  it('abre WhatsApp con el teléfono del proveedor y lo que se va a pedir', async () => {
    await montar()

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'WhatsApp')) })

    const [url] = abrirVentana.mock.calls[0]

    expect(url).toContain('wa.me/5491155667788')
    expect(decodeURIComponent(url)).toContain('Colágeno 300g')
  })

  it('sin teléfono avisa que hay que elegir el contacto a mano', async () => {
    // Almacén Sur no tiene teléfono. Abrir WhatsApp sin destinatario funciona
    // —se elige el contacto en la app— pero sin el aviso parece que se mandó.
    const info = vi.spyOn(toast, 'info').mockImplementation(() => {})

    await montar()
    await act(async () => { fireEvent.click(botonDe('Almacén Sur', 'WhatsApp')) })

    expect(info).toHaveBeenCalled()
    expect(abrirVentana.mock.calls[0][0]).not.toMatch(/wa\.me\/\d/)
  })

  it('«Con precios» manda los costos y «WhatsApp» no', async () => {
    // Son dos botones a propósito: el mensaje con precios se le manda a un
    // proveedor que ya sabe cuánto cobra, y el sin precios al que no debería
    // ver lo que figura como costo en este sistema.
    await montar()

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'Con precios')) })
    const conPrecios = decodeURIComponent(abrirVentana.mock.calls[0][0])

    abrirVentana.mockClear()

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'WhatsApp')) })
    const sinPrecios = decodeURIComponent(abrirVentana.mock.calls[0][0])

    expect(conPrecios).toContain('3.000')
    expect(sinPrecios).not.toContain('3.000')
  })

  it('con todo destildado NO abre WhatsApp: avisa', async () => {
    // Abrir WhatsApp con un mensaje vacío frente a un proveedor es peor que no
    // abrirlo.
    const error = vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()

    for (const producto of ['Colágeno 300g', 'Whey 1kg']) {
      await act(async () => {
        fireEvent.click(within(filaDe(producto)).getByRole('checkbox'))
      })
    }

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'WhatsApp')) })

    expect(abrirVentana).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
  })

  it('la nota del encabezado viaja en el mensaje', async () => {
    await montar()

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/entregar por la mañana/i), {
        target: { value: 'Dejar en la puerta' },
      })
    })

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'WhatsApp')) })

    expect(decodeURIComponent(abrirVentana.mock.calls[0][0])).toContain('Dejar en la puerta')
  })
})

describe('La exportación a Excel', () => {
  const botonDe = (proveedor, texto) =>
    within(tarjetaDe(proveedor)).getByRole('button', { name: new RegExp(texto) })

  it('escribe un archivo con las filas del pedido', async () => {
    const escribir = XLSX.writeFile
    escribir.mockClear()

    await montar()
    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'Excel')) })

    expect(escribir).toHaveBeenCalledTimes(1)

    const [, nombre] = escribir.mock.calls[0]
    expect(nombre).toMatch(/^pedido_Distribuidora_Norte_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('con todo destildado NO escribe nada', async () => {
    // Un archivo con solo encabezados es peor que ningún archivo: se manda al
    // proveedor creyendo que lleva el pedido.
    const escribir = XLSX.writeFile
    escribir.mockClear()
    vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()

    await act(async () => {
      fireEvent.click(within(filaDe('Barra de cereal')).getByRole('checkbox'))
    })
    await act(async () => { fireEvent.click(botonDe('Almacén Sur', 'Excel')) })

    expect(escribir).not.toHaveBeenCalled()
  })
})

describe('La orden de compra', () => {
  const botonDe = (proveedor, texto) =>
    within(tarjetaDe(proveedor)).getByRole('button', { name: new RegExp(texto) })

  it('manda las líneas al endpoint del proveedor', async () => {
    await montar()
    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'Orden de compra')) })

    expect(post).toHaveBeenCalledTimes(1)

    const [url, cuerpo] = post.mock.calls[0]

    expect(url).toBe('/suppliers/7/orders')
    expect(cuerpo.items).toHaveLength(2)
    expect(cuerpo.items[0]).toMatchObject({
      product_id: 101,
      product_name: 'Colágeno 300g',
      quantity: 5,
      unit_price: 3000,
    })
  })

  it('la fecha es la del negocio y NO la UTC', async () => {
    // Una reposición cargada un jueves a las 22:00 se asentaba en la cuenta del
    // proveedor con fecha del viernes, y esta pantalla no dibuja la fecha en
    // ningún lado: el error aparecía después, en la cuenta corriente.
    await montar()
    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'Orden de compra')) })

    const ahora = new Date()
    const local = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`

    expect(post.mock.calls[0][1].date).toBe(local)
  })

  it('el grupo SIN proveedor no ofrece el botón', async () => {
    // No hay a quién pedirle. Ofrecerlo y fallar después es peor: el clic ya se
    // dio y la persona cree que la orden se creó.
    await montar()

    expect(
      within(tarjetaDe('Sin proveedor asignado')).queryByRole('button', { name: /Orden de compra/ })
    ).toBeNull()
  })

  it('con todo destildado NO manda nada', async () => {
    vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()

    await act(async () => {
      fireEvent.click(within(filaDe('Barra de cereal')).getByRole('checkbox'))
    })
    await act(async () => { fireEvent.click(botonDe('Almacén Sur', 'Orden de compra')) })

    expect(post).not.toHaveBeenCalled()
  })

  it('si el servidor la rechaza, se muestra SU mensaje', async () => {
    // `err.message` diría «Request failed with status code 400», que manda a
    // buscar el problema al lugar equivocado.
    const error = vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()

    post.mockRejectedValue({
      response: { data: { error: 'SIN_STOCK', message: 'El proveedor está inactivo.' } },
      message: 'Request failed with status code 400',
    })

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte', 'Orden de compra')) })

    expect(error).toHaveBeenCalledWith(expect.stringContaining('El proveedor está inactivo.'))
  })
})

// ════════════════════════════════════════════
//  Los estados que no son «hay datos»
// ════════════════════════════════════════════

describe('Cuando no hay faltantes, o todavía no llegaron', () => {
  it('sin faltantes lo dice, con su ícono', async () => {
    await montar({ datos: VACIA })

    const vacio = document.querySelector('[data-estado-vacio="sin_faltantes"]')

    expect(vacio).not.toBeNull()
    expect(vacio.querySelector('svg')).not.toBeNull()
    expect(vacio.textContent).toContain('No falta nada.')
  })

  it('el vacío nombra el umbral con el que se calculó', async () => {
    // Sin el número, «no falta nada» se lee como una afirmación absoluta. Con
    // un umbral de 3 puede faltar algo que con 10 aparecería.
    await montar({ datos: VACIA })

    expect(screen.getByText(/umbral de 3/)).toBeInTheDocument()
  })

  it('mientras los faltantes viajan NO dice que no falta nada', async () => {
    // El render intermedio. Afirmar un vacío que todavía no se sabe le dice al
    // usuario que su inventario está bien justo cuando se está formando la
    // primera impresión.
    await montar({ respuestaPendiente: true })

    expect(document.querySelector('[data-estado-vacio="sin_faltantes"]')).toBeNull()
  })

  it('el error de carga se muestra con el mensaje del servidor', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => {})

    vi.spyOn(api, 'get').mockRejectedValue({
      response: { data: { error: 'FORBIDDEN', message: 'Te falta el permiso «stock.ver».' } },
      message: 'Request failed with status code 403',
    })

    await act(async () => { render(<Faltantes />) })

    expect(error).toHaveBeenCalledWith(expect.stringContaining('stock.ver'))
  })
})

describe('El umbral vuelve a consultar, con rebote', () => {
  /** Cuántas veces se pidieron los faltantes. */
  const consultas = () => get.mock.calls.filter(([u]) => String(u).startsWith('/faltantes'))

  /** Espera el rebote con el reloj real. */
  const esperarElRebote = () =>
    act(async () => { await new Promise((listo) => setTimeout(listo, ESPERA_DE_BUSQUEDA + 80)) })

  it('el `<label>` está asociado al campo', async () => {
    // ⚠ Este caso encontró un defecto que ninguna lectura del archivo había
    // visto: el `<label>` estaba suelto, sin `htmlFor`. Con un lector de
    // pantalla el campo no tiene nombre —se anuncia «spinbutton» a secas— y
    // hacer clic en la palabra «Umbral» no lo enfoca.
    //
    // `getByLabelText` falla si la asociación no existe, así que el test es la
    // afirmación.
    await montar()

    expect(screen.getByLabelText(/Umbral/i)).toHaveValue(3)
  })

  it('cambiarlo consulta de nuevo, con el valor nuevo', async () => {
    await montar()

    const antes = consultas().length

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Umbral/i), { target: { value: '10' } })
    })
    await esperarElRebote()

    expect(consultas().length).toBeGreaterThan(antes)
    expect(String(consultas().at(-1)[0])).toContain('umbral=10')
  })

  it('escribir «100» es UNA consulta, no tres', async () => {
    // Sin rebote, cada tecla disparaba un `GET /faltantes`, que barre el
    // inventario entero de la sucursal: escribir un número de tres cifras eran
    // tres barridos, y los dos primeros sobre umbrales que nadie quiso.
    await montar()

    const antes = consultas().length

    for (const valor of ['1', '10', '100']) {
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Umbral/i), { target: { value: valor } })
      })
    }
    await esperarElRebote()

    expect(consultas().length).toBe(antes + 1)
    expect(String(consultas().at(-1)[0])).toContain('umbral=100')
  })

  it('el campo muestra lo tipeado al instante, aunque la consulta espere', async () => {
    // La otra mitad del rebote: un campo que no responde hasta que vuelve el
    // servidor se siente roto. Lo que espera es la consulta, no la escritura.
    await montar()

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Umbral/i), { target: { value: '25' } })
    })

    expect(screen.getByLabelText(/Umbral/i)).toHaveValue(25)
  })
})

// ════════════════════════════════════════════
//  Lo que la reescritura corrigió
//
//  Los cuatro salieron de escribir la red de arriba, no de leer el archivo. Es
//  el motivo por el que el informe puso el test ANTES de la reescritura.
// ════════════════════════════════════════════

describe('Dos clics NO crean dos órdenes de compra', () => {
  const botonDe = (proveedor) =>
    within(tarjetaDe(proveedor)).getByRole('button', { name: /Orden de compra/ })

  it('dos clics en la misma tanda mandan UN solo POST', async () => {
    // ⚠ Los dos clics van adentro de UN SOLO `act`. Con un `act` por clic React
    // alcanza a renderizar en el medio, y entonces un cerrojo hecho con estado
    // también pasaría: el test quedaría verde con y sin la corrección. Es el
    // error que este repositorio ya cometió con el cobro del punto de venta.
    //
    // Dos órdenes al mismo proveedor duplican la deuda cuando se reciben las
    // dos, y nadie las mira hasta que el saldo no cierra.
    await montar()

    const boton = botonDe('Distribuidora Norte')

    await act(async () => {
      fireEvent.click(boton)
      fireEvent.click(boton)
    })

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('el cerrojo es POR PROVEEDOR: dos proveedores distintos sí entran', async () => {
    // Un cerrojo global —un solo booleano para toda la pantalla— pasaría el
    // caso de arriba y rompería la rutina real, que es crear las órdenes de
    // todos los proveedores una atrás de otra.
    await montar()

    await act(async () => {
      fireEvent.click(botonDe('Distribuidora Norte'))
      fireEvent.click(botonDe('Almacén Sur'))
    })

    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls.map(([url]) => url)).toEqual([
      '/suppliers/7/orders',
      '/suppliers/9/orders',
    ])
  })

  it('y un intento fallido NO deja el botón inerte', async () => {
    // La otra mitad, y la que rompe un cerrojo mal escrito: sin el `finally`,
    // un solo rechazo del servidor dejaba ese proveedor sin poder pedir por el
    // resto de la sesión, y sin ninguna señal de por qué.
    vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()

    post.mockRejectedValueOnce({ response: { data: { message: 'Se cayó.' } } })

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte')) })
    expect(post).toHaveBeenCalledTimes(1)

    await act(async () => { fireEvent.click(botonDe('Distribuidora Norte')) })
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('La orden creada queda marcada', () => {
  it('después de crearla, la tarjeta lo dice', async () => {
    // Sin la marca, la única forma de no crear la misma orden dos veces era
    // acordarse. El aviso de éxito dura tres segundos; la lista queda.
    await montar()

    expect(within(tarjetaDe('Distribuidora Norte')).queryByText(/Orden creada/)).toBeNull()

    await act(async () => {
      fireEvent.click(within(tarjetaDe('Distribuidora Norte')).getByRole('button', { name: /Orden de compra/ }))
    })

    expect(within(tarjetaDe('Distribuidora Norte')).getByText(/Orden creada/)).toBeInTheDocument()
    // Y solo esa: la del otro proveedor no se marca.
    expect(within(tarjetaDe('Almacén Sur')).queryByText(/Orden creada/)).toBeNull()
  })

  it('si el servidor la rechaza, NO se marca', async () => {
    // Marcarla igual sería peor que no marcarla: diría que el pedido salió
    // cuando no salió.
    vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar()
    post.mockRejectedValueOnce({ response: { data: { message: 'Se cayó.' } } })

    await act(async () => {
      fireEvent.click(within(tarjetaDe('Distribuidora Norte')).getByRole('button', { name: /Orden de compra/ }))
    })

    expect(within(tarjetaDe('Distribuidora Norte')).queryByText(/Orden creada/)).toBeNull()
  })
})

describe('El botón de orden de compra mira el permiso', () => {
  it('sin `ordenes_compra.crear` queda apagado, y dice cuál falta', async () => {
    // Antes no miraba nada: quien no puede crearlas apretaba, comía un 403 y no
    // sabía por qué. La regla del sistema es apagar con el motivo, no esconder.
    await montar()

    await act(async () => { useStore.setState({ permisos: ['stock.ver'] }) })

    const boton = within(tarjetaDe('Distribuidora Norte')).getByRole('button', { name: /Orden de compra/ })

    expect(boton).toBeDisabled()
    expect(boton.getAttribute('title')).toContain('ordenes_compra.crear')
    expect(boton.className).not.toContain('pointer-events-none')
  })

  it('con el permiso funciona', async () => {
    // El contra-caso: apagarlo siempre pasaría el de arriba y la pantalla
    // quedaría sin su acción principal.
    await montar()

    expect(
      within(tarjetaDe('Distribuidora Norte')).getByRole('button', { name: /Orden de compra/ })
    ).not.toBeDisabled()
  })
})

describe('Los importes se escriben en formato argentino', () => {
  it('siempre con dos decimales, y nunca con tres', async () => {
    // ⚠ `toLocaleString('es-AR')` sin opciones deja hasta TRES decimales por
    // defecto y ningún mínimo: en la misma columna convivían «$1.200» y
    // «$1.234,567». Un costo es una división en cuanto alguien carga un bulto
    // de doce unidades, así que los tres decimales llegan solos.
    await montar({
      datos: {
        umbral: 3,
        total_items: 1,
        total_estimado: 1234.567,
        proveedores: [{
          supplier_id: 7,
          proveedor: { id: 7, nombre: 'Distribuidora Norte', telefono: null },
          total_estimado: 1234.567,
          items: [{
            product_id: 101, nombre: 'Colágeno 300g', marca: null,
            stock: 0, min_stock: 1, sugerido: 1, costo: 1234.567,
          }],
        }],
      },
    })

    const subtotal = within(filaDe('Colágeno 300g')).getByText(/^\$/)

    expect(subtotal.textContent).toBe('$1.234,57')
    expect(subtotal.textContent).not.toContain('1.234,567')
  })

  it('el total del encabezado también', async () => {
    await montar()

    const total = screen.getByText('Costo estimado').parentElement.querySelector('.num')

    expect(total.textContent).toBe('$20.500,00')
  })
})

describe('Los controles de una fila tienen nombre', () => {
  it('la casilla, el campo y los dos botones dicen de qué producto son', async () => {
    // En una lista de veinte productos hay cuarenta botones «−» y «+». Sin
    // nombre, con un lector de pantalla se anuncian todos igual y no hay forma
    // de saber a cuál pertenecen.
    await montar()

    expect(screen.getByLabelText('Pedir Colágeno 300g')).toBeInTheDocument()
    expect(screen.getByLabelText('Cantidad de Colágeno 300g')).toBeInTheDocument()
    expect(screen.getByLabelText('Agregar uno de Colágeno 300g')).toBeInTheDocument()
    expect(screen.getByLabelText('Sacar uno de Colágeno 300g')).toBeInTheDocument()
  })
})
