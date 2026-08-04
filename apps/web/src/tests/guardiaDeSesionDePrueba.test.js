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

function todosLosArchivos(dir, filtro = () => true) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const completo = path.join(dir, e.name)
    if (e.isDirectory()) return todosLosArchivos(completo, filtro)
    return filtro(completo) ? [completo] : []
  })
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

  it('ningún archivo de src/ IMPORTA nada de la carpeta de las pruebas de navegador', () => {
    // Un `import '../pruebas-de-navegador/...'` desde cualquier archivo de la
    // aplicación mete el bypass en el grafo de módulos sin pasar por el alias, y
    // entonces sí se compila.
    //
    // Se busca la SENTENCIA y no la palabra: `src/sesion/ProveedorDeSesion.jsx`
    // nombra la carpeta en su encabezado —es donde está explicado por qué ese
    // archivo existe— y `src/index.css` la nombra en un `@source not`, que es
    // justamente lo que la saca del escaneo de Tailwind. Prohibir la mención
    // haría que la salida barata fuera borrar la explicación.
    const IMPORTA = /(?:\bfrom\s*|\bimport\s*|\brequire\(\s*|@import\s*)['"][^'"]*pruebas-de-navegador/

    const codigo = todosLosArchivos(SRC, (f) => /\.(js|jsx|css|html)$/.test(f))
      .filter((f) => !f.includes(path.join('src', 'tests')))

    const culpables = codigo
      .filter((f) => {
        const t = fs.readFileSync(f, 'utf8')
        return IMPORTA.test(t) || MARCAS.some((m) => t.includes(m))
      })
      .map((f) => path.relative(WEB, f))

    expect(culpables).toEqual([])
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
