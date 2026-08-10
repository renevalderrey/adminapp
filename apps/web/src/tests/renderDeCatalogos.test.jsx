import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Catalogos from '@/pages/Catalogos'
import { gruposVisibles } from '@/components/navegacion'
import { urlDelQr } from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · /catalogos, renderizado
//
//  Lo que se afirma acá es **el dibujo y el efecto**, no las reglas: de qué tono
//  va un badge, cómo se normaliza un slug y qué dice «Gana en» ya están en
//  `utils/catalogos.test.js`, que es cien veces más barato y no se rompe cuando
//  alguien mueve un `<div>`.
//
//  Acá se verifica lo que sólo se puede ver montando:
//
//   · que sin `catalogo.ver` el ítem del menú no aparezca, y que sin
//     `catalogo.editar` los campos queden **deshabilitados con su motivo** y no
//     ausentes;
//   · que cambiar el slug **pida confirmación** y que el texto nombre los QR
//     impresos ANTES de que alguien acepte;
//   · que lo que falta para publicar se dibuje como **lista** y no concatenado;
//   · que el encabezado y las filas de las dos tablas de reglas compartan el
//     MISMO `grid-template-columns`;
//   · que una regla huérfana se dibuje atenuada y con «0 de 0», y no desaparezca;
//   · que «Publicar» sobre diez productos haga **una** llamada y no diez;
//   · y que con el catálogo en borrador el QR avise que no lleva a ningún lado.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports arrastra decenas de
//  exportaciones nombradas y la lista se desactualiza sola. Se espía la
//  instancia de axios, que es lo que manda `CONVENCIONES.md`.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const SUCURSAL = { id: 3, name: 'Depósito Mayo' }

const PUBLICADO = {
  id: 7,
  slug: 'comprafit-fitnet',
  nombre_visible: 'Comprafit / Fitnet',
  descripcion: 'Suplementos con precio de socio.',
  logo_url: '/img/aa/bb/logo.png',
  portada_url: null,
  color_marca: '#00B4B6',
  punto_de_venta_id: 3,
  whatsapp_destino: '1144029915',
  email_avisos: 'pedidos@comprafit.test',
  datos_transferencia: { titular: 'Comprafit S.R.L.', cbu: '0720123488000012345678', alias: 'COMPRAFIT.SUPLE', banco: 'Santander' },
  retiro_socio: true,
  retiro_socio_direccion: 'Recepción de Fitnet',
  retiro_local: true,
  envio: true,
  envio_costo: 2500,
  envio_gratis_desde: 50000,
  coordinar_whatsapp: true,
  pide_nro_socio: false,
  mostrar_precio_lista: false,
  mp_habilitado: false,
  estado: 'publicado',
  productos: 8,
}

/** El mismo catálogo pero sin publicar, y **sin casilla de avisos cargada**. */
const BORRADOR = {
  ...PUBLICADO,
  id: 9,
  slug: 'comprafit-borrador',
  nombre_visible: 'Comprafit borrador',
  estado: 'borrador',
  email_avisos: '',
  productos: 0,
}

/**
 * Cuatro reglas, una por ámbito, con la cobertura que cuenta la historia.
 *
 * ⚠ El reparto no es decorativo. La de catálogo **alcanza a ocho y gana en
 * cuatro**: es el caso que la pantalla existe para hacer visible —las otras tres
 * le pisaron la mitad—. Con todas ganando en todo, la columna «Gana en» pasaría
 * cualquier afirmación sin decir nada.
 *
 * Y la de marca es **huérfana**: su marca se borró, así que el servidor la
 * devuelve con `0 de 0`. Es la que verifica que no desaparezca.
 */
const REGLAS = [
  { id: 1, ambito: 'catalogo', categoria: null, brand_id: null, product_id: null, tipo: 'porcentaje_descuento', valor: 10, activo: true, cobertura: { alcanza: 8, gana: 4 } },
  { id: 2, ambito: 'categoria', categoria: 'proteinas', brand_id: null, product_id: null, tipo: 'porcentaje_descuento', valor: 15, activo: true, cobertura: { alcanza: 3, gana: 2 } },
  { id: 3, ambito: 'marca', categoria: null, brand_id: 404, product_id: null, tipo: 'monto_descuento', valor: 1500, activo: true, cobertura: { alcanza: 0, gana: 0 } },
  { id: 4, ambito: 'producto', categoria: null, brand_id: null, product_id: 41, tipo: 'precio_fijo', valor: 9900, activo: true, cobertura: { alcanza: 1, gana: 1 } },
]

