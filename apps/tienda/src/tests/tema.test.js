import { describe, it, expect } from 'vitest'
import {
  MARCA_POR_DEFECTO,
  TEXTO_CLARO,
  TEXTO_OSCURO,
  aplicarTema,
  colorDeMarca,
  textoSobre,
} from '../tema.js'

// Los cuatro colores de prueba de la maqueta
// (`docs/maqueta/Catalogo-de-ventas-online.dc.html:55-58`). Están arriba del
// archivo por el mismo motivo por el que están acá: son los cuatro casos con los
// que se mira si el color «solo aparece en lo que se toca».
const TURQUESA = '#00B4B6'
const NARANJA = '#F0641E'
const NEGRO = '#101418'
const AZUL = '#1A1AFF'

describe('tema · el contraste se calcula, no se elige (FR-060)', () => {
  it('sobre turquesa el texto sale oscuro y sobre negro sale claro, calculado y no elegido', () => {
    expect(textoSobre(TURQUESA)).toBe(TEXTO_OSCURO)
    expect(textoSobre(NEGRO)).toBe(TEXTO_CLARO)

    // El par junto es lo que hace al test: si `textoSobre` devolviera una
    // constante —cualquiera de las dos— una de las dos afirmaciones caería. Un
    // color que se elige no puede dar dos respuestas distintas.
    expect(textoSobre(TURQUESA)).not.toBe(textoSobre(NEGRO))
  })

  it('los cuatro colores de prueba de la maqueta', () => {
    expect([TURQUESA, NARANJA, NEGRO, AZUL].map(textoSobre)).toEqual([
      TEXTO_OSCURO,
      TEXTO_OSCURO,
      TEXTO_CLARO,
      TEXTO_CLARO,
    ])
  })

  // ⚠ Este caso es el que sostiene la única línea que `tema.js` no portó tal
  // cual de la maqueta. El umbral de allá (`L > 0.45`) está calibrado para el
  // promedio ponderado **sin linealizar**, no para la luminancia relativa —con
  // la luminancia devuelve el color claro para los cuatro—. Con la lectura para
  // la que el 0.45 sirve, la maqueta dice exactamente lo mismo que dice
  // `textoSobre`. O sea: no se cambió la intención, se corrigió el número que la
  // traicionaba, y si alguien toca `textoSobre` esta afirmación lo avisa.
  it('coincide con lo que la maqueta quiso decir con su umbral de 0.45', () => {
    const comoLaMaqueta = (hex) => {
      const v = hex.slice(1)
      const canal = (i) => parseInt(v.slice(i, i + 2), 16) / 255
      const promedio = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4)
      return promedio > 0.45 ? TEXTO_OSCURO : TEXTO_CLARO
    }
    for (const color of [TURQUESA, NARANJA, NEGRO, AZUL]) {
      expect(textoSobre(color)).toBe(comoLaMaqueta(color))
    }
  })

  it('un color inventado no rompe nada: cae en el de la maqueta', () => {
    expect(colorDeMarca('rojo')).toBe(MARCA_POR_DEFECTO.toLowerCase())
    expect(colorDeMarca(null)).toBe(MARCA_POR_DEFECTO.toLowerCase())
    expect(colorDeMarca('#zzzzzz')).toBe(MARCA_POR_DEFECTO.toLowerCase())
    expect(textoSobre(undefined)).toBe(textoSobre(TURQUESA))
  })

  it('la forma corta vale y da lo mismo que la larga', () => {
    expect(colorDeMarca('#fff')).toBe('#ffffff')
    expect(textoSobre('#fff')).toBe(textoSobre('#FFFFFF'))
  })
})

describe('tema · las dos variables', () => {
  it('al aplicarlo escribe --marca y --marca-texto en la raíz', () => {
    const raiz = document.documentElement
    aplicarTema(NEGRO, raiz)

    expect(raiz.style.getPropertyValue('--marca')).toBe(NEGRO.toLowerCase())
    expect(raiz.style.getPropertyValue('--marca-texto')).toBe(TEXTO_CLARO)
  })

  it('cambiar de catálogo cambia las dos, no una', () => {
    const raiz = document.createElement('div')

    aplicarTema(NEGRO, raiz)
    const antes = [raiz.style.getPropertyValue('--marca'), raiz.style.getPropertyValue('--marca-texto')]

    aplicarTema(TURQUESA, raiz)
    const despues = [raiz.style.getPropertyValue('--marca'), raiz.style.getPropertyValue('--marca-texto')]

    expect(despues).toEqual([TURQUESA.toLowerCase(), TEXTO_OSCURO])
    expect(despues[1]).not.toBe(antes[1])
  })

  it('lo que entra a --marca está validado: una cadena rara no llega a la hoja de estilos', () => {
    const raiz = document.createElement('div')
    aplicarTema('url(https://ejemplo.test/pixel.gif)', raiz)
    expect(raiz.style.getPropertyValue('--marca')).toBe(MARCA_POR_DEFECTO.toLowerCase())
  })
})
