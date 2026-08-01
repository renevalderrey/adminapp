import { describe, it, expect } from 'vitest'
import { armarHoja, nombreDelArchivo, COLUMNAS } from './exportarVentas'

/** Una fila como la devuelve GET /api/sales/export. */
const FILA = {
  fecha: '2026-08-01',
  hora: '14:32',
  tipo: 'Factura B',
  comprobante: '0005-00014882',
  cae: '75412339018264',
  cliente: 'Vega, Marcela',
  sucursal: 'Ortiz',
  estado: 'Autorizada',
  medio_de_pago: 'Efectivo',
  // El DECIMAL vuelve como STRING desde el driver de Postgres. Es el caso
  // real, no un caso raro.
  total: '12500.00',
}

describe('armarHoja', () => {
  it('escribe las diez columnas de la fila 1, en orden', () => {
    const hoja = armarHoja([])

    const titulos = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1']
      .map((celda) => hoja[celda].v)

    expect(titulos).toEqual([
      'Fecha', 'Hora', 'Tipo', 'Comprobante', 'CAE',
      'Cliente', 'Sucursal', 'Estado', 'Medio de pago', 'Total',
    ])
    expect(COLUMNAS).toHaveLength(10)
  })

  // El caso que arruina la inferencia de tipos: 14 dígitos leídos como número
  // se escriben 7,54123E+13 y pierden los últimos. Un CAE incompleto no sirve
  // para nada — es lo que se dicta ante una inspección.
  it('el CAE de 14 dígitos queda COMPLETO y como texto, no en notación científica', () => {
    const cae = armarHoja([FILA]).E2

    expect(cae.v).toBe('75412339018264')
    expect(typeof cae.v).toBe('string')
    expect(cae.t).toBe('s')
    // Formato «Texto» de Excel: sin esto, abrir el archivo lo reinterpreta.
    expect(cae.z).toBe('@')
  })

  // El otro caso: un total escrito como texto abre bien, se ve bien, y la
  // columna no suma. Nada avisa.
  it('el total es NÚMERO aunque la API lo mande como string', () => {
    const total = armarHoja([FILA]).J2

    expect(total.t).toBe('n')
    expect(typeof total.v).toBe('number')
    expect(total.v).toBe(12500)
  })

  it('un total ilegible entra como 0 y NO como NaN, que rompería toda la columna', () => {
    const total = armarHoja([{ ...FILA, total: 'no es un número' }]).J2

    expect(total.v).toBe(0)
    expect(Number.isNaN(total.v)).toBe(false)
  })

  it('un total en cero se escribe como número, no como celda vacía', () => {
    const total = armarHoja([{ ...FILA, total: '0.00' }]).J2

    expect(total.t).toBe('n')
    expect(total.v).toBe(0)
  })

  // Una venta sin comprobante fiscal no tiene CAE, y el archivo la lleva igual.
  it('una venta sin CAE deja la celda vacía sin romper la fila', () => {
    const hoja = armarHoja([{ ...FILA, cae: '', tipo: 'Sin comprobante fiscal', estado: 'Registrada' }])

    expect(hoja.E2.v).toBe('')
    expect(hoja.C2.v).toBe('Sin comprobante fiscal')
    expect(hoja.H2.v).toBe('Registrada')
  })

  it('el rango de la hoja cubre el encabezado más una fila por venta', () => {
    expect(armarHoja([FILA, FILA, FILA])['!ref']).toBe('A1:J4')
    expect(armarHoja([])['!ref']).toBe('A1:J1')
  })

  it('las anuladas van al archivo con su estado, no se ocultan', () => {
    const hoja = armarHoja([{ ...FILA, estado: 'Anulada · vigente ante ARCA' }])

    expect(hoja.H2.v).toBe('Anulada · vigente ante ARCA')
  })
})

describe('nombreDelArchivo', () => {
  // Dos exportaciones con filtros distintos no se pueden pisar en la carpeta
  // de descargas: bajar dos veces «ventas.xlsx» deja una sola y no se sabe cuál.
  it('lleva el período y la sucursal', () => {
    expect(nombreDelArchivo({ desde: '2026-08-01', hasta: '2026-08-31', sucursal: 'Ortiz' }))
      .toBe('ventas_2026-08-01_a_2026-08-31_ortiz.xlsx')
  })

  it('dos filtros distintos dan dos nombres distintos', () => {
    const a = nombreDelArchivo({ desde: '2026-08-01', hasta: '2026-08-31', sucursal: 'Ortiz' })
    const b = nombreDelArchivo({ desde: '2026-08-01', hasta: '2026-08-31', sucursal: 'Centro' })

    expect(a).not.toBe(b)
  })

  it('un solo día no se escribe dos veces', () => {
    expect(nombreDelArchivo({ desde: '2026-08-01', hasta: '2026-08-01' }))
      .toBe('ventas_2026-08-01_todas-las-sucursales.xlsx')
  })

  // Un nombre con espacios o acentos rompe la descarga en algunos navegadores.
  it('el nombre de la sucursal queda sin acentos ni espacios', () => {
    expect(nombreDelArchivo({ desde: '2026-08-01', hasta: '2026-08-01', sucursal: 'Depósito Central' }))
      .toBe('ventas_2026-08-01_deposito-central.xlsx')
  })
})
