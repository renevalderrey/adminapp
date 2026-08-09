import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { useConfirmDialog } from '@/components/ConfirmDialog'

// ════════════════════════════════════════════
//  FAVALIO · La confirmación de toda la aplicación
//
//  Veintiséis lugares dependen de este hook, y el que se colgaba no dejaba nada
//  escrito: el handler quedaba detenido en su `await`, con su `finally` sin
//  correr y sus cerrojos tomados. Desde afuera se ve como que el botón dejó de
//  andar.
//
//  ── El defecto ──
//
//  El `resolve` vivía en el mismo `useState` que el resto del diálogo. Una
//  segunda llamada a `confirm()` con uno abierto **pisaba el `resolve` de la
//  primera**, y esa promesa no se resolvía nunca. No fallaba, no avisaba, no
//  tiraba nada a la consola: se quedaba esperando para siempre.
//
//  Se encontró por el lado largo. Un test del cerrojo de pagos —dos envíos
//  mientras la confirmación estaba abierta— pasaba con y sin el cerrojo puesto,
//  y el motivo era éste: sin cerrojo, el segundo `confirm()` pisaba al primero,
//  el primer handler quedaba colgado y salía UN solo POST igual. El síntoma que
//  tapaba el defecto era otro defecto.
// ════════════════════════════════════════════

/** Una pantalla mínima que expone el hook para poder manejarlo desde el test. */
function Pantalla({ alMontar }) {
  const { confirm, ConfirmDialog } = useConfirmDialog()

  return (
    <div>
      <button onClick={() => alMontar(confirm)}>disparar</button>
      <ConfirmDialog />
    </div>
  )
}

/** Aprieta el botón del diálogo por su texto. */
async function apretar(texto) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: texto }))
  })
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('El botón dice el verbo de la acción', () => {
  it('dibuja el verbo que le pasaron, no «Confirmar»', async () => {
    let confirmar
    render(<Pantalla alMontar={(c) => { confirmar = c }} />)
    await apretar('disparar')

    await act(async () => { confirmar('¿Seguro?', { verbo: 'Eliminar proveedor' }) })

    expect(screen.getByRole('button', { name: 'Eliminar proveedor' })).toBeInTheDocument()
    // Y «Confirmar» sigue estando arriba como TÍTULO del diálogo, que es otra
    // cosa: lo que no puede volver a aparecer es como texto del botón.
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  })

  it('el rojo aparece solo si se lo pide', async () => {
    let confirmar
    render(<Pantalla alMontar={(c) => { confirmar = c }} />)
    await apretar('disparar')

    await act(async () => { confirmar('¿Vaciar?', { verbo: 'Vaciar ticket' }) })
    const suave = screen.getByRole('button', { name: 'Vaciar ticket' })

    await act(async () => { confirmar('¿Borrar?', { verbo: 'Eliminar todo', destructivo: true }) })
    const rojo = screen.getByRole('button', { name: 'Eliminar todo' })

    // Se comparan los dos entre sí y no contra una clase concreta: el nombre de
    // la variante es del sistema de diseño y puede cambiar; lo que no puede es
    // que los dos se vean igual, porque eso es el defecto.
    expect(rojo.className).not.toBe(suave.className)
  })
})

describe('Una confirmación no deja colgada a la anterior', () => {
  it('la que quedó abierta se contesta que NO, y su promesa termina', async () => {
    let confirmar
    render(<Pantalla alMontar={(c) => { confirmar = c }} />)
    await apretar('disparar')

    // La primera queda abierta y su promesa esperando.
    let primeraRespondio = 'todavía no'
    let promesaPrimera
    await act(async () => {
      promesaPrimera = confirmar('la primera', { verbo: 'Hacer lo primero' })
      promesaPrimera.then((r) => { primeraRespondio = r })
    })

    // Y llega la segunda sin que nadie haya contestado la primera.
    await act(async () => { confirmar('la segunda', { verbo: 'Hacer lo segundo' }) })

    // ⚠ Ésta es la aserción del defecto. Antes, `primeraRespondio` se quedaba en
    // «todavía no» PARA SIEMPRE: el handler que esperaba esa promesa no seguía
    // nunca, su `finally` no corría, y los cerrojos que hubiera tomado quedaban
    // puestos hasta recargar la página.
    expect(primeraRespondio).toBe(false)

    // Y no se resuelve con `true` por error, que sería peor todavía: querría
    // decir que abrir un segundo diálogo confirma el primero solo.
    await expect(promesaPrimera).resolves.toBe(false)
  })

  it('la segunda sigue funcionando normal después de cancelar a la primera', async () => {
    // Sin esto, «resolver la anterior» se podría cumplir rompiendo la nueva:
    // resolver las DOS con `false` y dejar el diálogo abierto sin nadie
    // escuchando pasaría la aserción de arriba.
    let confirmar
    render(<Pantalla alMontar={(c) => { confirmar = c }} />)
    await apretar('disparar')

    let segundaRespondio = 'todavía no'
    await act(async () => {
      confirmar('la primera', { verbo: 'Hacer lo primero' })
      confirmar('la segunda', { verbo: 'Hacer lo segundo' }).then((r) => { segundaRespondio = r })
    })

    await apretar('Hacer lo segundo')

    expect(segundaRespondio).toBe(true)
  })

  it('cancelar y volver a abrir funciona, y no arrastra la respuesta anterior', async () => {
    // El camino de todos los días. Se verifica porque el arreglo mueve el
    // `resolve` a un ref, y un ref que no se limpia al cerrar deja la respuesta
    // de la vuelta pasada enganchada a la siguiente.
    let confirmar
    render(<Pantalla alMontar={(c) => { confirmar = c }} />)
    await apretar('disparar')

    const respuestas = []

    await act(async () => { confirmar('una', { verbo: 'Seguir' }).then((r) => respuestas.push(r)) })
    await apretar('Cancelar')

    await act(async () => { confirmar('otra', { verbo: 'Seguir' }).then((r) => respuestas.push(r)) })
    await apretar('Seguir')

    expect(respuestas).toEqual([false, true])
  })

  it('cerrar el diálogo sin apretar nada cuenta como que NO', async () => {
    // El Esc y el clic afuera pasan por `onOpenChange`. Un camino de cierre que
    // no resuelva la promesa es el mismo cuelgue por otra puerta.
    let confirmar
    render(<Pantalla alMontar={(c) => { confirmar = c }} />)
    await apretar('disparar')

    let respuesta = 'todavía no'
    await act(async () => { confirmar('algo', { verbo: 'Seguir' }).then((r) => { respuesta = r }) })

    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' })
    })

    expect(respuesta).toBe(false)
  })
})
