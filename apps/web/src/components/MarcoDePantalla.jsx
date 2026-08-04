// ════════════════════════════════════════════
//  ADMINAPP · El marco de 1320px que el shell dejó de aplicar a todas
//
//  Hasta ahora `App.jsx` envolvía TODAS las pantallas en el mismo
//  `max-w-[1320px] px-5 py-7`, adentro de un `<main>` que scrollea entero. El
//  punto de venta es la primera pantalla que no entra en ese marco: necesita el
//  alto completo y dos zonas de scroll independientes —el catálogo por un lado
//  y la lista del ticket por el otro—, con la barra de búsqueda y el pie de
//  cobro siempre a la vista.
//
//  Este componente es el marco, sacado del shell, para que `/pos` pueda ser la
//  única ruta que no lo use. Las alternativas —márgenes negativos en la
//  pantalla, o una ruta fuera del shell— están descartadas en la decisión 6 del
//  plan y no hay que volver a intentarlas.
//
//  ── Por qué el scroll vive acá y no en el `<main>` ──
//
//  El `<main>` del shell pasó a `overflow-hidden`. Si conservara su
//  `overflow-y-auto`, el punto de venta —que ocupa el alto completo— haría
//  scrollear la página entera además de sus dos zonas internas, que es
//  exactamente lo que FR-002 viene a evitar. Así que el scroll baja acá, junto
//  con el `h-full` que hace que este marco llene el alto disponible.
//
//  Una pantalla nueva NO dibuja su propio marco: devuelve su contenido y la
//  ruta lo envuelve. La única salvedad es `/pos`, y está escrita en
//  `docs/REGLAS-DISENO.md` y verificada en `tests/marcoDePantalla.test.js`.
// ════════════════════════════════════════════

export default function MarcoDePantalla({ children }) {
  return (
    <div className="mx-auto h-full max-w-[1320px] overflow-y-auto px-5 py-7 lg:px-9 lg:py-8">
      {children}
    </div>
  )
}
