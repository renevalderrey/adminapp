import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TODAS_LAS_SUCURSALES, TODAS_LAS_CATEGORIAS,
  filtrarInventario, calcularIndicadores, hayStockBajo, tonoDeStock,
  sucursalesComparables, cuerposDeStockAlCrear, unidadesComprometidas,
} from './inventario'

// ════════════════════════════════════════════
//  Las cinco reglas de Inventario que pasaron los 274 tests estando mal
//
//  `sdd-verify` encontró seis incumplimientos de `docs/specs/010-inventario`.
//  Cuatro de ellos vivían adentro de `pages/Inventory.jsx` y
//  `components/PanelProducto.jsx`, donde no hay forma de llamarlos: `apps/web`
//  no tiene entorno de tests de render. Por eso no había ningún test rojo, y
//  por eso las reglas se movieron a `utils/inventario.js`.
//
//  Cada `describe` de acá abajo nombra el defecto que evita, y cada test está
//  escrito para **fallar si se revierte la corrección**. Los dos últimos
//  bloques son guardias de texto sobre los componentes: cubren la mitad que una
//  función pura no puede cubrir —que la pantalla efectivamente use la regla
//  compartida en vez de volver a escribirla adentro—.
//
//  ── Lo que sigue sin cobertura ──
//
//  El DIBUJO. Que el badge esté en la celda de la sucursal que corresponde, que
//  el indicador se vuelva a pintar al cambiar de sucursal, que el aviso de
//  unidades comprometidas aparezca debajo del renglón correcto. Eso necesita
//  montar jsdom y testing-library, que es el proyecto 5d de
//  `docs/PROXIMOS-PROYECTOS.md` y no entra acá.
// ════════════════════════════════════════════

/** El umbral que devuelve `GET /api/settings` como `umbral_stock_bajo`. */
const UMBRAL = 3

/** Un producto con las filas de stock que se le pasen. */
const producto = (id, nombre, cost, stock = [], extra = {}) =>
  ({ id, name: nombre, cost, stock, ...extra })

/** Una fila de `product.stock`. */
const fila = (puntoDeVentaId, quantity, min_stock = 0, available = quantity) =>
  ({ punto_de_venta_id: puntoDeVentaId, quantity, min_stock, available })

// ════════════════════════════════════════════
//  Hallazgo 1 · El badge de stock quedaba con la regla vieja de /api/alerts
// ════════════════════════════════════════════

describe('tonoDeStock · el color del badge sale de la MISMA regla que todo lo demás', () => {
  it('pinta warn un producto con 2 unidades y SIN mínimo cargado (umbral 3)', () => {
    // Es el caso exacto que quedaba neutro. La regla vieja era
    // `minimo > 0 && cantidad <= minimo`, que es literalmente la de
    // `GET /api/alerts`: sin mínimo cargado el producto no se pintaba nunca.
    // El indicador lo contaba, el filtro lo mostraba y la hoja impresa lo
    // marcaba, así que el usuario filtraba por «Stock bajo» y veía una tabla
    // de badges neutros (FR-016).
    expect(tonoDeStock({ quantity: 2, min_stock: 0 }, UMBRAL))
      .toBe('border-warn-line bg-warn-soft text-warn')
  })

  it('pinta warn en el mínimo exacto cuando el mínimo SÍ está cargado', () => {
    expect(tonoDeStock({ quantity: 5, min_stock: 5 }, UMBRAL))
      .toBe('border-warn-line bg-warn-soft text-warn')
  })

  it('una unidad por encima del límite queda neutro', () => {
    expect(tonoDeStock({ quantity: 4, min_stock: 0 }, UMBRAL))
      .toBe('border-border bg-surface-3 text-fg-2')
    expect(tonoDeStock({ quantity: 6, min_stock: 5 }, UMBRAL))
      .toBe('border-border bg-surface-3 text-fg-2')
  })

  it('cero y negativo son danger, y ganan sobre warn', () => {
    expect(tonoDeStock({ quantity: 0, min_stock: 10 }, UMBRAL))
      .toBe('border-danger-line bg-danger-soft text-danger')
    expect(tonoDeStock({ quantity: -3, min_stock: 0 }, UMBRAL))
      .toBe('border-danger-line bg-danger-soft text-danger')
  })

  it('una sucursal sin fila de stock es danger, no neutro', () => {
    // La celda muestra `0` (FR-067) y el color tiene que decir lo mismo que el
    // número.
    expect(tonoDeStock(undefined, UMBRAL))
      .toBe('border-danger-line bg-danger-soft text-danger')
  })

  it('el badge NUNCA queda neutro sobre algo que el filtro cuenta como stock bajo', () => {
    // La verificación de FR-016 propiamente dicha: el color y el conteo tienen
    // que contestar lo mismo para toda combinación, no solo para el caso que
    // se reportó.
    const casos = [
      { quantity: 0, min_stock: 0 },
      { quantity: 1, min_stock: 0 },
      { quantity: 2, min_stock: 0 },
      { quantity: 3, min_stock: 0 },
      { quantity: 4, min_stock: 0 },
      { quantity: 5, min_stock: 5 },
      { quantity: 6, min_stock: 5 },
      { quantity: 20, min_stock: 0 },
      { quantity: -1, min_stock: 12 },
    ]

    for (const f of casos) {
      const bajo = hayStockBajo({ stock: [{ ...f, punto_de_venta_id: 1 }] }, TODAS_LAS_SUCURSALES, UMBRAL)
      const neutro = tonoDeStock(f, UMBRAL) === 'border-border bg-surface-3 text-fg-2'

      expect({ ...f, bajo, neutro }).toEqual({ ...f, bajo, neutro: !bajo })
    }
  })
})

