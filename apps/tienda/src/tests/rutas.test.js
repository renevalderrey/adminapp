import { describe, it, expect } from 'vitest'
import { RUTAS, resolverRuta } from '../App.jsx'

// El emparejador de rutas es la pieza que reemplaza a `react-router-dom` en esta
// app, así que tiene que estar probado como una función pura y no «cuando se
// vea la pantalla». Son quince líneas: si no se prueban acá, la primera vez que
// alguien dude va a agregar la librería.
describe('rutas · las cinco pantallas y nada más', () => {
  it('las cinco resuelven con sus parámetros', () => {
    expect(resolverRuta('/c/comprafit-fitnet')).toEqual({ nombre: 'catalogo', parametros: { slug: 'comprafit-fitnet' } })
    expect(resolverRuta('/p/412')).toEqual({ nombre: 'producto', parametros: { id: '412' } })
    expect(resolverRuta('/carrito')).toEqual({ nombre: 'carrito', parametros: {} })
    expect(resolverRuta('/checkout')).toEqual({ nombre: 'checkout', parametros: {} })
    expect(resolverRuta('/confirmado/1042')).toEqual({ nombre: 'confirmado', parametros: { numero: '1042' } })
  })

  it('son cinco y son ésas', () => {
    expect(RUTAS.map((r) => r.patron)).toEqual([
      '/c/:slug',
      '/p/:id',
      '/carrito',
      '/checkout',
      '/confirmado/:numero',
    ])
  })

  it('la barra final no cambia la pantalla', () => {
    expect(resolverRuta('/carrito/')).toEqual({ nombre: 'carrito', parametros: {} })
    expect(resolverRuta('/c/comprafit-fitnet/')?.parametros.slug).toBe('comprafit-fitnet')
  })

  it('lo que no es ninguna de las cinco devuelve null, y eso es una pantalla y no un error', () => {
    expect(resolverRuta('/')).toBeNull()
    expect(resolverRuta('/c')).toBeNull()
    expect(resolverRuta('/carrito/412')).toBeNull()
    expect(resolverRuta('/cualquiera')).toBeNull()
  })

  it('un slug escapado vuelve descifrado, y uno roto no tumba la tienda', () => {
    expect(resolverRuta('/c/caf%C3%A9-fit')?.parametros.slug).toBe('café-fit')
    expect(resolverRuta('/c/%')?.parametros.slug).toBe('%')
  })
})
