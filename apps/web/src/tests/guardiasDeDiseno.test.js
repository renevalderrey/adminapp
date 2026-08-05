import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ════════════════════════════════════════════
//  Guardia contra la reaparición de colores fuera del sistema
//
//  Tiene la forma de las guardias de la API (`aislamientoEmpresas.test.js`):
//  lee el código fuente como TEXTO y falla si un patrón peligroso vuelve a
//  aparecer. Es grosero a propósito —un análisis exacto exigiría un parser— y
//  lo que se busca es que el error sea visible en la revisión.
//
//  Los cuatro patrones son los que la pantalla de ventas fijó como patrón para
//  las otras cinco del rediseño:
//
//   · Un hexadecimal es un color elegido a ojo que NO existe en modo oscuro.
//     Todo color sale de los tokens de index.css; si falta uno, se agrega ahí
//     y se discute, no se inventa en el componente.
//   · Una regla `dark:` es la consecuencia de lo anterior: los tokens ya
//     resuelven el modo oscuro, así que necesitarla significa que se usó un
//     color de afuera. Lo que hay que corregir es el color, no agregar la
//     variante.
//   · Un `<table>` o un `Table*` de shadcn rompe el patrón de tabla en grid:
//     sin las mismas grid-template-columns en el encabezado y en las filas,
//     las etiquetas dejan de estar sobre sus datos.
//   · Una clase de la paleta de Tailwind —`text-blue-500`, `bg-green-50`— es
//     lo mismo que un hexadecimal pero escrito de otra forma: un color que no
//     existe en el sistema y que en modo oscuro queda como está. Se agregó
//     porque los CUATRO colores fuera del sistema que tenía el punto de venta
//     eran de esta clase, o sea que la guardia los habría dejado pasar aunque
//     el archivo hubiera estado en la lista desde el principio.
//
//  Hay un QUINTO patrón, más abajo, que NO se aplica a toda la lista: solo a
//  las dos pantallas de órdenes, porque lo que detecta —elegir la orden a
//  recibir con un `find()` por estado adentro de un `onClick`— no es un
//  problema de dibujo sino de plata mal aplicada. Vive en este archivo y no en
//  otro porque entra por el mismo motivo que los cuatro de arriba: acompañar
//  la reescritura desde el primer commit en vez de auditarla al final.
//
//  La carpeta es `src/tests/` para que las otras cinco pantallas se sumen a
//  esta misma lista cuando apliquen el patrón.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

/**
 * Los archivos que ya aplican el patrón. Se agregan a medida que se rediseñan.
 *
 * Los cuatro de Inventario entran ANTES de que la pantalla esté reescrita, y es
 * a propósito: así cada hex y cada `dark:` falla en el momento en que se
 * escribe y no treinta juntos al final, cuando ya nadie sabe cuál vino de dónde
 * y la salida barata es comentar la guardia.
 *
 * ⚠ La consecuencia es que `pages/Inventory.jsx` deja esta guardia EN ROJO
 * hasta T1033: hoy dibuja la tabla con los `Table*` de shadcn. Es lo buscado, y
 * queda dicho acá porque un test rojo sin explicación es un test que alguien
 * comenta.
 *
 * ⚠⚠ Y VUELVE A PASAR, a propósito, con el punto de venta. `pages/Billing.jsx`
 * entra a esta lista ANTES de estar reescrita, junto con los cuatro
 * componentes nuevos que todavía están vacíos. Hoy tiene cuatro clases de la
 * paleta de Tailwind —`text-blue-500`, `border-orange-400`,
 * `border-green-500/30` y `bg-green-50`— así que **esta guardia queda EN ROJO
 * desde este commit**.
 *
 * La tarea que la pone en verde es **T1122**, la reescritura de la pantalla.
 *
 * Lo que NO vale para «arreglarla» mientras tanto: sacar `pages/Billing.jsx` de
 * esta lista, comentar el patrón de la paleta, o meter las cuatro clases
 * adentro de un comentario para que `lineasQueMatchean` las saltee. Si el rojo
 * molesta, la salida es T1122.
 *
 * ⚠⚠⚠ Y VUELVE A PASAR POR TERCERA VEZ, a propósito, con proveedores y órdenes
 * de compra. Entran CUATRO archivos antes de estar escritos:
 * `pages/Orders.jsx` y `pages/PurchaseOrders.jsx` sin reescribir (FR-012,
 * FR-069), y `components/PanelOrdenDeCompra.jsx` y
 * `components/BloqueDeDocumentos.jsx` creados vacíos.
 *
 * **Esta guardia queda EN ROJO desde este commit**, y lo que la pone en rojo
 * está enumerado —no es «algo falla»—:
 *
 *   · `pages/Orders.jsx` tiene cuatro clases de la paleta: `border-green-500/30`
 *     (L353 y L464), `border-green-600/30` (L421) y
 *     `bg-green-600 hover:bg-green-700` (L677).
 *   · `pages/Orders.jsx` dibuja con `<table>` (L396, L415) y con los `Table*`
 *     de shadcn (L23-27 y L447-477).
 *   · `pages/PurchaseOrders.jsx` dibuja con los `Table*` de shadcn (L18-22,
 *     L275-321 y L346-361).
 *   · `pages/Orders.jsx` elige la orden a recibir con un `find()` por estado
 *     adentro del `onClick` de «Confirmar Recepción» (L645), que es el quinto
 *     patrón de más abajo.
 *
 * Las tareas que la ponen en verde son **T1237** para `pages/PurchaseOrders.jsx`
 * y **T1240** y **T1242** para `pages/Orders.jsx`.
 *
 * Lo que NO vale para «arreglarla» mientras tanto: sacar cualquiera de los
 * cuatro de esta lista, comentar el patrón nuevo, meter las clases adentro de un
 * comentario para que `lineasQueMatchean` las saltee, o bajar el
 * `toHaveLength`. Si el rojo molesta, la salida es T1237, T1240 y T1242.
 */
