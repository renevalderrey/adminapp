import { useEffect, useRef } from 'react'
import { atajoDe } from '@/utils/atajosDelPos'

// ════════════════════════════════════════════
//  ADMINAPP · El escuchador de teclado del punto de venta
//
//  Se suscribe UNA vez al montar y se desuscribe UNA vez al desmontar. Eso es
//  lo que hace verdadero a FR-040 —fuera del punto de venta, `/` no hace nada—
//  y es contable en un test.
//
//  ── Por qué las acciones van en un `ref` ──
//
//  El handler necesita el ticket, la consulta y el comprobante actuales. Si
//  cerrara sobre esas variables habría que ponerlas en las dependencias del
//  efecto, y entonces el escuchador se DESUSCRIBE Y SE VUELVE A SUSCRIBIR EN
//  CADA TECLA. Alcanza con que una limpieza falle —o con que alguien agregue
//  una dependencia y olvide otra— para que quede un escuchador huérfano con
//  estado viejo, y un escuchador huérfano del punto de venta cobra ventas.
//
//  Con el `ref` al día hay exactamente un `addEventListener` y exactamente un
//  `removeEventListener` por vida de la pantalla.
//
//  ── Por qué en `window` y en fase de burbuja ──
//
//  En `window` porque al abrir la pantalla el foco está en el `<body>`, y los
//  eventos del `<body>` no burbujean hacia un `<div>` hijo: un `onKeyDown` en
//  el div raíz no vería la primera tecla.
//
//  En burbuja y NO en captura porque cualquier control que ya haya usado la
//  tecla —el `Esc` de un diálogo, las flechas de un `<select>`— la procesó
//  antes, y `atajoDe` lo detecta por `defaultPrevented`. En captura, el atajo le
//  ganaría la tecla al control que la está usando: `Esc` vaciaría el ticket EN
//  VEZ de cerrar el diálogo abierto.
//
//  ── El `preventDefault` va solo si hay atajo ──
//
//  Llamarlo siempre le rompería el tipeo al operador: cada letra que escribe
//  pasa por acá.
// ════════════════════════════════════════════

/**
 * @param {object} acciones `{ enfocarBusqueda, agregarPrimero, cobrar, limpiar }`.
 *   Se puede recrear en cada render: el hook siempre llama a la última versión.
 */
export function useAtajosDelPos(acciones) {
  const ultimo = useRef(acciones)

  // Sin arreglo de dependencias: corre en CADA render y deja el `ref` al día.
  useEffect(() => {
    ultimo.current = acciones
  })

  useEffect(() => {
    const alTeclear = (evento) => {
      const atajo = atajoDe(evento)
      if (!atajo) return

      evento.preventDefault()
      ultimo.current?.[atajo]?.()
    }

    window.addEventListener('keydown', alTeclear)

    // ⚠ Este `return` es lo único que impide que el escuchador siga vivo después
    // de que la pantalla se desmontó. El store es global: un escuchador
    // huérfano sigue viendo el ticket y `Ctrl+Enter` desde cualquier otra
    // pantalla dispararía el cobro. Hay un test que verifica esa ausencia.
    return () => window.removeEventListener('keydown', alTeclear)
  }, [])
}

export default useAtajosDelPos
