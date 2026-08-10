import { describe, it, expect, afterEach } from 'vitest'
import Ficha from '../pantallas/Ficha.jsx'
import { CANTIDAD_MAXIMA } from '../carrito.js'
import { desmontarTodo, dibujar, tocar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  T1445 · La ficha de producto
// ════════════════════════════════════════════

const WHEY = {
  id: 1,
  nombre: 'Whey Protein Isolate 1kg',
  marca: 'ENA',
  categoria: 'Proteínas',
  descripcion: 'Aislado de suero, 27 g de proteína por porción.',
  precio: 38868,
  precio_lista: 45000,
  ahorro_pct: 14,
  agotado: false,
}

const CATALOGO = { nombre: 'Comprafit / Fitnet', color: '#00B4B6' }

afterEach(() => desmontarTodo())

const montar = (producto, alAgregar = () => {}) =>
  dibujar(<Ficha producto={producto} catalogo={CATALOGO} alVolver={() => {}} alAgregar={alAgregar} />)

describe('ficha · lo que se lee', () => {
  it('la foto, la marca, el nombre, el precio y la descripción', () => {
    const p = montar(WHEY)

    expect(p.ver('[data-marca]').textContent).toBe('ENA')
    expect(p.ver('h1').textContent).toBe('Whey Protein Isolate 1kg')
    expect(p.texto()).toContain('$38.868')
    expect(p.ver('[data-precio-lista]').textContent).toBe('$45.000')
    expect(p.ver('[data-ahorro]').textContent).toBe('14% de ahorro')
    expect(p.ver('[data-descripcion]').textContent).toContain('Aislado de suero')
  })

  // ⚠ Un `<p>` vacío deja un hueco de veinte píxeles entre el precio y la
  // cantidad, y se lee como «acá iba algo y no cargó».
  it('la descripción está AUSENTE cuando el producto no tiene: no queda un hueco', () => {
    const sinDescripcion = { id: 2, nombre: 'Shaker 600ml', precio: 4800, agotado: false }
    const p = montar(sinDescripcion)

    expect('descripcion' in sinDescripcion).toBe(false)
    expect(p.ver('[data-descripcion]')).toBeNull()
    expect(p.texto()).not.toContain('undefined')
  })

  it('un producto sin marca no dibuja el renglón de la marca', () => {
    const p = montar({ id: 2, nombre: 'Shaker 600ml', precio: 4800, agotado: false })
    expect(p.ver('[data-marca]')).toBeNull()
    expect(p.texto()).not.toContain('undefined')
  })

  it('se abre como pantalla completa, con volver', () => {
    const p = montar(WHEY)
    expect(p.ver('[data-pantalla="producto"]')).not.toBeNull()
    expect(p.ver('[data-volver]')).not.toBeNull()
    expect(p.texto()).toContain('Volver al catálogo')
  })

  it('lleva el pie, como todas las pantallas (FR-122)', () => {
    expect(montar(WHEY).ver('[data-pie="favalio"]').textContent).toContain('powered by favalio')
  })
})

describe('ficha · el control de cantidad', () => {
  const cantidad = (p) => Number(p.ver('[data-cantidad="valor"]').textContent)

  it('arranca en uno y sube de a uno', () => {
    const p = montar(WHEY)
    expect(cantidad(p)).toBe(1)

    tocar(p.ver('[data-cantidad="mas"]'))
    tocar(p.ver('[data-cantidad="mas"]'))
    expect(cantidad(p)).toBe(3)

    tocar(p.ver('[data-cantidad="menos"]'))
    expect(cantidad(p)).toBe(2)
  })

  it('no baja de uno: el «quitar» del carrito no vive acá', () => {
    const p = montar(WHEY)
    tocar(p.ver('[data-cantidad="menos"]'))
    tocar(p.ver('[data-cantidad="menos"]'))
    expect(cantidad(p)).toBe(1)
    expect(p.ver('[data-cantidad="menos"]').disabled).toBe(true)
  })

  // ⚠ **El test que evita el defecto.** Qué se revierte para verlo en rojo:
  // sacarle el tope al control.
  it('el control no deja pedir más de lo que hay', () => {
    const p = montar({ ...WHEY, stock_disponible: 3 })

    for (let i = 0; i < 8; i += 1) tocar(p.ver('[data-cantidad="mas"]'))

    expect(cantidad(p)).toBe(3)
    expect(p.ver('[data-cantidad="mas"]').disabled).toBe(true)
  })

  it('y lo que se agrega es la cantidad acotada, no la que se apretó', () => {
    const agregados = []
    const p = montar({ ...WHEY, stock_disponible: 2 }, (prod, n) => agregados.push([prod.id, n]))

    for (let i = 0; i < 6; i += 1) tocar(p.ver('[data-cantidad="mas"]'))
    tocar(p.ver('[data-agregar]'))

    expect(agregados).toEqual([[1, 2]])
  })

  // ⚠ La API implementada **no manda `stock_disponible`** todavía
  // (`utils/vistaPublica.js:90-116`), aunque el contrato lo declare. Sin el
  // campo, el tope es el techo duro —el mismo que el servidor rechaza con
  // `ITEMS_INVALIDOS`—, no cero: si fuera cero, la ficha de cualquier producto
  // saldría con el «más» deshabilitado y nadie podría comprar nada.
  it('sin `stock_disponible` el tope es el techo duro, no cero', () => {
    const p = montar(WHEY)
    expect('stock_disponible' in WHEY).toBe(false)
    expect(p.ver('[data-cantidad="mas"]').disabled).toBe(false)
    expect(CANTIDAD_MAXIMA).toBe(999)
  })
})

describe('ficha · el botón de agregar', () => {
  it('agrega el producto con la cantidad elegida', () => {
    const agregados = []
    const p = montar(WHEY, (prod, n) => agregados.push([prod.id, n]))

    tocar(p.ver('[data-cantidad="mas"]'))
    tocar(p.ver('[data-agregar]'))

    expect(agregados).toEqual([[1, 2]])
  })

  // ⚠ **El test que evita el defecto.** Qué se revierte para verlo en rojo:
  // sacarle el `disabled` al botón. Este caso registra la llamada al carrito.
  it('el botón «Sin stock» no dispara nada', () => {
    const agregados = []
    const p = montar({ ...WHEY, agotado: true }, (prod, n) => agregados.push([prod.id, n]))

    const boton = p.ver('[data-agregar]')
    expect(boton.textContent).toBe('Sin stock')

    // El clic primero, y la afirmación sobre **la llamada al carrito**: es la que
    // se pone en rojo con la reversión completa. Si el `disabled` se afirmara
    // antes, el caso cortaría ahí y nunca llegaría a probar lo que importa —que
    // el botón sea inerte, no que tenga un atributo—.
    tocar(boton)
    expect(agregados).toEqual([])

    // Y además el atributo, que es lo que hace que el navegador no lo ofrezca al
    // teclado ni al lector de pantalla.
    expect(boton.disabled).toBe(true)
  })

  it('con el producto agotado el control de cantidad también queda quieto', () => {
    const p = montar({ ...WHEY, agotado: true })
    expect(p.ver('[data-cantidad="mas"]').disabled).toBe(true)
    expect(p.ver('[data-cantidad="menos"]').disabled).toBe(true)
  })
})
