import { describe, it, expect } from 'vitest'
import {
  subtotalDelCarrito,
  envioDelPedido,
  faltaParaElEnvioGratis,
  totalesDelPedido,
} from '../totales.js'

// ════════════════════════════════════════════
//  T1464 · Los importes que se muestran
// ════════════════════════════════════════════

// ⚠ La fixture importa: `precio` y `precio_lista` son **números distintos**,
// porque una regla de precio fijo dejó el whey en $9.999. Con los dos iguales,
// sumar uno u otro da el mismo total y el test no distinguiría nada.
const LINEAS = [
  { product_id: 1, nombre: 'Whey', precio: 9999, precio_lista: 45000, cantidad: 2 },
  { product_id: 2, nombre: 'Creatina', precio: 21900, precio_lista: 21900, cantidad: 1 },
]

const ENVIO = { envio: true, envio_costo: 2500, envio_gratis_desde: 50000 }

describe('subtotalDelCarrito', () => {
  it('suma el precio que resolvió el servidor, no el de lista', () => {
    // 9999×2 + 21900 = 41898. Sumando `precio_lista` daría 111900: el carrito
    // mostraría un total que el servidor va a desmentir en el paso siguiente.
    expect(subtotalDelCarrito(LINEAS)).toBe(41898)
  })

  it('un carrito vacío da cero y no NaN', () => {
    expect(subtotalDelCarrito([])).toBe(0)
    expect(subtotalDelCarrito()).toBe(0)
  })

  it('una línea sin precio no rompe la suma', () => {
    // Una instantánea vieja de `localStorage` puede no tener `precio`.
    expect(subtotalDelCarrito([{ product_id: 3, cantidad: 2 }])).toBe(0)
  })
})

describe('envioDelPedido', () => {
  it('sólo se cobra con envío a domicilio', () => {
    for (const entrega of ['retiro_socio', 'retiro_local', 'coordinar', undefined]) {
      expect(envioDelPedido(ENVIO, entrega, 1000)).toEqual({ costo: 0, gratis: false })
    }

    expect(envioDelPedido(ENVIO, 'envio', 1000).costo).toBe(2500)
  })

  it('con el subtotal exactamente igual al umbral el envío es gratis', () => {
    // El único caso que distingue `>=` de `>`.
    expect(envioDelPedido(ENVIO, 'envio', 50000)).toEqual({ costo: 0, gratis: true })
    expect(envioDelPedido(ENVIO, 'envio', 49999)).toEqual({ costo: 2500, gratis: false })
  })

  it('umbral nulo o cero no regala el envío', () => {
    for (const umbral of [null, undefined, 0]) {
      const entrega = { envio: true, envio_costo: 2500, envio_gratis_desde: umbral }
      expect(envioDelPedido(entrega, 'envio', 999999).costo).toBe(2500)
    }
  })

  it('el catálogo que no hace envíos no cobra envío', () => {
    expect(envioDelPedido({ envio: false, envio_costo: 2500 }, 'envio', 1000).costo).toBe(0)
  })
})

describe('faltaParaElEnvioGratis', () => {
  it('dice cuánto falta, y nada cuando ya se llegó', () => {
    expect(faltaParaElEnvioGratis(ENVIO, 41898)).toBe(8102)
    expect(faltaParaElEnvioGratis(ENVIO, 50000)).toBeNull()
  })

  it('sin umbral, o sin envío, no hay nada que decir', () => {
    expect(faltaParaElEnvioGratis({ envio: true, envio_gratis_desde: null }, 10)).toBeNull()
    expect(faltaParaElEnvioGratis({ envio: false, envio_gratis_desde: 50000 }, 10)).toBeNull()
  })
})

describe('totalesDelPedido', () => {
  it('los tres números juntos', () => {
    expect(totalesDelPedido(LINEAS, ENVIO, 'envio')).toEqual({
      subtotal: 41898,
      envio: 2500,
      envio_gratis: false,
      total: 44398,
    })
  })
})
