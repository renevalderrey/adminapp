import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { render, screen } from '@testing-library/react'
import MarcoDePantalla from '@/components/MarcoDePantalla'

// ════════════════════════════════════════════
//  Ninguna pantalla se quedó sin el marco de 1320px
//
//  `App.jsx` envolvía las dieciocho pantallas en un solo `<div>`. Al sacarlo
//  para que el punto de venta pueda ocupar el alto completo, el riesgo cambió
//  de lado: un error acá NO rompe el punto de venta, rompe **todo lo demás** —
//  diecisiete pantallas pegadas al borde de la ventana, sin padding y sin tope
//  de ancho.
//
//  Y `npm run build` no lo ve: es JSX válido.
//
//  Es una guardia estática y no un test de render porque lo que hay que
//  verificar es que **no falte ninguna de diecisiete**, y montar diecisiete
//  pantallas en jsdom para eso cuesta más de lo que atrapa. Lo que este test no
//  puede ver —que el padding se vea igual— es el paso manual 5 de la
//  verificación.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(AQUI, '..')

const APP = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
const MARCO = fs.readFileSync(path.join(SRC, 'components/MarcoDePantalla.jsx'), 'utf8')

/**
 * Las rutas que dibujan una pantalla, con el texto de su `element`.
 *
 * Se mira SOLO lo que está adentro del `<main>`: el `<Route path="*">` del
 * onboarding vive en otro bloque, fuera del shell, y nunca tuvo marco.
 *
 * Las que son un `<Navigate>` puro quedan afuera: son alias de URL y no
 * dibujan nada, así que envolverlas en el marco sería un `<div>` vacío.
 */
