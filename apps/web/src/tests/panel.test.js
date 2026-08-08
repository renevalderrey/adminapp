import { describe, it, expect } from 'vitest'
import { nombreDeRuta } from '@/components/navegacion'
import {
  alturasDelSparkline,
  etiquetaDeAviso,
  ordenarAvisos,
  severidadDeAviso,
  tonoDeAviso,
} from '@/utils/panel'

// ════════════════════════════════════════════
//  ADMINAPP · Las reglas del Panel de control
//
//  Cuatro funciones puras y sus bordes. Lo que NO se prueba acá es el dibujo:
//  que la tarjeta no deje un hueco sin serie y que el bloque vacío diga algo
//  está en `renderDelPanel.test.jsx`, y cuánto mide una barra de verdad está en
//  `pruebas-de-navegador/maquetadoDelPanel.navegador.js` — jsdom no maqueta.
// ════════════════════════════════════════════

describe('La severidad de un aviso', () => {
  it('faltantes y ventas rechazadas son urgentes; vencimientos, no', () => {
    expect(severidadDeAviso({ tipo: 'faltantes', cantidad: 12 })).toBe('alta')
    expect(severidadDeAviso({ tipo: 'sin_cae', cantidad: 1 })).toBe('alta')
    expect(severidadDeAviso({ tipo: 'vencimientos', cantidad: 3 })).toBe('media')
  })

  it('el certificado de AFIP escala a urgente cuando le queda una semana', () => {
    // A siete días el trámite en ARCA ya no entra. Con un solo umbral —«avisar a
    // los 30»— el aviso del día 29 y el del día 2 se leerían igual.
    expect(severidadDeAviso({ tipo: 'certificado_afip', dias: 28 })).toBe('media')
    expect(severidadDeAviso({ tipo: 'certificado_afip', dias: 7 })).toBe('alta')
    expect(severidadDeAviso({ tipo: 'certificado_afip', dias: -3 })).toBe('alta')
  })

  it('NUNCA devuelve undefined, ni con un tipo que la pantalla no conoce', () => {
    // Un `undefined` acá deja el badge sin ninguna de sus tres clases, o sea un
    // aviso sin color: es cómo un aviso nuevo del servidor se vuelve invisible.
    expect(severidadDeAviso({ tipo: 'lo_que_venga' })).toBe('media')
    expect(severidadDeAviso({})).toBe('media')
    expect(severidadDeAviso(null)).toBe('media')
  })

  it('el tono trae las TRES clases del badge, siempre', () => {
    for (const aviso of [
      { tipo: 'faltantes' }, { tipo: 'vencimientos' }, { tipo: 'lo_que_venga' }, null,
    ]) {
      const tono = tonoDeAviso(aviso)

      expect(tono).toMatch(/border-/)
      expect(tono).toMatch(/bg-/)
      expect(tono).toMatch(/text-/)
    }
  })
})

describe('El orden de los avisos', () => {
  const VENCIMIENTOS = { tipo: 'vencimientos', cantidad: 30 }
  const UN_FALTANTE = { tipo: 'faltantes', cantidad: 1 }
  const DOCE_SIN_CAE = { tipo: 'sin_cae', cantidad: 12 }

  it('los urgentes van primero aunque tengan menos casos', () => {
    const orden = ordenarAvisos([VENCIMIENTOS, UN_FALTANTE]).map((a) => a.tipo)

    expect(orden).toEqual(['faltantes', 'vencimientos'])
  })

  it('dentro de la misma severidad manda la cantidad', () => {
    const orden = ordenarAvisos([UN_FALTANTE, DOCE_SIN_CAE]).map((a) => a.tipo)

    expect(orden).toEqual(['sin_cae', 'faltantes'])
  })

  it('NO muta el arreglo que recibe', () => {
    // Viene del estado de React: ordenarlo en el lugar es cómo una lista cambia
    // sin que nadie haya pedido que cambie.
    const entrada = [VENCIMIENTOS, DOCE_SIN_CAE]

    ordenarAvisos(entrada)

    expect(entrada.map((a) => a.tipo)).toEqual(['vencimientos', 'sin_cae'])
  })

  it('con una lista vacía o basura devuelve una lista vacía', () => {
    expect(ordenarAvisos([])).toEqual([])
    expect(ordenarAvisos(undefined)).toEqual([])
  })
})

