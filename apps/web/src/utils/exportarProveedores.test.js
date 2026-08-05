import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { armarHoja, nombreDelArchivo, COLUMNAS } from './exportarProveedores'

/**
 * Una fila como la devuelve GET /api/suppliers/:id/movimientos/export.
 *
 * Los importes vienen como número y el CUIT como string: es el contrato de
 * `filaDeCuentaParaExport` del servidor, no una comodidad del test.
 */
const FILA = {
  fecha: '2026-01-08',
  tipo: 'Pedido',
  descripcion: 'Recepción orden #103',
  debe: 72000,
  haber: 0,
  saldo: 72000,
  cuit: '30123456789',
}

const PAGO = {
  fecha: '2026-02-14',
  tipo: 'Pago',
  descripcion: 'Transferencia',
  debe: 0,
  haber: 8000,
  saldo: 64000,
  cuit: '30123456789',
}

describe('armarHoja', () => {
  it('escribe las seis columnas de la cuenta, en orden', () => {
    const hoja = armarHoja([])

    const titulos = ['A2', 'B2', 'C2', 'D2', 'E2', 'F2'].map((celda) => hoja[celda].v)

    expect(titulos).toEqual(['Fecha', 'Tipo', 'Descripción', 'Debe', 'Haber', 'Saldo'])
    // Seis, no siete: la spec decidió estas y no un asiento contable formal.
    expect(COLUMNAS).toHaveLength(6)
  })

  // El caso que arruina la inferencia de tipos y no rompe nada visible: un
  // importe escrito como el texto «1.234,50» abre bien, se ve bien, y la
  // columna no suma. Es el criterio de éxito 12 del lado que un test puede
  // afirmar —que la celda sea numérica—; que la planilla la sume de verdad es
  // el paso manual P7.
  it('la columna de importes NO sale como texto', () => {
    const hoja = armarHoja([FILA, PAGO])

    for (const celda of ['D3', 'E3', 'F3', 'D4', 'E4', 'F4']) {
      expect(hoja[celda].t).toBe('n')
      expect(typeof hoja[celda].v).toBe('number')
    }

    expect(hoja.D3.v).toBe(72000)
    expect(hoja.E4.v).toBe(8000)
    expect(hoja.F4.v).toBe(64000)
  })

  // Once dígitos inferidos como número se escriben 3,01235E+10 y pierden los
  // últimos, igual que pasaba con el CAE. Un CUIT incompleto no identifica a
  // nadie ante una inspección.
  it('el CUIT NO se escribe como número', () => {
    const cuit = armarHoja([FILA]).B1

    expect(cuit.t).toBe('s')
    expect(typeof cuit.v).toBe('string')
    expect(cuit.v).toBe('30123456789')
    expect(cuit.v).toHaveLength(11)
    // Formato «Texto» de Excel: sin esto, abrir el archivo lo reinterpreta.
    expect(cuit.z).toBe('@')
  })

  it('un importe en cero se escribe como número, no como celda vacía', () => {
    const hoja = armarHoja([FILA])

    expect(hoja.E3.t).toBe('n')
    expect(hoja.E3.v).toBe(0)
  })

  it('un importe ilegible entra como 0 y NO como NaN, que rompería toda la columna', () => {
    const saldo = armarHoja([{ ...FILA, saldo: 'no es un número' }]).F3

    expect(saldo.v).toBe(0)
    expect(Number.isNaN(saldo.v)).toBe(false)
  })

  // US8 escenario 7: exportar la cuenta de un proveedor recién dado de alta no
  // puede fallar ni bajar un archivo sin encabezados.
  it('sin movimientos la hoja sale con encabezados y sin filas', () => {
    const hoja = armarHoja([])

    expect(hoja.A2.v).toBe('Fecha')
    expect(hoja.F2.v).toBe('Saldo')
    // La primera fila de datos iría en la 3, y no hay ninguna.
    expect(hoja.A3).toBeUndefined()
    expect(hoja['!ref']).toBe('A1:F2')
  })

  it('el rango cubre el CUIT, el encabezado y una fila por movimiento', () => {
    expect(armarHoja([FILA, PAGO])['!ref']).toBe('A1:F4')
  })

  // Un movimiento sin notas llega con la descripción que puso el servidor; lo
  // que no puede pasar es que una fila corta corra las columnas de las demás.
  it('un movimiento sin descripción deja la celda vacía sin correr las columnas', () => {
    const hoja = armarHoja([{ ...FILA, descripcion: null }])

    expect(hoja.C3.v).toBe('')
    expect(hoja.D3.v).toBe(72000)
  })
})

