// ════════════════════════════════════════════
//  FAVALIO · Leer una lista de precios pegada como texto
//
//  El caso real: llega una lista por mail o por WhatsApp, se selecciona, se
//  copia y se pega. Sin esto hay que armar un Excel antes, y armar un Excel para
//  actualizar veinte costos es el motivo por el que los costos no se actualizan.
//
//  ── Esto NO es un segundo camino de importación ──
//
//  Devuelve exactamente la misma forma que ya produce el asistente al leer un
//  archivo: **una matriz de celdas y una lista de nombres de columna**. Con eso,
//  los pasos 2 (mapeo) y 3 (resultados) del asistente no se enteran de si el
//  origen fue un archivo o un pegado, y el endpoint no cambia. El sistema viejo
//  tenía `bulkParseTxt` y `parsePaste` en el mismo archivo, con separadores
//  distintos y resultados distintos, y ese es el error que FR-090 viene a
//  evitar.
//
//  ── Lo que NO hace, a propósito ──
//
//  **No deduce el mapeo de la magnitud de los valores.** El sistema viejo
//  decidía que la columna 2 era «stock» si su máximo era ≤ 9999 y «costo» si no
//  (`legacy:4738-4746`). Con una lista de productos baratos —una lista de
//  accesorios, una de suplementos en promoción— leía **los costos como stock** y
//  dejaba todos los costos en cero, sin avisar de nada. La propuesta por defecto
//  es siempre la misma (1 = Nombre, 2 = Costo, 3 = Stock) y el usuario la
//  confirma mirando las filas de ejemplo.
// ════════════════════════════════════════════

/**
 * Más de esto no entra en una pegada.
 *
 * El bucle de importación del servidor corre fila por fila y **sin transacción
 * envolvente**: sin tope, una pegada de diez mil líneas que se corta a la mitad
 * deja el catálogo mitad actualizado y mitad no, y nadie sabe dónde se cortó.
 */
export const TOPE_DE_FILAS = 2000

/**
 * Los separadores de columna que se reconocen.
 *
 * Tabulación es lo que produce copiar de Excel o de Sheets; `;` es lo que
 * produce un CSV europeo; y **dos o más espacios seguidos** es lo que queda
 * cuando la lista viene de un PDF o de un mensaje de texto alineado a mano. Un
 * solo espacio NO separa: partiría «Whey Protein 2 LB» en cuatro columnas.
 */
export const SEPARADOR_DE_COLUMNAS = /\t| {2,}|;/

/**
 * La propuesta de mapeo cuando no hay encabezado.
 *
 * Fija, y no deducida de los datos: ver el comentario del encabezado del
 * archivo. Es lo que el usuario ve preseleccionado y puede cambiar.
 */
export const MAPEO_SIN_ENCABEZADO = { name: 0, cost: 1, quantity: 2 }

/**
 * Cuántas coincidencias de alias hacen que la primera fila sea un encabezado.
 *
 * Dos y no una: con una sola, un producto llamado «Barra de proteína» activaría
 * el alias `barra` de «código de barras» y la primera línea de datos se comería
 * como si fuera el encabezado — o sea, el primer producto de la lista no se
 * importa y nadie lo nota hasta que falta en el listado.
 */
const COINCIDENCIAS_PARA_ENCABEZADO = 2

/** Normaliza un nombre de columna para compararlo con los alias. */
export function normalizarNombreDeColumna(texto) {
  return String(texto ?? '').toLowerCase().trim()
    .replace(/[áäàâã]/g, 'a').replace(/[éëèêẽ]/g, 'e')
    .replace(/[íïìîĩ]/g, 'i').replace(/[óöòôõ]/g, 'o')
    .replace(/[úüùûũ]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9_\s]/g, '').replace(/\s+/g, ' ')
    .trim()
}

/**
 * Los nombres con que un usuario puede haber escrito cada columna.
 *
 * Vivían adentro de `ImportWizard.jsx`. Se mudaron acá para que el pegado y el
 * archivo usen **la misma** tabla: dos tablas de alias empiezan iguales y
 * terminan distintas, y entonces la misma planilla se mapea de una forma si se
 * sube y de otra si se pega.
 */
