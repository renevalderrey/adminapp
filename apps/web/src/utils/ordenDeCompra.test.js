import { describe, it, expect } from 'vitest'
import {
  ESTADOS,
  SEGMENTOS,
  porcentajeRecibido,
  esRecibible,
  esAnulable,
  filtrarOrdenes,
  contadoresPorSegmento,
} from './ordenDeCompra'

// ════════════════════════════════════════════
//  Lo que se decide a partir del estado de una orden de compra
//
//  Cada test nombra el defecto que evita. Los tres que más caro salen:
//  una orden vacía dibujada como «recibida», una búsqueda que solo mira el
//  nombre del proveedor cuando lo que se tiene a mano es el número, y un
//  contador que no coincide con la lista que está abajo.
// ════════════════════════════════════════════

/** Una orden mínima; cada test le pisa lo que le importa. */
const orden = (extra = {}) => ({
  id: 1,
  supplier_name: 'Nutrifit',
  status: 'pending',
  detail: [],
  ...extra,
})

describe('porcentajeRecibido cuenta unidades y no promesas', () => {
  it('una orden sin ítems NO dice 100% recibida', () => {
    // El reflejo es escribirlo con un `.every`, y `[].every(...)` da `true` por
    // vacuidad: una orden vacía —o una a la que todavía no le llegó el detalle—
    // se dibujaría con la barra llena y la etiqueta «recibida».
    expect(porcentajeRecibido(orden({ detail: [] }))).toBe(0)
    expect(porcentajeRecibido(orden({ detail: undefined }))).toBe(0)
    expect(porcentajeRecibido(undefined)).toBe(0)
  })

  it('recibir más de lo pedido NO pasa del 100%', () => {
    // Y el recorte es POR LÍNEA: 20 de 10 de un producto y 0 de 10 del otro es
    // media orden. Con el recorte hecho sobre el total, la barra diría 100 % y
    // la mitad que falta no la vería nadie.
    const excedida = orden({
      detail: [
        { product_id: 1, quantity: 10, quantity_received: 20 },
        { product_id: 2, quantity: 10, quantity_received: 0 },
      ],
    })

    expect(porcentajeRecibido(excedida)).toBe(50)

    const todaExcedida = orden({
      detail: [{ product_id: 1, quantity: 10, quantity_received: 99 }],
    })

    expect(porcentajeRecibido(todaExcedida)).toBe(100)
  })

  it('NO redondea para arriba: 199 de 200 unidades son 99% y no 100%', () => {
    // La barra llena y la etiqueta «Recibida» son la misma afirmación: que no
    // falta nada. Un redondeo hacia arriba la vuelve mentira por una unidad.
    const casiEntera = orden({
      detail: [{ product_id: 1, quantity: 200, quantity_received: 199 }],
    })

    expect(porcentajeRecibido(casiEntera)).toBe(99)
  })

  it('una línea de cantidad cero NO deja el porcentaje en NaN', () => {
    // Dividir por un denominador cero da Infinity, y `width: Infinity%` es una
    // barra que no se dibuja: la pantalla queda sin decir nada.
    const enCero = orden({
      detail: [{ product_id: 1, quantity: 0, quantity_received: 0 }],
    })

    expect(porcentajeRecibido(enCero)).toBe(0)
  })

  it('lee las líneas que el listado nombra items, y no solo detail', () => {
    // El modelo guarda `detail` y la API lo serializa como `items`
    // (`purchaseService.js:599`). La tabla de órdenes consume el listado tal
    // cual: si esta función solo mirara `detail`, la barra quedaría en 0 % para
    // todas las filas y nada fallaría.
    const delListado = {
      id: 7,
      status: 'partial',
      items: [{ product_id: 1, quantity: 4, quantity_received: 1 }],
    }

    expect(porcentajeRecibido(delListado)).toBe(25)
  })
})

