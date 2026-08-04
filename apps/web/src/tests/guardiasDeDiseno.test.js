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
 */
const ARCHIVOS = [
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
].map((nombre) => ({
  nombre,
  contenido: fs.readFileSync(path.join(SRC, nombre), 'utf8'),
}))

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

describe('No debe haber colores fuera de los tokens del sistema', () => {
  const PATRON = /#[0-9a-fA-F]{3,8}\b/

  it.each(ARCHIVOS)('$nombre no tiene ningún valor hexadecimal', ({ contenido }) => {
    const hallazgos = lineasQueMatchean(contenido, PATRON)
    expect(hallazgos.map((h) => `L${h.n}: ${h.texto}`)).toEqual([])
  })
})

describe('No debe hacer falta ninguna regla dark:', () => {
  const PATRON = /\bdark:/;

  it.each(ARCHIVOS)('$nombre no tiene reglas dark:', ({ contenido }) => {
    const hallazgos = lineasQueMatchean(contenido, PATRON)
    expect(hallazgos.map((h) => `L${h.n}: ${h.texto}`)).toEqual([])
  })
})

describe('La tabla es un grid y no un <table>', () => {
  const PATRON = /<table\b|<\/table>|@\/components\/ui\/table|\bTableCell\b|\bTableHeader\b|\bTableRow\b/

  it.each(ARCHIVOS)('$nombre no usa <table> ni los Table* de shadcn', ({ contenido }) => {
    const hallazgos = lineasQueMatchean(contenido, PATRON)
    expect(hallazgos.map((h) => `L${h.n}: ${h.texto}`)).toEqual([])
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

  it.each(ARCHIVOS)('$nombre no usa clases de la paleta de Tailwind', ({ contenido }) => {
    const hallazgos = lineasQueMatchean(contenido, PATRON)
    expect(hallazgos.map((h) => `L${h.n}: ${h.texto}`)).toEqual([])
  })
})

// Si esta lista queda vacía, la guardia pasa a ser un test que siempre pasa.
describe('La guardia mira los archivos que dice mirar', () => {
  it('los doce archivos existen y tienen contenido', () => {
    expect(ARCHIVOS).toHaveLength(12)
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