export const ALIAS_DE_COLUMNA = {
  name: ['nombre', 'producto', 'product', 'item', 'descripcion', 'descripción', 'nombre del producto', 'articulo', 'artículo'],
  sku: ['codigo', 'código', 'code', 'referencia', 'ref', 'sku', 'internal code'],
  barcode: ['codigo_barras', 'código_barras', 'codigo de barras', 'código de barras', 'barcode', 'ean', 'upc', 'barra'],
  description: ['descripcion', 'descripción', 'description', 'detalle', 'notas'],
  cost: ['costo', 'precio_costo', 'precio de costo', 'cost', 'precio compra', 'precio de compra', 'coste'],
  category: ['categoria', 'categoría', 'category', 'tipo', 'rubro'],
  brand_name: ['marca', 'brand', 'brand_name', 'marca nombre'],
  supplier_name: ['proveedor', 'supplier', 'supplier_name', 'proveedor nombre', 'prov'],
  margin_override: ['margen', 'margen_personalizado', 'margin', 'margin_override', '% margen', 'porcentaje'],
  price_override: ['precio_venta', 'precio', 'price', 'price_override', 'precio venta', 'pvp'],
  unit_type: ['unidad', 'unit_type', 'unit', 'tipo unidad', 'medida'],
  unit_size: ['tamaño_envase', 'unit_size', 'tamaño', 'envase', 'tamaño envase', 'capacity'],
  taxed: ['gravado', 'taxed', 'iva', 'impuesto', 'exento'],
  is_active: ['activo', 'is_active', 'active', 'habilitado', 'estado'],
  wholesale_margin: ['margen_mayorista', 'wholesale_margin', '% mayorista', 'margen mayorista'],
  wholesale_price: ['precio_mayorista', 'wholesale_price', 'precio mayorista', 'mayorista'],
  quantity: ['stock', 'cantidad', 'quantity', 'inventario', 'existencia', 'qty'],
  location: ['sucursal', 'location', 'localidad', 'deposito', 'depósito', 'almacen', 'almacén'],
  min_stock: ['stock_minimo', 'min_stock', 'stock mínimo', 'stock minimo'],
  current_batch: ['lote', 'batch', 'current_batch', 'lote numero', 'nro lote'],
  expiration_date: ['vencimiento', 'expiration_date', 'expiry', 'fecha vencimiento', 'vence', 'caducidad'],
  purchase_date: ['fecha_compra', 'purchase_date', 'fecha compra', 'fecha de compra'],
}

/**
 * Qué columna del archivo corresponde a cada campo del sistema.
 *
 * Primero por coincidencia exacta con algún alias; después, si ninguna dio, por
 * coincidencia parcial. `-1` significa «esta columna no está en el archivo».
 *
 * Es la misma función que usaba `ImportWizard.jsx` para los archivos.
 */
export function detectarColumnas(encabezados, alias = ALIAS_DE_COLUMNA) {
  const normalizados = encabezados.map((h, i) => ({
    indice: i,
    normalizado: normalizarNombreDeColumna(h),
  }))

  const resultado = {}

  for (const [campo, lista] of Object.entries(alias)) {
    const todos = [campo, ...lista].map(normalizarNombreDeColumna)
    let mejor = null

    for (const h of normalizados) {
      if (!h.normalizado) continue
      if (todos.includes(h.normalizado)) { mejor = h; break }
    }

    if (!mejor) {
      for (const h of normalizados) {
        if (!h.normalizado) continue
        if (todos.some((a) => h.normalizado.includes(a) || a.includes(h.normalizado))) {
          mejor = h
          break
        }
      }
    }

    resultado[campo] = mejor ? mejor.indice : -1
  }

  return resultado
}

/** Cuántos campos del sistema resolvió una detección. */
function cuantosResolvio(mapeo) {
  return Object.values(mapeo).filter((i) => i >= 0).length
}

/** Parte una línea en celdas. El separador se decide POR LÍNEA. */
export function separarColumnas(linea) {
  return String(linea).split(SEPARADOR_DE_COLUMNAS).map((c) => c.trim())
}

/**
 * Lee el texto pegado.
 *
 * @param {string} texto Lo que el usuario pegó, tal cual.
 * @returns {{
 *   ok: boolean,
 *   error: string|null,
 *   encabezadoDetectado: boolean,
 *   columnas: string[],
 *   filas: string[][],
 *   lineas: number[],
 *   mapeo: Record<string, number>,
 *   total: number,
 * }}
 *   `lineas[i]` es **el número de línea del texto original** de la fila `i` de
 *   la matriz, contando desde 1. Sin esa correspondencia, «error en la línea
 *   14» apunta a otra línea en cuanto el usuario pegó una línea en blanco en el
 *   medio — y el usuario corrige una fila que estaba bien.
 */
