import { describe, it, expect } from 'vitest'
import {
  comprobantesDisponibles,
  comprobanteInicial,
  desglosarIva,
  datosDelComprador,
  detalleDeEmision,
  esFiscal,
  motivoParaNoEmitir,
  nombreDeComprobante,
} from './comprobantes'

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

// ════════════════════════════════════════════
//  Lo que el panel de emisión decide antes de hablar con ARCA
//
//  Los dos bloques son irreversibles por motivos distintos: emitir consume un
//  número correlativo que no se devuelve, y mostrar un IVA que el comprobante
//  no discrimina le dice al monotributista que cobró algo que no cobró.
// ════════════════════════════════════════════

describe('datosDelComprador · qué pide cada comprobante', () => {
  it('una Factura A exige el CUIT y NO deja elegir la condición', () => {
    const pedido = datosDelComprador('afip_a')

    expect(pedido.cuitObligatorio).toBe(true)
    expect(pedido.condicionFija).toBe('1')
    expect(pedido.pideCondicion).toBe(false)
  })

  it('una Factura B o C dejan el CUIT opcional y la condición abierta', () => {
    for (const comprobante of ['afip_b', 'afip_c']) {
      const pedido = datosDelComprador(comprobante)

      expect([comprobante, pedido.cuitObligatorio]).toEqual([comprobante, false])
      expect([comprobante, pedido.condicionFija]).toEqual([comprobante, null])
      expect([comprobante, pedido.pideCondicion]).toEqual([comprobante, true])
    }
  })

  it('los internos no son fiscales y lo dicen', () => {
    for (const comprobante of ['remito', 'recibo_x']) {
      expect([comprobante, datosDelComprador(comprobante).fiscal]).toEqual([comprobante, false])
      expect([comprobante, esFiscal(comprobante)]).toEqual([comprobante, false])
    }
  })

  it('cada comprobante tiene su nota, y ninguna queda vacía', () => {
    for (const comprobante of ['afip_a', 'afip_b', 'afip_c', 'remito', 'recibo_x']) {
      expect(datosDelComprador(comprobante).nota.length).toBeGreaterThan(20)
    }
  })
})

describe('motivoParaNoEmitir · el rechazo del servidor, dicho antes', () => {
  it('una Factura A sin CUIT no se puede emitir, y el motivo lo dice', () => {
    expect(motivoParaNoEmitir({ comprobante: 'afip_a', cuit: '' }))
      .toMatch(/11 dígitos/)
  })

  it('acepta el CUIT con guiones: lo que cuenta son los dígitos', () => {
    // Es lo que hace el servidor (`String(...).replace(/\D/g, '')`), y una
    // pantalla más estricta que la API rechaza ventas que la API aceptaría.
    expect(motivoParaNoEmitir({ comprobante: 'afip_a', cuit: '20-30405060-7' })).toBeNull()
  })

  it('diez dígitos NO alcanzan', () => {
    expect(motivoParaNoEmitir({ comprobante: 'afip_a', cuit: '2030405060' })).not.toBeNull()
  })

  it('los otros cuatro comprobantes no exigen nada', () => {
    for (const comprobante of ['afip_b', 'afip_c', 'remito', 'recibo_x']) {
      expect([comprobante, motivoParaNoEmitir({ comprobante, cuit: '' })])
        .toEqual([comprobante, null])
    }
  })
})

describe('detalleDeEmision · lo que se factura, producto por producto', () => {
  const LINEAS = [
    { id: 1, name: 'Whey 1kg', price: 38900, qty: 2 },
    { id: 2, name: 'Barra 46g', price: 2300, qty: 3 },
  ]

  it('el total y las unidades salen de las líneas', () => {
    const detalle = detalleDeEmision({
      lineas: LINEAS,
      condicionFiscal: 'Monotributo',
      comprobante: 'afip_c',
    })

    expect(detalle.total).toBe(84700)
    expect(detalle.unidades).toBe(5)
    expect(detalle.filas.map((f) => f.subtotal)).toEqual([77800, 6900])
  })

  it('una Factura C NO trae columnas de IVA', () => {
    // La maqueta las dibuja y es un error del dibujo: el servidor le manda
    // `ImpIVA: 0`. Es `null` y no 0 a propósito — un cero se lee como «IVA
    // cero», que es una afirmación fiscal.
    const detalle = detalleDeEmision({
      lineas: LINEAS,
      condicionFiscal: 'Monotributo',
      comprobante: 'afip_c',
    })

    expect(detalle.desglose).toBeNull()
    expect(detalle.filas.map((f) => f.neto)).toEqual([null, null])
    expect(detalle.filas.map((f) => f.iva)).toEqual([null, null])
  })

  it('un RI con Factura B sí las trae, y el desglose cierra contra el total', () => {
    const detalle = detalleDeEmision({
      lineas: LINEAS,
      condicionFiscal: 'RI',
      comprobante: 'afip_b',
    })

    expect(detalle.desglose.alicuota).toBe(21)
    expect(Math.round((detalle.desglose.neto + detalle.desglose.iva) * 100) / 100)
      .toBe(detalle.total)
    for (const fila of detalle.filas) {
      expect([fila.nombre, fila.neto > 0 && fila.iva > 0]).toEqual([fila.nombre, true])
    }
  })

  it('un ticket vacío no devuelve NaN', () => {
    const detalle = detalleDeEmision({ lineas: [], condicionFiscal: 'RI', comprobante: 'afip_b' })

    expect(detalle.total).toBe(0)
    expect(detalle.unidades).toBe(0)
    expect(detalle.filas).toEqual([])
  })
})

describe('nombreDeComprobante · el botón dice qué va a pasar', () => {
  it('los cinco tienen nombre', () => {
    expect(['afip_a', 'afip_b', 'afip_c', 'remito', 'recibo_x'].map(nombreDeComprobante))
      .toEqual(['Factura A', 'Factura B', 'Factura C', 'Remito', 'Recibo X'])
  })

  it('uno desconocido NO se imprime crudo adentro del botón', () => {
    expect(nombreDeComprobante('inventado')).toBe('el comprobante')
    expect(nombreDeComprobante(undefined)).toBe('el comprobante')
  })
})