const PREVIA = {
  productos: [
    {
      id: 41,
      name: 'Colágeno 300g',
      sku: 'COL-300',
      category: 'Proteínas',
      brand_id: 2,
      image_url: null,
      precio_lista: 12000,
      precio: 9900,
      regla: REGLAS[3],
      // Dos pisadas: es lo que hace verificable que se dibujen tachadas debajo
      // de la que ganó. Con cero, el caso pasaría sobre una pantalla que nunca
      // las dibuja.
      pisadas: [REGLAS[1], REGLAS[0]],
      avisos: [],
    },
    {
      id: 42,
      name: 'Creatina 300g',
      sku: 'CRE-300',
      category: 'Creatina',
      brand_id: 2,
      image_url: null,
      precio_lista: 8000,
      precio: 0,
      regla: REGLAS[0],
      pisadas: [],
      avisos: ['QUEDA_EN_CERO'],
    },
  ],
  sin_precio: [{ id: 43, name: 'Shaker 600ml', sku: 'SHA-600' }],
  no_publicables: [],
  totales: { en_el_catalogo: 3, salen: 2, sin_precio: 1, no_publicables: 0 },
}

const CATEGORIAS = [
  { categoria: 'creatina', etiqueta: 'Creatina', productos: 1 },
  { categoria: 'proteinas', etiqueta: 'Proteínas', productos: 3 },
]

const MARCAS = [{ id: 2, name: 'Ena Sport' }]

/**
 * Diez visitas y un pedido: 10 %.
 *
 * Con una y una la conversión daría 100 % y cualquier cuenta equivocada
 * —incluida `visitas/pedidos`— daría el mismo número. Y cuatro de las visitas
 * llegaron con el catálogo **pausado**, que es lo que hace verificable que ese
 * período se distinga.
 */
const METRICAS = {
  dias: 30,
  desde: '2026-07-12',
  visitas: 14,
  pedidos: 1,
  conversion: 0.1,
  por_origen: { qr: 7, directo: 3, whatsapp: 4 },
  por_estado: { publicado: 10, pausado: 4 },
}

/**
 * Doce productos: dos ya en el catálogo y diez fuera.
 *
 * Los diez de afuera son los que se seleccionan para el caso del lote: con
 * menos, «una llamada y no diez» no se podría afirmar. Uno de ellos trae la foto
 * externa y otro no tiene precio.
 */
const PRODUCTOS = [
  { id: 41, name: 'Colágeno 300g', sku: 'COL-300', category: 'Proteínas', brand_id: 2, image_url: null, precio_lista: 12000, en_el_catalogo: true, orden: 0, publicable: true, is_active: true, avisos: [] },
  { id: 42, name: 'Creatina 300g', sku: 'CRE-300', category: 'Creatina', brand_id: 2, image_url: null, precio_lista: 8000, en_el_catalogo: true, orden: 1, publicable: true, is_active: true, avisos: [] },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: 100 + i,
    name: `Producto suelto ${i + 1}`,
    sku: `SUE-${100 + i}`,
    category: 'Varios',
    brand_id: 2,
    image_url: i === 0 ? 'https://otro-hosting.test/foto.jpg' : null,
    precio_lista: i === 1 ? 0 : 5000,
    en_el_catalogo: false,
    orden: null,
    publicable: true,
    is_active: true,
    avisos: i === 0 ? ['FOTO_EXTERNA'] : i === 1 ? ['SIN_PRECIO'] : [],
  })),
]

/** Todo lo que salió por la red, en orden. */
let pedidos = []

