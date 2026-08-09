import * as XLSX from 'xlsx'

// ════════════════════════════════════════════
//  FAVALIO · El archivo de ventas
//
//  Arma la hoja del `.xlsx` a partir de las filas que devuelve
//  GET /api/sales/export, que ya vienen con las diez columnas hechas.
//
//  ── Por qué esto no es `XLSX.utils.json_to_sheet` ──
//
//  Es lo que hacen Comparador y Faltantes, y para lo suyo alcanza. Acá no:
//  los dos casos de esta pantalla son justo los que la inferencia de tipos
//  arruina.
//
//   · El CAE tiene 14 dígitos. Inferido como número se escribe `7,54123E+13`
//     y pierde los últimos dígitos. Un CAE incompleto no sirve para nada:
//     es lo que se dicta ante una inspección.
//   · El total llega como STRING, porque el driver de Postgres devuelve así
//     los DECIMAL. Inferido como texto, la columna Total no suma en la
//     planilla.
//
//  Ninguna de las dos cosas rompe nada visible: el archivo abre, se ve bien,
//  y está mal. Por eso los tipos se fuerzan celda por celda y hay un test
//  sobre el objeto de hoja.
// ════════════════════════════════════════════

/**
 * Las diez columnas, en orden.
 *
 * `clave` es la que devuelve la API; `titulo` es lo que ve el contador.
 */
export const COLUMNAS = [
  { clave: 'fecha', titulo: 'Fecha' },
  { clave: 'hora', titulo: 'Hora' },
  { clave: 'tipo', titulo: 'Tipo' },
  { clave: 'comprobante', titulo: 'Comprobante' },
  { clave: 'cae', titulo: 'CAE' },
  { clave: 'cliente', titulo: 'Cliente' },
  { clave: 'sucursal', titulo: 'Sucursal' },
  { clave: 'estado', titulo: 'Estado' },
  { clave: 'medio_de_pago', titulo: 'Medio de pago' },
  { clave: 'total', titulo: 'Total' },
]

/** Anchos aproximados, para que el archivo no abra con todo en «####». */
const ANCHOS = [11, 7, 20, 16, 18, 28, 16, 24, 14, 13]

/**
 * Una celda con su tipo forzado.
 *
 * `t: 's'` es texto y `t: 'n'` es número; `z: '@'` es el formato «Texto» de
 * Excel, que es lo que impide que al abrir el archivo se reinterprete un
 * número largo escrito como texto.
 */
function celda(clave, valor) {
  if (clave === 'total') {
    // Number() sobre el string del DECIMAL. Un total ilegible entra como 0 y
    // no como NaN: una celda con NaN rompe la suma de toda la columna.
    const numero = Number(valor)
    return { t: 'n', v: Number.isFinite(numero) ? numero : 0 }
  }

  if (clave === 'cae') {
    return { t: 's', v: String(valor ?? ''), z: '@' }
  }

  return { t: 's', v: String(valor ?? '') }
}

/**
 * Filas → hoja de cálculo.
 *
 * @param {Array<object>} filas Las de `GET /api/sales/export`.
 * @returns {object} La hoja, lista para `XLSX.utils.book_append_sheet`.
 */
export function armarHoja(filas = []) {
  const hoja = {}

  COLUMNAS.forEach((columna, c) => {
    hoja[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: columna.titulo }
  })

  filas.forEach((fila, i) => {
    COLUMNAS.forEach((columna, c) => {
      hoja[XLSX.utils.encode_cell({ r: i + 1, c })] = celda(columna.clave, fila[columna.clave])
    })
  })

  hoja['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: filas.length, c: COLUMNAS.length - 1 },
  })
  hoja['!cols'] = ANCHOS.map((wch) => ({ wch }))

  return hoja
}

/** Deja un texto usable como nombre de archivo: sin espacios ni acentos. */
function parteDelNombre(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * El nombre del archivo, con período y sucursal.
 *
 * Los dos datos van adentro del nombre para que dos exportaciones con filtros
 * distintos no se pisen en la carpeta de descargas: bajar dos veces
 * «ventas.xlsx» deja una sola, y no se sabe cuál.
 */
export function nombreDelArchivo({ desde, hasta, sucursal } = {}) {
  const periodo = desde && hasta && desde !== hasta
    ? `${desde}_a_${hasta}`
    : (desde || hasta || 'sin-fecha')

  const donde = parteDelNombre(sucursal) || 'todas-las-sucursales'

  return `ventas_${periodo}_${donde}.xlsx`
}

/**
 * Arma el libro y dispara la descarga.
 *
 * La parte impura: todo lo testeable está arriba.
 */
export function descargarVentas(filas, opciones) {
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, armarHoja(filas), 'Ventas')
  XLSX.writeFile(libro, nombreDelArchivo(opciones))
}
