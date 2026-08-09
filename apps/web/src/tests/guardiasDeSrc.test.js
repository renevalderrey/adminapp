import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

// ════════════════════════════════════════════
//  FAVALIO · Guardias estáticas sobre todo el árbol de `src`
//
//  Dos propiedades que no son de una pantalla sino de TODAS, y que por eso se
//  verifican leyendo los archivos en vez de montando componentes: que toda
//  confirmación diga qué hace, y que ninguna fecha se arme pasando por UTC.
//
//  Comparten el recorrido recursivo de una sola vez a propósito. Duplicarlo es
//  la forma de que uno de los dos se quede atrás el día que alguien agregue una
//  carpeta, y ése es justo el modo en que estas guardias mueren sin avisar.
//
//  ── 1 · Toda confirmación dice qué hace, y el rojo significa algo ──
//
//  ── El defecto ──
//
//  Veintidós llamadas a `confirm()` y **el mismo botón rojo con la misma
//  palabra** en las veintidós: vaciar un ticket, cerrar una sesión, pasar a
//  producción fiscal, borrar un proveedor con toda su cuenta corriente.
//
//  El daño no es asustar a quien vacía el ticket. Es el otro: **quien apretó ese
//  botón rojo cinco veces esa mañana para cosas que no borraban nada llega al
//  sexto con el dedo hecho.** Un color de alarma que aparece siempre deja de ser
//  una alarma — es el mecanismo exacto por el que la advertencia de verdad no se
//  lee.
//
//  ── Por qué esto es una guardia estática y no un test de render ──
//
//  Porque lo que hay que verificar es una propiedad de TODAS las llamadas, y
//  montar diecisiete pantallas para llegar a cada diálogo cuesta más que leer
//  los archivos. Un test de render por pantalla verificaría las que alguien se
//  acordó de escribir; esto verifica las que hay.
//
//  ⚠ El recorrido es RECURSIVO. Una guardia que lee un solo nivel de carpetas
//  pasa en verde para siempre el día que alguien crea `pages/reportes/`, y no
//  avisa: informa cero hallazgos sobre cero archivos mirados. Por eso hay un
//  ancla que exige un piso de archivos y de llamadas encontradas.
// ════════════════════════════════════════════

/** El salto de linea, como constante: escribirlo dentro de una plantilla de
 *  generacion lo convierte en un salto real y rompe el archivo. */
const SALTO = String.fromCharCode(10)

const AQUI = path.dirname(url.fileURLToPath(import.meta.url))
const RAIZ = path.join(AQUI, '..')

/** Todos los `.jsx`/`.js` de `src`, bajando por las carpetas. */
function archivosDeCodigo(dir = RAIZ, acumulado = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name)

    if (entrada.isDirectory()) {
      // `tests/` queda afuera: un test que documenta el defecto citándolo no
      // puede hacer fallar la guardia que verifica que no esté.
      if (entrada.name === 'tests' || entrada.name === 'pruebas-de-navegador') continue
      archivosDeCodigo(ruta, acumulado)
      continue
    }

    // ⚠ Los `.test.js` quedan afuera estén donde estén, y no solo los de
    // `tests/`: `utils/` tiene sus tests al lado del archivo que prueban, y uno
    // de ellos cita el defecto de `toISOString()` para verificar la corrección.
    // Un test que documenta el defecto no puede hacer fallar a la guardia.
    if (/\.test\.jsx?$/.test(entrada.name)) continue

    if (/\.jsx?$/.test(entrada.name)) acumulado.push(ruta)
  }

  return acumulado
}

/**
 * El texto sin comentarios, conservando los saltos de línea.
 *
 * Con un solo espacio en lugar del bloque, un encabezado de sesenta líneas
 * colapsa en una y todos los números de abajo quedan corridos — y un hallazgo
 * que manda a mirar la línea equivocada es un hallazgo que nadie cree.
 */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, ' ')
}

/**
 * Las llamadas a `confirm(` con el trozo de archivo que va después.
 *
 * Se mira una ventana de texto y no la línea, porque casi todas las llamadas
 * abarcan varias: el mensaje son tres o cuatro renglones concatenados y las
 * opciones van al final. Buscar `verbo:` en la misma línea que `confirm(` daría
 * un falso hallazgo en cada llamada larga, que son la mayoría.
 */
