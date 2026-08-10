import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ════════════════════════════════════════════
//  La guardia de la tienda
//
//  `apps/tienda` **no comparte nada con `apps/web`**, y esa es su propiedad
//  definitoria, no una omisión. Ni el sistema de diseño —`apps/web` declara
//  mínimo 1280px y esto se abre escaneando un QR desde un teléfono—, ni Auth0
//  —acá no hay con qué identificarse: la empresa sale del slug y de ningún otro
//  lado—, ni el cliente HTTP.
//
//  ── Por qué hace falta una guardia y no alcanza con haberlo escrito bien ──
//
//  Porque el defecto no se ve. La próxima persona que agregue una pantalla va a
//  necesitar un `fetch` con opciones, va a abrir `apps/web/src/services/api.js`
//  —que es el archivo que responde esa pregunta en este repositorio— y va a
//  copiar el bloque que arma las cabeceras. La tienda va a seguir funcionando
//  **igual**: el router público no lee cabeceras de sesión, así que no hay error
//  que ver, ni test de pantalla que se ponga en rojo. Lo único que cambia es que
//  una página que le servimos a cualquiera empieza a mandar el identificador de
//  sesión de quien tenga uno guardado.
//
//  Con el hexadecimal pasa lo mismo por el otro lado: un `#00B4B6` escrito en un
//  botón se ve perfecto — con el catálogo de prueba. Con el catálogo de un
//  comercio que eligió negro, ese botón es el único que quedó turquesa, y nadie
//  lo va a encontrar buscando en el panel.
//
//  Es el mismo criterio de las guardias estáticas de `apps/web/src/tests/`: leer
//  el código como texto y fallar si el patrón reaparece.
//
//  ── El ancla ──
//
//  Una guardia que recorre una carpeta puede pasar **por vacío**: si el recorrido
//  devuelve cero archivos —una carpeta que se movió, un filtro de extensión que
//  se quedó viejo, un `readdirSync` que falla y se traga— la suite queda en verde
//  afirmando que revisó todo. Por eso el último caso fija **qué archivos** se
//  revisaron. Cuando lleguen las pantallas de T1444 el ancla sube, a mano y a la
//  vista, que es el punto.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

/**
 * `src/tests/` queda afuera del recorrido.
 *
 * No es una excepción cómoda: es que **este archivo tiene que poder nombrar lo
 * que prohíbe**. Los patrones de abajo son las cadenas prohibidas, y la muestra
 * sintética las escribe enteras a propósito. Una guardia que se denuncia a sí
 * misma se «arregla» ofuscando sus propios patrones, y ahí deja de leerse.
 *
 * El corte además es el correcto: lo que la guardia cuida es **lo que se le
 * sirve al visitante**, y los tests no entran al bundle.
 */
const CARPETAS_EXCLUIDAS = ['tests']

const EXTENSIONES = ['.js', '.jsx', '.css']

/**
 * El texto sin comentarios.
 *
 * Los patrones se buscan sobre esto y no sobre el archivo crudo, porque un
 * archivo tiene que poder **explicar** por qué no lleva una cabecera de sesión
 * sin que eso lo ponga en rojo. Prohibir la mención hace que la salida barata
 * sea borrar la explicación, y la explicación es la mitad de la defensa.
 *
 * En `apps/web` esto ya pasó de verdad: la guardia del bypass de sesión denunció
 * `services/api.js` por nombrar el archivo del bypass en su encabezado.
 *
 * ⚠ El bloque se reemplaza **conservando los saltos de línea**: un hallazgo que
 * manda a mirar la línea equivocada es un hallazgo que nadie cree.
 */
export function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, ' ')
}

export const PROHIBIDOS = [
  {
    que: 'la cabecera del portador',
    patron: /Authorization/i,
    porque:
      'El router público no tiene cadena de autenticación: la cabecera no se lee. Mandarla es filtrar una credencial hacia una página que ve cualquiera.',
  },
  {
    que: 'la cabecera del identificador de sesión',
    patron: /X-Sesion-Id/i,
    porque: 'Acá no hay sesión. Un identificador que viaja desde la tienda es un dispositivo registrado por alguien que nunca entró.',
    exentos: [],
  },
  {
    que: 'Auth0',
    patron: /auth0/i,
    porque: 'La tienda no tiene login. Importar el SDK arrastra el redirect al login en una pantalla que se abre desde un QR.',
  },
  {
    que: 'el cliente HTTP de apps/web',
    patron: /@\/services\/api/,
    porque:
      'Es el archivo con los interceptores, las dos cabeceras y el manejo del 401 que dispara el cierre de sesión. La tienda tiene el suyo, `src/api.js`, de treinta líneas y sin nada de eso.',
  },
  {
    que: 'el token guardado en el navegador',
    patron: /localStorage\s*\.\s*getItem\s*\(\s*['"`]token['"`]\s*\)/,
    porque: 'No hay token que leer, y leerlo sería el primer paso para mandarlo.',
  },
  {
    // `#abc`, `#aabbcc` y `#aabbccdd`. **No** `#1042` ni `#41`, que son números
    // de pedido y de línea escritos en el código: el `(?![0-9a-fA-F])` corta las
    // longitudes intermedias y los comentarios ya se sacaron más arriba.
    que: 'un hexadecimal de color',
    patron: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/,
    porque:
      'El color de un catálogo es uno solo y sale de la base. Los componentes usan `var(--marca)`; el hexadecimal vive en `src/tema.js` y en ningún otro lado.',
    exentos: ['tema.js'],
  },
]

function recorrer(carpeta) {
  return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(carpeta, entrada.name)
    if (entrada.isDirectory()) {
      return CARPETAS_EXCLUIDAS.includes(entrada.name) ? [] : recorrer(completo)
    }
    return EXTENSIONES.includes(path.extname(entrada.name)) ? [completo] : []
  })
}

