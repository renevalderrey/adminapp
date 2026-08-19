import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, fireEvent, act } from '@testing-library/react'

/** `src/pages`, resuelto desde este archivo y no desde el cwd de vitest. */
const PAGINAS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages')

// ════════════════════════════════════════════
//  Lo que la pantalla de Inventario le pide al servidor
//
//  `services/api.js` es la capa donde una ruta mal escrita no falla en build ni
//  en ningún test: falla en producción, la primera vez que alguien abre la
//  pantalla. Estos tests ejercitan las funciones de verdad —con axios doblado— y
//  miran qué URL y qué parámetros terminan saliendo.
//
//  El caso que motiva el archivo es el `'principal'` que `importProducts` tenía
//  como valor por defecto. En una empresa sembrada por `seedPuntosDeVenta`,
//  cuyos códigos son general/ortiz/mayo, ese texto **no coincide con nada**: la
//  importación escribía filas en una sucursal inexistente que la pantalla no
//  muestra nunca. Es literalmente el caso con el que el plan explica cómo nace
//  «una pila anotada dos veces».
// ════════════════════════════════════════════

// `respuestas` es lo que permite montar una pantalla acá adentro y no solo
// llamar a las funciones sueltas: sin un cuerpo de respuesta, el listado llega
// vacío y una paginación de una sola página no dibuja ningún botón que apretar.
// Vacío se comporta igual que antes —`{ ok: true }`—, así que los casos que ya
// estaban no cambian.
const { llamadas, respuestas, interceptores } = vi.hoisted(() => ({
  llamadas: [],
  respuestas: new Map(),
  // Los interceptores que `services/api.js` registra al importarse. El doble los
  // guardaba en el vacío (`use: () => 1`), así que las dos cosas que el módulo
  // hace en TODOS los requests —mandar las cabeceras de contexto y decidir qué
  // pasa con un 401— no las miraba nada. Guardarlos no cambia el comportamiento
  // de ningún caso que ya estaba: ninguno los invocaba.
  interceptores: { request: [], response: [] },
}))

vi.mock('axios', () => {
  const registrar = (metodo) => (url, ...resto) => {
    llamadas.push({ metodo, url, resto })
    return Promise.resolve({ data: respuestas.get(url) || { ok: true } })
  }

  const instancia = {
    get: registrar('get'),
    post: registrar('post'),
    put: registrar('put'),
    delete: registrar('delete'),
    interceptors: {
      request: {
        use: (alPedir) => { interceptores.request.push(alPedir); return interceptores.request.length },
        eject: () => {},
      },
      response: {
        use: (alResponder, alFallar) => {
          interceptores.response.push({ alResponder, alFallar })
          return interceptores.response.length
        },
        eject: () => {},
      },
    },
  }

  return { default: { create: () => instancia } }
})

const {
  default: api,
  getSucursalesDeStock,
  getProductCostHistory,
  transferStock,
  getStockTransfers,
  importProducts,
  nuevoIdDeVenta,
  getSuppliers,
  getSupplierMovements,
  exportarCuenta,
  identificadorDeDispositivo,
  olvidarDispositivo,
  getSesionesDelEquipo,
  cerrarSesion,
  cerrarMisOtrasSesiones,
} = await import('../services/api.js')

const { default: useStore } = await import('../store/useStore.js')
const { default: Billing } = await import('../pages/Billing.jsx')
const { default: PurchaseOrders } = await import('../pages/PurchaseOrders.jsx')

beforeEach(() => { llamadas.length = 0; respuestas.clear() })

/** La última llamada registrada. */
const ultima = () => llamadas[llamadas.length - 1]

describe('getSucursalesDeStock', () => {
  it('pega a /stock/sucursales, que es el único que devuelve las inactivas', async () => {
    // Los otros dos endpoints que listan puntos de venta filtran por
    // `is_active`, y el de `/empresas/:id/puntos-de-venta` además pide el
    // permiso `sucursales.ver`, que esta pantalla no exige.
    await getSucursalesDeStock()

    expect(ultima()).toMatchObject({ metodo: 'get', url: '/stock/sucursales' })
  })
})