const NOMBRES = [
  'pages/InvoicesList.jsx',
  'components/TablaGrid.jsx',
  'components/PanelVenta.jsx',
  'pages/Inventory.jsx',
  'components/PanelProducto.jsx',
  'components/PanelTransferencia.jsx',
  'components/HistorialDeCostos.jsx',
  'pages/Billing.jsx',
  'components/MarcoDePantalla.jsx',
  'components/pos/CatalogoDelPos.jsx',
  'components/pos/TicketDelPos.jsx',
  'components/pos/SegmentoDePago.jsx',
  'pages/Orders.jsx',
  'pages/PurchaseOrders.jsx',
  'components/PanelOrdenDeCompra.jsx',
  'components/BloqueDeDocumentos.jsx',
]

/**
 * Un archivo de la lista, exista o no.
 *
 * ⚠ El `readFileSync` directo era una bomba: un archivo de la lista que todavía
 * no está escrito hace explotar el módulo entero al importarlo, así que la
 * suite no dice «falta PanelOrdenDeCompra.jsx» sino un ENOENT de Node, y NINGÚN
 * caso de este archivo llega a correr —ni los de los otros quince—. El arreglo
 * barato es envolverlo en un try, y ahí la guardia deja de mirar: el archivo que
 * falta pasa a ser un archivo sin hallazgos, que es exactamente igual a un
 * archivo impecable.
 *
 * Por eso el archivo que falta se marca, y los dos rojos se leen distinto:
 * «todavía no se escribió» es una tarea pendiente, «L353: border-green-500/30»
 * es un color fuera del sistema. Confundirlos es cómo se archiva el segundo
 * creyendo que era el primero.
 */
function leer(nombre) {
  const ruta = path.join(SRC, nombre)
  if (!fs.existsSync(ruta)) return { nombre, existe: false, contenido: '' }

  return { nombre, existe: true, contenido: fs.readFileSync(ruta, 'utf8') }
}

const ARCHIVOS = NOMBRES.map(leer)

/**
 * Las líneas que matchean, con su número.
 *
 * Los comentarios se saltean: explicar por qué NO se usa `<table>` no puede
 * hacer fallar la guardia que verifica que no se use.
 */
function lineasQueMatchean(contenido, regex) {
  return contenido
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => regex.test(texto) && !texto.startsWith('//') && !texto.startsWith('*'))
}

/**
 * Los hallazgos de un archivo de la lista, ya formateados.
 *
 * Un archivo que no existe devuelve un hallazgo propio en vez de la lista vacía
 * que devolvería su contenido en blanco. Sin eso, los cuatro patrones pasarían
 * en verde sobre un archivo que nadie leyó, y el único rojo sería el del ancla
 * —que es un solo caso y el primero que alguien aflojaría—.
 */
