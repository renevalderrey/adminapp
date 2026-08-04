import { describe, it, expect } from 'vitest'
import { atajoDe, ATRIBUTO_BUSCADOR, ATRIBUTO_CAMPO, ATRIBUTO_LINEA, campoLimpiable } from './atajosDelPos'

// ════════════════════════════════════════════
//  La tabla de atajos, entera
//
//  Cuatro teclas × cinco combinaciones de modificadores × cuatro ubicaciones de
//  foco × `defaultPrevented` en los dos valores. Son objetos planos: la tabla
//  completa corre en milisegundos y sin render.
//
//  El test que da nombre al archivo es «Enter NO cobra». Un lector de código de
//  barras termina cada lectura con `Enter`: si `Enter` cobrara, cada escaneo
//  cobraría la venta.
// ════════════════════════════════════════════

/** Un `KeyboardEvent` con la forma que le importa a `atajoDe`. */
const evento = ({ key, foco = 'BODY', buscador = false, ...modificadores } = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  target: {
    tagName: foco,
    isContentEditable: false,
    dataset: buscador ? { buscadorDelPos: '' } : {},
  },
  ...modificadores,
})

const FOCOS = ['INPUT', 'TEXTAREA', 'SELECT', 'BODY']
const TECLAS = ['/', 'Enter', 'Escape', 'a']
const MODIFICADORES = [
  ['nada', {}],
  ['Ctrl', { ctrlKey: true }],
  ['Meta', { metaKey: true }],
  ['Alt', { altKey: true }],
  ['Shift', { shiftKey: true }],
]

describe('Enter · la regla que existe por el lector de código de barras', () => {
  it('Enter NO cobra, esté donde esté el foco', () => {
    // Es EL test de este archivo. La rama que devuelve `'cobrar'` para `Enter`
    // sin modificadores es literalmente lo que pide `PLAN-COMPRAFIT.md` 4.1 y
    // lo que esta funcionalidad contradice a propósito.
    for (const foco of FOCOS) {
      for (const buscador of [true, false]) {
        expect([foco, buscador, atajoDe(evento({ key: 'Enter', foco, buscador }))])
          .not.toEqual([foco, buscador, 'cobrar'])
      }
    }
  })

  it('Enter en la búsqueda agrega el primer resultado', () => {
    expect(atajoDe(evento({ key: 'Enter', foco: 'INPUT', buscador: true }))).toBe('agregarPrimero')
  })

  it('Enter en cualquier OTRO campo no dispara nada: confirma ese campo', () => {
    // El precio manual, «Paga con», el CUIT, el nombre del cliente.
    for (const foco of FOCOS) {
      expect([foco, atajoDe(evento({ key: 'Enter', foco }))]).toEqual([foco, null])
    }
  })

  it('Ctrl+Enter y ⌘+Enter cobran desde cualquier campo, incluido el CUIT', () => {
    for (const foco of FOCOS) {
      expect([foco, atajoDe(evento({ key: 'Enter', foco, ctrlKey: true }))]).toEqual([foco, 'cobrar'])
      expect([foco, atajoDe(evento({ key: 'Enter', foco, metaKey: true }))]).toEqual([foco, 'cobrar'])
    }
  })
})

describe('/ · el atajo que no se roba una tecla que se está tipeando', () => {
  it('/ dentro de un campo de texto NO se roba la tecla', () => {
    // Escenarios 2.2 y 2.3: el foco ya en la búsqueda con texto escrito, y el
    // foco en «Paga con». En los dos casos se escribe una barra.
    for (const foco of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect([foco, atajoDe(evento({ key: '/', foco }))]).toEqual([foco, null])
      expect([foco, atajoDe(evento({ key: '/', foco, buscador: true }))]).toEqual([foco, null])
    }
  })

  it('/ fuera de todo campo lleva el foco a la búsqueda', () => {
    expect(atajoDe(evento({ key: '/', foco: 'BODY' }))).toBe('enfocarBusqueda')
    expect(atajoDe(evento({ key: '/', foco: 'DIV' }))).toBe('enfocarBusqueda')
    expect(atajoDe(evento({ key: '/', foco: 'BUTTON' }))).toBe('enfocarBusqueda')
  })

  it('/ dentro de un bloque editable tampoco mueve el foco', () => {
    const e = evento({ key: '/', foco: 'DIV' })
    e.target.isContentEditable = true

    expect(atajoDe(e)).toBeNull()
  })
})

describe('Esc · pide limpiar; qué se limpia lo decide la pantalla', () => {
  it('Esc a secas pide limpiar desde donde sea', () => {
    for (const foco of FOCOS) {
      expect([foco, atajoDe(evento({ key: 'Escape', foco }))]).toEqual([foco, 'limpiar'])
    }
  })

  it('un navegador que manda «Esc» en vez de «Escape» funciona igual', () => {
    expect(atajoDe(evento({ key: 'Esc' }))).toBe('limpiar')
  })
})

describe('Los dos filtros que van primero', () => {
  it('ningún atajo se dispara si otro control ya usó la tecla', () => {
    // El `Esc` de un diálogo abierto, o el de un `<select>` desplegado
    // (escenario 2.13). El control lo procesó y llamó a `preventDefault`.
    for (const key of TECLAS) {
      for (const [nombre, mods] of MODIFICADORES) {
        const e = { ...evento({ key, ...mods }), defaultPrevented: true }
        expect([key, nombre, atajoDe(e)]).toEqual([key, nombre, null])
      }
    }
  })

  it('ningún atajo se dispara con Alt o Shift', () => {
    // Una combinación del sistema operativo o del navegador no puede terminar
    // cobrando una venta (FR-039).
    for (const key of TECLAS) {
      for (const foco of FOCOS) {
        for (const mods of [{ altKey: true }, { shiftKey: true }, { altKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true }]) {
          expect([key, foco, JSON.stringify(mods), atajoDe(evento({ key, foco, buscador: true, ...mods }))])
            .toEqual([key, foco, JSON.stringify(mods), null])
        }
      }
    }
  })
})

