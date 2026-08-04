/**
 * @vitest-environment node
 *
 * La suite corre entera en jsdom (`vite.config.js`), y este archivo es la
 * excepción: su última prueba —«sin navegador tampoco explota»— verifica el
 * camino en el que `window` NO existe. Bajo jsdom `window` existe, así que ese
 * test pasaría sin probar lo que dice su nombre y `window.open` de jsdom
 * ensuciaría la salida con un «Not implemented».
 */
import { describe, it, expect, vi } from 'vitest'
import { armarHtml, totalesDeImpresion, imprimirInventario } from './impresionInventario'

// ════════════════════════════════════════════
//  La hoja de impresión del inventario
//
//  El test que da sentido al archivo es el último: **la ventana bloqueada**.
//  `utils/printInvoice.js:94` hace `if (!printWindow) return;`, así que con el
//  bloqueador de emergentes activo el usuario aprieta «Imprimir» y no pasa nada
//  —ni la hoja, ni un error, ni una explicación—. Es lo que FR-135 prohíbe y lo
//  que estaba a punto de copiarse por inercia.
// ════════════════════════════════════════════

const SUCURSALES = [
  { id: 3, name: 'Centro', is_active: true },
  { id: 7, name: 'Depósito', is_active: false },
]

const SETTINGS = { margin_efectivo: 50, recargo_tarjeta: 0, descuento_alianza: 0 }

const PRODUCTO = (campos = {}) => ({
  id: 1,
  name: 'Colágeno 300g',
  sku: '0012345',
  category: 'colageno',
  brand: { name: 'ENA' },
  cost: '1200.00',
  stock: [{ punto_de_venta_id: 3, quantity: 12, min_stock: 4 }],
  ...campos,
})

describe('armarHtml · lo que hace que la hoja salga bien', () => {
  it('lleva print-color-adjust: exact', () => {
    // Sin esto el navegador imprime los fondos en blanco «para ahorrar tinta» y
    // la hoja pierde justamente las marcas que dicen qué falta reponer.
    const html = armarHtml({ productos: [PRODUCTO()], sucursales: SUCURSALES, settings: SETTINGS })

    expect(html).toContain('print-color-adjust: exact')
  })

  it('ninguna fila se parte entre dos páginas', () => {
    const html = armarHtml({ productos: [PRODUCTO()], sucursales: SUCURSALES, settings: SETTINGS })

    expect(html).toContain('break-inside: avoid')
    expect(html).toContain('page-break-inside: avoid')
  })

  it('el encabezado dice la sucursal, la fecha y cuántos productos hay', () => {
    const html = armarHtml({
      productos: [PRODUCTO(), PRODUCTO({ id: 2 })],
      sucursales: SUCURSALES,
      nombreDeLaSucursal: 'Depósito',
      settings: SETTINGS,
      fecha: new Date(2026, 7, 3, 10, 0),
    })

    expect(html).toContain('Depósito')
    expect(html).toContain('2 productos')
  })

  it('sin filtro de sucursal dice «Todas las sucursales»', () => {
    const html = armarHtml({ productos: [PRODUCTO()], sucursales: SUCURSALES, settings: SETTINGS })

    expect(html).toContain('Todas las sucursales')
  })

  it('un producto sin costo dice «sin costo» y NO «$0,00»', () => {
    // $0 es un precio, y quien lo lee así lo vende gratis.
    const html = armarHtml({
      productos: [PRODUCTO({ cost: 0 })],
      sucursales: SUCURSALES,
      settings: SETTINGS,
    })

    expect(html).toContain('sin costo')
  })

  it('escapa el nombre del producto', () => {
    // «Pack 2<3» rompe la página; un `<script>` en el nombre hace algo peor.
    const html = armarHtml({
      productos: [PRODUCTO({ name: 'Pack 2<3 & "oferta"' })],
      sucursales: SUCURSALES,
      settings: SETTINGS,
    })

    expect(html).toContain('Pack 2&lt;3 &amp; &quot;oferta&quot;')
    expect(html).not.toContain('Pack 2<3')
  })

  it('marca la sucursal dada de baja en su columna', () => {
    const html = armarHtml({ productos: [PRODUCTO()], sucursales: SUCURSALES, settings: SETTINGS })

    expect(html).toContain('Depósito (inactiva)')
  })
})