const relativo = (completo) => path.relative(SRC, completo).split(path.sep).join('/')

/** Los hallazgos de un texto cualquiera. Es lo que comparten el recorrido y la muestra sintética. */
export function hallazgosEn(nombre, texto) {
  const codigo = sinComentarios(texto)
  return PROHIBIDOS.filter(({ patron, exentos = [] }) => {
    if (exentos.includes(nombre) || exentos.includes(path.basename(nombre))) return false
    return patron.test(codigo)
  }).map(({ que, porque }) => `${nombre}: ${que} — ${porque}`)
}

const REVISADOS = recorrer(SRC).map((completo) => ({
  nombre: relativo(completo),
  texto: fs.readFileSync(completo, 'utf8'),
}))

describe('guardia de la tienda · no hay ninguna cabecera de sesión en apps/tienda/src', () => {
  it('ningún archivo de src/ nombra lo que la tienda no puede tener', () => {
    const hallazgos = REVISADOS.flatMap(({ nombre, texto }) => hallazgosEn(nombre, texto))
    expect(hallazgos).toEqual([])
  })

  // ── La muestra sintética ──
  //
  // Sin esto, la guardia de arriba es un test que pasa siempre: si mañana el
  // recorrido se rompe, o un patrón deja de matchear, `[]` sigue siendo `[]`.
  // Estos casos prueban el detector contra código que **sí** tiene el defecto.
  describe('la muestra sintética: cada patrón atrapa lo suyo', () => {
    const MUESTRAS = [
      ['la cabecera del portador', `fetch(url, { headers: { Authorization: 'Bearer ' + t } })`],
      ['la cabecera del identificador de sesión', `const h = { 'X-Sesion-Id': idDelDispositivo }`],
      ['Auth0', `import { useAuth0 } from '@auth0/auth0-react'`],
      ['el cliente HTTP de apps/web', `import api from '@/services/api'`],
      ['el token guardado en el navegador', `const t = localStorage.getItem('token')`],
      ['un hexadecimal de color', `const boton = { background: '#00B4B6' }`],
    ]

    it.each(MUESTRAS)('atrapa %s', (que, muestra) => {
      expect(hallazgosEn('inventado.js', muestra).join(' ')).toContain(que)
    })

    it('no denuncia código limpio, ni el número de un pedido, ni la explicación en un comentario', () => {
      const limpio = [
        `// Este archivo no manda Authorization ni X-Sesion-Id: no hay sesión.`,
        `/* El color viene de la base: '#00B4B6' es solo el ejemplo del contrato. */`,
        `const linea = { product_id: 412, cantidad: 2 } // pedido #1042`,
        `const boton = { background: 'var(--marca)', color: 'var(--marca-texto)' }`,
        `const r = await fetch('/api/publico/c/' + slug)`,
      ].join('\n')
      expect(hallazgosEn('inventado.js', limpio)).toEqual([])
    })

    it('el hexadecimal se le perdona a src/tema.js y a nadie más', () => {
      const conColor = `export const MARCA_POR_DEFECTO = '#00B4B6'`
      expect(hallazgosEn('tema.js', conColor)).toEqual([])
      expect(hallazgosEn('pantallas/Catalogo.jsx', conColor)).toHaveLength(1)
    })
  })

  // ── El ancla ──
  it('revisó los archivos que dice revisar', () => {
    expect(REVISADOS.map((r) => r.nombre).sort()).toEqual([
      'App.jsx',
      'api.js',
      'carrito.js',
      'main.jsx',
      'tema.js',
    ])
  })

  it('las dos listas de excepciones son las que dicen ser', () => {
    // Si una excepción crece, crece acá y se ve en el diff. Es la diferencia
    // entre una excepción y un agujero.
    expect(CARPETAS_EXCLUIDAS).toEqual(['tests'])
    expect(PROHIBIDOS.flatMap((p) => p.exentos ?? [])).toEqual(['tema.js'])
  })
})
