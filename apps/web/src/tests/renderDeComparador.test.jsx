import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import useStore from '@/store/useStore'
import api from '@/services/api'
import Comparador from '@/pages/Comparador'

// ════════════════════════════════════════════
//  ADMINAPP · Comparador de proveedores, renderizado
//
//  ── Por qué esta pantalla necesitaba tests antes que ninguna otra ──
//
//  `REGLAS-DISENO.md` y `CONVENCIONES.md` **mandan copiar de acá**: es la
//  referencia viva del sistema de diseño. Y era, hasta el hito 9, **una de las
//  dos únicas pantallas sin ningún test de render** — la otra es Faltantes, que
//  hay que reescribir entera.
//
//  Cada desvío de esta pantalla es un desvío con interés compuesto: la próxima
//  la copia creyendo que es la regla.
//
//  ── Los tres defectos que se ven acá ──
//
//   1. **Afirmaba un vacío que todavía no sabía.** `cargando` arrancaba en
//      `false` y el vacío se dibujaba antes que la carga, así que entre el
//      montaje y la respuesta la pantalla decía «Todavía no cargaste ninguna
//      lista» **al lado de su propio spinner**. Le decía al usuario que su
//      sistema estaba vacío justo cuando se estaba formando la primera
//      impresión. `pages/Expenses.jsx` ya lo había resuelto con siete líneas de
//      comentario: la corrección existía y no se había llevado a las otras.
//
//   2. **Le escondía al usuario el botón que su propio texto le pedía apretar.**
//      El estado vacío dice «Pegá la lista de precios que te manda cada
//      proveedor» y el `<Can>` sacaba de la pantalla el único botón que hace
//      eso. La regla del sistema es **deshabilitar con el motivo**, no esconder.
//
//   3. **Mostraba el código de máquina del error.** Los cuatro `catch` hacían
//      `toast.error(err.response?.data?.error)`, y en un 403 ese campo es
//      literalmente `FORBIDDEN`.
// ════════════════════════════════════════════

const EMPRESA = { id: 1, name: 'Comprafit', puntosDeVenta: [{ id: 1, name: 'Ortiz de Ocampo' }] }

const TODOS = ['proveedores.ver', 'proveedores.crear', 'proveedores.editar', 'proveedores.eliminar']

/** Lo que ve alguien que puede mirar el comparador pero no cargar listas. */
const SOLO_VER = ['proveedores.ver']

const LISTA = { id: 7, nombre: 'Distribuidora Norte', cantidad_items: 42, fecha: '2026-08-01', activa: true }

let resolverListas
const respuesta = (data) => Promise.resolve({ data })

/**
 * Monta el comparador.
 *
 * `listasPendientes` deja la promesa SIN resolver, que es lo único que permite
 * mirar el render intermedio: es el estado que el defecto 1 dibujaba mal y que
 * ninguna otra prueba de este repositorio ejercita.
 */
async function montar({ listas = [LISTA], permisos = TODOS, listasPendientes = false } = {}) {
  useStore.setState({ permisos, empresaActiva: EMPRESA })

  vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/comparador/listas') {
      if (listasPendientes) return new Promise((resolver) => { resolverListas = resolver })
      return respuesta({ ok: true, data: listas })
    }
    if (url === '/comparador') return respuesta({ ok: true, data: null })
    return respuesta({ ok: true, data: [] })
  })

  await act(async () => { render(<Comparador />) })
}

beforeEach(() => { resolverListas = null })
afterEach(() => { cleanup(); vi.restoreAllMocks(); useStore.setState({ permisos: [] }) })

