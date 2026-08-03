import { describe, it, expect } from 'vitest'
import {
  parsearPegado,
  separarColumnas,
  comoCsv,
  TOPE_DE_FILAS,
} from './pegadoDeLista'
import { aNumero } from './importes'

// ════════════════════════════════════════════
//  El parser del texto pegado
//
//  El caso que da nombre a este archivo es el último: **una lista de productos
//  baratos importa los costos como costos**. El sistema viejo decidía que la
//  columna 2 era «stock» si su valor máximo era ≤ 9999 y «costo» si no
//  (`legacy:4738-4746`). Con una lista de accesorios —todos por debajo de
//  $9.999— leía los costos como stock, dejaba los costos en cero y no avisaba de
//  nada: el margen que mostraba el POS pasaba a ser mentira para el catálogo
//  entero.
// ════════════════════════════════════════════

describe('separarColumnas · los tres separadores', () => {
  it('separa por tabulación, que es lo que produce copiar de Excel', () => {
    expect(separarColumnas('Whey 1kg\t12500\t7')).toEqual(['Whey 1kg', '12500', '7'])
  })

  it('separa por punto y coma, que es lo que produce un CSV europeo', () => {
    expect(separarColumnas('Whey 1kg;12500;7')).toEqual(['Whey 1kg', '12500', '7'])
  })

  it('separa por dos o más espacios, que es lo que queda de un PDF', () => {
    expect(separarColumnas('Whey 1kg     12500   7')).toEqual(['Whey 1kg', '12500', '7'])
  })

  it('UN espacio NO separa: partiría «Whey Protein 2 LB» en cuatro columnas', () => {
    expect(separarColumnas('Whey Protein 2 LB\t12500')).toEqual(['Whey Protein 2 LB', '12500'])
  })
})

describe('parsearPegado · el separador puede cambiar entre líneas', () => {
  it('lee una pegada con tabulación en una línea y espacios en la otra', () => {
    // Pasa de verdad: se pegan dos listas de dos proveedores distintos, una
    // copiada de Excel y otra de un mail.
    const { filas } = parsearPegado('Whey 1kg\t12500\nCreatina 300g    8900')

    expect(filas).toEqual([
      ['Whey 1kg', '12500'],
      ['Creatina 300g', '8900'],
    ])
  })
})

describe('parsearPegado · encabezado detectado y no detectado', () => {
  it('detecta un encabezado reconocible y lo saca de los datos', () => {
    const r = parsearPegado('Producto\tCosto\tStock\nWhey 1kg\t12500\t7')

    expect(r.encabezadoDetectado).toBe(true)
    expect(r.columnas).toEqual(['Producto', 'Costo', 'Stock'])
    expect(r.filas).toEqual([['Whey 1kg', '12500', '7']])
    expect(r.mapeo.name).toBe(0)
    expect(r.mapeo.cost).toBe(1)
    expect(r.mapeo.quantity).toBe(2)
  })

  it('sin encabezado sintetiza «Columna N» y NO se come la primera fila', () => {
    // Es el error que se paga sin darse cuenta: la primera línea de datos
    // desaparece y el producto que estaba ahí no se importa nunca.
    const r = parsearPegado('Whey 1kg\t12500\t7\nCreatina 300g\t8900\t3')

    expect(r.encabezadoDetectado).toBe(false)
    expect(r.columnas).toEqual(['Columna 1', 'Columna 2', 'Columna 3'])
    expect(r.filas).toHaveLength(2)
    expect(r.filas[0]).toEqual(['Whey 1kg', '12500', '7'])
  })

  it('un nombre de producto que contiene un alias NO convierte la fila en encabezado', () => {
    // «Barra de proteína» activa el alias `barra` de «código de barras». Con una
    // sola coincidencia alcanzaría, y esa fila se perdería.
    const r = parsearPegado('Barra de proteina\t1200\t20\nGel energetico\t900\t15')

    expect(r.encabezadoDetectado).toBe(false)
    expect(r.filas).toHaveLength(2)
  })

  it('la propuesta por defecto es 1 = Nombre, 2 = Costo, 3 = Stock', () => {
    const r = parsearPegado('Whey\t12500\t7')

    expect(r.mapeo.name).toBe(0)
    expect(r.mapeo.cost).toBe(1)
    expect(r.mapeo.quantity).toBe(2)
    expect(r.mapeo.sku).toBe(-1)
  })

  it('con dos columnas no propone una tercera que no existe', () => {
    const r = parsearPegado('Whey\t12500')

    expect(r.mapeo.cost).toBe(1)
    expect(r.mapeo.quantity).toBe(-1)
  })
})

describe('parsearPegado · una lista barata NO se lee como stock', () => {
  it('los costos de menos de $9.999 siguen siendo costos', () => {
    // El sistema viejo miraba el máximo de la columna 2: con todo por debajo de
    // 9999 decidía que era stock, mapeaba los costos a `quantity` y dejaba los
    // costos en cero. Acá la propuesta no depende de los valores.
    const baratos = parsearPegado('Muñequera\t1200\nCinturón\t3400\nShaker\t900')
    const caros = parsearPegado('Whey 5lb\t89000\nCreatina\t42000\nPre\t35000')

    expect(baratos.mapeo).toEqual(caros.mapeo)
    expect(baratos.mapeo.cost).toBe(1)
    expect(baratos.mapeo.quantity).toBe(-1)
  })
})

