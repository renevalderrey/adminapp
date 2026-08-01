import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ════════════════════════════════════════════
//  Guardia · La pantalla del historial no puede desincronizarse de sí misma
//
//  El bug que cubre: cambiar la sucursal en el encabezado NO volvía a
//  consultar. `fetchSales` dependía solo de `consulta`, y la sucursal del
//  encabezado no viaja en `consulta` —viaja como cabecera
//  `X-Punto-De-Venta-Id` que pone el interceptor de axios—. Con lo cual el
//  `<select>` de la pantalla ya mostraba la sucursal nueva y «Exportar» ya
//  mandaba la cabecera nueva, mientras la tabla y el total de arriba seguían
//  mostrando la anterior. Tres cosas que se leen juntas hablando de sucursales
//  distintas, sin que ninguna lo dijera.
//
//  ── Qué NO cubre esta guardia ──
//
//  Lee el archivo como TEXTO, igual que `guardiasDeDiseno.test.js` y que las
//  guardias de la API. Fija que la dependencia esté; no ejercita el
//  componente. Todo lo que dependa de RENDERIZAR la pantalla —que la tabla
//  muestre la columna que corresponde, que el badge diga lo mismo que el
//  archivo, que el botón se deshabilite— sigue sin cobertura: no hay
//  infraestructura de tests de render en `apps/web` (ni jsdom ni
//  testing-library), y montarla es un proyecto aparte.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const FUENTE = fs.readFileSync(path.join(SRC, 'pages/InvoicesList.jsx'), 'utf8')

/** El texto entre dos marcas del archivo. */
function entre(inicio, fin) {
  const i = FUENTE.indexOf(inicio)
  const j = FUENTE.indexOf(fin, i)

  expect(i).toBeGreaterThanOrEqual(0)
  expect(j).toBeGreaterThan(i)

  return FUENTE.slice(i, j)
}

/** Las dependencias con las que se rearma `fetchSales`. */
function dependenciasDeFetchSales() {
  const bloque = entre('const fetchSales = useCallback(', 'useEffect(() => { fetchSales() }')
  const cierre = bloque.match(/\},\s*\[([^\]]*)\]\)\s*$/m)

  expect(cierre).not.toBeNull()

  return cierre[1].split(',').map((d) => d.trim()).filter(Boolean)
}

describe('Cambiar la sucursal del encabezado vuelve a consultar el listado', () => {
  // Sin esta dependencia, la tabla y el total del período se quedan en la
  // sucursal anterior mientras el filtro de la pantalla y el `.xlsx` ya
  // hablan de la nueva.
  it('`fetchSales` se rearma cuando cambia la sucursal del encabezado', () => {
    expect(dependenciasDeFetchSales()).toContain('sucursalDeLaCabecera')
  })

  it('`fetchSales` sigue rearmándose cuando cambia la consulta', () => {
    expect(dependenciasDeFetchSales()).toContain('consulta')
  })

  it('el efecto que consulta depende de `fetchSales` y de nada más', () => {
    expect(FUENTE).toMatch(/useEffect\(\(\) => \{ fetchSales\(\) \}, \[fetchSales\]\)/)
  })
})

describe('El filtro de la pantalla manda sobre el encabezado (FR-072)', () => {
  const derivacion = () => entre('const sucursalDeLaCabecera', 'const fetchSales = useCallback(')

  // Si la cabecera siguiera contando después de que el usuario eligió una
  // sucursal en el filtro, cambiar el encabezado dispararía una consulta que
  // devuelve exactamente lo mismo: la API ignora la cabecera cuando el
  // parámetro viene en la query.
  it('la sucursal del encabezado solo cuenta si el filtro no eligió ninguna', () => {
    expect(derivacion()).toMatch(/consulta\.punto_de_venta_id === undefined/)
  })

  it('sale del punto de venta activo del encabezado', () => {
    expect(derivacion()).toMatch(/puntoDeVentaActivo\?\.id/)
  })

  // `null` y no el id: con el filtro puesto, el valor tiene que ser constante
  // para que cambiar el encabezado no rearme nada.
  it('con una sucursal elegida en el filtro, vale null', () => {
    expect(derivacion()).toMatch(/:\s*null/)
  })
})
