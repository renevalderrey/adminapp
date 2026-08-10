import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorDeLaTienda, crearPedido, traerCatalogo, traerProducto, traerProductos } from '../api.js'

/** Una respuesta como la que devuelve `fetch`, sin traerse una librería para eso. */
const respuesta = (estado, cuerpo) => ({
  ok: estado >= 200 && estado < 300,
  status: estado,
  json: async () => {
    if (cuerpo === undefined) throw new SyntaxError('no es JSON')
    return cuerpo
  },
})

let llamadas

beforeEach(() => {
  llamadas = []
  globalThis.fetch = vi.fn((url, init) => {
    llamadas.push({ url, init })
    return Promise.resolve(respuesta(200, { ok: true }))
  })
})

afterEach(() => vi.restoreAllMocks())

describe('api · lo que la tienda NO manda', () => {
  it('un GET no lleva ninguna cabecera: el objeto headers ni siquiera existe', async () => {
    await traerCatalogo('comprafit-fitnet')

    const { init } = llamadas[0]
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(init.method).toBe('GET')
  })

  it('un POST lleva exactamente una cabecera, y es el tipo de contenido', async () => {
    await crearPedido('comprafit-fitnet', { items: [{ product_id: 412, cantidad: 2 }] })

    const { init } = llamadas[0]
    expect(Object.keys(init.headers)).toEqual(['Content-Type'])
    expect(init.method).toBe('POST')
  })

  it('habla contra su propio origen, con rutas relativas y sin CORS de por medio', async () => {
    await traerCatalogo('comprafit-fitnet', 'qr')
    await traerProductos('comprafit-fitnet', { q: 'whey', categoria: 'Proteínas', pagina: 2 })
    await traerProducto('comprafit-fitnet', 412)

    expect(llamadas.map((l) => l.url)).toEqual([
      '/api/publico/c/comprafit-fitnet?f=qr',
      '/api/publico/c/comprafit-fitnet/productos?q=whey&categoria=Prote%C3%ADnas&pagina=2',
      '/api/publico/c/comprafit-fitnet/productos/412',
    ])
    // Ninguna empieza con `http`: no hay URL absoluta que pueda quedar apuntando
    // al entorno equivocado, porque no hay variable de entorno que la arme.
    expect(llamadas.every((l) => l.url.startsWith('/api/publico/'))).toBe(true)
  })

  it('un parámetro vacío no viaja: el catálogo se ve igual con `f` y sin él', async () => {
    await traerCatalogo('comprafit-fitnet')
    await traerProductos('comprafit-fitnet', {})
    expect(llamadas.map((l) => l.url)).toEqual([
      '/api/publico/c/comprafit-fitnet',
      '/api/publico/c/comprafit-fitnet/productos',
    ])
  })

  it('un slug con caracteres raros se escapa y no arma otra ruta', async () => {
    await traerCatalogo('../../api/catalogos')
    expect(llamadas[0].url).toBe('/api/publico/c/..%2F..%2Fapi%2Fcatalogos')
  })
})

describe('api · los errores que la tienda sabe dibujar', () => {
  it('el código del cuerpo es lo que elige la pantalla', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(respuesta(404, { ok: false, error: 'NO_ENCONTRADO' })))

    const error = await traerCatalogo('no-existe').catch((e) => e)
    expect(error).toBeInstanceOf(ErrorDeLaTienda)
    expect(error.codigo).toBe('NO_ENCONTRADO')
    expect(error.http).toBe(404)
  })

  it('el 409 de stock llega con sus líneas y su reintentar_con, no vacío', async () => {
    const cuerpo = {
      ok: false,
      error: 'STOCK_INSUFICIENTE',
      lineas: [{ nombre: 'Creatina 300g', pedida: 5, disponible: 2, accion: 'recortada' }],
      reintentar_con: [{ product_id: 77, cantidad: 2 }],
    }
    globalThis.fetch = vi.fn(() => Promise.resolve(respuesta(409, cuerpo)))

    const error = await crearPedido('comprafit-fitnet', {}).catch((e) => e)
    expect(error.codigo).toBe('STOCK_INSUFICIENTE')
    expect(error.cuerpo.reintentar_con).toEqual([{ product_id: 77, cantidad: 2 }])
  })

  it('el 429 del limitador propio se distingue: es el estado que invita a reintentar', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(respuesta(429, { ok: false, error: 'DEMASIADAS_PETICIONES' })))
    await expect(traerCatalogo('comprafit-fitnet')).rejects.toMatchObject({ codigo: 'DEMASIADAS_PETICIONES' })
  })

  it('quedarse sin señal a mitad del checkout no es un error del servidor', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(crearPedido('comprafit-fitnet', {})).rejects.toMatchObject({ codigo: 'SIN_CONEXION', http: 0 })
  })

  it('una página de error del proxy —que llega en HTML— no revienta al parsear', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(respuesta(502, undefined)))
    await expect(traerCatalogo('comprafit-fitnet')).rejects.toMatchObject({
      codigo: 'NO_DISPONIBLE_POR_UN_MOMENTO',
      http: 502,
    })
  })
})