/**
 * La ruta que el servidor manda con cada aviso.
 *
 * Sale de `services/dashboardService.js`. Está acá y no adivinada porque la
 * acción del botón se deriva de la ruta: si una cambiara sin que esta lista se
 * entere, el aviso mandaría al lugar equivocado con el nombre del correcto.
 */
const RUTA_DEL_AVISO = [
  ['faltantes', '/faltantes'],
  ['sin_cae', '/ventas'],
  ['vencimientos', '/inventario'],
  ['certificado_afip', '/facturacion'],
]

describe('Lo que dice cada aviso', () => {
  it('el aviso de faltantes dice que es de la SUCURSAL ACTIVA, no de la empresa', () => {
    // Es FR-059 y es la mitad de esta pantalla: el número sale de la sucursal
    // activa porque `GET /api/faltantes` sale de ahí. Sin decirlo, el Panel
    // diría 12, Faltantes mostraría 7 y no habría forma de saber cuál creer.
    const enSucursal = etiquetaDeAviso({ tipo: 'faltantes', cantidad: 12, alcance: 'sucursal' })
    const enEmpresa = etiquetaDeAviso({ tipo: 'faltantes', cantidad: 12, alcance: 'empresa' })

    expect(enSucursal.alcance).toBe('en esta sucursal')
    expect(enEmpresa.alcance).toBe('en toda la empresa')
    expect(enSucursal.titulo).toBe('12 productos por debajo del mínimo')
  })

  it('el singular no dice «1 productos»', () => {
    expect(etiquetaDeAviso({ tipo: 'faltantes', cantidad: 1 }).titulo)
      .toBe('1 producto por debajo del mínimo')
  })

  it('«sin CAE» dice que AFIP las RECHAZÓ, no que están sin facturar', () => {
    // El servidor cuenta las que tienen `afip_ultimo_error`. Rotularlo «ventas
    // sin comprobante» mandaría a buscar todas las ventas internas, que están
    // bien.
    expect(etiquetaDeAviso({ tipo: 'sin_cae', cantidad: 2 }).titulo)
      .toContain('AFIP rechazó')
  })

  it('el certificado dice si vence, si vence hoy o si ya venció', () => {
    expect(etiquetaDeAviso({ tipo: 'certificado_afip', dias: 28 }).titulo)
      .toBe('El certificado de AFIP vence en 28 días')
    expect(etiquetaDeAviso({ tipo: 'certificado_afip', dias: 1 }).titulo)
      .toBe('El certificado de AFIP vence en 1 día')
    expect(etiquetaDeAviso({ tipo: 'certificado_afip', dias: 0 }).titulo)
      .toBe('El certificado de AFIP vence hoy')
    expect(etiquetaDeAviso({ tipo: 'certificado_afip', dias: -3 }).titulo)
      .toBe('El certificado de AFIP venció hace 3 días')
  })

  it('un tipo desconocido se dibuja igual: no desaparece', () => {
    const etiqueta = etiquetaDeAviso({ tipo: 'lo_que_venga', cantidad: 4 })

    expect(etiqueta.titulo).toBeTruthy()
    expect(etiqueta.accion).toBeTruthy()
  })

  it('cada aviso trae su acción, y son distintas entre sí', () => {
    // ⚠ Ahora la acción sale de la RUTA y no del tipo, así que los avisos se
    // arman con la ruta que manda el servidor. Sin ella todos dirían «Ver», que
    // es lo correcto —no se puede nombrar una pantalla que no se sabe cuál es—
    // pero no es lo que pasa en producción.
    const acciones = RUTA_DEL_AVISO
      .map(([tipo, ruta]) => etiquetaDeAviso({ tipo, ruta, cantidad: 1, dias: 10 }).accion)

    expect(new Set(acciones).size).toBe(4)
  })

  // ── El Panel no inventa nombres de pantalla ──
  //
  // Decía «Ver ventas» para `/ventas` —que en el menú es «Historial de
  // ventas»—, «Ir a Facturación» para `/facturacion` —que es «Facturación
  // AFIP»— y, en otro bloque, «Historial completo» para esa misma ruta. Tres
  // nombres para dos pantallas.
  //
  // Alguien que lee «Ver ventas» y va a buscar esa pantalla en el menú no la
  // encuentra. El nombre de una pantalla es cómo se la busca.
  describe('la acción nombra la pantalla como la nombra el menú', () => {
    it.each(RUTA_DEL_AVISO)('el aviso %s manda al nombre real de %s', (tipo, ruta) => {
      const { accion } = etiquetaDeAviso({ tipo, ruta, cantidad: 1, dias: 10 })

      expect(accion).toBe(`Ir a ${nombreDeRuta(ruta)}`)
      // Y el nombre existe de verdad: `nombreDeRuta` de una ruta que no está en
      // el menú devuelve `null`, y «Ir a null» pasaría el `toBe` de arriba.
      expect(nombreDeRuta(ruta)).toBeTruthy()
    })

    it('las cuatro rutas de los avisos ESTÁN en el menú', () => {
      // El ancla. Si el servidor empezara a mandar una ruta que el menú no
      // tiene, los avisos dirían «Ver» y esta lista lo dice antes.
      for (const [, ruta] of RUTA_DEL_AVISO) {
        expect(nombreDeRuta(ruta)).not.toBeNull()
      }
    })

    it('una ruta que no está en el menú NO dice «Ir a null»', () => {
      // El caso de borde. Un aviso sin ruta, o con una ruta de detalle, tiene
      // que quedarse con un botón genérico y no con un texto roto.
      expect(etiquetaDeAviso({ tipo: 'faltantes', cantidad: 1 }).accion).toBe('Ver')
      expect(etiquetaDeAviso({ tipo: 'faltantes', ruta: '/no-existe', cantidad: 1 }).accion).toBe('Ver')
    })
  })
})

