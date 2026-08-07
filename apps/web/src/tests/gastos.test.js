import { describe, it, expect } from 'vitest'
import { agruparGastosPorSucursal, CLAVE_GENERAL, desplazarMes, nombreDelMes } from '@/utils/gastos'

// ════════════════════════════════════════════
//  ADMINAPP · El reparto de los gastos fijos
//
//  Lo que se afirma acá son **los dos invariantes**, no tres casos elegidos a
//  mano, y el motivo es que los dos defectos que esta función viene a cerrar
//  —el que descarta un gasto y el que lo cuenta dos veces— pasan un caso
//  elegido a mano según cuál se elija:
//
//   · el filtro viejo `e.punto_de_venta_id === pv.id || e.group === 'gf' + i`
//     mete el gasto de `'gf1'` en la PRIMERA sucursal **y además** lo dejaba
//     fuera de «General»: con dos sucursales «se ve», con una desaparece;
//   · y si alguien lo «arregla» agregándolo también a «General», el gasto pasa
//     a estar en dos grupos y el total general se cuenta de más.
//
//  La suma y la unicidad detectan los dos, sobre cualquier lista.
// ════════════════════════════════════════════

const CENTRO = { id: 1, name: 'Ortiz de Ocampo' }
const NORTE = { id: 2, name: 'Uriburu' }

/** La suma de una lista de gastos, en centavos enteros. */
function centavos(gastos) {
  return gastos.reduce((total, g) => total + Math.round((Number(g.amount) || 0) * 100), 0)
}

/**
 * Un generador determinista, para que la propiedad se pruebe sobre muchas
 * listas y el fallo sea siempre el mismo.
 *
 * Sin semilla fija, un test de propiedad que falla una vez cada cien corridas es
 * un test que alguien vuelve a correr hasta que pasa.
 */
function generador(semilla) {
  let estado = semilla

  return () => {
    estado = (estado * 1103515245 + 12345) % 2147483648
    return estado / 2147483648
  }
}

/**
 * Listas de gastos con las cuatro formas que existen en la base de hoy:
 * con sucursal, sin sucursal, con `group` del legacy, y con una sucursal que
 * ya no está en la lista de la empresa.
 */
function listaCualquiera(azar, cuantos) {
  const sucursalPosible = [1, 2, null, null, 7, undefined]
  const grupoPosible = ['gf1', 'gf2', 'pv_1', 'pv_2', null]

  return Array.from({ length: cuantos }, (_, i) => ({
    id: i + 1,
    name: `Gasto ${i + 1}`,
    // Importes con centavos que no cierran solos: 0,1 + 0,2 en punto flotante
    // da 0,30000000000000004, así que la suma se compara en centavos.
    amount: (Math.floor(azar() * 100000) / 100 + 0.1).toFixed(2),
    punto_de_venta_id: sucursalPosible[Math.floor(azar() * sucursalPosible.length)],
    group: grupoPosible[Math.floor(azar() * grupoPosible.length)],
  }))
}

