import { describe, it, expect } from 'vitest'
import { sugerenciasDeVuelto, calcularVuelto } from './vuelto'

// ════════════════════════════════════════════
//  El vuelto: la cuenta que se hace veinte veces por día con la mano en la caja
//
//  Vivía adentro de un `useMemo` de `Billing.jsx` donde ningún test la
//  alcanzaba. FR-018 la daba por conservada y no había nada que lo garantizara.
// ════════════════════════════════════════════

describe('sugerenciasDeVuelto · con qué billete paga el cliente', () => {
  it('NO propone un billete que no alcanza para el total', () => {
    // Un importe menor al total no es una sugerencia: es entregar mal el
    // cambio con el botón puesto por el sistema.
    for (const total of [1, 999, 47300, 50001, 123456.78]) {
      for (const sugerencia of sugerenciasDeVuelto(total)) {
        expect([total, sugerencia, sugerencia > total]).toEqual([total, sugerencia, true])
      }
    }
  })

  it('con $47.300 propone $48.000, $50.000 y $60.000', () => {
    // ⚠ El comentario que acompañaba a esta función en `Billing.jsx` —y la
    // tarea T1109 que la mandó a mover— decían «$50.000, $60.000 y $100.000».
    // El código hace otra cosa desde siempre: el escalón de $1.000 produce
    // $48.000, que también es una cifra con la que alguien paga. Se conserva el
    // comportamiento porque FR-018 pide el bloque «tal como está hoy»; lo que
    // se corrigió fue el comentario. Este test fija los tres valores reales.
    expect(sugerenciasDeVuelto(47300)).toEqual([48000, 50000, 60000])
  })

  it('con total 0 no propone nada', () => {
    expect(sugerenciasDeVuelto(0)).toEqual([])
    expect(sugerenciasDeVuelto(-100)).toEqual([])
  })

  it('con un total que ya es un escalón exacto no propone ese mismo escalón', () => {
    // $50.000 no puede proponer $50.000: eso es «pagó justo» y no una
    // sugerencia. Ocupar un botón para no decir nada, en la pantalla donde se
    // cuentan los clics.
    for (const escalon of [1000, 5000, 10000, 20000, 50000, 100000]) {
      expect([escalon, sugerenciasDeVuelto(escalon).includes(escalon)]).toEqual([escalon, false])
    }

    expect(sugerenciasDeVuelto(50000)).toEqual([60000, 100000])
  })

  it('devuelve como mucho tres, ordenadas de menor a mayor y sin repetir', () => {
    for (const total of [1, 4321, 47300, 88888]) {
      const lista = sugerenciasDeVuelto(total)

      expect([total, lista.length <= 3]).toEqual([total, true])
      expect([total, lista]).toEqual([total, [...lista].sort((a, b) => a - b)])
      expect([total, new Set(lista).size]).toEqual([total, lista.length])
    }
  })

  it('un total que no es un número no propone nada y NO devuelve NaN', () => {
    for (const total of [undefined, null, '', 'x', NaN, Infinity]) {
      expect([String(total), sugerenciasDeVuelto(total)]).toEqual([String(total), []])
    }
  })
})

describe('calcularVuelto · vuelto o faltante, nunca un número negativo', () => {
  it('NO devuelve un vuelto negativo: devuelve cuánto falta', () => {
    // Escenario 5.10. La diferencia entre decirle al operador «−$3.200» y
    // decirle «faltan $3.200» es la diferencia entre interpretar un signo con
    // la mano en la caja y leer una frase.
    expect(calcularVuelto(47300, 50500)).toEqual({ vuelto: 0, falta: 3200 })
  })

  it('con lo justo, el vuelto es 0 y no falta nada', () => {
    expect(calcularVuelto(50000, 50000)).toEqual({ vuelto: 0, falta: 0 })
  })

  it('con un billete de más devuelve el vuelto y falta 0', () => {
    expect(calcularVuelto(50000, 47300)).toEqual({ vuelto: 2700, falta: 0 })
  })

  it('el campo vacío NO cuenta como que pagó, y tampoco devuelve NaN', () => {
    // «Paga con» se mantiene como texto para que pueda quedar vacío: un 0
    // obligaría a borrarlo antes de tipear.
    expect(calcularVuelto('', 47300)).toEqual({ vuelto: 0, falta: 47300 })
    expect(calcularVuelto(null, 47300)).toEqual({ vuelto: 0, falta: 47300 })
    expect(calcularVuelto(undefined, 47300)).toEqual({ vuelto: 0, falta: 47300 })
    expect(calcularVuelto('nada', 47300)).toEqual({ vuelto: 0, falta: 47300 })
  })

  it('los centavos se redondean al centavo y no arrastran cola binaria', () => {
    // 0.1 + 0.2 acá sería 0.30000000000000004 y se imprimiría entero.
    expect(calcularVuelto(50000.1, 47300.2)).toEqual({ vuelto: 2699.9, falta: 0 })
    expect(calcularVuelto(0.1, 0.3)).toEqual({ vuelto: 0, falta: 0.2 })
  })

  it('con el ticket vacío, lo que se entrega es todo vuelto', () => {
    expect(calcularVuelto(1000, 0)).toEqual({ vuelto: 1000, falta: 0 })
    expect(calcularVuelto(0, 0)).toEqual({ vuelto: 0, falta: 0 })
  })
})