describe('getProductCostHistory', () => {
  it('acepta limit y offset', async () => {
    // Sin paginar, el panel de un producto con dos años de listas de proveedor
    // se trae cientos de filas para mostrar diez.
    await getProductCostHistory(88, { limit: 10, offset: 20 })

    expect(ultima().url).toBe('/products/88/cost-history')
    expect(ultima().resto[0]).toEqual({ params: { limit: 10, offset: 20 } })
  })

  it('sin parámetros sigue funcionando, y el servidor pone el default', async () => {
    await getProductCostHistory(88)

    expect(ultima().url).toBe('/products/88/cost-history')
    expect(ultima().resto[0]).toEqual({ params: undefined })
  })
})

describe('transferStock y getStockTransfers', () => {
  it('la transferencia manda los ids de sucursal y no solo los textos', async () => {
    await transferStock({
      from_punto_de_venta_id: 3,
      to_punto_de_venta_id: 7,
      items: [{ product_id: 88, quantity: 6 }],
    })

    expect(ultima().url).toBe('/stock/transfer')
    expect(ultima().resto[0]).toMatchObject({
      from_punto_de_venta_id: 3,
      to_punto_de_venta_id: 7,
    })
  })

  it('el historial pasa limit y offset tal cual', async () => {
    await getStockTransfers({ limit: 20, offset: 0 })

    expect(ultima().url).toBe('/stock/transfers')
    expect(ultima().resto[0]).toEqual({ params: { limit: 20, offset: 0 } })
  })
})

describe('getSuppliers después de que el listado pasó a paginar', () => {
  it('getSuppliers pide más de los 50 por defecto', async () => {
    // `GET /suppliers` pasa a paginar de a 50 (T1215). Las dos pantallas que la
    // usan dibujan la lista entera: la de Proveedores en la columna izquierda y
    // la de Órdenes de compra en el desplegable del filtro. Sin un límite
    // explícito, una empresa con 60 proveedores perdía 10 opciones del filtro
    // **y nada avisaba**.
    await getSuppliers({ limit: 200 })

    expect(ultima()).toMatchObject({ metodo: 'get', url: '/suppliers' })
    expect(ultima().resto[0]).toEqual({ params: { limit: 200 } })
  })

  it('las dos pantallas que la llaman le pasan un límite', async () => {
    // Guardia estática: la función acepta parámetros, pero lo que importa es que
    // los llamadores los manden. Si alguien agrega una tercera pantalla sin
    // límite, se queda con 50 proveedores y no lo va a notar nadie.
    const raiz = path.join(PAGINAS)

    for (const archivo of ['Orders.jsx', 'PurchaseOrders.jsx']) {
      const texto = fs.readFileSync(path.join(raiz, archivo), 'utf8')
      const llamadas = texto.match(/getSuppliers\(([^)]*)\)/g) || []

      expect(llamadas.length).toBeGreaterThan(0)
      for (const llamada of llamadas) {
        expect(llamada).toContain('limit')
      }
    }
  })

  it('getSupplierMovements pega al endpoint nuevo y no al viejo include', async () => {
    await getSupplierMovements(7, { limit: 200 })

    expect(ultima()).toMatchObject({ metodo: 'get', url: '/suppliers/7/movimientos' })
  })

  it('la exportación pide el rango que está mirando la pantalla', async () => {
    // T1247 y US8. La ruta cuelga de `/:id/…` y no de un literal: `GET /:id`
    // está declarado más arriba en `routes/suppliers.js` y se come cualquier
    // palabra suelta que venga después —un `/suppliers/export` iría a parar a
    // `GET /:id` con `id = 'export'`—. Escribirla mal no falla en build ni en
    // ningún test de render: falla en producción, la primera vez que alguien
    // aprieta el botón.
    await exportarCuenta(3, { desde: '2026-07-01', hasta: '2026-07-31' })

    expect(ultima()).toMatchObject({ metodo: 'get', url: '/suppliers/3/movimientos/export' })
    expect(ultima().resto[0]).toEqual({ params: { desde: '2026-07-01', hasta: '2026-07-31' } })
  })

  it('sin rango NO manda desde ni hasta vacíos', async () => {
    // Los dos extremos viajan por PRESENCIA, igual que el `q` del buscador y que
    // el `supplier_id` del listado de órdenes: `desde=` vacío es un filtro de
    // fecha que el servidor tiene que validar para descartar, y ese es
    // exactamente el camino que produjo el `?supplier_id=%20` contra una columna
    // INTEGER. La ausencia se construye del lado del cliente.
    await exportarCuenta(3)
    expect(ultima().resto[0]).toEqual({ params: {} })

    await exportarCuenta(3, { desde: '', hasta: '' })
    expect(ultima().resto[0]).toEqual({ params: {} })

    // Y un solo extremo viaja solo: exportar «desde marzo» sin cerrar el rango
    // es un caso real.
    await exportarCuenta(3, { desde: '2026-03-01' })
    expect(ultima().resto[0]).toEqual({ params: { desde: '2026-03-01' } })
  })

  it('la pantalla vieja NO suma movimientos que ya no vienen', async () => {
    // El puente de T1219: `GET /suppliers` dejó de devolver `movements`, así que
    // `calculateBalance` sumaría siempre cero. Un saldo de $0 para todos los
    // proveedores no falla, no avisa, y se ve exactamente igual que una empresa
    // que no le debe nada a nadie.
    const texto = fs.readFileSync(path.join(PAGINAS, 'Orders.jsx'), 'utf8')

    expect(texto).not.toContain('calculateBalance')
    expect(texto).not.toContain('movements.reduce')
  })
})

