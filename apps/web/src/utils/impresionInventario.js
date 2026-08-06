import { calcularPrecios } from '@/utils/precios'
import { esStockBajo } from '@/utils/stockBajo'
// La hoja impresa tiene que decir los mismos importes que la pantalla. Con la
// copia propia eran dos funciones que hoy coincidían y mañana no.
import { pesos } from '@/utils/formato'

// ════════════════════════════════════════════
//  ADMINAPP · La vista de impresión del inventario
//
//  El PDF se resuelve con la vista de impresión del navegador: NO se agrega
//  ninguna biblioteca de PDF al proyecto. «Guardar como PDF» ya está en el
//  diálogo de impresión de todos los navegadores, y una biblioteca de PDF son
//  cientos de kilobytes y un segundo motor de maquetado que hay que mantener.
//
//  ── Por qué este archivo SÍ puede tener hexadecimales ──
//
//  Es el único, y por eso vive en `utils/` y **fuera** de la lista de
//  `src/tests/guardiasDeDiseno.test.js`. Los tokens de `index.css` son colores de
//  **pantalla**: existen para dar contraste sobre un fondo claro o uno oscuro, y
//  se resuelven con variables CSS que la ventana de impresión —que es un
//  documento nuevo, sin la hoja de estilos de la aplicación— no tiene. La hoja
//  imprime sobre papel blanco, que no es ninguno de los dos modos.
//
//  La excepción es esta y está acotada a este archivo. No es aflojar la guardia:
//  la guardia sigue siendo estricta sobre los componentes, que es donde el
//  problema aparece.
//
//  `print-color-adjust: exact` es lo que hace que los colores salgan: sin eso,
//  el navegador imprime los fondos en blanco «para ahorrar tinta» y el listado
//  sale sin ninguna de las marcas que dicen qué falta.
// ════════════════════════════════════════════

/** Escapa lo que va adentro del HTML. Un producto llamado «Pack 2<3» rompe la
 *  página, y uno con `<script>` en el nombre hace algo peor. */
function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const unidades = (n) => Number(n || 0).toLocaleString('es-AR')

/**
 * Los totales del pie.
 *
 * Los mismos tres números que muestra la pantalla, calculados con las mismas
 * funciones: `esStockBajo` es la de `utils/stockBajo.js`. Si la hoja dijera
 * números distintos de los de la pantalla, no habría forma de saber cuál de las
 * dos está bien.
 */
export function totalesDeImpresion(productos = [], { sucursalElegida = null, umbral } = {}) {
  let sinStock = 0
  let stockBajo = 0

  for (const p of productos) {
    const filas = sucursalElegida === null
      ? (p.stock || [])
      : (p.stock || []).filter((s) => String(s.punto_de_venta_id) === String(sucursalElegida))

    const cantidad = filas.reduce((suma, s) => suma + (Number(s.quantity) || 0), 0)

    if (cantidad <= 0) sinStock++

    const enFalta = filas.length === 0
      ? esStockBajo({ quantity: 0, min_stock: 0 }, umbral)
      : filas.some((s) => esStockBajo(s, umbral))

    if (enFalta) stockBajo++
  }

  return { productos: productos.length, sinStock, stockBajo }
}

/**
 * El HTML completo de la hoja.
 *
 * Se devuelve como string —y no se escribe directamente— para poder testearlo:
 * lo único que no se puede verificar sin un navegador es lo que hace `print()`.
 */
