import * as XLSX from 'xlsx'

// ════════════════════════════════════════════
//  ADMINAPP · El archivo de la cuenta corriente de un proveedor
//
//  Arma la hoja del `.xlsx` a partir de las filas que devuelve
//  GET /api/suppliers/:id/movimientos/export, que ya vienen con las seis
//  columnas hechas y en orden ascendente —del movimiento más viejo al más
//  nuevo, al revés que la pantalla y a propósito: un saldo acumulado que crece
//  hacia abajo es como se lee una cuenta en una planilla—.
//
//  ── Lo que se copia de `exportarVentas.js` es el CORTE, no las columnas ──
//
//  El corte es: **el servidor arma las filas y el navegador arma la hoja**
//  (FR-097). Las columnas no se copian, porque las de una cuenta corriente no
//  son las de una venta: acá son las seis que decidió la spec —fecha, tipo,
//  descripción, debe, haber y saldo—. **No es un asiento contable formal**:
//  eso necesita un plan de cuentas que AdminApp no tiene, y está escrito así
//  para que nadie lo descubra en la reunión con el contador.
//
//  ── Por qué esto no es `XLSX.utils.json_to_sheet` ──
//
//  Es lo que hacen Comparador y Faltantes, y para lo suyo alcanza. Acá no: los
//  dos casos de esta hoja son justo los que la inferencia de tipos arruina, y
//  son los mismos dos que ya habían mordido en el historial de ventas.
//
//   · Los importes llegan como número desde la API, pero si alguien los
//     escribiera formateados —«1.234,50»— Excel los toma como texto en un
//     idioma y como 1234,5 en otro, y la columna **no suma**. Es la trampa de
//     los importes argentinos vista desde el lado de la escritura. La versión
//     de lectura de ese mismo problema es `utils/importes.js`, y acá no se usa.
//   · El CUIT tiene once dígitos. Inferido como número se escribe `3,01235E+10`
//     y pierde los últimos, igual que pasaba con el CAE de 14 dígitos
//     (`exportarVentas.js:63-65`). Un CUIT incompleto no identifica a nadie.
//
//  Ninguna de las dos cosas rompe nada visible: el archivo abre, se ve bien, y
//  está mal. Por eso los tipos se fuerzan celda por celda y hay un test sobre
//  el objeto de hoja.
//
//  Lo que este archivo NO puede garantizar es que la columna **sume** al
//  abrirla en una planilla de verdad. Eso es el paso manual P7 de las tareas y
//  es lo único de la exportación que no baja a un test.
//
//  ── Dónde queda cada cosa en la hoja ──
//
//  Fila 1  CUIT del proveedor
//  Fila 2  el encabezado de la tabla — **siempre acá**, con o sin saldo anterior
//  Fila 3  «Saldo anterior», SOLO si el período arranca con uno
//  Fila 3 o 4  el primer movimiento, según si hubo saldo anterior
//
//  La fila de apertura va **debajo** del encabezado y no arriba, y eso es una
//  decisión, no una casualidad. Arriba correría el encabezado una fila según el
//  contenido —el mismo archivo tendría la tabla en dos lugares distintos según
//  si se pidió un rango o no— y dejaría el importe de apertura **afuera** de la
//  columna Saldo: seleccionar la columna en la planilla no lo agarraría, que es
//  justo lo contrario de lo que la fila viene a hacer.
// ════════════════════════════════════════════

/**
 * Las seis columnas de la cuenta corriente, en orden.
 *
 * `clave` es la que devuelve la API; `titulo` es lo que ve el contador.
 */
export const COLUMNAS = [
  { clave: 'fecha', titulo: 'Fecha' },
  { clave: 'tipo', titulo: 'Tipo' },
  { clave: 'descripcion', titulo: 'Descripción' },
  { clave: 'debe', titulo: 'Debe' },
  { clave: 'haber', titulo: 'Haber' },
  { clave: 'saldo', titulo: 'Saldo' },
]

/**
 * Las tres columnas de plata.
 *
 * Están acá y no en cada `if` para que agregar una cuarta —retenciones, notas
 * de crédito— sea una línea y no un lugar más donde olvidarse el `{ t: 'n' }`.
 */
const IMPORTES = ['debe', 'haber', 'saldo']

/** Anchos aproximados, para que el archivo no abra con todo en «####». */
const ANCHOS = [11, 22, 42, 14, 14, 14]

/**
 * En qué fila (base 0) va el encabezado de la tabla.
 *
 * La 0 la ocupa el CUIT del proveedor: la API lo manda en **cada** fila
 * (FR-099) porque `armarHoja` recibe solo las filas y no sabe a quién
 * pertenecen, pero repetirlo veintitrés veces en una columna propia haría
 * **siete** columnas donde la spec decidió seis. Va una vez, arriba, y la tabla
 * empieza abajo.
 */
const FILA_DEL_ENCABEZADO = 1

/**
 * Lo que dice la fila de apertura cuando el período no empieza en cero.
 *
 * Va en la columna **Descripción** y no en Tipo: no es un movimiento de la
 * cuenta —no tiene fecha, ni debe, ni haber— sino la explicación del número con
 * el que abre la columna Saldo.
 */
const SALDO_ANTERIOR = 'Saldo anterior'

/**
 * Una celda con su tipo forzado.
 *
 * `t: 's'` es texto y `t: 'n'` es número; `z: '@'` es el formato «Texto» de
 * Excel, que es lo que impide que al abrir el archivo se reinterprete un número
 * largo escrito como texto.
 */