// ════════════════════════════════════════════
//  El período que arranca con saldo anterior
//
//  ⚠ **Las fixtures de arriba no podían encontrar este defecto**, y por eso
//  pasaron doce casos sin encontrarlo: van todas sin rango de fechas, así que su
//  primera fila abre en su propio debe y la cuenta empieza en cero. Con `?desde=`
//  no: el archivo arrancaba la cuenta en cero igual y cerraba en el NETO DEL
//  PERÍODO —$22.000 sobre una cuenta que debía $122.000—, mientras la pantalla
//  mostraba el saldo entero.
// ════════════════════════════════════════════

/** El `saldo_inicial` que devuelve la API para un rango con historia atrás. */
const SALDO_PREVIO = 100000

/**
 * Un `?desde=2026-07-01` sobre una cuenta que ya venía debiendo $100.000.
 *
 * Ascendente —del más viejo al más nuevo—, como las manda la API. 100.000 +
 * 72.000 − 50.000 = 122.000, que es el saldo grande de la pantalla y el número
 * con el que la planilla tiene que cerrar (US8 escenario 6).
 */
const CON_RANGO = [
  {
    fecha: '2026-07-14',
    tipo: 'Pedido',
    descripcion: 'Recepción orden #118',
    debe: 72000,
    haber: 0,
    saldo: 172000,
    cuit: '30123456789',
  },
  {
    fecha: '2026-07-28',
    tipo: 'Pago',
    descripcion: 'Transferencia',
    debe: 0,
    haber: 50000,
    saldo: 122000,
    cuit: '30123456789',
  },
]

/**
 * Una columna de la hoja, de la primera fila de datos al final del `!ref`.
 *
 * Se lee de las CELDAS y no de la fixture que entró: lo que hay que verificar es
 * el archivo que abre el contador. Un test que vuelva a mirar sus propios datos
 * de entrada pasa con y sin el defecto.
 */
function columna(hoja, letra) {
  const ultima = XLSX.utils.decode_range(hoja['!ref']).e.r
  const valores = []

  // La fila 1 es el CUIT y la 2 el encabezado, así que los datos empiezan en la
  // 3 —índice 2, y las direcciones de celda son base 1—.
  for (let r = 2; r <= ultima; r += 1) {
    valores.push(hoja[`${letra}${r + 1}`]?.v)
  }

  return valores
}

const suma = (valores) => valores.reduce((total, v) => total + (Number(v) || 0), 0)

