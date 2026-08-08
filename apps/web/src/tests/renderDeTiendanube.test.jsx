import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Tiendanube from '@/pages/Tiendanube'
import Settings from '@/pages/Settings'
import EstadoDeTiendanube from '@/components/EstadoDeTiendanube'
import PanelDeMapeo from '@/components/PanelDeMapeo'

// ════════════════════════════════════════════
//  ADMINAPP · /tiendanube, renderizado
//
//  Lo que se afirma acá es EL DIBUJO Y EL EFECTO, no las reglas: qué estado le
//  toca a una conexión, de qué color va un badge y qué variantes entran en un
//  filtro ya están en `utils/tiendanube.test.js`, que es cien veces más barato.
//
//  Acá se verifica lo que solo se puede ver montando:
//
//   · que el encabezado y las filas compartan el MISMO `grid-template-columns`;
//   · que el badge «Sin mapear» esté en la fila de la variante que corresponde;
//   · que los cuatro estados vacíos digan cosas distintas;
//   · que el bloque de conexión NO dibuje el token de ninguna forma;
//   · que sin permiso los botones queden DESHABILITADOS y no ausentes;
//   · que la confirmación diga lo que se pierde ANTES de que alguien acepte;
//   · que un 429 y un 502 se lean distinto, no cierren el panel y no pierdan lo
//     escrito;
//   · y que la pantalla no afirme nada que el sistema no haga.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports de esta pantalla
//  arrastra decenas de exportaciones nombradas y la lista se desactualiza sola.
//  Se espía la instancia de axios, que es lo que manda `CONVENCIONES.md`.
//
//  La pantalla lee `?estado=…&motivo=…` con `useSearchParams`, así que va
//  envuelta en un `MemoryRouter`: es de donde vuelve el navegador después del
//  OAuth y es la única forma de ejercitar ese camino.
//
//  ⚠ Lo que este archivo NO puede afirmar: que la tabla scrollee dentro de su
//  tarjeta y que el `<body>` no desborde a 1140px. jsdom devuelve CERO en
//  `scrollWidth` y `clientWidth`, así que un test que los mire pasa con y sin el
//  cambio. Eso vive en `pruebas-de-navegador/marcoDeLasPantallas.navegador.js`.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const MAYO = { id: 3, name: 'Depósito Mayo', code: 'mayo' }
const CENTRO = { id: 9, name: 'Centro', code: 'centro' }

/**
 * Una tienda vinculada, con las tres fechas puestas.
 *
 * ⚠ Trae un `token` que la API **no manda**, y está ahí a propósito: el caso que
 * lo mira verifica la mitad de la pantalla —que si algún día el servidor lo
 * mandara, esto no lo dibuje—. Sin el campo, ese test pasaría por no tener nada
 * que encontrar.
 */
const TIENDA = {
  tiendanube_user_id: 4455667,
  nombre: 'Comprafit Suplementos',
  vinculada_en: '2026-08-01T14:02:11.000Z',
  punto_de_venta: MAYO,
  ultima_comunicacion_en: '2026-08-12T09:31:00.000Z',
  ultima_comunicacion_ok: true,
  ultimo_error: null,
  catalogo_refrescado_en: '2026-08-12T09:31:00.000Z',
  reconciliada_en: '2026-08-12T04:00:12.000Z',
  sincronizando: false,
  token: 'tn_tok_secreto_9x7q',
}

const VINCULADA = {
  ok: true,
  estado: 'vinculada',
  tienda: TIENDA,
  variantes: { total: 4, mapeadas: 2, pendientes: 0, con_error: 0 },
  pedidos_con_items_sin_descontar: 0,
}

const NO_VINCULADA = {
  ok: true,
  estado: 'no_vinculada',
  tienda: null,
  variantes: { total: 0, mapeadas: 0, pendientes: 0, con_error: 0 },
  pedidos_con_items_sin_descontar: 0,
}

const COLAGENO = { id: 41, name: 'Colágeno 300g', sku: 'COL-300' }

/**
 * Cuatro variantes con la SEGUNDA y la CUARTA mapeadas.
 *
 * ⚠ El reparto no es decorativo. Con una sola mapeada —o con la primera—, el
 * caso del badge pasaría igual si la pantalla dibujara «Sin mapear» siempre en
 * la primera fila, o siempre en las que no son la primera. Dos mapeadas
 * salteadas son lo que hace que ese test pueda fallar.
 */
const SIN_MAPEAR_1 = {
  tiendanube_variant_id: 111,
  tiendanube_product_id: 11,
  nombre_producto: 'Colágeno hidrolizado',
  nombre_variante: '300 g',
  sku: 'COL-300',
  stock_en_tienda: 7,
  en_la_tienda: true,
  mapeo: null,
  disponible: null,
  motivo_no_publicado: 'sin_mapeo',
  stock_publicado: null,
  publicado_en: null,
  pendiente_desde: null,
  ultimo_error: null,
  sugerencia: { coincidencias: 1, producto: COLAGENO },
}

const MAPEADA_2 = {
  tiendanube_variant_id: 222,
  tiendanube_product_id: 22,
  nombre_producto: 'Creatina monohidrato',
  nombre_variante: '300 g',
  sku: 'CRE-300',
  stock_en_tienda: 4,
  en_la_tienda: true,
  mapeo: { id: 12, product_id: 55, product_name: 'Creatina 300g', sku: 'CRE-300' },
  disponible: 4,
  motivo_no_publicado: null,
  stock_publicado: 4,
  publicado_en: '2026-08-12T09:31:04.000Z',
  pendiente_desde: null,
  ultimo_error: null,
  sugerencia: null,
}