function celda(clave, valor) {
  if (IMPORTES.includes(clave)) {
    // La API ya los manda como número, pero un `Number()` de más cuesta nada y
    // cubre el día en que alguien devuelva el DECIMAL como string, que es
    // exactamente lo que hace el driver de Postgres en el resto del sistema.
    // Un importe ilegible entra como 0 y no como NaN: una celda con NaN rompe
    // la suma de toda la columna.
    const numero = Number(valor)
    return { t: 'n', v: Number.isFinite(numero) ? numero : 0 }
  }

  if (clave === 'cuit') {
    return { t: 's', v: String(valor ?? ''), z: '@' }
  }

  return { t: 's', v: String(valor ?? '') }
}

/**
 * Filas → hoja de cálculo.
 *
 * ⚠ **`saldoInicial` no es un adorno.** Con `?desde=`, el archivo arrancaba la
 * cuenta en cero y cerraba en el NETO DEL PERÍODO: $22.000 sobre una cuenta que
 * debía $122.000, mientras la pantalla mostraba el saldo entero. La API ya
 * devuelve el `saldo_inicial` del período (`suppliers.js:651`), pero mientras
 * `armarHoja` recibiera solo las filas, la planilla seguía **abriendo en un
 * número que sus propias columnas no explican**: la primera fila mostraba un
 * saldo acumulado que no se deduce de su debe ni de su haber, y el contador no
 * tenía de dónde sacar por qué. Con la fila de apertura, la columna Saldo se
 * lee de arriba abajo y cada número sale del anterior.
 *
 * @param {Array<object>} filas Las de `GET /api/suppliers/:id/movimientos/export`.
 * @param {{saldoInicial?: number}} opciones El `saldo_inicial` de esa respuesta.
 * @returns {object} La hoja, lista para `XLSX.utils.book_append_sheet`.
 */
export function armarHoja(filas = [], { saldoInicial = 0 } = {}) {
  const hoja = {}
  const lista = Array.isArray(filas) ? filas : []

  // Mismo criterio que `celda`: un inicial ilegible entra como 0 y no como NaN,
  // porque un NaN en la primera celda de la columna rompe la suma de todas.
  const numeroInicial = Number(saldoInicial)
  const inicial = Number.isFinite(numeroInicial) ? numeroInicial : 0

  // Solo cuando hay algo que explicar. Sin rango de fechas el período empieza
  // con la cuenta, y una fila «Saldo anterior $0,00» arriba de todo es ruido
  // que hace dudar de si falta algo antes.
  const apertura = inicial !== 0
    ? [{ fecha: '', tipo: '', descripcion: SALDO_ANTERIOR, debe: 0, haber: 0, saldo: inicial }]
    : []

  // La apertura se escribe **por el mismo camino que los movimientos** y no con
  // celdas sueltas: así el importe cae en la columna Saldo por construcción y
  // pasa por `celda`, que es lo que le pone `{ t: 'n' }`. Si saliera como texto,
  // la planilla abre, se ve bien, y la columna deja de sumar — el paso manual P7.
  const cuerpo = [...apertura, ...lista]

  // El CUIT sale de la primera fila QUE VINO DE LA API: la de apertura la
  // fabrica esta función y no pertenece a ningún proveedor. Un proveedor sin
  // movimientos no tiene ninguna, y la celda queda vacía en vez de romper la
  // exportación: sin movimientos el archivo igual sale, con encabezados y sin
  // filas.
  hoja[XLSX.utils.encode_cell({ r: 0, c: 0 })] = { t: 's', v: 'CUIT' }
  hoja[XLSX.utils.encode_cell({ r: 0, c: 1 })] = celda('cuit', lista[0] && lista[0].cuit)

  COLUMNAS.forEach((columna, c) => {
    hoja[XLSX.utils.encode_cell({ r: FILA_DEL_ENCABEZADO, c })] = { t: 's', v: columna.titulo }
  })

  cuerpo.forEach((fila, i) => {
    COLUMNAS.forEach((columna, c) => {
      const destino = { r: FILA_DEL_ENCABEZADO + 1 + i, c }
      hoja[XLSX.utils.encode_cell(destino)] = celda(columna.clave, fila && fila[columna.clave])
    })
  })

  hoja['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: FILA_DEL_ENCABEZADO + cuerpo.length, c: COLUMNAS.length - 1 },
  })
  hoja['!cols'] = ANCHOS.map((wch) => ({ wch }))

  return hoja
}

/** Deja un texto usable como nombre de archivo: sin espacios ni acentos. */
function parteDelNombre(texto) {
  return String(texto || '')
    .normalize('NFD')
    // El rango de diacríticos que `NFD` separó de su letra (U+0300–U+036F).
    // Se ve vacío en algunos editores porque son marcas combinantes.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * El nombre del archivo, con proveedor y período (FR-100).
 *
 * Los dos datos van adentro del nombre para que dos exportaciones distintas no
 * se pisen en la carpeta de descargas: bajar la cuenta de dos proveedores como
 * «cuenta.xlsx» deja una sola, y no se sabe cuál.
 */
export function nombreDelArchivo({ proveedor, desde, hasta } = {}) {
  const periodo = desde && hasta && desde !== hasta
    ? `${desde}_a_${hasta}`
    : (desde || hasta || 'sin-fecha')

  const quien = parteDelNombre(proveedor) || 'proveedor'

  return `cuenta_${quien}_${periodo}.xlsx`
}
