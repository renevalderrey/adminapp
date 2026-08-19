import { describe, it, expect } from 'vitest'
import {
  SEGMENTOS,
  MEDIOS,
  ETIQUETAS,
  segmentoDe,
  mediosDelSegmento,
  medioPorDefecto,
  llevaVuelto,
  etiquetaDePago,
  precioDeLinea,
  DESTACADOS,
  nombreDeLista,
  mediosALaVista,
  mediosAgrupados,
} from './mediosDePago'

// ════════════════════════════════════════════
//  Los medios de pago: qué se puede elegir, qué se puede leer y qué se cobra
//
//  Los tres primeros bloques son plata. Equivocar el mapa de precios cobra el
//  precio de efectivo por una compra con tarjeta y NADA falla: la venta se
//  registra, el ticket sale, y la diferencia aparece recién cuando alguien
//  cuenta la caja.
// ════════════════════════════════════════════

/** Una línea del ticket con los tres niveles ya calculados. */
const LINEA = (campos = {}) => ({
  id: 1,
  name: 'Colágeno 300g',
  qty: 1,
  base_cash: 10000,
  base_card: 12000,
  base_alliance: 9000,
  price: 10000,
  ...campos,
})

describe('precioDeLinea · el nivel de precio de cada medio', () => {
  it('NO cotiza una compra con tarjeta al precio de efectivo', () => {
    const linea = LINEA()

    // Los tres de tarjeta, más `tc3` — el código que la pantalla vieja escribe
    // y que no está en ninguna lista. Sin la entrada de `tc3` en el mapa, TODAS
    // las ventas con tarjeta se cobran al precio de efectivo hasta que la
    // pantalla se reescribe, y nada falla.
    for (const codigo of ['tc3v', 'tc3m', 'tc3n', 'tc3']) {
      expect(precioDeLinea(codigo, linea)).toBe(linea.base_card)
    }

    for (const codigo of ['ef', 'tr', 'qr', 'td', 'tc1']) {
      expect(precioDeLinea(codigo, linea)).toBe(linea.base_cash)
    }

    expect(precioDeLinea('al', linea)).toBe(linea.base_alliance)
  })

  it('NO devuelve el precio de lista cuando la línea tiene precio a mano', () => {
    // Se acordó $18.000 en el mostrador. Tocar «Tarjeta» no puede devolver el
    // precio de lista sin avisar: se descubre cuando el cliente ya se fue.
    const linea = LINEA({ price: 18000, precio_manual: true })

    expect(precioDeLinea('tc3v', linea)).toBe(18000)
    expect(precioDeLinea('ef', linea)).toBe(18000)
    expect(precioDeLinea('al', linea)).toBe(18000)
  })

  it('un código desconocido cae a efectivo y no a undefined', () => {
    // Un `undefined` acá se multiplica por la cantidad y el total del ticket
    // pasa a ser `NaN`, que se dibuja igual y no rompe nada hasta el `POST`.
    const linea = LINEA()

    expect(precioDeLinea('zzz', linea)).toBe(linea.base_cash)
    expect(precioDeLinea(undefined, linea)).toBe(linea.base_cash)
    expect(precioDeLinea('', linea)).toBe(linea.base_cash)
  })

  it('NO cobra el precio de efectivo cuando el precio de tarjeta no existe', () => {
    // `calcularPrecios` devuelve `cardPrice: null` cuando el recargo
    // configurado no deja un precio finito. Un `null` en el carrito rompe el
    // total; el precio de efectivo es lo que se cobraba antes y se conserva.
    const linea = LINEA({ base_card: null })

    expect(precioDeLinea('tc3v', linea)).toBe(linea.base_cash)
  })

  it('un descuento de alianza del 100 % cobra 0 y NO el precio de efectivo', () => {
    // Caso de borde obligatorio de CONVENCIONES. El mapa viejo hacía
    // `priceMap[method] || i.base_cash`, y `0 || 10000` devuelve 10000: una
    // línea regalada se cobraba al precio de lista.
    const linea = LINEA({ base_alliance: 0 })

    expect(precioDeLinea('al', linea)).toBe(0)
  })

  it('con la línea vacía no devuelve NaN ni explota', () => {
    expect(precioDeLinea('ef', {})).toBeUndefined()
    expect(precioDeLinea('ef')).toBeUndefined()
  })
})

