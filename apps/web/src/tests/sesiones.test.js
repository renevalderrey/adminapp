import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_DE_DISPOSITIVO,
  etiquetaDeDispositivo,
  haceCuanto,
} from '@/utils/sesiones'

// ════════════════════════════════════════════
//  FAVALIO · Las reglas de la lista de sesiones
//
//  Las dos son puras y por eso se prueban acá y no en el render: un test de
//  render que verificara «dice hace 12 minutos» monta la pantalla entera, tarda
//  cien veces más y se pone en rojo cuando alguien mueve un `<div>` — con la
//  regla intacta.
//
//  ⚠ El reloj se **inyecta**. Un test que compare contra `Date.now()` real pasa
//  hoy y falla el día que la máquina esté cargada: la diferencia de un
//  milisegundo cruza el borde de «recién» y nadie entiende por qué se puso rojo.
// ════════════════════════════════════════════

/** Un instante fijo, para que los bordes se puedan escribir a mano. */
const AHORA = new Date('2026-08-06T15:00:00.000Z').getTime()

const hace = (ms) => new Date(AHORA - ms).toISOString()

const MINUTO = 60 * 1000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

describe('la etiqueta de un dispositivo nunca queda vacía', () => {
  it.each([
    ['computadora', 'Computadora'],
    ['celular', 'Celular'],
    ['desconocido', 'Desconocido'],
  ])('%s → %s', (codigo, etiqueta) => {
    expect(etiquetaDeDispositivo(codigo)).toBe(etiqueta)
  })

  it.each([
    ['un código que esta pantalla no conoce todavía', 'tablet'],
    ['null', null],
    ['undefined', undefined],
    ['cadena vacía', ''],
  ])('%s cae en «Desconocido», no en una celda vacía', (_caso, codigo) => {
    // Una celda vacía en una tabla no se distingue de «no se miró». Es la misma
    // regla que `tonoDeProveedor`: la función nunca devuelve `undefined`.
    expect(etiquetaDeDispositivo(codigo)).toBe('Desconocido')
    expect(Object.values(ETIQUETAS_DE_DISPOSITIVO)).toContain(etiquetaDeDispositivo(codigo))
  })
})

describe('«hace cuánto» contesta la pregunta que se está haciendo', () => {
  it.each([
    ['0 segundos', 0, 'recién'],
    ['59 segundos', 59 * 1000, 'recién'],
    ['1 minuto', MINUTO, 'hace 1 minuto'],
    ['12 minutos', 12 * MINUTO, 'hace 12 minutos'],
    ['1 hora', HORA, 'hace 1 hora'],
    ['5 horas', 5 * HORA, 'hace 5 horas'],
    ['1 día', DIA, 'hace 1 día'],
    ['5 días', 5 * DIA, 'hace 5 días'],
  ])('%s → %s', (_caso, ms, esperado) => {
    expect(haceCuanto(hace(ms), AHORA)).toBe(esperado)
  })

  it('el singular y el plural son dos casos, no uno', () => {
    // Sin el caso de 1, un `hace ${n} minutos` a secas —«hace 1 minutos»—
    // pasaría verde: es el defecto que solo se ve cuando el número es uno, o sea
    // durante sesenta segundos de cada hora.
    expect(haceCuanto(hace(MINUTO), AHORA)).toBe('hace 1 minuto')
    expect(haceCuanto(hace(2 * MINUTO), AHORA)).toBe('hace 2 minutos')
    expect(haceCuanto(hace(HORA), AHORA)).toBe('hace 1 hora')
    expect(haceCuanto(hace(DIA), AHORA)).toBe('hace 1 día')
  })

  it('pasado el mes muestra la fecha, que es lo que se compara con otra cosa', () => {
    // «hace 47 días» no ayuda a decidir nada; la fecha sí, porque es el dato que
    // alguien compara contra «esa persona dejó la empresa en junio».
    expect(haceCuanto('2026-05-01T10:00:00.000Z', AHORA)).toBe('01/05/2026')
  })

  it('un reloj adelantado NO dice «hace -3 minutos»', () => {
    // El servidor y esta computadora no tienen por qué estar en hora. Un
    // `vista_en` un minuto en el futuro es normal y no puede dibujar un número
    // negativo en la pantalla.
    expect(haceCuanto(new Date(AHORA + 3 * MINUTO).toISOString(), AHORA)).toBe('recién')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['cadena vacía', ''],
    ['texto que no es fecha', 'no-es-una-fecha'],
  ])('%s no se convierte en «Invalid Date»', (_caso, valor) => {
    // Es el mismo defecto que FR-122 evita del lado del servidor con
    // `ultimo_acceso: null`: un dato que no está tiene que decirse, no dibujarse
    // como una fecha rota.
    expect(haceCuanto(valor, AHORA)).toBe('—')
  })
})
