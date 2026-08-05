import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pesos, fechaCorta } from './formato'

// ════════════════════════════════════════════
//  Los dos errores que no hacen fallar nada
//
//  Un importe mal formateado y una fecha corrida un día no rompen ninguna
//  pantalla: abren, se ven bien, y dicen otra cosa. Por eso los dos van
//  testeados con el número exacto y no con un `toMatch`.
// ════════════════════════════════════════════

describe('pesos escribe siempre dos decimales', () => {
  it('un importe entero se ve $1.234,00 y no $1.234', () => {
    // `toLocaleString('es-AR')` sin opciones —lo que hace hoy `Orders.jsx:302`—
    // devuelve «1.234» para el entero y «1.234,5» para el de un decimal: tres
    // formatos distintos en la misma columna.
    expect(pesos(1234)).toBe('1.234,00')
  })

  it('NO deja tres decimales', () => {
    // El defecto de `PurchaseOrders.jsx:156`, que fija el mínimo y no el
    // máximo: sin `maximumFractionDigits` el valor por defecto es 3 y esto sale
    // «1.234,567».
    expect(pesos(1234.567)).toBe('1.234,57')
  })

  it('cero y null dan 0,00 y no NaN', () => {
    // `undefined` y `NaN` entran por el mismo camino: los cuatro son falsy y
    // caen en el cero. Un «NaN» dibujado en una columna de plata parece un
    // error de carga.
    expect(pesos(0)).toBe('0,00')
    expect(pesos(null)).toBe('0,00')
    expect(pesos(undefined)).toBe('0,00')
    expect(pesos(NaN)).toBe('0,00')
  })
})

describe('fechaCorta no corre el día', () => {
  it('el primero de mes NO se corre un día', () => {
    // `new Date('2026-08-01')` se interpreta en UTC y en Argentina (UTC−3) es
    // el 31 de julio a las 21: el movimiento del primero de agosto se leería en
    // el mes anterior del estado de cuenta.
    expect(fechaCorta('2026-08-01')).toBe('01/08/2026')
    expect(fechaCorta('2026-08-01')).not.toBe('31/07/2026')
  })

  it('un timestamp completo se recorta a su fecha y tampoco se corre', () => {
    // La API manda `DATEONLY` en unos endpoints y timestamps en otros; los dos
    // empiezan igual y el corte es por posición, no por parseo.
    expect(fechaCorta('2026-08-01T02:00:00.000Z')).toBe('01/08/2026')
  })

  it('una fecha con forma inválida devuelve el texto y no Invalid Date', () => {
    // Si la API cambia el formato se quiere ver qué mandó. «Invalid Date» no
    // dice nada y manda a buscar el problema al lugar equivocado.
    expect(fechaCorta('01/08/2026')).toBe('01/08/2026')
    expect(fechaCorta('sin fecha')).toBe('sin fecha')
    expect(fechaCorta(null)).toBe('—')
    expect(fechaCorta('')).toBe('—')
  })
})

// ════════════════════════════════════════════
//  Guardia · la copia no vuelve
//
//  Sin esto, la próxima persona que necesite formatear un importe adentro del
//  panel escribe las cuatro líneas en el archivo en vez de importar nada — que
//  es cómo llegó a haber siete `pesos` distintos, tres de ellos sin el máximo
//  de decimales.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const PANEL_VENTA = fs.readFileSync(path.join(AQUI, '../components/PanelVenta.jsx'), 'utf8')

describe('PanelVenta usa la fuente compartida', () => {
  it('PanelVenta NO tiene su propia copia de pesos', () => {
    expect(PANEL_VENTA).not.toMatch(/const\s+pesos\s*=/)
    expect(PANEL_VENTA).not.toMatch(/function\s+fechaCorta\b/)
  })

  it('PanelVenta importa las dos de utils/formato', () => {
    // Sin esta mitad, borrar la copia y dejar el archivo sin formatear nada
    // también pasaría la guardia de arriba.
    expect(PANEL_VENTA).toMatch(/import\s*\{[^}]*\bpesos\b[^}]*\}\s*from\s*'@\/utils\/formato'/)
    expect(PANEL_VENTA).toMatch(/import\s*\{[^}]*\bfechaCorta\b[^}]*\}\s*from\s*'@\/utils\/formato'/)
  })

  it('la guardia leyó el archivo de verdad y no una cadena vacía', () => {
    // Una guardia con la ruta equivocada compara contra vacío y pasa siempre.
    expect(PANEL_VENTA.length).toBeGreaterThan(2000)
  })
})