// ════════════════════════════════════════════
//  Hallazgo 2 · Elegir una sucursal no acotaba el listado (FR-064)
// ════════════════════════════════════════════

describe('filtrarInventario · el selector de sucursal acota el listado', () => {
  // Tres productos: uno en las dos sucursales, uno solo en la 1, uno sin
  // ninguna fila. Es el caso que la spec describe en chico: la sucursal 2
  // maneja un producto y el catálogo tiene tres.
  const CATALOGO = [
    producto(1, 'Colágeno 300g', 1200, [fila(1, 10), fila(2, 2)]),
    producto(2, 'Whey 1kg', 9000, [fila(1, 40)]),
    producto(3, 'Creatina 300g', 5000, []),
  ]

  const filtrar = (sucursalElegida) => filtrarInventario(CATALOGO, {
    sucursalElegida,
    umbral: UMBRAL,
  }).map((p) => p.id)

  it('con una sucursal elegida deja SOLO los productos que esa sucursal maneja', () => {
    // Sin este predicado, la pantalla decía «Productos activos: 500» para una
    // sucursal que maneja 3 y listaba los 500.
    expect(filtrar('2')).toEqual([1])
  })

  it('con «Todas» sigue mostrando el catálogo entero', () => {
    expect(filtrar(TODAS_LAS_SUCURSALES)).toEqual([1, 2, 3])
  })

  it('el id de la sucursal se compara como texto: el del <select> es string', () => {
    // `punto_de_venta_id` llega como número y el valor del botón como string.
    expect(filtrar(2)).toEqual([1])
  })

  it('un producto con la fila EN CERO en esa sucursal SÍ se lista', () => {
    // Tener la fila en cero es «esta sucursal maneja el producto y hoy no lo
    // tiene», que es justo el que hay que reponer. Confundirlo con «no lo
    // maneja» lo saca de la pantalla con la que se arma el pedido.
    const catalogo = [producto(9, 'Barrita', 500, [fila(7, 0)])]

    expect(filtrarInventario(catalogo, { sucursalElegida: '7', umbral: UMBRAL }).map((p) => p.id))
      .toEqual([9])
  })

  it('se combina con la categoría, con el texto y con «Stock bajo»', () => {
    const catalogo = [
      producto(1, 'Colágeno 300g', 1200, [fila(1, 10), fila(2, 2)], { category: 'colageno' }),
      producto(2, 'Colágeno 500g', 1800, [fila(2, 50)], { category: 'colageno' }),
      producto(3, 'Whey 1kg', 9000, [fila(2, 1)], { category: 'proteina' }),
    ]

    expect(filtrarInventario(catalogo, {
      sucursalElegida: '2',
      categoria: 'colageno',
      soloStockBajo: true,
      umbral: UMBRAL,
    }).map((p) => p.id)).toEqual([1])

    expect(filtrarInventario(catalogo, {
      sucursalElegida: '2',
      texto: 'colageno',
      categoria: TODAS_LAS_CATEGORIAS,
      umbral: UMBRAL,
    }).map((p) => p.id)).toEqual([1, 2])
  })

  it('«Stock bajo» en una sucursal mira la fila de ESA sucursal, no la suma', () => {
    // 40 en la 1 y 2 en la 2: lo que sobra en una no resuelve lo que falta en
    // la otra hasta que alguien lo transfiera.
    const catalogo = [producto(1, 'Whey 1kg', 9000, [fila(1, 40), fila(2, 2)])]

    expect(filtrarInventario(catalogo, { sucursalElegida: '2', soloStockBajo: true, umbral: UMBRAL }))
      .toHaveLength(1)
    expect(filtrarInventario(catalogo, { sucursalElegida: '1', soloStockBajo: true, umbral: UMBRAL }))
      .toHaveLength(0)
  })
})