describe('llevaVuelto · qué medio se paga con billetes', () => {
  it('NO ofrece el bloque de vuelto para una transferencia', () => {
    // El segmento y el vuelto son dos ejes distintos: una transferencia cotiza
    // como efectivo y no lleva vuelto. Se recorre `MEDIOS` entero a propósito:
    // listar tres a mano deja de cubrir el día que se agregue un medio.
    for (const medio of MEDIOS) {
      expect([medio.codigo, llevaVuelto(medio.codigo)]).toEqual([
        medio.codigo,
        medio.codigo === 'ef',
      ])
    }
  })

  it('un código histórico o desconocido tampoco lleva vuelto', () => {
    expect(llevaVuelto('tc3')).toBe(false)
    expect(llevaVuelto('zzz')).toBe(false)
    expect(llevaVuelto(undefined)).toBe(false)
  })
})

describe('MEDIOS y ETIQUETAS · lo que se puede elegir y lo que se puede leer', () => {
  it('NO ofrece tc ni tc3 como medios elegibles', () => {
    // Son códigos guardados en ventas reales que el control no puede ofrecer:
    // `tc` viene del sistema anterior y `tc3` lo escribió este mismo POS. La
    // salida barata —agregarlos a los segmentos— haría que el operador pueda
    // elegir un medio que nadie eligió nunca.
    const elegibles = MEDIOS.map((m) => m.codigo)

    expect(elegibles).not.toContain('tc')
    expect(elegibles).not.toContain('tc3')

    // Y sin embargo se leen: es la diferencia entre «se puede leer» y «se puede
    // elegir».
    expect(etiquetaDePago('tc')).toBe('T. Crédito')
    expect(etiquetaDePago('tc3')).toBe('T. Crédito 3c')
  })

  it('los nueve elegibles son exactamente los del sistema anterior', () => {
    expect(MEDIOS.map((m) => m.codigo)).toEqual([
      'ef', 'tr', 'qr', 'td', 'tc1', 'tc3v', 'tc3m', 'tc3n', 'al',
    ])
  })

  it('ningún medio se queda sin etiqueta ni sin etiqueta corta', () => {
    for (const medio of MEDIOS) {
      expect([medio.codigo, medio.etiqueta?.length > 0]).toEqual([medio.codigo, true])
      expect([medio.codigo, medio.etiquetaCorta?.length > 0]).toEqual([medio.codigo, true])
      expect(SEGMENTOS).toContain(medio.segmento)
    }
  })

  it('un código sin etiqueta se muestra crudo y NO como «undefined»', () => {
    expect(etiquetaDePago('zzz')).toBe('zzz')
    expect(etiquetaDePago(undefined)).toBe('—')
  })
})

describe('segmentos · el nivel de precio, no la forma de pagar', () => {
  it('Créd. 1 pago vive en el segmento Efectivo, porque cotiza a ese precio', () => {
    // `legacy:6122`. Se lee mal a propósito: el segmento ES un nivel de precio,
    // y el encabezado del catálogo fija los tres nombres como literales.
    expect(segmentoDe('tc1')).toBe('efectivo')
    expect(mediosDelSegmento('efectivo').map((m) => m.codigo)).toEqual(['ef', 'tr', 'qr', 'td', 'tc1'])
  })

  it('cada segmento tiene un medio por defecto y es el primero de su lista', () => {
    expect(medioPorDefecto('efectivo')).toBe('ef')
    expect(medioPorDefecto('tarjeta')).toBe('tc3v')
    expect(medioPorDefecto('alianza')).toBe('al')
  })

  it('un segmento que no existe NO deja el medio en undefined', () => {
    expect(medioPorDefecto('inventado')).toBe('ef')
    expect(mediosDelSegmento('inventado')).toEqual([])
  })

  it('los tres segmentos cubren los nueve medios, sin dejar ninguno afuera', () => {
    const cubiertos = SEGMENTOS.flatMap((s) => mediosDelSegmento(s).map((m) => m.codigo))

    expect(cubiertos.sort()).toEqual(MEDIOS.map((m) => m.codigo).sort())
  })

  it('ETIQUETAS cubre los once códigos que se pueden leer', () => {
    expect(Object.keys(ETIQUETAS).sort()).toEqual([
      'al', 'ef', 'qr', 'tc', 'tc1', 'tc3', 'tc3m', 'tc3n', 'tc3v', 'td', 'tr',
    ])
  })
})

