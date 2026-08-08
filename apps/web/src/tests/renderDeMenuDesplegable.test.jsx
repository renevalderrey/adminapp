import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MenuDesplegable from '@/components/MenuDesplegable'

// ════════════════════════════════════════════
//  ADMINAPP · El menú que se abre desde un botón
//
//  ── El defecto ──
//
//  Había dos `<details>` usados como menú, los dos en Inventario, y arriba de
//  uno estaba escrito: «es un `<details>` y no un popover para no arrastrar otro
//  componente: **el navegador ya resuelve abrir, cerrar y el teclado**».
//
//  La primera mitad es cierta. La segunda no: `<details>` **no cierra al hacer
//  clic afuera** ni **con Escape**. El menú de Exportar quedaba flotando arriba
//  de la tabla tapando filas mientras la persona seguía trabajando, y Escape
//  —lo primero que hace cualquiera que abrió algo por error— no hacía nada.
//
//  ⚠ El motivo escrito para no traer una librería era correcto. La conclusión
//  no: no hacía falta un componente de terceros, hacían falta las tres líneas
//  que el navegador no pone. Es la clase de comentario que hace que nadie vuelva
//  a mirar el problema, porque afirma que ya está resuelto.
// ════════════════════════════════════════════

/** Un menú con un botón afuera, para poder hacerle clic. */
function Pantalla() {
  return (
    <div>
      <button>afuera</button>
      <MenuDesplegable claseDelBoton="boton" boton={<span>Exportar</span>}>
        <button>Excel</button>
      </MenuDesplegable>
    </div>
  )
}

const menu = () => document.querySelector('details')

/** Lo abre como lo abre una persona: apretando el botón. */
function abrir() {
  fireEvent.click(screen.getByText('Exportar'))
  // jsdom no implementa el comportamiento nativo del `summary`, así que el
  // estado se pone a mano. Lo que se prueba es el CIERRE, que es lo que estaba
  // roto; abrir ya funcionaba.
  menu().open = true
}

afterEach(() => cleanup())

describe('El menú se cierra como espera quien lo abrió', () => {
  it('un clic afuera lo cierra', () => {
    render(<Pantalla />)
    abrir()

    expect(menu().open).toBe(true)

    fireEvent.mouseDown(screen.getByText('afuera'))

    expect(menu().open).toBe(false)
  })

  it('Escape lo cierra', () => {
    render(<Pantalla />)
    abrir()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(menu().open).toBe(false)
  })

  it('y Escape devuelve el foco al botón que lo abrió', () => {
    // Sin esto, cerrar con Escape deja el foco en la nada y el próximo Tab
    // arranca desde el principio de la página.
    render(<Pantalla />)
    abrir()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(menu().querySelector('summary'))
  })

  it('un clic ADENTRO no lo cierra', () => {
    // El contra-caso, y el que un «cerrar con cualquier clic» rompería: el menú
    // de columnas tiene casillas que se marcan de a una, y cerrarse en la
    // primera obligaría a reabrirlo por cada sucursal.
    render(<Pantalla />)
    abrir()

    fireEvent.mouseDown(screen.getByText('Excel'))

    expect(menu().open).toBe(true)
  })

  it('otra tecla NO lo cierra', () => {
    // Sin este caso, un `keydown` que cerrara con cualquier tecla pasaría el de
    // Escape, y el menú se cerraría al tabular adentro.
    render(<Pantalla />)
    abrir()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(menu().open).toBe(true)
  })

  it('se anuncia como menú, y no como «detalles»', () => {
    // Con un lector de pantalla, un `<details>` pelado se anuncia «grupo de
    // detalles»: no dice que hay opciones para elegir.
    render(<Pantalla />)
    abrir()

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