function hallazgosDe({ nombre, existe, contenido }, regex) {
  if (!existe) return [`${nombre} — el archivo NO existe: la guardia no miró nada`]

  return lineasQueMatchean(contenido, regex).map((h) => `L${h.n}: ${h.texto}`)
}

describe('No debe haber colores fuera de los tokens del sistema', () => {
  const PATRON = /#[0-9a-fA-F]{3,8}\b/

  it.each(ARCHIVOS)('$nombre no tiene ningún valor hexadecimal', (archivo) => {
    expect(hallazgosDe(archivo, PATRON)).toEqual([])
  })
})

describe('No debe hacer falta ninguna regla dark:', () => {
  const PATRON = /\bdark:/;

  it.each(ARCHIVOS)('$nombre no tiene reglas dark:', (archivo) => {
    expect(hallazgosDe(archivo, PATRON)).toEqual([])
  })
})

describe('La tabla es un grid y no un <table>', () => {
  const PATRON = /<table\b|<\/table>|@\/components\/ui\/table|\bTableCell\b|\bTableHeader\b|\bTableRow\b/

  it.each(ARCHIVOS)('$nombre no usa <table> ni los Table* de shadcn', (archivo) => {
    expect(hallazgosDe(archivo, PATRON)).toEqual([])
  })
})

describe('No debe haber clases de la paleta de Tailwind', () => {
  // Las veintidós familias de color de Tailwind, con sus escalas. Un
  // `text-blue-500` es exactamente lo mismo que un `#3b82f6`: un color elegido
  // fuera del sistema, que no cambia en modo oscuro y que nadie relaciona con
  // ningún token.
  //
  // ⚠ `white` y `black` quedan FUERA del patrón a propósito, y hay que decir
  // por qué: `REGLAS-DISENO.md` fija el botón principal como
  // `bg-brand text-white`, y la maqueta pone `color:#fff` adentro del botón de
  // confirmar. Un patrón que los incluyera fallaría contra el propio sistema de
  // diseño el primer día, y la salida barata sería comentar la guardia.
  const PATRON =
    /\b(?:text|bg|border|ring|from|via|to|fill|stroke|divide|accent|caret|placeholder|outline|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/

  it.each(ARCHIVOS)('$nombre no usa clases de la paleta de Tailwind', (archivo) => {
    expect(hallazgosDe(archivo, PATRON)).toEqual([])
  })
})

// Si esta lista queda vacía, la guardia pasa a ser un test que siempre pasa.
describe('La guardia mira los archivos que dice mirar', () => {
  it('los dieciséis archivos existen y tienen contenido', () => {
    expect(ARCHIVOS).toHaveLength(16)

    // Primero los que faltan, y con su propio texto: un archivo que todavía no
    // se escribió es una tarea pendiente y se lee distinto de un color fuera
    // del sistema. Los cuatro patrones de arriba también lo dicen, cada uno por
    // su lado; esto es lo que lo dice UNA vez y con el nombre completo.
    const faltantes = ARCHIVOS
      .filter((a) => !a.existe)
      .map((a) => `${a.nombre} — todavía no se escribió`)

    expect(faltantes).toEqual([])

    for (const archivo of ARCHIVOS) {
      // 60 y no 100: varios de la lista se crearon vacíos a propósito —un
      // componente que devuelve `null` y el comentario de qué va a ser— para
      // que la guardia los acompañe desde el primer commit en vez de auditarlos
      // al final. El umbral sigue existiendo para lo único que tiene que
      // detectar: que alguien deje en la lista un archivo que se borró o que
      // quedó en cero bytes, y que la guardia pase por no tener nada que mirar.
      expect(archivo.contenido.length).toBeGreaterThan(60)
    }
  })
})

// ════════════════════════════════════════════
//  Guardia contra la orden que se recibe sin haberla elegido
//
//  Es el defecto 4 del relevamiento, y es el único de este archivo que no es de
//  dibujo: el botón «Confirmar Recepción» de `Orders.jsx` resuelve QUÉ orden
//  recibir con
//
//      selectedSupplier?.orders?.find(o => o.status === 'pending' || …)
//
//  o sea **la primera pendiente del proveedor**, que no tiene por qué ser la
//  que el usuario abrió. Recibir la #118 carga la mercadería, la deuda y el
//  cambio de estado en la #112.
//
//  Y no se repara después: hay que deshacer a mano el stock, el movimiento de
//  deuda y el estado de dos órdenes, contra un registro que dice que todo salió
//  bien. Por eso la guardia entra ANTES de reescribir las pantallas —el rediseño
//  pone «Recibir» en cada fila, así que multiplica el defecto— y no después.
//
//  Lo que se detecta es la FORMA: un `find()` sobre una colección de órdenes
//  adentro de un handler de clic. La orden a recibir tiene que salir del estado
//  —la que se abrió—, no de una búsqueda por estado hecha en el momento del
//  clic.
//
//  ── Sobre pasar en vacío ──
//
//  El detector se ejercita contra dos muestras sintéticas, con y sin el defecto,
//  igual que los de `apps/api/src/tests/aislamientoEmpresas.test.js`. La mala
//  prueba que encuentra algo; la buena, que se puede poner en verde. Y la cuenta
//  de handlers revisados es el ancla: si mañana el `onClick` se escribe de otra
//  forma, el detector no encontraría nada y pasaría en verde sin haber mirado.
// ════════════════════════════════════════════

/** Índice del cierre que corresponde a la apertura en `inicio`. */
function cierreDe(texto, inicio, abre, cierra) {
  let nivel = 0
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === abre) nivel++
    else if (texto[i] === cierra) {
      nivel--
      if (nivel === 0) return i
    }
  }
  return texto.length - 1
}

