import * as XLSX from 'xlsx'
import { calcularPrecios } from '@/utils/precios'

// ════════════════════════════════════════════
//  ADMINAPP · El archivo de inventario
//
//  Mismo molde que `utils/exportarVentas.js`: `COLUMNAS`, `celda()` con los
//  tipos forzados, `armarHoja` y `nombreDelArchivo`. Lo que cambia es que acá
//  **las columnas dependen de los datos** —una por sucursal—, así que `COLUMNAS`
//  es una función.
//
//  ── Por qué esto no es `XLSX.utils.json_to_sheet` ──
//
//  Es lo que hacen `Comparador.jsx:114` y `Faltantes.jsx:137`, y para lo suyo
//  alcanza. Acá no, porque los dos casos que la inferencia arruina son justo los
//  de esta pantalla:
//
//   · **El SKU.** Un SKU como `0012345` inferido como número pierde los ceros de
//     adelante, y uno largo se escribe en notación científica. Un SKU que no
//     coincide con el del proveedor no sirve para nada.
//   · **Los importes.** El costo llega como STRING —el driver de Postgres
//     devuelve así los DECIMAL—. Inferido como texto, la columna Costo **no
//     suma** en la planilla, y sumarla es exactamente para lo que se exporta.
//
//  Ninguna de las dos rompe nada visible: el archivo abre, se ve bien, y está
//  mal. Por eso los tipos se fuerzan celda por celda y hay un test sobre el
//  objeto de hoja.
// ════════════════════════════════════════════

/** Los tipos de celda que se usan. Cada uno decide `t` y `z`. */
const TIPO = {
  TEXTO: 'texto',
  /** Texto que Excel intentaría leer como número: SKU, códigos. */
  CODIGO: 'codigo',
  NUMERO: 'numero',
  /** Número que puede faltar. Vacío **no es cero**. */
  IMPORTE_OPCIONAL: 'importe_opcional',
}

/**
 * Las columnas del archivo, en orden.
 *
 * Las de sucursal van en el medio, entre el precio y los totales, que es donde
 * están en la pantalla: un archivo con las columnas en otro orden que la tabla
 * obliga a buscarlas cada vez.
 *
 * @param {Array<{id: number|string, name: string, is_active?: boolean}>} sucursales
 */
export function COLUMNAS(sucursales = []) {
  return [
    { clave: 'producto', titulo: 'Producto', tipo: TIPO.TEXTO, ancho: 34 },
    { clave: 'sku', titulo: 'SKU', tipo: TIPO.CODIGO, ancho: 16 },
    { clave: 'marca', titulo: 'Marca', tipo: TIPO.TEXTO, ancho: 18 },
    { clave: 'categoria', titulo: 'Categoría', tipo: TIPO.TEXTO, ancho: 16 },
    { clave: 'costo', titulo: 'Costo', tipo: TIPO.NUMERO, ancho: 13 },
    // El precio es opcional a propósito: un producto sin costo NO tiene precio,
    // y escribir 0 dice que sale gratis.
    { clave: 'precio', titulo: 'Precio', tipo: TIPO.IMPORTE_OPCIONAL, ancho: 13 },
    ...sucursales.map((s) => ({
      clave: `sucursal_${s.id}`,
      titulo: s.is_active === false ? `${s.name} (inactiva)` : s.name,
      tipo: TIPO.NUMERO,
      ancho: 14,
    })),
    { clave: 'total', titulo: 'Stock total', tipo: TIPO.NUMERO, ancho: 13 },
    { clave: 'valorizado', titulo: 'Valorizado', tipo: TIPO.NUMERO, ancho: 15 },
  ]
}

/**
 * Una celda con su tipo forzado.
 *
 * `t: 's'` es texto y `t: 'n'` es número; `z: '@'` es el formato «Texto» de
 * Excel, que es lo que impide que al abrir el archivo se reinterprete un número
 * largo escrito como texto.
 */
export function celda(tipo, valor) {
  if (tipo === TIPO.CODIGO) {
    return { t: 's', v: String(valor ?? ''), z: '@' }
  }

  if (tipo === TIPO.NUMERO) {
    const numero = Number(valor)
    // Un valor ilegible entra como 0 y no como NaN: una celda con NaN rompe la
    // suma de toda la columna.
    return { t: 'n', v: Number.isFinite(numero) ? numero : 0 }
  }

  if (tipo === TIPO.IMPORTE_OPCIONAL) {
    const numero = Number(valor)

    // Vacía, no en cero. Cero es un precio —y uno que dice que el producto sale
    // gratis—; vacío es «no hay». La diferencia importa justo en los productos
    // que hay que arreglar.
    if (valor === null || valor === undefined || valor === '' || !Number.isFinite(numero)) {
      return { t: 's', v: '' }
    }

    return { t: 'n', v: numero }
  }

  return { t: 's', v: String(valor ?? '') }
}

