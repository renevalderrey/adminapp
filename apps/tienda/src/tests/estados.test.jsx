import { describe, it, expect, afterEach, vi } from 'vitest'
import Cargando from '../estados/Cargando.jsx'
import CarritoVacio from '../estados/CarritoVacio.jsx'
import DemasiadasPeticiones from '../estados/DemasiadasPeticiones.jsx'
import PagoRechazado from '../estados/PagoRechazado.jsx'
import SeAgoto from '../estados/SeAgoto.jsx'
import SinResultados from '../estados/SinResultados.jsx'
import { NoDisponible, NoEncontrada, Pausada, enlaceDeWhatsapp } from '../estados/CatalogoDetenido.jsx'
import { desmontarTodo, dibujar, tocar } from './ayudaDeRender.jsx'

// ════════════════════════════════════════════
//  T1446 · Los estados
//
//  El caso que ordena este archivo es el último: **ninguno cae en la pantalla
//  genérica**. Se verifica comparando los textos entre sí, no leyéndolos de a uno:
//  un estado que copia el mensaje de otro pasa cualquier test que lo mire solo.
// ════════════════════════════════════════════

const CATALOGO = {
  nombre: 'Comprafit / Fitnet',
  color: '#00B4B6',
  descripcion: 'Suplementos con precio de socio.',
  whatsapp: '+54 9 351 456-7890',
}

const CATEGORIAS = [
  { categoria: 'proteinas', etiqueta: 'Proteínas' },
  { categoria: 'creatinas', etiqueta: 'Creatinas' },
]

afterEach(() => desmontarTodo())

describe('estados · cargando dibuja la silueta del catálogo, no un spinner', () => {
  it('la silueta tiene las piezas de la pantalla que va a llegar', () => {
    const p = dibujar(<Cargando />)

    // Portada, grilla y tarjetas: si la silueta no coincide con el catálogo real,
    // el momento en que llegan los datos se ve como un salto.
    expect(p.ver('[data-estado="cargando"]')).not.toBeNull()
    expect(p.ver('.t-grilla')).not.toBeNull()
    expect(p.todos('.t-esqueleto').length).toBeGreaterThanOrEqual(5)
  })

  it('quien no ve la pantalla igual se entera de que está cargando', () => {
    const p = dibujar(<Cargando />)
    const aviso = p.ver('[role="status"]')
    expect(aviso.textContent).toContain('Estamos abriendo el catálogo')
    expect(aviso.getAttribute('aria-live')).toBe('polite')
  })

  // ⚠ El servidor puede tardar decenas de segundos en despertar. La espera larga
  // tiene que tener una causa escrita, o se lee como una pantalla colgada.
  it('cuando la espera se estira, la demora se explica', () => {
    expect(dibujar(<Cargando />).ver('[data-tarda]')).toBeNull()
    expect(dibujar(<Cargando tardaDesdeElPrimerRender />).ver('[data-tarda]').textContent).toContain(
      'despertando la tienda'
    )
  })

  it('el reloj se apaga al desmontar: no queda un timeout escribiendo en un componente muerto', () => {
    const espia = vi.spyOn(globalThis, 'clearTimeout')
    dibujar(<Cargando />)
    desmontarTodo()

    expect(espia).toHaveBeenCalled()
    espia.mockRestore()
  })
})

describe('estados · catálogo pausado: la portada queda, apagada', () => {
  it('el socio reconoce que llegó al lugar correcto', () => {
    const p = dibujar(<Pausada catalogo={CATALOGO} />)

    expect(p.ver('[data-estado="pausado"]')).not.toBeNull()
    // La portada apagada es la mitad del estado: sin ella, la pantalla se lee
    // como «escaneaste mal» y manda a buscar otro QR que no existe.
    expect(p.ver('[data-portada="apagada"]')).not.toBeNull()
    expect(p.texto()).toContain('El catálogo está en pausa')
    expect(p.texto()).toContain('Comprafit / Fitnet')
  })

  it('y que el problema es temporal, con un canal para preguntar', () => {
    const p = dibujar(<Pausada catalogo={CATALOGO} />)
    const wa = p.porTexto('Escribir por WhatsApp')

    expect(wa.tagName).toBe('A')
    expect(wa.getAttribute('href')).toBe('https://wa.me/5493514567890')
  })

  it('sin WhatsApp cargado no se ofrece un canal que nadie está mirando', () => {
    const p = dibujar(<Pausada catalogo={{ nombre: 'Comprafit / Fitnet' }} />)
    expect(p.porTexto('Escribir por WhatsApp')).toBeUndefined()
    expect(p.texto()).toContain('El catálogo está en pausa')
  })

  it('el teléfono escrito a mano se limpia antes de armar el enlace', () => {
    expect(enlaceDeWhatsapp('11 4402-9915')).toBe('https://wa.me/1144029915')
    expect(enlaceDeWhatsapp('')).toBeNull()
    expect(enlaceDeWhatsapp(undefined)).toBeNull()
  })
})