// ════════════════════════════════════════════
//  La orden 101 (T1235)
//
//  `PurchaseOrders.jsx` pedía `limit: 100` fijo y NUNCA un `offset`: con 312
//  órdenes cargadas, el contador de arriba decía 312 y no había forma de llegar
//  a la 101 — ni scrolleando, ni filtrando, ni cambiando nada. No fallaba nada:
//  la lista mostraba cien filas y se veía completa.
//
//  Va acá y no en el test de render porque lo que se afirma es LA URL: que el
//  botón «2» de la paginación termine convertido en `offset=50` sobre
//  `/suppliers/orders`, que es la capa donde un parámetro que no se manda no lo
//  detecta ningún otro test.
// ════════════════════════════════════════════

describe('La paginación de /ordenes-compra pide la página que se apretó', () => {
  const ORDEN = {
    id: 118,
    supplier_id: 3,
    supplier_name: 'Distribuidora Norte',
    date: '2026-07-31',
    status: 'pending',
    total: '15000',
    items: [{ product_id: 1, product_name: 'Colágeno 300g', quantity: 12, quantity_received: 0, unit_price: '1000' }],
  }

  /**
   * Las llamadas al LISTADO, en orden.
   *
   * Se filtra por `limit !== 1` porque la pantalla pide dos cosas distintas al
   * mismo endpoint: el listado (`limit: 50`) y los cuatro contadores del
   * segmentado (`limit: 1`, uno por segmento, que solo miran el `total`).
   *
   * Los contadores salen del servidor desde que se corrigio el defecto que los
   * hacia contar la PAGINA cargada: un periodo con 40 recibidas repartidas en
   * tres paginas mostraba «Recibidas 3». Mezclarlos aca haria que este caso
   * cuente cinco llamadas donde lo que se afirma es una.
   */
  const listado = () => llamadas.filter(
    (l) => l.url === '/suppliers/orders' && l.resto[0]?.params?.limit !== 1
  )

  /** Las cuatro consultas de conteo, que son las otras. */
  const contadores = () => llamadas.filter(
    (l) => l.url === '/suppliers/orders' && l.resto[0]?.params?.limit === 1
  )

  afterEach(() => { vi.restoreAllMocks() })

  it('la página 2 pide offset y no vuelve a pedir la 1', async () => {
    // 120 órdenes son tres páginas de 50. Sin `total`, la paginación no se
    // dibuja y el caso pasaría por no haber nada que apretar.
    respuestas.set('/suppliers/orders', { ok: true, data: [ORDEN], total: 120 })

    await act(async () => { render(React.createElement(PurchaseOrders)) })

    expect(listado()).toHaveLength(1)
    expect(listado()[0].resto[0]).toEqual({ params: { limit: 50, offset: 0 } })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '2' })) })

    // La segunda llamada es la de la página 2, y es UNA: si `offset` no viajara,
    // apretar «2» volvería a pedir las mismas cincuenta de siempre.
    expect(listado()).toHaveLength(2)
    expect(listado()[1].resto[0]).toEqual({ params: { limit: 50, offset: 50 } })
  })

  it('cambiar de página NO vuelve a pedir los cuatro contadores', async () => {
    // Los contadores dependen del período y del segmento, no de la página: la
    // cantidad de órdenes pendientes es la misma se esté mirando la página 1 o
    // la 3. Si se recalcularan en cada clic, moverse por una lista de seis
    // páginas costaría treinta consultas en vez de seis, todas para escribir
    // los mismos cuatro números.
    respuestas.set('/suppliers/orders', { ok: true, data: [ORDEN], total: 120 })

    await act(async () => { render(React.createElement(PurchaseOrders)) })

    const alMontar = contadores().length
    expect(alMontar).toBeGreaterThan(0)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '2' })) })

    expect(contadores()).toHaveLength(alMontar)
  })
})