describe('Qué se puede hacer con una orden según su estado', () => {
  it('una orden anulada no es recibible ni anulable', () => {
    expect(esRecibible({ status: 'cancelled' })).toBe(false)
    expect(esAnulable({ status: 'cancelled' })).toBe(false)
  })

  it('una orden recibida no se recibe de nuevo ni se anula', () => {
    // Anular una orden ya recibida borraría el respaldo de una deuda que existe
    // y de un stock que entró.
    expect(esRecibible({ status: 'received' })).toBe(false)
    expect(esAnulable({ status: 'received' })).toBe(false)
  })

  it('una orden pendiente es recibible y anulable', () => {
    expect(esRecibible({ status: 'pending' })).toBe(true)
    expect(esAnulable({ status: 'pending' })).toBe(true)
  })

  it('una orden parcial SIGUE siendo recibible y anulable', () => {
    // Las dos mitades del mismo olvido: la condición escrita a mano en las
    // pantallas es `status === 'pending'`, y con ella una orden a medias se
    // queda sin botón de recibir —lo que falta no llega nunca— y sin botón de
    // anular. `anulable: true` acá es [PENDIENTE 9]: la deuda de lo ya recibido
    // queda viva y la pantalla lo dice antes de confirmar.
    expect(esRecibible({ status: 'partial' })).toBe(true)
    expect(esAnulable({ status: 'partial' })).toBe(true)
  })

  it('un estado desconocido no habilita nada', () => {
    // Si el modelo gana un estado que la web no conoce, lo que no puede pasar
    // es que la pantalla ofrezca recibir algo que el servidor va a rechazar.
    expect(esRecibible({ status: 'draft' })).toBe(false)
    expect(esAnulable({})).toBe(false)
  })
})

describe('La lista que muestra cada segmento', () => {
  const ORDENES = [
    { id: 11, supplier_name: 'Nutrifit', status: 'pending' },
    { id: 12, supplier_name: 'Distribuidora Sur', status: 'partial' },
    { id: 13, supplier_name: 'Nutrifit', status: 'received' },
    { id: 14, supplier_name: 'Insumos Norte', status: 'cancelled' },
  ]

  it('la búsqueda encuentra por número de orden y no solo por proveedor', () => {
    // El número es el dato que el proveedor menciona por teléfono. Buscando
    // solo por nombre hay que recorrer la lista a ojo con el número en la mano.
    expect(filtrarOrdenes(ORDENES, { busqueda: '13' }).map((o) => o.id)).toEqual([13])

    // Y con el `#` que se lleva puesto quien copia «Orden #12» de la pantalla.
    expect(filtrarOrdenes(ORDENES, { busqueda: '#12' }).map((o) => o.id)).toEqual([12])

    // El nombre sigue funcionando, sin distinguir mayúsculas.
    expect(filtrarOrdenes(ORDENES, { busqueda: 'nutri' }).map((o) => o.id)).toEqual([11, 13])
  })

  it('«Todas» incluye las anuladas', () => {
    // Esconderlas haría desaparecer la orden al anularla, y el usuario no
    // tendría cómo comprobar que la anuló.
    expect(filtrarOrdenes(ORDENES, { segmento: 'todas' })).toHaveLength(4)
  })

  it('el contador de cada segmento cuenta lo que el segmento muestra', () => {
    // Con una búsqueda puesta: un contador calculado sobre la lista entera dice
    // 4 arriba de una lista de 2, y el usuario concluye que la pantalla se está
    // comiendo filas.
    const busqueda = 'Nutrifit'
    const contadores = contadoresPorSegmento(ORDENES, { busqueda })

    for (const segmento of SEGMENTOS) {
      const visibles = filtrarOrdenes(ORDENES, { segmento: segmento.clave, busqueda })
      expect(contadores[segmento.clave]).toBe(visibles.length)
    }

    // Y el contador tiene que estar mirando la búsqueda de verdad: sin este
    // ancla, un contador que ignora el filtro y una lista vacía también
    // «coinciden» si la comparación se hace contra la lista sin filtrar.
    expect(contadores.todas).toBe(2)
    expect(contadores.recibidas).toBe(1)
  })

  it('una lista vacía o ausente NO rompe los contadores', () => {
    expect(contadoresPorSegmento(undefined)).toEqual({
      todas: 0,
      pendientes: 0,
      parciales: 0,
      recibidas: 0,
    })
  })
})

describe('Los cuatro estados dicen cómo se leen', () => {
  it('ningún estado se dibujaría con el código crudo', () => {
    // Es lo que pasó con `tc3`: una etiqueta que falta no hace fallar nada, se
    // muestra la clave. Acá el que falte queda dicho en este test.
    for (const [clave, estado] of Object.entries(ESTADOS)) {
      expect(estado.etiqueta, `${clave} sin etiqueta`).toBeTruthy()
      expect(estado.etiqueta).not.toBe(clave)
      expect(['neutro', 'warn', 'ok']).toContain(estado.tono)
    }
  })
})
