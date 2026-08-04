import { describe, it, expect } from 'vitest'
import { comparacionDelReintento } from './reintentoDeVenta'

// ════════════════════════════════════════════
//  ADMINAPP · El reintento que trae otra venta
//
//  Es plata y es stock: lo que esta función decide es si un `200 { yaRegistrada:
//  true }` se puede tratar como éxito silencioso. Decir que sí cuando no
//  corresponde entrega mercadería que nadie descontó; decir que no cuando sí
//  corresponde rompe la idempotencia que el hito 5 vino a construir.
//
//  Por eso van los dos lados, y los casos de borde de CONVENCIONES: cantidad
//  cero, precio cero, línea de más, línea de menos, total sin líneas.
// ════════════════════════════════════════════

/** Como las manda el servidor: `quantity` y `unit_price`. */
const item = (product_id, product_name, quantity, unit_price) =>
  ({ product_id, product_name, quantity, unit_price })

/** Como las tiene el ticket: `qty` y `price`. */
const linea = (id, name, qty, price) => ({ id, name, qty, price })

describe('Un reintento que coincide sigue siendo un éxito silencioso', () => {
  it('el mismo ticket, con el DECIMAL del servidor como string, coincide', () => {
    // Es el caso para el que se construyó la idempotencia: la red se cortó
    // después del commit y el operador reintenta SIN tocar nada. Romper esto
    // sería peor que el defecto que la comparación viene a evitar.
    const r = comparacionDelReintento(
      { total: '1500.00', items: [item(10, 'Colágeno 300g', 1, '1500.00')] },
      { lineas: [linea(10, 'Colágeno 300g', 1, 1500)], total: 1500 }
    )

    expect(r.coincide).toBe(true)
    expect(r.diferencias).toEqual([])
  })

  it('un ticket SIN líneas contra una venta sin líneas coincide', () => {
    const r = comparacionDelReintento({ total: '0.00', items: [] }, { lineas: [], total: 0 })

    expect(r.coincide).toBe(true)
  })

  it('un centavo de arrastre por línea NO cuenta como diferencia', () => {
    // El navegador redondea para mostrar y el servidor tolera 0,02 + 0,01 por
    // línea (`calculosVenta.js:60`). Si el servidor aceptó ese total como
    // coincidente, la pantalla no puede después decir que no coincide por lo
    // mismo: sería un ticket bloqueado por un centavo.
    const r = comparacionDelReintento(
      { total: '1500.00', items: [item(10, 'Colágeno 300g', 1, 1500)] },
      { lineas: [linea(10, 'Colágeno 300g', 1, 1500)], total: 1500.01 }
    )

    expect(r.coincide).toBe(true)
  })

  it('un ticket con una línea REGALADA —precio 0— coincide igual', () => {
    // Precio cero es un precio legítimo: un descuento de alianza del 100 %. No
    // puede leerse como «falta el dato».
    const r = comparacionDelReintento(
      { total: '0.00', items: [item(10, 'Colágeno 300g', 1, 0)] },
      { lineas: [linea(10, 'Colágeno 300g', 1, 0)], total: 0 }
    )

    expect(r.coincide).toBe(true)
  })
})

describe('Un reintento que NO coincide se dice con nombres y números', () => {
  it('el caso real: se subió la cantidad entre el corte de red y el reintento', () => {
    // 1 unidad cobrada, la red se corta después del commit, el cliente pide
    // dos, se vuelve a cobrar con el mismo id. Se entregan 2, se descontó 1.
    const r = comparacionDelReintento(
      { total: '1500.00', items: [item(10, 'Colágeno 300g', 1, 1500)] },
      { lineas: [linea(10, 'Colágeno 300g', 2, 1500)], total: 3000 }
    )

    expect(r.coincide).toBe(false)
    expect(r.diferencias).toContain('«Colágeno 300g»: se registraron 1 y el ticket lleva 2.')
    expect(r.diferencias).toContain('El total registrado es $1.500,00 y el del ticket $3.000,00.')
  })

  it('una línea agregada después del corte se nombra como NO registrada', () => {
    const r = comparacionDelReintento(
      { total: '1500.00', items: [item(10, 'Colágeno 300g', 1, 1500)] },
      {
        lineas: [linea(10, 'Colágeno 300g', 1, 1500), linea(11, 'Creatina 300g', 1, 3000)],
        total: 4500,
      }
    )

    expect(r.coincide).toBe(false)
    expect(r.diferencias).toContain('«Creatina 300g»: está en el ticket y NO quedó registrada.')
  })

  it('una línea borrada después del corte se nombra igual: salió del inventario', () => {
    // Es la mitad que se olvida. El producto se descontó del stock y no se va a
    // entregar, y eso también hay que verlo.
    const r = comparacionDelReintento(
      {
        total: '4500.00',
        items: [item(10, 'Colágeno 300g', 1, 1500), item(11, 'Creatina 300g', 1, 3000)],
      },
      { lineas: [linea(10, 'Colágeno 300g', 1, 1500)], total: 1500 }
    )

    expect(r.coincide).toBe(false)
    expect(r.diferencias).toContain('«Creatina 300g»: quedó registrada y ya no está en el ticket.')
  })

  it('un precio puesto a mano después del corte NO pasa por coincidente', () => {
    // Los $18.000 negociados con el cliente no se registraron: quedó el de
    // lista. El total lo delata, pero el precio por línea es lo que dice qué
    // pasó.
    const r = comparacionDelReintento(
      { total: '20000.00', items: [item(10, 'Colágeno 300g', 1, 20000)] },
      { lineas: [linea(10, 'Colágeno 300g', 1, 18000)], total: 18000 }
    )

    expect(r.coincide).toBe(false)
    expect(r.diferencias).toContain(
      '«Colágeno 300g»: se registró a $20.000,00 y el ticket dice $18.000,00.'
    )
  })

  it('el importe se escribe en formato argentino, no 1,234.50', () => {
    // Leerlo al revés convierte $1.234 en $1,234 y no falla nada.
    const r = comparacionDelReintento(
      { total: '1234.50', items: [] },
      { lineas: [], total: 9999 }
    )

    expect(r.diferencias.join(' ')).toContain('$1.234,50')
  })
})

describe('Lo que no se puede verificar NO es coincidente', () => {
  it('una respuesta SIN items no se trata como el mismo ticket', () => {
    // Es la regla entera: dar por bueno lo que no se puede comparar es el
    // defecto. Antes de esta corrección el servidor devolvía solo la cabecera,
    // así que este era el único caso posible.
    const r = comparacionDelReintento(
      { total: '1500.00' },
      { lineas: [linea(10, 'Colágeno 300g', 1, 1500)], total: 1500 }
    )

    expect(r.coincide).toBe(false)
    expect(r.diferencias[0]).toMatch(/no devolvió las líneas/)
  })

  it('una respuesta vacía tampoco', () => {
    expect(comparacionDelReintento().coincide).toBe(false)
  })
})