describe('calcularIndicadores · los cuatro números hablan de la sucursal elegida', () => {
  const CATALOGO = [
    producto(1, 'Colágeno 300g', 1000, [fila(1, 10), fila(2, 2)]),
    producto(2, 'Whey 1kg', 9000, [fila(1, 40)]),
    producto(3, 'Creatina 300g', 5000, []),
  ]

  const indicadoresDe = (sucursalElegida) => calcularIndicadores(
    filtrarInventario(CATALOGO, { sucursalElegida, umbral: UMBRAL }),
    { sucursalElegida, umbral: UMBRAL }
  )

  it('«Productos activos» cuenta lo de la sucursal y no el catálogo entero', () => {
    // El defecto se veía así: «Productos activos: 500 · Sin stock: 497» para
    // una sucursal que maneja 3.
    expect(indicadoresDe('2').productos).toBe(1)
    expect(indicadoresDe(TODAS_LAS_SUCURSALES).productos).toBe(3)
  })

  it('«Sin stock» no cuenta los productos que la sucursal ni siquiera maneja', () => {
    // Con la sucursal 2: un solo producto y tiene 2 unidades, así que no hay
    // ninguno sin stock. Sin el predicado daban 2 (Whey y Creatina, que no
    // tienen nada ahí porque no se manejan ahí).
    expect(indicadoresDe('2').sin).toBe(0)
    expect(indicadoresDe(TODAS_LAS_SUCURSALES).sin).toBe(1)
  })

  it('«Valor del stock» valoriza solo lo que hay en esa sucursal', () => {
    expect(indicadoresDe('2').valor).toBe(2 * 1000)
    expect(indicadoresDe('1').valor).toBe(10 * 1000 + 40 * 9000)
    expect(indicadoresDe(TODAS_LAS_SUCURSALES).valor).toBe(12 * 1000 + 40 * 9000)
  })

  it('«Stock bajo» cuenta con la fila de esa sucursal', () => {
    expect(indicadoresDe('2').bajo).toBe(1)
    expect(indicadoresDe('1').bajo).toBe(0)
  })

  it('el indicador y el conmutador cuentan LO MISMO', () => {
    // Es lo que evita el «7 en stock bajo» sobre cinco filas. Vale para cada
    // sucursal por separado, no solo para «Todas».
    for (const donde of [TODAS_LAS_SUCURSALES, '1', '2']) {
      const conElConmutador = filtrarInventario(CATALOGO, {
        sucursalElegida: donde,
        soloStockBajo: true,
        umbral: UMBRAL,
      })

      expect(indicadoresDe(donde).bajo).toBe(conElConmutador.length)
    }
  })
})

// ════════════════════════════════════════════
//  Hallazgo 3 · El alta dejaba productos sin ninguna fila de stock
// ════════════════════════════════════════════

