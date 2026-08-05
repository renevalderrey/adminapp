import { describe, it, expect } from 'vitest'
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
