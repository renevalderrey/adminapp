import { describe, it, expect } from 'vitest'
import {
  PARECIDO_MINIMO,
  categoriaMasParecida,
  entraEnElFiltro,
  normalizarTexto,
  precioTexto,
} from '../formato.js'

describe('formato · la tienda no calcula precios, los formatea (H2)', () => {
  it('pone los separadores del importe que mandó el servidor, sin tocar el número', () => {
    expect(precioTexto(38868)).toBe('$38.868')
    expect(precioTexto(28600)).toBe('$28.600')
    expect(precioTexto(1200)).toBe('$1.200')
    expect(precioTexto(0)).toBe('$0')
  })

  it('un importe con centavos no se redondea a mano', () => {
    expect(precioTexto(1234.5)).toBe('$1.234,5')
  })

  it('lo que no es un número no dibuja «NaN» ni «undefined» en una tarjeta', () => {
    expect(precioTexto(undefined)).toBe('$0')
    expect(precioTexto(null)).toBe('$0')
    expect(precioTexto('hola')).toBe('$0')
  })
})

// ⚠ Los mismos casos que `apps/api/src/utils/textoDeBusqueda.js` fija del otro
// lado. Si los dos lados dejan de coincidir, la píldora «Proteínas» muestra seis
// productos con la primera página y ocho después de «ver más», y nadie lo lee
// como un error.
describe('formato · la misma normalización que el servidor', () => {
  it('minúsculas, sin acentos y sin espacios en los bordes', () => {
    expect(normalizarTexto('Proteínas ')).toBe('proteinas')
    expect(normalizarTexto('proteinas')).toBe('proteinas')
    expect(normalizarTexto('  CREATINA  ')).toBe('creatina')
  })

  it('los espacios de adentro NO se colapsan: la categoría es una, no dos', () => {
    expect(normalizarTexto('Suplementos deportivos')).toBe('suplementos deportivos')
  })

  it('la tilde de la ñ se saca igual que los acentos, y la comparación queda simétrica', () => {
    expect(normalizarTexto('Niño')).toBe('nino')
    expect(normalizarTexto('nino')).toBe(normalizarTexto('Niño'))
  })

  it('null y undefined dan cadena vacía y no revientan', () => {
    expect(normalizarTexto(null)).toBe('')
    expect(normalizarTexto(undefined)).toBe('')
  })
})

describe('formato · el filtro del navegador es el mismo que el del servidor', () => {
  const whey = { id: 1, nombre: 'Whey Protein Isolate 1kg', marca: 'ENA', categoria: 'Proteínas' }
  const barra = { id: 2, nombre: 'Barra proteica chocolate 60g', categoria: 'Snacks' }

  it('sin filtro entra todo', () => {
    expect(entraEnElFiltro(whey, {})).toBe(true)
    expect(entraEnElFiltro(barra, { q: '', categoria: '' })).toBe(true)
  })

  it('la categoría se compara entera y normalizada, no por pedacitos', () => {
    expect(entraEnElFiltro(whey, { categoria: 'proteinas' })).toBe(true)
    expect(entraEnElFiltro(whey, { categoria: 'Proteínas' })).toBe(true)
    expect(entraEnElFiltro(whey, { categoria: 'prote' })).toBe(false)
    expect(entraEnElFiltro(barra, { categoria: 'proteinas' })).toBe(false)
  })

  it('el texto busca en el nombre y en la marca, sin acentos', () => {
    expect(entraEnElFiltro(whey, { q: 'isolate' })).toBe(true)
    expect(entraEnElFiltro(whey, { q: 'ena' })).toBe(true)
    expect(entraEnElFiltro(whey, { q: 'gentech' })).toBe(false)
  })

  // ⚠ El 96 % de los productos migrables no tiene marca, y la clave viene
  // **ausente**. Un filtro que hiciera `producto.marca.toLowerCase()` tiraría en
  // la primera tecla, con el catálogo entero ya descargado.
  it('un producto SIN marca se filtra igual: la clave está ausente, no en null', () => {
    expect('marca' in barra).toBe(false)
    expect(entraEnElFiltro(barra, { q: 'barra' })).toBe(true)
    expect(entraEnElFiltro(barra, { q: 'undefined' })).toBe(false)
  })

  it('los dos filtros juntos se aplican juntos', () => {
    expect(entraEnElFiltro(whey, { q: 'whey', categoria: 'Proteínas' })).toBe(true)
    expect(entraEnElFiltro(whey, { q: 'whey', categoria: 'Snacks' })).toBe(false)
  })
})

describe('formato · el vacío ofrece la categoría más parecida', () => {
  const CATEGORIAS = [
    { categoria: 'proteinas', etiqueta: 'Proteínas' },
    { categoria: 'creatinas', etiqueta: 'Creatinas' },
    { categoria: 'snacks', etiqueta: 'Snacks' },
  ]

  // El caso de la maqueta, letra por letra.
  it('«creatnia» sugiere Creatinas', () => {
    expect(categoriaMasParecida('creatnia', CATEGORIAS).etiqueta).toBe('Creatinas')
  })

  it('una búsqueda a medio escribir se resuelve por contención y no por distancia', () => {
    expect(categoriaMasParecida('prote', CATEGORIAS).etiqueta).toBe('Proteínas')
    expect(categoriaMasParecida('SNACK', CATEGORIAS).etiqueta).toBe('Snacks')
  })

  // ⚠ Sugerir cualquier cosa es peor que no sugerir nada: manda a alguien a mirar
  // una categoría que no tiene lo que busca y le confirma que la tienda no lo
  // tiene.
  it('lo que no se parece a nada no sugiere nada', () => {
    expect(categoriaMasParecida('zapatillas', CATEGORIAS)).toBeNull()
    expect(categoriaMasParecida('xyz', CATEGORIAS)).toBeNull()
  })

  it('sin consulta o sin categorías devuelve null y no la primera de la lista', () => {
    expect(categoriaMasParecida('', CATEGORIAS)).toBeNull()
    expect(categoriaMasParecida('creatina', [])).toBeNull()
    expect(categoriaMasParecida(undefined, CATEGORIAS)).toBeNull()
  })

  it('el piso de parecido está escrito y no escondido en un número mágico', () => {
    expect(PARECIDO_MINIMO).toBeGreaterThan(0.5)
    expect(PARECIDO_MINIMO).toBeLessThan(1)
  })
})
