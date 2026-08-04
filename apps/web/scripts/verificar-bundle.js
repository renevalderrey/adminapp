#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  El bundle de producción no puede tener el bypass de sesión
 *
 *  Corre DESPUÉS de `npm run build` —en el CI es el paso que sigue— y lee todos
 *  los archivos de `dist/` buscando las marcas del bypass de las pruebas de
 *  navegador.
 *
 *  Por qué existe además de la guardia de `src/tests/`: la guardia de vitest
 *  corre sin `dist/` en un clon recién bajado, así que su brazo dinámico se
 *  saltea. Este script no tiene esa duda — si no hay `dist/`, falla y dice que
 *  hay que buildear.
 *
 *  Y por qué existe además del gate de `vite.config.js`: el gate es una función
 *  que alguien puede editar. Esto mira el producto terminado, que es lo que se
 *  le sirve al navegador de un cliente.
 * ════════════════════════════════════════════
 */

// `apps/web` es `"type": "module"`, así que esto va con imports y no con
// `require`. En CommonJS el script se cae al arrancar, y una guardia que se cae
// al arrancar falla siempre — que se ve igual que funcionar y no es lo mismo.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(AQUI, '..', 'dist')

/**
 * Lo que no puede aparecer en un archivo servido.
 *
 * La primera es la marca explícita que exporta
 * `pruebas-de-navegador/ProveedorDeSesionDePrueba.jsx`. Las otras dos son la
 * red por si alguien borra la marca: el nombre del componente y el token falso
 * que devuelve.
 */
const PROHIBIDO = [
  'BYPASS_DE_SESION_SOLO_PARA_PRUEBAS_DE_NAVEGADOR',
  'ProveedorDeSesionDePrueba',
  'token-de-prueba-sin-firma',
]

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? archivos(path.join(dir, e.name)) : [path.join(dir, e.name)]
  ))
}

if (!fs.existsSync(DIST)) {
  console.error('[bundle] No hay dist/. Corré `npm run build` antes de verificar.')
  process.exit(1)
}

const servidos = archivos(DIST)
const hallazgos = []

for (const archivo of servidos) {
  const contenido = fs.readFileSync(archivo)
  for (const marca of PROHIBIDO) {
    if (contenido.includes(marca)) {
      hallazgos.push(`${path.relative(DIST, archivo)} contiene «${marca}»`)
    }
  }
}

if (hallazgos.length > 0) {
  console.error('')
  console.error('[bundle] EL BYPASS DE SESIÓN LLEGÓ AL BUNDLE DE PRODUCCIÓN.')
  console.error('')
  for (const h of hallazgos) console.error(`  · ${h}`)
  console.error('')
  console.error('Un bundle se le sirve a cualquiera que pida la página: un bypass compilado ahí')
  console.error('adentro es una puerta con el picaporte del lado de afuera. El alias de')
  console.error('vite.config.js tiene que seguir exigiendo `command === "serve"`.')
  console.error('')
  process.exit(1)
}

console.log(`[bundle] ${servidos.length} archivos de dist/ revisados. Ninguno tiene el bypass de sesión.`)