describe('importProducts ya no inventa la sucursal', () => {
  const archivo = new Blob(['nombre,costo\n'], { type: 'text/csv' })

  it('NO manda "principal" cuando no se le pasa sucursal', async () => {
    // Ese string era la mitad de un defecto real: no coincide con ningún código
    // de una empresa sembrada, y la importación terminaba escribiendo en una
    // sucursal que no existe. Vacío significa «usá el punto de venta por
    // defecto de la empresa», que lo resuelve el servidor.
    await importProducts(archivo)

    expect(ultima().resto[0].get('defaultLocation')).toBe('')
  })

  it('manda el code que se le pasa', async () => {
    await importProducts(archivo, {}, 'deposito')

    expect(ultima().resto[0].get('defaultLocation')).toBe('deposito')
  })

  it('un valor nulo o vacío se manda vacío y no como "null"', async () => {
    // `formData.append` convierte cualquier cosa a texto: sin el `|| ''`, un
    // `null` viaja como el string "null" y el servidor rechaza la importación
    // entera con 400 diciendo que esa sucursal no existe.
    await importProducts(archivo, {}, null)

    expect(ultima().resto[0].get('defaultLocation')).toBe('')
  })

  it('sigue mandando el archivo y el mapping solo si lo hay', async () => {
    await importProducts(archivo)
    expect(ultima().resto[0].has('mapping')).toBe(false)

    await importProducts(archivo, { costo: 'cost' })
    expect(JSON.parse(ultima().resto[0].get('mapping'))).toEqual({ costo: 'cost' })
  })
})

// ════════════════════════════════════════════
//  El identificador de la venta (T1101)
//
//  `Sale.id` lo genera el navegador y es la clave primaria. Hasta acá era
//  `sale_${Date.now()}`, y eso tiene dos agujeros que se tapan juntos:
//
//   · Sin azar, dos cajas que cobran en el mismo milisegundo producen el MISMO
//     id. Hoy eso choca contra la clave primaria y se ve; con `POST /api/sales`
//     idempotente pasaría a ser una venta que desaparece en silencio.
//   · Generado adentro del handler, un reintento del mismo ticket lleva un id
//     nuevo y registra una SEGUNDA venta con su segundo descuento de stock.
//
//  Por eso los tres casos de acá abajo van juntos: los dos primeros miran el
//  formato y el tercero mira que el id sea del ticket y no del disparo.
// ════════════════════════════════════════════

