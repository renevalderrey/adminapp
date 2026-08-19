import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '@/services/api'
import Reports from '@/pages/Reports'

// ════════════════════════════════════════════
//  FAVALIO · Reportes, las dos columnas de cantidad (016)
//
//  Son dos celdas que se parecen y NO entran por el mismo motivo. Está escrito
//  al lado de cada una en el fuente y se repite acá porque es lo que hace que
//  los dos casos de abajo sean dos y no uno:
//
//   · **Inventario** es la regresión del día de la migración:
//     `routes/reports.js:95` devuelve `stock.quantity` cruda, y con la columna
//     en `NUMERIC(14,4)` `pg` la entrega como `"12.0000"`.
//   · **Ventas** no lo es: `routes/reports.js:39` ya hace `parseFloat`, así que
//     ahí siempre llegó un número. Entra por FR-034a, porque un 9,6 se dibujaba
//     «9.6» y en es-AR el punto es el separador de MILES.
//
//  ⚠ Se espía la instancia de axios y no se mockea `@/services/api` entero:
//  `getSalesReport` y `getInventoryReport` son dos de más de cien exportaciones
//  nombradas y la lista se desactualiza sola.
// ════════════════════════════════════════════

const VENTAS = {
  summary: { total_sales: 45000, total_cost: 20000, gross_profit: 25000, margin_pct: 55, sale_count: 2 },
  items: [
    {
      date: '2026-08-14', sale_id: 'A1B2', product_name: 'Creatina',
      quantity: 3, unit_price: 1500, cost: 1000, margin: 500, margin_pct: 33,
    },
  ],
}

const INVENTARIO = {
  total_value: 120000,
  items: [
    // ⚠ Como TEXTO: es lo que devuelve el endpoint con la columna migrada. Con
    // un número, el caso pasaría con y sin la corrección.
    { product_name: 'Creatina', sku: 'CRE-300', location: 'centro', quantity: '12.0000', cost: 1000, total_value: 12000 },
  ],
}

/**
 * Monta la pantalla con los dos reportes doblados.
 *
 * @param {object} [datos] Permite pisar las cantidades sin repetir la fixture.
 */
async function montar({ ventas = VENTAS, inventario = INVENTARIO } = {}) {
  vi.spyOn(api, 'get').mockImplementation((url) => {
    if (String(url).includes('/reports/inventory')) {
      return Promise.resolve({ data: { ok: true, data: inventario } })
    }
    if (String(url).includes('/reports/sales')) {
      return Promise.resolve({ data: { ok: true, data: ventas } })
    }
    return Promise.resolve({ data: { ok: true, data: {} } })
  })

  await act(async () => { render(<Reports />) })
  await act(async () => {})
}

/** La fila de la tabla que tiene ese producto. */
const filaDe = (producto) => screen.getByText(producto).closest('tr')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('el reporte de INVENTARIO escribe el stock como antes de migrar', () => {
  async function abrirInventario() {
    await montar()

    // El clic va sin envolver en `act`: `user-event` ya lo hace por dentro y
    // anidarlos hace que React imprima «The current testing environment is not
    // configured to support act(...)» en cada prueba. Una suite que imprime
    // ruido en verde es una que nadie lee cuando se pone en rojo.
    await userEvent.click(screen.getByRole('button', { name: 'Inventario' }))
    await act(async () => {})
  }

  it('NO dibuja «12.0000» en la columna de stock', async () => {
    await abrirInventario()

    const celdas = within(filaDe('Creatina')).getAllByRole('cell')

    // La cuarta celda es Stock: Producto, SKU, Ubicación, Stock…
    expect(celdas[3].textContent).toBe('12')
  })

  it('un stock fraccionario lleva coma: «9,6» y no «9.6»', async () => {
    await montar({
      inventario: {
        ...INVENTARIO,
        items: [{ ...INVENTARIO.items[0], quantity: '9.6000' }],
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Inventario' }))
    await act(async () => {})

    const celdas = within(filaDe('Creatina')).getAllByRole('cell')

    expect(celdas[3].textContent).toBe('9,6')
  })
})

describe('el reporte de VENTAS escribe la cantidad con coma', () => {
  it('un entero se sigue viendo igual que hoy', async () => {
    // US4: con datos enteros la pantalla se ve carácter por carácter como
    // antes. La pestaña de ventas es la que abre por defecto.
    await montar()

    const celdas = within(filaDe('Creatina')).getAllByRole('cell')

    // Fecha, Venta, Producto, Cant…
    expect(celdas[3].textContent).toBe('3')
  })

  it('una cantidad fraccionaria dice «9,6» y NUNCA «9.6»', async () => {
    // FR-034a. Acá no hubo regresión —el endpoint ya hacía `parseFloat`— pero
    // «9.6» en una columna de números argentinos se lee nueve mil seiscientos.
    await montar({
      ventas: { ...VENTAS, items: [{ ...VENTAS.items[0], quantity: 9.6 }] },
    })

    const celdas = within(filaDe('Creatina')).getAllByRole('cell')

    expect(celdas[3].textContent).toBe('9,6')
    expect(celdas[3].textContent).not.toBe('9.6')
  })
})
