import { describe, it, expect, beforeEach } from 'vitest'
import {
  CANTIDAD_MAXIMA,
  acotarCantidad,
  agregarAlCarrito,
  cambiarCantidad,
  claveDe,
  contarUnidades,
  guardarCarrito,
  leerCarrito,
  lineasParaElPedido,
  quitarDelCarrito,
} from '../carrito.js'

const WHEY = { id: 412, nombre: 'Whey Protein 1kg', marca: 'ENA', precio: 28600 }
const CREATINA = { id: 77, nombre: 'Creatina 300g', precio: 19800, stock_disponible: 2 }

describe('carrito · las reglas, sin render', () => {
  it('agregar dos veces el mismo producto suma cantidad, no agrega una línea', () => {
    const uno = agregarAlCarrito([], WHEY)
    const dos = agregarAlCarrito(uno, WHEY)

    expect(dos).toHaveLength(1)
    expect(dos[0].cantidad).toBe(2)

    // Las dos afirmaciones juntas: una sola línea **y** dos unidades. Con solo
    // la primera, un carrito que pisa la línea en vez de sumarla también pasa.
    expect(contarUnidades(dos)).toBe(2)
  })

  it('dos productos distintos sí son dos líneas', () => {
    const carrito = agregarAlCarrito(agregarAlCarrito([], WHEY), CREATINA)
    expect(carrito.map((l) => l.product_id)).toEqual([412, 77])
  })

  it('agregar de a varios también suma', () => {
    const carrito = agregarAlCarrito(agregarAlCarrito([], WHEY, 3), WHEY, 4)
    expect(carrito[0].cantidad).toBe(7)
  })

  it('no deja pedir más de lo que hay: la suma se acota a stock_disponible', () => {
    const carrito = agregarAlCarrito(agregarAlCarrito([], CREATINA, 2), CREATINA, 5)
    expect(carrito).toHaveLength(1)
    expect(carrito[0].cantidad).toBe(2)
  })

  it('sin stock declarado el techo es el duro, el mismo que rechaza el servidor', () => {
    expect(acotarCantidad(5000)).toBe(CANTIDAD_MAXIMA)
    expect(agregarAlCarrito([], WHEY, 5000)[0].cantidad).toBe(CANTIDAD_MAXIMA)
  })

  it('cero, negativo, decimal y basura no entran al carrito', () => {
    expect(acotarCantidad(0)).toBe(0)
    expect(acotarCantidad(-3)).toBe(0)
    expect(acotarCantidad(2.7)).toBe(2)
    expect(acotarCantidad('dos')).toBe(0)
    expect(agregarAlCarrito([], WHEY, -1)).toEqual([])
  })

  it('un producto agotado —stock_disponible 0— no entra', () => {
    expect(agregarAlCarrito([], { id: 9, nombre: 'Agotado', stock_disponible: 0 })).toEqual([])
  })

  it('poner la cantidad en cero saca la línea: es el «quitar» del control', () => {
    const carrito = agregarAlCarrito([], WHEY, 3)
    expect(cambiarCantidad(carrito, 412, 0)).toEqual([])
    expect(cambiarCantidad(carrito, 412, 1)[0].cantidad).toBe(1)
    expect(quitarDelCarrito(carrito, 412)).toEqual([])
  })

  it('el pedido lleva product_id y cantidad, y nada más (FR-130)', () => {
    const carrito = agregarAlCarrito([], WHEY, 2)
    expect(carrito[0].precio).toBe(28600)
    expect(lineasParaElPedido(carrito)).toEqual([{ product_id: 412, cantidad: 2 }])
  })

  it('la instantánea no inventa claves: un producto sin marca no guarda marca', () => {
    const linea = agregarAlCarrito([], CREATINA)[0]
    expect('marca' in linea).toBe(false)
    expect(linea.nombre).toBe('Creatina 300g')
  })
})

describe('carrito · lo que se guarda en el navegador', () => {
  beforeEach(() => localStorage.clear())

  it('cada catálogo tiene su carrito: el segundo QR no abre con los productos del primero', () => {
    guardarCarrito('comprafit-fitnet', agregarAlCarrito([], WHEY))
    guardarCarrito('dietetica-del-centro', agregarAlCarrito([], CREATINA))

    expect(leerCarrito('comprafit-fitnet').map((l) => l.product_id)).toEqual([412])
    expect(leerCarrito('dietetica-del-centro').map((l) => l.product_id)).toEqual([77])
    expect(leerCarrito('un-catalogo-que-nunca-se-abrio')).toEqual([])
  })

  it('un carrito corrupto abre vacío y no rompe la tienda', () => {
    localStorage.setItem(claveDe('roto'), 'esto no es json')
    expect(leerCarrito('roto')).toEqual([])

    localStorage.setItem(claveDe('otro'), JSON.stringify({ whey: 1 }))
    expect(leerCarrito('otro')).toEqual([])

    localStorage.setItem(claveDe('mezcla'), JSON.stringify([{ product_id: 412, cantidad: 2 }, { cantidad: 3 }, null]))
    expect(leerCarrito('mezcla')).toHaveLength(1)
  })
})
