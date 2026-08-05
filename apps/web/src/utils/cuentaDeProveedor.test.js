import { describe, it, expect } from 'vitest'
import { ETIQUETAS, estadoDeProveedor, tonoDeProveedor } from './cuentaDeProveedor'

// Las cuatro combinaciones de la tabla «Los cuatro estados de un proveedor»
// (spec, `:353-358`). Cada `it` dice qué badge equivocado evita, porque el
// badge es lo único que el dueño mira antes de decidir si le paga a alguien.

describe('los cuatro estados de la tabla', () => {
  // Un proveedor recién cargado tiene los tres números en cero. Si el estado se
  // decidiera solo por el saldo, diría «Saldado» —o «Con deuda»— sobre una
  // cuenta en la que nunca pasó nada.
  it('un proveedor sin un solo movimiento NO dice Saldado ni Con deuda', () => {
    const estado = estadoDeProveedor({ deuda: 0, pagado: 0, saldo: 0 })

    expect(estado).toBe('sin_movimientos')
    expect(ETIQUETAS[estado]).toBe('Sin movimientos')
  })

  // El caso contrario del anterior: le compré y le pagué todo. Un saldo de $0
  // no distingue «nunca le compré» de «le compré y le pagué», y por eso el
  // estado mira también la deuda (US5 escenario 6).
  it('una cuenta comprada y pagada dice Saldado y NO Sin movimientos', () => {
    const estado = estadoDeProveedor({ deuda: 8500, pagado: 8500, saldo: 0 })

    expect(estado).toBe('saldado')
    expect(ETIQUETAS[estado]).toBe('Saldado')
  })

  // Con un pago a cuenta el proveedor sigue teniendo saldo, pero no es lo mismo
  // que no haber pagado nada: pintarlo de rojo manda a llamar a alguien a quien
  // ya se le transfirió la mitad.
  it('una deuda con un pago a cuenta dice Pago parcial y NO Con deuda', () => {
    const estado = estadoDeProveedor({ deuda: 10000, pagado: 4000, saldo: 6000 })

    expect(estado).toBe('pago_parcial')
    expect(ETIQUETAS[estado]).toBe('Pago parcial')
  })

  it('una deuda sin ningún pago dice Con deuda y NO Pago parcial', () => {
    const estado = estadoDeProveedor({ deuda: 10000, pagado: 0, saldo: 10000 })

    expect(estado).toBe('con_deuda')
    expect(ETIQUETAS[estado]).toBe('Con deuda')
  })

  it('los cuatro estados de la tabla tienen etiqueta, y ninguno más', () => {
    // Si mañana aparece un quinto estado sin su texto, el badge dibujaría el
    // código crudo —`pago_parcial`— y nadie lo vería hasta la captura de
    // pantalla de un cliente. Es lo que pasó con `tc3` en los comprobantes.
    expect(Object.keys(ETIQUETAS).sort()).toEqual([
      'con_deuda',
      'pago_parcial',
      'saldado',
      'sin_movimientos',
    ])
  })
})

describe('el cero y el negativo del saldo', () => {
  // Criterio de éxito 8: el badge cuelga de que el cero sea cero de verdad. Con
  // la condición escrita `saldo < 0`, una cuenta cancelada al peso quedaría
  // fuera de «Saldado» y caería en «Pago parcial».
  it('un saldo que se compensa exactamente dice Saldado y no Con deuda', () => {
    const estado = estadoDeProveedor({ deuda: 1234.56, pagado: 1234.56, saldo: 0 })

    expect(estado).toBe('saldado')
    expect(ETIQUETAS[estado]).toBe('Saldado')
  })

  // US6 escenario 6: pagué de más, el proveedor me debe a mí. Eso no es un
  // error de datos y no puede pintarse como una deuda pendiente.
  it('un saldo negativo por adelanto sigue diciendo Saldado', () => {
    const estado = estadoDeProveedor({ deuda: 10000, pagado: 15000, saldo: -5000 })

    expect(estado).toBe('saldado')
    expect(ETIQUETAS[estado]).toBe('Saldado')
  })

  // US6 escenario 7: Postgres devuelve DECIMAL como texto y Sequelize lo pasa
  // tal cual. `'0.00' === 0` es false, pero `'0.00' <= 0` es true por
  // coerción: sin la conversión explícita, un proveedor recién cargado se
  // pintaría de verde diciendo «Saldado».
  it('un DECIMAL que llega como string NO convierte una cuenta vacía en Saldado', () => {
    expect(estadoDeProveedor({ deuda: '0.00', pagado: '0.00', saldo: '0.00' }))
      .toBe('sin_movimientos')

    expect(estadoDeProveedor({ deuda: '10000.00', pagado: '4000.00', saldo: '6000.00' }))
      .toBe('pago_parcial')
  })
})

describe('el tono del badge', () => {
  // Las veintidós familias de la paleta de Tailwind con su escala, el mismo
  // patrón que usa `tests/guardiasDeDiseno.test.js`. Un `text-red-500` es un
  // `#ef4444` escrito de otra forma: un color que no existe en el sistema y que
  // en modo oscuro queda igual que en claro.
  const PALETA =
    /\b(?:text|bg|border|ring|from|via|to|fill|stroke|divide|accent|caret|placeholder|outline|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/

  it.each(Object.keys(ETIQUETAS))('ningún tono sale de un color suelto: %s', (estado) => {
    const tono = tonoDeProveedor(estado)

    // Las tres clases van JUNTAS: texto de color sin fondo suave ni línea es
    // justamente «un color suelto», y se lee como un error de estilo.
    expect(tono).toMatch(/\bborder-\S+/)
    expect(tono).toMatch(/\bbg-\S+/)
    expect(tono).toMatch(/\btext-\S+/)

    expect(tono).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(tono).not.toMatch(PALETA)
  })

  it('los cuatro estados NO comparten el mismo tono', () => {
    // Cuatro badges iguales es no tener badge: el color es lo que se lee de
    // lejos, antes que el texto.
    const tonos = Object.keys(ETIQUETAS).map(tonoDeProveedor)

    expect(new Set(tonos).size).toBe(4)
  })

  // Un `className` con `undefined` adentro deja el badge sin pintar y, según
  // dónde caiga, rompe la fila entera.
  it('un estado desconocido NO devuelve undefined', () => {
    expect(tonoDeProveedor('inventado')).toBe(tonoDeProveedor('sin_movimientos'))
    expect(tonoDeProveedor(undefined)).toBe(tonoDeProveedor('sin_movimientos'))
  })
})