const SIN_MAPEAR_3 = {
  ...SIN_MAPEAR_1,
  tiendanube_variant_id: 333,
  nombre_producto: 'Whey Protein',
  nombre_variante: '1 kg',
  sku: 'WHE-1000',
  stock_en_tienda: 12,
  // Dos productos del sistema con el mismo SKU: el servidor NO propone ninguno
  // y dice cuántos hay ([PENDIENTE N3]).
  sugerencia: { coincidencias: 2, producto: null },
}

const MAPEADA_4 = {
  ...MAPEADA_2,
  tiendanube_variant_id: 444,
  nombre_producto: 'Barritas proteicas',
  nombre_variante: 'Chocolate',
  sku: 'BAR-CHO',
  stock_en_tienda: 20,
  mapeo: { id: 13, product_id: 56, product_name: 'Barrita chocolate', sku: 'BAR-CHO' },
  disponible: 20,
}

const CUATRO = [SIN_MAPEAR_1, MAPEADA_2, SIN_MAPEAR_3, MAPEADA_4]
const TODAS_MAPEADAS = [MAPEADA_2, MAPEADA_4]

/**
 * Una corrida terminada con UNA falla: cuatro entraron y una no.
 *
 * ⚠ El reparto es el que hace verificable el criterio 11. Con cero fallas el
 * caso pasaría sobre una pantalla que nunca dibuja el detalle, y con TODAS
 * fallando pasaría sobre una que no sabe decir cuántas entraron: `4 actualizadas,
 * 1 con error` necesita las dos mitades vivas a la vez.
 */
const CORRIDA_CON_UNA_FALLA = {
  id: 91,
  empezada_en: '2026-08-12T09:31:00.000Z',
  terminada_en: '2026-08-12T09:31:47.000Z',
  disparador: 'manual',
  usuario_id: 'auth0|abc',
  mandadas: 4,
  fallidas: 1,
  fallas: [
    { variante: 998877, sku: 'COL-300', motivo: 'La variante ya no existe en tu tienda.' },
  ],
}

/** Corrió, terminó bien y no encontró nada que mandar. NO es «nunca corrió». */
const CORRIDA_QUE_MANDO_CERO = {
  ...CORRIDA_CON_UNA_FALLA,
  mandadas: 0,
  fallidas: 0,
  fallas: [],
}

const COLA_VACIA = { pendientes: 0, con_error: 0, mas_vieja: null }
const COLA_CON_PENDIENTES = { pendientes: 2, con_error: 1, mas_vieja: '2026-08-12T09:44:10.000Z' }

/** Un pedido que descontó tres ítems y dejó uno afuera por falta de mapeo. */
const PEDIDO_CON_UNO_SIN_MAPEAR = {
  id: 5,
  tiendanube_order_id: 3344556,
  numero: '1043',
  recibido_en: '2026-08-12T11:02:00.000Z',
  items_descontados: 3,
  items_sin_descontar: 1,
  items: [
    { variante: 111222, cantidad: 2, product_id: 41, descontado: true, motivo: null },
    { variante: 333444, cantidad: 1, product_id: null, descontado: false, motivo: 'sin_mapeo' },
  ],
}

/**
 * Un pedido donde los CUATRO motivos aparecen a la vez.
 *
 * ⚠ Los cuatro juntos y no uno por caso: con un solo motivo por fixture, una
 * pantalla que dibujara el código crudo de los otros tres pasaría igual. Y los
 * cuatro son casos reales del webhook —`sin_variante` es un ítem sin
 * `product_variant_id`, `cantidad_cero` es el `|| 1` que descontaba una unidad
 * que nadie pidió—.
 */
const PEDIDO_CON_LOS_CUATRO_MOTIVOS = {
  id: 6,
  tiendanube_order_id: 3344557,
  numero: '1044',
  recibido_en: '2026-08-12T12:10:00.000Z',
  items_descontados: 0,
  items_sin_descontar: 4,
  items: [
    { variante: 111, cantidad: 1, product_id: null, descontado: false, motivo: 'sin_mapeo' },
    { variante: 222, cantidad: 3, product_id: 41, descontado: false, motivo: 'sin_stock_en_sucursal' },
    { variante: null, cantidad: 1, product_id: null, descontado: false, motivo: 'sin_variante' },
    { variante: 444, cantidad: 0, product_id: 42, descontado: false, motivo: 'cantidad_cero' },
  ],
}

/** Los cuatro códigos de la base, tal cual los escribe el webhook. */
const CODIGOS_DE_MOTIVO = ['sin_mapeo', 'sin_stock_en_sucursal', 'sin_variante', 'cantidad_cero']

/** Todo lo que salió por la red, en orden. */
let pedidos = []

/**
 * Lo que devuelve el doble de `GET /tiendanube/variantes` para unos parámetros.
 *
 * ⚠ **Respeta `q` y `sin_mapear`.** El filtro lo resuelve el SERVIDOR, y un
 * doble que devolviera siempre el mismo arreglo haría que mandar el parámetro y
 * no mandarlo se dibujen igual: ahí es donde se pierde la posibilidad de que el
 * test se ponga en rojo.
 *
 * Los acentos no los simula: en el servidor los saca un `translate()` de SQL y
 * reescribir esa normalización acá sería probar el doble contra sí mismo.
 */
function paginaDeVariantes(variantes, params = {}) {
  const texto = String(params.q ?? '').trim().toLowerCase()

  const filtradas = variantes
    .filter((v) => (params.sin_mapear ? !v.mapeo : true))
    .filter((v) => (
      texto
        ? [v.nombre_producto, v.nombre_variante, v.sku]
          .some((campo) => String(campo ?? '').toLowerCase().includes(texto))
        : true
    ))

  return { ok: true, total: filtradas.length, refrescado_en: TIENDA.catalogo_refrescado_en, data: filtradas }
}

