// ════════════════════════════════════════════
//  429 · el limitador propio del catálogo
//
//  ⚠ **Invita a reintentar y no es una pantalla en blanco** (US10 escenario 10).
//
//  El 429 lo devuelve `limitadorPublico` (`apps/api/src/server.js:352`), que es
//  el limitador que protege la única superficie del sistema que contesta sin
//  autenticar. Del otro lado casi nunca hay un atacante: hay una persona que
//  recargó cinco veces porque el catálogo tardaba, o veinte socios saliendo de la
//  misma clase y de la misma red del gimnasio. Para esa persona, un 429 sin
//  pantalla es la tienda rota para siempre — porque no tiene forma de saber que
//  en treinta segundos anda.
//
//  Por eso el estado dice **cuánto** y trae el botón. El «cuánto» sale de la
//  cabecera `Retry-After` cuando el limitador la manda; cuando no, se dice el
//  número redondo en vez de una promesa exacta que nadie puede cumplir.
// ════════════════════════════════════════════

import { Aviso, BotonDeMarca, IconoReloj, Marco } from './plantilla.jsx'

export default function DemasiadasPeticiones({ catalogo, segundos, alReintentar }) {
  const espera = Number.isFinite(Number(segundos)) && Number(segundos) > 0 ? Math.ceil(Number(segundos)) : null

  return (
    <Marco estado="demasiadas_peticiones" catalogo={catalogo}>
      <Aviso
        icono={<IconoReloj />}
        titulo="Demasiadas consultas seguidas"
        detalle={
          espera
            ? `Esperá ${espera} segundos y volvé a intentar. No perdiste nada de lo que habías puesto en el pedido.`
            : 'Esperá unos segundos y volvé a intentar. No perdiste nada de lo que habías puesto en el pedido.'
        }
        acciones={<BotonDeMarca onClick={alReintentar}>Reintentar</BotonDeMarca>}
      />
    </Marco>
  )
}