// ════════════════════════════════════════════
//  El medio se elige UNA vez, y agrupado por la lista con la que cotiza
//
//  Lo que se prueba acá es una propiedad y no un dibujo: entre lo que el pie
//  muestra y lo que esconde el desplegable tienen que estar SIEMPRE los nueve
//  medios, sin repetir ninguno. Un medio que no está en ninguno de los dos no
//  se puede elegir, y no falla nada: se cobra con otro.
// ════════════════════════════════════════════

describe('mediosALaVista y mediosAgrupados · entre los dos están los nueve', () => {
  /** Todos los códigos que el control ofrece con ese medio elegido. */
  const alcanzables = (codigo) => [
    ...mediosALaVista(codigo).map((m) => m.codigo),
    ...mediosAgrupados(codigo).flatMap((g) => g.medios.map((m) => m.codigo)),
  ]

  it('ningún medio queda fuera del control, sea cual sea el elegido', () => {
    for (const medio of MEDIOS) {
      expect(alcanzables(medio.codigo).sort()).toEqual(MEDIOS.map((m) => m.codigo).sort())
    }
  })

  it('ninguno aparece dos veces: el elegido no se duplica en «Otros»', () => {
    for (const medio of MEDIOS) {
      const codigos = alcanzables(medio.codigo)

      expect(codigos.length).toBe(new Set(codigos).size)
    }
  })

  it('el elegido está SIEMPRE a la vista, aunque no sea uno de los destacados', () => {
    // Un ticket cobrado con «Naranja 3c» no puede mostrar «Efectivo» resaltado y
    // el medio verdadero escondido atrás de un desplegable.
    for (const medio of MEDIOS) {
      expect(mediosALaVista(medio.codigo).map((m) => m.codigo)).toContain(medio.codigo)
    }
  })

  it('con un destacado elegido, a la vista quedan exactamente los cuatro', () => {
    expect(mediosALaVista('ef').map((m) => m.codigo).sort()).toEqual([...DESTACADOS].sort())
  })

  it('un código que no existe no rompe el control ni agrega un botón fantasma', () => {
    // `tc3` está guardado en ventas reales y NO es elegible: el control tiene
    // que dibujarse igual, con los cuatro destacados y nada más.
    expect(mediosALaVista('tc3').map((m) => m.codigo).sort()).toEqual([...DESTACADOS].sort())
    expect(mediosALaVista(undefined).map((m) => m.codigo).sort()).toEqual([...DESTACADOS].sort())
  })

  it('los grupos vacíos NO se dibujan', () => {
    // Un encabezado «Cotizan con Alianza» sin nada debajo se lee como una
    // opción que no anda.
    for (const medio of MEDIOS) {
      for (const grupo of mediosAgrupados(medio.codigo)) {
        expect(grupo.medios.length).toBeGreaterThan(0)
      }
    }
  })

  it('cada grupo dice la lista de sus medios, y no la de otro', () => {
    // Es toda la explicación que el control anterior no daba: por qué una
    // transferencia cobra el precio de efectivo.
    for (const grupo of mediosAgrupados('ef')) {
      for (const medio of grupo.medios) {
        expect([medio.codigo, medio.segmento]).toEqual([medio.codigo, grupo.segmento])
        expect(grupo.lista).toBe(nombreDeLista(medio.segmento))
      }
    }
  })

  it('nombreDeLista no deja un segmento desconocido sin nombre', () => {
    expect(nombreDeLista('inventado')).toBe('Efectivo')
    expect(nombreDeLista(undefined)).toBe('Efectivo')
  })
})