describe('estados · no_disponible es neutro y no cuenta lo que no es asunto del socio', () => {
  // ⚠ **El test que evita el defecto.** Qué se revierte para verlo en rojo: hacer
  // que `no_disponible` reuse el texto del 402 de `apps/web`.
  //
  // El estado sale de una suscripción bloqueada (`catalogoPublico.js:118-123`).
  // Del otro lado hay un socio del gimnasio: contarle que el comercio está en
  // mora es filtrarle información del comercio a cualquiera que escanee el QR.
  it('no dice que el comercio está en mora', () => {
    const texto = dibujar(<NoDisponible catalogo={CATALOGO} />).texto().toLowerCase()

    expect(texto).not.toContain('suscripción')
    expect(texto).not.toContain('suscripcion')
    expect(texto).not.toContain('venci')
    expect(texto).not.toContain('pago')
    expect(texto).not.toContain('deuda')
  })

  it('comparte el camino con pausado pero no una sola palabra', () => {
    const pausado = dibujar(<Pausada catalogo={CATALOGO} />)
    const noDisponible = dibujar(<NoDisponible catalogo={CATALOGO} />)

    // El mismo camino: los dos dibujan la portada apagada y el mismo molde.
    expect(pausado.ver('[data-portada="apagada"]')).not.toBeNull()
    expect(noDisponible.ver('[data-portada="apagada"]')).not.toBeNull()

    // Y textos propios: uno promete que vuelve, el otro no promete nada.
    expect(noDisponible.texto()).not.toContain('El catálogo está en pausa')
    expect(noDisponible.texto()).toContain('El catálogo no está disponible')
    expect(noDisponible.porTexto('Escribir por WhatsApp')).toBeUndefined()
  })

  it('la tienda que no existe dice eso y no otra cosa', () => {
    const p = dibujar(<NoEncontrada />)
    expect(p.texto()).toContain('Este enlace no lleva a ninguna tienda')
  })
})

describe('estados · búsqueda sin resultados ofrece la categoría más parecida', () => {
  it('no termina en un cartel: sugiere y deja elegirla', () => {
    const elegidas = []
    const p = dibujar(
      <SinResultados
        consulta="creatnia"
        categorias={CATEGORIAS}
        alLimpiar={() => {}}
        alElegirCategoria={(c) => elegidas.push(c)}
      />
    )

    expect(p.texto()).toContain('No encontramos «creatnia»')
    expect(p.texto()).toContain('mirá la categoría Creatinas')

    tocar(p.porTexto('Ver Creatinas'))
    expect(elegidas).toEqual(['creatinas'])
  })

  it('cuando nada se parece, no se inventa una sugerencia', () => {
    const p = dibujar(
      <SinResultados consulta="zapatillas" categorias={CATEGORIAS} alLimpiar={() => {}} alElegirCategoria={() => {}} />
    )

    expect(p.texto()).toContain('Probá con el nombre del producto o con la marca')
    expect(p.porTexto('Ver Creatinas')).toBeUndefined()
    expect(p.porTexto('Limpiar')).toBeTruthy()
  })
})

describe('estados · carrito vacío', () => {
  it('el único camino posible es el botón que vuelve al catálogo', () => {
    const vueltas = []
    const p = dibujar(<CarritoVacio catalogo={CATALOGO} alVolverAlCatalogo={() => vueltas.push(1)} />)

    expect(p.texto()).toContain('Tu pedido está vacío')
    tocar(p.porTexto('Ver el catálogo'))
    expect(vueltas).toEqual([1])
  })

  // Sin barra inferior: no hay total que mostrar, y una barra con «$0» dibuja un
  // camino que no existe.
  it('no dibuja un total de cero', () => {
    const p = dibujar(<CarritoVacio catalogo={CATALOGO} alVolverAlCatalogo={() => {}} />)
    expect(p.texto()).not.toContain('$0')
  })
})