/**
 * Las filas del archivo a partir de los productos de la pantalla.
 *
 * @param {Array} productos El resultado filtrado, no el catálogo entero.
 * @param {object} opciones
 * @param {Array} opciones.sucursales Las que van como columna.
 * @param {object} opciones.settings Para `calcularPrecios`.
 * @param {string|number|null} opciones.sucursalElegida El filtro de la pantalla,
 *   o `null` para «todas». **Decide sobre qué filas se suman `total` y
 *   `valorizado`**, y por eso la suma del archivo coincide con el indicador
 *   «Valor del stock»: los dos miran el mismo conjunto.
 */
export function armarFilas(productos = [], { sucursales = [], settings = {}, sucursalElegida = null } = {}) {
  return productos.map((p) => {
    const filas = p.stock || []
    const enAlcance = sucursalElegida === null
      ? filas
      : filas.filter((s) => String(s.punto_de_venta_id) === String(sucursalElegida))

    const costo = Number(p.cost) || 0
    const total = enAlcance.reduce((suma, s) => suma + (Number(s.quantity) || 0), 0)
    const precios = calcularPrecios(p, settings)

    const porSucursal = {}
    for (const s of sucursales) {
      const fila = filas.find((f) => String(f.punto_de_venta_id) === String(s.id))
      // Sin fila de stock va 0 y no vacío: en el archivo, una celda vacía en una
      // columna de cantidades se lee como un dato que falta.
      porSucursal[`sucursal_${s.id}`] = Number(fila?.quantity) || 0
    }

    return {
      producto: p.name || '',
      sku: p.sku || '',
      marca: p.brand?.name || '',
      categoria: p.category || '',
      costo,
      // `sinCosto` es la bandera de `calcularPrecios`: sin costo y sin precio
      // manual no hay precio que exportar.
      precio: precios.sinCosto ? null : precios.cashPrice,
      ...porSucursal,
      total,
      valorizado: total * costo,
    }
  })
}

/**
 * Filas → hoja de cálculo.
 *
 * @param {Array<object>} filas Las de `armarFilas`.
 * @param {Array} sucursales Las mismas con las que se armaron las filas.
 */
export function armarHoja(filas = [], sucursales = []) {
  const columnas = COLUMNAS(sucursales)
  const hoja = {}

  columnas.forEach((columna, c) => {
    hoja[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: columna.titulo }
  })

  filas.forEach((fila, i) => {
    columnas.forEach((columna, c) => {
      hoja[XLSX.utils.encode_cell({ r: i + 1, c })] = celda(columna.tipo, fila[columna.clave])
    })
  })

  hoja['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: filas.length, c: columnas.length - 1 },
  })
  hoja['!cols'] = columnas.map((columna) => ({ wch: columna.ancho }))

  return hoja
}

/** Deja un texto usable como nombre de archivo: sin espacios ni acentos. */
function parteDelNombre(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * El nombre del archivo, con fecha y sucursal.
 *
 * Los dos datos van adentro del nombre para que dos exportaciones con filtros
 * distintos no se pisen en la carpeta de descargas: bajar dos veces
 * «inventario.xlsx» deja una sola, y no se sabe cuál.
 *
 * La fecha se arma con los métodos LOCALES del `Date` y no con `toISOString()`:
 * ese devuelve UTC, y en Argentina después de las 21:00 el archivo saldría con
 * la fecha de mañana.
 */
export function nombreDelArchivo({ sucursal, fecha = new Date() } = {}) {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date()
  const dia = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')

  const donde = parteDelNombre(sucursal) || 'todas-las-sucursales'

  return `inventario_${dia}_${donde}.xlsx`
}

/**
 * Arma el libro y dispara la descarga.
 *
 * La parte impura: todo lo testeable está arriba.
 */
export function descargarInventario(productos, opciones = {}) {
  const { sucursales = [], settings = {}, sucursalElegida = null, nombreDeLaSucursal = null } = opciones

  const filas = armarFilas(productos, { sucursales, settings, sucursalElegida })

  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, armarHoja(filas, sucursales), 'Inventario')
  XLSX.writeFile(libro, nombreDelArchivo({ sucursal: nombreDeLaSucursal }))
}
