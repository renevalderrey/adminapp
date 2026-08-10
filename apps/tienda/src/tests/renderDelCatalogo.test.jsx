import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Catalogo from '../pantallas/Catalogo.jsx'
import { desmontarTodo, dibujar, escribir, tocar, tocarYEsperar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  T1444 · La pantalla del catálogo
//
//  El caso que ordena este archivo es el primero: **escribir en el buscador no
//  dispara ninguna llamada al servidor**. Se verifica contando, no leyendo el
//  código: `fetch` está espiado y la afirmación es sobre el contador.
// ════════════════════════════════════════════

const PRODUCTOS = [
  { id: 1, nombre: 'Whey Protein Isolate 1kg', marca: 'ENA', categoria: 'Proteínas', precio: 38868, agotado: false },
  // ⚠ Sin marca y sin foto: es el producto normal, no el raro. El 96 % de los
  // migrables no tiene marca, y la clave viene **ausente**.
  { id: 2, nombre: 'Barra proteica chocolate 60g', categoria: 'Snacks', precio: 1200, agotado: false },
  { id: 3, nombre: 'Creatina monohidrato 300g', marca: 'Gentech', categoria: 'Creatinas', precio: 24500, agotado: true },
  {
    id: 4,
    nombre: 'Shaker 600ml',
    categoria: 'Accesorios',
    precio: 4800,
    precio_lista: 6000,
    ahorro_pct: 20,
    agotado: false,
  },
]

const CATEGORIAS = [
  { categoria: 'proteinas', etiqueta: 'Proteínas', productos: 1 },
  { categoria: 'snacks', etiqueta: 'Snacks', productos: 1 },
  { categoria: 'creatinas', etiqueta: 'Creatinas', productos: 1 },
  { categoria: 'accesorios', etiqueta: 'Accesorios', productos: 1 },
]

const DATOS = {
  estado: 'publicado',
  catalogo: {
    nombre: 'Comprafit / Fitnet',
    color: '#00B4B6',
    descripcion: 'Suplementos con precio de socio para los que entrenan en Fitnet.',
    whatsapp: '11 4402 9915',
  },
  categorias: CATEGORIAS,
  productos: PRODUCTOS,
  total: 4,
  pagina: 1,
  hay_mas: false,
}

/** Lo que devuelve la segunda página en estos casos. */
const PAGINA_DOS = [{ id: 5, nombre: 'Glutamina 500g', marca: 'Star Nutrition', categoria: 'Aminoácidos', precio: 19900, agotado: false }]

let llamadas

beforeEach(() => {
  llamadas = []
  globalThis.fetch = vi.fn((url) => {
    llamadas.push(url)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { estado: 'publicado', productos: PAGINA_DOS, total: 5, pagina: 2, hay_mas: false },
      }),
    })
  })
})

afterEach(() => {
  desmontarTodo()
  vi.restoreAllMocks()
})

const montar = (extra = {}) =>
  dibujar(
    <Catalogo
      slug="comprafit-fitnet"
      datos={{ ...DATOS, ...extra }}
      alAbrirProducto={extra.alAbrirProducto || (() => {})}
      alAgregar={extra.alAgregar || (() => {})}
      alIrAlCarrito={extra.alIrAlCarrito || (() => {})}
      unidades={extra.unidades || 0}
    />
  )

describe('catálogo · el filtrado se hace en el navegador (FR-114)', () => {
  // ⚠ **El test que evita el defecto.** Qué se revierte para verlo en rojo: hacer
  // que el buscador pida al servidor por tecla. Este caso cuenta las llamadas.
  it('escribir en el buscador NO dispara ninguna llamada al servidor', () => {
    const p = montar()
    const buscador = p.ver('input[type="search"]')

    for (const texto of ['w', 'wh', 'whe', 'whey']) escribir(buscador, texto)

    expect(llamadas).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('cambiar de categoría tampoco: el filtro es sobre la página que ya vino embebida', () => {
    const p = montar()
    tocar(p.porTexto('Snacks'))
    tocar(p.porTexto('Creatinas'))
    tocar(p.porTexto('Todos'))

    expect(llamadas).toEqual([])
  })

  it('el buscador filtra de verdad, sobre nombre y marca', () => {
    const p = montar()
    escribir(p.ver('input[type="search"]'), 'whey')
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['1'])

    escribir(p.ver('input[type="search"]'), 'gentech')
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['3'])
  })

  it('la búsqueda ignora los acentos, en las dos direcciones', () => {
    const p = montar()
    escribir(p.ver('input[type="search"]'), 'protéina')
    expect(p.todos('[data-producto]')).toHaveLength(0)

    escribir(p.ver('input[type="search"]'), 'proteica')
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['2'])
  })

  it('la píldora de categoría usa la misma normalización que el servidor', () => {
    const p = montar()
    tocar(p.porTexto('Proteínas'))
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['1'])
  })

  it('elegir una categoría limpia la búsqueda: dos filtros a la vez no se ven', () => {
    const p = montar()
    escribir(p.ver('input[type="search"]'), 'whey')
    tocar(p.porTexto('Snacks'))

    expect(p.ver('input[type="search"]').value).toBe('')
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['2'])
  })
})

