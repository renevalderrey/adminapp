import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { llamadas } = vi.hoisted(() => ({ llamadas: [] }))

vi.mock('axios', () => {
  const registrar = (metodo) => (url, ...resto) => {
    llamadas.push({ metodo, url, resto })
    return Promise.resolve({ data: { ok: true } })
  }

  const instancia = {
    get: registrar('get'),
    post: registrar('post'),
    put: registrar('put'),
    delete: registrar('delete'),
    interceptors: {
      request: { use: () => 1, eject: () => {} },
      response: { use: () => 1, eject: () => {} },
    },
  }

  return { default: { create: () => instancia } }
})

const {
  getSucursalesDeStock,
  getProductCostHistory,
  transferStock,
  getStockTransfers,
  importProducts,
} = await import('../services/api.js')

beforeEach(() => { llamadas.length = 0 })

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