/**
 * Monta la pantalla con la API doblada.
 *
 * El render va envuelto en `act` porque la pantalla pide el estado y las
 * variantes en sendos `useEffect` al montar: sin eso React llena la salida de
 * «An update … was not wrapped in act(...)», y una suite que imprime ruido en
 * verde es una que nadie lee cuando se pone en rojo.
 */
async function montar({
  status = VINCULADA,
  statusFalla = null,
  variantes = CUATRO,
  // `null` es «nunca corrió ninguna», que es un caso del contrato y NO la
  // ausencia de un dato: `GET /corridas/ultima` lo devuelve así a propósito.
  corrida = null,
  cola = COLA_VACIA,
  pedidosDeLaTienda = [],
  permisos = ['config.ver', 'config.editar', 'products.ver'],
  ruta = '/tiendanube',
  sucursales = [MAYO, CENTRO],
} = {}) {
  useStore.setState({
    permisos,
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: sucursales },
  })

  vi.spyOn(api, 'get').mockImplementation((url, config) => {
    pedidos.push({ metodo: 'get', url, params: config?.params })

    if (url === '/tiendanube/status') {
      if (statusFalla) return Promise.reject(statusFalla)
      return Promise.resolve({ data: status })
    }

    if (url === '/tiendanube/variantes') {
      return Promise.resolve({ data: paginaDeVariantes(variantes, config?.params) })
    }

    if (url === '/tiendanube/corridas/ultima') {
      return Promise.resolve({ data: { ok: true, corrida, cola } })
    }

    if (url === '/tiendanube/pedidos') {
      return Promise.resolve({
        data: { ok: true, total: pedidosDeLaTienda.length, data: pedidosDeLaTienda },
      })
    }

    if (url === '/products') {
      return Promise.resolve({ data: { ok: true, data: [COLAGENO], total: 1 } })
    }

    return Promise.resolve({ data: { ok: true, data: [] } })
  })

  let utilidades
  await act(async () => {
    utilidades = render(
      <MemoryRouter initialEntries={[ruta]}>
        <Tiendanube />
      </MemoryRouter>
    )
  })
  await act(async () => {})

  return utilidades
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

/** El estado vacío que está dibujado, con su código y su texto. */
function vacio() {
  const nodo = document.querySelector('[data-estado-vacio]')

  return nodo ? { codigo: nodo.getAttribute('data-estado-vacio'), texto: nodo.textContent } : null
}

/** El texto de la confirmación de `useConfirmDialog`. */
const textoDeLaConfirmacion = () =>
  document.querySelector('[data-slot="dialog-description"]')?.textContent || ''

/** El panel lateral, mientras está abierto. */
const panel = () => document.querySelector('[data-slot="sheet-content"]')

/**
 * El bloque «Se va a mapear contra» del panel, entero.
 *
 * Se mira el bloque y no el nombre suelto porque el producto sugerido aparece
 * DOS veces en el panel —en la sugerencia y en lo elegido— y son dos cosas
 * distintas: la primera es una propuesta y la segunda es lo que se va a guardar.
 * Un `getByText` a secas no las distingue, y el caso que verifica que la
 * sugerencia NO se aplica sola necesita justamente esa distinción.
 */
const loElegido = () => within(panel()).getByText('Se va a mapear contra').parentElement.textContent

/**
 * El valor dibujado bajo una etiqueta del bloque de conexión.
 *
 * Las tres fechas del bloque pueden coincidir —una tienda refrescada el mismo
 * día que se comunicó—, así que buscar la fecha suelta encuentra varias. Lo que
 * importa es cuál está bajo cada etiqueta.
 */
const datoDe = (etiqueta) => screen.getByText(etiqueta).parentElement.textContent

/**
 * Un bloque de la pantalla, por su `data-bloque`.
 *
 * Se mira el bloque entero y no el texto suelto porque los dos que agrega la
 * fase 13 —la última corrida y los pedidos con problemas— comparten palabras con
 * el resto de la pantalla: «con error» está también en el badge de una fila y
 * «variantes» está en el encabezado de la tabla. Un `getByText` a secas
 * encontraría el de al lado y el caso pasaría sin haber mirado el bloque.
 */
const bloque = (nombre) => document.querySelector(`[data-bloque="${nombre}"]`)

/**
 * Un archivo sin sus comentarios, para las guardias estáticas de este archivo.
 *
 * Es el mismo corte que `utils/formato.test.js:297`: el comentario que explica
 * QUÉ se sacó de una pantalla nombra justamente lo que la guardia busca, y sin
 * esto la única forma de poner el test en verde sería borrar la explicación.
 */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !/^\s*(\/\/|\*)/.test(linea))
    .join('\n')
}

beforeEach(() => { pedidos = [] })
afterEach(() => { vi.restoreAllMocks() })

// ════════════════════════════════════════════
//  T1339 · el gateo en los tres lados
// ════════════════════════════════════════════

describe('El gateo de /tiendanube está en los tres lados (T1339)', () => {
  const APP = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
  const NAVEGACION = fs.readFileSync(path.join(SRC, 'components/navegacion.js'), 'utf8')

  it('el ítem del menú declara el mismo módulo que la ruta', () => {
    // El gate va en los tres lados o no sirve: barra lateral, `RouteGuard` y
    // API. Con módulos distintos el menú esconde el ítem y la URL escrita a mano
    // entra igual — que es exactamente lo que pasaba con `/proveedores`.
    const item = NAVEGACION
      .split('\n')
      .map((linea) => linea.trim())
      .find((texto) => texto.includes("to: '/tiendanube'"))

    expect(item, 'no hay ítem de menú para /tiendanube').toBeDefined()

    const modulo = (item.match(/modulo:\s*'([^']+)'/) || [])[1]
    const permiso = (item.match(/permission:\s*'([^']+)'/) || [])[1]

    expect(modulo).toBe('tiendanube')
    expect(permiso).toBe('config.ver')

    const ruta = APP
      .split('\n')
      .map((linea) => linea.trim())
      .find((texto) => /^<Route\s/.test(texto) && texto.includes('path="/tiendanube"'))

    expect(ruta, 'no hay <Route> para /tiendanube').toBeDefined()
    expect(ruta).toContain(`requiredModule="${modulo}"`)
    expect(ruta).toContain('<MarcoDePantalla>')

    // FR-069: la pantalla es para el cliente, no para el operador de la
    // plataforma. Un `soloSuperadmin` acá la escondería de todo el mundo.
    expect(ruta).not.toContain('soloSuperadmin')
  })
})