describe('armarHoja · el saldo con el que abre el período', () => {
  it('con rango, la planilla dice de dónde sale el saldo con el que arranca', () => {
    // Sin esta fila, la primera del archivo muestra un saldo acumulado que no se
    // deduce de sus propias columnas —$172.000 con un debe de $72.000— y el
    // contador no tiene cómo saber de dónde salió.
    const hoja = armarHoja(CON_RANGO, { saldoInicial: SALDO_PREVIO })

    expect(hoja.C3.v).toBe('Saldo anterior')
    expect(hoja.F3.v).toBe(100000)
  })

  it('el «Saldo anterior» NO se escribe como texto, que dejaría la columna sin sumar', () => {
    // El paso manual P7 en la parte que un test sí puede afirmar: un importe de
    // apertura escrito como texto abre bien, se ve bien, y rompe la suma de toda
    // la columna Saldo. Debe y Haber van en cero por lo mismo: una celda de texto
    // en el medio arruina las otras dos columnas igual.
    const hoja = armarHoja(CON_RANGO, { saldoInicial: SALDO_PREVIO })

    // La fila 3 es la de apertura y no el primer movimiento: sin esta línea, el
    // caso miraría los importes de un movimiento cualquiera y pasaría aunque la
    // apertura no existiera.
    expect(hoja.C3.v).toBe('Saldo anterior')

    for (const celda of ['D3', 'E3', 'F3']) {
      expect(hoja[celda].t).toBe('n')
      expect(typeof hoja[celda].v).toBe('number')
    }
  })

  it('el archivo cierra en el saldo de la cuenta y ese cierre sale de sus propias columnas', () => {
    // US8 escenario 6. La cuenta del contador: saldo de apertura + todo el debe −
    // todo el haber = el saldo con el que cierra, que es el saldo grande de la
    // pantalla. Sin la fila de apertura los dos primeros sumandos se pisan y el
    // archivo no cuadra ni consigo mismo.
    const hoja = armarHoja(CON_RANGO, { saldoInicial: SALDO_PREVIO })

    const saldos = columna(hoja, 'F')

    expect(saldos[0] + suma(columna(hoja, 'D')) - suma(columna(hoja, 'E'))).toBe(122000)
    expect(saldos.at(-1)).toBe(122000)
  })

  it('la fila de apertura va DEBAJO del encabezado y no lo corre de la fila 2', () => {
    // La tabla tiene que estar en el mismo lugar se haya pedido un rango o no, y
    // el importe de apertura tiene que caer DENTRO de la columna Saldo: arriba
    // del encabezado quedaría afuera, y seleccionar la columna en la planilla no
    // lo agarraría.
    const hoja = armarHoja(CON_RANGO, { saldoInicial: SALDO_PREVIO })

    expect(hoja.A2.v).toBe('Fecha')
    expect(hoja.F2.v).toBe('Saldo')
    // Y el CUIT sigue saliendo de una fila de la API: la de apertura la fabrica
    // `armarHoja` y no pertenece a ningún proveedor.
    expect(hoja.B1.v).toBe('30123456789')
    // CUIT + encabezado + apertura + dos movimientos.
    expect(hoja['!ref']).toBe('A1:F5')
  })

  it('sin saldo anterior NO se agrega la fila: el período empieza con la cuenta', () => {
    // La otra mitad. Una fila «Saldo anterior $0,00» arriba de todo es ruido que
    // hace dudar de si falta algo antes, y sin esta afirmación una apertura
    // dibujada siempre pasaría los casos de arriba.
    const hoja = armarHoja([FILA, PAGO])

    expect(hoja.C3.v).toBe('Recepción orden #103')
    expect(hoja['!ref']).toBe('A1:F4')
  })

  it('un rango sin movimientos igual dice el saldo anterior, y no que la cuenta está en cero', () => {
    // Un archivo vacío sobre una cuenta que debe $122.000 se lee como «no debe
    // nada»: es el mismo criterio que el 200 con la lista vacía de la API.
    const hoja = armarHoja([], { saldoInicial: 122000 })

    expect(hoja.C3.v).toBe('Saldo anterior')
    expect(hoja.F3.v).toBe(122000)
    expect(hoja['!ref']).toBe('A1:F3')
  })

  it('un saldo inicial ilegible NO inventa una apertura en cero', () => {
    // Si la API cambiara el campo o llegara basura, lo que corresponde es el
    // archivo de siempre y no una fila de apertura que afirma un saldo que nadie
    // calculó.
    const hoja = armarHoja(CON_RANGO, { saldoInicial: 'no es un número' })

    expect(hoja.C3.v).toBe('Recepción orden #118')
  })
})

describe('nombreDelArchivo', () => {
  // Dos exportaciones distintas no se pueden pisar en la carpeta de descargas:
  // bajar dos veces «cuenta.xlsx» deja una sola y no se sabe de quién es.
  it('el nombre del archivo lleva el proveedor y el período', () => {
    expect(nombreDelArchivo({ proveedor: 'Nutrifit', desde: '2026-01-01', hasta: '2026-07-31' }))
      .toBe('cuenta_nutrifit_2026-01-01_a_2026-07-31.xlsx')
  })

  it('dos proveedores en el mismo período dan dos nombres distintos', () => {
    const a = nombreDelArchivo({ proveedor: 'Nutrifit', desde: '2026-01-01', hasta: '2026-07-31' })
    const b = nombreDelArchivo({ proveedor: 'Distribuidora Sur', desde: '2026-01-01', hasta: '2026-07-31' })

    expect(a).not.toBe(b)
  })

  it('el mismo proveedor en dos períodos da dos nombres distintos', () => {
    const a = nombreDelArchivo({ proveedor: 'Nutrifit', desde: '2026-01-01', hasta: '2026-07-31' })
    const b = nombreDelArchivo({ proveedor: 'Nutrifit', desde: '2026-08-01', hasta: '2026-08-31' })

    expect(a).not.toBe(b)
  })

  // Un nombre con espacios o acentos rompe la descarga en algunos navegadores.
  it('el nombre del proveedor queda sin acentos ni espacios', () => {
    expect(nombreDelArchivo({ proveedor: 'Almacén Güemes S.A.', desde: '2026-01-01', hasta: '2026-01-01' }))
      .toBe('cuenta_almacen-guemes-s-a_2026-01-01.xlsx')
  })

  it('sin filtros el nombre sigue siendo un archivo válido', () => {
    expect(nombreDelArchivo()).toBe('cuenta_proveedor_sin-fecha.xlsx')
  })
})