describe('parsearPegado · la línea original de cada fila', () => {
  it('las líneas en blanco se descartan y la numeración sigue siendo la del texto', () => {
    // El servidor informa `fila: i + 2` contando desde el archivo que recibió.
    // Sin esta correspondencia, «error en la línea 3» apunta a una línea vacía y
    // el usuario corrige una fila que estaba bien.
    const r = parsearPegado('Whey\t12500\n\n\nCreatina\t8900\n\nBcaa\t5400')

    expect(r.filas).toHaveLength(3)
    expect(r.lineas).toEqual([1, 4, 6])
  })

  it('con encabezado, la primera fila de datos apunta a la línea 2', () => {
    const r = parsearPegado('Producto\tCosto\nWhey\t12500')

    expect(r.lineas).toEqual([2])
  })
})

describe('parsearPegado · el mismo producto repetido entra dos veces', () => {
  it('no se deduplica acá: lo resuelve el servidor y lo informa como «pisados»', () => {
    // Deduplicar en el navegador escondería el problema justo donde el usuario
    // podría verlo, y el servidor informaría cero pisados sobre un archivo que
    // sí los tenía.
    const r = parsearPegado('Whey\t12500\nWhey\t13900')

    expect(r.filas).toHaveLength(2)
    expect(r.filas[1][1]).toBe('13900')
  })
})

describe('parsearPegado · el tope de 2.000 filas', () => {
  it('rechaza la pegada ANTES de armar la matriz', () => {
    const texto = Array.from({ length: TOPE_DE_FILAS + 1 }, (_, i) => `P${i}\t100`).join('\n')
    const r = parsearPegado(texto)

    expect(r.ok).toBe(false)
    expect(r.filas).toEqual([])
    expect(r.error).toContain(String(TOPE_DE_FILAS))
  })

  it('exactamente 2.000 entra', () => {
    const texto = Array.from({ length: TOPE_DE_FILAS }, (_, i) => `P${i}\t100`).join('\n')
    const r = parsearPegado(texto)

    expect(r.ok).toBe(true)
    expect(r.total).toBe(TOPE_DE_FILAS)
  })

  it('un pegado vacío lo dice en vez de devolver una matriz vacía', () => {
    expect(parsearPegado('').error).toBeTruthy()
    expect(parsearPegado('   \n  \n').error).toBeTruthy()
  })

  it('solo el encabezado, sin datos, lo dice', () => {
    const r = parsearPegado('Producto\tCosto\tStock')

    expect(r.ok).toBe(false)
    expect(r.error).toContain('encabezado')
  })
})

describe('parsearPegado · filas desparejas', () => {
  it('completa con celdas vacías en vez de dejar columnas de menos', () => {
    // Sin esto, la fila corta sale al CSV con una columna menos y el servidor lee
    // el stock donde espera el costo.
    const r = parsearPegado('Whey\t12500\t7\nCreatina\t8900')

    expect(r.filas[1]).toEqual(['Creatina', '8900', ''])
  })
})

describe('los importes argentinos se leen con aNumero', () => {
  it('1.234,50 son mil doscientos treinta y cuatro con cincuenta', () => {
    const r = parsearPegado('Whey\t1.234,50')

    expect(aNumero(r.filas[0][1])).toBe(1234.5)
  })

  it('$12.500 no se lee como doce con cinco', () => {
    const r = parsearPegado('Whey\t$12.500')

    expect(aNumero(r.filas[0][1])).toBe(12500)
  })

  it('una celda de costo vacía es null y NO cero', () => {
    // Cero es un costo: pone el margen del POS en mentira para ese producto y
    // nada falla. Es FR-099.
    const r = parsearPegado('Whey\t\t7')

    expect(aNumero(r.filas[0][1])).toBeNull()
  })
})

describe('comoCsv · la matriz se sube por el mismo endpoint que un archivo', () => {
  it('entrecomilla para que una coma en el nombre no parta la fila', () => {
    const csv = comoCsv(['Producto', 'Costo'], [['Whey, chocolate', '12500']])

    expect(csv).toBe('"Producto","Costo"\n"Whey, chocolate","12500"')
  })

  it('duplica las comillas internas', () => {
    const csv = comoCsv(['Producto'], [['Whey 2" pack']])

    expect(csv).toBe('"Producto"\n"Whey 2"" pack"')
  })

  it('manda los importes TAL CUAL: el que los interpreta es el servidor', () => {
    // Convertirlos acá sería una segunda lectura del mismo formato, que es
    // exactamente lo que este módulo evita.
    const csv = comoCsv(['Costo'], [['1.234,50']])

    expect(csv).toContain('1.234,50')
  })
})