// ════════════════════════════════════════════
//  T1340 · el bloque de conexión
// ════════════════════════════════════════════

describe('El bloque de conexión (T1340)', () => {
  const dibujar = (props = {}) => render(
    <EstadoDeTiendanube status={VINCULADA} sucursales={[MAYO, CENTRO]} {...props} />
  )

  it('el bloque NO contiene el token de ninguna forma, ni truncado', () => {
    // US1 escenario 7 y FR-075. Mostrar «los últimos cuatro» de un secreto es
    // una costumbre de tarjetas de crédito —donde el número lo tiene el titular
    // en la mano— que acá no aporta nada y filtra.
    useStore.setState({ permisos: ['config.ver', 'config.editar'] })
    dibujar()

    const texto = document.body.textContent

    expect(texto).not.toContain(TIENDA.token)
    expect(texto).not.toContain(TIENDA.token.slice(-4))
    // Y la tienda SÍ se dibuja: sin esto el caso pasaría sobre un bloque vacío.
    expect(texto).toContain('Comprafit Suplementos')
  })

  it('sin config.editar, «Conectar» y «Desvincular» están DESHABILITADOS con su explicación en el documento, no ausentes', () => {
    // US1 escenario 11. Un botón ausente parece que la función no existe y manda
    // a buscarla a otro lado; uno deshabilitado con su explicación manda a pedir
    // el permiso, que es lo que hay que hacer.
    useStore.setState({ permisos: ['config.ver'] })

    dibujar()
    expect(screen.getByRole('button', { name: /Desvincular/ })).toBeDisabled()
    expect(screen.getByText(/config\.editar/)).toBeInTheDocument()

    cleanup()

    dibujar({ status: NO_VINCULADA })
    expect(screen.getByRole('button', { name: /Conectar con TiendaNube/ })).toBeDisabled()
    expect(screen.getByText(/config\.editar/)).toBeInTheDocument()
  })

  it('«Desvincular» abre confirmación y la confirmación dice que los mapeos no se borran', async () => {
    useStore.setState({ permisos: ['config.ver', 'config.editar'] })
    const onDesvincular = vi.fn()
    dibujar({ onDesvincular })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Desvincular/ }))
    })

    expect(textoDeLaConfirmacion()).toContain('NO se borran')
    expect(textoDeLaConfirmacion()).toContain('2 mapeos')
    // Y no se desvinculó nada todavía: la confirmación es para leerla.
    expect(onDesvincular).not.toHaveBeenCalled()
  })

  it('cambiar la sucursal dice cuántas variantes se vuelven a empujar antes de confirmar', async () => {
    // Riesgo 8 del plan: cambiar la sucursal encola TODAS las mapeadas, porque
    // el número que la tienda publica sale de esa sucursal y cambia entero. Sin
    // el aviso, alguien la cambia para probar y dispara N llamadas contra una
    // API con límite sin saberlo.
    useStore.setState({ permisos: ['config.ver', 'config.editar'] })
    const onCambiarSucursal = vi.fn()
    dibujar({ onCambiarSucursal })

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Sucursal de la tienda online'), {
        target: { value: String(CENTRO.id) },
      })
    })

    const texto = textoDeLaConfirmacion()

    expect(texto).toContain('2 variantes mapeadas')
    expect(texto).toContain('Depósito Mayo')
    expect(texto).toContain('Centro')
    expect(onCambiarSucursal).not.toHaveBeenCalled()
  })

  it('muestra cuándo fue la última reconciliación, y dice algo distinto si nunca corrió', () => {
    // Riesgo 4: el cron externo que la dispara hoy falla todos los días porque
    // faltan `API_URL` y `CRON_SECRET`. La ausencia de la red tiene que VERSE.
    useStore.setState({ permisos: ['config.ver', 'config.editar'] })

    dibujar()
    expect(datoDe('Última reconciliación')).toContain('12/08/2026')

    cleanup()

    dibujar({ status: { ...VINCULADA, tienda: { ...TIENDA, reconciliada_en: null } } })

    expect(datoDe('Última reconciliación')).toContain('Nunca corrió')
    expect(screen.getByText(/nada lo reintenta/)).toBeInTheDocument()
  })

  it('una tienda recién vinculada NO tiene nombre, y eso se dibuja sin mentir', () => {
    // El canje del OAuth devuelve el `user_id` y nada más: el nombre llega con
    // el primer refresco del catálogo. Un «—» ahí haría parecer que la
    // vinculación quedó a medias.
    useStore.setState({ permisos: ['config.ver', 'config.editar'] })

    dibujar({ status: { ...VINCULADA, tienda: { ...TIENDA, nombre: null, catalogo_refrescado_en: null } } })

    expect(screen.getByText('Todavía sin nombre')).toBeInTheDocument()
    expect(screen.getByText(/el nombre llega con el primer refresco del catálogo/)).toBeInTheDocument()
    expect(screen.getByText('Nunca se refrescó')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1341 · el panel de mapeo
// ════════════════════════════════════════════

describe('El panel de mapeo (T1341)', () => {
  const abrir = (variante, props = {}) => render(
    <PanelDeMapeo variante={variante} abierto onOpenChange={() => {}} {...props} />
  )

  beforeEach(() => {
    useStore.setState({ permisos: ['config.ver', 'config.editar', 'products.ver'] })
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ok: true, data: [COLAGENO] } })
  })

  it('la sugerencia aparece marcada como sugerencia y NO se aplica sola', async () => {
    // US3 escenario 6. Mapear solo por SKU es exactamente cómo se mapea el
    // producto equivocado sin que nadie lo mire.
    const enviar = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    abrir(SIN_MAPEAR_1)

    expect(screen.getByText(/Sugerencia por SKU · hay que confirmarla/)).toBeInTheDocument()
    expect(screen.getByText('Todavía no elegiste ningún producto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar mapeo/ })).toBeDisabled()
    expect(enviar).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Usar este producto/ }))
    })

    // Recién ahora hay algo elegido, y todavía no se guardó nada.
    expect(loElegido()).toContain('Colágeno 300g')
    expect(enviar).not.toHaveBeenCalled()
  })

  it('con dos productos del mismo SKU dice que hay dos y no elige', () => {
    abrir(SIN_MAPEAR_3)

    expect(screen.getByText(/Hay 2 productos con el SKU WHE-1000/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Usar este producto/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Confirmar mapeo/ })).toBeDisabled()
  })

  it('un 429 y un 502 muestran avisos DISTINTOS, no cierran el panel y no pierden lo escrito', async () => {
    // US6 escenarios 2 y 4, FR-062. Un problema de TiendaNube y uno de AdminApp
    // se arreglan en lados distintos, y quien ve siempre el mismo texto llama al
    // que no es. Y cerrar el panel se lleva el mensaje, el producto elegido y lo
    // escrito, dejando la sensación de que guardó.
    const cerrar = vi.fn()
    const avisos = []

    for (const status of [429, 502]) {
      vi.spyOn(api, 'post').mockRejectedValue({ response: { status } })

      abrir(SIN_MAPEAR_1, { onOpenChange: cerrar })

      const buscador = within(panel()).getByLabelText('Buscar el producto del sistema')
      fireEvent.change(buscador, { target: { value: 'col' } })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Usar este producto/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Confirmar mapeo/ }))
      })

      const alerta = within(panel()).getByRole('alert')
      avisos.push(alerta.textContent)

      // El panel sigue abierto, con lo escrito y lo elegido en su lugar.
      expect(cerrar).not.toHaveBeenCalledWith(false)
      expect(within(panel()).getByLabelText('Buscar el producto del sistema')).toHaveValue('col')
      expect(loElegido()).toContain('Colágeno 300g')

      cleanup()
      vi.restoreAllMocks()
      vi.spyOn(api, 'get').mockResolvedValue({ data: { ok: true, data: [COLAGENO] } })
    }

    expect(avisos[0]).not.toBe(avisos[1])
    expect(avisos[0]).toMatch(/demasiadas consultas/i)
    expect(avisos[1]).toMatch(/TiendaNube no está contestando/i)
  })

  it('el 409 de mapeo repetido llega como mensaje legible que nombra la otra variante', async () => {
    // US3 escenario 8. Hasta este hito el choque del índice único era un 500
    // genérico: «Error al crear el mapeo» sobre un producto que ya estaba
    // mapeado obliga a buscar contra qué a mano.
    const choque = 'Esa variante ya está mapeada a "Creatina 300g".'
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 409, data: { error: choque } } })

    abrir(SIN_MAPEAR_1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Usar este producto/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirmar mapeo/ }))
    })

    expect(within(panel()).getByRole('alert')).toHaveTextContent(choque)
  })
})