function rutasConPantalla() {
  const desde = APP.indexOf('<main')
  const hasta = APP.indexOf('</main>')

  expect(desde).toBeGreaterThan(-1)
  expect(hasta).toBeGreaterThan(desde)

  return APP.slice(desde, hasta)
    .split('\n')
    .map((linea, i) => ({ n: i + 1, texto: linea.trim() }))
    // `<Route ` con el espacio: `<Route` a secas también matchea `<Routes>`, y
    // esa línea entraba a la lista como una ruta sin `path`.
    .filter(({ texto }) => /^<Route\s/.test(texto))
    .map(({ texto }) => ({ ruta: (texto.match(/path="([^"]+)"/) || [])[1], texto }))
    .filter(({ texto }) => !/element=\{\s*<Navigate\b/.test(texto))
}

/**
 * Las rutas que NO usan el marco, declaradas una por una.
 *
 * Si mañana alguien saca otra pantalla del marco, tiene que venir acá y
 * escribirla. Una excepción no declarada deja de ser una excepción: es un
 * olvido que se ve recién cuando alguien abre esa pantalla.
 */
const EXCEPCIONES = ['/pos']

describe('El marco de 1320px se aplica ruta por ruta', () => {
  it('ninguna pantalla se quedó sin el marco de 1320px al sacarlo de App.jsx', () => {
    const rutas = rutasConPantalla()

    // Si el parseo no encontró nada, este test pasaría sin mirar nada.
    expect(rutas.length).toBeGreaterThanOrEqual(18)

    const sinMarco = rutas
      .filter(({ ruta }) => !EXCEPCIONES.includes(ruta))
      .filter(({ texto }) => !texto.includes('<MarcoDePantalla>'))
      .map(({ ruta }) => ruta)

    expect(sinMarco).toEqual([])
  })

  it('/pos es la única excepción, y está declarada', () => {
    const rutas = rutasConPantalla()

    const fueraDelMarco = rutas
      .filter(({ texto }) => !texto.includes('<MarcoDePantalla>'))
      .map(({ ruta }) => ruta)

    // Los dos sentidos: la lista escrita es exactamente la que hay en el
    // archivo, y tiene un solo elemento.
    expect(fueraDelMarco).toEqual(EXCEPCIONES)
    expect(EXCEPCIONES).toHaveLength(1)
  })

  it('el punto de venta ocupa el alto completo en vez del marco', () => {
    const pos = rutasConPantalla().find(({ ruta }) => ruta === '/pos')

    expect(pos).toBeDefined()
    expect(pos.texto).toContain('h-full')
  })
})

describe('El scroll se mudó del <main> al marco', () => {
  it('el <main> del shell ya NO scrollea', () => {
    // Si conservara su `overflow-y-auto`, el punto de venta haría scrollear la
    // página entera además de sus dos zonas internas (FR-002).
    const main = APP.split('\n').find((l) => l.trim().startsWith('<main'))

    expect(main).toBeDefined()
    expect(main).toContain('overflow-hidden')
    expect(main).not.toContain('overflow-y-auto')
  })

  it('el marco quedó con el ancho, el padding y su propio scroll', () => {
    expect(MARCO).toContain('max-w-[1320px]')
    expect(MARCO).toContain('px-5')
    expect(MARCO).toContain('py-7')
    expect(MARCO).toContain('lg:px-9')
    expect(MARCO).toContain('lg:py-8')
    expect(MARCO).toContain('overflow-y-auto')
    expect(MARCO).toContain('h-full')
  })

  it('el marco NO quedó también en App.jsx: una sola definición', () => {
    // Dos contenedores de 1320px anidados duplican el padding y nadie relaciona
    // las dos cosas.
    expect(APP).not.toContain('max-w-[1320px]')
  })
})

describe('El marco dibuja lo que le pasan', () => {
  // ⚠ Este archivo es `.js` y Vite NO transforma JSX en `.js`, así que el
  // render va con `React.createElement`. Un `.jsx` acá obligaría a renombrarlo
  // y el resto del archivo es una guardia estática que no necesita nada de eso.
  const conContenido = () =>
    render(
      React.createElement(
        MarcoDePantalla,
        null,
        React.createElement('p', null, 'El contenido de la pantalla')
      )
    )

  it('las diecisiete pantallas NO quedan en blanco', () => {
    // La guardia estática de arriba no puede ver esto: un `MarcoDePantalla` que
    // devolviera `null` —que es como se creó en T1115— seguiría teniendo las
    // clases escritas en el archivo y las diecisiete rutas seguirían diciendo
    // `<MarcoDePantalla>`. Lo único que pasaría es que la aplicación entera se
    // vería vacía.
    conContenido()

    expect(screen.getByText('El contenido de la pantalla')).toBeInTheDocument()
  })

  it('el que scrollea NO es el contenedor de 1320px, que dejaba franjas muertas a los costados', () => {
    // El marco son DOS capas y el orden importa. Cuando eran una sola —el
    // `mx-auto max-w-[1320px] overflow-y-auto` con el que quedó el hito 5—, en
    // un monitor de 1920px el contenedor de scroll iba de x=420 a x=1740
    // mientras `<main>` iba de x=240 a x=1920: **180px de cada lado en los que
    // la rueda del mouse no scrolleaba nada**, y la barra flotando en el medio
    // de la pantalla en vez de en el borde de la ventana. Medido con la rueda
    // en x=1880: `scrollTop` no se movía.
    //
    // Este caso fija la forma; la geometría la verifica
    // `pruebas-de-navegador/marcoDeLasPantallas.navegador.js`, porque jsdom no
    // tiene motor de maquetado y acá no se puede afirmar dónde queda nada.
    conContenido()

    const centrado = screen.getByText('El contenido de la pantalla').parentElement
    const queScrollea = centrado.parentElement

    // El de adentro centra y pone el padding, y NO scrollea.
    expect(centrado).toHaveClass('mx-auto')
    expect(centrado).toHaveClass('max-w-[1320px]')
    expect(centrado).not.toHaveClass('overflow-y-auto')

    // El de afuera scrollea y no tiene tope de ancho: ocupa el ancho completo
    // de `<main>`, que es lo que hace que la rueda funcione en cualquier punto
    // de la pantalla.
    expect(queScrollea).toHaveClass('overflow-y-auto')
    expect(queScrollea).toHaveClass('h-full')
    expect(queScrollea).not.toHaveClass('max-w-[1320px]')
  })
})