const numeroDeLinea = (contenido, i) => contenido.slice(0, i).split('\n').length

/**
 * Una colección de órdenes, por el nombre de quien recibe el `.find(`.
 *
 * Se mira por «contiene» y no por igualdad para que `purchaseOrders`,
 * `ordenesFiltradas` y `selectedSupplier?.orders` entren todas. El costo de
 * mirar de más es un falso positivo que se resuelve renombrando; el de mirar de
 * menos es el defecto 4 otra vez.
 */
const COLECCION_DE_ORDENES = /orders|ordenes|órdenes/i

/**
 * @returns {{ handlers: number, hallazgos: string[] }}
 *   `handlers` es la población que se revisó —es el ancla—; `hallazgos` es lo
 *   que hay que arreglar.
 */
function analizarFindDeOrden(nombre, contenido) {
  const hallazgos = []
  let handlers = 0

  for (const m of contenido.matchAll(/\bon(?:Click|DoubleClick)\s*=\s*\{/g)) {
    const abre = contenido.indexOf('{', m.index + m[0].length - 1)
    const fin = cierreDe(contenido, abre, '{', '}')
    const cuerpo = contenido.slice(abre, fin + 1)
    handlers++

    for (const f of cuerpo.matchAll(/([A-Za-z_$][\w$]*)\s*\??\.\s*find\s*\(/g)) {
      if (!COLECCION_DE_ORDENES.test(f[1])) continue

      const linea = numeroDeLinea(contenido, abre + f.index)
      hallazgos.push(
        `${nombre}:${linea} — ${f[1]}.find(…) adentro de un onClick: elige la orden por estado y no la que se abrió`
      )
    }
  }

  return { handlers, hallazgos }
}

// ── Las dos muestras sintéticas ──
//
// No son documentación: son lo que sostiene a la guardia el día que el
// repositorio deje de tener el defecto. Si alguien afloja el detector, estos dos
// casos se ponen en rojo aunque las dos pantallas estén impecables.

const MUESTRA_FIND_MALA = `
<DialogFooter>
  <Button variant="outline" onClick={() => setIsReceive(false)}>Cancelar</Button>
  <Button onClick={() => {
    const order = selectedSupplier?.orders?.find(o => o.status === 'pending' || o.status === 'partial')
    if (order) handleReceiveOrder(order)
  }}>
    Confirmar Recepción
  </Button>
</DialogFooter>
`

const MUESTRA_FIND_BUENA = `
<DialogFooter>
  <Button variant="outline" onClick={() => setIsReceive(false)}>Cancelar</Button>
  <Button onClick={() => handleReceiveOrder(ordenAbierta)}>
    Confirmar Recepción
  </Button>
  <Button onClick={() => setProducto(productos.find(p => p.id === productoId))}>
    Elegir producto
  </Button>
</DialogFooter>
`

describe('La orden a recibir sale del estado, no de un find() por estado', () => {
  const PANTALLAS = ['pages/Orders.jsx', 'pages/PurchaseOrders.jsx']
  const pantallas = ARCHIVOS.filter((a) => PANTALLAS.includes(a.nombre))

  it('el detector encuentra la forma y la nombra con archivo y línea', () => {
    const { hallazgos } = analizarFindDeOrden('muestra/mala.jsx', MUESTRA_FIND_MALA)

    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toContain('muestra/mala.jsx:5')
    expect(hallazgos[0]).toContain('orders.find(…)')
  })

  it('el detector NO se queja cuando la orden sale del estado', () => {
    // Sin esto la guardia podría estar fallando siempre, que es tan inútil como
    // no fallar nunca: nadie convive con una guardia que no se puede poner en
    // verde. El tercer botón de la muestra buena tiene un `find()` sobre
    // productos, para que quede claro que lo que se detecta es la colección de
    // órdenes y no cualquier `find()` adentro de un clic.
    expect(analizarFindDeOrden('muestra/buena.jsx', MUESTRA_FIND_BUENA).hallazgos).toEqual([])
  })

  it('miró los onClick que dice mirar', () => {
    // **El ancla.** Si el `onClick` se escribiera de otra forma —un handler
    // suelto pasado por variable, por ejemplo—, el detector recorrería cero
    // handlers y pasaría en verde sin haber mirado nada.
    expect(pantallas.map((p) => p.nombre).sort()).toEqual([...PANTALLAS].sort())

    const revisados = pantallas
      .map((p) => analizarFindDeOrden(p.nombre, p.contenido).handlers)
      .reduce((a, b) => a + b, 0)

    expect(revisados).toBeGreaterThan(5)
  })

  it('ninguna pantalla elige la orden a recibir con un find() adentro de un onClick', () => {
    const hallazgos = pantallas.flatMap((p) =>
      p.existe
        ? analizarFindDeOrden(p.nombre, p.contenido).hallazgos
        : [`${p.nombre} — el archivo NO existe: la guardia no miró nada`]
    )

    expect(hallazgos).toEqual([])
  })
})

// ════════════════════════════════════════════
//  Guardia contra guardas de permiso que no guardan
//
//  `<Can>` recibe el permiso en el prop `codigo`. Seis lugares lo pasaban como
//  `permission`, y como `can(undefined)` devuelve `true` —a propósito, para
//  los ítems de menú que no exigen ninguno— esos seis guardas dejaban ver el
//  botón a cualquiera.
//
//  El componente ahora falla cerrado, así que el error ya no abre nada. Esta
//  guardia existe para que tampoco pase silenciosamente a esconder un botón
//  que debería verse.
// ════════════════════════════════════════════

// ════════════════════════════════════════════
//  Guardia contra el CSS de producción que crece por los tests
//
//  Tailwind v4 detecta sus fuentes solo y no distingue un test de un
//  componente. Un test de render menciona clases —`text-warn`, `bg-warn-soft`—
//  para verificar que el badge esté pintado, y cualquier palabra suelta que
//  coincida con una utilidad entra al CSS que baja el navegador del cliente.
//
//  No es hipotético: la variable `container` que devuelve `render()` de
//  `@testing-library` metió 272 bytes de `.container` en el bundle la primera
//  vez que se armó el entorno de render.
//
//  Los `@source not` de `index.css` son lo que lo evita, y son tres líneas que
//  cualquiera saca por parecer de más. Esta guardia existe para que sacarlas
//  falle acá y no en el peso de la descarga, que nadie mira.
// ════════════════════════════════════════════

describe('Los tests no engordan el CSS de producción', () => {
  const CSS = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')

  it.each([
    './tests/**',
    './**/*.test.js',
    './**/*.test.jsx',
    // Las pruebas de navegador viven FUERA de `src/`, así que ninguno de los
    // tres patrones de arriba las alcanza y necesitan el suyo. Y lo necesitan
    // más que los tests de render: verifican medidas, así que nombran
    // utilidades arbitrarias —`min-w-[1080px]`, `w-[400px]`— que Tailwind
    // genera de la nada apenas las ve escritas en cualquier archivo del
    // proyecto.
    '../pruebas-de-navegador/**',
  ])('index.css excluye %s del escaneo de Tailwind', (patron) => {
    expect(CSS).toContain(`@source not "${patron}"`)
  })
})

/**
 * Todos los `.jsx` de una carpeta, INCLUIDAS sus subcarpetas.
 *
 * Antes era un `readdirSync` sin recursión, y eso dejaba fuera de la guardia a
 * `components/pos/` entero: un `<Can permission="…">` ahí adentro le habría
 * dejado ver el botón a cualquiera **con la guardia en verde**. La recursión no
 * es una mejora: es lo que hace que la guardia siga cubriendo lo que dice
 * cubrir cuando alguien crea una subcarpeta, que es lo primero que pasa cuando
 * una pantalla crece.
 */
function jsxDeLaCarpeta(carpeta) {
  const dir = path.join(SRC, carpeta)

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    if (entrada.isDirectory()) return jsxDeLaCarpeta(`${carpeta}/${entrada.name}`)
    if (!entrada.name.endsWith('.jsx')) return []

    return [{
      nombre: `${carpeta}/${entrada.name}`,
      contenido: fs.readFileSync(path.join(dir, entrada.name), 'utf8'),
    }]
  })
}