describe('No afirma un vacío que todavía no sabe', () => {
  it('mientras las listas viajan NO dice «Todavía no cargaste ninguna lista»', async () => {
    // El render intermedio, que es donde vivía el defecto. Sin la guardia de
    // carga, este texto aparecía al lado del spinner durante toda la request.
    await montar({ listasPendientes: true })

    expect(screen.queryByText(/Todavía no cargaste ninguna lista/)).not.toBeInTheDocument()
  })

  it('y cuando llegan vacías, ahí SÍ lo dice', async () => {
    // Sin este caso, una pantalla que nunca dibujara el vacío pasaría el
    // anterior — y el usuario que de verdad no cargó nada se quedaría mirando
    // una tarjeta en blanco.
    await montar({ listas: [] })

    expect(screen.getByText(/Todavía no cargaste ninguna lista/)).toBeInTheDocument()
  })

  it('el vacío lleva su ícono, como manda el sistema', async () => {
    // El snippet de REGLAS-DISENO no tenía el ícono que su propio párrafo pedía,
    // y tres pantallas quedaron sin él. Lo que se copia es el snippet.
    const { container } = render(<div />)
    cleanup()

    await montar({ listas: [] })

    const vacio = screen.getByText(/Todavía no cargaste ninguna lista/).closest('div')
    expect(vacio.querySelector('svg')).not.toBeNull()
    expect(container).toBeDefined()
  })
})

describe('El botón que el texto del vacío pide apretar', () => {
  it('sin el permiso queda DESHABILITADO con su motivo, no escondido', async () => {
    await montar({ listas: [], permisos: SOLO_VER })

    const boton = screen.getByRole('button', { name: /Cargar lista/ })

    // Las dos mitades. Que exista es la que arregla el defecto: escondido, el
    // estado vacío pedía pegar una lista y no había con qué.
    expect(boton).toBeInTheDocument()
    expect(boton).toBeDisabled()

    // Y que el motivo NOMBRE el permiso: quien lee «no tenés permiso» no puede
    // pedir nada concreto.
    expect(boton.getAttribute('title')).toContain('proveedores.crear')
  })

  it('el motivo se puede leer: el botón NO sale del hit-testing', async () => {
    // `disabled:pointer-events-none` hace que el navegador nunca muestre el
    // `title`, o sea que apaga justamente la explicación. Es el defecto que el
    // bloque B del hito 9 corrigió en veinte lugares.
    await montar({ listas: [], permisos: SOLO_VER })

    const boton = screen.getByRole('button', { name: /Cargar lista/ })

    expect(boton.className).not.toContain('pointer-events-none')
    expect(boton.className).toContain('cursor-not-allowed')
  })

  it('con el permiso el botón funciona y no está deshabilitado', async () => {
    // Sin este caso, una corrección que dejara el botón siempre apagado pasaría
    // los dos anteriores y la pantalla quedaría sin forma de cargar una lista.
    await montar({ listas: [], permisos: TODOS })

    expect(screen.getByRole('button', { name: /Cargar lista/ })).not.toBeDisabled()
  })
})

describe('Los errores no se muestran como código de máquina', () => {
  it('ningún catch de la pantalla lee `data.error` crudo', async () => {
    // Guardia estática sobre el archivo, y no un test de comportamiento: los
    // cuatro `catch` están en caminos distintos —cargar, alternar, eliminar y
    // guardar— y montar los cuatro cuesta más que leer el archivo.
    //
    // En un 403 ese campo es literalmente `FORBIDDEN`, que es lo que el usuario
    // terminaba leyendo. `mensajeDeError` distingue un código de máquina de un
    // mensaje y usa el segundo.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')

    const aqui = path.dirname(url.fileURLToPath(import.meta.url))
    const texto = fs.readFileSync(path.join(aqui, '..', 'pages', 'Comparador.jsx'), 'utf8')

    const crudos = texto
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto: t }) => /data\?\.error\s*\|\|/.test(t) && !t.startsWith('//'))
      .map(({ n, texto: t }) => `L${n}: ${t}`)

    expect(crudos).toEqual([])

    // Ancla: que el archivo se haya leído de verdad y tenga los cuatro catch.
    expect(texto).toContain('mensajeDeError')
    expect((texto.match(/mensajeDeError\(/g) || []).length).toBeGreaterThanOrEqual(4)
  })
})
