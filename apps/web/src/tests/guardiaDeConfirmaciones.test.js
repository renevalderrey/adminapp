import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

// ════════════════════════════════════════════
//  ADMINAPP · Toda confirmación dice qué hace, y el rojo significa algo
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
