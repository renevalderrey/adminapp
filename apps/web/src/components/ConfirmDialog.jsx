import { useState, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * La confirmación de toda la aplicación.
 *
 * ── Por qué el botón dejó de decir «Confirmar» ──
 *
 * Veintidós lugares usaban este diálogo y los veintidós dibujaban **el mismo
 * botón rojo con la misma palabra**: vaciar un ticket, cerrar una sesión, pasar
 * a producción fiscal y borrar un proveedor con toda su cuenta corriente.
 *
 * El daño no es asustar a quien vacía el ticket. Es el otro: **quien apretó ese
 * botón rojo cinco veces esa mañana para cosas que no borraban nada llega al
 * sexto con el dedo hecho.** Un color de alarma que aparece siempre deja de ser
 * una alarma; es el mecanismo por el que la advertencia de verdad no se lee.
 *
 * Así que ahora:
 *
 *  · El botón **dice el verbo** —«Eliminar proveedor», «Pasar a producción»—.
 *    Se lee sin volver al párrafo, y es lo único que queda a la vista cuando
 *    alguien ya decidió y solo busca dónde hacer clic.
 *  · El **rojo se reserva** para lo que destruye datos acumulados o no se puede
 *    deshacer. El resto usa el botón común.
 *  · `verbo` **no tiene valor por omisión** a propósito. Un default sería
 *    «Confirmar» otra vez, y la próxima pantalla lo heredaría sin enterarse.
 *    Hay una guardia estática que falla si alguien llama sin verbo.
 *
 * ── Y por qué el `resolve` se guarda en un ref ──
 *
 * Estaba en el mismo `useState` que el resto: una segunda llamada a `confirm()`
 * con un diálogo abierto **pisaba el `resolve` anterior**, y esa primera promesa
 * no se resolvía nunca. El handler que la esperaba quedaba colgado para siempre
 * —con su `finally` sin correr, o sea con sus cerrojos tomados—. Ahora la
 * anterior se cancela con `false`, que es lo que significa «no llegaste a
 * contestar»: el handler viejo sale por su camino de cancelación y suelta todo.
 */
export function useConfirmDialog() {
  const [state, setState] = useState({ open: false, message: '', verbo: '', destructivo: false })

  // Fuera del estado: un `setState` no se ve hasta el render siguiente, y acá
  // hace falta leer el resolver anterior DENTRO de la misma llamada.
  const pendiente = useRef(null)

  /**
   * @param {string} message  Qué va a pasar, en criollo.
   * @param {{verbo: string, destructivo?: boolean}} opciones
   *   `verbo` es lo que dice el botón. `destructivo` pinta el botón de rojo, y
   *   se reserva para lo que borra datos acumulados o no se puede deshacer.
   */
  const confirm = useCallback((message, { verbo, destructivo = false } = {}) => {
    return new Promise((resolve) => {
      // La confirmación anterior, si quedó una abierta, se contesta que no.
      if (pendiente.current) pendiente.current(false)
      pendiente.current = resolve

      setState({ open: true, message, verbo, destructivo })
    })
  }, [])

  const cerrar = useCallback((respuesta) => {
    const resolver = pendiente.current
    pendiente.current = null
    setState({ open: false, message: '', verbo: '', destructivo: false })
    // Después de cerrar: si el handler que espera vuelve a abrir un diálogo, que
    // lo encuentre limpio.
    if (resolver) resolver(respuesta)
  }, [])

  const ConfirmDialogComponent = (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) cerrar(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar</DialogTitle>
          <DialogDescription>{state.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => cerrar(false)}>Cancelar</Button>
          <Button
            variant={state.destructivo ? 'destructive' : 'default'}
            onClick={() => cerrar(true)}
          >
            {state.verbo || 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, ConfirmDialog: () => ConfirmDialogComponent }
}