describe('totalesDeImpresion · los mismos números que la pantalla', () => {
  const UMBRAL = 3

  it('cuenta los que están sin stock', () => {
    const totales = totalesDeImpresion([
      PRODUCTO(),
      PRODUCTO({ id: 2, stock: [{ punto_de_venta_id: 3, quantity: 0, min_stock: 0 }] }),
      PRODUCTO({ id: 3, stock: [] }),
    ], { umbral: UMBRAL })

    expect(totales.productos).toBe(3)
    expect(totales.sinStock).toBe(2)
  })

  it('cuenta el stock bajo con la misma regla que la pantalla', () => {
    // El de 12 con mínimo 4 no está bajo; el de 2 sin mínimo cae al umbral de 3
    // y sí lo está.
    const totales = totalesDeImpresion([
      PRODUCTO(),
      PRODUCTO({ id: 2, stock: [{ punto_de_venta_id: 3, quantity: 2, min_stock: 0 }] }),
    ], { umbral: UMBRAL })

    expect(totales.stockBajo).toBe(1)
  })

  it('un producto SIN ninguna fila de stock cuenta como bajo', () => {
    // No tener fila y tener cero es lo mismo para reponer.
    const totales = totalesDeImpresion([PRODUCTO({ stock: [] })], { umbral: UMBRAL })

    expect(totales.stockBajo).toBe(1)
  })

  it('con una sucursal elegida cuenta solo esa', () => {
    const enDeposito = PRODUCTO({
      stock: [
        { punto_de_venta_id: 3, quantity: 12, min_stock: 4 },
        { punto_de_venta_id: 7, quantity: 0, min_stock: 0 },
      ],
    })

    expect(totalesDeImpresion([enDeposito], { sucursalElegida: 7, umbral: UMBRAL }).sinStock).toBe(1)
    expect(totalesDeImpresion([enDeposito], { sucursalElegida: 3, umbral: UMBRAL }).sinStock).toBe(0)
  })

  it('los tres totales aparecen en el pie de la hoja', () => {
    const html = armarHtml({
      productos: [PRODUCTO(), PRODUCTO({ id: 2, stock: [] })],
      sucursales: SUCURSALES,
      settings: SETTINGS,
      umbral: UMBRAL,
    })

    expect(html).toContain('<strong>2</strong> productos')
    expect(html).toContain('<strong>1</strong> sin stock')
    expect(html).toContain('<strong>1</strong> en stock bajo')
  })
})

describe('imprimirInventario · la ventana bloqueada', () => {
  it('devuelve null cuando el navegador bloqueó la emergente', () => {
    // Devolverlo es lo que permite que la pantalla avise qué hacer. Tragárselo
    // —`if (!printWindow) return;`— deja al usuario apretando Imprimir sin que
    // pase nada.
    const resultado = imprimirInventario({ productos: [PRODUCTO()] }, () => null)

    expect(resultado).toBeNull()
  })

  it('con la ventana abierta escribe la hoja y manda a imprimir', () => {
    const ventana = {
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    }

    const resultado = imprimirInventario(
      { productos: [PRODUCTO()], sucursales: SUCURSALES, settings: SETTINGS },
      () => ventana
    )

    expect(resultado).toBe(ventana)
    expect(ventana.document.write).toHaveBeenCalledOnce()
    expect(ventana.document.write.mock.calls[0][0]).toContain('print-color-adjust: exact')
    expect(ventana.print).toHaveBeenCalledOnce()
  })

  it('sin navegador tampoco explota', () => {
    // El módulo se importa desde un test sin `window`: referenciarlo al cargar
    // el archivo rompería la suite entera.
    expect(() => imprimirInventario({ productos: [] })).not.toThrow()
  })
})
