import { describe, it, expect } from 'vitest'
import { decidirTrasAceptar } from './invitacion'

/** Un error de axios con status y cuerpo, que es lo que llega al `catch`. */
const deAxios = (status, data) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data },
})

describe('un 500 del servidor NO borra el token: la invitación no se pierde porque la API estaba caída', () => {
  it('conserva el token con un 500', () => {
    // Es el caso exacto que el `.catch(() => localStorage.removeItem(…))` de
    // App.jsx tiraba a la basura: la API contestó mal una vez y la invitación se
    // perdió para siempre, sin decir nada.
    const decision = decidirTrasAceptar(deAxios(500, { error: 'Error interno del servidor' }))

    expect(decision.borrarToken).toBe(false)
  })

  it('conserva el token cuando NO hay respuesta: la red cortada o la API dormida', () => {
    // El free tier de Render tarda hasta cincuenta segundos en despertar. Sin
    // `response` no hay status, y este es el camino por el que pasa un timeout.
    const decision = decidirTrasAceptar({ message: 'Network Error' })

    expect(decision.borrarToken).toBe(false)
  })

  it('conserva el token con un 502 y con un 401, que también son transitorios', () => {
    // El 401 aparece cuando el token de Auth0 se está renovando: descartarlo
    // sería perder la invitación por un reintento que la aplicación ya hace sola.
    expect(decidirTrasAceptar(deAxios(502, {})).borrarToken).toBe(false)
    expect(decidirTrasAceptar(deAxios(401, {})).borrarToken).toBe(false)
  })

  it('y en todos esos casos dice que se va a reintentar, no que falló', () => {
    const decision = decidirTrasAceptar(deAxios(500, {}))

    expect(decision.tono).toBe('espera')
    expect(decision.mensaje.length).toBeGreaterThan(20)
  })
})

describe('los motivos definitivos SÍ descartan el token, y dicen cuál fue', () => {
  it.each([
    ['INVITACION_INEXISTENTE', 'Esa invitación no existe. Pedile a quien te invitó que te mande una nueva.'],
    ['INVITACION_VENCIDA', 'Esa invitación venció. Pedile a quien te invitó que te la reenvíe.'],
    ['INVITACION_REVOCADA', 'Esa invitación fue cancelada por la empresa.'],
    ['INVITACION_DE_OTRO_EMAIL', 'Esa invitación es para ana@ejemplo.com y entraste con juan@ejemplo.com.'],
  ])('404 %s: borra el token y muestra el mensaje del servidor', (codigo, message) => {
    const decision = decidirTrasAceptar(deAxios(404, { error: codigo, message }))

    expect(decision.borrarToken).toBe(true)
    // El mensaje es el del servidor y NO el código: `mensajeDeError` reconoce
    // que `INVITACION_VENCIDA` es un código de máquina y agarra el `message`.
    // Sin eso, el usuario leería «INVITACION_VENCIDA» adentro de un toast.
    expect(decision.mensaje).toBe(message)
    expect(decision.mensaje).not.toBe(codigo)
  })

  it('409 ya usada: borra el token, con un tono distinto del 404', () => {
    // No es un error de quien está del otro lado, y por eso no se pinta igual.
    const decision = decidirTrasAceptar(
      deAxios(409, { error: 'INVITACION_YA_USADA', message: 'Esa invitación ya se usó.' })
    )

    expect(decision.borrarToken).toBe(true)
    expect(decision.mensaje).toBe('Esa invitación ya se usó.')
    expect(decision.tono).toBe('aviso')
    expect(decision.tono).not.toBe(decidirTrasAceptar(deAxios(404, {})).tono)
  })

  it('409 miembro desactivado: borra el token y dice a quién pedirle que lo reactive', () => {
    const message = 'Tu acceso a esta empresa está desactivado. Pedile a un administrador que te vuelva a activar.'
    const decision = decidirTrasAceptar(deAxios(409, { error: 'MIEMBRO_DESACTIVADO', message }))

    expect(decision.borrarToken).toBe(true)
    expect(decision.mensaje).toBe(message)
  })
})

describe('nunca devuelve undefined, pase lo que pase', () => {
  // Un `undefined` acá lo desestructura el `useEffect` de App.jsx y revienta
  // adentro de una promesa, que es de los errores más difíciles de leer que
  // puede tener la aplicación: no hay pantalla, no hay stack útil.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['un string', 'se rompió'],
    ['un objeto vacío', {}],
    ['un error sin response', new Error('boom')],
    ['un response sin status', { response: {} }],
    ['un status que no es número', deAxios('404', {})],
  ])('%s', (_nombre, entrada) => {
    const decision = decidirTrasAceptar(entrada)

    expect(decision).toBeDefined()
    expect(typeof decision.borrarToken).toBe('boolean')
    expect(typeof decision.mensaje).toBe('string')
    expect(decision.mensaje.length).toBeGreaterThan(0)
    expect(['error', 'aviso', 'espera']).toContain(decision.tono)
  })

  it("un status '404' en texto NO se toma por definitivo", () => {
    // `error?.response?.status` de axios es un número. Si algún día llegara como
    // string y la comparación fuera `==`, un error raro pasaría por definitivo y
    // descartaría el token. Se compara con `===` a propósito.
    expect(decidirTrasAceptar(deAxios('404', {})).borrarToken).toBe(false)
  })
})
