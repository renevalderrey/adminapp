import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { printInvoice } from './printInvoice'

// ════════════════════════════════════════════
//  FAVALIO · Lo que sale IMPRESO, que es lo que le queda al cliente
//
//  `printInvoice` abre una ventana y le escribe HTML, así que lo que imprime no
//  se lee de ningún lado: en jsdom `window.open` devuelve `null` y la función se
//  va por la primera línea. Acá se dobla la ventana con una que guarda lo que le
//  escriben, que es la única forma de afirmar qué terminó en el papel.
//
//  ── El caso que sostiene toda la 016 ──
//
//  `sale_items.quantity` pasó de `INTEGER` a `NUMERIC(14,4)` y `pg` devuelve un
//  `NUMERIC` como texto con la escala puesta: `GET /api/sales/:id` contesta
//  `"3.0000"`. El comprobante impreso es el criterio de éxito 1 de la spec:
//  tiene que decir «3 x Creatina» y no «3.0000 x Creatina».
// ════════════════════════════════════════════

/** Todo lo que se escribió en la ventana de impresión, concatenado. */
let escrito = ''

beforeEach(() => {
  escrito = ''

  vi.spyOn(window, 'open').mockImplementation(() => ({
    document: {
      write: (html) => { escrito += html },
      close: () => {},
    },
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Imprime un comprobante interno —sin QR, que no hace falta acá— y devuelve el HTML. */
async function imprimir(items) {
  await printInvoice({
    isInternal: true,
    typeStr: 'COMPROBANTE',
    voucherNumber: 'A1B2C3',
    date: '15/08/2026, 10:30',
    items,
    total: 4500,
    empresa: { name: 'Comprafit' },
  })

  return escrito
}

describe('el comprobante impreso escribe la cantidad como se escribía antes de migrar', () => {
  it('NO imprime «3.0000 x Creatina»', async () => {
    // El nombre es el caso. Tres unidades de creatina, tal como las devuelve la
    // API con la columna ya en `NUMERIC(14,4)`.
    const html = await imprimir([{ quantity: '3.0000', product_name: 'Creatina', unit_price: '1500.00' }])

    expect(html).toContain('3 x Creatina')
    expect(html).not.toContain('3.0000 x Creatina')
  })

  it('un entero que llega como número se sigue imprimiendo igual que siempre', async () => {
    // US4: el ticket de una venta normal tiene que verse carácter por carácter
    // como el de ayer.
    const html = await imprimir([{ qty: 2, name: 'Colágeno', price: 3000 }])

    expect(html).toContain('2 x Colágeno')
  })

  it('una cantidad fraccionaria lleva COMA y no punto: «9,6 x Harina», nunca «9.6 x Harina»', async () => {
    // ⚠ Éste es el caso que distingue la corrección, y por eso está escrito
    // aparte del de arriba.
    //
    // `normalizarLinea` ya hacía `Number(item.quantity)`, así que el `"3.0000"`
    // del test anterior se imprimía «3» **con y sin** esta corrección: ese caso
    // documenta el criterio de éxito, no lo protege. Lo que sí cambia es el
    // decimal, que producción empieza a dejar en cuanto la columna lo permite:
    // en es-AR el punto es el separador de MILES, así que «9.6» se lee nueve mil
    // seiscientos.
    const html = await imprimir([{ quantity: '9.6000', product_name: 'Harina', unit_price: '800.00' }])

    expect(html).toContain('9,6 x Harina')
    expect(html).not.toContain('9.6 x Harina')
  })

  it('sin cantidad legible imprime «0» y no «NaN x Producto»', async () => {
    // Un «NaN» en el papel del cliente es peor que un cero: manda a discutir el
    // comprobante en el mostrador.
    const html = await imprimir([{ quantity: null, product_name: 'Barrita', unit_price: '500' }])

    expect(html).toContain('0 x Barrita')
    expect(html).not.toContain('NaN')
  })
})