export function parsearPegado(texto) {
  const vacio = {
    ok: false,
    error: null,
    encabezadoDetectado: false,
    columnas: [],
    filas: [],
    lineas: [],
    mapeo: {},
    total: 0,
  }

  if (!texto || !String(texto).trim()) {
    return { ...vacio, error: 'No hay nada pegado.' }
  }

  // Las líneas en blanco se descartan pero se sigue contando por el texto
  // original: la línea 14 del error tiene que ser la 14 que ve el usuario.
  const conNumero = String(texto)
    .split(/\r\n|\r|\n/)
    .map((contenido, i) => ({ contenido, linea: i + 1 }))
    .filter(({ contenido }) => contenido.trim() !== '')

  if (conNumero.length === 0) {
    return { ...vacio, error: 'No hay nada pegado.' }
  }

  const primera = separarColumnas(conNumero[0].contenido)
  const deteccion = detectarColumnas(primera)
  const encabezadoDetectado = cuantosResolvio(deteccion) >= COINCIDENCIAS_PARA_ENCABEZADO

  const datos = encabezadoDetectado ? conNumero.slice(1) : conNumero

  // El tope se aplica ANTES de armar la matriz: con cincuenta mil líneas, armar
  // la matriz para después descartarla es congelar la pestaña para nada.
  if (datos.length > TOPE_DE_FILAS) {
    return {
      ...vacio,
      encabezadoDetectado,
      error: `Pegaste ${datos.length} filas y el máximo es ${TOPE_DE_FILAS}. `
        + 'Partila en dos o más pegadas: la importación corre fila por fila, y '
        + 'una tanda que se corta a la mitad deja el catálogo mitad actualizado '
        + 'sin que se sepa dónde se cortó.',
    }
  }

  if (datos.length === 0) {
    return {
      ...vacio,
      encabezadoDetectado,
      error: 'Pegaste solo el encabezado: no hay ninguna fila de datos.',
    }
  }

  const filas = datos.map(({ contenido }) => separarColumnas(contenido))
  const lineas = datos.map(({ linea }) => linea)

  // Las filas desparejas se completan con celdas vacías. Sin esto, una fila a la
  // que le falta la última columna hace que `fila[2]` sea `undefined` y el CSV
  // salga con una columna de menos justo en esa línea.
  const anchoDelEncabezado = encabezadoDetectado ? primera.length : 0
  const ancho = Math.max(anchoDelEncabezado, ...filas.map((f) => f.length))

  for (const fila of filas) {
    while (fila.length < ancho) fila.push('')
  }

  const columnas = encabezadoDetectado
    ? Array.from({ length: ancho }, (_, i) => primera[i] || `Columna ${i + 1}`)
    : Array.from({ length: ancho }, (_, i) => `Columna ${i + 1}`)

  // Sin encabezado, la propuesta es fija: 1 = Nombre, 2 = Costo, 3 = Stock, y
  // todo lo demás sin mapear. Las columnas que no existen quedan en -1.
  const mapeo = encabezadoDetectado
    ? deteccion
    : Object.fromEntries(Object.keys(ALIAS_DE_COLUMNA).map((campo) => [
      campo,
      MAPEO_SIN_ENCABEZADO[campo] !== undefined && MAPEO_SIN_ENCABEZADO[campo] < ancho
        ? MAPEO_SIN_ENCABEZADO[campo]
        : -1,
    ]))

  return {
    ok: true,
    error: null,
    encabezadoDetectado,
    columnas,
    filas,
    lineas,
    mapeo,
    total: filas.length,
  }
}

/**
 * La matriz como CSV, para subirla por el mismo endpoint que un archivo.
 *
 * Comillas dobles siempre y duplicando las internas: un nombre de producto con
 * una coma —«Whey, chocolate»— partiría la fila en dos columnas, y el servidor
 * leería el costo donde espera el nombre.
 *
 * Los valores van **tal cual se pegaron**: el servidor es el que interpreta los
 * importes (`apps/api/src/utils/importes.js`). Convertirlos acá agregaría una
 * segunda lectura del mismo formato, que es exactamente lo que se está evitando.
 */
export function comoCsv(columnas, filas) {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

  return [columnas, ...filas]
    .map((fila) => fila.map(celda).join(','))
    .join('\n')
}
