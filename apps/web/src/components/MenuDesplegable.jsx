import { useEffect, useRef } from 'react'

// ════════════════════════════════════════════
//  FAVALIO · Un menú que se abre desde un botón
//
//  ── Por qué existe ──
//
//  Había dos `<details>` usados como menú, los dos en Inventario, y arriba de
//  uno estaba escrito: «es un `<details>` y no un popover para no arrastrar otro
//  componente: **el navegador ya resuelve abrir, cerrar y el teclado**».
//
//  La primera mitad es cierta y la segunda **no**. `<details>` abre y cierra con
//  su propio `summary`, pero:
//
//   · **no cierra al hacer clic afuera** — el menú queda flotando arriba de la
//     tabla mientras la persona sigue trabajando, tapando filas;
//   · **no cierra con Escape** — que es lo primero que hace cualquiera que
//     abrió algo por error;
//   · **no se anuncia como menú** a un lector de pantalla: dice «detalles».
//
//  O sea que el motivo escrito para no traer un componente era correcto —no
//  hace falta una librería— pero la conclusión no: hacía falta escribir las tres
//  líneas que el navegador no pone. Son éstas.
//
//  ⚠ Se sigue usando `<details>` por debajo a propósito. Es lo que hace que el
//  menú funcione sin JavaScript y que el `summary` ya sea foco-able y se abra
//  con Enter y con Espacio, que es la parte que el navegador SÍ resuelve.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {React.ReactNode} props.boton Lo que se ve cuando está cerrado.
 * @param {string} props.claseDelBoton Clases del `summary`.
 * @param {string} [props.ancho] Ancho del panel, en clases de Tailwind.
 * @param {React.ReactNode} props.children El contenido del menú.
 */
export default function MenuDesplegable({ boton, claseDelBoton, ancho = 'w-[210px]', children }) {
  const caja = useRef(null)

  useEffect(() => {
    const cerrar = () => {
      if (caja.current) caja.current.open = false
    }

    const alClic = (evento) => {
      // Un clic ADENTRO no cierra: el menú de columnas tiene casillas que se
      // marcan de a una, y cerrarse en la primera obligaría a reabrirlo por
      // cada sucursal.
      if (caja.current && !caja.current.contains(evento.target)) cerrar()
    }

    const alTeclado = (evento) => {
      if (evento.key !== 'Escape') return
      if (!caja.current?.open) return

      cerrar()
      // El foco vuelve al botón que lo abrió. Sin esto, Escape cierra el menú y
      // deja el foco en la nada: el próximo Tab arranca desde el principio de
      // la página.
      caja.current.querySelector('summary')?.focus()
    }

    document.addEventListener('mousedown', alClic)
    document.addEventListener('keydown', alTeclado)

    return () => {
      document.removeEventListener('mousedown', alClic)
      document.removeEventListener('keydown', alTeclado)
    }
  }, [])

  return (
    <details ref={caja} className="relative">
      <summary className={`${claseDelBoton} cursor-pointer list-none`}>
        {boton}
      </summary>

      <div
        role="menu"
        className={`absolute right-0 z-20 mt-1.5 ${ancho} overflow-hidden rounded-xl
                    border border-border bg-surface p-1 shadow-nivel-2`}
      >
        {children}
      </div>
    </details>
  )
}