describe('estados · demasiadas peticiones invita a reintentar', () => {
  // ⚠ US10 escenario 10: **no es una pantalla en blanco**. Del otro lado casi
  // nunca hay un atacante: hay alguien que recargó cinco veces porque el catálogo
  // tardaba.
  it('tiene un botón que reintenta de verdad', () => {
    const intentos = []
    const p = dibujar(<DemasiadasPeticiones catalogo={CATALOGO} alReintentar={() => intentos.push(1)} />)

    expect(p.texto()).toContain('Demasiadas consultas seguidas')
    tocar(p.porTexto('Reintentar'))
    expect(intentos).toEqual([1])
  })

  it('dice cuánto esperar cuando el limitador lo mandó, y no promete un número cuando no', () => {
    expect(dibujar(<DemasiadasPeticiones segundos={30} alReintentar={() => {}} />).texto()).toContain('Esperá 30 segundos')
    expect(dibujar(<DemasiadasPeticiones alReintentar={() => {}} />).texto()).toContain('Esperá unos segundos')
  })
})

describe('estados · pago rechazado dice primero que no se cobró nada', () => {
  const MEDIOS = [
    { clave: 'mercadopago', etiqueta: 'Mercado Pago · terminada en 4417', rechazado: true },
    { clave: 'transferencia', etiqueta: 'Transferencia bancaria' },
    { clave: 'efectivo', etiqueta: 'Efectivo al retirar' },
  ]

  it('las dos preguntas que tiene alguien a quien le rechazaron la tarjeta, contestadas arriba', () => {
    const p = dibujar(<PagoRechazado catalogo={CATALOGO} numero={1042} medios={MEDIOS} alReintentar={() => {}} />)

    expect(p.texto()).toContain('El banco rechazó el pago')
    expect(p.texto()).toContain('No se descontó nada de tu cuenta')
    expect(p.ver('[data-numero]').textContent).toBe('#1042')
  })

  it('la rechazada se distingue de las alternativas', () => {
    const p = dibujar(<PagoRechazado numero={1042} medios={MEDIOS} alReintentar={() => {}} />)
    expect(p.texto()).toContain('Rechazada')
    expect(p.texto()).toContain('Transferencia bancaria')
    expect(p.texto()).toContain('Efectivo al retirar')
  })

  it('el botón de reintentar existe y llama', () => {
    const intentos = []
    const p = dibujar(<PagoRechazado numero={1042} medios={MEDIOS} alReintentar={() => intentos.push(1)} />)
    tocar(p.porTexto('Reintentar el pago'))
    expect(intentos).toEqual([1])
  })
})

describe('estados · se agotó mientras compraba', () => {
  const LINEAS = [
    { product_id: 7, nombre: 'Barra proteica chocolate 60g', marca: 'Gentech', cantidad: 2, precio: 2400, quitada: true },
    { product_id: 1, nombre: 'Whey Protein Isolate 1kg', marca: 'ENA', cantidad: 1, precio: 38868 },
  ]

  // ⚠ **La regla entera de esta pantalla.** Sacar la línea y redibujar deja un
  // pedido que vale menos y un comprador que no sabe por qué.
  it('la línea NO desaparece: queda tachada arriba del total nuevo', () => {
    const p = dibujar(<SeAgoto catalogo={CATALOGO} lineas={LINEAS} total={38868} alSeguir={() => {}} />)

    const quitada = p.ver('[data-linea="quitada"]')
    expect(quitada).not.toBeNull()
    expect(quitada.textContent).toContain('Barra proteica chocolate 60g')
    expect(quitada.textContent).toContain('Sin stock · quitado del pedido')

    expect(p.todos('[data-linea]')).toHaveLength(2)
    expect(p.ver('[data-total]').textContent).toBe('$38.868')
  })

  it('el aviso explica qué pasó y con quién hablar', () => {
    const p = dibujar(<SeAgoto catalogo={CATALOGO} lineas={LINEAS} total={38868} alSeguir={() => {}} />)
    expect(p.ver('[role="alert"]').textContent).toContain('Se agotó un producto de tu pedido')
    expect(p.texto()).toContain('avisarle a Comprafit / Fitnet')
  })

  it('con más de una caída el texto está en plural, no «se agotó 2 productos»', () => {
    const dos = [{ ...LINEAS[0] }, { ...LINEAS[1], quitada: true }]
    const p = dibujar(<SeAgoto catalogo={CATALOGO} lineas={dos} total={0} alSeguir={() => {}} />)
    expect(p.texto()).toContain('Se agotaron productos de tu pedido')
  })

  it('el total lo manda el servidor: esta pantalla no suma las líneas que quedaron', () => {
    // Un total distinto de la suma de lo que queda se dibuja **tal cual**. Si
    // esta pantalla sumara, el número de abajo no podría discrepar nunca — y el
    // día que el servidor recorte una línea por stock, discrepa.
    const p = dibujar(<SeAgoto lineas={LINEAS} total={12345} alSeguir={() => {}} />)
    expect(p.ver('[data-total]').textContent).toBe('$12.345')
  })

  it('una línea sin marca no dibuja el renglón de la marca', () => {
    const sinMarca = [{ product_id: 9, nombre: 'Shaker 600ml', cantidad: 1, precio: 4800 }]
    const p = dibujar(<SeAgoto lineas={sinMarca} total={4800} alSeguir={() => {}} />)
    expect(p.texto()).not.toContain('undefined')
  })
})