function respuestasDe(lista) {
  return (url, config) => {
    pedidos.push({ metodo: 'get', url, params: config?.params })

    if (url === '/catalogos') return Promise.resolve({ data: { ok: true, data: lista } })
    if (url === '/brands') return Promise.resolve({ data: { ok: true, data: MARCAS } })
    if (url === '/catalogos/slug-disponible') {
      return Promise.resolve({ data: { ok: true, data: { slug: config?.params?.slug, disponible: true, motivo: null } } })
    }
    if (/\/reglas$/.test(url)) {
      return Promise.resolve({ data: { ok: true, data: { reglas: REGLAS, productos: 8 } } })
    }
    if (/\/previsualizacion$/.test(url)) return Promise.resolve({ data: { ok: true, data: PREVIA } })
    if (/\/categorias$/.test(url)) return Promise.resolve({ data: { ok: true, data: CATEGORIAS } })
    if (/\/productos$/.test(url)) return Promise.resolve({ data: { ok: true, data: PRODUCTOS } })
    if (/\/metricas$/.test(url)) return Promise.resolve({ data: { ok: true, data: METRICAS } })

    return Promise.resolve({ data: { ok: true, data: [] } })
  }
}

async function montar({
  lista = [PUBLICADO],
  permisos = ['catalogo.ver', 'catalogo.editar', 'products.ver'],
} = {}) {
  useStore.setState({
    permisos,
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [SUCURSAL] },
  })

  vi.spyOn(api, 'get').mockImplementation(respuestasDe(lista))

  let utilidades
  await act(async () => { utilidades = render(<Catalogos />) })
  await act(async () => {})

  return utilidades
}

/** Monta con otras métricas, para los casos del borde. */
async function montarConMetricas(metricas) {
  useStore.setState({
    permisos: ['catalogo.ver', 'catalogo.editar', 'products.ver'],
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [SUCURSAL] },
  })

  const base = respuestasDe([PUBLICADO])

  vi.spyOn(api, 'get').mockImplementation((url, config) => {
    if (/\/metricas$/.test(url)) return Promise.resolve({ data: { ok: true, data: metricas } })
    return base(url, config)
  })

  let utilidades
  await act(async () => { utilidades = render(<Catalogos />) })
  await act(async () => {})

  return utilidades
}

/** Va a una pestaña del detalle y espera a que termine de cargar. */
async function irA(nombre) {
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: nombre })) })
  await act(async () => {})
}

/** El `grid-template-columns` declarado en línea, tal cual. */
function columnasDe(elemento) {
  const estilo = elemento?.getAttribute('style') || ''

  return estilo.match(/grid-template-columns:\s*([^;]+)/)?.[1]?.trim() || null
}

/** El texto de la confirmación de `useConfirmDialog`. */
const textoDeLaConfirmacion = () =>
  document.querySelector('[data-slot="dialog-description"]')?.textContent || ''

