import { describe, it, expect } from 'vitest'
import { variacionPorcentual } from '../components/HistorialDeCostos.jsx'

// ════════════════════════════════════════════
//  La variación de costo se calcula con números, no con strings
//
//  `old_cost` y `new_cost` son `DECIMAL(12,2)` y el driver de Postgres los
//  devuelve como **string**. La resta funciona por coerción —`"1380.00" -
//  "1200.00"` da 180— así que el bug no se ve: aparece el día que alguien suma
//  dos de estos valores para un promedio o un total, y ahí `"1380.00" +
//  "1200.00"` da `"1380.001200.00"`.
//
//  Estos tests fijan que la conversión ocurre acá adentro, y no que el llamador
//  se acuerde de hacerla.
//
//  ⚠ Lo que estos tests NO cubren: el render. No hay entorno de render en este
//  proyecto —`jsdom` y `@testing-library` no están instalados— así que el color
//  del badge, el signo, el «ver más» y el autor vacío se verifican mirando la
//  pantalla, no acá.
// ════════════════════════════════════════════

describe('variacionPorcentual', () => {
  it('calcula la suba con los costos que llegan como STRING del DECIMAL', () => {
    expect(variacionPorcentual('1200.00', '1380.00')).toBeCloseTo(15, 5)
  })

  it('calcula la baja como número negativo', () => {
    expect(variacionPorcentual('1000.00', '900.00')).toBeCloseTo(-10, 5)
  })

  it('da lo mismo con números que con strings', () => {
    // Si en algún momento la conversión se saca, este es el test que lo detecta
    // antes de que el bug salga por el lado de una suma.
    expect(variacionPorcentual(1200, 1380)).toBe(variacionPorcentual('1200.00', '1380.00'))
  })

  it('NO devuelve infinito cuando el costo anterior era cero', () => {
    // Pasar de $0 a $1.200 no es «un aumento del infinito por ciento»: es cargar
    // el costo por primera vez. `Infinity` en la celda se lee como un error.
    expect(variacionPorcentual(0, 1200)).toBeNull()
    expect(variacionPorcentual('0.00', '1200.00')).toBeNull()
  })

  it('un costo ilegible devuelve null y no NaN', () => {
    // `NaN` en la celda se propaga: `NaN.toFixed(1)` es «NaN» y el usuario lee
    // una palabra en inglés donde esperaba un porcentaje.
    expect(variacionPorcentual(null, 1200)).toBeNull()
    expect(variacionPorcentual('mil doscientos', 1200)).toBeNull()
    expect(variacionPorcentual(1200, undefined)).toBeNull()
  })

  it('sin cambio devuelve 0 y no null: el cambio existió aunque no movió nada', () => {
    expect(variacionPorcentual('1200.00', '1200.00')).toBe(0)
  })
})