describe('cuerposDeStockAlCrear · el alta crea la fila aunque la cantidad sea cero', () => {
  const FILAS = [
    { punto_de_venta_id: 1, nombre: 'Centro', quantity: 0, min_stock: 0 },
    { punto_de_venta_id: 2, nombre: 'Ortiz', quantity: 0, min_stock: 0 },
  ]

  it('un alta SIN cantidad igual escribe una fila por sucursal', () => {
    // El filtro `quantity > 0 || min_stock > 0` dejaba el producto con CERO
    // filas de stock. Después Inventario lo sumaba a «Stock bajo» y
    // `GET /api/faltantes` —que recorre `Stock.findAll`— no podía listarlo
    // nunca: el producto que hay que comprar era justo el que no aparecía en
    // la pantalla con la que se arma el pedido (criterio de éxito 19).
    expect(cuerposDeStockAlCrear(FILAS, 77)).toEqual([
      { product_id: 77, punto_de_venta_id: 1, quantity: 0, min_stock: 0 },
      { product_id: 77, punto_de_venta_id: 2, quantity: 0, min_stock: 0 },
    ])
  })

  it('no se saltea las sucursales vacías cuando otra sí tiene cantidad', () => {
    const filas = [
      { punto_de_venta_id: 1, quantity: 12, min_stock: 4 },
      { punto_de_venta_id: 2, quantity: 0, min_stock: 0 },
      { punto_de_venta_id: 3, quantity: 0, min_stock: 0 },
    ]

    expect(cuerposDeStockAlCrear(filas, 5).map((c) => c.punto_de_venta_id)).toEqual([1, 2, 3])
  })

  it('el producto recién creado YA es visible para Faltantes', () => {
    // Faltantes recorre las filas de `Stock`, así que «existir en Faltantes»
    // es «tener al menos una fila». Se simula acá porque es la consecuencia
    // que el defecto rompía, y es la que el usuario ve.
    const filasCreadas = cuerposDeStockAlCrear(FILAS, 77)
    const loVeFaltantes = filasCreadas.some((f) => f.product_id === 77)

    expect(loVeFaltantes).toBe(true)
  })

  it('la misma fila que se escribe hace que Inventario lo cuente como stock bajo', () => {
    // Los dos lados del criterio 19 sobre el mismo dato: la fila que crea el
    // alta es la que hace que las dos pantallas coincidan.
    const creado = producto(77, 'Creatina 300g', 5000,
      cuerposDeStockAlCrear(FILAS, 77).map((c) => ({ ...c, available: c.quantity })))

    expect(hayStockBajo(creado, TODAS_LAS_SUCURSALES, UMBRAL)).toBe(true)
    expect(filtrarInventario([creado], { sucursalElegida: '2', umbral: UMBRAL })).toHaveLength(1)
  })

  it('un campo vacío del formulario viaja como 0 y no como NaN', () => {
    // El `<input type="number">` vacío devuelve `''`. Un NaN viaja como `null`
    // y hace fallar el INSERT.
    const cuerpos = cuerposDeStockAlCrear([{ punto_de_venta_id: 1, quantity: '', min_stock: '' }], 3)

    expect(cuerpos[0]).toEqual({ product_id: 3, punto_de_venta_id: 1, quantity: 0, min_stock: 0 })
  })
})

// ════════════════════════════════════════════
//  Hallazgo 4 · El panel afirmaba unidades comprometidas que no existían
// ════════════════════════════════════════════