describe('Las alturas del sparkline', () => {
  it('una serie de un solo punto NO divide por cero', () => {
    // Es el caso del negocio que arrancó este mes. `(0 − 0) / (0 − 0)` es `NaN`
    // y `height: NaN%` no dibuja nada: la tarjeta queda con un hueco y nadie
    // sabe si es un dato o un error.
    for (const serie of [[0], [0, 0, 0], [500]]) {
      const alturas = alturasDelSparkline(serie)

      expect(alturas).toHaveLength(serie.length)
      expect(alturas.every((h) => Number.isFinite(h))).toBe(true)
    }
  })

  it('una serie vacía no dibuja ninguna barra', () => {
    expect(alturasDelSparkline([])).toEqual([])
    expect(alturasDelSparkline(undefined)).toEqual([])
  })

  it('la barra más alta es la del máximo, y ninguna queda invisible', () => {
    const alturas = alturasDelSparkline([0, 50, 100])

    expect(alturas[2]).toBe(100)
    expect(alturas[0]).toBeGreaterThan(0)
    expect(alturas[0]).toBeLessThan(alturas[1])
  })

  it('una serie con saldos NEGATIVOS no produce alturas negativas', () => {
    // El saldo de caja se hunde. Escalando contra el máximo a secas, un mes en
    // −50.000 daría una altura negativa que el navegador dibuja como cero: doce
    // barras iguales para una serie que se derrumbó.
    const alturas = alturasDelSparkline([-50000, -10000, 20000])

    expect(alturas.every((h) => h >= 0)).toBe(true)
    expect(alturas[0]).toBeLessThan(alturas[1])
    expect(alturas[1]).toBeLessThan(alturas[2])
  })

  it('lo que no es un número se lee como cero y no como NaN', () => {
    const alturas = alturasDelSparkline([null, undefined, '30', 100])

    expect(alturas.every((h) => Number.isFinite(h))).toBe(true)
    expect(alturas).toHaveLength(4)
  })
})