export function armarHtml({
  productos = [],
  sucursales = [],
  sucursalElegida = null,
  nombreDeLaSucursal = null,
  settings = {},
  umbral,
  fecha = new Date(),
} = {}) {
  const totales = totalesDeImpresion(productos, { sucursalElegida, umbral })

  const encabezados = [
    'Producto', 'SKU', 'Marca', 'Categoría', 'Costo', 'Precio',
    ...sucursales.map((s) => (s.is_active === false ? `${s.name} (inactiva)` : s.name)),
    'Total',
  ]

  const filas = productos.map((p) => {
    const stock = p.stock || []
    const enAlcance = sucursalElegida === null
      ? stock
      : stock.filter((s) => String(s.punto_de_venta_id) === String(sucursalElegida))

    const total = enAlcance.reduce((suma, s) => suma + (Number(s.quantity) || 0), 0)
    const precios = calcularPrecios(p, settings)

    const celdasDeSucursal = sucursales.map((s) => {
      const fila = stock.find((f) => String(f.punto_de_venta_id) === String(s.id))
      const cantidad = Number(fila?.quantity) || 0
      const clase = cantidad <= 0
        ? 'sin'
        : (esStockBajo(fila || { quantity: cantidad, min_stock: 0 }, umbral) ? 'bajo' : '')

      return `<td class="num ${clase}">${unidades(cantidad)}</td>`
    }).join('')

    return `<tr>
      <td>${escapar(p.name)}</td>
      <td class="num">${escapar(p.sku || '—')}</td>
      <td>${escapar(p.brand?.name || '—')}</td>
      <td>${escapar(p.category || '—')}</td>
      <td class="num">$${pesos(p.cost)}</td>
      <td class="num">${precios.sinCosto ? 'sin costo' : `$${pesos(precios.cashPrice)}`}</td>
      ${celdasDeSucursal}
      <td class="num total">${unidades(total)}</td>
    </tr>`
  }).join('')

  const cuando = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date()

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Inventario</title>
<style>
  /* print-color-adjust: exact es lo que hace que los fondos salgan impresos.
     Sin esto el navegador los blanquea «para ahorrar tinta» y la hoja pierde
     justamente las marcas que dicen qué falta reponer. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #101418; margin: 24px; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #5A646E; font-size: 11px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #5A646E;
       border-bottom: 1px solid #D5DADE; padding: 6px 6px; }
  /* Una fila no se parte entre dos páginas: media fila arriba y media abajo es
     ilegible justo cuando se está contando mercadería. */
  tr { break-inside: avoid; page-break-inside: avoid; }
  td { padding: 5px 6px; border-bottom: 1px solid #E5E8EA; vertical-align: top; }
  .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .total { font-weight: 600; }
  .bajo { background: #FBF0DE; color: #9A5B08; font-weight: 600; }
  .sin { background: #FBEAEA; color: #C42B2B; font-weight: 600; }
  tfoot td { border-top: 2px solid #D5DADE; border-bottom: none; padding-top: 10px; font-size: 11px; }
  .pie { margin-top: 14px; color: #5A646E; font-size: 10px; }
  @page { margin: 14mm; }
</style>
</head>
<body>
  <h1>Inventario</h1>
  <p class="meta">
    ${escapar(nombreDeLaSucursal || 'Todas las sucursales')} ·
    ${escapar(cuando.toLocaleString('es-AR'))} ·
    ${totales.productos} producto${totales.productos === 1 ? '' : 's'}
  </p>

  <table>
    <thead>
      <tr>${encabezados.map((h) => `<th>${escapar(h)}</th>`).join('')}</tr>
    </thead>
    <tbody>${filas}</tbody>
    <tfoot>
      <tr>
        <td colspan="${encabezados.length}">
          <strong>${totales.productos}</strong> producto${totales.productos === 1 ? '' : 's'} ·
          <strong>${totales.sinStock}</strong> sin stock ·
          <strong>${totales.stockBajo}</strong> en stock bajo
        </td>
      </tr>
    </tfoot>
  </table>

  <p class="pie">Generado por AdminApp.</p>
</body>
</html>`
}

/** Abre una ventana con el navegador, o `null` si no hay navegador. */
function abrirConElNavegador() {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null
  return window.open('', '_blank')
}

/**
 * Arma la hoja, la abre en una ventana y manda a imprimir.
 *
 * @param {object} datos Lo que recibe `armarHtml`.
 * @param {Function} [abrirVentana] Cómo se abre la ventana. Existe para poder
 *   testear el caso de la ventana bloqueada sin un navegador.
 * @returns {Window|null} **`null` cuando el navegador bloqueó la ventana
 *   emergente**, para que la pantalla pueda avisar qué hacer.
 *
 *   Que devuelva algo no es un detalle: `utils/printInvoice.js:94` hace
 *   `if (!printWindow) return;`, así que con el bloqueador de emergentes activo
 *   el usuario aprieta «Imprimir» y **no pasa nada** — ni la hoja, ni un error,
 *   ni una explicación. Es lo que FR-135 prohíbe y lo que estaba a punto de
 *   copiarse por inercia.
 */
export function imprimirInventario(datos, abrirVentana = abrirConElNavegador) {
  const ventana = abrirVentana()

  if (!ventana) return null

  ventana.document.write(armarHtml(datos))
  ventana.document.close()
  ventana.focus()
  ventana.print()

  return ventana
}
