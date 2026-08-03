import { describe, it, expect } from 'vitest'
import {
  COLUMNAS,
  celda,
  armarFilas,
  armarHoja,
  nombreDelArchivo,
} from './exportarInventario'

// ════════════════════════════════════════════
//  El archivo de inventario: los tipos se fuerzan celda por celda
//
//  Los dos casos que la inferencia de `xlsx` arruina son justo los de esta
//  pantalla, y ninguno rompe nada visible —el archivo abre, se ve bien, y está
//  mal—:
//
//   · Un SKU `0012345` inferido como número pierde los ceros de adelante.
//   · El costo llega como STRING del DECIMAL de Postgres; inferido como texto,
//     la columna Costo no suma, que es para lo que se exporta.
//
//  ⚠ Esto verifica el OBJETO DE HOJA que produce `xlsx`, no lo que Excel hace
//  con él. Abrir el `.xlsx` en Excel es un paso manual de `sdd-verify`.
// ════════════════════════════════════════════

const SUCURSALES = [
  { id: 3, name: 'Centro', is_active: true },
  { id: 7, name: 'Depósito', is_active: false },
]

const PRODUCTO = (campos = {}) => ({
  id: 1,
  name: 'Colágeno 300g',
  sku: '0012345',
  category: 'colageno',
  brand: { id: 2, name: 'ENA' },
  cost: '1200.00',
  stock: [
    { punto_de_venta_id: 3, quantity: 12, min_stock: 4 },
    { punto_de_venta_id: 7, quantity: 5, min_stock: 0 },
  ],
  ...campos,
})

/** El margen que usa el POS: costo × (1 + 50/100). */
const SETTINGS = { margin_efectivo: 50, recargo_tarjeta: 0, descuento_alianza: 0 }

/** El valor de una celda por su título de columna. */
function valorDe(hoja, sucursales, titulo, fila = 1) {
  const c = COLUMNAS(sucursales).findIndex((col) => col.titulo === titulo)
  return hoja[`${String.fromCharCode(65 + c)}${fila + 1}`]
}

describe('COLUMNAS · una columna por sucursal, entre el precio y los totales', () => {
  it('tiene las nueve columnas con dos sucursales', () => {
    expect(COLUMNAS(SUCURSALES).map((c) => c.titulo)).toEqual([
      'Producto', 'SKU', 'Marca', 'Categoría', 'Costo', 'Precio',
      'Centro', 'Depósito (inactiva)',
      'Stock total', 'Valorizado',
    ])
  })

  it('sin sucursales sigue teniendo los totales', () => {
    expect(COLUMNAS([]).map((c) => c.titulo)).toEqual([
      'Producto', 'SKU', 'Marca', 'Categoría', 'Costo', 'Precio', 'Stock total', 'Valorizado',
    ])
  })

  it('marca la sucursal dada de baja: su stock no está disponible para vender', () => {
    expect(COLUMNAS(SUCURSALES)[7].titulo).toContain('(inactiva)')
  })
})

describe('celda · el SKU va como TEXTO', () => {
  it('un SKU con ceros adelante los conserva', () => {
    // Inferido como número, `0012345` se escribe `12345` y deja de coincidir con
    // el del proveedor.
    expect(celda('codigo', '0012345')).toEqual({ t: 's', v: '0012345', z: '@' })
  })

  it('un SKU largo no se pasa a notación científica', () => {
    expect(celda('codigo', '7790001234567')).toEqual({ t: 's', v: '7790001234567', z: '@' })
  })
})

describe('celda · los importes y las cantidades van como NÚMERO', () => {
  it('el costo que llega como string del DECIMAL se escribe como número', () => {
    expect(celda('numero', '1200.00')).toEqual({ t: 'n', v: 1200 })
  })

  it('un valor ilegible entra como 0 y NO como NaN', () => {
    // Una celda con NaN rompe la suma de la columna entera.
    expect(celda('numero', 'mil doscientos')).toEqual({ t: 'n', v: 0 })
    expect(celda('numero', null)).toEqual({ t: 'n', v: 0 })
  })
})

describe('celda · un precio que no existe va VACÍO y no en cero', () => {
  it('null se escribe como celda vacía', () => {
    // Cero es un precio, y uno que dice que el producto sale gratis. Vacío es
    // «no hay», que es lo que pasa cuando falta el costo.
    expect(celda('importe_opcional', null)).toEqual({ t: 's', v: '' })
  })

  it('un precio real sigue yendo como número', () => {
    expect(celda('importe_opcional', 1800)).toEqual({ t: 'n', v: 1800 })
  })
})

