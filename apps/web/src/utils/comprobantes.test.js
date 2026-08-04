import { describe, it, expect } from 'vitest'
import { comprobantesDisponibles, comprobanteInicial, desglosarIva } from './comprobantes'

// ════════════════════════════════════════════
//  Lo que muestra el selector tiene que ser lo que se emite
//
//  El invariante de FR-061 se verifica acá, sobre las tres condiciones
//  fiscales, en tres líneas. Renderizado costaría tres montajes de la pantalla
//  entera, y es exactamente el defecto que se escapó: el estado decía `afip_c`
//  y la lista no tenía esa opción, así que se veía «Remito» y se emitía una
//  Factura C.
// ════════════════════════════════════════════

const CONDICIONES = ['RI', 'Monotributo', 'Exento']

describe('comprobantesDisponibles · qué puede emitir cada condición fiscal', () => {
  it('una empresa Exento NO se queda sin Factura C', () => {
    // La lista vieja la ofrecía solo con `'Monotributo'` exacto, mientras el
    // estado inicial ya decía `afip_c`.
    const lista = comprobantesDisponibles({ condicionFiscal: 'Exento', afipConfigurado: true })

    expect(lista.map((c) => c.valor)).toContain('afip_c')
  })

  it('el comprobante inicial SIEMPRE está en la lista, para las tres condiciones', () => {
    for (const condicionFiscal of CONDICIONES) {
      for (const afipConfigurado of [true, false]) {
        const lista = comprobantesDisponibles({ condicionFiscal, afipConfigurado })
        const inicial = comprobanteInicial(condicionFiscal)

        expect([condicionFiscal, afipConfigurado, lista.some((c) => c.valor === inicial)])
          .toEqual([condicionFiscal, afipConfigurado, true])
      }
    }
  })

  it('un Responsable Inscripto NO recibe la Factura C, y los otros NO reciben la A ni la B', () => {
    const ri = comprobantesDisponibles({ condicionFiscal: 'RI', afipConfigurado: true })
    expect(ri.map((c) => c.valor)).toEqual(['afip_b', 'afip_a', 'remito', 'recibo_x'])

    for (const condicionFiscal of ['Monotributo', 'Exento']) {
      const lista = comprobantesDisponibles({ condicionFiscal, afipConfigurado: true })
      expect([condicionFiscal, lista.map((c) => c.valor)])
        .toEqual([condicionFiscal, ['afip_c', 'remito', 'recibo_x']])
    }
  })

  it('sin AFIP configurado los fiscales quedan deshabilitados CON motivo, no ausentes', () => {
    // Un comprobante que no está no se puede pedir; uno deshabilitado que dice
    // por qué, sí. Y el aviso llega antes de cobrar, no después de haber
    // registrado la venta (FR-055).
    const lista = comprobantesDisponibles({ condicionFiscal: 'RI', afipConfigurado: false })

    const fiscales = lista.filter((c) => c.fiscal)
    expect(fiscales.map((c) => c.valor)).toEqual(['afip_b', 'afip_a'])
    expect(fiscales.every((c) => c.disponible === false)).toBe(true)
    expect(fiscales.every((c) => (c.motivo || '').length > 10)).toBe(true)
  })

  it('los internos NO dependen de AFIP: están y se pueden elegir siempre', () => {
    for (const condicionFiscal of CONDICIONES) {
      for (const afipConfigurado of [true, false]) {
        const internos = comprobantesDisponibles({ condicionFiscal, afipConfigurado })
          .filter((c) => !c.fiscal)

        expect(internos.map((c) => c.valor)).toEqual(['remito', 'recibo_x'])
        expect(internos.every((c) => c.disponible === true)).toBe(true)
      }
    }
  })

  it('sin condición fiscal cargada NO ofrece Factura A ni B', () => {
    // Una empresa recién creada todavía no eligió condición. Ofrecerle la A
    // sería ofrecerle emitir un comprobante que ARCA le va a rechazar.
    const lista = comprobantesDisponibles({ afipConfigurado: true })

    expect(lista.map((c) => c.valor)).toEqual(['afip_c', 'remito', 'recibo_x'])
  })
})

describe('desglosarIva · a quién se le muestra una línea de IVA', () => {
  it('un monotributista NO ve una línea de IVA que no cobró', () => {
    // `afipService` le manda `ImpIVA: 0`: mostrarle IVA es decirle que cobró
    // algo que no cobró.
    for (const condicionFiscal of ['Monotributo', 'Exento']) {
      for (const comprobante of ['afip_a', 'afip_b', 'afip_c', 'remito', 'recibo_x']) {
        expect([condicionFiscal, comprobante, desglosarIva({ total: 47300, condicionFiscal, comprobante })])
          .toEqual([condicionFiscal, comprobante, null])
      }
    }

    // Y un RI tampoco, si el comprobante es interno o una Factura C: el
    // servidor solo discrimina en los tipos 1, 3, 6 y 8.
    for (const comprobante of ['remito', 'recibo_x', 'afip_c']) {
      expect([comprobante, desglosarIva({ total: 47300, condicionFiscal: 'RI', comprobante })])
        .toEqual([comprobante, null])
    }
  })

  it('un RI con Factura A o B SÍ ve el desglose', () => {
    for (const comprobante of ['afip_a', 'afip_b']) {
      const desglose = desglosarIva({ total: 12100, condicionFiscal: 'RI', comprobante })

      expect([comprobante, desglose]).toEqual([comprobante, { neto: 10000, iva: 2100, alicuota: 21 }])
    }
  })

  it('el neto y el IVA suman exactamente el total', () => {
    // Casos de borde obligatorios de CONVENCIONES: total 0, total 1 y un total
    // con centavos que no divide redondo.
    //
    // La comparación es al centavo porque los decimales binarios no suman
    // exacto —0.83 + 0.17 no es 1 en punto flotante—, y esa es justamente la
    // razón por la que el IVA se calcula como `total − neto` y no como
    // `neto × 0,21`: así los dos números que se imprimen cierran.
    for (const total of [0, 1, 100, 47300, 47300.55, 0.01, 999999.99]) {
      const { neto, iva } = desglosarIva({ total, condicionFiscal: 'RI', comprobante: 'afip_b' })

      expect([total, Math.round((neto + iva) * 100) / 100]).toEqual([total, total])
      expect([total, neto >= 0 && iva >= 0]).toEqual([total, true])
    }
  })

  it('con total 0 el desglose existe y es cero, no null', () => {
    // `null` significa «esta empresa no discrimina IVA». Un ticket vacío de un
    // RI sí discrimina; lo que pasa es que todavía no hay importe.
    expect(desglosarIva({ total: 0, condicionFiscal: 'RI', comprobante: 'afip_a' }))
      .toEqual({ neto: 0, iva: 0, alicuota: 21 })
  })

  it('un total que no es un número NO devuelve NaN', () => {
    for (const total of [undefined, null, '', 'x', NaN]) {
      expect(desglosarIva({ total, condicionFiscal: 'RI', comprobante: 'afip_b' })).toBeNull()
    }
  })
})
