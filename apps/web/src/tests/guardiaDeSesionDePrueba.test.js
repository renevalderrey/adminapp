import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ════════════════════════════════════════════
//  Guardia contra el bypass de sesión que llega a producción
//
//  Las pruebas de navegador entran a la aplicación sin Auth0 reemplazando
//  `@/sesion/ProveedorDeSesion` por uno que devuelve una sesión falsa. Ese
//  reemplazo lo declara `vite.config.js` **solo** cuando `command === 'serve'`.
//
//  ── Por qué no alcanza con confiar en eso ──
//
//  Porque es una función que alguien puede editar, y el error no se ve: la
//  aplicación sigue funcionando igual, los tests siguen en verde, el build sigue
//  pasando. Lo único que cambia es que cualquiera que pida la página se baja un
//  bypass de autenticación con el picaporte del lado de afuera.
//
//  Es el mismo criterio de las otras guardias estáticas de esta carpeta: leer el
//  código como texto y fallar si el patrón peligroso reaparece. Acá son cuatro
//  brazos, cada uno tapando el agujero del anterior:
//
//   1. `vite.config.js` no puede declarar el alias sin exigir `command ===
//      'serve'`. Es lo que hace imposible que un `vite build` lo resuelva.
//   2. Nada de `src/` puede nombrar la carpeta `pruebas-de-navegador`. Un
//      import desde el código de la aplicación mete el archivo en el grafo por
//      la puerta de al lado, sin tocar el alias.
//   3. El archivo del bypass tiene que seguir teniendo su marca. Sin marca, el
//      brazo 4 pasa a ser un test que siempre pasa.
//   4. Si hay `dist/`, ningún archivo servido puede tener esas marcas.
//
//  El brazo 4 es el único que necesita un build previo. En el CI corre siempre,
//  como `npm run verificar:bundle` justo después del build — y el último caso de
//  este archivo verifica que ese paso siga estando en el workflow, para que
//  saltearlo acá nunca sea silencioso.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(AQUI, '..', '..')
const SRC = path.join(WEB, 'src')
const DIST = path.join(WEB, 'dist')

/** La marca que exporta el proveedor falso, y las dos de respaldo. */
const MARCAS = [
  'BYPASS_DE_SESION_SOLO_PARA_PRUEBAS_DE_NAVEGADOR',
  'ProveedorDeSesionDePrueba',
  'token-de-prueba-sin-firma',
]

/**
 * El texto sin comentarios.
 *
 * Las MARCAS se buscan sobre esto y no sobre el archivo crudo, por el mismo
 * motivo que el regex `IMPORTA` de abajo busca la sentencia y no la palabra: un
 * archivo puede **nombrar** el bypass para explicar de qué se trata, y prohibir
 * la mención hace que la salida barata sea borrar la explicación.
 *
 * Paso de verdad: `services/api.js` nombra el archivo del bypass en su
 * encabezado —para explicar por qué el proveedor de sesión es reemplazable— y
 * esta guardia lo denunció como si lo estuviera importando. El comentario no
 * mete una sola línea en el bundle.
 *
 * Es la tercera vez en este repositorio que una guardia lee un comentario como
 * si fuera código: ya pasó con la posición de `resolverSucursal(` y con la
 * guardia que exige importar `fallo()`.
 */
function sinComentarios(texto) {
  return texto
    // ⚠ El bloque se reemplaza CONSERVANDO sus saltos de línea. Con un solo
    // espacio, el encabezado de sesenta líneas de `services/api.js` colapsa en
    // una y todos los números de línea de abajo quedan corridos — y un hallazgo
    // que manda a mirar la línea equivocada es un hallazgo que nadie cree.
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, ' ')
}

