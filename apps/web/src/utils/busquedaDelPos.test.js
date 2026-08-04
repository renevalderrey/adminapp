import { describe, it, expect } from 'vitest'
import Fuse from 'fuse.js'
import { buscarEnCatalogo } from './busquedaDelPos'

// ════════════════════════════════════════════
//  El escáner y la búsqueda por nombre comparten un campo, y se contradicen
//
//  El `Fuse` de estas pruebas está armado con la MISMA configuración que la
//  pantalla (`threshold: 0.4`). Si se cambia allá y no acá, estas pruebas dejan
//  de probar lo que dicen.
// ════════════════════════════════════════════

const OPCIONES_DE_FUSE = {
  keys: ['name', 'brand.name', 'category', 'sku', 'barcode'],
  threshold: 0.4,
  distance: 100,
}

const CATALOGO = [
  { id: 1, name: 'Colágeno 300g', sku: 'COL-300', barcode: '7791234567890', brand: { name: 'Star' }, category: 'colageno' },
  { id: 2, name: 'Creatina 300g', sku: 'CRE-300', barcode: '7791234567891', brand: { name: 'Star' }, category: 'creatina' },
  { id: 3, name: 'Whey 1kg', sku: 'WHE 1000', barcode: '7791234567892', brand: { name: 'Ena' }, category: 'proteina' },
  { id: 4, name: 'Proteína Vegana', sku: 'VEG-900', barcode: '7791234567893', brand: { name: 'Ena' }, category: 'proteina' },
  { id: 5, name: 'Barrita 30g', sku: 'BAR-30', barcode: '7791234567894', brand: { name: 'Star' }, category: 'alimento' },
]

const fuse = new Fuse(CATALOGO, OPCIONES_DE_FUSE)

const buscar = (consulta, catalogo = CATALOGO) =>
  buscarEnCatalogo(catalogo, consulta, new Fuse(catalogo, OPCIONES_DE_FUSE))

describe('El código escaneado que no existe', () => {
  it('un EAN de 13 dígitos que no existe NO devuelve el producto más parecido', () => {
    // Es el test que da nombre al archivo. Sin el paso 2, la difusa con
    // `threshold: 0.4` sobre un EAN inexistente devuelve algo —los códigos
    // comparten doce de trece dígitos— y `Enter` lo agrega al ticket. El
    // operador no se entera hasta que alguien cuenta la caja.
    const inexistente = '7791234567899'

    // Primero se comprueba que la difusa SÍ devolvería algo: si no, este test
    // pasaría por el motivo equivocado.
    expect(fuse.search(inexistente).length).toBeGreaterThan(0)

    const { resultados, exacta, codigoNoEncontrado } = buscar(inexistente)

    expect(resultados).toEqual([])
    expect(exacta).toBe(false)
    expect(codigoNoEncontrado).toBe(true)
  })

  it('un código de menos de 8 dígitos NO se trata como escaneo', () => {
    // «300» es parte de tres nombres del catálogo. Tratarlo como código
    // rompería la búsqueda por número que el operador usa todos los días.
    const { codigoNoEncontrado, resultados } = buscar('300')

    expect(codigoNoEncontrado).toBe(false)
    expect(resultados.length).toBeGreaterThan(0)
  })

  it('un texto largo que no es solo dígitos sigue yendo a la difusa', () => {
    const { codigoNoEncontrado } = buscar('proteina vegana')

    expect(codigoNoEncontrado).toBe(false)
  })
})

describe('El código exacto manda', () => {
  it('el código exacto le gana a la difusa aunque haya diez parecidos', () => {
    const { resultados, exacta, codigoNoEncontrado } = buscar('7791234567890')

    expect(resultados.map((p) => p.id)).toEqual([1])
    expect(exacta).toBe(true)
    expect(codigoNoEncontrado).toBe(false)
  })

  it('un SKU con guiones y espacios encuentra igual', () => {
    // El SKU se escribe «COL-300» en el sistema y «col 300» a mano; el lector
    // de algunos códigos mete espacios. Comparados crudos no encuentran nada.
    for (const consulta of ['COL-300', 'col 300', 'COL300', ' col-300 ', 'Col-300']) {
      expect([consulta, buscar(consulta).resultados.map((p) => p.id)]).toEqual([consulta, [1]])
      expect([consulta, buscar(consulta).exacta]).toEqual([consulta, true])
    }

    // Y al revés: el SKU cargado con un espacio se encuentra escribiéndolo con
    // guion.
    expect(buscar('WHE-1000').resultados.map((p) => p.id)).toEqual([3])
  })

  it('el código exacto devuelve UN producto y no una lista', () => {
    expect(buscar('CRE-300').resultados).toHaveLength(1)
  })
})

describe('La búsqueda por nombre, que es el otro uso del mismo campo', () => {
  it('una consulta corta sí usa la difusa', () => {
    // «colageno» sin tilde tiene que seguir encontrando «Colágeno». Es lo que
    // se rompería bajando el `threshold` de Fuse en vez de resolver el orden.
    const { resultados, exacta, codigoNoEncontrado } = buscar('colageno')

    expect(resultados.map((p) => p.name)).toContain('Colágeno 300g')
    expect(exacta).toBe(false)
    expect(codigoNoEncontrado).toBe(false)
  })

  it('la consulta vacía devuelve el catálogo entero, como hoy', () => {
    for (const consulta of ['', '   ', null, undefined]) {
      expect([String(consulta), buscar(consulta).resultados]).toEqual([String(consulta), CATALOGO])
    }
  })

  it('con el catálogo vacío no explota ni inventa resultados', () => {
    expect(buscar('lo que sea', [])).toEqual({
      resultados: [],
      exacta: false,
      codigoNoEncontrado: false,
    })

    expect(buscarEnCatalogo(undefined, 'algo', undefined)).toEqual({
      resultados: [],
      exacta: false,
      codigoNoEncontrado: false,
    })
  })

  it('un producto sin barcode ni sku no rompe la comparación exacta', () => {
    // Es el caso del riesgo 9: medio catálogo sin código cargado.
    const sinCodigos = [{ id: 9, name: 'Suelto', sku: null, barcode: undefined }]

    expect(buscar('Suelto', sinCodigos).resultados.map((p) => p.id)).toEqual([9])
    // Y una consulta vacía normalizada no puede matchear un código vacío.
    expect(buscar('', sinCodigos).exacta).toBe(false)
  })
})