describe('La tabla completa: cuatro teclas × cinco modificadores × cuatro focos', () => {
  /** Lo que tiene que devolver cada combinación, escrito aparte de la función. */
  function esperado(key, modificador, foco, buscador) {
    if (modificador === 'Alt' || modificador === 'Shift') return null

    if (key === 'Enter') {
      if (modificador === 'Ctrl' || modificador === 'Meta') return 'cobrar'
      return buscador ? 'agregarPrimero' : null
    }

    if (modificador !== 'nada') return null

    if (key === '/') return ['INPUT', 'TEXTAREA', 'SELECT'].includes(foco) ? null : 'enfocarBusqueda'
    if (key === 'Escape') return 'limpiar'

    return null
  }

  it('las 160 combinaciones devuelven lo que dice la tabla', () => {
    const desvios = []

    for (const key of TECLAS) {
      for (const [modificador, mods] of MODIFICADORES) {
        for (const foco of FOCOS) {
          for (const buscador of [true, false]) {
            const obtenido = atajoDe(evento({ key, foco, buscador, ...mods }))
            const debido = esperado(key, modificador, foco, buscador)

            if (obtenido !== debido) {
              desvios.push(`${key} + ${modificador} en ${foco}${buscador ? ' (buscador)' : ''}: ${obtenido} en vez de ${debido}`)
            }
          }
        }
      }
    }

    expect(desvios).toEqual([])
  })

  it('una tecla cualquiera no dispara nada', () => {
    for (const key of ['a', 'F1', ' ', 'ArrowDown', 'Backspace', 'Tab']) {
      expect([key, atajoDe(evento({ key }))]).toEqual([key, null])
    }
  })

  it('sin evento, sin tecla y sin destino devuelve null y no explota', () => {
    expect(atajoDe(undefined)).toBeNull()
    expect(atajoDe(null)).toBeNull()
    expect(atajoDe({})).toBeNull()
    expect(atajoDe({ key: '/' })).toBe('enfocarBusqueda')
  })
})

describe('El campo de búsqueda y la regla usan la misma marca', () => {
  it('el atributo que exporta el módulo es el que lee dataset', () => {
    // Si el componente escribiera `data-buscador` y la regla leyera
    // `buscadorDelPos`, `Enter` en la búsqueda no agregaría nada y no habría
    // ningún error: simplemente no pasaría nada.
    expect(ATRIBUTO_BUSCADOR).toBe('data-buscador-del-pos')

    const enCamelCase = ATRIBUTO_BUSCADOR
      .replace(/^data-/, '')
      .replace(/-([a-z])/g, (_, letra) => letra.toUpperCase())

    const e = evento({ key: 'Enter', foco: 'INPUT' })
    e.target.dataset = { [enCamelCase]: '' }

    expect(atajoDe(e)).toBe('agregarPrimero')
  })
})

// ════════════════════════════════════════════
//  FR-036 · `Esc` sabe en qué campo está el foco
//
//  El atajo estaba definido SOLO sobre la búsqueda: apretar `Esc` en el CUIT o
//  en «Paga con» no limpiaba nada y —si la búsqueda estaba vacía— abría la
//  confirmación de vaciado del ticket, que es lo contrario de lo que pide el
//  requisito. `campoLimpiable` es lo que le da a la pantalla el dato que le
//  faltaba, sin que la regla deje de ser pura.
// ════════════════════════════════════════════

describe('Esc sabe qué campo tiene el foco', () => {
  it('el atributo que exporta el módulo es el que lee dataset', () => {
    // El mismo defecto silencioso que el del buscador: si el campo escribiera
    // una cosa y la regla leyera otra, `Esc` no limpiaría nada y no habría
    // ningún error.
    expect(ATRIBUTO_CAMPO).toBe('data-campo-del-pos')
    expect(ATRIBUTO_LINEA).toBe('data-linea-del-pos')
  })

  it('un campo marcado se reconoce, con su línea si la tiene', () => {
    const e = evento({ key: 'Escape', foco: 'INPUT' })
    e.target.dataset = { campoDelPos: 'precioDeLinea', lineaDelPos: '10' }

    expect(campoLimpiable(e)).toEqual({ nombre: 'precioDeLinea', linea: '10' })
  })

  it('la búsqueda NO es un campo limpiable: su Esc lo resuelve la pantalla', () => {
    // La búsqueda tiene su propia marca y su propio comportamiento —limpiar el
    // campo y quedarse ahí—, así que no entra por este camino.
    const e = evento({ key: 'Escape', foco: 'INPUT' })
    e.target.dataset = { buscadorDelPos: '' }

    expect(campoLimpiable(e)).toBeNull()
  })

  it('fuera de todo campo no hay nada que limpiar', () => {
    expect(campoLimpiable(evento({ key: 'Escape', foco: 'BODY' }))).toBeNull()
    expect(campoLimpiable(undefined)).toBeNull()
    expect(campoLimpiable({})).toBeNull()
  })
})