// ════════════════════════════════════════════
//  T1342 · la pantalla
// ════════════════════════════════════════════

describe('La tabla en grid de /tiendanube (T1342)', () => {
  it('el encabezado y las filas comparten el MISMO string de grid-template-columns', async () => {
    // Cuando difieren, las etiquetas dejan de estar sobre sus datos y se lee un
    // stock bajo «SKU». Es el defecto 2 del relevamiento del hito 5, que no
    // detectó ningún test hasta que se compararon los dos strings.
    await montar()

    const columnas = columnasDe(filaDe('Variante de la tienda'))

    expect(columnas).toBe('minmax(0,1.7fr) 116px 96px minmax(0,1.3fr) 100px 136px 56px')

    for (const variante of CUATRO) {
      expect(columnasDe(filaDe(variante.nombre_producto))).toBe(columnas)
    }
  })

  it('el badge «Sin mapear» está en la fila de la variante que corresponde', async () => {
    await montar()

    // La primera y la tercera, sin mapear; la segunda y la cuarta, mapeadas.
    for (const variante of [SIN_MAPEAR_1, SIN_MAPEAR_3]) {
      expect(within(filaDe(variante.nombre_producto)).getByText('Sin mapear')).toBeInTheDocument()
    }

    for (const variante of [MAPEADA_2, MAPEADA_4]) {
      const fila = filaDe(variante.nombre_producto)

      expect(within(fila).queryByText('Sin mapear')).toBeNull()
      expect(within(fila).getByText('Mapeada')).toBeInTheDocument()
      expect(within(fila).getByText(variante.mapeo.product_name)).toBeInTheDocument()
    }
  })

  it('sin config.editar la tabla se ve y no se puede cambiar, con la explicación a la vista', async () => {
    // US3 escenario 14. Ver los mapeos y no poder tocarlos son dos cosas
    // distintas: esconder la tabla dejaría a quien solo mira sin poder
    // comprobar contra qué está mapeado cada producto.
    await montar({ permisos: ['config.ver'] })

    expect(filaDe('Colágeno hidrolizado')).not.toBeNull()
    expect(screen.getByText(/modo lectura/)).toBeInTheDocument()

    expect(within(filaDe('Colágeno hidrolizado')).getByTitle('Mapear esta variante')).toBeDisabled()
    expect(within(filaDe('Creatina monohidrato')).getByTitle('Quitar mapeo')).toBeDisabled()
  })
})