// ════════════════════════════════════════════
//  El caso que mira a todos juntos
// ════════════════════════════════════════════
describe('estados · ninguno cae en la pantalla genérica', () => {
  const TODOS = [
    ['cargando', <Cargando key="c" tardaDesdeElPrimerRender />],
    ['pausado', <Pausada key="p" catalogo={CATALOGO} />],
    ['no_disponible', <NoDisponible key="n" catalogo={CATALOGO} />],
    ['no_encontrada', <NoEncontrada key="e" />],
    [
      'sin_resultados',
      <SinResultados key="s" consulta="creatnia" categorias={CATEGORIAS} alLimpiar={() => {}} alElegirCategoria={() => {}} />,
    ],
    ['carrito_vacio', <CarritoVacio key="v" catalogo={CATALOGO} alVolverAlCatalogo={() => {}} />],
    ['demasiadas_peticiones', <DemasiadasPeticiones key="d" catalogo={CATALOGO} alReintentar={() => {}} />],
    ['pago_rechazado', <PagoRechazado key="r" numero={1042} medios={[]} alReintentar={() => {}} />],
    ['se_agoto', <SeAgoto key="a" lineas={[]} total={0} alSeguir={() => {}} />],
  ]

  it('cada uno se identifica con su propio nombre', () => {
    for (const [nombre, elemento] of TODOS) {
      expect(dibujar(elemento).ver(`[data-estado="${nombre}"]`), nombre).not.toBeNull()
    }
  })

  // ⚠ **El test que evita el defecto.** Nueve situaciones distintas que terminan
  // en el mismo cartel de «algo salió mal» es el error que T1446 existe para
  // evitar, y no se ve mirando los estados de a uno.
  it('los estados dicen cosas distintas: no hay dos con el mismo mensaje', () => {
    const titulos = TODOS.map(([nombre, elemento]) => {
      const p = dibujar(elemento)
      // El primer párrafo con peso es lo que se lee primero en cada uno.
      const encabezado = p.ver('p, h1')
      return [nombre, (encabezado ? encabezado.textContent : '').trim()]
    })

    for (const [nombre, titulo] of titulos) {
      expect(titulo.length, `${nombre} no dice nada`).toBeGreaterThan(3)
    }

    const dichos = titulos.map(([, titulo]) => titulo)
    expect(new Set(dichos).size).toBe(dichos.length)
  })

  it('todos llevan el pie «powered by favalio», salvo los que viven dentro del catálogo (FR-122)', () => {
    // `SinResultados` se dibuja **adentro** de la pantalla del catálogo, que ya
    // trae el pie: dos pies en la misma pantalla sería el defecto contrario.
    const conPiePropio = TODOS.filter(([nombre]) => nombre !== 'sin_resultados')

    for (const [nombre, elemento] of conPiePropio) {
      const pie = dibujar(elemento).ver('[data-pie="favalio"]')
      expect(pie, nombre).not.toBeNull()
      expect(pie.textContent).toContain('powered by favalio')
    }
  })
})
