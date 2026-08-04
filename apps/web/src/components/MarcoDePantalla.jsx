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
//  ── Por qué son DOS divs y no uno ──
//
//  El que scrollea es el de afuera, que ocupa el ancho completo de `<main>`. El
//  de adentro es el que centra a 1320px. Juntarlos en uno solo —que es como
//  quedó al principio— mueve el contenedor de scroll adentro del marco, y eso
//  se ve así en un monitor de 1920px: `<main>` va de x=240 a x=1920, el marco
//  de x=420 a x=1740, y quedan **180px muertos de cada lado** donde la rueda
//  del mouse no scrollea nada. Está medido: con el puntero en x=1880 el
//  `scrollTop` no se movía; con el puntero en el centro, 500px.
//
//  Antes del hito 5 el que scrolleaba era el `<main>` a ancho completo y el
//  `<div>` de 1320px iba adentro (`App.jsx:252-253`). Estas dos capas son esa
//  misma forma, movida acá. `tests/marcoDePantalla.test.js` verifica que la
//  ruta la aplique; `pruebas-de-navegador/marcoDeLasPantallas.navegador.js`
//  verifica la geometría en las diecisiete, que es lo que ningún test de render
//  puede contestar porque jsdom no tiene motor de maquetado.
//
//  Una pantalla nueva NO dibuja su propio marco: devuelve su contenido y la
//  ruta lo envuelve. La única salvedad es `/pos`, y está escrita en
//  `docs/REGLAS-DISENO.md` y verificada en `tests/marcoDePantalla.test.js`.
// ════════════════════════════════════════════

export default function MarcoDePantalla({ children }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1320px] px-5 py-7 lg:px-9 lg:py-8">
        {children}
      </div>
    </div>
  )
}
