import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'

// ════════════════════════════════════════════
//  FAVALIO · La fila de una tabla, con teclado
//
//  ── El defecto ──
//
//  `Fila` era un `<div>` con `onClick`: **sin `role`, sin `tabIndex` y sin
//  `onKeyDown`**. Abrir el detalle de una venta, un producto, un gasto, una
//  orden, un miembro o una variante de TiendaNube era **exclusivamente con
//  mouse, en seis pantallas**. En `pages/` y `components/` enteros no había un
//  solo `tabIndex`.
//
//  ⚠ **Y el repositorio lo sabía.** `pages/Orders.jsx` justifica que su lista de
//  proveedores sean `<button>` reales diciendo textual «encima le da teclado
//  gratis, **que las filas de grid no tienen**». Estaba escrito como ventaja de
//  una excepción, nunca como defecto del patrón.
//
//  ── Por qué cinco lentes de coherencia no lo vieron ──
//
//  Porque las cinco comparan pantalla contra pantalla. Encontraron
//  `role="alert"` y `disabled:pointer-events-none` —que también son
//  accesibilidad— pero llegaron por «esta pantalla difiere de aquélla», no por
//  «esto no se puede usar sin mouse».
//
//  **Una lente de coherencia es ciega a lo que está mal en las doce por igual.**
//  Es el hallazgo de método más grande del hito, y por eso esta prueba existe
//  aparte: lo que verifica no es que las pantallas coincidan, es que la fila
//  funcione.
// ════════════════════════════════════════════

const COLUMNAS = '1fr 120px'

/** Una tabla de una fila, apretable o no. */
function tabla({ onClick, conBoton = false, onBoton } = {}) {
  return render(
    <TablaGrid anchoMinimo={400}>
      <Encabezado columnas={COLUMNAS}>
        <span>Producto</span>
        <span>Acciones</span>
      </Encabezado>
      <Fila columnas={COLUMNAS} onClick={onClick}>
        <span>Colágeno 300g</span>
        {conBoton && (
          <BotonDeFila title="Imprimir" onClick={onBoton}>
            <svg />
          </BotonDeFila>
        )}
      </Fila>
    </TablaGrid>
  )
}

const fila = () => screen.getByText('Colágeno 300g').closest('[style*="grid-template-columns"]')

afterEach(() => cleanup())

describe('Una fila apretable se puede usar sin mouse', () => {
  it('se anuncia como botón y entra en el recorrido del tabulador', () => {
    tabla({ onClick: vi.fn() })

    expect(fila()).toHaveAttribute('role', 'button')
    expect(fila()).toHaveAttribute('tabindex', '0')
  })

  it('Enter la abre', () => {
    const abrir = vi.fn()
    tabla({ onClick: abrir })

    fireEvent.keyDown(fila(), { key: 'Enter' })

    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it('Espacio también, que es lo que hace un `<button>` de verdad', () => {
    const abrir = vi.fn()
    tabla({ onClick: abrir })

    fireEvent.keyDown(fila(), { key: ' ' })

    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it('y el Espacio NO hace scroll de la página', () => {
    // Sin `preventDefault`, la fila se abre Y la lista salta media pantalla:
    // quien abrió el detalle pierde de vista dónde estaba.
    tabla({ onClick: vi.fn() })

    const evento = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    fila().dispatchEvent(evento)

    expect(evento.defaultPrevented).toBe(true)
  })

  it('otra tecla no hace nada', () => {
    // Sin este caso, un `onKeyDown` que abriera con cualquier tecla pasaría los
    // dos de arriba, y tabular por la tabla abriría un panel por fila.
    const abrir = vi.fn()
    tabla({ onClick: abrir })

    for (const key of ['Tab', 'a', 'ArrowDown', 'Escape']) {
      fireEvent.keyDown(fila(), { key })
    }

    expect(abrir).not.toHaveBeenCalled()
  })

  it('el clic sigue funcionando', () => {
    // La otra mitad: agregar teclado no puede sacar el mouse.
    const abrir = vi.fn()
    tabla({ onClick: abrir })

    fireEvent.click(fila())

    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it('declara su foco: se ve en cuál está parado', () => {
    // Sin marca visible, quien navega con teclado no sabe dónde está. Es lo que
    // convierte «se puede tabular» en «se puede usar».
    tabla({ onClick: vi.fn() })

    expect(fila().className).toContain('focus-visible:')
  })
})

describe('Una fila que NO es apretable se queda afuera del teclado', () => {
  it('sin `onClick` no tiene `role` ni `tabIndex`', () => {
    // Una fila de datos que entrara en el recorrido del tabulador serían
    // veinticinco paradas por página prometiendo una acción que no existe.
    tabla()

    expect(fila()).not.toHaveAttribute('role')
    expect(fila()).not.toHaveAttribute('tabindex')
  })

  it('y tampoco muestra el cursor de mano', () => {
    // El cursor es la promesa visual de la misma acción.
    tabla()

    expect(fila().className).not.toContain('cursor-pointer')
  })
})

describe('Los botones de la fila no disparan la fila', () => {
  it('el clic en un botón NO abre el detalle', () => {
    // Ya estaba resuelto con `stopPropagation`, y se afirma acá porque el
    // teclado nuevo pasa por el mismo lugar.
    const abrir = vi.fn()
    const imprimir = vi.fn()

    tabla({ onClick: abrir, conBoton: true, onBoton: imprimir })

    fireEvent.click(within(fila()).getByTitle('Imprimir'))

    expect(imprimir).toHaveBeenCalledTimes(1)
    expect(abrir).not.toHaveBeenCalled()
  })

  it('Espacio sobre un botón de la fila tampoco', () => {
    // ⚠ Éste es el que se rompe si el `onKeyDown` no mira de dónde vino el
    // evento: el `keydown` burbujea hasta la fila, así que apretar Espacio con
    // el foco en «Imprimir» dispararía las DOS cosas.
    const abrir = vi.fn()

    tabla({ onClick: abrir, conBoton: true, onBoton: vi.fn() })

    fireEvent.keyDown(within(fila()).getByTitle('Imprimir'), { key: ' ', bubbles: true })

    expect(abrir).not.toHaveBeenCalled()
  })
})