beforeEach(() => {
  pedidos = []
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  T1452 · La lista y el cableado
// ════════════════════════════════════════════

describe('La pantalla de Catálogos y su lugar en el menú', () => {
  it('sin `catalogo.ver` el ítem del menú no aparece', () => {
    const con = gruposVisibles(() => true, { esDueño: true })
    const sin = gruposVisibles((codigo) => codigo !== 'catalogo.ver', { esDueño: true })

    const nombres = (grupos) => grupos.flatMap((g) => g.items).map((i) => i.label)

    // Los dos sentidos: con el permiso está, sin el permiso no. Con uno solo, un
    // filtro que escondiera SIEMPRE el ítem también pasaría.
    expect(nombres(con)).toContain('Catálogos')
    expect(nombres(sin)).not.toContain('Catálogos')
  })

  it('el ítem declara el módulo `catalogo` y la ruta lo exige con RouteGuard', () => {
    // El ítem y la `<Route>` van en el mismo cambio: un ítem que gatea por
    // módulo sin guard en la ruta esconde el menú y deja entrar la URL escrita a
    // mano, que es la mitad inútil del gateo.
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
    const menu = fs.readFileSync(path.join(SRC, 'components/navegacion.js'), 'utf8')

    expect(menu).toMatch(/to: '\/catalogos'[^}]*modulo: 'catalogo'/)
    expect(app).toMatch(/path="\/catalogos"[^\n]*requiredModule="catalogo"/)
    expect(app).toMatch(/path="\/catalogos"[^\n]*<MarcoDePantalla>/)
  })

  it('el título de la pantalla es el mismo string que el label del menú', async () => {
    await montar()

    const item = gruposVisibles(() => true, { esDueño: true })
      .flatMap((g) => g.items)
      .find((i) => i.to === '/catalogos')

    expect(item.label).toBe('Catálogos')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.label)
  })

  it('la lista dibuja cada catálogo con su dirección completa y su badge', async () => {
    await montar({ lista: [PUBLICADO, BORRADOR] })

    // Se mira DENTRO de la lista: el nombre y la dirección del catálogo elegido
    // aparecen también en el detalle de abajo, y un `getByText` suelto no
    // distingue cuál de los dos encontró.
    const lista = within(document.querySelector('[data-lista="catalogos"]'))

    expect(lista.getByText('Comprafit / Fitnet')).toBeInTheDocument()
    expect(lista.getByText('Comprafit borrador')).toBeInTheDocument()
    expect(lista.getByText('Publicado')).toBeInTheDocument()
    expect(lista.getByText('Borrador')).toBeInTheDocument()
    expect(lista.getByText(/\/c\/comprafit-fitnet$/)).toBeInTheDocument()
  })

  it('el encabezado y las filas de la lista comparten el mismo grid-template-columns', async () => {
    await montar({ lista: [PUBLICADO, BORRADOR] })

    const rejilla = [...document.querySelectorAll('[style*="grid-template-columns"]')]
      .map(columnasDe)
      .filter(Boolean)

    // Ancla: si el selector dejara de encontrar nada, comparar cero strings
    // pasaría en verde.
    expect(rejilla.length).toBeGreaterThanOrEqual(3)
    expect(new Set(rejilla).size).toBe(1)
  })

  it('sin `catalogo.editar` el botón principal está DESHABILITADO, no ausente', async () => {
    await montar({ permisos: ['catalogo.ver'] })

    const boton = screen.getByRole('button', { name: /Nuevo catálogo/ })

    expect(boton).toBeDisabled()
    expect(boton).toHaveAttribute('title', expect.stringContaining('catalogo.editar'))
  })

  it('lo que falta para publicar se dibuja como LISTA, renglón por renglón', async () => {
    await montar({ lista: [BORRADOR] })

    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 409,
        data: {
          ok: false,
          error: 'FALTAN_REQUISITOS',
          faltan: [
            { que: 'slug', detalle: 'La dirección está reservada.' },
            { que: 'productos', detalle: 'Ningún producto del catálogo puede salir.' },
          ],
        },
      },
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publicar' })) })

    const aviso = screen.getByRole('alert')

    // Los DOS renglones, y como `<li>`: concatenados en un párrafo, el comercio
    // arregla uno, reintenta y descubre el otro.
    expect(within(aviso).getAllByRole('listitem')).toHaveLength(2)
    expect(aviso).toHaveTextContent('La dirección está reservada.')
    expect(aviso).toHaveTextContent('Ningún producto del catálogo puede salir.')
  })
})

// ════════════════════════════════════════════
//  T1453 · Identidad, y entrega y pago
// ════════════════════════════════════════════

