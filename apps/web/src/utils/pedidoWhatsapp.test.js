import { describe, it, expect } from 'vitest'
import { normalizarTelefono, armarTextoPedido } from './pedidoWhatsapp'

// ════════════════════════════════════════════
//  El teléfono es la parte frágil: se carga como venga —con 0, con 15, con
//  guiones— y wa.me exige formato internacional sin signos. Un número mal
//  armado abre un chat con alguien que no es el proveedor.
// ════════════════════════════════════════════

describe('normalizarTelefono', () => {
  it.each([
    ['3425123456', '5493425123456', 'sin prefijos'],
    ['0342 15 5123456', '5493425123456', 'con 0 y 15, formato local'],
    ['011 15 51234567', '5491151234567', 'código de área de 2 dígitos'],
    ['(0342) 512-3456', '5493425123456', 'con paréntesis y guiones'],
    ['+54 9 342 5123456', '5493425123456', 'ya internacional'],
    ['005493425123456', '5493425123456', 'con 00 delante'],
  ])('%s → %s (%s)', (entrada, esperado) => {
    expect(normalizarTelefono(entrada)).toBe(esperado)
  })

  it('devuelve null cuando no hay número usable', () => {
    // Mejor abrir WhatsApp sin destinatario que abrir un chat con un número
    // inventado a partir de basura.
    expect(normalizarTelefono('')).toBeNull()
    expect(normalizarTelefono(null)).toBeNull()
    expect(normalizarTelefono('sin teléfono')).toBeNull()
    expect(normalizarTelefono('1234')).toBeNull()
  })

  it('no le agrega el 9 dos veces a un número que ya lo tiene', () => {
    expect(normalizarTelefono('93425123456')).toBe('5493425123456')
  })
})

describe('armarTextoPedido', () => {
  const items = [
    { nombre: 'Whey 1kg', cantidad: 3, marca: 'Star', costo: 10000 },
    { nombre: 'Creatina 300g', cantidad: 2, marca: 'Star', costo: 8000 },
    { nombre: 'Shaker', cantidad: 5, marca: 'ENA', costo: 1000 },
  ]

  it('agrupa por marca, que es como lo lee el proveedor', () => {
    const texto = armarTextoPedido({ items })

    expect(texto).toContain('*Star*')
    expect(texto).toContain('*ENA*')
    expect(texto.indexOf('Whey 1kg')).toBeGreaterThan(texto.indexOf('*Star*'))
    expect(texto.indexOf('Shaker')).toBeGreaterThan(texto.indexOf('*ENA*'))
  })

  it('sin precios no filtra los costos de compra', () => {
    // Mandarle al proveedor lo que le pagamos a otro proveedor es un problema
    // comercial, no un detalle de formato.
    const texto = armarTextoPedido({ items, conPrecios: false })

    expect(texto).not.toContain('10.000')
    expect(texto).not.toContain('Total estimado')
    expect(texto).toContain('Whey 1kg — 3 u.')
  })

  it('con precios incluye el subtotal por línea y el total', () => {
    const texto = armarTextoPedido({ items, conPrecios: true })

    expect(texto).toContain('($30.000)')
    expect(texto).toContain('Total estimado: $51.000')
  })

  it('los productos sin marca no desaparecen', () => {
    const texto = armarTextoPedido({ items: [{ nombre: 'Suelto', cantidad: 1 }] })

    expect(texto).toContain('*Sin marca*')
    expect(texto).toContain('Suelto — 1 u.')
  })

  it('incluye proveedor y nota cuando están', () => {
    const texto = armarTextoPedido({
      items,
      proveedor: 'Distribuidora Norte',
      nota: 'Entregar por la mañana',
    })

    expect(texto).toContain('Proveedor: Distribuidora Norte')
    expect(texto).toContain('Entregar por la mañana')
  })

  it('un pedido vacío no genera un texto engañoso', () => {
    const texto = armarTextoPedido({ items: [], conPrecios: true })

    expect(texto).not.toContain('Total estimado')
  })
})
