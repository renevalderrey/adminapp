import { describe, it, expect } from 'vitest'
import { ESTADOS, estaAnulada, presentacionDeEstado } from './estadoVenta'

/** Los cinco códigos que devuelve `apps/api/src/utils/estadoVenta.js`. */
const CODIGOS = ['autorizada', 'registrada', 'rechazada', 'anulada', 'anulada_con_cae']

describe('el mapa de estados', () => {
  it('cubre los cinco códigos que devuelve la API, y ninguno más', () => {
    expect(Object.keys(ESTADOS).sort()).toEqual([...CODIGOS].sort())
  })

  it.each(CODIGOS)('%s tiene los tres tokens: texto, fondo y línea', (codigo) => {
    const e = ESTADOS[codigo]

    // Los tres juntos o ninguno: un color de estado suelto —texto de color sin
    // fondo suave ni línea— se lee como un error de estilo.
    expect(e.texto).toMatch(/^text-/)
    expect(e.fondo).toMatch(/^bg-/)
    expect(e.linea).toMatch(/^border-/)
  })

  // La regla que más se olvida: todo color sale de los tokens de index.css.
  // Un hex acá volvería a meter un gris elegido a ojo que no existe en modo
  // oscuro, y la guardia estática de la pantalla no mira este archivo.
  it('NO tiene ningún valor hexadecimal: todo sale de los tokens', () => {
    const valores = Object.values(ESTADOS)
      .flatMap((e) => [e.texto, e.fondo, e.linea])
      .filter((v) => /#[0-9a-fA-F]{3,8}\b/.test(v))

    expect(valores).toEqual([])
  })

  // Registrada y Anulada comparten fondo (surface-3) y línea (border): sin el
  // ícono, mirando el badge aislado no se distinguen sin leer el texto.
  it('«Anulada» es el único con ícono, y por eso se distingue de «Registrada»', () => {
    const conIcono = CODIGOS.filter((c) => ESTADOS[c].icono)

    expect(conIcono).toEqual(['anulada'])
    expect(ESTADOS.anulada.fondo).toBe(ESTADOS.registrada.fondo)
    expect(ESTADOS.anulada.linea).toBe(ESTADOS.registrada.linea)
  })

  // «Anulada · vigente ante ARCA» no puede verse como una anulada común: el
  // comprobante sigue declarado ante ARCA hasta que se emita una nota de
  // crédito, que el sistema todavía no emite.
  it('«Anulada · vigente ante ARCA» NO comparte paleta con «Anulada»', () => {
    expect(ESTADOS.anulada_con_cae.texto).not.toBe(ESTADOS.anulada.texto)
    expect(ESTADOS.anulada_con_cae.fondo).not.toBe(ESTADOS.anulada.fondo)
    expect(ESTADOS.anulada_con_cae.linea).not.toBe(ESTADOS.anulada.linea)
  })

  it('los cinco fondos y textos no se repiten los cinco entre sí', () => {
    const combinaciones = CODIGOS.map((c) => `${ESTADOS[c].texto}|${ESTADOS[c].fondo}`)

    expect(new Set(combinaciones).size).toBe(5)
  })
})

describe('estaAnulada', () => {
  it('las dos anuladas van al 55% de opacidad; las tres activas no', () => {
    expect(estaAnulada('anulada')).toBe(true)
    expect(estaAnulada('anulada_con_cae')).toBe(true)
    expect(estaAnulada('autorizada')).toBe(false)
    expect(estaAnulada('registrada')).toBe(false)
    expect(estaAnulada('rechazada')).toBe(false)
  })
})

describe('presentacionDeEstado', () => {
  it('devuelve el trío del código pedido', () => {
    expect(presentacionDeEstado('rechazada')).toBe(ESTADOS.rechazada)
  })

  // Una fila sin badge es un bug visible; una pantalla en blanco porque se
  // leyó `.texto` de undefined es un bug caro.
  it('un código desconocido NO rompe la pantalla', () => {
    expect(presentacionDeEstado('inventado').texto).toBe(ESTADOS.registrada.texto)
    expect(presentacionDeEstado(undefined).texto).toBe(ESTADOS.registrada.texto)
  })
})