describe('armarFilas · lo que sale de cada producto', () => {
  it('resuelve el stock por punto_de_venta_id y no por el texto location', () => {
    const [fila] = armarFilas([PRODUCTO()], { sucursales: SUCURSALES, settings: SETTINGS })

    expect(fila.sucursal_3).toBe(12)
    expect(fila.sucursal_7).toBe(5)
  })

  it('una sucursal sin fila de stock exporta 0 y no vacío', () => {
    const sinDeposito = PRODUCTO({ stock: [{ punto_de_venta_id: 3, quantity: 12 }] })
    const [fila] = armarFilas([sinDeposito], { sucursales: SUCURSALES, settings: SETTINGS })

    expect(fila.sucursal_7).toBe(0)
  })

  it('el total y el valorizado suman TODAS las sucursales cuando no hay filtro', () => {
    const [fila] = armarFilas([PRODUCTO()], { sucursales: SUCURSALES, settings: SETTINGS })

    expect(fila.total).toBe(17)
    expect(fila.valorizado).toBe(17 * 1200)
  })

  it('con una sucursal elegida, el total es SOLO el de esa', () => {
    // Es lo que hace que la suma del archivo coincida con el indicador «Valor
    // del stock» de la pantalla: los dos miran el mismo conjunto.
    const [fila] = armarFilas([PRODUCTO()], {
      sucursales: [SUCURSALES[0]],
      settings: SETTINGS,
      sucursalElegida: 3,
    })

    expect(fila.total).toBe(12)
    expect(fila.valorizado).toBe(12 * 1200)
  })

  it('el precio sale de calcularPrecios y no de una cuenta escrita acá', () => {
    const [fila] = armarFilas([PRODUCTO()], { sucursales: SUCURSALES, settings: SETTINGS })

    expect(fila.precio).toBe(1800)
  })

  it('un producto SIN costo exporta el precio en null, no en cero', () => {
    const sinCosto = PRODUCTO({ cost: 0, price_override: null })
    const [fila] = armarFilas([sinCosto], { sucursales: SUCURSALES, settings: SETTINGS })

    expect(fila.precio).toBeNull()
    expect(fila.valorizado).toBe(0)
  })

  it('un producto sin marca, categoría ni SKU exporta celdas vacías y no rompe', () => {
    const pelado = PRODUCTO({ brand: null, category: null, sku: null })
    const [fila] = armarFilas([pelado], { sucursales: SUCURSALES, settings: SETTINGS })

    expect(fila).toMatchObject({ marca: '', categoria: '', sku: '' })
  })
})

describe('armarHoja · la hoja que se escribe', () => {
  const filas = armarFilas([PRODUCTO()], { sucursales: SUCURSALES, settings: SETTINGS })
  const hoja = armarHoja(filas, SUCURSALES)

  it('la primera fila son los títulos', () => {
    expect(hoja.A1).toEqual({ t: 's', v: 'Producto' })
    expect(hoja.B1).toEqual({ t: 's', v: 'SKU' })
  })

  it('el SKU del producto conserva los ceros y va con formato Texto', () => {
    expect(valorDe(hoja, SUCURSALES, 'SKU')).toEqual({ t: 's', v: '0012345', z: '@' })
  })

  it('costo, precio, cantidades y valorizado son números sumables', () => {
    expect(valorDe(hoja, SUCURSALES, 'Costo')).toEqual({ t: 'n', v: 1200 })
    expect(valorDe(hoja, SUCURSALES, 'Precio')).toEqual({ t: 'n', v: 1800 })
    expect(valorDe(hoja, SUCURSALES, 'Centro')).toEqual({ t: 'n', v: 12 })
    expect(valorDe(hoja, SUCURSALES, 'Stock total')).toEqual({ t: 'n', v: 17 })
    expect(valorDe(hoja, SUCURSALES, 'Valorizado')).toEqual({ t: 'n', v: 20400 })
  })

  it('el rango cubre el encabezado y las filas', () => {
    expect(hoja['!ref']).toBe('A1:J2')
  })

  it('un producto sin costo deja la celda de Precio vacía', () => {
    const sinCosto = armarFilas([PRODUCTO({ cost: 0 })], { sucursales: SUCURSALES, settings: SETTINGS })
    const otra = armarHoja(sinCosto, SUCURSALES)

    expect(valorDe(otra, SUCURSALES, 'Precio')).toEqual({ t: 's', v: '' })
  })

  it('sin ninguna fila igual escribe los títulos', () => {
    // Un archivo con solo encabezados es peor que decir que no hay nada, y por
    // eso la pantalla avisa antes de llegar acá — pero la hoja no puede salir
    // rota si alguien la arma igual.
    const vacia = armarHoja([], SUCURSALES)

    expect(vacia.A1).toEqual({ t: 's', v: 'Producto' })
    expect(vacia['!ref']).toBe('A1:J1')
  })
})

describe('nombreDelArchivo · dos exportaciones distintas no se pisan', () => {
  it('lleva la fecha y la sucursal', () => {
    expect(nombreDelArchivo({ sucursal: 'Depósito', fecha: new Date(2026, 7, 3) }))
      .toBe('inventario_2026-08-03_deposito.xlsx')
  })

  it('sin sucursal dice que son todas', () => {
    expect(nombreDelArchivo({ fecha: new Date(2026, 7, 3) }))
      .toBe('inventario_2026-08-03_todas-las-sucursales.xlsx')
  })

  it('usa la fecha LOCAL y no la UTC', () => {
    // `toISOString()` devuelve UTC: en Argentina (UTC−3), a las 22:00 del 3 el
    // archivo saldría fechado el 4.
    const nocheDelTres = new Date(2026, 7, 3, 22, 30)

    expect(nombreDelArchivo({ fecha: nocheDelTres })).toContain('2026-08-03')
  })
})