describe('catálogo · lo que se dibuja de cada producto', () => {
  // ⚠ **El segundo test que evita el defecto.**
  it('un producto sin marca no dibuja el renglón de la marca, y no dibuja «undefined»', () => {
    const p = montar()

    const conMarca = p.ver('[data-producto="1"]')
    const sinMarca = p.ver('[data-producto="2"]')

    expect(conMarca.querySelector('[data-marca]').textContent).toBe('ENA')
    expect(sinMarca.querySelector('[data-marca]')).toBeNull()
    expect(p.texto()).not.toContain('undefined')
    expect(p.texto()).not.toContain('null')
  })

  it('el precio sale formateado y el tachado solo cuando el servidor lo mandó', () => {
    const p = montar()

    expect(p.ver('[data-producto="1"]').textContent).toContain('$38.868')
    expect(p.ver('[data-producto="1"]').querySelector('[data-precio-lista]')).toBeNull()
    expect(p.ver('[data-producto="4"]').querySelector('[data-precio-lista]').textContent).toBe('$6.000')
  })

  it('el agotado lleva su sello y su botón inerte; el disponible, el de agregar', () => {
    const agregados = []
    const p = montar({ alAgregar: (prod) => agregados.push(prod.id) })

    const agotado = p.ver('[data-producto="3"]')
    expect(agotado.querySelector('[data-agotado]').textContent).toBe('Agotado')

    const boton = Array.from(agotado.querySelectorAll('button')).find((b) => b.textContent === 'Sin stock')
    expect(boton.disabled).toBe(true)
    tocar(boton)
    expect(agregados).toEqual([])

    const bueno = p.ver('[data-producto="1"]')
    tocar(Array.from(bueno.querySelectorAll('button')).find((b) => b.textContent === 'Agregar'))
    expect(agregados).toEqual([1])
  })

  it('tocar el nombre abre la ficha', () => {
    const abiertos = []
    const p = montar({ alAbrirProducto: (prod) => abiertos.push(prod.id) })
    tocar(p.porTexto('Whey Protein Isolate 1kg', 'button'))
    expect(abiertos).toEqual([1])
  })
})

describe('catálogo · el vacío no termina en un cartel', () => {
  it('una búsqueda sin resultados ofrece la categoría más parecida', () => {
    const p = montar()
    escribir(p.ver('input[type="search"]'), 'creatnia')

    expect(p.ver('[data-estado="sin_resultados"]')).not.toBeNull()
    expect(p.texto()).toContain('No encontramos «creatnia»')
    expect(p.porTexto('Ver Creatinas')).toBeTruthy()
  })

  it('y el botón de la sugerencia deja el catálogo en esa categoría, sin pedir nada', () => {
    const p = montar()
    escribir(p.ver('input[type="search"]'), 'creatnia')
    tocar(p.porTexto('Ver Creatinas'))

    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['3'])
    expect(llamadas).toEqual([])
  })

  it('«limpiar» devuelve el catálogo entero', () => {
    const p = montar()
    escribir(p.ver('input[type="search"]'), 'creatnia')
    tocar(p.porTexto('Limpiar'))
    expect(p.todos('[data-producto]')).toHaveLength(4)
  })
})

describe('catálogo · «ver más» es la única llamada de esta pantalla', () => {
  it('no se dibuja cuando el servidor dijo que no hay más', () => {
    const p = montar()
    expect(p.ver('[data-ver-mas]')).toBeNull()
  })

  it('se dibuja cuando hay más, y recién ahí se llama al servidor', async () => {
    const p = montar({ hay_mas: true })
    expect(llamadas).toEqual([])

    await tocarYEsperar(p.ver('[data-ver-mas]'))

    expect(llamadas).toEqual(['/api/publico/c/comprafit-fitnet/productos?pagina=2'])
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('la página siguiente se pide SIN el filtro: la lista acumulada queda completa', async () => {
    const p = montar({ hay_mas: true })
    escribir(p.ver('input[type="search"]'), 'whey')

    await tocarYEsperar(p.ver('[data-ver-mas]'))

    expect(llamadas).toEqual(['/api/publico/c/comprafit-fitnet/productos?pagina=2'])

    // Con el filtro puesto se sigue viendo solo lo que coincide…
    expect(p.todos('[data-producto]').map((n) => n.dataset.producto)).toEqual(['1'])

    // …y al borrarlo aparece todo lo acumulado, incluida la página nueva. Si la
    // página se hubiera pedido filtrada, acá faltarían los otros cuatro.
    escribir(p.ver('input[type="search"]'), '')
    expect(p.todos('[data-producto]')).toHaveLength(5)
  })

  it('el servidor que no contesta no vacía la grilla: lo descargado se queda', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    const p = montar({ hay_mas: true })

    await tocarYEsperar(p.ver('[data-ver-mas]'))

    expect(p.todos('[data-producto]')).toHaveLength(4)
    expect(p.texto()).toContain('No pudimos traer más productos')
    expect(p.ver('[data-ver-mas]')).not.toBeNull()
  })
})

describe('catálogo · la portada, el pie y la barra', () => {
  it('el pie «powered by favalio» está (FR-122)', () => {
    const p = montar()
    expect(p.ver('[data-pie="favalio"]').textContent).toContain('powered by favalio')
  })

  it('el nombre y la descripción del comercio se leen arriba de todo', () => {
    const p = montar()
    expect(p.ver('h1').textContent).toBe('Comprafit / Fitnet')
    expect(p.texto()).toContain('Suplementos con precio de socio')
  })

  it('la barra del carrito aparece solo cuando hay algo adentro', () => {
    expect(montar({ unidades: 0 }).ver('[data-barra-carrito]')).toBeNull()

    const conCosas = montar({ unidades: 3 })
    expect(conCosas.ver('[data-barra-carrito]').textContent).toContain('3 productos')
  })

  it('la grilla es la de dos columnas que en escritorio sube a tres, dentro de los mismos 720px', () => {
    const p = montar()
    expect(p.ver('.t-grilla')).not.toBeNull()
    expect(p.ver('.t-ancho')).not.toBeNull()
  })
})
