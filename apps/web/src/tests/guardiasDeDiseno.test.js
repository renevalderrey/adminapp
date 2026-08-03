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
 */
const ARCHIVOS = [
  'pages/InvoicesList.jsx',
  'components/TablaGrid.jsx',
  'components/PanelVenta.jsx',
  'pages/Inventory.jsx',
  'components/PanelProducto.jsx',
  'components/PanelTransferencia.jsx',
  'components/HistorialDeCostos.jsx',
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

// Si esta lista queda vacía, la guardia pasa a ser un test que siempre pasa.
describe('La guardia mira los archivos que dice mirar', () => {
  it('los siete archivos existen y tienen contenido', () => {
    expect(ARCHIVOS).toHaveLength(7)
    for (const archivo of ARCHIVOS) {
      // 60 y no 100: tres de los siete se crearon vacíos a propósito —un
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

describe('<Can> siempre recibe el permiso en `codigo`', () => {
  const CARPETAS = ['pages', 'components']

  const archivos = CARPETAS.flatMap((carpeta) => {
    const dir = path.join(SRC, carpeta)

    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsx'))
      .map((f) => ({
        nombre: `${carpeta}/${f}`,
        contenido: fs.readFileSync(path.join(dir, f), 'utf8'),
      }))
  })

  it.each(archivos)('$nombre', ({ contenido }) => {
    const malUsado = lineasQueMatchean(contenido, /<Can\s+(?!codigo=)[a-z]/)
      .map(({ n, texto }) => `L${n}: ${texto}`)

    expect(malUsado).toEqual([])
  })
})
