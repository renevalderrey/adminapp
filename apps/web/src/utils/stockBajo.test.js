import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { limiteDeStockBajo, esStockBajo } from './stockBajo'

// ════════════════════════════════════════════
//  La regla de «stock bajo» del navegador dice lo mismo que la del servidor
//
//  Los casos son los mismos que cubre `apps/api/src/tests/stockBajo.test.js`,
//  porque la regla es la misma (FR-016). Lo que este archivo agrega y aquél no
//  puede tener es la verificación de que el umbral **no está escrito acá
//  adentro**: la copia del servidor sí lo tiene —es su dueño— y la del
//  navegador lo recibe. Sin ese test, portar la función con el número adentro
//  pasa inadvertido y FR-017 queda incumplido sin que nada falle.
// ════════════════════════════════════════════

/** El umbral que hoy devuelve `GET /api/settings` como `umbral_stock_bajo`. */
const UMBRAL = 3

describe('limiteDeStockBajo · el mínimo de la fila manda; el umbral es el resto', () => {
  it('con min_stock cargado usa el mínimo y NO el umbral', () => {
    expect(limiteDeStockBajo({ min_stock: 10 }, UMBRAL)).toBe(10)
  })

  it('con min_stock en 0 cae al umbral', () => {
    // El 0 es el default de la columna: significa «no lo cargaron», no «el
    // mínimo es cero». Es justo lo que `GET /api/alerts` interpreta al revés y
    // por eso un producto sin mínimo no alerta nunca ahí.
    expect(limiteDeStockBajo({ min_stock: 0 }, UMBRAL)).toBe(UMBRAL)
  })

  it('sin la propiedad min_stock cae al umbral', () => {
    expect(limiteDeStockBajo({}, UMBRAL)).toBe(UMBRAL)
    expect(limiteDeStockBajo(undefined, UMBRAL)).toBe(UMBRAL)
  })

  it('un min_stock negativo es dato roto y cae al umbral', () => {
    expect(limiteDeStockBajo({ min_stock: -4 }, UMBRAL)).toBe(UMBRAL)
  })

  it('lee el min_stock que viene como string del driver de Postgres', () => {
    // `min_stock` es INTEGER, pero el include del listado lo devuelve dentro de
    // un objeto que Sequelize serializa a JSON: comparar '10' > 0 como string
    // funciona por coerción y comparar '10' contra 3 no.
    expect(limiteDeStockBajo({ min_stock: '10' }, UMBRAL)).toBe(10)
  })
})

describe('esStockBajo · la pregunta es «hay que reponerlo»', () => {
  it('en el mínimo exacto YA cuenta como bajo', () => {
    // `<=` y no `<`: un producto con mínimo 5 y cinco unidades ya llegó.
    expect(esStockBajo({ quantity: 5, min_stock: 5 }, UMBRAL)).toBe(true)
  })

  it('una unidad por encima del mínimo NO cuenta', () => {
    expect(esStockBajo({ quantity: 6, min_stock: 5 }, UMBRAL)).toBe(false)
  })

  it('quantity en 0 sin mínimo cargado cuenta como bajo', () => {
    expect(esStockBajo({ quantity: 0, min_stock: 0 }, UMBRAL)).toBe(true)
  })

  it('quantity negativa cuenta como bajo', () => {
    expect(esStockBajo({ quantity: -2, min_stock: 0 }, UMBRAL)).toBe(true)
  })

  it('una fila que no existe cuenta como bajo: no tener es tener cero', () => {
    // La tabla muestra `0` y no una celda vacía en la sucursal donde el
    // producto no tiene fila (FR-067), y el indicador tiene que contarlo igual.
    expect(esStockBajo(undefined, UMBRAL)).toBe(true)
  })
})

describe('el umbral entra por parámetro y no está escrito en la función', () => {
  it('llamada con umbrales distintos contesta distinto', () => {
    const fila = { quantity: 5, min_stock: 0 }

    expect(esStockBajo(fila, 3)).toBe(false)
    expect(esStockBajo(fila, 10)).toBe(true)
  })

  it('el archivo NO contiene el número del umbral fuera de los comentarios', () => {
    // Es la verificación que da sentido al parámetro. Si el 3 apareciera en el
    // código, la función seguiría pasando todos los tests de arriba y el día
    // que el servidor cambie el umbral, Inventario y Faltantes dirían números
    // distintos sobre qué falta — sin que nada fallara.
    const aqui = path.dirname(fileURLToPath(import.meta.url))
    const fuente = fs.readFileSync(path.join(aqui, 'stockBajo.js'), 'utf8')

    const codigo = fuente
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea && !linea.startsWith('//') && !linea.startsWith('*') && !linea.startsWith('/*'))

    expect(codigo.filter((linea) => /\d/.test(linea) && !/\b0\b/.test(linea))).toEqual([])
  })

  it('sin umbral utilizable NO inventa uno: cae a cero', () => {
    // Marcar de menos se nota mirando la fila; marcar de más con un número
    // inventado hace que la pantalla mienta y nadie lo pueda explicar.
    expect(limiteDeStockBajo({ min_stock: 0 }, undefined)).toBe(0)
    expect(limiteDeStockBajo({ min_stock: 0 }, 'tres')).toBe(0)
    expect(esStockBajo({ quantity: 1, min_stock: 0 }, undefined)).toBe(false)
    expect(esStockBajo({ quantity: 0, min_stock: 0 }, undefined)).toBe(true)
  })
})
