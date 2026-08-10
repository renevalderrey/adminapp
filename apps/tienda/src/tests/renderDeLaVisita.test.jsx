import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import App from '../App.jsx'
import { desmontarTodo, dibujar, tocar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  La visita entera, contada en llamadas
//
//  Los otros tres archivos de render prueban cada pantalla por separado, con los
//  datos puestos a mano. Éste prueba lo que ninguno de ellos ve: que las
//  pantallas estén **conectadas**, y sobre todo **cuántas peticiones cuesta una
//  visita normal** (FR-114; el número que T1450 escribe en `OPERACION.md` sale de
//  acá).
//
//  El corte importa: una suite donde cada pantalla pasa sola y nadie mira el
//  total es una suite que no ve la regresión que importa —abrir una ficha que
//  vuelve a pedir el producto que ya estaba descargado, un `useEffect` que
//  recarga el catálogo al volver del carrito—. Ninguna de esas dos rompe una
//  pantalla; las dos rompen la visita, y del otro lado hay datos móviles.
// ════════════════════════════════════════════

const DATOS = {
  estado: 'publicado',
  catalogo: {
    nombre: 'Comprafit / Fitnet',
    // El negro de la maqueta: sirve además para verificar que el texto de encima
    // se calcula y no se elige (FR-060).
    color: '#101418',
    descripcion: 'Suplementos con precio de socio.',
  },
  categorias: [{ categoria: 'proteinas', etiqueta: 'Proteínas', productos: 1 }],
  productos: [{ id: 1, nombre: 'Whey 1kg', marca: 'ENA', categoria: 'Proteínas', precio: 38868, agotado: false }],
  total: 1,
  pagina: 1,
  hay_mas: false,
}

const contesta = (estado, cuerpo) => ({ ok: estado < 400, status: estado, json: async () => cuerpo })

let llamadas

beforeEach(() => {
  llamadas = []
  localStorage.clear()
  sessionStorage.clear()
  window.history.pushState({}, '', '/c/comprafit-fitnet?f=qr')
  globalThis.fetch = vi.fn((url) => {
    llamadas.push(url)
    return Promise.resolve(contesta(200, { ok: true, data: DATOS }))
  })
})

afterEach(() => {
  desmontarTodo()
  vi.restoreAllMocks()
})

/** Deja que se asiente la respuesta que quedó en vuelo. */
const asentar = () => act(async () => {})

describe('visita · el catálogo se abre con UNA llamada y no vuelve a pedir nada', () => {
  it('cargando primero, catálogo después, y el origen del QR viaja una sola vez', async () => {
    const p = dibujar(<App />)

    // Antes de que conteste el servidor: la silueta, no una pantalla en blanco.
    expect(p.ver('[data-estado="cargando"]')).not.toBeNull()

    await asentar()

    expect(llamadas).toEqual(['/api/publico/c/comprafit-fitnet?f=qr'])
    expect(p.ver('[data-pantalla="catalogo"]')).not.toBeNull()
    expect(p.texto()).toContain('Comprafit / Fitnet')
  })

  it('el tema del comercio queda escrito en la raíz, con su color de texto calculado', async () => {
    dibujar(<App />)
    await asentar()

    const raiz = document.documentElement.style
    expect(raiz.getPropertyValue('--marca')).toBe('#101418')
    // Sobre negro, el texto sale claro. No es una elección: lo mide `textoSobre`.
    expect(raiz.getPropertyValue('--marca-texto')).toBe('#FFFFFF')
    // Y los neutros llegan en la misma pasada: una pantalla con `--marca` puesta
    // y `--borde` sin poner se dibuja sin bordes y **no falla**.
    expect(raiz.getPropertyValue('--borde')).toBe('#E5E8EA')
  })

  // ⚠ El recorrido completo del corte: catálogo → ficha → agregar → carrito.
  // **Una** llamada en total.
  it('abrir la ficha, agregar y llegar al carrito no cuesta ni una petición más', async () => {
    const p = dibujar(<App />)
    await asentar()

    tocar(p.porTexto('Whey 1kg', 'button'))
    expect(p.ver('[data-pantalla="producto"]')).not.toBeNull()
    expect(p.texto()).toContain('$38.868')

    tocar(p.ver('[data-agregar]'))

    // Agregar devuelve al catálogo, y ahora la barra del pedido está.
    expect(p.ver('[data-pantalla="catalogo"]')).not.toBeNull()
    expect(p.ver('[data-barra-carrito]').textContent).toContain('1 producto')

    tocar(p.ver('[data-barra-carrito]'))
    expect(p.ver('[data-pantalla="carrito"]')).not.toBeNull()

    expect(llamadas).toHaveLength(1)
  })

  it('el carrito sin líneas es el estado, no una pantalla vacía', async () => {
    window.history.pushState({}, '', '/carrito')
    sessionStorage.setItem('favalio.slug', 'comprafit-fitnet')

    const p = dibujar(<App />)
    await asentar()

    expect(p.ver('[data-estado="carrito_vacio"]')).not.toBeNull()
    expect(p.texto()).toContain('Tu pedido está vacío')
  })
})

describe('visita · cada respuesta del servidor cae en su pantalla', () => {
  const abrirCon = async (respuesta) => {
    globalThis.fetch = vi.fn(() => Promise.resolve(respuesta))
    const p = dibujar(<App />)
    await asentar()
    return p
  }

  // ⚠ `pausado` **no trae** `productos` ni `categorias`: las claves no vienen
  // vacías, no están. El corte tiene que pasar antes de que ninguna pantalla las
  // lea, o la tienda revienta con un `undefined.filter`.
  it('pausado, sin productos en la respuesta, no revienta', async () => {
    const p = await abrirCon(
      contesta(200, {
        ok: true,
        data: { estado: 'pausado', catalogo: { nombre: 'Comprafit', color: '#00B4B6', whatsapp: '1144029915' } },
      })
    )
    expect(p.ver('[data-estado="pausado"]')).not.toBeNull()
  })

  it('no_disponible tampoco, y sigue sin nombrar la suscripción', async () => {
    const p = await abrirCon(
      contesta(200, { ok: true, data: { estado: 'no_disponible', catalogo: { nombre: 'Comprafit', color: '#00B4B6' } } })
    )
    expect(p.ver('[data-estado="no_disponible"]')).not.toBeNull()
    expect(p.texto().toLowerCase()).not.toContain('suscrip')
  })

  it('el 429 cae en el estado que invita a reintentar, no en una pantalla en blanco', async () => {
    const p = await abrirCon(contesta(429, { ok: false, error: 'DEMASIADAS_PETICIONES' }))
    expect(p.ver('[data-estado="demasiadas_peticiones"]')).not.toBeNull()
  })

  it('el 404 dice que el enlace no lleva a ninguna tienda', async () => {
    const p = await abrirCon(contesta(404, { ok: false, error: 'NO_ENCONTRADO' }))
    expect(p.ver('[data-estado="no_encontrada"]')).not.toBeNull()
  })

  it('quedarse sin señal no acusa al comercio', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    const p = dibujar(<App />)
    await asentar()

    expect(p.ver('[data-estado="no_disponible"]')).not.toBeNull()
    expect(p.texto().toLowerCase()).not.toContain('pago')
  })
})
