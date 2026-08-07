import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { render, screen } from '@testing-library/react'
import MarcoDePantalla from '@/components/MarcoDePantalla'

// ════════════════════════════════════════════
//  Ninguna pantalla se quedó sin el marco de 1320px
//
//  `App.jsx` envolvía las dieciocho pantallas en un solo `<div>`. Al sacarlo
//  para que el punto de venta pueda ocupar el alto completo, el riesgo cambió
//  de lado: un error acá NO rompe el punto de venta, rompe **todo lo demás** —
//  diecisiete pantallas pegadas al borde de la ventana, sin padding y sin tope
//  de ancho.
//
//  Y `npm run build` no lo ve: es JSX válido.
//
//  Es una guardia estática y no un test de render porque lo que hay que
//  verificar es que **no falte ninguna de diecisiete**, y montar diecisiete
//  pantallas en jsdom para eso cuesta más de lo que atrapa. Lo que este test no
//  puede ver —que el padding se vea igual— es el paso manual 5 de la
//  verificación.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const APP = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
const MARCO = fs.readFileSync(path.join(SRC, 'components/MarcoDePantalla.jsx'), 'utf8')
const NAVEGACION = fs.readFileSync(path.join(SRC, 'components/navegacion.js'), 'utf8')

/**
 * Las rutas que dibujan una pantalla, con el texto de su `element`.
 *
 * Se mira SOLO lo que está adentro del `<main>`: el `<Route path="*">` del
 * onboarding vive en otro bloque, fuera del shell, y nunca tuvo marco.
 *
 * Las que son un `<Navigate>` puro quedan afuera: son alias de URL y no
 * dibujan nada, así que envolverlas en el marco sería un `<div>` vacío.
 */