describe('agruparGastosPorSucursal reparte sin perder ni duplicar', () => {
  it('ningún gasto fijo queda afuera de todos los grupos', () => {
    const azar = generador(20260806)

    for (let corrida = 0; corrida < 40; corrida++) {
      const gastos = listaCualquiera(azar, 1 + Math.floor(azar() * 25))
      const grupos = agruparGastosPorSucursal(gastos, [CENTRO, NORTE])

      const repartidos = grupos.flatMap((g) => g.gastos)

      // La suma es la afirmación de FR-020: «la suma de lo que la pantalla
      // dibuja DEBE ser el total de `fixed_expenses` de la empresa». En
      // centavos, porque en pesos 0,1 + 0,2 no da 0,3.
      expect(centavos(repartidos)).toBe(centavos(gastos))
      expect(repartidos).toHaveLength(gastos.length)
    }
  })

  it('ningún gasto fijo aparece en más de un grupo', () => {
    const azar = generador(777)

    for (let corrida = 0; corrida < 40; corrida++) {
      const gastos = listaCualquiera(azar, 1 + Math.floor(azar() * 25))
      const grupos = agruparGastosPorSucursal(gastos, [CENTRO, NORTE])

      const ids = grupos.flatMap((g) => g.gastos.map((e) => e.id))

      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('El reparto sale de punto_de_venta_id y NO de group', () => {
  it('un gasto con group="gf2" y sin sucursal va a General, no a la segunda sucursal', () => {
    // Es el gasto que produce `scripts/migrar-legacy.js:379` y el que hoy
    // Comprafit tiene cargado. El filtro viejo lo metía en la sucursal cuyo
    // índice coincidía con el número del grupo.
    const gasto = { id: 5, name: 'Alquiler', amount: '180000.00', punto_de_venta_id: null, group: 'gf2' }

    const grupos = agruparGastosPorSucursal([gasto], [CENTRO, NORTE])

    const general = grupos.find((g) => g.clave === CLAVE_GENERAL)
    const segunda = grupos.find((g) => g.id === NORTE.id)

    expect(general.gastos).toEqual([gasto])
    expect(segunda.gastos).toEqual([])
  })

  it('con UNA sola sucursal, el gasto de «gf1» sin sucursal tampoco desaparece', () => {
    // El caso de Comprafit, y el que hacía invisible la plata: con una sucursal
    // el `indexOf` daba 0, el grupo buscado era `'gf0'` y no coincidía con
    // nada, mientras `!e.group?.startsWith('gf')` lo sacaba de «General».
    const gasto = { id: 9, name: 'Sueldos', amount: '400000.00', punto_de_venta_id: null, group: 'gf1' }

    const grupos = agruparGastosPorSucursal([gasto], [CENTRO])

    expect(grupos.find((g) => g.clave === CLAVE_GENERAL).gastos).toEqual([gasto])
    expect(grupos.flatMap((g) => g.gastos)).toHaveLength(1)
  })

  it('un gasto colgado de una sucursal que ya no está en la lista tampoco se pierde', () => {
    // `empresaActiva.puntosDeVenta` puede no traer una sucursal dada de baja.
    // Descartarlo sería el mismo defecto con otra causa, y meterlo en «General»
    // sería afirmar que no tiene sucursal, que es falso.
    const gasto = { id: 3, name: 'Expensas', amount: '12000.00', punto_de_venta_id: 7, group: 'pv_7' }

    const grupos = agruparGastosPorSucursal([gasto], [CENTRO])

    const suyo = grupos.find((g) => g.id === 7)

    expect(suyo.gastos).toEqual([gasto])
    expect(suyo.conocida).toBe(false)
    expect(grupos.find((g) => g.clave === CLAVE_GENERAL).gastos).toEqual([])
  })
})

describe('Los grupos existen aunque estén vacíos', () => {
  it('«General» tiene su grupo aunque ningún gasto esté sin sucursal (FR-023)', () => {
    // Sin esto, la tarjeta de «General» aparecería y desaparecería según los
    // datos, y la pantalla tendría que filtrar los grupos por su nombre — que es
    // exactamente lo que FR-023 prohíbe.
    const grupos = agruparGastosPorSucursal(
      [{ id: 1, name: 'Luz', amount: '100.00', punto_de_venta_id: 1 }],
      [CENTRO]
    )

    expect(grupos.map((g) => g.clave)).toEqual(['pv-1', CLAVE_GENERAL])
  })

  it('«General» va SIEMPRE al final, después de las sucursales', () => {
    const grupos = agruparGastosPorSucursal([], [CENTRO, NORTE])

    expect(grupos.map((g) => g.clave)).toEqual(['pv-1', 'pv-2', CLAVE_GENERAL])
  })

  it('sin gastos y sin sucursales queda solo «General»', () => {
    expect(agruparGastosPorSucursal().map((g) => g.clave)).toEqual([CLAVE_GENERAL])
  })
})

// ════════════════════════════════════════════
//  El mes de los gastos variables
//
//  Las dos funciones salieron de adentro de `components/GastosVariables.jsx`,
//  donde eran el camino por el que la pantalla esquivaba la guardia de formato:
//  `nombreDelMes` llamaba a `toLocaleDateString('es-AR', …)` en línea.
// ════════════════════════════════════════════

describe('nombreDelMes escribe el mes sin depender del navegador', () => {
  it('NO usa los datos de localización del entorno: julio es «julio» siempre', () => {
    // `toLocaleDateString('es-AR', { month: 'long' })` depende de qué datos de
    // localización traiga el runtime: el mismo mes salía «julio» en un lado y
    // «July» en un Node compilado con ICU chico. Doce palabras escritas una vez
    // no dependen de nada.
    expect(nombreDelMes('2026-07')).toBe('julio 2026')
    expect(nombreDelMes('2026-01')).toBe('enero 2026')
    expect(nombreDelMes('2026-12')).toBe('diciembre 2026')
  })

  it('un mes fuera de rango devuelve algo legible y no «undefined 2026»', () => {
    expect(nombreDelMes('2026-13')).toBe('2026-13')
    expect(nombreDelMes('')).toBe('—')
    expect(nombreDelMes(undefined)).toBe('—')
  })
})

describe('desplazarMes es aritmética de enteros, sin zona horaria', () => {
  it('cruza el año para atrás y para adelante', () => {
    // Los dos casos de borde: enero menos uno y diciembre más uno. Con
    // `new Date(anio, mes - 1 + delta, 1)` andaban, pero metían una zona horaria
    // en una cuenta que es de doce meses por año y nada más.
    expect(desplazarMes('2026-01', -1)).toBe('2025-12')
    expect(desplazarMes('2026-12', 1)).toBe('2027-01')
  })

  it('el mes queda con dos dígitos, que es lo que el servidor valida', () => {
    // `GET /api/gastos-variables` exige YYYY-MM con el mes en dos dígitos
    // (`MES_VALIDO` en `routes/gastosVariables.js`): un «2026-9» sería un 400.
    expect(desplazarMes('2026-10', -1)).toBe('2026-09')
    expect(desplazarMes('2026-08', 0)).toBe('2026-08')
  })

  it('con un mes ilegible devuelve lo que recibió en vez de «NaN-NaN»', () => {
    expect(desplazarMes('', -1)).toBe('')
    expect(desplazarMes(undefined, 1)).toBe(undefined)
  })
})
