import { describe, it, expect } from 'vitest'
import { validarOnboarding, errorDelLogo, soloDigitos } from './onboarding'

// ════════════════════════════════════════════
//  Las reglas del onboarding, sin montar nada
//
//  Lo que se afirma acá son las reglas. Que el botón no mande dos veces y que
//  el foco vaya al primer campo mal está en `tests/renderDeOnboarding.test.jsx`,
//  que necesita montar; y que dos llamadas no sean dos empresas está en la API,
//  en `onboardingIdempotente.integracion.test.js`, que es donde vive la
//  garantía.
// ════════════════════════════════════════════

const COMPLETO = {
  name: 'Panadería del Centro',
  cuit: '30-11111111-8',
  phone: '11 4567 8900',
  address: 'Av. Corrientes 1234',
  city: 'Buenos Aires',
  state: 'CABA',
}

describe('validarOnboarding', () => {
  it('un formulario completo no tiene errores', () => {
    expect(validarOnboarding(COMPLETO)).toEqual({})
  })

  it('devuelve TODOS los errores, no el primero', () => {
    // De a uno es pedirle a alguien que descubra el formulario a fuerza de
    // reintentos: manda, corrige, manda, corrige.
    const errores = validarOnboarding({})

    expect(Object.keys(errores).sort()).toEqual(
      ['address', 'city', 'name', 'phone', 'state']
    )
  })

  it('un nombre de solo espacios es un nombre vacío', () => {
    // Pasaba la validación y llegaba vacío a la API.
    expect(validarOnboarding({ ...COMPLETO, name: '   ' }).name).toBeTruthy()
  })

  it('un nombre larguísimo se corta acá y no en la base', () => {
    expect(validarOnboarding({ ...COMPLETO, name: 'a'.repeat(121) }).name).toBeTruthy()
    expect(validarOnboarding({ ...COMPLETO, name: 'a'.repeat(120) }).name).toBeUndefined()
  })

  it('el CUIT es opcional, pero si viene tiene que tener once dígitos', () => {
    expect(validarOnboarding({ ...COMPLETO, cuit: '' }).cuit).toBeUndefined()
    expect(validarOnboarding({ ...COMPLETO, cuit: '30-11111111-8' }).cuit).toBeUndefined()
    expect(validarOnboarding({ ...COMPLETO, cuit: '3011' }).cuit).toBeTruthy()
  })

  it('el CUIT se mide en dígitos, no en caracteres', () => {
    // Con guiones y con puntos son dieciséis caracteres y once dígitos. Contar
    // caracteres rechazaría el formato en el que la gente lo escribe.
    expect(validarOnboarding({ ...COMPLETO, cuit: '30.111.111.11-8' }).cuit).toBeUndefined()
  })

  it('un teléfono con menos de seis dígitos está incompleto', () => {
    expect(validarOnboarding({ ...COMPLETO, phone: '123' }).phone).toBeTruthy()
    expect(validarOnboarding({ ...COMPLETO, phone: '+54 11 4567-8900' }).phone).toBeUndefined()
  })

  it('la dirección, la ciudad y la provincia son obligatorias', () => {
    // Están marcadas con asterisco en la pantalla desde siempre. Lo que faltaba
    // era que la validación dijera lo mismo.
    expect(validarOnboarding({ ...COMPLETO, address: '' }).address).toBeTruthy()
    expect(validarOnboarding({ ...COMPLETO, city: '  ' }).city).toBeTruthy()
    expect(validarOnboarding({ ...COMPLETO, state: '' }).state).toBeTruthy()
  })
})

describe('soloDigitos', () => {
  it('deja pasar los dígitos y nada más', () => {
    expect(soloDigitos('30-11111111-8')).toBe('30111111118')
    expect(soloDigitos('+54 11 4567-8900')).toBe('541145678900')
    expect(soloDigitos(null)).toBe('')
    expect(soloDigitos(undefined)).toBe('')
  })
})

describe('errorDelLogo', () => {
  const archivo = (tipo, bytes) => ({ type: tipo, size: bytes })

  it('sin archivo no hay error: el logo es opcional', () => {
    expect(errorDelLogo(null)).toBeNull()
  })

  it('acepta los cinco tipos que acepta la API', () => {
    for (const tipo of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']) {
      expect(errorDelLogo(archivo(tipo, 1024))).toBeNull()
    }
  })

  it('rechaza un tipo que la API no acepta', () => {
    expect(errorDelLogo(archivo('application/pdf', 1024))).toMatch(/PNG, JPG/)
  })

  it('el techo es el mismo que el de multer: 300 KB', () => {
    // Si los dos números se separan, el navegador deja subir algo que la API
    // rechaza después de transferirlo entero.
    expect(errorDelLogo(archivo('image/png', 300 * 1024))).toBeNull()
    expect(errorDelLogo(archivo('image/png', 300 * 1024 + 1))).toMatch(/300 KB/)
  })
})