describe('nuevoIdDeVenta · el id de la venta tiene que ser único', () => {
  it('NO genera dos veces el mismo id en el mismo milisegundo', () => {
    // Con el reloj congelado, `sale_${Date.now()}` devuelve mil veces el mismo
    // texto. Es exactamente el caso de las dos cajas cobrando a la vez.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-04T15:04:05.000Z'))

      const ids = Array.from({ length: 1000 }, () => nuevoIdDeVenta())

      expect(new Set(ids).size).toBe(1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('el id entra en los 40 caracteres de Sale.id', () => {
    // La columna es STRING(40). `crypto.randomUUID()` a secas son 36 y con el
    // prefijo `sale_` no entra: por eso son los 8 primeros hexadecimales.
    const id = nuevoIdDeVenta()

    expect(id.length).toBeLessThanOrEqual(40)
    expect(id).toMatch(/^sale_\d+_[0-9a-f]{8}$/)
  })

  it('la marca de tiempo va adelante: dos ids seguidos ordenan cronológicamente', () => {
    // Ordenan como texto, así que con el azar adelante un
    // `SELECT * FROM sales ORDER BY id` crudo saldría desordenado — que es lo
    // único que hay a mano en un incidente.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-04T15:04:05.000Z'))
      const viejo = nuevoIdDeVenta()

      vi.setSystemTime(new Date('2026-08-04T15:04:06.000Z'))
      const nuevo = nuevoIdDeVenta()

      expect([nuevo, viejo].sort()).toEqual([viejo, nuevo])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('el id es del ticket, no del disparo del cobro', () => {
  const LINEA = {
    id: 1,
    name: 'Colágeno 300g',
    price: 100,
    qty: 1,
    method: 'ef',
    base_cash: 100,
    base_card: 120,
    base_alliance: 90,
  }

  afterEach(() => { vi.restoreAllMocks() })

  it('el id de un ticket NO cambia entre el primer cobro y el reintento', async () => {
    // El escenario 4.14 de la spec: la venta se guardó, la respuesta se perdió,
    // el operador vuelve a apretar. Con el id generado adentro del handler eso
    // registra una segunda venta y descuenta el stock dos veces; con el id del
    // ticket, el servidor reconoce el reintento.
    useStore.setState({
      products: [],
      brands: [],
      cart: [LINEA],
      usuario: null,
      empresaActiva: null,
      puntoDeVentaActivo: null,
      settings: {
        ...useStore.getState().settings,
        tax_condition: 'Monotributo',
        afip_cuit: '20304050607',
        afip_pv: '3',
      },
      // La pantalla lo llama al montar: doblado, para que el test no dependa de
      // tres requests que no está mirando.
      initialize: vi.fn(),
      // El botón de cobrar consulta el permiso desde T1127: sin esto queda
      // deshabilitado y el test fallaría por el motivo equivocado.
      permisos: ['ventas.crear'],
    })

    let primerIntento = true

    const post = vi.spyOn(api, 'post').mockImplementation((url) => {
      if (url === '/sales') {
        if (primerIntento) {
          primerIntento = false
          return Promise.reject(new Error('Network Error'))
        }
        return Promise.resolve({
          data: { ok: true, data: { id: 'sale_x', total: '100.00', date: '2026-08-04' }, warnings: [] },
        })
      }

      return Promise.resolve({
        data: { ok: true, data: { cae: '75000000001', expiration: '20260814', voucherNumber: 7, type: 11 } },
      })
    })

    render(React.createElement(Billing))

    // El botón del pie ABRE el panel de emisión: pedir un CAE consume un número
    // correlativo de ARCA, y eso no sale de un clic a ciegas. Los dos intentos
    // que este test mira salen del botón del panel, que es el que emite.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Cobrar y emitir/i }))
    })

    const emitir = screen.getByRole('button', { name: /Emitir Factura C/i })

    await act(async () => { fireEvent.click(emitir) })
    await act(async () => { fireEvent.click(emitir) })

    const cuerpos = post.mock.calls
      .filter(([url]) => url === '/sales')
      .map(([, cuerpo]) => cuerpo)

    expect(cuerpos).toHaveLength(2)
    expect(cuerpos[0].id).toMatch(/^sale_\d+_[0-9a-f]{8}$/)
    expect(cuerpos[1].id).toBe(cuerpos[0].id)
  })
})

// ════════════════════════════════════════════
//  El identificador de dispositivo (`X-Sesion-Id`)
//
//  Es la cabecera de la que depende la funcionalidad entera de sesiones: sin
//  ella la API responde 401 `SESION_REQUERIDA`, y con una distinta en cada
//  request la pantalla de Equipo mostraría una fila por request.
//
//  Se ejercitan los **interceptores de verdad**, los que `services/api.js`
//  registró al importarse. Un test que llamara a `identificadorDeDispositivo()`
//  a mano diría que la función anda, no que la cabecera salga.
// ════════════════════════════════════════════

describe('todos los requests llevan X-Sesion-Id, y es el mismo entre dos llamadas', () => {
  /** El interceptor de request que `services/api.js` registró sin token. */
  const alPedir = () => interceptores.request[interceptores.request.length - 1]

  it('la cabecera sale, y es la misma en dos requests seguidos', () => {
    const uno = alPedir()({ headers: {} })
    const dos = alPedir()({ headers: {} })

    expect(uno.headers['X-Sesion-Id']).toBeTruthy()
    expect(dos.headers['X-Sesion-Id']).toBe(uno.headers['X-Sesion-Id'])
  })

  it('es un UUID y no un contador ni el token', () => {
    // Un identificador adivinable dejaría que alguien cierre la sesión de otro
    // sin conocerla. No es la garantía principal —el servidor valida la
    // membresía— pero un `1`, un `2` y un `3` en `localStorage` es una invitación.
    const { headers } = alPedir()({ headers: {} })

    expect(headers['X-Sesion-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('sobrevive a un reinicio del módulo: sale de localStorage', () => {
    // Sin esto, cada recarga de la página abriría una sesión nueva y la lista
    // mostraría una fila por pestaña abierta desde que la persona entró.
    const primero = alPedir()({ headers: {} }).headers['X-Sesion-Id']

    expect(localStorage.getItem('favalio.dispositivo')).toBe(primero)
  })

  it('la manda SIEMPRE, incluso sin empresa elegida', () => {
    // `X-Empresa-Id` y `X-Punto-De-Venta-Id` van con `if` porque hay pantallas
    // que se dibujan antes de que haya empresa. Ésta no puede: los primeros
    // requests del arranque son justamente los que traen el contexto, y sin la
    // cabecera la API los corta con 401.
    const { headers } = alPedir()({ headers: {} })

    expect(headers['X-Empresa-Id']).toBeUndefined()
    expect(headers['X-Sesion-Id']).toBeTruthy()
  })
})

describe('un 401 SESION_CERRADA borra el identificador; un 401 cualquiera NO', () => {
  /** El manejador de errores del interceptor de respuesta. */
  const alFallar = () => interceptores.response[0].alFallar

  const fallo = (status, data) => {
    const error = { config: {}, response: { status, data } }
    return alFallar()(error).catch(() => {})
  }

  beforeEach(() => {
    localStorage.clear()
    olvidarDispositivo()
  })

  it('con SESION_CERRADA, el próximo ingreso es una sesión nueva', async () => {
    const antes = identificadorDeDispositivo()

    await fallo(401, { error: 'SESION_CERRADA' })

    // Si volviera con el mismo identificador chocaría contra la fila cerrada y
    // nadie podría volver a entrar desde esta computadora nunca más.
    expect(localStorage.getItem('favalio.dispositivo')).toBeNull()
    expect(identificadorDeDispositivo()).not.toBe(antes)
  })

  it('con un 401 cualquiera —un token vencido— el identificador NO se toca', async () => {
    // Ésta es la mitad que importa. Borrarlo en todo 401 abriría una sesión
    // nueva por cada expiración de token, y la lista mostraría siete filas del
    // mismo navegador: exactamente el defecto por el que la sesión NO se
    // identifica con el hash del access token.
    const antes = identificadorDeDispositivo()

    await fallo(401, { error: 'Token inválido o expirado' })

    expect(localStorage.getItem('favalio.dispositivo')).toBe(antes)
    expect(identificadorDeDispositivo()).toBe(antes)
  })

  it('un 403 tampoco lo toca', async () => {
    const antes = identificadorDeDispositivo()

    await fallo(403, { error: 'FORBIDDEN' })

    expect(identificadorDeDispositivo()).toBe(antes)
  })
})

describe('los tres helpers de sesiones pegan a las rutas del contrato', () => {
  it('getSesionesDelEquipo cuelga de la empresa; cerrar, no', async () => {
    // La asimetría es del contrato y no un descuido: la lista es de una empresa
    // —salen los miembros de ESA empresa— y una sesión no es de ninguna. El
    // servidor resuelve si es tuya mirando la membresía.
    await getSesionesDelEquipo(7)
    expect(ultima()).toMatchObject({ metodo: 'get', url: '/empresas/7/sesiones' })

    await cerrarSesion(42)
    expect(ultima()).toMatchObject({ metodo: 'delete', url: '/empresas/sesiones/42' })

    await cerrarMisOtrasSesiones()
    expect(ultima()).toMatchObject({ metodo: 'delete', url: '/empresas/sesiones' })
  })
})
