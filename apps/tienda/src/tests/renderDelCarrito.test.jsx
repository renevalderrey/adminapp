import { describe, it, expect, afterEach, vi } from 'vitest'
import Carrito from '../pantallas/Carrito.jsx'
import { CANTIDAD_MAXIMA } from '../carrito.js'
import { desmontarTodo, dibujar, tocar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  T1464 · El carrito
// ════════════════════════════════════════════

// El whey tiene una regla de precio fijo: `precio` 9.999 y `precio_lista`
// 45.000. Es lo que hace que «sumó el precio» y «sumó el de lista» den números
// distintos.
const LINEAS = [
  { product_id: 1, nombre: 'Whey Protein Isolate 1kg', marca: 'ENA', precio: 9999, precio_lista: 45000, cantidad: 2 },
  { product_id: 2, nombre: 'Creatina Monohidrato 300g', precio: 21900, cantidad: 1 },
]

const CATALOGO = {
  nombre: 'Comprafit / Fitnet',
  entrega: { envio: true, envio_costo: 2500, envio_gratis_desde: 50000 },
}

afterEach(() => desmontarTodo())

const montar = (props = {}) =>
  dibujar(
    <Carrito
      lineas={LINEAS}
      catalogo={CATALOGO}
      alPoner={() => {}}
      alQuitar={() => {}}
      alVolver={() => {}}
      alContinuar={() => {}}
      {...props}
    />
  )

describe('carrito · lo que se lee', () => {
  it('una línea por producto, con su nombre y su importe', () => {
    const p = montar()

    expect(p.todos('[data-linea]')).toHaveLength(2)
    expect(p.texto()).toContain('Whey Protein Isolate 1kg')
    // 9999 × 2.
    expect(p.ver('[data-linea="1"] [data-importe]').textContent).toBe('$19.998')
    expect(p.ver('[data-linea="2"] [data-importe]').textContent).toBe('$21.900')
  })

  it('el total del carrito es el que devuelve el servidor, no una suma del navegador', () => {
    // 9999×2 + 21900 = 41.898. Si el carrito sumara `precio_lista` —el número
    // tachado que está al lado— mostraría $111.900, y el comprador se enteraría
    // recién en la confirmación, cuando el servidor cobre otra cosa.
    const p = montar()

    expect(p.ver('[data-subtotal]').textContent).toBe('$41.898')
    expect(p.texto()).not.toContain('$111.900')
  })

  it('sin marca no se dibuja el renglón de la marca', () => {
    const p = montar()

    expect(p.ver('[data-linea="1"] [data-marca]').textContent).toBe('ENA')
    expect(p.ver('[data-linea="2"] [data-marca]')).toBeNull()
  })

  it('dice cuánto falta para el envío gratis', () => {
    const p = montar()

    expect(p.ver('[data-falta-envio]').textContent).toContain('$8.102')
  })

  it('sin umbral de envío gratis no hay renglón que lo diga', () => {
    const p = montar({ catalogo: { entrega: { envio: true, envio_costo: 2500, envio_gratis_desde: null } } })

    expect(p.ver('[data-falta-envio]')).toBeNull()
  })
})

describe('carrito · lo que se toca', () => {
  it('el «más» y el «menos» avisan la cantidad nueva', () => {
    const alPoner = vi.fn()
    const p = montar({ alPoner })

    tocar(p.ver('[data-linea="1"] [data-cantidad="mas"]'))
    expect(alPoner).toHaveBeenCalledWith(1, 3)

    tocar(p.ver('[data-linea="1"] [data-cantidad="menos"]'))
    expect(alPoner).toHaveBeenCalledWith(1, 1)
  })

  it('el tacho quita la línea entera', () => {
    const alQuitar = vi.fn()
    const p = montar({ alQuitar })

    tocar(p.ver('[data-linea="2"] [data-quitar]'))
    expect(alQuitar).toHaveBeenCalledWith(2)
  })

  it('el «más» se apaga en el tope, con la misma regla que acota el valor', () => {
    const p = montar({
      lineas: [{ product_id: 1, nombre: 'Whey', precio: 100, cantidad: CANTIDAD_MAXIMA }],
    })

    expect(p.ver('[data-cantidad="mas"]').disabled).toBe(true)
  })

  it('el «más» se apaga cuando se llegó al stock que declaró el servidor', () => {
    const p = montar({
      lineas: [{ product_id: 1, nombre: 'Whey', precio: 100, cantidad: 3, stock_disponible: 3 }],
    })

    expect(p.ver('[data-cantidad="mas"]').disabled).toBe(true)
  })

  it('«Continuar con mis datos» lleva al checkout', () => {
    const alContinuar = vi.fn()
    const p = montar({ alContinuar })

    tocar(p.ver('[data-continuar]'))
    expect(alContinuar).toHaveBeenCalled()
  })
})
