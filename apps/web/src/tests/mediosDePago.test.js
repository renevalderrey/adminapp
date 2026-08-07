import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ETIQUETAS } from '@/utils/mediosDePago'

// ════════════════════════════════════════════
//  El contrato de los medios de pago entre el navegador y la API
//
//  La lista de medios estaba escrita TRES veces —`Billing.jsx`,
//  `components/PanelVenta.jsx` y `apps/api/src/utils/exportVentas.js`— y las
//  tres ya se habían separado sin que nadie lo notara: el punto de venta
//  escribía `tc3`, un código que no existía en ninguna de las otras dos. El
//  historial lo mostraba crudo, el archivo exportado lo escribía crudo y el
//  panel de control lo imprimía tal cual, porque una etiqueta que falta no hace
//  fallar nada.
//
//  Del lado del navegador ahora hay una sola fuente
//  (`utils/mediosDePago.js`). La API conserva la suya —son dos paquetes y el
//  monorepo todavía no tiene uno compartido; agregarlo obliga a tocar los dos
//  `package.json`, el build de Vite, el de Node y la resolución entre CommonJS
//  y ESM para compartir un objeto de once entradas—.
//
//  Este test es el que las ata. Lee el archivo de la API **como texto**, igual
//  que hacen las guardias estáticas. Es grosero y es exactamente lo que hace
//  falta: si no existiera, `tc3` no lo habría visto nadie, que es lo que pasó.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

/** El archivo de la API, leído como texto desde el otro paquete del monorepo. */
const EXPORT_VENTAS = fs.readFileSync(
  path.join(AQUI, '../../../api/src/utils/exportVentas.js'),
  'utf8'
)

/**
 * Las claves del literal `ETIQUETAS_DE_PAGO` de la API.
 *
 * Se recorta el bloque entre la apertura y el primer `};` para no barrer las
 * claves de `ETIQUETAS_DE_TIPO`, que está tres líneas más abajo y también son
 * pares `clave: 'valor'`.
 */
function clavesDeLaApi() {
  const desde = EXPORT_VENTAS.indexOf('const ETIQUETAS_DE_PAGO = {')
  expect(desde).toBeGreaterThan(-1)

  const hasta = EXPORT_VENTAS.indexOf('};', desde)
  expect(hasta).toBeGreaterThan(desde)

  const bloque = EXPORT_VENTAS.slice(desde, hasta)

  return [...bloque.matchAll(/^\s{2}([A-Za-z_][\w]*):/gm)].map((m) => m[1])
}

describe('Los medios de pago del navegador y los de la API no se separaron', () => {
  it('la lista del navegador y la de la API no se separaron', () => {
    // La igualdad se afirma en LOS DOS SENTIDOS: una clave de más en la web es
    // un medio que el historial no sabe leer, y una de más en la API es un
    // medio que el punto de venta no puede elegir.
    const api = clavesDeLaApi().sort()
    const navegador = Object.keys(ETIQUETAS).sort()

    expect(navegador).toEqual(api)
  })

  it('las dos listas incluyen tc3, el código que el POS escribió mal', () => {
    // Es el caso concreto que motivó este archivo. Sin él, `tc3` se sigue
    // exportando crudo.
    expect(clavesDeLaApi()).toContain('tc3')
    expect(Object.keys(ETIQUETAS)).toContain('tc3')
  })

  it('la lectura del archivo de la API encontró algo: no pasa por leer vacío', () => {
    // Una guardia que lee un archivo con una ruta equivocada compara dos listas
    // vacías y pasa siempre. Si el archivo se mueve, esto falla acá.
    expect(clavesDeLaApi().length).toBeGreaterThanOrEqual(11)
  })
})

// ════════════════════════════════════════════
//  Las copias de la lista no vuelven
//
//  Sin estas dos guardias, la copia vuelve la próxima vez que alguien necesite
//  una etiqueta y no quiera importar nada — que es exactamente cómo llegaron a
//  ser tres.
// ════════════════════════════════════════════

const leer = (relativa) => fs.readFileSync(path.join(SRC, relativa), 'utf8')

describe('Ningún componente tiene su propia copia de las etiquetas', () => {
  it('PanelVenta NO tiene su propia copia de las etiquetas', () => {
    const contenido = leer('components/PanelVenta.jsx')

    expect(contenido).not.toMatch(/ETIQUETAS_DE_PAGO\s*=\s*\{/)
    // Y usa la compartida: sin esto, borrar la copia y dejar el campo vacío
    // también pasaría.
    expect(contenido).toMatch(/etiquetaDePago/)
  })

  it('el panel NO le muestra al usuario el código crudo del medio de pago', () => {
    // `Dashboard.jsx` imprimía la clave que devuelve `_salesByMethod` tal cual,
    // pasada por un `.replace(/_/g, ' ')` que no convierte nada: con nueve
    // medios, el dueño ve «tc3n» en el panel que mira todos los días.
    const contenido = leer('pages/Dashboard.jsx')

    // Lo que se busca es la clave DIBUJADA —`>{…medio…}`—, no el `key={medio}`
    // de la fila, que es correcto y no se ve. Anclar al patrón real y no al
    // nombre suelto es lo que hace que la guardia siga sirviendo: un token que
    // aparece también en el comentario que explica el defecto pasa con y sin el
    // cambio.
    //
    // ⚠ **Los DOS nombres, y no es simetría decorativa.** La variable se llamaba
    // `method` y la reescritura del Panel la pasó a `medio`, siguiendo la
    // convención del repositorio de escribir en castellano. Con el patrón atado
    // solo a `method`, esta guardia dejó de encontrar líneas: no falló, no
    // avisó, simplemente **dejó de revisar**. Lo agarró el `toBeGreaterThan(0)`
    // de abajo, que es justo para eso.
    //
    // Por eso van los dos: la próxima traducción de un identificador no puede
    // apagar una guardia en silencio.
    const lineasQueImprimenElMetodo = contenido
      .split('\n')
      .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
      .filter(({ texto }) => />\s*\{[^}]*\b(method|medio)\b/.test(texto) && !texto.startsWith('//') && !texto.startsWith('*'))

    // El ancla. Sin esto, la guardia pasa en verde el día que el patrón deja de
    // existir —por un refactor, por un renombre, o porque el bloque se borró— y
    // nadie se entera de que dejó de proteger nada.
    expect(lineasQueImprimenElMetodo.length).toBeGreaterThan(0)

    const sinEtiqueta = lineasQueImprimenElMetodo
      .filter(({ texto }) => !texto.includes('etiquetaDePago'))
      .map(({ n, texto }) => `L${n}: ${texto}`)

    expect(sinEtiqueta).toEqual([])
  })
})
