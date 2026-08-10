// ════════════════════════════════════════════
//  Búsqueda sin resultados · el vacío que no termina en un cartel
//
//  ⚠ La regla del diseño (maqueta, `:515-539`): **ofrece la categoría más
//  parecida**. Alguien escribió «creatnia» con el pulgar, en la puerta de un
//  gimnasio; lo que venía a buscar son las creatinas, y la pantalla lo sabe. Un
//  estado que solo dice «no encontramos nada» le confirma a esa persona que la
//  tienda no lo tiene, y lo tiene.
//
//  La sugerencia sale de `categoriaMasParecida` (`src/formato.js`), que es una
//  función pura y está probada aparte: qué se sugiere no depende de esta pantalla.
//  Cuando ninguna categoría se parece lo suficiente, el botón **no aparece** —no
//  se degrada a «ver todos» disfrazado de sugerencia—, y el estado queda con
//  «limpiar», que sigue siendo una salida.
// ════════════════════════════════════════════

import { categoriaMasParecida } from '../formato.js'
import { Aviso, BotonDeMarca, BotonNeutro, IconoLupaVacia } from './plantilla.jsx'

/**
 * @param {object} props
 * @param {string} props.consulta Lo que se escribió. Se repite en el título: la
 *   persona tiene que poder ver **cómo lo escribió** para encontrar su propio error.
 * @param {Array} [props.categorias] Las del catálogo, para la sugerencia.
 * @param {Function} props.alLimpiar
 * @param {Function} [props.alElegirCategoria] Recibe la categoría normalizada.
 */
export default function SinResultados({ consulta, categorias = [], alLimpiar, alElegirCategoria }) {
  const sugerida = categoriaMasParecida(consulta, categorias)

  return (
    <div data-estado="sin_resultados">
      <Aviso
        icono={<IconoLupaVacia />}
        titulo={`No encontramos «${consulta}»`}
        detalle={
          sugerida
            ? `Revisá cómo se escribe o mirá la categoría ${sugerida.etiqueta}.`
            : 'Probá con el nombre del producto o con la marca.'
        }
        acciones={
          <>
            <BotonNeutro onClick={alLimpiar}>Limpiar</BotonNeutro>
            {sugerida && alElegirCategoria ? (
              <BotonDeMarca onClick={() => alElegirCategoria(sugerida.categoria)}>
                Ver {sugerida.etiqueta}
              </BotonDeMarca>
            ) : null}
          </>
        }
      />
    </div>
  )
}