describe('Los cuatro estados vacíos de /tiendanube (T1342)', () => {
  it('los cuatro estados vacíos dicen cosas distintas', async () => {
    // FR-055. Con el mismo texto, «tu tienda no tiene productos» y «el filtro no
    // devolvió nada» se leen igual, y la acción que sugiere cada uno es opuesta:
    // cargar productos en TiendaNube contra borrar el filtro.
    const vistos = []

    await montar({ status: NO_VINCULADA, variantes: [] })
    vistos.push(vacio())
    cleanup()
    vi.restoreAllMocks()

    await montar({
      status: { ...VINCULADA, variantes: { total: 0, mapeadas: 0, pendientes: 0, con_error: 0 } },
      variantes: [],
    })
    vistos.push(vacio())
    cleanup()
    vi.restoreAllMocks()

    await montar({
      status: { ...VINCULADA, variantes: { total: 4, mapeadas: 0, pendientes: 0, con_error: 0 } },
      variantes: CUATRO,
    })
    vistos.push(vacio())
    cleanup()
    vi.restoreAllMocks()

    // El cuarto: «solo sin mapear» con todo mapeado. Es el único que necesita
    // que el filtro salga por la red, y por eso el doble lo respeta.
    await montar({
      status: { ...VINCULADA, variantes: { total: 2, mapeadas: 2, pendientes: 0, con_error: 0 } },
      variantes: TODAS_MAPEADAS,
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'))
    })
    vistos.push(vacio())

    expect(vistos.map((v) => v?.codigo)).toEqual([
      'sin_tienda',
      'tienda_sin_productos',
      'sin_mapeos',
      'filtro_sin_resultados',
    ])

    const textos = vistos.map((v) => v?.texto)

    expect(new Set(textos).size).toBe(4)
    expect(textos.every((t) => t && t.length > 40)).toBe(true)
  })
})

describe('La pantalla no promete lo que el sistema no hace (T1342)', () => {
  it('la pantalla dice que un pedido baja inventario y NO registra una venta', async () => {
    // FR-073 y criterio 16. Sin este aviso, el dueño cierra la caja con una
    // diferencia que no puede explicar y el sistema no le da ninguna pista.
    await montar()

    expect(
      screen.getByText(/Un pedido de tu tienda baja el inventario y no registra una venta/)
    ).toBeInTheDocument()
    expect(screen.getByText(/ni en el flujo de caja, ni en los reportes/)).toBeInTheDocument()
  })

  it('la pantalla NO dice «bidireccional» sin aclarar qué va en cada sentido', async () => {
    // FR-074. La tarjeta que este hito saca de Ajustes dice «sincronización
    // bidireccional» (`Settings.jsx:395`) y no aclara nada: quien lo lee supone
    // que los pedidos aparecen en facturación.
    await montar()

    const texto = document.body.textContent

    expect(texto).not.toContain('bidireccional')
    expect(texto).toContain('El stock va de AdminApp a tu tienda')
    expect(texto).toContain('Los pedidos vienen de tu tienda a AdminApp')
  })

  it('dice de qué sucursal y qué número publica', async () => {
    // US7 escenario 3, decisiones 2 y 4. Publicar `quantity` en vez de
    // `available` deja que la tienda venda lo que ya está comprometido, y hasta
    // este hito la sucursal la decidía el orden de las filas.
    await montar()

    expect(screen.getByText(/Se publica el stock disponible/)).toBeInTheDocument()
    expect(screen.getByText(/de la sucursal «Depósito Mayo»/)).toBeInTheDocument()
    expect(screen.getByText(/no repone el stock/)).toBeInTheDocument()
  })
})

describe('El resultado del OAuth vuelve a /tiendanube (T1342)', () => {
  it('un motivo que la pantalla NO conoce igual dice qué pasó, y no deja el hueco', async () => {
    // El controlador tiene un séptimo motivo —`error_interno`— que no está en el
    // contrato de los seis, y cualquiera que se agregue mañana llega igual. Sin
    // texto por defecto, el usuario vuelve de TiendaNube, algo falló y la
    // pantalla no dice nada.
    await montar({ status: NO_VINCULADA, variantes: [], ruta: '/tiendanube?estado=error&motivo=marciano' })

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo vincular la tienda')
  })

  it('cada motivo del contrato dice algo distinto: un state vencido no es un fallo de TiendaNube', async () => {
    await montar({ status: NO_VINCULADA, variantes: [], ruta: '/tiendanube?estado=error&motivo=state_invalido' })
    const vencido = screen.getByRole('alert').textContent

    cleanup()
    vi.restoreAllMocks()

    await montar({ status: NO_VINCULADA, variantes: [], ruta: '/tiendanube?estado=error&motivo=tiendanube' })
    const delOtroLado = screen.getByRole('alert').textContent

    expect(vencido).toMatch(/de un solo uso/)
    expect(delOtroLado).toMatch(/No es un problema de AdminApp/)
    expect(vencido).not.toBe(delOtroLado)
  })
})

// ════════════════════════════════════════════
//  T1343 · sincronizar y el resultado de la última corrida
// ════════════════════════════════════════════