function llamadasAConfirm(contenido) {
  const limpio = sinComentarios(contenido)
  const encontradas = []
  const regex = /\bconfirm\(/g
  let m

  while ((m = regex.exec(limpio)) !== null) {
    const desde = m.index
    const linea = limpio.slice(0, desde).split('\n').length

    // Hasta el cierre del paréntesis, contando anidados. Sin esto, una llamada
    // sin verbo seguida de otra con verbo pasaría por la ventana de la segunda.
    let nivel = 0
    let fin = desde
    for (let i = desde; i < limpio.length; i++) {
      if (limpio[i] === '(') nivel++
      else if (limpio[i] === ')') {
        nivel--
        if (nivel === 0) { fin = i; break }
      }
    }

    encontradas.push({ linea, texto: limpio.slice(desde, fin + 1) })
  }

  return encontradas
}

const ARCHIVOS = archivosDeCodigo()
  .map((ruta) => ({
    nombre: path.relative(RAIZ, ruta).split(path.sep).join('/'),
    contenido: fs.readFileSync(ruta, 'utf8'),
  }))
  // El propio hook define `confirm`, no lo llama.
  .filter(({ nombre }) => nombre !== 'components/ConfirmDialog.jsx')

const LLAMADAS = ARCHIVOS.flatMap(({ nombre, contenido }) =>
  llamadasAConfirm(contenido).map((llamada) => ({ archivo: nombre, ...llamada }))
)

describe('El botón de una confirmación dice qué hace', () => {
  it('la guardia miró de verdad: hay archivos y hay llamadas', () => {
    // Sin esto, la guardia pasa en verde el día que alguien mueve las pantallas
    // de carpeta o le cambia el nombre al hook: cero llamadas revisadas, cero
    // hallazgos, verde. Es la forma en que estas guardias fallan sin avisar.
    expect(ARCHIVOS.length).toBeGreaterThan(60)
    expect(LLAMADAS.length).toBeGreaterThan(20)

    // Y que estamos mirando las de este hook y no un `window.confirm` suelto.
    const conVerbo = LLAMADAS.filter(({ texto }) => /verbo:/.test(texto))
    expect(conVerbo.length).toBeGreaterThan(20)
  })

  it('ninguna llamada se queda sin verbo', () => {
    // Un default en el hook habría sido «Confirmar» otra vez, y la pantalla
    // siguiente lo heredaría sin enterarse. Por eso el verbo es obligatorio y
    // lo que lo obliga es esto.
    const sinVerbo = LLAMADAS
      .filter(({ texto }) => !/verbo:/.test(texto))
      .map(({ archivo, linea }) => `${archivo}:${linea}`)

    expect(sinVerbo).toEqual([])
  })

  it('el verbo dice la acción, no «Confirmar» ni «Aceptar»', () => {
    // «Aceptar» y «Sí» tienen el mismo problema que «Confirmar»: no se pueden
    // leer sin volver al párrafo de arriba, que es justo lo que no se hace
    // cuando ya se decidió y solo se busca dónde hacer clic.
    const vagos = LLAMADAS
      .filter(({ texto }) => /verbo:\s*['"`](Confirmar|Aceptar|Sí|Si|OK|Ok)['"`]/.test(texto))
      .map(({ archivo, linea }) => `${archivo}:${linea}`)

    expect(vagos).toEqual([])
  })
})

describe('El rojo se reserva para lo que no se puede deshacer', () => {
  const rojas = LLAMADAS.filter(({ texto }) => /destructivo:\s*true/.test(texto))

  it('son pocas: si fueran todas, el rojo no diría nada', () => {
    // El número no es un gusto. Es la propiedad que hace que el rojo funcione:
    // si aparece en la mayoría de las confirmaciones, el que importa llega
    // cuando la persona ya lo apretó cinco veces esa mañana.
    expect(rojas.length).toBeGreaterThan(0)
    expect(rojas.length).toBeLessThanOrEqual(LLAMADAS.length / 3)
  })

  it('y están donde tienen que estar', () => {
    // Enumeradas, y no contadas: una cuenta pasa igual si alguien pinta de rojo
    // «vaciar ticket» y despinta «eliminar proveedor».
    const donde = [...new Set(rojas.map(({ archivo }) => archivo))].sort()

    expect(donde).toEqual([
      'components/EstadoDeTiendanube.jsx', // desvincular: borra el acceso y el catálogo
      'pages/Orders.jsx',                  // borrar proveedor y borrar movimientos: es plata
      'pages/Settings.jsx',                // pasar a producción y desvincular AFIP
    ])
  })

  it('vaciar el ticket NO es rojo: se vuelve a cargar', () => {
    // El caso testigo del otro lado. Sin él, «reservar el rojo» se cumple
    // pintando de rojo tres archivos y dejando el resto al azar.
    const vaciar = LLAMADAS.filter(({ texto }) => /Vaciar ticket/.test(texto))

    expect(vaciar.length).toBeGreaterThan(0)
    for (const llamada of vaciar) {
      expect(llamada.texto).not.toMatch(/destructivo:\s*true/)
    }
  })
})

// ════════════════════════════════════════════
//  ── 2 · Ninguna fecha se arma pasando por UTC ──
//
//  ── El defecto ──
//
//  `new Date().toISOString().slice(0, 10)` devuelve la fecha **en UTC**. En
//  Argentina —UTC−3— desde las 21:00 allá ya es el día siguiente, así que una
//  reposición cargada un jueves a las 22:00 se asentaba en la cuenta del
//  proveedor con fecha del viernes.
//
//  ⚠ Miente **siempre hacia adelante y solo de noche**: nunca se equivoca a la
//  mañana, cuando alguien podría estar mirando. Y la pantalla que lo tenía no
//  dibuja la fecha en ningún lado, así que el error no aparecía ahí sino
//  después, en la cuenta corriente, corrido de día y a veces de mes.
//
//  Este repositorio lo corrigió ya cinco veces —está explicado en cinco
//  encabezados distintos— y volvió a aparecer igual. Por eso ahora hay guardia.
// ════════════════════════════════════════════

describe('Ninguna fecha se arma pasando por UTC', () => {
  const usos = ARCHIVOS.flatMap(({ nombre, contenido }) =>
    sinComentarios(contenido)
      .split('\n')
      .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) => /toISOString\(\)/.test(texto))
  )

  it('nadie usa `toISOString()` para sacar el día', () => {
    // `fechaDeHoy()` de `utils/formato.js` usa los métodos LOCALES del `Date`,
    // que son los que dan el día del negocio. La guardia mira `toISOString()`
    // entero y no solo el `.slice(0, 10)`: el `.slice(0, 7)` del mes tiene
    // exactamente el mismo problema y ya lo tuvo `utils/gastos.js`.
    expect(usos.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('la guardia miró de verdad: `fechaDeHoy` se usa en varios lados', () => {
    // Ancla. Sin esto, cero usos de `toISOString` se lee igual que «no encontré
    // ningún archivo», que es cómo estas guardias se quedan verdes para siempre.
    const conFechaDeHoy = ARCHIVOS.filter(({ contenido }) => /\bfechaDeHoy\b/.test(contenido))

    expect(conFechaDeHoy.length).toBeGreaterThan(3)
  })
})

// ════════════════════════════════════════════
//  ── 3 · La frase del permiso que falta se escribe en UN solo lugar ──
//
//  ── El defecto ──
//
//  Estaba escrita a mano en dieciocho lugares, y **ya había divergido**: el
//  comparador decía «Te falta el permiso «X». Pediselo a quien administra la
//  empresa» —copiado del mensaje del servidor— y los otros diecisiete decían
//  «Necesitás el permiso «X»».
//
//  Dos formas de decir lo mismo en la misma sesión se leen como dos cosas
//  distintas, y la persona empieza a buscar la diferencia que no existe. Y la
//  divergencia no la produjo un descuido: la produjo alguien copiando del lugar
//  correcto —el servidor— porque no había ningún lugar en el front que fuera EL
//  lugar.
//
//  Diecinueve copias no se mantienen iguales. Se mantiene una.
// ════════════════════════════════════════════

describe('El motivo de un control apagado sale de una sola función', () => {
  const AYUDANTE = 'utils/permisos.js'

  const aMano = ARCHIVOS
    .filter(({ nombre }) => nombre !== AYUDANTE)
    .flatMap(({ nombre, contenido }) =>
      sinComentarios(contenido)
        .split('\n')
        .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
        .filter(({ texto }) => /Necesitás el permiso|Te falta el permiso/.test(texto))
    )

  it('nadie la escribe a mano', () => {
    expect(aMano.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('la guardia miró de verdad: el ayudante existe y lo usan varias pantallas', () => {
    // Ancla. Cero frases a mano se lee igual que «no encontré ningún archivo»,
    // y así es como estas guardias se quedan verdes para siempre.
    const ayudante = ARCHIVOS.find(({ nombre }) => nombre === AYUDANTE)
    expect(ayudante).toBeDefined()
    expect(ayudante.contenido).toContain('export function faltaElPermiso')

    const usuarios = ARCHIVOS.filter(({ contenido }) => /\bfaltaElPermiso\(/.test(contenido))
    expect(usuarios.length).toBeGreaterThan(6)
  })

  it('la frase NOMBRA el permiso, que es lo único accionable', () => {
    // El usuario no puede pedir lo que no puede nombrar. Una versión que dijera
    // «no tenés permiso para esto» pasaría las dos de arriba y dejaría a la
    // persona sin nada concreto que reenviar por mensaje.
    const ayudante = ARCHIVOS.find(({ nombre }) => nombre === AYUDANTE)

    expect(ayudante.contenido).toMatch(/\$\{codigo\}/)
  })
})

// ════════════════════════════════════════════
//  ── 4 · Ninguna pantalla se inventa el nombre de otra ──
//
//  ── El defecto ──
//
//  El Panel tenía su propia idea de cómo se llaman las demás: decía «Ver
//  ventas» para `/ventas` —que en el menú es **Historial de ventas**—, «Ir a
//  Facturación» para `/facturacion` —que es **Facturación AFIP**— y, en otro
//  bloque de la misma pantalla, «Historial completo» para esa misma ruta. Tres
//  nombres para dos pantallas.
//
//  Y el punto de venta remataba con «Revisá Ajustes», que **no es ninguna
//  pantalla**: se llama Facturación AFIP. Ese mensaje aparece en el pie del
//  cobro, con un cliente enfrente — el peor momento posible para mandar a
//  alguien a buscar algo que no existe.
//
//  El nombre de una pantalla es cómo se la busca. Escrito a mano en cada lugar
//  que la menciona, se separa: no hace falta que nadie se equivoque, alcanza con
//  que el menú cambie una vez.
//
//  ⚠ Esta guardia mira los nombres COMPLETOS y no palabras sueltas. «Ver
//  ventas» en una frase no es lo mismo que rotular un botón que lleva a una
//  pantalla; lo que se prohíbe es escribir el nombre propio de una pantalla en
//  vez de pedírselo a `nombreDeRuta`.
// ════════════════════════════════════════════

describe('El nombre de una pantalla sale de la barra lateral', () => {
  const NAVEGACION = 'components/navegacion.js'

  /** Los nombres tal como los declara el menú. */
  const NOMBRES_DEL_MENU = (() => {
    const fuente = ARCHIVOS.find(({ nombre }) => nombre === NAVEGACION)
    return [...(fuente?.contenido.matchAll(/label:\s*'([^']+)'/g) || [])].map((m) => m[1])
  })()

  it('la guardia miró de verdad: el menú declara sus pantallas', () => {
    // Ancla. Si el archivo se moviera o la forma de declarar cambiara, la lista
    // quedaría vacía y todo lo de abajo pasaría sin mirar nada.
    expect(NOMBRES_DEL_MENU).toContain('Historial de ventas')
    expect(NOMBRES_DEL_MENU).toContain('Facturación AFIP')
    expect(NOMBRES_DEL_MENU.length).toBeGreaterThan(10)
  })

  it('«Ajustes» no aparece como si fuera una pantalla', () => {
    // No existe ninguna pantalla con ese nombre. Se busca la frase que manda a
    // ir ahí —«Revisá Ajustes», «en Ajustes», «a Ajustes»— y no la palabra
    // suelta, que aparece legítimamente en comentarios sobre la pantalla vieja.
    const manda = ARCHIVOS.flatMap(({ nombre, contenido }) =>
      sinComentarios(contenido)
        .split('\n')
        .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
        .filter(({ texto }) => /\b(Revisá|Revisa|en|a|de)\s+Ajustes\b/.test(texto))
    )

    expect(manda.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('el nombre de una pantalla no se escribe a mano en el rótulo de un enlace', () => {
    // Solo dentro de un `<Link>`/`<NavLink>` o de un `to=`: nombrar una pantalla
    // en un párrafo explicativo es correcto y frecuente. Lo que no puede pasar
    // es que el TEXTO DEL BOTÓN que lleva ahí esté escrito aparte del menú.
    const enlaces = ARCHIVOS
      // El propio menú y la miga de pan SÍ escriben los nombres: son la fuente.
      .filter(({ nombre }) => nombre !== NAVEGACION)
      .flatMap(({ nombre, contenido }) => {
        const limpio = sinComentarios(contenido)
        const hallazgos = []

        for (const m of limpio.matchAll(/<Link\b[\s\S]{0,400}?<\/Link>/g)) {
          const texto = m[0]
          const escritos = NOMBRES_DEL_MENU.filter((label) =>
            // El nombre, pero NO cuando viene de `nombreDeRuta(...)`.
            texto.includes(`>${label}`) || texto.includes(` ${label}<`)
          )

          if (escritos.length) {
            hallazgos.push(`${nombre}: ${escritos.join(', ')}`)
          }
        }

        return hallazgos
      })

    expect(enlaces).toEqual([])
  })

  it('y `nombreDeRuta` se usa donde hace falta', () => {
    // La otra mitad del ancla. Cero hallazgos arriba se lee igual que «no
    // encontré ningún enlace», y así es como estas guardias se quedan verdes.
    const usuarios = ARCHIVOS.filter(({ contenido }) => /\bnombreDeRuta\(/.test(contenido))

    expect(usuarios.length).toBeGreaterThan(2)
  })
})

// ════════════════════════════════════════════
//  ── 5 · Un permiso se NOMBRA, no se parafrasea ──
//
//  ── El defecto ──
//
//  Diez lugares decían «te falta el permiso **para editar la configuración**»,
//  «el permiso **de gastos**», «el permiso **para hacerlo**». Ninguno decía el
//  código.
//
//  El usuario no puede pedir lo que no puede nombrar: quien administra la
//  empresa busca `config.editar` en una lista de permisos, no «editar la
//  configuración». La paráfrasis suena más amable y deja a la persona sin nada
//  concreto que reenviar por mensaje — que es peor que el código a secas.
//
//  Es la misma regla que ya cumplían los `title` de los controles apagados. Lo
//  que faltaba era que la cumplieran también los párrafos.
// ════════════════════════════════════════════

describe('Los avisos de permiso dicen el código', () => {
  const parafrasis = ARCHIVOS
    .filter(({ nombre }) => nombre !== 'utils/permisos.js')
    .flatMap(({ nombre, contenido }) =>
      sinComentarios(contenido)
        .split('\n')
        .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
        // «el permiso para …» / «el permiso de …» seguido de palabras y NO de un
        // código con punto. `faltaElPermiso('config.editar')` no matchea.
        .filter(({ texto }) => /permiso\s+(para|de)\s+[a-záéíóúñ]/i.test(texto))
    )

  it('ninguna pantalla parafrasea el permiso que falta', () => {
    expect(parafrasis.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('la guardia miró de verdad: hay avisos de permiso en varias pantallas', () => {
    // Ancla. Cero paráfrasis se lee igual que «no hay ningún aviso de permiso»,
    // y así es como esta guardia se queda verde el día que alguien los reescribe.
    const conAviso = ARCHIVOS.filter(({ contenido }) => /\bfaltaElPermiso\(/.test(contenido))

    expect(conAviso.length).toBeGreaterThan(8)
  })

  it('la muestra sintética de una paráfrasis SÍ da hallazgo', () => {
    // Sin esto, un regex que no matchea nada pasa las dos de arriba: la primera
    // porque no encuentra, la segunda porque mira otra cosa.
    const mala = "toast.error('No podés: te falta el permiso para editar la configuración.')"
    const buena = "toast.error(faltaElPermiso('config.editar'))"

    expect(/permiso\s+(para|de)\s+[a-záéíóúñ]/i.test(mala)).toBe(true)
    expect(/permiso\s+(para|de)\s+[a-záéíóúñ]/i.test(buena)).toBe(false)
  })
})

// ════════════════════════════════════════════
//  ── 6 · Las comillas de un texto que lee una persona son « » ──
//
//  Cuatro mensajes rodeaban un nombre con comillas rectas —`"Depósito Norte"`—
//  mientras el resto de la aplicación usa las angulares: «Registrar orden»,
//  «proveedores.editar», «Nuevo proveedor».
//
//  No es tipografía por gusto. Los cuatro casos son confirmaciones de acciones
//  que borran o mueven cosas, o sea el momento en que alguien lee con más
//  atención, y son justo los que se ven distintos del resto.
//
//  ⚠ **Las comillas rectas de un CSV o de un atributo HTML no se tocan**: ahí
//  son sintaxis, no puntuación. La guardia mira solo texto que va a una
//  persona, y por eso busca el patrón `"${…}"` —un valor rodeado de comillas
//  dentro de una plantilla— y excluye los cuatro archivos que generan CSV o
//  HTML.
// ════════════════════════════════════════════

describe('Las comillas de un mensaje son angulares', () => {
  // Generan CSV o HTML: ahí la comilla recta es sintaxis obligatoria.
  const GENERAN_TEXTO_DE_MAQUINA = [
    'pages/Reports.jsx',
    'utils/pegadoDeLista.js',
    'utils/impresionInventario.js',
    'utils/printInvoice.js',
  ]

  const rectas = ARCHIVOS
    .filter(({ nombre }) => !GENERAN_TEXTO_DE_MAQUINA.includes(nombre))
    .flatMap(({ nombre, contenido }) =>
      sinComentarios(contenido)
        .split('\n')
        .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
        .filter(({ texto }) => /"\$\{/.test(texto))
    )

  it('ningún mensaje rodea un valor con comillas rectas', () => {
    expect(rectas.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('la guardia miró de verdad: las angulares se usan en varias pantallas', () => {
    // Ancla. Cero hallazgos se lee igual que «no encontré ningún archivo».
    const conAngulares = ARCHIVOS.filter(({ contenido }) => /«\$\{/.test(contenido))

    expect(conAngulares.length).toBeGreaterThan(2)
  })

  it('los archivos que generan CSV o HTML siguen usando comillas rectas', () => {
    // El contra-caso, y el que impide que alguien «corrija» un CSV: ahí la
    // comilla recta es lo que separa las columnas, y cambiarla rompe el archivo
    // que abre el contador.
    const deMaquina = ARCHIVOS.filter(({ nombre }) => GENERAN_TEXTO_DE_MAQUINA.includes(nombre))

    expect(deMaquina.length).toBe(GENERAN_TEXTO_DE_MAQUINA.length)
    expect(deMaquina.some(({ contenido }) => /"\$\{/.test(contenido))).toBe(true)
  })
})

// ════════════════════════════════════════════
//  ── 7 · Un solo rebote de buscador ──
//
//  Había cuatro, escritos por separado: 250 ms en Proveedores, 250 en Órdenes
//  de compra, 300 en TiendaNube y 350 en Historial de ventas. Ninguno estaba
//  mal, y por eso nadie los miró: **la diferencia no se nota mirando una sola
//  pantalla, se nota al pasar de una a otra**, que es lo que hace alguien que
//  usa el sistema todo el día.
//
//  Un buscador que responde a distinta velocidad según la pantalla se lee como
//  que unas están más pesadas que otras.
//
//  ⚠ Inventario NO entra: filtra en el navegador sobre lo que ya tiene cargado,
//  así que no hay pedido que rebotar y esperar sería demora pura.
// ════════════════════════════════════════════

describe('El rebote del buscador sale de un solo lugar', () => {
  const FUENTE = 'utils/busqueda.js'

  it('ninguna pantalla declara su propio ESPERA_DE_BUSQUEDA', () => {
    const propias = ARCHIVOS
      .filter(({ nombre }) => nombre !== FUENTE)
      .flatMap(({ nombre, contenido }) =>
        sinComentarios(contenido)
          .split('\n')
          .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
          .filter(({ texto }) => /^(const|let)\s+ESPERA_DE_BUSQUEDA\s*=/.test(texto))
      )

    expect(propias.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('ningún `setTimeout` de búsqueda lleva el número escrito a mano', () => {
    // El otro camino, y el que tenían tres de las cuatro: no declarar constante
    // y poner el número directo en el `setTimeout`. Se buscan los milisegundos
    // sueltos de dos o tres cifras, que es la forma que tomaba.
    const aMano = ARCHIVOS
      .filter(({ nombre }) => nombre !== FUENTE)
      .flatMap(({ nombre, contenido }) => {
        const limpio = sinComentarios(contenido)

        return [...limpio.matchAll(/setBusqueda|setFiltro|aplicarFiltro/g)].length === 0
          ? []
          : limpio
            .split('\n')
            .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
            .filter(({ texto }) => /\}, [23]\d\d\)/.test(texto))
      })

    expect(aMano.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('la guardia miró de verdad: la fuente existe y la usan varias pantallas', () => {
    const fuente = ARCHIVOS.find(({ nombre }) => nombre === FUENTE)

    expect(fuente).toBeDefined()
    expect(fuente.contenido).toMatch(/export const ESPERA_DE_BUSQUEDA = \d+/)

    const usuarios = ARCHIVOS.filter(({ contenido }) => /from '@\/utils\/busqueda'/.test(contenido))
    expect(usuarios.length).toBeGreaterThanOrEqual(4)
  })
})

// ════════════════════════════════════════════
//  ── 8 · La pantalla se llama igual en el menú y adentro ──
//
//  Tres no coincidían:
//
//   · el menú decía «Comparar proveedores» y la pantalla «Comparador de
//     proveedores»;
//   · «Fórmulas y recetas» adentro era «Fórmulas y Recetas», con mayúscula;
//   · «Suscripción» adentro era «Suscripción y Plan».
//
//  Nada de eso rompe nada, y por eso sobrevivió: se ve solo cuando alguien va
//  del menú a la pantalla y se pregunta si llegó a la que quería. En un sistema
//  que alguien está aprendiendo, esa duda cuesta más que un botón mal puesto.
//
//  ⚠ Esta guardia se lee al revés que las otras: no prohíbe un patrón, **exige
//  que dos textos sean iguales**. La lista de pares está escrita a mano porque
//  no hay forma estática de saber qué pantalla dibuja qué ruta.
// ════════════════════════════════════════════

describe('El nombre del menú y el título de la pantalla coinciden', () => {
  /** Ruta → archivo que la dibuja. */
  const PANTALLA_DE_LA_RUTA = [
    ['/ventas', 'pages/InvoicesList.jsx'],
    ['/inventario', 'pages/Inventory.jsx'],
    ['/recetas', 'pages/Recipes.jsx'],
    ['/faltantes', 'pages/Faltantes.jsx'],
    ['/proveedores', 'pages/Orders.jsx'],
    ['/comparador', 'pages/Comparador.jsx'],
    ['/ordenes-compra', 'pages/PurchaseOrders.jsx'],
    ['/gastos', 'pages/Expenses.jsx'],
    ['/panel', 'pages/Dashboard.jsx'],
    ['/facturacion', 'pages/Settings.jsx'],
    ['/tiendanube', 'pages/Tiendanube.jsx'],
    ['/team', 'pages/Team.jsx'],
    ['/suscripcion', 'pages/SubscriptionSettings.jsx'],
  ]

  /** El nombre que declara el menú para esa ruta. */
  function delMenu(ruta) {
    const fuente = ARCHIVOS.find(({ nombre }) => nombre === 'components/navegacion.js')
    const linea = fuente.contenido
      .split('\n')
      .find((l) => l.includes(`to: '${ruta}'`))

    return linea?.match(/label:\s*'([^']+)'/)?.[1] || null
  }

  /**
   * El título que dibuja la pantalla: el `titulo=` de `PageHeader` o su `<h1>`.
   *
   * Las dos formas conviven —cuatro pantallas se hicieron a mano antes de que
   * existiera `PageHeader`— y la guardia acepta las dos: lo que se verifica acá
   * es el TEXTO, no cómo se dibuja.
   */
  function deLaPantalla(archivo) {
    const fuente = ARCHIVOS.find(({ nombre }) => nombre === archivo)
    if (!fuente) return null

    const limpio = sinComentarios(fuente.contenido)

    // ⚠ Se busca el `titulo=` **de `PageHeader`**, no el primero del archivo.
    //
    // `EstadoVacio` también recibe un `titulo`, y en tres pantallas aparece
    // antes: la guardia comparaba «Ninguna orden coincide con el filtro.»
    // contra «Órdenes de compra» y daba tres falsos hallazgos. Un hallazgo
    // falso cuesta más que ninguno, porque enseña a no leerlos.
    const delPageHeader = limpio.match(/<PageHeader[\s\S]{0,300}?titulo="([^"]+)"/)?.[1]
    if (delPageHeader) return delPageHeader

    // El `<h1>` entero, con lo que tenga adentro. Cuatro pantallas le ponen un
    // ícono delante: se saca el `<Icono />` y queda el texto.
    const bloque = limpio.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
    if (!bloque) return null

    const texto = bloque.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

    // ⚠ Vacío es `null` y NO `''`. La primera versión de esto devolvía `' '`
    // para las dos pantallas con ícono, y `' '` es truthy: el ancla de abajo la
    // daba por buena y el `it.each` comparaba un espacio contra el nombre. La
    // guardia informaba dos fallas reales y podría no haber informado ninguna.
    return texto || null
  }

  it('la guardia miró de verdad: encuentra los dos textos de cada pantalla', () => {
    // Ancla, y la más importante de esta guardia: si `deLaPantalla` devolviera
    // `null` para todas, el `it` de abajo compararía `null` con `null` y pasaría
    // sin haber leído un solo título.
    const sinTitulo = PANTALLA_DE_LA_RUTA
      // `trim()` además del truthy: un título en blanco no es un título.
      .filter(([, archivo]) => !deLaPantalla(archivo)?.trim())
      .map(([, archivo]) => archivo)

    const sinNombre = PANTALLA_DE_LA_RUTA
      .filter(([ruta]) => !delMenu(ruta))
      .map(([ruta]) => ruta)

    expect(sinTitulo).toEqual([])
    expect(sinNombre).toEqual([])
  })

  it.each(PANTALLA_DE_LA_RUTA)('%s dice lo mismo en el menú y adentro', (ruta, archivo) => {
    expect(deLaPantalla(archivo)).toBe(delMenu(ruta))
  })
})

// ════════════════════════════════════════════
//  ── 9 · Todas las pantallas entran igual ──
//
//  `anim-subida` estaba en ocho de las doce. Las otras cuatro —Proveedores,
//  Órdenes de compra, Panel y Faltantes— aparecían de golpe.
//
//  ── Por qué importa más de lo que parece ──
//
//  No se nota mirando una pantalla: se nota **al cambiar de pantalla**, que es
//  lo que alguien hace cincuenta veces por día. Ocho entran subiendo ocho
//  píxeles y cuatro aparecen de golpe, así que la aplicación se siente
//  entrecortada sin que nadie pueda decir por qué. Es la corrección más barata
//  del hito —una clase por archivo— y la que más veces por día se ve.
//
//  ⚠ La animación NO se aplica con `prefers-reduced-motion`: está resuelto en
//  `index.css`, y por eso poner la clase es seguro en todas.
// ════════════════════════════════════════════

describe('Cada pantalla entra con la misma animación', () => {
  /** Las doce pantallas del sistema, con el archivo que las dibuja. */
  const PANTALLAS = [
    'pages/InvoicesList.jsx',
    'pages/Inventory.jsx',
    'pages/Faltantes.jsx',
    'pages/Orders.jsx',
    'pages/Comparador.jsx',
    'pages/PurchaseOrders.jsx',
    'pages/Expenses.jsx',
    'pages/Dashboard.jsx',
    'pages/Settings.jsx',
    'pages/Tiendanube.jsx',
    'pages/Team.jsx',
  ]

  it('ninguna se quedó sin `anim-subida`', () => {
    const sinAnimacion = PANTALLAS.filter((archivo) => {
      const fuente = ARCHIVOS.find(({ nombre }) => nombre === archivo)
      return !fuente || !/anim-subida/.test(sinComentarios(fuente.contenido))
    })

    expect(sinAnimacion).toEqual([])
  })

  it('la guardia miró de verdad: los once archivos existen', () => {
    // Ancla. Una lista de archivos que no existen da cero hallazgos y verde.
    const faltan = PANTALLAS.filter(
      (archivo) => !ARCHIVOS.some(({ nombre }) => nombre === archivo)
    )

    expect(faltan).toEqual([])
  })

  it('y la animación se apaga con `prefers-reduced-motion`', () => {
    // La otra mitad, y la que hace que poner la clase sea seguro: sin esto,
    // «todas las pantallas animadas» sería peor que el defecto para quien pidió
    // que no se muevan.
    const fs = require('node:fs')
    const css = fs.readFileSync(path.join(RAIZ, 'index.css'), 'utf8')

    expect(css).toMatch(/prefers-reduced-motion/)
    expect(css.slice(css.indexOf('prefers-reduced-motion'))).toMatch(/anim-subida/)
  })
})

// ════════════════════════════════════════════
//  ── 10 · Un solo «acá todavía no hay nada» ──
//
//  Había SEIS formas de dibujarlo: tres funciones llamadas `EstadoVacio`
//  —`Team.jsx` y `Tiendanube.jsx` idénticas salvo el ícono, `PurchaseOrders.jsx`
//  con otra forma— y tres pantallas que lo hacían a mano, **las tres sin
//  ícono**: `Comparador`, `Dashboard` y `Faltantes`.
//
//  ⚠ **El día 1 las doce pantallas están vacías.** Los estados vacíos no son un
//  caso de borde: son la primera pasada completa que ve el dueño del comercio
//  cuando abre el sistema por primera vez. Que la mitad tenga ícono y la otra
//  mitad no es lo primero que se ve, y es lo que hace que un sistema nuevo
//  parezca a medio terminar.
//
//  Y el ícono no es decoración: sin él, un bloque con dos renglones de texto
//  gris se lee como un error, no como «esto está vacío».
// ════════════════════════════════════════════

describe('El estado vacío sale de un solo componente', () => {
  const FUENTE = 'components/EstadoVacio.jsx'

  it('ninguna pantalla declara su propio EstadoVacio', () => {
    const propios = ARCHIVOS
      .filter(({ nombre }) => nombre !== FUENTE)
      .flatMap(({ nombre, contenido }) =>
        sinComentarios(contenido)
          .split('\n')
          .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
          .filter(({ texto }) => /^function EstadoVacio\b/.test(texto))
      )

    expect(propios.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('el componente compartido siempre dibuja un ícono', () => {
    // Con `icono` opcional, la mitad de las pantallas se lo iba a olvidar — que
    // es exactamente lo que pasó con las tres que lo hacían a mano. Por eso hay
    // un valor por omisión y no un `icono &&`.
    const fuente = ARCHIVOS.find(({ nombre }) => nombre === FUENTE)

    expect(fuente).toBeDefined()
    expect(fuente.contenido).toMatch(/const Icono = icono \|\|/)
    expect(fuente.contenido).toMatch(/<Icono/)
  })

  it('lo usan al menos seis pantallas', () => {
    // Ancla. Cero declaraciones propias se lee igual que «no encontré ningún
    // archivo», y así es como esta guardia se queda verde para siempre.
    const usuarios = ARCHIVOS.filter(({ contenido }) =>
      /from '@\/components\/EstadoVacio'/.test(contenido)
    )

    expect(usuarios.length).toBeGreaterThanOrEqual(6)
  })

  it('y ninguna pantalla dibuja un vacío a mano sin ícono', () => {
    // El otro camino, y el que tenían las tres: no declarar función y escribir
    // el `<div className="py-12 text-center">` directo. Se busca ese patrón sin
    // un `<svg`/ícono cerca.
    const aMano = ARCHIVOS
      .filter(({ nombre }) => nombre !== FUENTE)
      .flatMap(({ nombre, contenido }) => {
        const limpio = sinComentarios(contenido)
        const hallazgos = []

        // ⚠ El `className` tiene que ser EXACTAMENTE el del vacío. Con un
        // `[^"]*py-12 text-center` suelto entraban los paneles de borde
        // punteado de `PanelVenta` y `PanelOrdenDeCompra`, que son otra cosa —un
        // hueco dentro de un panel abierto, no un estado vacío de pantalla— y
        // daban dos hallazgos falsos. Un hallazgo falso cuesta más que ninguno,
        // porque enseña a no leerlos.
        for (const m of limpio.matchAll(/className="py-(?:8|12) text-center"[\s\S]{0,320}?<\/div>/g)) {
          // Si adentro hay un componente con mayúscula —el ícono— está bien.
          if (!/<[A-Z]\w+\s/.test(m[0])) {
            hallazgos.push(`${nombre}: ${m[0].slice(0, 60).replace(/\s+/g, ' ')}`)
          }
        }

        return hallazgos
      })

    expect(aMano).toEqual([])
  })
})

// ════════════════════════════════════════════
//  ── 11 · Lo que pagina dice cuánto hay ──
//
//  La franja «Mostrando 25 de 312 productos» estaba en dos de las cinco que
//  paginan. En las otras tres —Órdenes de compra, TiendaNube y el historial de
//  movimientos de un proveedor— había botones «1 · 2 · 3» y nada más.
//
//  Los botones dicen que hay más páginas; el «de 312» dice cuánto más. Sin la
//  franja, quien está en la última página no tiene forma de saber si llegó al
//  final o si la lista se cortó.
//
//  ⚠ Es **lo único de la lista que agrega información**: los dos números ya
//  estaban en la pantalla —el total en el badge, las filas se pueden contar—
//  pero puestos uno al lado del otro contestan de un vistazo la pregunta que se
//  hace cualquiera frente a una tabla larga: «¿esto es todo?».
// ════════════════════════════════════════════

describe('La paginación viene con su franja', () => {
  it('nadie usa `Pagination` suelto: va adentro de `PieDeTabla`', () => {
    const sueltos = ARCHIVOS
      .filter(({ nombre }) => nombre !== 'components/PieDeTabla.jsx')
      .flatMap(({ nombre, contenido }) =>
        sinComentarios(contenido)
          .split('\n')
          .map((linea, i) => ({ archivo: nombre, n: i + 1, texto: linea.trim() }))
          .filter(({ texto }) => /<Pagination\b/.test(texto))
      )

    expect(sueltos.map(({ archivo, n }) => `${archivo}:${n}`)).toEqual([])
  })

  it('la guardia miró de verdad: cinco listas usan el pie', () => {
    // Ancla. Cero `<Pagination>` sueltos se lee igual que «no hay paginación en
    // ningún lado», y así es como esta guardia se queda verde para siempre.
    const conPie = ARCHIVOS.filter(({ contenido }) =>
      /from '@\/components\/PieDeTabla'/.test(contenido)
    )

    expect(conPie.length).toBeGreaterThanOrEqual(5)
  })

  it('y el pie dibuja los DOS números, no solo el total', () => {
    // Un pie que dijera solo «312 productos» no contesta «¿esto es todo?»: es
    // el mismo número que ya está en el badge del encabezado.
    const fuente = ARCHIVOS.find(({ nombre }) => nombre === 'components/PieDeTabla.jsx')

    expect(fuente).toBeDefined()
    expect(fuente.contenido).toMatch(/\{mostrados\}/)
    expect(fuente.contenido).toMatch(/\{total\}/)
  })
})

// ════════════════════════════════════════════
//  ── 12 · Una falla de carga se anuncia ──
//
//  Faltaba `role="alert"` en tres avisos de error de carga: `Dashboard`,
//  `Inventory` y `EstadoDeTiendanube`. Con un lector de pantalla nadie se
//  enteraba de que la carga había fallado: la persona seguía esperando datos
//  que no iban a llegar, y el único indicio era visual.
//
//  ⚠ Es peor que no ver el error. Un error visible se lee y se reintenta; un
//  error que no se anuncia deja a alguien esperando indefinidamente algo que ya
//  falló.
// ════════════════════════════════════════════

describe('Los avisos de error de carga se anuncian', () => {
  it('todo bloque `bg-danger-soft` con un `{error}` adentro lleva role="alert"', () => {
    const sinAnuncio = ARCHIVOS.flatMap(({ nombre, contenido }) => {
      const limpio = sinComentarios(contenido)
      const hallazgos = []

      // El bloque entero del aviso: desde el `<div` que lo abre hasta 400
      // caracteres después, que es donde vive el `{error}`.
      for (const m of limpio.matchAll(/<div\b[^>]{0,400}bg-danger-soft[\s\S]{0,400}?\{error\}/g)) {
        if (!/role="alert"/.test(m[0])) {
          hallazgos.push(nombre)
        }
      }

      return hallazgos
    })

    expect([...new Set(sinAnuncio)]).toEqual([])
  })

  it('la guardia miró de verdad: hay avisos de error con `role="alert"`', () => {
    const conAnuncio = ARCHIVOS.filter(({ contenido }) =>
      /role="alert"/.test(contenido) && /bg-danger-soft/.test(contenido)
    )

    expect(conAnuncio.length).toBeGreaterThanOrEqual(3)
  })
})

// ════════════════════════════════════════════
//  ── 13 · Un buscador se ve como un buscador ──
//
//  El de TiendaNube era el único de la aplicación sin lupa, y su `placeholder`
//  decía «Nombre o SKU»: nombra lo que se escribe pero no dice que sirva para
//  buscar. Sin ícono, un campo no se lee como buscador — se lee como un campo
//  más que hay que completar.
// ════════════════════════════════════════════

describe('Todo campo de búsqueda lleva su lupa', () => {
  /** Los `<input>` cuyo `aria-label` o `placeholder` dice que se busca. */
  const buscadores = ARCHIVOS.flatMap(({ nombre, contenido }) => {
    const limpio = sinComentarios(contenido)
    const encontrados = []

    for (const m of limpio.matchAll(/<input\b[\s\S]{0,600}?\/>/g)) {
      if (!/aria-label="Buscar|placeholder="Buscar/.test(m[0])) continue

      encontrados.push({ archivo: nombre, bloque: m[0] })
    }

    return encontrados
  })

  it('la guardia miró de verdad: hay buscadores en varias pantallas', () => {
    // Ancla, y la que atrapa un regex que dejó de matchear.
    const pantallas = new Set(buscadores.map(({ archivo }) => archivo))

    expect(pantallas.size).toBeGreaterThanOrEqual(4)
  })

  it('cada uno tiene una lupa al lado', () => {
    // La lupa va como hermana del `<input>`, así que se busca en el archivo
    // dentro de la ventana del contenedor. Se afirma por pantalla y no por
    // campo: una pantalla con buscador y sin `Search` importado no tiene lupa
    // en ninguno.
    const sinLupa = [...new Set(buscadores.map(({ archivo }) => archivo))].filter((archivo) => {
      const fuente = ARCHIVOS.find(({ nombre }) => nombre === archivo)
      return !/<Search\b/.test(sinComentarios(fuente.contenido))
    })

    expect(sinLupa).toEqual([])
  })

  it('y el placeholder dice que se busca, no solo qué se escribe', () => {
    // «Nombre o SKU» nombra el dato; «Buscar por nombre o SKU» nombra la acción.
    // Es la diferencia entre un campo que se completa y uno que se usa.
    const vagos = buscadores
      .filter(({ bloque }) => {
        const placeholder = bloque.match(/placeholder="([^"]+)"/)?.[1]
        return placeholder && !/buscar/i.test(placeholder)
      })
      .map(({ archivo }) => archivo)

    expect([...new Set(vagos)]).toEqual([])
  })
})

// ════════════════════════════════════════════
//  ── 14 · Nada apretable se queda sin teclado ──
//
//  `TablaGrid.Fila` era un `<div>` con `onClick`, sin `role`, sin `tabIndex` y
//  sin `onKeyDown`. Abrir el detalle de una venta, un producto, un gasto, una
//  orden, un miembro o una variante de TiendaNube era **exclusivamente con
//  mouse, en seis pantallas**. En `pages/` y `components/` enteros no había un
//  solo `tabIndex`.
//
//  ⚠ **Cinco lentes de coherencia no lo vieron**, y el motivo es el hallazgo de
//  método más grande del hito: las cinco comparan pantalla contra pantalla.
//  Encontraron `role="alert"` y `disabled:pointer-events-none` —que también son
//  accesibilidad— pero llegaron por «esta pantalla difiere de aquélla», no por
//  «esto no se puede usar sin mouse».
//
//  **Una lente de coherencia es ciega a lo que está mal en las doce por igual.**
//
//  Esta guardia mira lo otro: cualquier `<div>` con `onClick` que no sea la
//  `Fila` del marco. Son los que se escriben a mano y nacen sin teclado.
// ════════════════════════════════════════════

describe('Un div con onClick no se queda sin teclado', () => {
  /**
   * Los `<div>` con `onClick` que no declaran teclado.
   *
   * ── Dos formas que NO funcionan, y por qué ──
   *
   * `/<div[^>]*>/` corta la etiqueta en el `>` de la flecha de un
   * `onClick={() => …}`, así que lee mal todo lo que viene después. Y contar
   * llaves para encontrar el cierre real se desincroniza con las llaves que
   * viven adentro de una cadena o de una plantilla.
   *
   * Las dos versiones dieron hallazgos FALSOS —la primera tres, incluida la
   * `Fila` del marco, que sí tiene teclado— y un hallazgo falso cuesta más que
   * ninguno: enseña a no leerlos.
   *
   * Esto va por líneas, que es lo que se puede verificar mirando el archivo:
   * de cada `onClick` se sube hasta la línea que abre la etiqueta, y se lee esa
   * etiqueta hasta donde cierra.
   */
  function divsSordos(nombre, texto) {
    const lineas = texto.split(SALTO)
    const hallazgos = []

    lineas.forEach((linea, i) => {
      if (!/onClick=/.test(linea)) return

      // Hacia arriba hasta la linea que abre una etiqueta.
      let inicio = i
      while (inicio >= 0 && !/<[A-Za-z]/.test(lineas[inicio])) inicio--
      if (inicio < 0) return

      const etiqueta = lineas[inicio].match(/<([A-Za-z][\w.]*)/)?.[1]
      if (etiqueta !== 'div') return

      // Hacia abajo hasta donde cierra. El tope es generoso: la `Fila` del
      // marco declara su teclado en un objeto esparcido y su etiqueta pasa las
      // treinta lineas, asi que con un tope corto se marcaba a si misma.
      let fin = inicio
      while (fin < lineas.length && fin - inicio < 45 && !/>\s*$/.test(lineas[fin])) fin++

      const bloque = lineas.slice(inicio, fin + 1).join(SALTO)

      // `role=` o `role:`: el marco los pasa por un objeto esparcido.
      if (/role[=:]/.test(bloque) && /onKeyDown[=:]/.test(bloque)) return

      hallazgos.push(`${nombre}:${inicio + 1}`)
    })

    return hallazgos
  }

  const sinTeclado = ARCHIVOS.flatMap(({ nombre, contenido }) =>
    divsSordos(nombre, sinComentarios(contenido))
  )

  it('ningún `<div onClick>` escrito a mano queda sin `role` ni `onKeyDown`', () => {
    expect(sinTeclado).toEqual([])
  })

  it('la guardia miró de verdad: la `Fila` del marco SÍ tiene teclado', () => {
    // Ancla. Cero hallazgos se lee igual que «no hay ningún div apretable», que
    // es como esta guardia se queda verde el día que alguien cambie la forma.
    const marco = ARCHIVOS.find(({ nombre }) => nombre === 'components/TablaGrid.jsx')

    expect(marco).toBeDefined()
    expect(marco.contenido).toMatch(/role: 'button'/)
    expect(marco.contenido).toMatch(/tabIndex: 0/)
    expect(marco.contenido).toMatch(/onKeyDown:/)
  })

  it('y la muestra sintética de un div sordo SÍ da hallazgo', () => {
    // Sin esto, un regex que dejó de matchear pasa las dos de arriba: la
    // primera porque no encuentra nada, la segunda porque mira otro archivo.
    const malo = '<div onClick={() => abrir(v)} className="fila">'
    const bueno = '<div onClick={abrir} role="button" tabIndex={0} onKeyDown={alTeclado}>'

    const sordo = (etiqueta) =>
      /\bonClick=/.test(etiqueta) && !(/role=/.test(etiqueta) && /onKeyDown=/.test(etiqueta))

    expect(sordo(malo)).toBe(true)
    expect(sordo(bueno)).toBe(false)
  })
})