describe('La pestaña de Identidad', () => {
  it('cambiar el slug pide confirmación y dice que los QR impresos dejan de funcionar', async () => {
    await montar()
    const guardar = vi.spyOn(api, 'put').mockResolvedValue({ data: { ok: true, data: PUBLICADO } })

    fireEvent.change(screen.getByLabelText('Dirección web'), { target: { value: 'comprafit-2027' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar identidad/ })) })

    // El texto está a la vista ANTES de aceptar, y nombra lo que se rompe.
    expect(textoDeLaConfirmacion()).toMatch(/QR/)
    expect(textoDeLaConfirmacion()).toMatch(/impres/i)
    expect(textoDeLaConfirmacion()).toMatch(/comprafit-2027/)

    // Y mientras no se acepte, NO se guardó nada: la confirmación es antes del
    // PUT y no un aviso después.
    expect(guardar).not.toHaveBeenCalled()
  })

  it('el formulario propone el slug normalizado y muestra la dirección completa', async () => {
    await montar()

    fireEvent.change(screen.getByLabelText('Dirección web'), { target: { value: 'Comprafít / Fitnet' } })

    // El caso exacto del colapso de guiones: espacio, barra, espacio. Sin él la
    // pantalla propondría `comprafit---fitnet` y el servidor guardaría otra cosa.
    expect(document.querySelector('[data-slug-propuesto]')).toHaveTextContent(/\/c\/comprafit-fitnet$/)
  })

  it('con la casilla de avisos vacía la pantalla dice que nadie se entera por correo', async () => {
    await montar({ lista: [BORRADOR] })

    expect(screen.getByText(/nadie recibe un correo/i)).toBeInTheDocument()
  })

  it('`mostrar_precio_lista` arranca apagado', async () => {
    await montar()

    expect(screen.getByLabelText(/Mostrar el precio de lista/)).not.toBeChecked()
  })

  it('sin `catalogo.editar` los campos están deshabilitados y dicen por qué', async () => {
    await montar({ permisos: ['catalogo.ver'] })

    const nombre = screen.getByLabelText('Nombre visible')

    // Deshabilitado y NO ausente: un campo que desaparece deja a la persona
    // buscando algo que el texto de al lado le está pidiendo que complete.
    expect(nombre).toBeInTheDocument()
    expect(nombre).toBeDisabled()
    expect(nombre).toHaveAttribute('title', expect.stringContaining('catalogo.editar'))
    expect(screen.getByText(/Los campos están apagados/)).toHaveTextContent('catalogo.editar')
  })

  it('la previsualización calcula el color del texto por contraste y no lo elige', async () => {
    await montar()

    const boton = screen.getByText('Ver el catálogo')
    const claro = boton.getAttribute('style')

    fireEvent.change(screen.getByLabelText('Color de marca'), { target: { value: '#101418' } })

    // El par junto es lo que hace al caso: una previsualización que pintara
    // siempre el mismo color de texto pasaría cualquier afirmación suelta.
    expect(screen.getByText('Ver el catálogo').getAttribute('style')).not.toBe(claro)
  })
})

describe('La pestaña de Entrega y pago', () => {
  it('«gratis a partir de» vacío significa que NO hay envío gratis, y lo dice', async () => {
    await montar({ lista: [{ ...PUBLICADO, envio_gratis_desde: null }] })
    await irA('Entrega y pago')

    expect(screen.getByText(/no hay envío gratis/i)).toBeInTheDocument()
  })

  it('con un mínimo cargado, en cambio, dice a partir de cuánto no se cobra', async () => {
    await montar()
    await irA('Entrega y pago')

    expect(screen.getByText(/el envío no se cobra/i)).toBeInTheDocument()
  })

  it('vacío viaja como `null` y no como cero', async () => {
    // Son dos cosas distintas y la tienda las dibuja distinto: mandar 0 diría
    // «el envío es gratis a partir de $0», o sea gratis siempre.
    await montar({ lista: [{ ...PUBLICADO, envio_gratis_desde: null }] })
    await irA('Entrega y pago')

    const guardar = vi.spyOn(api, 'put').mockResolvedValue({ data: { ok: true, data: PUBLICADO } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar entrega y pago/ })) })

    expect(guardar.mock.calls[0][1].envio_gratis_desde).toBeNull()
  })
})

// ════════════════════════════════════════════
//  T1454 · Las reglas de precio
// ════════════════════════════════════════════

