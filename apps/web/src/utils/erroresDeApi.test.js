import { describe, it, expect } from 'vitest'
import { mensajeDeError, MENSAJE_GENERICO } from './erroresDeApi'

// ════════════════════════════════════════════
//  El aviso que ve el usuario cuando la API dice que no
//
//  Lo que ve hoy es «Request failed with status code 500», cuatro veces en
//  `Orders.jsx` (`:107`, `:118`, `:133`, `:185`), y nada de nada en
//  `PurchaseOrders.jsx`, donde tres `catch` hacen `console.error` y siguen.
//  FR-095 y criterio de éxito 14.
// ════════════════════════════════════════════

/**
 * Un error como el que arma axios: el `message` inútil afuera y, si hubo
 * respuesta, el cuerpo del servidor adentro de `response.data`.
 */
function errorDeAxios(status, data) {
  const err = new Error(`Request failed with status code ${status}`)
  err.name = 'AxiosError'
  err.response = { status, data }
  return err
}

describe('mensajeDeError · lo que se le muestra al usuario', () => {
  it('NO le muestra al usuario Request failed with status code 500', () => {
    // El caso exacto de `Orders.jsx:118`: la recepción falla, el servidor
    // manda su mensaje en castellano, y lo que llegaba al toast era la frase
    // de axios porque la pantalla leía `err.message`.
    const err = errorDeAxios(500, {
      ok: false,
      error: 'Error al recibir la orden de compra (código: a1b2c3d4)',
      requestId: 'a1b2c3d4-9f2e',
    })

    const aviso = mensajeDeError(err, 'No se pudo recibir la orden.')

    expect(aviso).toBe('Error al recibir la orden de compra (código: a1b2c3d4)')
    expect(aviso).not.toContain('Request failed')

    // Y tampoco cuando el servidor no mandó nada útil: ahí va el genérico, que
    // sigue sin ser la frase de axios.
    expect(mensajeDeError(errorDeAxios(500, {}), 'No se pudo recibir la orden.'))
      .toBe('No se pudo recibir la orden.')
  })

  it('prefiere el error del servidor sobre el message genérico', () => {
    // «La orden ya fue recibida completa» sabe cuál es la orden. `Bad Request`
    // no sabe nada: es el texto del status, y es lo que quedaría si el orden
    // de lectura se invirtiera.
    const err = errorDeAxios(409, {
      ok: false,
      error: 'La orden ya fue recibida completa',
      message: 'Bad Request',
    })

    expect(mensajeDeError(err, 'No se pudo recibir la orden.'))
      .toBe('La orden ya fue recibida completa')
  })

  it('NO le muestra al usuario LINEA_REQUERIDA teniendo el mensaje legible al lado', () => {
    // ⚠ Este caso no estaba en la tarea y aparece por el corte 1 de este mismo
    // hito: `routes/suppliers.js:36-45` responde los errores de cuerpo con el
    // CÓDIGO en `error` —para que la pantalla decida sin parsear castellano— y
    // el texto para el usuario en `message`. Leer `error` a ciegas pone
    // «LINEA_REQUERIDA» adentro del toast, que no es la frase de axios pero es
    // igual de ilegible, y FR-095 pide un aviso legible.
    const err = errorDeAxios(400, {
      ok: false,
      error: 'LINEA_REQUERIDA',
      message: 'La orden tiene dos líneas de «Colágeno 300g», así que no alcanza '
        + 'con decir qué producto llegó: hay que decir qué línea.',
    })

    const aviso = mensajeDeError(err, 'No se pudo recibir la orden.')

    expect(aviso).toContain('dos líneas de «Colágeno 300g»')
    expect(aviso).not.toContain('LINEA_REQUERIDA')

    // Y el mismo caso del filtro de órdenes, que responde igual (`:424`).
    expect(mensajeDeError(errorDeAxios(400, {
      error: 'FILTRO_INVALIDO',
      message: 'El filtro de proveedor tiene que ser un número. Elegí «Todos» para no filtrar.',
    }))).not.toContain('FILTRO_INVALIDO')
  })

  it('un error sin respuesta —la red caída— dice algo legible', () => {
    // Sin `response` no hay cuerpo que leer. Lo único honesto es decir qué se
    // estaba intentando hacer; lo que NO puede pasar es que se cuele
    // «Network Error», que es tan del sistema como la frase de axios.
    const err = new Error('Network Error')
    err.name = 'AxiosError'
    err.code = 'ERR_NETWORK'

    const aviso = mensajeDeError(err, 'No se pudo cargar la lista de proveedores.')

    expect(aviso).toBe('No se pudo cargar la lista de proveedores.')
    expect(aviso).not.toContain('Network Error')
  })

  it('un error sin nada adentro no devuelve undefined', () => {
    // Un toast vacío es un fallo en silencio con más pasos, que es justamente
    // lo que el criterio 14 viene a cerrar. Los cuatro casos tienen que dar una
    // frase.
    for (const roto of [undefined, null, {}, errorDeAxios(500, null)]) {
      const aviso = mensajeDeError(roto)
      expect(typeof aviso).toBe('string')
      expect(aviso).toBe(MENSAJE_GENERICO)
    }
  })

  it('un error en blanco NO deja el aviso vacío', () => {
    // `error: ''` y `error: '   '` existen: es lo que devuelve un handler que
    // arma el cuerpo con una variable que quedó sin asignar. Sin el recorte, el
    // toast sale en blanco y la operación falla sin decirlo.
    expect(mensajeDeError(errorDeAxios(500, { error: '', message: '  ' }), 'No se pudo guardar el pago.'))
      .toBe('No se pudo guardar el pago.')

    // Y un genérico en blanco tampoco puede vaciarlo.
    expect(mensajeDeError(errorDeAxios(500, {}), '   ')).toBe(MENSAJE_GENERICO)
  })
})