describe('<Can> siempre recibe el permiso en `codigo`', () => {
  const CARPETAS = ['pages', 'components']

  const archivos = CARPETAS.flatMap(jsxDeLaCarpeta)

  it.each(archivos)('$nombre', ({ contenido }) => {
    const malUsado = lineasQueMatchean(contenido, /<Can\s+(?!codigo=)[a-z]/)
      .map(({ n, texto }) => `L${n}: ${texto}`)

    expect(malUsado).toEqual([])
  })

  it('la guardia de <Can> mira también las subcarpetas de components', () => {
    // Sin esto, agregar `components/pos/` deja tres archivos sin guardia y nada
    // avisa: la lista de `it.each` simplemente tiene tres entradas menos.
    const nombres = archivos.map((a) => a.nombre)

    expect(nombres.some((n) => n.startsWith('components/pos/'))).toBe(true)
    expect(nombres).toContain('components/pos/TicketDelPos.jsx')
  })
})

// ════════════════════════════════════════════
//  Guardia contra la segunda fuente de verdad del ticket
//
//  `Billing.jsx` se parte en tres componentes por TAMAÑO, no por arquitectura:
//  los tres reciben props y no leen el estado global por su cuenta, así que la
//  pantalla sigue teniendo un solo dueño del estado.
//
//  El plan da esto por no verificable y lo deja «escrito en el encabezado de
//  cada archivo». Un comentario no detiene a nadie: el primero que agregue un
//  `useStore(...)` adentro del ticket crea una segunda fuente para el mismo
//  dato, y a partir de ahí la línea que se dibuja y la que se cobra pueden ser
//  distintas.
//
//  La guardia pasa trivialmente mientras los archivos están vacíos, y muerde el
//  día que importe.
// ════════════════════════════════════════════