describe('Sincronizar el stock desde la pantalla (T1343)', () => {
  it('apretar «Sincronizar» dos veces manda UNA sola llamada', async () => {
    // US5 escenario 5. La segunda corrida choca contra el arriendo del servidor
    // y devuelve 409, así que el usuario ve un error por haber apretado dos veces
    // algo que estaba andando bien.
    await montar()

    // La llamada se deja EN EL AIRE a propósito: si se resolviera sola, el
    // segundo clic caería con el botón ya libre y el caso pasaría aunque no
    // hubiera ninguna bandera de ocupado.
    let terminar
    const enviar = vi.spyOn(api, 'post').mockImplementation(
      () => new Promise((resolver) => {
        terminar = () => resolver({ data: { ok: true, corrida_id: 91, mandadas: 2, fallidas: 0 } })
      })
    )

    const boton = screen.getByRole('button', { name: /Sincronizar stock/ })

    await act(async () => { fireEvent.click(boton) })
    // El segundo clic cae con la primera llamada todavía sin contestar, que es
    // justo cuando el usuario apurado vuelve a apretar.
    await act(async () => { fireEvent.click(boton) })

    // Primero la cuenta —el defecto es «salieron dos corridas»— y después el
    // mecanismo que lo evita. Al revés, el fallo diría «el botón no está
    // deshabilitado», que es una consecuencia y no el daño.
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(enviar).toHaveBeenCalledWith('/tiendanube/sincronizar')
    expect(boton).toBeDisabled()

    await act(async () => { terminar() })
  })

  it('sin config.editar el botón está deshabilitado con su explicación', async () => {
    // US5 escenario 10. Un botón ausente parece una función que no existe y manda
    // a buscarla a otro lado; uno deshabilitado que dice por qué manda a pedir el
    // permiso, que es lo que hay que hacer.
    const enviar = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })

    await montar({ permisos: ['config.ver'] })

    expect(screen.getByRole('button', { name: /Sincronizar stock/ })).toBeDisabled()
    expect(screen.getByText(/No podés sincronizar el stock/)).toBeInTheDocument()
    expect(enviar).not.toHaveBeenCalled()
  })

  it('sin ningún mapeo, apretar «Sincronizar» lo dice y no manda ninguna llamada', async () => {
    // US5 escenario 9. El servidor también lo rechaza —400 «No hay ningún
    // producto mapeado»— pero ir hasta allá para que te digan que no, cuando
    // `GET /status` ya contestó que hay cero mapeadas, hace que la respuesta
    // parezca un error del sistema.
    const enviar = vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } })
    const aviso = vi.spyOn(toast, 'error').mockImplementation(() => {})

    await montar({
      status: { ...VINCULADA, variantes: { total: 4, mapeadas: 0, pendientes: 0, con_error: 0 } },
      variantes: CUATRO,
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sincronizar stock/ }))
    })

    expect(enviar).not.toHaveBeenCalled()
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(aviso.mock.calls[0][0]).toMatch(/No hay ningún producto mapeado/)
  })
})

describe('El resultado de la última corrida (T1343)', () => {
  it('una corrida con una falla dice «N actualizadas, 1 con error» y la NOMBRA', async () => {
    // Criterio 11. «3 con error» sin decir cuáles obliga a abrir TiendaNube y
    // comparar el catálogo a mano, que es lo que esta pantalla vino a evitar.
    await montar({ corrida: CORRIDA_CON_UNA_FALLA, cola: COLA_VACIA })

    const texto = bloque('ultima-corrida').textContent

    expect(texto).toContain('4 variantes actualizadas, 1 con error')
    expect(texto).toContain('COL-300')
    expect(texto).toContain('La variante ya no existe en tu tienda')
    // Y lo que rodea al conteo: cuándo fue, cuánto tardó y quién la disparó.
    expect(texto).toContain('12/08/2026')
    expect(texto).toContain('47 s')
    expect(texto).toContain('A mano')
  })

  it('una corrida sin terminada_en dice que quedó a medias', async () => {
    // US5 escenario 6: el proceso se cayó, la red se cortó. Lo que hay que decir
    // no es cuántas entraron —el conteo quedó a medio escribir— sino que volver a
    // apretar el botón es seguro.
    await montar({
      corrida: { ...CORRIDA_CON_UNA_FALLA, terminada_en: null },
      cola: COLA_VACIA,
    })

    const texto = bloque('ultima-corrida').textContent

    expect(texto).toContain('quedó a medias')
    expect(texto).toContain('no una diferencia')
    expect(texto).not.toContain('Terminó sin errores')
  })

  it('«nunca se sincronizó» NO se dibuja igual que «corrió y no mandó nada»', async () => {
    // Son dos problemas distintos con dos arreglos distintos: la primera es una
    // tienda recién vinculada, la segunda una tienda sin ningún mapeo. Con el
    // mismo texto, quien mira no tiene con qué distinguirlas.
    await montar({ corrida: null, cola: COLA_VACIA })
    const nunca = bloque('ultima-corrida').textContent

    cleanup()
    vi.restoreAllMocks()

    await montar({ corrida: CORRIDA_QUE_MANDO_CERO, cola: COLA_VACIA })
    const mandoCero = bloque('ultima-corrida').textContent

    expect(nunca).toContain('Todavía no se sincronizó ninguna vez')
    expect(mandoCero).toContain('No se mandó ninguna variante')
    expect(nunca).not.toBe(mandoCero)
  })

  it('la cola dice cuántas están pendientes y hace cuánto', async () => {
    // El empujón por movimiento de stock no escribe corridas, así que su estado
    // vive en la fila de cada variante. La cola es lo único que contesta qué está
    // desfasado AHORA.
    await montar({ corrida: CORRIDA_CON_UNA_FALLA, cola: COLA_CON_PENDIENTES })

    const texto = bloque('ultima-corrida').textContent

    expect(texto).toContain('2 variantes esperando')
    expect(texto).toContain('12/08/2026')
    expect(texto).toContain('1 con error')
  })
})

// ════════════════════════════════════════════
//  T1344 · lo que un pedido NO descontó
// ════════════════════════════════════════════