describe('Las reglas de precio', () => {
  it('encabezado y filas comparten el mismo `grid-template-columns`', async () => {
    await montar()
    await irA('Reglas de precio')

    const encabezado = columnasDe(screen.getByText('Gana en').closest('[style*="grid-template-columns"]'))
    const filas = REGLAS.map((r) => columnasDe(document.querySelector(`[data-regla="${r.id}"]`)))

    // Ancla: sin esto, comparar `null` con `null` pasaría sin haber leído nada.
    expect(encabezado).toBeTruthy()
    expect(filas.filter(Boolean)).toHaveLength(REGLAS.length)

    for (const fila of filas) expect(fila).toBe(encabezado)
  })

  it('la sangría crece con la especificidad: se ve que gana la más específica', async () => {
    await montar()
    await irA('Reglas de precio')

    const sangriaDe = (id) => document
      .querySelector(`[data-regla="${id}"]`)
      .querySelector('[style*="padding-left"]')
      .getAttribute('style')

    // Cuatro sangrías distintas, una por ámbito. Con todas iguales, «gana la más
    // específica» habría que leerlo en un manual.
    const sangrias = REGLAS.map((r) => sangriaDe(r.id))

    expect(new Set(sangrias).size).toBe(4)
    expect(sangriaDe(1)).toContain('0px')
  })

  it('«Gana en» dice los dos números: cuatro de ocho, y no cuatro a secas', async () => {
    await montar()
    await irA('Reglas de precio')

    expect(within(document.querySelector('[data-regla="1"]')).getByText('4 de 8')).toBeInTheDocument()
  })

  it('una regla huérfana se dibuja atenuada y con 0 de 0, y no desaparece', async () => {
    await montar()
    await irA('Reglas de precio')

    const huerfana = document.querySelector('[data-regla="3"]')

    // Está: esconderla dejaría una fila en la base que nadie puede ver para
    // borrarla, y la columna «Gana en» dejaría de sumar sin ninguna explicación.
    expect(huerfana).not.toBeNull()
    expect(within(huerfana).getByText('0 de 0')).toBeInTheDocument()
    expect(huerfana.className).toContain('opacity-55')

    // Y las otras tres NO están atenuadas: si todas lo estuvieran, la atenuación
    // no diría nada.
    expect(document.querySelector('[data-regla="1"]').className).not.toContain('opacity-55')
  })

  it('la previsualización muestra la regla que gana y las pisadas tachadas', async () => {
    await montar()
    await irA('Reglas de precio')

    const fila = document.querySelector('[data-previa="41"]')

    expect(within(fila).getByText(/Producto · \$9\.900/)).toBeInTheDocument()

    const tachadas = [...fila.querySelectorAll('.line-through')]
      .map((n) => n.textContent)
      .join(' ')

    // Las dos pisadas y el precio de lista: es lo que hace entendible por qué el
    // precio final es ése y no el otro.
    expect(tachadas).toContain('Categoría')
    expect(tachadas).toContain('Todo el catálogo')
  })

  it('el aviso de que una regla deja el precio en cero se dibuja en su fila', async () => {
    await montar()
    await irA('Reglas de precio')

    const fila = document.querySelector('[data-previa="42"]')

    expect(within(fila).getByText(/deja en \$0/i)).toBeInTheDocument()
  })

  it('la pantalla NO calcula precios: los toma del servidor tal cual', () => {
    // Guardia estática, y es la que importa: una segunda implementación del
    // motor de reglas acá abajo se desincroniza del servidor y el número que ve
    // el comercio deja de ser el que ve el visitante, sin que nada falle.
    const fuente = fs.readFileSync(path.join(SRC, 'components/ReglasDePrecio.jsx'), 'utf8')

    expect(fuente).not.toMatch(/porcentaje_descuento['"]?\s*(?:===|==)/)
    expect(fuente).not.toMatch(/\bvalor\s*\/\s*100\b/)
    expect(fuente).not.toMatch(/precio_lista\s*[*\-+]/)
  })
})

// ════════════════════════════════════════════
//  T1455 · Los productos del catálogo
// ════════════════════════════════════════════

describe('Los productos del catálogo', () => {
  it('el contador dice cuántos están publicados de cuántos hay', async () => {
    await montar()
    await irA('Productos')

    expect(screen.getByText(/publicados de/)).toHaveTextContent('2')
    expect(screen.getByText(/publicados de/)).toHaveTextContent('12')
  })

  it('seleccionar diez y apretar «Publicar» hace UNA llamada en lote y no diez', async () => {
    await montar()
    await irA('Productos')

    const enviar = vi.spyOn(api, 'post').mockResolvedValue({
      data: { ok: true, data: { pedidos: 10, agregados: 10, ya_estaban: 0, ajenos: 0 } },
    })

    const sueltos = PRODUCTOS.filter((p) => !p.en_el_catalogo)
    expect(sueltos).toHaveLength(10)

    for (const p of sueltos) {
      fireEvent.click(screen.getByLabelText(`Seleccionar ${p.name}`))
    }

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publicar' })) })

    // UNA, con los diez ids adentro. Diez llamadas en paralelo sobre la misma
    // tabla es la forma de que cinco entren, tres choquen y dos se pierdan.
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(enviar.mock.calls[0][1].ids).toHaveLength(10)
  })

  it('«Quitar» también va en lote, y por el mismo camino', async () => {
    await montar()
    await irA('Productos')

    const borrar = vi.spyOn(api, 'delete').mockResolvedValue({
      data: { ok: true, data: { pedidos: 2, quitados: 2 } },
    })

    fireEvent.click(screen.getByLabelText('Seleccionar Colágeno 300g'))
    fireEvent.click(screen.getByLabelText('Seleccionar Creatina 300g'))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Quitar' })) })

    expect(borrar).toHaveBeenCalledTimes(1)
    expect(borrar.mock.calls[0][1].data.ids).toEqual([41, 42])
  })

  it('la pantalla dice que quitar BORRA la fila y no toca el inventario', async () => {
    await montar()
    await irA('Productos')

    expect(screen.getByText(/borra la/i)).toHaveTextContent('inventario')
  })

  it('un producto con foto externa lo dice, y no se dibuja como publicable sin más', async () => {
    await montar()
    await irA('Productos')

    const conFoto = document.querySelector('[data-producto="100"]')
    const sinAvisos = document.querySelector('[data-producto="102"]')

    expect(within(conFoto).getByText(/foto externa/i)).toBeInTheDocument()
    // El contra-caso: si el aviso apareciera en todas las filas, no diría nada.
    expect(within(sinAvisos).queryByText(/foto externa/i)).toBeNull()
  })

  it('un producto sin precio lo dice: no va a salir aunque esté publicado', async () => {
    await montar()
    await irA('Productos')

    const sinPrecio = document.querySelector('[data-producto="101"]')

    expect(within(sinPrecio).getByText(/no va a salir/i)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1456 · El QR y el enlace
// ════════════════════════════════════════════

describe('El QR y el enlace', () => {
  it('la URL del QR lleva el parámetro de origen y el enlace que se copia NO', () => {
    // Los dos juntos: con `?f=qr` en los dos, no habría forma de separar los
    // escaneos del cartel de las visitas que llegaron por WhatsApp.
    expect(urlDelQr('comprafit-fitnet')).toContain('?f=qr')
    expect(urlDelQr('comprafit-fitnet')).toMatch(/\/c\/comprafit-fitnet\?f=qr$/)
  })

  it('con el catálogo en borrador el QR avisa que no lleva a ningún lado', async () => {
    await montar({ lista: [BORRADOR] })
    await irA('QR y enlace')

    const aviso = screen.getByRole('alert')

    expect(aviso).toHaveTextContent(/borrador/i)
    expect(aviso).toHaveTextContent(/no lleva a ningún lado/i)
  })

  it('con el catálogo publicado ese aviso NO está', async () => {
    // El contra-caso. Un aviso que aparece siempre deja de ser un aviso.
    await montar()
    await irA('QR y enlace')

    expect(screen.queryByText(/no lleva a ningún lado/i)).toBeNull()
  })

  it('la pestaña dice «Visitas» y en ninguna parte dice «Escaneos»', async () => {
    // El servidor no puede distinguir un QR escaneado de un enlace pegado en
    // WhatsApp: el `?f=` es lo que declara el cartel, no lo que se mide.
    // Llamarle «escaneos» al número es mentir con una métrica, y encima con una
    // que el comercio usa para decidir si el acuerdo con el gimnasio sirve.
    await montar()
    await irA('QR y enlace')

    const bloque = document.querySelector('[data-metricas]')

    expect(bloque).not.toBeNull()
    expect(bloque.textContent).toContain('Visitas')
    expect(document.body.textContent.toLowerCase()).not.toContain('escaneos')
  })

  it('los tres números salen del servidor, con la conversión en porcentaje', async () => {
    await montar()
    await irA('QR y enlace')

    expect(document.querySelector('[data-visitas]').textContent).toBe('14')
    expect(document.querySelector('[data-pedidos]').textContent).toBe('1')
    expect(document.querySelector('[data-conversion]').textContent).toBe('10 %')
  })

  it('con cero visitas se dibuja un guion, no «0 %»', async () => {
    // `0/0` no da cero: no existe. Un «0 %» le dice al comercio que su tienda
    // convierte mal cuando lo que pasó es que nadie la abrió.
    vi.restoreAllMocks()
    await montarConMetricas({ ...METRICAS, visitas: 0, pedidos: 0, conversion: null, por_origen: {}, por_estado: {} })
    await irA('QR y enlace')

    expect(document.querySelector('[data-conversion]').textContent).toBe('—')
    expect(document.querySelector('[data-conversion]').textContent).not.toContain('%')
  })

  it('el período con el catálogo pausado se distingue', async () => {
    // Para que una conversión en cero no se lea como un problema de la tienda.
    await montar()
    await irA('QR y enlace')

    expect(document.querySelector('[data-pausadas]').textContent).toContain('4')
    expect(document.querySelector('[data-pausadas]').textContent).toContain('pausado')
  })

  it('el desglose por origen se presenta como aproximación', async () => {
    await montar()
    await irA('QR y enlace')

    expect(document.querySelector('[data-origenes]').textContent).toContain('Aproximadamente')
    expect(document.querySelector('[data-origenes]').textContent).toContain('7 por qr')
  })

  it('el enlace que se copia lleva el protocolo, listo para pegar en WhatsApp', async () => {
    await montar()
    await irA('QR y enlace')

    expect(document.querySelector('[data-enlace]')).toHaveTextContent(/^https?:\/\/.+\/c\/comprafit-fitnet$/)
    expect(screen.getByRole('button', { name: /Copiar/ })).toBeInTheDocument()
  })

  it('están las tres descargas: PNG, SVG y el cartel A4', async () => {
    await montar()
    await irA('QR y enlace')

    expect(screen.getByRole('button', { name: /Descargar PNG/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Descargar SVG/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cartel A4/ })).toBeInTheDocument()
  })

  it('el cartel A4 lleva el nombre y la leyenda «escaneá con la cámara»', async () => {
    // Imprimir el QR solo, sin decir de qué es, es un cartel que nadie escanea.
    const { armarCartel } = await import('@/utils/cartelDeQr')

    const hoja = armarCartel({
      nombre: 'Comprafit / Fitnet',
      descripcion: 'Suplementos',
      direccion: 'https://tienda.favalio.com/c/comprafit-fitnet',
      qr: 'data:image/png;base64,xxx',
      logo: '/img/aa/bb/logo.png',
    })

    expect(hoja).toContain('Comprafit / Fitnet')
    expect(hoja).toContain('Escaneá con la cámara')
    expect(hoja).toContain('/c/comprafit-fitnet')
    expect(hoja).toContain('/img/aa/bb/logo.png')
  })

  it('el nombre del catálogo se escapa antes de entrar al cartel', async () => {
    // El nombre lo escribe el comercio en un formulario y termina en el HTML de
    // la ventana de impresión sin pasar por React.
    const { armarCartel } = await import('@/utils/cartelDeQr')

    const hoja = armarCartel({
      nombre: '<script>alert(1)</script>',
      direccion: 'x',
      qr: 'x',
      logo: null,
    })

    expect(hoja).not.toContain('<script>alert(1)</script>')
    expect(hoja).toContain('&lt;script&gt;')
  })

  it('el QR se genera en el navegador con `qrcode`: no hay endpoint que lo dibuje', () => {
    const fuente = fs.readFileSync(path.join(SRC, 'components/QrDelCatalogo.jsx'), 'utf8')

    expect(fuente).toMatch(/from 'qrcode'/)

    // ⚠ La afirmación pasó de «este componente no llama a la API» a «no le pide
    // el QR a la API», y el motivo está en el corte de las métricas: la pestaña
    // ahora sí hace un `GET /catalogos/:id/metricas`, que son números y no un
    // cuadrado. Lo que sigue prohibido es el endpoint que dibujaría la imagen
    // —un handler, una ruta, un formato y un caché para producir exactamente lo
    // que el navegador hace sin pedirle nada a nadie—.
    const llamadas = fuente.match(/api\.get\('[^']*'|api\.get\(`[^`]*`/g) || []

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]).toContain('/metricas')
    // El nombre del archivo que se descarga lleva «qr-…​.png» y eso está bien:
    // lo que no puede haber es una RUTA de la API que lo produzca.
    expect(fuente).not.toMatch(/api\.get\([^)]*qr/i)
  })
})