// ════════════════════════════════════════════
//  Guardia contra la SEGUNDA implementación de la recepción
//
//  FR-034, textual: «la recepción DEBE ser un solo componente usado por las dos
//  pantallas. **Dos implementaciones es lo que dejó una de ellas rota.**»
//
//  Antes de este hito había dos, y no por descuido: cada pantalla resolvió la
//  recepción cuando le tocó. `PurchaseOrders.jsx` abría su modal y
//  `Orders.jsx` el suyo, cada uno con su estado, su cuerpo de request y su
//  forma de decidir QUÉ orden se recibía. Escritas contra el mismo endpoint,
//  derivaron: la de `Orders.jsx` terminó eligiendo la orden con un `find()` por
//  estado —recibir la #118 cargaba el stock, la deuda y el cambio de estado en
//  la #112— y las dos indexaban las cantidades por `product_id`, así que una
//  orden con dos líneas del mismo producto tenía un solo campo. Nada de eso se
//  repara después: hay que deshacer a mano el stock, el movimiento de deuda y el
//  estado de dos órdenes contra un registro que dice que todo salió bien.
//
//  Hoy hay UN solo llamador —`components/PanelOrdenDeCompra.jsx`, el panel que
//  usan las dos pantallas— y no hay nada que lo sostenga. El segundo aparecería
//  igual que la vez pasada: adentro de una `page`, porque es donde queda a mano
//  cuando hace falta «un cambio chico» y abrir el componente compartido parece
//  caro.
//
//  ── Lo que NO se marca, a propósito ──
//
//  Nombrar una orden, listarla, filtrarla, abrir el panel o pasarle props no es
//  implementar la recepción: las dos pantallas tienen que poder hacer todo eso y
//  una guardia que se lo prohibiera sería una que alguien afloja el primer día.
//  Lo único que se marca es TOCAR el endpoint de recepción, sea por el helper de
//  `services/api.js` o por la ruta escrita a mano.
//
//  ── Sobre pasar en vacío ──
//
//  Una guardia que solo cuenta ausencias queda en verde el día que alguien
//  renombra `receivePurchaseOrder`: dejaría de encontrar el llamador legítimo, y
//  «ninguna implementación de más» se lee exactamente igual que «una sola, la
//  correcta». Por eso el ancla afirma primero que la implementación legítima
//  SIGUE estando y que el helper que la sostiene sigue existiendo en
//  `services/api.js` — y hay un caso que le renombra las dos cosas en memoria
//  para comprobar que el ancla se pone en rojo cuando eso pasa.
// ════════════════════════════════════════════