describe('Los pedidos con ítems que no descontaron (T1344)', () => {
  it('un pedido con un ítem sin mapear se ve, con la variante y el motivo', async () => {
    // Criterio 5 del lado de la pantalla. Hasta este hito el ítem se salteaba con
    // un `continue` y lo único que quedaba era que el inventario estaba mal:
    // un faltante sin fecha, sin motivo y sin pedido.
    await montar({ pedidosDeLaTienda: [PEDIDO_CON_UNO_SIN_MAPEAR] })

    const texto = bloque('pedidos-con-problemas').textContent

    expect(texto).toContain('1043')
    expect(texto).toContain('12/08/2026')
    expect(texto).toContain('333444')
    expect(texto).toContain('La variante no está mapeada a ningún producto')

    // El que SÍ descontó no se lista: mezclarlo esconde al que importa.
    expect(texto).not.toContain('111222')
  })

  it('los cuatro motivos se leen en castellano y no como el código de la base', async () => {
    // Un `sin_stock_en_sucursal` en pantalla se lee como un error del sistema y
    // manda a abrir un ticket por algo que está funcionando.
    await montar({ pedidosDeLaTienda: [PEDIDO_CON_LOS_CUATRO_MOTIVOS] })

    const texto = bloque('pedidos-con-problemas').textContent

    expect(texto).toContain('La variante no está mapeada a ningún producto')
    expect(texto).toContain('El producto no tiene stock en la sucursal de la tienda')
    expect(texto).toContain('El ítem del pedido no traía variante')
    expect(texto).toContain('El ítem vino con cantidad cero')

    for (const codigo of CODIGOS_DE_MOTIVO) {
      expect(texto).not.toContain(codigo)
    }
  })

  it('sin pedidos con problemas el bloque dice eso y no queda vacío', async () => {
    // Un bloque sin nada adentro se lee como un error de carga. Que no haya
    // ninguno es una buena noticia y hay que poder distinguirla de «no cargó».
    await montar({ pedidosDeLaTienda: [] })

    const texto = bloque('pedidos-con-problemas').textContent

    expect(texto).toContain('Ningún pedido quedó con ítems sin descontar')
    expect(texto.length).toBeGreaterThan(80)
  })
})

// ════════════════════════════════════════════
//  T1345 · la tarjeta de /facturacion se va y queda un enlace
// ════════════════════════════════════════════

describe('El estado de TiendaNube vive en UN solo lugar (T1345)', () => {
  /**
   * Ajustes, con las dos llamadas que hace al montar dobladas.
   *
   * Va envuelta en `MemoryRouter` porque el enlace a `/tiendanube` es un `Link`,
   * y en `act` porque `fetchConfig` y `fetchCertInfo` salen a la red al montar.
   */
  async function montarAjustes() {
    vi.spyOn(api, 'get').mockImplementation((url) => {
      pedidos.push({ metodo: 'get', url })

      return Promise.resolve({ data: { ok: true, data: {} } })
    })

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/facturacion']}>
          <Settings />
        </MemoryRouter>
      )
    })
    await act(async () => {})
  }

  it('/facturacion ya no dice el estado de TiendaNube: solo enlaza', async () => {
    // US7 escenario 5. Dos lugares que muestran el estado de lo mismo se separan
    // y NADA avisa: la tarjeta de acá leía un booleano que `GET /status` ya no
    // devuelve, así que decía «no vinculada» con la tienda vinculada.
    await montarAjustes()

    const texto = document.body.textContent

    expect(texto).not.toContain('Cuenta de TiendaNube vinculada')
    // Las dos frases falsas de la tarjeta vieja.
    expect(texto).not.toContain('sincroniza automáticamente mediante webhooks')
    expect(texto).not.toContain('bidireccional')

    // Y el enlace SÍ está: sacar la tarjeta sin dejar por dónde llegar sería
    // esconder la integración en vez de mudarla.
    const enlace = screen.getByRole('link', { name: /TiendaNube/ })
    expect(enlace).toHaveAttribute('href', '/tiendanube')

    // El enlace contempla que `/tiendanube` puede devolverte al punto de venta
    // mientras el módulo no esté habilitado (paso manual P4): un enlace que te
    // expulsa sin decir nada se lee como un sistema roto.
    expect(screen.getByText(/todavía no está habilitada/)).toBeInTheDocument()
  })

  it('Settings.jsx ya no llama a /tiendanube/status', async () => {
    // La mitad estática, y es la que muerde: un `api.get('/tiendanube/status')`
    // que quede en un handler que nadie aprieta no lo ve ningún test de render.
    //
    // ⚠ Se mira el CÓDIGO sin sus comentarios, como hace `formato.test.js:297`.
    // El comentario que explica qué se sacó de esta pantalla nombra
    // `/tiendanube/status` a propósito —es la mitad más útil del cambio—, y una
    // guardia que se disparara con él obligaría a borrar la explicación para
    // callarla, que es lo último que se quiere.
    const CODIGO = sinComentarios(fs.readFileSync(path.join(SRC, 'pages/Settings.jsx'), 'utf8'))

    expect(CODIGO).not.toContain('/tiendanube/status')
    expect(CODIGO).not.toContain('/tiendanube/auth')
    expect(CODIGO).not.toContain('tiendanubeLinked')
    // El callback ahora vuelve a `/tiendanube?estado=…`: este parámetro no llega
    // nunca más y el bloque que lo leía estaba muerto desde la fase 3.
    expect(CODIGO).not.toContain("searchParams.get('tiendanube')")

    // Y el ancla: el archivo se leyó de verdad y el enlace nuevo está en él. Sin
    // esto, un `readFileSync` que devolviera '' haría pasar los cuatro
    // `not.toContain` de arriba sin haber mirado una línea.
    expect(CODIGO).toContain('to="/tiendanube"')

    // Y la mitad que evita que el caso pase por vacío: al montar sigue pidiendo
    // lo suyo, así que el archivo no quedó sin llamadas por otro motivo.
    await montarAjustes()

    const urls = pedidos.map((p) => p.url)

    expect(urls).toContain('/settings')
    expect(urls.some((u) => String(u).startsWith('/tiendanube'))).toBe(false)
  })
})