/**
 * La sentencia que mete el bypass en el grafo de módulos.
 *
 * Se busca la SENTENCIA y no la palabra: `src/sesion/ProveedorDeSesion.jsx`
 * nombra la carpeta en su encabezado —es donde está explicado por qué ese
 * archivo existe— y `src/index.css` la nombra en un `@source not`, que es
 * justamente lo que la saca del escaneo de Tailwind. Prohibir la mención haría
 * que la salida barata fuera borrar la explicación.
 */
const IMPORTA = /(?:\bfrom\s*|\bimport\s*|\brequire\(\s*|@import\s*)['"][^'"]*pruebas-de-navegador/

/**
 * Los archivos que importan el bypass o llevan alguna de sus marcas, con la
 * línea de cada hallazgo.
 *
 * ⚠ **Recibe la lista en vez de leerla.** Sin esto, la única forma de saber si
 * el detector sirve era que alguien metiera el bypass de verdad en `src/`: un
 * detector que solo se corre sobre un árbol limpio pasa en verde tanto si sabe
 * buscar como si no. Es exactamente lo que quedó cuando el hito 8 le agregó el
 * filtro de comentarios —un cambio que **puede** dejar ciega a la guardia— sin
 * una sola muestra que lo ejercitara.
 */
function importanElBypass(archivos) {
  return archivos.flatMap(({ nombre, contenido }) =>
    sinComentarios(contenido)
      .split('\n')
      .map((texto, i) => ({ n: i + 1, texto }))
      .filter(({ texto }) => IMPORTA.test(texto) || MARCAS.some((m) => texto.includes(m)))
      .map(({ n, texto }) => `${nombre}:${n} — ${texto.trim()}`)
  )
}

function todosLosArchivos(dir, filtro = () => true) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const completo = path.join(dir, e.name)
    if (e.isDirectory()) return todosLosArchivos(completo, filtro)
    return filtro(completo) ? [completo] : []
  })
}

/** Los archivos de la aplicación que la guardia revisa, sin los tests. */
function archivosDeLaAplicacion() {
  return todosLosArchivos(SRC, (f) => /\.(js|jsx|css|html)$/.test(f))
    .filter((f) => !f.includes(path.join('src', 'tests')))
    .map((f) => ({
      nombre: path.relative(WEB, f).split(path.sep).join('/'),
      contenido: fs.readFileSync(f, 'utf8'),
    }))
}