/**
 * Qué cuenta como «implementar la recepción», en las dos formas que existen.
 *
 * El nombre del helper cubre el camino normal —importarlo o llamarlo— incluso
 * cuando se importa con alias, porque la línea del `import` nombra igual el
 * símbolo original. La ruta escrita a mano cubre el atajo: `api.put` contra
 * `/suppliers/orders/<id>/receive` sin pasar por `services/api.js`, que es
 * justamente lo que haría alguien apurado.
 *
 * `/cancel` NO entra: anular no es recibir y no toca ni stock ni deuda.
 */
const IMPLEMENTA_RECEPCION = /\breceivePurchaseOrder\b|\/suppliers\/orders\/.*\/receive/

/** El único que puede hacerlo: el panel que usan las dos pantallas (FR-034). */
const DUENO_DE_LA_RECEPCION = 'components/PanelOrdenDeCompra.jsx'

function implementacionesDeRecepcion(nombre, contenido) {
  return lineasQueMatchean(contenido, IMPLEMENTA_RECEPCION)
    .map(({ n, texto }) => `${nombre}:${n} — ${texto}`)
}

/**
 * El estado de la implementación legítima.
 *
 * Devuelve los tres pedazos por separado —y no un booleano— para que el fallo
 * diga cuál se movió: renombrar el helper, cambiar la ruta y borrar el llamador
 * son tres cosas distintas y solo la última es un archivo que desapareció.
 */
function anclaDeLaRecepcion(apiJs, panel) {
  return {
    helperEnApiJs: /export const receivePurchaseOrder\s*=/.test(apiJs),
    rutaEnApiJs: /\/suppliers\/orders\/.*\/receive/.test(apiJs),
    llamadorEnElPanel: implementacionesDeRecepcion(DUENO_DE_LA_RECEPCION, panel).length > 0,
  }
}

// ── Las dos muestras sintéticas ──
//
// La mala es la forma que tenía `PurchaseOrders.jsx` antes de T1237: la
// pantalla con su propio estado de cantidades y su propia llamada. La buena es
// una pantalla que hace todo lo que una pantalla tiene que poder hacer —listar
// órdenes, abrir el panel, pasarle props— sin implementar ninguna recepción.

const MUESTRA_RECEPCION_MALA = `
import { receivePurchaseOrder } from '@/services/api'

export default function OrdenesDeCompra() {
  const [receiveForm, setReceiveForm] = useState({})

  const handleReceive = async (order) => {
    await receivePurchaseOrder(order.id, Object.entries(receiveForm))
    cargarOrdenes()
  }

  return <Boton onClick={() => handleReceive(orden)}>Confirmar</Boton>
}
`

const MUESTRA_RECEPCION_BUENA = `
import { getPurchaseOrders } from '@/services/api'
import PanelOrdenDeCompra from '@/components/PanelOrdenDeCompra'

export default function OrdenesDeCompra() {
  const [ordenAbierta, setOrdenAbierta] = useState(null)
  const [modo, setModo] = useState('detalle')

  return (
    <>
      <Fila onClick={() => { setOrdenAbierta(orden); setModo('detalle') }}>{orden.id}</Fila>
      <BotonDeFila onClick={() => { setOrdenAbierta(orden); setModo('recepcion') }}>Recibir</BotonDeFila>
      <PanelOrdenDeCompra orden={ordenAbierta} modo={modo} onRecibida={recargar} />
    </>
  )
}
`