function rutasConPantalla() {
  const desde = APP.indexOf('<main')
  const hasta = APP.indexOf('</main>')

  expect(desde).toBeGreaterThan(-1)
  expect(hasta).toBeGreaterThan(desde)

  return APP.slice(desde, hasta)
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    // `<Route ` con el espacio: `<Route` a secas también matchea `<Routes>`, y
    // esa línea entraba a la lista como una ruta sin `path`.
    .filter(({ texto }) => /^<Route\s/.test(texto))
    .map(({ texto }) => ({ ruta: (texto.match(/path="([^"]+)"/) || [])[1], texto }))
    .filter(({ texto }) => !/element=\{\s*<Navigate\b/.test(texto))
}

/**
 * Las rutas que NO usan el marco, declaradas una por una.
 *
 * Si mañana alguien saca otra pantalla del marco, tiene que venir acá y
 * escribirla. Una excepción no declarada deja de ser una excepción: es un
 * olvido que se ve recién cuando alguien abre esa pantalla.
 */
const EXCEPCIONES = ['/pos']

describe('El marco de 1320px se aplica ruta por ruta', () => {
  it('ninguna pantalla se quedó sin el marco de 1320px al sacarlo de App.jsx', () => {
    const rutas = rutasConPantalla()

    // Si el parseo no encontró nada, este test pasaría sin mirar nada.
    expect(rutas.length).toBeGreaterThanOrEqual(18)

    const sinMarco = rutas
      .filter(({ ruta }) => !EXCEPCIONES.includes(ruta))
      .filter(({ texto }) => !texto.includes('<MarcoDePantalla>'))
      .map(({ ruta }) => ruta)

    expect(sinMarco).toEqual([])
  })

  it('/pos es la única excepción, y está declarada', () => {
    const rutas = rutasConPantalla()

    const fueraDelMarco = rutas
      .filter(({ texto }) => !texto.includes('<MarcoDePantalla>'))
      .map(({ ruta }) => ruta)

    // Los dos sentidos: la lista escrita es exactamente la que hay en el
    // archivo, y tiene un solo elemento.
    expect(fueraDelMarco).toEqual(EXCEPCIONES)
    expect(EXCEPCIONES).toHaveLength(1)
  })

  it('el punto de venta ocupa el alto completo en vez del marco', () => {
    const pos = rutasConPantalla().find(({ ruta }) => ruta === '/pos')

    expect(pos).toBeDefined()
    expect(pos.texto).toContain('h-full')
  })
})

// ════════════════════════════════════════════
//  Lo que el menú gatea, la ruta lo gatea
//
//  El gate de módulo va en tres lados —barra lateral, `RouteGuard` y API— y
//  `/proveedores` lo tenía en dos: `app-sidebar.jsx:74` le sacaba el ítem del
//  menú a una empresa sin el módulo, pero la URL escrita a mano entraba igual.
//  Es la segunda vez que pasa lo mismo, y por eso lo que se verifica NO es
//  «`/proveedores` tiene guard» —una constante que hay que acordarse de
//  actualizar— sino la relación entre las dos listas: si mañana alguien agrega
//  una pantalla con `modulo` en `navegacion.js` y se olvida del guard, esto se
//  pone en rojo solo.
//
//  Se lee el texto de los dos archivos, no se monta nada: lo que se afirma es
//  que las dos declaraciones coinciden, y montar diecisiete rutas en jsdom para
//  eso cuesta más de lo que atrapa.
// ════════════════════════════════════════════

/**
 * Los ítems del menú, con su ruta y el módulo que declaran (o `undefined`).
 *
 * `navegacion.js` escribe un ítem por línea, así que alcanza con leer línea por
 * línea. Los comentarios se saltean: el encabezado del archivo explica qué es
 * `modulo` —y por qué cuatro ítems no lo declaran— y eso no es una declaración.
 *
 * Recibe el texto en vez de leer la constante para poder ejercitarlo contra una
 * muestra sintética: un detector que solo se corre sobre el archivo que está
 * bien pasa en verde tanto si encuentra el defecto como si no lo sabe buscar.
 */
function itemsDelMenu(texto) {
  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => !linea.startsWith('//') && !linea.startsWith('*'))
    .map((linea) => ({
      ruta: (linea.match(/to:\s*'([^']+)'/) || [])[1],
      modulo: (linea.match(/modulo:\s*'([^']+)'/) || [])[1],
    }))
    .filter(({ ruta }) => ruta)
}

/** Los ítems del menú que declaran un módulo, con su ruta. */
function itemsConModulo() {
  return itemsDelMenu(NAVEGACION).filter(({ modulo }) => modulo)
}

/** La línea de la `<Route>` de esa ruta en App.jsx, o `undefined`. */
function elementoDeLaRuta(ruta) {
  return APP
    .split('\n')
    .map((linea) => linea.trim())
    .find((texto) => /^<Route\s/.test(texto) && texto.includes(`path="${ruta}"`))
}

/** Las rutas cuyo ítem declara módulo y cuya `<Route>` no lo exige. */
function rutasSinGuard() {
  return itemsConModulo()
    .filter(({ ruta, modulo }) => {
      const elemento = elementoDeLaRuta(ruta)
      return !elemento || !elemento.includes(`requiredModule="${modulo}"`)
    })
    .map(({ ruta }) => ruta)
}

/**
 * Las rutas que declaran módulo en el menú y todavía NO lo exigen en la ruta.
 *
 * Son deuda declarada, no una decisión: son anteriores a esta guardia. Cada una
 * es una URL que una empresa sin el módulo puede escribir a mano y entrar, igual
 * que pasaba con `/proveedores`.
 *
 * ⚠ No se cierran de un tirón, y el motivo está en la fase 8 de las tareas de la
 * 012: agregar un guard es una línea que puede dejar a alguien afuera de una
 * ruta, y antes de cada una hay que mirar en producción qué empresas tienen ese
 * módulo en `enabled_modules` —una que no lo tenga pierde la pantalla y
 * redirige a `/pos`—. Ocho de esas revisiones metidas en un commit de rediseño
 * es exactamente lo que esa fase separa para poder revertir de a una.
 *
 * `enabled_modules` las alcanza a todas: el ejemplo de
 * `docs/implementation_plan_production.md:249` incluye `pos` e `inventario`,
 * así que ninguna de estas es un módulo que toda empresa tenga por definición.
 *
 * ⚠ **Esta lista es deuda, y hay una sola forma de salir de acá que NO es
 * ponerle el guard**: que la ruta deje de declarar módulo en los dos lados, que
 * es una decisión distinta y está escrita aparte, en `SIN_MODULO_A_PROPOSITO`.
 * Las dos listas no se pisan y hay un caso que lo verifica: una ruta no puede
 * ser deuda pendiente y decisión tomada a la vez.
 *
 * Sacar una de acá sin ponerle el guard pone la guardia en rojo, y ponerle el
 * guard sin sacarla de acá también.
 */
const SIN_GUARD_TODAVIA = [
  '/pos',
  '/ventas',
  '/inventario',
  '/suscripcion',
]

/**
 * Las cuatro que NO tienen gate de módulo **porque se decidió que no lo tengan**.
 *
 * No son deuda: son el esqueleto del sistema. Toda empresa necesita configurar
 * AFIP, manejar su equipo, cargar sus gastos y mirar sus números; no son
 * módulos que se contraten o se dejen de contratar.
 *
 * ── Por qué está escrito acá y no solo en `navegacion.js` ──
 *
 * Porque una guardia que dice «estas rutas no tienen guard» **sin decir por
 * qué** es una lista que alguien va a completar de buena fe. Las cuatro
 * declaraban `modulo` en el menú y ninguna lo exigía en la ruta: escondían el
 * ítem sin impedir que la URL escrita a mano entrara igual —lo mismo que
 * `/proveedores`—, o sea que el gate no protegía nada y sí escondía pantallas.
 *
 * Y esconderlas no es teórico: el ejemplo de `enabled_modules` de
 * `docs/implementation_plan_production.md:249` no tiene `panel` ni
 * `facturacion`, así que una empresa configurada con esa lista **hoy no ve el
 * Panel ni Facturación AFIP en el menú**. Ponerles el guard habría exigido
 * revisar `enabled_modules` empresa por empresa antes del deploy, y una lista
 * mal armada hace desaparecer cuatro pantallas sin aviso.
 *
 * Decisión 6 del usuario en `docs/specs/014-panel-gastos-equipo-afip/spec.md`,
 * decisión 14 del plan. Se cierra **quitando** el gate, no poniéndolo.
 *
 * Los dos sentidos se verifican: que el ítem del menú no declare `modulo` y que
 * la `<Route>` no exija `requiredModule`. Con uno solo alcanzaría para el
 * defecto inverso —la ruta gatea y el menú muestra el ítem—, que le dibuja al
 * usuario un ítem que al hacer clic lo manda a `/pos`.
 */
const SIN_MODULO_A_PROPOSITO = [
  '/gastos',
  '/panel',
  '/facturacion',
  '/team',
]

/**
 * Los ítems de esas rutas que SÍ declaran módulo, con el módulo que declaran.
 *
 * Toma el texto de `navegacion.js` como parámetro para poder ejercitarlo contra
 * una muestra sintética con el defecto adentro.
 */
function declaranModulo(textoDeNavegacion, rutas) {
  return itemsDelMenu(textoDeNavegacion)
    .filter(({ ruta, modulo }) => rutas.includes(ruta) && modulo)
    .map(({ ruta, modulo }) => `${ruta} — el ítem del menú volvió a declarar modulo "${modulo}"`)
}

/** Las `<Route>` de esas rutas que SÍ exigen un módulo. Ídem: recibe el texto. */
function exigenModulo(textoDeApp, rutas) {
  return textoDeApp
    .split('\n')
    .map((linea) => linea.trim())
    .filter((texto) => /^<Route\s/.test(texto))
    .map((texto) => ({
      ruta: (texto.match(/path="([^"]+)"/) || [])[1],
      modulo: (texto.match(/requiredModule="([^"]+)"/) || [])[1],
    }))
    .filter(({ ruta, modulo }) => rutas.includes(ruta) && modulo)
    .map(({ ruta, modulo }) => `${ruta} — la <Route> exige requiredModule="${modulo}"`)
}

describe('El gate de módulo está en la ruta y no solo en el menú', () => {
  it('toda ruta cuyo ítem de menú declara un módulo lleva RouteGuard con ese mismo módulo', () => {
    const items = itemsConModulo()

    // Si el parseo de cualquiera de los dos archivos fallara, esto pasaría sin
    // mirar nada: cero ítems es cero incumplimientos.
    //
    // El número bajó de 14 a 10 en el corte 10 de la 014, y bajó por una
    // decisión: `/gastos`, `/panel`, `/facturacion` y `/team` dejaron de
    // declarar módulo a propósito y están enumerados en
    // `SIN_MODULO_A_PROPOSITO`, con el motivo. Si bajara de diez, se perdió uno
    // más que **nadie decidió** — y ajustar este número sin leer qué cambió es
    // exactamente cómo una guardia deja de servir.
    expect(items.length).toBeGreaterThanOrEqual(10)
    expect(items.map((i) => i.ruta)).toContain('/proveedores')
    expect(elementoDeLaRuta('/proveedores')).toBeDefined()

    const sinGuard = itemsConModulo()
      .filter(({ ruta }) => !SIN_GUARD_TODAVIA.includes(ruta))
      .filter(({ ruta, modulo }) => {
        const elemento = elementoDeLaRuta(ruta)
        return !elemento || !elemento.includes(`requiredModule="${modulo}"`)
      })
      .map(({ ruta, modulo }) => `${ruta} — el menú lo gatea con modulo "${modulo}" y la <Route> no exige requiredModule="${modulo}"`)

    expect(sinGuard).toEqual([])
  })

  it('la lista de rutas sin guard es exactamente la que hay en App.jsx', () => {
    // Los dos sentidos, igual que con las excepciones del marco. Sin esto, una
    // ruta que ya recibió su guard puede quedarse en la lista para siempre, y a
    // partir de ahí nadie se enteraría si alguien se lo saca.
    expect(rutasSinGuard().sort()).toEqual([...SIN_GUARD_TODAVIA].sort())
  })
})

describe('Las cuatro del esqueleto no tienen gate de módulo, y eso está decidido', () => {
  it('ninguna de las cuatro declara modulo en el menú', () => {
    // Primero, que las cuatro sigan existiendo como ítems. Si alguien renombra
    // una ruta o el parseo se rompe, «ningún ítem declara módulo» sería cierto
    // por vacío y esto pasaría en verde sin haber mirado nada.
    const enElMenu = itemsDelMenu(NAVEGACION)
      .map(({ ruta }) => ruta)
      .filter((ruta) => SIN_MODULO_A_PROPOSITO.includes(ruta))

    expect([...new Set(enElMenu)].sort()).toEqual([...SIN_MODULO_A_PROPOSITO].sort())

    expect(declaranModulo(NAVEGACION, SIN_MODULO_A_PROPOSITO)).toEqual([])
  })

  it('el detector encuentra el modulo que alguien le vuelva a poner al ítem', () => {
    // La muestra sintética es la única forma de saber que el caso de arriba
    // pasa porque el archivo está bien y no porque el detector no sepa mirar.
    const conModulo = "{ to: '/gastos', icon: Wallet, label: 'Gastos', permission: 'gastos.ver', modulo: 'gastos' },"

    expect(declaranModulo(conModulo, SIN_MODULO_A_PROPOSITO)).toEqual([
      '/gastos — el ítem del menú volvió a declarar modulo "gastos"',
    ])
  })

  it('ninguna de las cuatro rutas exige un módulo en App.jsx', () => {
    // El otro sentido, y el que nadie miraba: la guardia de arriba recorre los
    // ítems CON módulo, así que una `<Route>` que gatea sin que el menú declare
    // nada le queda invisible. Ese caso dibuja el ítem para todo el mundo y
    // manda a `/pos` al que hace clic.
    const enApp = rutasConPantalla()
      .map(({ ruta }) => ruta)
      .filter((ruta) => SIN_MODULO_A_PROPOSITO.includes(ruta))

    expect(enApp.sort()).toEqual([...SIN_MODULO_A_PROPOSITO].sort())

    expect(exigenModulo(APP, SIN_MODULO_A_PROPOSITO)).toEqual([])
  })

  it('el detector encuentra el RouteGuard que alguien le agregue a la ruta', () => {
    const conGuard = '<Route path="/gastos" element={<MarcoDePantalla><RouteGuard requiredModule="gastos"><Expenses /></RouteGuard></MarcoDePantalla>} />'

    expect(exigenModulo(conGuard, SIN_MODULO_A_PROPOSITO)).toEqual([
      '/gastos — la <Route> exige requiredModule="gastos"',
    ])
  })

  it('una ruta no puede ser deuda pendiente y decisión tomada a la vez', () => {
    // Las dos listas dicen «esta ruta no tiene guard» y dicen por qué, y los
    // porqués son incompatibles: una espera que alguien revise `enabled_modules`
    // y le ponga el guard, la otra dice que no se lo ponga nunca. Con una ruta
    // en las dos, cuál de los dos motivos vale depende de cuál lea el que pasa.
    expect(SIN_GUARD_TODAVIA.filter((ruta) => SIN_MODULO_A_PROPOSITO.includes(ruta))).toEqual([])
  })
})

describe('El scroll se mudó del <main> al marco', () => {
  it('el <main> del shell ya NO scrollea', () => {
    // Si conservara su `overflow-y-auto`, el punto de venta haría scrollear la
    // página entera además de sus dos zonas internas (FR-002).
    const main = APP.split('\n').find((l) => l.trim().startsWith('<main'))

    expect(main).toBeDefined()
    expect(main).toContain('overflow-hidden')
    expect(main).not.toContain('overflow-y-auto')
  })

  it('el marco quedó con el ancho, el padding y su propio scroll', () => {
    expect(MARCO).toContain('max-w-[1320px]')
    expect(MARCO).toContain('px-5')
    expect(MARCO).toContain('py-7')
    expect(MARCO).toContain('lg:px-9')
    expect(MARCO).toContain('lg:py-8')
    expect(MARCO).toContain('overflow-y-auto')
    expect(MARCO).toContain('h-full')
  })

  it('el marco NO quedó también en App.jsx: una sola definición', () => {
    // Dos contenedores de 1320px anidados duplican el padding y nadie relaciona
    // las dos cosas.
    expect(APP).not.toContain('max-w-[1320px]')
  })
})

describe('El marco dibuja lo que le pasan', () => {
  // ⚠ Este archivo es `.js` y Vite NO transforma JSX en `.js`, así que el
  // render va con `React.createElement`. Un `.jsx` acá obligaría a renombrarlo
  // y el resto del archivo es una guardia estática que no necesita nada de eso.
  const conContenido = () =>
    render(
      React.createElement(
        MarcoDePantalla,
        null,
        React.createElement('p', null, 'El contenido de la pantalla')
      )
    )

  it('las diecisiete pantallas NO quedan en blanco', () => {
    // La guardia estática de arriba no puede ver esto: un `MarcoDePantalla` que
    // devolviera `null` —que es como se creó en T1115— seguiría teniendo las
    // clases escritas en el archivo y las diecisiete rutas seguirían diciendo
    // `<MarcoDePantalla>`. Lo único que pasaría es que la aplicación entera se
    // vería vacía.
    conContenido()

    expect(screen.getByText('El contenido de la pantalla')).toBeInTheDocument()
  })

  it('el que scrollea NO es el contenedor de 1320px, que dejaba franjas muertas a los costados', () => {
    // El marco son DOS capas y el orden importa. Cuando eran una sola —el
    // `mx-auto max-w-[1320px] overflow-y-auto` con el que quedó el hito 5—, en
    // un monitor de 1920px el contenedor de scroll iba de x=420 a x=1740
    // mientras `<main>` iba de x=240 a x=1920: **180px de cada lado en los que
    // la rueda del mouse no scrolleaba nada**, y la barra flotando en el medio
    // de la pantalla en vez de en el borde de la ventana. Medido con la rueda
    // en x=1880: `scrollTop` no se movía.
    //
    // Este caso fija la forma; la geometría la verifica
    // `pruebas-de-navegador/marcoDeLasPantallas.navegador.js`, porque jsdom no
    // tiene motor de maquetado y acá no se puede afirmar dónde queda nada.
    conContenido()

    const centrado = screen.getByText('El contenido de la pantalla').parentElement
    const queScrollea = centrado.parentElement

    // El de adentro centra y pone el padding, y NO scrollea.
    expect(centrado).toHaveClass('mx-auto')
    expect(centrado).toHaveClass('max-w-[1320px]')
    expect(centrado).not.toHaveClass('overflow-y-auto')

    // El de afuera scrollea y no tiene tope de ancho: ocupa el ancho completo
    // de `<main>`, que es lo que hace que la rueda funcione en cualquier punto
    // de la pantalla.
    expect(queScrollea).toHaveClass('overflow-y-auto')
    expect(queScrollea).toHaveClass('h-full')
    expect(queScrollea).not.toHaveClass('max-w-[1320px]')
  })
})