describe('unidadesComprometidas · sale de lo GUARDADO, no de lo que se está tipeando', () => {
  it('una fila sana no tiene ninguna comprometida', () => {
    expect(unidadesComprometidas({ quantity: 10, available: 10 })).toBe(0)
  })

  it('lo que el usuario escribe en el <input> NO cambia el número', () => {
    // El defecto: escribir 15 en un renglón que tenía 10/10 hacía aparecer
    // «Hay 5 unidades comprometidas en ventas o producción». No había ninguna.
    const guardada = { quantity: 10, available: 10 }
    const tipeando = { ...guardada, quantity: '15' }

    expect(unidadesComprometidas(guardada)).toBe(0)
    // Y esto es lo que hacía el panel, para dejar dicho de dónde salía el 5:
    expect(Number(tipeando.quantity) - Number(tipeando.available)).toBe(5)
  })

  it('las comprometidas de verdad se siguen informando', () => {
    expect(unidadesComprometidas({ quantity: 10, available: 7 })).toBe(3)
  })

  it('un disponible por encima de la cantidad física da negativo, que es el caso a revisar', () => {
    expect(unidadesComprometidas({ quantity: 5, available: 8 })).toBe(-3)
  })

  it('una fila que todavía no existe no inventa comprometidas', () => {
    expect(unidadesComprometidas(undefined)).toBe(0)
    expect(unidadesComprometidas({})).toBe(0)
  })

  it('lee los números que llegan como string del driver de Postgres', () => {
    expect(unidadesComprometidas({ quantity: '10', available: '7' })).toBe(3)
  })
})

// ════════════════════════════════════════════
//  Hallazgo 5 · La sucursal inactiva con stock negativo desaparecía
// ════════════════════════════════════════════

describe('sucursalesComparables · esconder el stock negativo no lo arregla', () => {
  const SUCURSALES = [
    { id: 1, name: 'Centro', is_active: true },
    { id: 2, name: 'Ortiz', is_active: false },
    { id: 3, name: 'Mayo', is_active: false },
  ]

  it('una sucursal dada de baja con una fila en -3 SIGUE siendo columna', () => {
    // Con `> 0` no generaba columna, pero ese -3 sí sumaba en «Valor del
    // stock» y en el `.xlsx`: quedaba una diferencia entre el total y la suma
    // de las columnas visibles que no se podía explicar mirando la pantalla —
    // el «stock invisible» que esta funcionalidad vino a eliminar (FR-066).
    const catalogo = [producto(1, 'Whey 1kg', 9000, [fila(1, 5), fila(2, -3)])]

    expect(sucursalesComparables(SUCURSALES, catalogo).map((s) => s.id)).toEqual([1, 2])
  })

  it('una sucursal dada de baja y vacía NO genera columna', () => {
    const catalogo = [producto(1, 'Whey 1kg', 9000, [fila(1, 5), fila(3, 0)])]

    expect(sucursalesComparables(SUCURSALES, catalogo).map((s) => s.id)).toEqual([1])
  })

  it('una sucursal dada de baja con stock positivo sigue siendo columna', () => {
    const catalogo = [producto(1, 'Whey 1kg', 9000, [fila(2, 7)])]

    expect(sucursalesComparables(SUCURSALES, catalogo).map((s) => s.id)).toEqual([1, 2])
  })

  it('las activas son columna aunque no tengan nada', () => {
    expect(sucursalesComparables(SUCURSALES, []).map((s) => s.id)).toEqual([1])
  })

  it('una cantidad ilegible NO agrega la columna sola', () => {
    // `Number(undefined) !== 0` es `true`: sin el `|| 0`, un dato roto haría
    // aparecer la sucursal cerrada como si tuviera mercadería.
    const catalogo = [producto(1, 'Whey 1kg', 9000, [
      { punto_de_venta_id: 2, quantity: undefined, min_stock: 0 },
      { punto_de_venta_id: 3, quantity: 'ocho', min_stock: 0 },
    ])]

    expect(sucursalesComparables(SUCURSALES, catalogo).map((s) => s.id)).toEqual([1])
  })

  it('«Valor del stock» coincide con la suma de las columnas que se ven', () => {
    // Es la comprobación que hace falsable el hallazgo: con `> 0`, el total
    // incluía los -3 de la sucursal escondida y la suma de las columnas
    // visibles no, y la diferencia no se podía explicar mirando la pantalla.
    const catalogo = [producto(1, 'Whey 1kg', 9000, [fila(1, 5), fila(2, -3)])]

    const columnas = sucursalesComparables(SUCURSALES, catalogo)
    const total = calcularIndicadores(catalogo, {
      sucursalElegida: TODAS_LAS_SUCURSALES,
      umbral: UMBRAL,
    }).valor

    const sumaDeLasColumnas = catalogo.reduce((suma, p) => suma + columnas.reduce((s, col) => {
      const f = (p.stock || []).find((x) => String(x.punto_de_venta_id) === String(col.id))
      return s + (Number(f?.quantity) || 0) * (Number(p.cost) || 0)
    }, 0), 0)

    expect(sumaDeLasColumnas).toBe(total)
  })
})