describe('La recepción es UN solo componente, usado por las dos pantallas', () => {
  const archivos = ['pages', 'components'].flatMap(jsxDeLaCarpeta)
  const API_JS = fs.readFileSync(path.join(SRC, 'services/api.js'), 'utf8')
  const panel = archivos.find((a) => a.nombre === DUENO_DE_LA_RECEPCION)

  it('el detector encuentra la segunda implementación y la nombra con archivo y línea', () => {
    const hallazgos = implementacionesDeRecepcion('muestra/mala.jsx', MUESTRA_RECEPCION_MALA)

    // Dos: el `import` y la llamada. Las dos son el mismo defecto y las dos
    // tienen que salir con su número de línea, porque el que arregla busca por
    // línea y no por archivo.
    expect(hallazgos).toHaveLength(2)
    expect(hallazgos[0]).toContain('muestra/mala.jsx:2')
    expect(hallazgos[1]).toContain('muestra/mala.jsx:8')
  })

  it('el detector NO se queja de una pantalla que solo abre el panel', () => {
    // Sin esto, la guardia podría estar prohibiendo que una pantalla nombre una
    // orden, y la salida barata sería aflojarla. Una pantalla lista órdenes,
    // filtra, abre el panel en modo recepción y le pasa props: nada de eso es
    // implementar la recepción.
    expect(implementacionesDeRecepcion('muestra/buena.jsx', MUESTRA_RECEPCION_BUENA)).toEqual([])
  })

  it('la implementación legítima sigue estando donde dice estar', () => {
    // **El ancla.** Lo que sigue abajo cuenta ausencias, y contar ausencias
    // sobre un archivo que ya no llama a nada da cero igual que sobre uno
    // impecable.
    expect(panel).toBeDefined()
    expect(anclaDeLaRecepcion(API_JS, panel.contenido)).toEqual({
      helperEnApiJs: true,
      rutaEnApiJs: true,
      llamadorEnElPanel: true,
    })
  })

  it('el ancla se pone en rojo si mañana renombran receivePurchaseOrder', () => {
    // La mutación, escrita como caso en vez de dejada en la memoria de quien la
    // corrió una vez: se renombra el helper en memoria —en `api.js` y en el
    // panel— y el ancla tiene que dejar de encontrarlo. Si este caso pasara con
    // el renombre puesto, el ancla no estaría mirando nada y la guardia entera
    // sería una lista vacía comparada contra otra lista vacía.
    const renombrado = (texto) => texto.replace(/receivePurchaseOrder/g, 'recibirOrdenDeCompra')

    expect(anclaDeLaRecepcion(renombrado(API_JS), renombrado(panel.contenido))).toEqual({
      helperEnApiJs: false,
      rutaEnApiJs: true, // la ruta no cambia de nombre: por eso son tres campos
      llamadorEnElPanel: false,
    })
  })

  it('ninguna page tiene su propia recepción: el panel es el único que la implementa', () => {
    const otros = archivos
      .filter((a) => a.nombre !== DUENO_DE_LA_RECEPCION)
      .flatMap((a) => implementacionesDeRecepcion(a.nombre, a.contenido))

    expect(otros).toEqual([])
  })
})

describe('Los componentes del punto de venta no tienen su propio estado global', () => {
  const archivos = jsxDeLaCarpeta('components/pos')

  it('la carpeta components/pos tiene los tres componentes', () => {
    // Si la carpeta se vacía o se renombra, `it.each` de abajo no corre ninguna
    // vez y la guardia pasa por no tener nada que mirar.
    expect(archivos.map((a) => a.nombre).sort()).toEqual([
      'components/pos/CatalogoDelPos.jsx',
      'components/pos/SegmentoDePago.jsx',
      'components/pos/TicketDelPos.jsx',
    ])
  })

  it.each(archivos)('$nombre no lee el store por su cuenta', ({ contenido }) => {
    const hallazgos = lineasQueMatchean(contenido, /\buseStore\b/)
      .map(({ n, texto }) => `L${n}: ${texto}`)

    expect(hallazgos).toEqual([])
  })
})