describe('El bypass de sesión no puede compilarse', () => {
  const CONFIG = fs.readFileSync(path.join(WEB, 'vite.config.js'), 'utf8')

  it('vite.config.js NO declara el alias de la sesión falsa sin exigir command === "serve"', () => {
    // La forma exacta importa menos que la condición: lo que no puede
    // desaparecer es que el `command` sea `serve`. `mode !== "production"` NO
    // sirve como reemplazo —`vite build --mode development` lo esquiva— y por
    // eso la guardia pide este literal y no cualquier condición.
    expect(CONFIG).toContain("command !== 'serve'")

    // Y el alias tiene que estar adentro de la función que hace esa
    // comprobación, no suelto en el objeto de config.
    const funcion = CONFIG.slice(
      CONFIG.indexOf('function aliasDeLaSesionDePrueba'),
      CONFIG.indexOf('export default')
    )
    expect(funcion, 'el alias se salió de la función que verifica el command').toContain(
      '@/sesion/ProveedorDeSesion'
    )
    expect(funcion).toContain('pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx')

    // Y hay UNA sola forma de llegar al archivo del bypass en toda la config:
    // si aparece un segundo `path.resolve` hacia él —en `plugins`, en
    // `optimizeDeps`, en un `define`—, el gate del `command` deja de ser el
    // único camino. Se cuentan las resoluciones de ruta y no las menciones,
    // porque los comentarios lo nombran para explicar de qué se trata.
    const resoluciones = CONFIG.match(/pruebas-de-navegador\/ProveedorDeSesionDePrueba\.jsx'/g) || []
    expect(resoluciones).toHaveLength(1)
  })

  it('la guardia leyó los archivos de src/ que dice revisar', () => {
    // **El ancla, y faltaba.** `[].filter(…)` da `[]`, y `expect([]).toEqual([])`
    // pasa: si el recorrido dejara de encontrar archivos —un cambio de extensión,
    // una carpeta que se mueve, un filtro que se afloja— el caso de abajo quedaría
    // en verde para siempre sin haber leído una sola línea.
    //
    // Los tres archivos nombrados no son decorativos: son **los que mencionan la
    // carpeta del bypass en un comentario**, o sea justo los que el filtro de
    // comentarios existe para no denunciar. Si alguno se cayera de la lista, el
    // filtro dejaría de estar ejercitado contra nada real.
    const archivos = archivosDeLaAplicacion()
    const nombres = archivos.map((a) => a.nombre)

    expect(archivos.length).toBeGreaterThan(30)
    expect(nombres).toContain('src/sesion/ProveedorDeSesion.jsx')
    expect(nombres).toContain('src/services/api.js')
    expect(nombres).toContain('src/index.css')

    // Y que esas menciones sigan estando: sin ellas el filtro de comentarios
    // podría estar roto y nada lo mostraría.
    const mencionan = archivos.filter((a) => a.contenido.includes('pruebas-de-navegador'))
    expect(mencionan.length).toBeGreaterThanOrEqual(3)
  })

  it('ningún archivo de src/ IMPORTA nada de la carpeta de las pruebas de navegador', () => {
    // Un `import '../pruebas-de-navegador/...'` desde cualquier archivo de la
    // aplicación mete el bypass en el grafo de módulos sin pasar por el alias, y
    // entonces sí se compila.
    expect(importanElBypass(archivosDeLaAplicacion())).toEqual([])
  })

  it('index.html tampoco lo carga como módulo suelto', () => {
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    expect(html).not.toContain('pruebas-de-navegador')
  })

  it('el archivo del bypass conserva la marca que busca la guardia del bundle', () => {
    // Sin este caso, borrar la marca del archivo dejaría al brazo del `dist/`
    // buscando algo que ya no existe: verde para siempre y sin proteger nada.
    const bypass = fs.readFileSync(
      path.join(WEB, 'pruebas-de-navegador', 'ProveedorDeSesionDePrueba.jsx'),
      'utf8'
    )
    for (const marca of MARCAS) {
      expect(bypass, `el bypass ya no contiene «${marca}»`).toContain(marca)
    }
  })
})

// ════════════════════════════════════════════
//  Las muestras sintéticas del detector
//
//  El caso de arriba corre sobre un árbol que hoy está limpio, así que pasa en
//  verde tanto si el detector sabe buscar como si no. Estas muestras son lo que
//  lo sostiene el día que alguien afloje el filtro de comentarios —que es un
//  cambio que **puede** dejarlo ciego y que el hito 8 hizo sin ejercitar nada—.
//
//  Van en los dos sentidos, y las dos direcciones importan igual: una guardia
//  que no encuentra el defecto no protege, y una que se queja de la explicación
//  obliga a borrar la explicación.
// ════════════════════════════════════════════

describe('el detector del bypass encuentra el import y no la explicación', () => {
  const muestra = (contenido) => importanElBypass([{ nombre: 'src/muestra.jsx', contenido }])

  it('nombra el import con su archivo y su línea', () => {
    const conDefecto = [
      "import { useState } from 'react'",
      "import ProveedorDeSesion from '../../pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx'",
      '',
      'export default function App() { return null }',
    ].join('\n')

    const hallazgos = muestra(conDefecto)

    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toContain('src/muestra.jsx:2')
    expect(hallazgos[0]).toContain('pruebas-de-navegador')
  })

  it('un bloque de comentario largo NO corre el número de línea del hallazgo', () => {
    // ⚠ El filtro reemplazaba cada bloque por UN espacio, así que un encabezado
    // de sesenta líneas —los tiene medio repositorio— colapsaba en una y todos
    // los números de abajo quedaban corridos. Un hallazgo con la línea corrida
    // manda a mirar el lugar equivocado, y quien lo mira concluye que la guardia
    // se equivocó.
    const conEncabezado = [
      '/*',
      ' * Encabezado de tres líneas.',
      ' */',
      "import X from '../../pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx'",
    ].join('\n')

    expect(muestra(conEncabezado)[0]).toContain('src/muestra.jsx:4')
  })

  it('encuentra la marca aunque no venga de un import', () => {
    // El segundo brazo: copiar la constante adentro de un archivo de `src/`
    // compila el bypass sin ningún import de la carpeta.
    const copiada = "export const MARCA = 'BYPASS_DE_SESION_SOLO_PARA_PRUEBAS_DE_NAVEGADOR'"

    expect(muestra(copiada)).toHaveLength(1)
  })

  it('NO se queja de la carpeta nombrada en un comentario de línea', () => {
    // Es el paso que ya se pagó: `services/api.js` nombra el archivo del bypass
    // en su encabezado para explicar por qué el proveedor es reemplazable, y la
    // guardia lo denunció como si lo estuviera importando. Un comentario no mete
    // una sola línea en el bundle, y la salida barata habría sido borrar la
    // explicación.
    const explicando = [
      "// El proveedor se reemplaza por pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx",
      "// mediante un alias que vite.config.js declara solo con command === 'serve'.",
      "import ProveedorDeSesion from '@/sesion/ProveedorDeSesion'",
    ].join('\n')

    expect(muestra(explicando)).toEqual([])
  })

  it('NO se queja de la carpeta nombrada en un bloque /* */ ni de la marca citada ahí', () => {
    const explicando = [
      '/*',
      " *  import X from '../pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx'",
      " *  export const BYPASS_DE_SESION_SOLO_PARA_PRUEBAS_DE_NAVEGADOR = true",
      ' */',
      "export default function Nada() { return null }",
    ].join('\n')

    expect(muestra(explicando)).toEqual([])
  })

  it('NO se queja del @source not de index.css, que es lo que la saca del escaneo', () => {
    // `index.css` **tiene** que nombrar la carpeta: sin ese `@source not`, cada
    // utilidad arbitraria que una prueba de medidas mencione entra al CSS que baja
    // el navegador del cliente. Una guardia que lo prohibiera pediría exactamente
    // lo contrario de lo que otra guardia exige.
    const css = '@source not "../pruebas-de-navegador/**";'

    expect(muestra(css)).toEqual([])
  })
})

describe('El bundle servido no tiene el bypass de sesión', () => {
  const hayBundle = fs.existsSync(DIST)

  it.skipIf(!hayBundle)('ningún archivo de dist/ contiene las marcas del bypass', () => {
    const servidos = todosLosArchivos(DIST)
    expect(servidos.length, 'dist/ existe pero está vacío').toBeGreaterThan(0)

    const hallazgos = []
    for (const archivo of servidos) {
      const contenido = fs.readFileSync(archivo)
      for (const marca of MARCAS) {
        if (contenido.includes(marca)) hallazgos.push(`${path.relative(DIST, archivo)}: ${marca}`)
      }
    }

    expect(hallazgos).toEqual([])
  })

  it('el CI verifica el bundle DESPUÉS de buildear, así saltear el caso de arriba nunca es silencioso', () => {
    // El caso de arriba se saltea en un clon recién bajado, que no tiene
    // `dist/`. Que se saltee está bien; que nadie lo corra nunca, no. Esto fija
    // que el workflow siga teniendo el paso, y en el orden que corresponde.
    const CI = fs.readFileSync(path.join(WEB, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8')

    expect(CI).toContain('npm run verificar:bundle')
    expect(
      CI.indexOf('npm run verificar:bundle'),
      'la verificación del bundle tiene que ir después del build, no antes'
    ).toBeGreaterThan(CI.indexOf('run: npm run build'))
  })
})
