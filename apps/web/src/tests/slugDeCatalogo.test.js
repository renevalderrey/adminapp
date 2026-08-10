import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESERVADOS, FORMATO, normalizarSlug, validarSlug } from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · El slug del formulario y el slug del servidor no se separaron
//
//  ── Qué pasa si se separan ──
//
//  El formulario del panel propone la dirección mientras alguien escribe el
//  nombre, y el servidor la normaliza otra vez antes de guardarla (FR-051). Si
//  las dos normalizaciones no dan lo mismo, el comercio apretó «Publicar» sobre
//  `comprafit-fitnet` y quedó publicada otra dirección.
//
//  Y esa dirección **se imprime en una pared**: el QR está pegado en la
//  recepción del gimnasio, el enlace no abre nada, y **nada falló en ningún
//  log**. Alcanza con que un lado colapse los guiones repetidos y el otro no, o
//  con que uno tenga un reservado que el otro no tiene.
//
//  ── Por qué es una copia y no un paquete compartido ──
//
//  Son ocho líneas sin dependencias. Un tercer paquete del workspace —después de
//  `@favalio/precios` y de `packages/pedido`— obliga a tocar dos `package.json`,
//  el build de Vite, el de Node y la resolución entre CommonJS y ESM para
//  compartir eso: engorda el corte de workspaces **sin resolver nada que este
//  archivo no resuelva**. La copia se acepta y el motivo se escribe.
//
//  Este test es el que las ata. Lee el archivo de la API **como texto**, igual
//  que `src/tests/mediosDePago.test.js`. Es grosero y es exactamente lo que hace
//  falta: la alternativa es que nadie lo mire, que es lo que pasó con `tc3`.
//
//  ⚠ Si aparece una tercera regla compartida, ahí nace `packages/comun` y este
//  archivo se borra.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))

/** El archivo de la API, leído como texto desde el otro paquete del monorepo. */
const SLUG_DE_LA_API = fs.readFileSync(
  path.join(AQUI, '../../../api/src/utils/slugDeCatalogo.js'),
  'utf8'
)

/**
 * Los reservados que declara la API.
 *
 * Se recorta el bloque entre `const RESERVADOS = [` y el primer `];` para no
 * barrer ninguna otra lista de cadenas del archivo.
 */
function reservadosDeLaApi() {
  const desde = SLUG_DE_LA_API.indexOf('const RESERVADOS = [')
  expect(desde).toBeGreaterThan(-1)

  const hasta = SLUG_DE_LA_API.indexOf('];', desde)
  expect(hasta).toBeGreaterThan(desde)

  return [...SLUG_DE_LA_API.slice(desde, hasta).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** El `FORMATO` de la API, como texto: la fuente del regex, sin las barras. */
function formatoDeLaApi() {
  const encontrado = SLUG_DE_LA_API.match(/const FORMATO = \/(.+)\/;/)
  expect(encontrado).not.toBeNull()

  return encontrado[1]
}

/** Los dos largos de la API. */
function largosDeLaApi() {
  const leer = (nombre) => Number(SLUG_DE_LA_API.match(new RegExp(`const ${nombre} = (\\d+);`))?.[1])

  return { minimo: leer('LARGO_MINIMO'), maximo: leer('LARGO_MAXIMO') }
}

describe('La lista de reservados del navegador y la de la API no se separaron', () => {
  it('la lectura del archivo de la API encontró algo: no pasa por leer vacío', () => {
    // Una guardia que lee con la ruta equivocada compara dos listas vacías y
    // pasa siempre. Si el archivo se mueve, esto falla acá.
    expect(SLUG_DE_LA_API.length).toBeGreaterThan(1000)
    expect(reservadosDeLaApi().length).toBeGreaterThanOrEqual(9)
  })

  it('las dos listas son la misma, en los dos sentidos', () => {
    // La igualdad se afirma en LOS DOS SENTIDOS: un reservado de más en la web
    // es una dirección que el panel rechaza y el servidor acepta —el comercio no
    // puede tomar un nombre que sí está libre—; uno de más en la API es una
    // dirección que el panel propone y el servidor rechaza con un 400 que
    // aparece recién al guardar.
    expect([...RESERVADOS].sort()).toEqual(reservadosDeLaApi().sort())
  })

  it('los dos incluyen `c`, que es el más importante y el menos obvio', () => {
    // Es el prefijo de la propia URL pública: un catálogo llamado `c` produciría
    // `/c/c/...` y volvería ambigua la ruta que el resolvedor tiene que leer.
    expect(RESERVADOS).toContain('c')
    expect(reservadosDeLaApi()).toContain('c')
  })
})

describe('El formato del slug es el mismo de los dos lados', () => {
  it('el regex es idéntico, carácter por carácter', () => {
    // Comparar la fuente y no el comportamiento: dos regex distintos pueden
    // coincidir en los diez casos que a alguien se le ocurran y separarse en el
    // once. Está escrito como «grupos separados por un guión» justamente para
    // que el propio regex prohíba el guión del principio, el del final y los
    // repetidos; un `[a-z0-9-]+` aceptaría `-comprafit--fitnet-`.
    expect(FORMATO.source).toBe(formatoDeLaApi())
  })

  it('los dos largos son los mismos', () => {
    const api = largosDeLaApi()

    // Con largos distintos, un nombre de dos caracteres pasa el formulario y
    // muere en el servidor, o al revés.
    expect(api.minimo).toBe(3)
    expect(api.maximo).toBe(60)
    expect(validarSlug('ab').ok).toBe(false)
    expect(validarSlug('abc').ok).toBe(true)
    expect(validarSlug('a'.repeat(61)).ok).toBe(false)
  })

  it('el regex del navegador rechaza lo que la normalización nunca produce', () => {
    // El contra-caso del regex: si fuera más permisivo, esto pasaría.
    expect(FORMATO.test('-comprafit--fitnet-')).toBe(false)
    expect(FORMATO.test('comprafit-fitnet')).toBe(true)
  })
})

describe('La normalización del navegador es la del servidor', () => {
  it('las dos colapsan los guiones repetidos, que es el defecto concreto', () => {
    // ⚠ El caso exacto que motiva todo esto: «Comprafit / Fitnet» tiene espacio,
    // barra, espacio. Sin el colapso sale `comprafit---fitnet`.
    expect(normalizarSlug('Comprafit / Fitnet')).toBe('comprafit-fitnet')

    // Y que la API tiene la MISMA línea, leída como texto: sin esto, la
    // afirmación de arriba sólo prueba la copia contra sí misma.
    expect(SLUG_DE_LA_API).toMatch(/\.replace\(\/-\{2,\}\/g, '-'\)/)
  })

  it('las dos sacan los acentos con la misma descomposición', () => {
    expect(normalizarSlug('Comprafít')).toBe('comprafit')
    expect(SLUG_DE_LA_API).toContain(".normalize('NFD')")
    expect(SLUG_DE_LA_API).toMatch(/u0300-\\u036f/)
  })

  it('las dos recortan los guiones de los bordes', () => {
    expect(normalizarSlug('--hola--')).toBe('hola')
    expect(SLUG_DE_LA_API).toMatch(/\.replace\(\/\^-\+\|-\+\$\/g, ''\)/)
  })
})