// ════════════════════════════════════════════
//  Guardias · que la pantalla use la regla compartida y no una copia
//
//  Una función pura solo prueba la regla. Lo otro que hay que fijar es que el
//  componente la LLAME: si alguien vuelve a escribir el cálculo adentro del
//  JSX, los tests de arriba siguen todos en verde y la pantalla vuelve a estar
//  mal. Es la misma técnica que `tests/historialDeVentas.test.js` y que las
//  guardias de la API: leer el archivo como texto.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const INVENTORY = fs.readFileSync(path.join(SRC, 'pages/Inventory.jsx'), 'utf8')
const PANEL = fs.readFileSync(path.join(SRC, 'components/PanelProducto.jsx'), 'utf8')

/** El texto entre dos marcas de un archivo. */
function entre(fuente, inicio, fin) {
  const i = fuente.indexOf(inicio)
  const j = fuente.indexOf(fin, i)

  expect(i).toBeGreaterThanOrEqual(0)
  expect(j).toBeGreaterThan(i)

  return fuente.slice(i, j)
}

describe('Inventario toma sus reglas de utils/inventario y no las reescribe', () => {
  it('importa las cuatro reglas del módulo compartido', () => {
    const importacion = entre(INVENTORY, "import {", "} from '@/utils/inventario'")

    for (const nombre of ['filtrarInventario', 'calcularIndicadores', 'tonoDeStock', 'sucursalesComparables']) {
      expect(importacion).toContain(nombre)
    }
  })

  it('NO vuelve a declarar el color del badge adentro del componente', () => {
    // La declaración local era `const tonoDeStock = (cantidad, minimo) => …`
    // con la regla de `/api/alerts` adentro.
    expect(INVENTORY).not.toMatch(/const\s+tonoDeStock\s*=/)
  })

  it('el badge se pinta con la fila y el umbral, no con dos números sueltos', () => {
    // `tonoDeStock(cantidad, minimo)` es la firma vieja: recibía la cantidad y
    // el mínimo y no podía consultar el umbral, que es lo que hacía que un
    // producto sin mínimo cargado no se pintara nunca.
    expect(INVENTORY).toContain('tonoDeStock(entry, umbralStockBajo)')
  })

  it('el conteo de sucursales con mercadería no vuelve a exigir cantidad positiva', () => {
    expect(INVENTORY).not.toMatch(/Number\(s\.quantity\)\s*>\s*0/)
  })

  it('la sucursal elegida cuenta como filtro para el estado vacío', () => {
    // Sin esto, elegir una sucursal que no maneja ningún producto muestra «No
    // hay productos cargados», que es mentira y no ofrece cómo salir.
    const bloque = entre(INVENTORY, 'const hayFiltros =', 'const aplicarFiltro')

    expect(bloque).toContain('sucursalElegida !== TODAS_LAS_SUCURSALES')
  })
})

describe('El panel del producto no afirma hechos del servidor desde el <input>', () => {
  it('las unidades comprometidas se calculan sobre la fila guardada', () => {
    const bloque = entre(PANEL, 'filasDeStock.map((fila, i) => {', 'return (')

    expect(bloque).toContain('original.stock[i]')
    // `fila.quantity` es el valor atado al `<input>`: si vuelve a aparecer acá,
    // el aviso vuelve a inventar unidades comprometidas mientras se tipea.
    expect(bloque).not.toMatch(/fila\.(quantity|available)/)
  })

  it('el alta no filtra las filas de stock por cantidad', () => {
    // El filtro era `filasDeStock.filter((f) => Number(f.quantity) > 0 || …)`.
    const bloque = entre(PANEL, 'const crear = async', 'const guardar = async')

    expect(bloque).toContain('cuerposDeStockAlCrear(filasDeStock, creado.id)')
    expect(bloque).not.toMatch(/filasDeStock\.filter/)
  })
})
